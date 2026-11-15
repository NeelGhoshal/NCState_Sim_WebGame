// Builds prompts, calls the gateway, validates output, and falls back to scripts.
// Never applies state itself: callers pass results to the engine.
import { AGENT_BY_ID, AGENTS, ALL_INVITES } from '../data/agents';
import { N } from '../data/names';
import { type AgentTurn, type Reflection, allowedActions, agentHere, fmtTime, upcoming } from '../engine/engine';
import type { GameState } from '../engine/state';
import { chat, type ChatMessage, type Tier } from './gateway';
import { validateTurn, validateReflection, validateRecap, validateEpilogue } from './schema';
import { fallbackTurn, fallbackReflection, fallbackRecap, fallbackEpilogue } from './fallback';
import { blocked } from './filter';

export type Source = 'llm' | 'fallback';
export interface Line { who: 'player' | 'agent'; text: string }

async function call(s: GameState, tier: Tier, messages: ChatMessage[], maxTokens: number): Promise<string | null> {
  const r = await chat(messages, tier, { maxTokens });
  if (!r) return null;
  const u = s.usage[tier];
  s.usage.calls++;
  u.calls++;
  u.promptTokens += r.usage?.prompt_tokens ?? 0;
  u.completionTokens += r.usage?.completion_tokens ?? 0;
  return r.content;
}

function memoriesFor(s: GameState, id: string, n = 8): string {
  const mem = s.agents[id].memories.slice(-n);
  return mem.length ? mem.map((m) => `- (day ${m.day}, ${fmtTime(m.minute)}) ${m.text}`).join('\n') : '- Nothing yet. You have not met the player before.';
}

function systemPrompt(s: GameState, id: string): string {
  const def = AGENT_BY_ID[id];
  const a = s.agents[id];
  const here = agentHere(s, id);
  const allowed = allowedActions(s, id);
  const invites = (allowed.argsFor.invite ?? []).map((iid) => {
    const inv = ALL_INVITES.find((i) => i.id === iid)!;
    return `  - "${iid}": ${inv.label}, day ${inv.day} at ${fmtTime(inv.from)}`;
  }).join('\n');
  const facts = (allowed.argsFor.share_info ?? []).map((fid) => `  - "${fid}": ${def.facts.find((f) => f.id === fid)!.text}`).join('\n');
  const p = s.setup;
  return [
    `You are ${def.name} (${def.pronouns}), ${def.role}, a character in a college life game set at ${N.university}. Stay in character. Never mention being an AI or a game.`,
    `Persona: ${def.persona}`,
    `Speech style: ${def.speech}`,
    `Values: ${def.values}`,
    `Semester goal: ${def.semesterGoal}`,
    `Today's goal: ${a.goal}`,
    `Right now: day ${s.day}, ${fmtTime(s.minute)}. You are ${here?.activity ?? 'around'}. You must leave in ${here ? here.endsAt - s.minute : 0} minutes.`,
    `You are talking with ${p.name} (${p.pronouns}). Relationship: ${a.rel}/100. Your note on them: ${a.note}`,
    `What you remember. You know nothing about the player beyond this:\n${memoriesFor(s, id)}`,
    `Actions you may take this turn: ${allowed.actions.join(', ')}.`,
    invites ? `Invitations you may extend (only if it fits naturally):\n${invites}` : '',
    facts ? `Things you know and may share (action share_info):\n${facts}` : '',
    def.gift && allowed.argsFor.give ? `You may give the player ${def.gift.label} (action give, arg "${def.gift.id}").` : '',
    'You cannot give money, grades, or anything not listed. Do not invent events that already happened.',
    'Reply ONLY with a JSON object: {"say": string, "action": string, "action_arg": string, "relationship_delta": integer -3..3, "replies": [3 strings], "memory": string}.',
    '"say" is under 60 words, spoken aloud. "replies" are three short, varied things the player might say next, in first person. "memory" is one short sentence worth remembering about this exchange, or "".',
  ].filter(Boolean).join('\n\n');
}

export async function dialogueTurn(s: GameState, id: string, history: Line[], playerText: string, exchange: number): Promise<{ turn: AgentTurn; source: Source; warnings: string[] }> {
  const allowed = allowedActions(s, id);
  const fb = () => { s.usage.fallbacks++; return { turn: fallbackTurn(s, id, allowed, exchange, playerText), source: 'fallback' as Source, warnings: [] }; };
  if (blocked(playerText)) {
    return { turn: { say: "Let's talk about something else.", action: 'none', action_arg: '', relationship_delta: -1, replies: AGENT_BY_ID[id].replies, memory: '' }, source: 'fallback', warnings: ['player input filtered'] };
  }
  const name = AGENT_BY_ID[id].name.split(' ')[0];
  const transcript = history.slice(-12).map((l) => `${l.who === 'player' ? s.setup.name : name}: ${l.text}`).join('\n');
  const user = `${transcript ? `Conversation so far:\n${transcript}\n\n` : ''}${s.setup.name} says: "${playerText}"\n\nRespond as ${name} with the JSON object only.`;
  const raw = await call(s, 'small', [{ role: 'system', content: systemPrompt(s, id) }, { role: 'user', content: user }], 450);
  if (raw === null) return fb();
  const checked = validateTurn(raw, allowed);
  if (!checked.ok || blocked(checked.value.say)) {
    console.warn('[agent] invalid turn', checked.ok ? 'filtered' : checked.error, raw);
    return fb();
  }
  if (!checked.value.replies.length) checked.value.replies = AGENT_BY_ID[id].replies.slice();
  return { turn: checked.value, source: 'llm', warnings: checked.warnings };
}

export async function reflect(s: GameState, id: string): Promise<{ r: Reflection; source: Source }> {
  const def = AGENT_BY_ID[id];
  const today = s.agents[id].memories.filter((m) => m.day === s.day);
  if (!today.length || def.tier !== 'core') return { r: fallbackReflection(s, id), source: 'fallback' };
  const tomorrow = ALL_INVITES.filter((i) => i.day === s.day + 1 && def.invites.includes(i)).map((i) => `${i.label} at ${fmtTime(i.from)}`);
  const msgs: ChatMessage[] = [
    { role: 'system', content: 'You manage the overnight memory of a character in a college life game. Reply only with JSON.' },
    { role: 'user', content: [
      `Character: ${def.name}. ${def.persona}`,
      `Semester goal: ${def.semesterGoal}`,
      `Relationship with the player (${s.setup.name}): ${s.agents[id].rel}/100.`,
      `Today's memories (day ${s.day}):\n${today.map((m) => `- [${m.importance}] ${m.text}`).join('\n')}`,
      tomorrow.length ? `Plans tomorrow: ${tomorrow.join('; ')}` : '',
      'Return {"summary": "1-2 sentences, first person, what today meant", "importance": 1-10, "relationship_note": "short note about the player", "tomorrow_goal": "one sentence", "text_player": "a short casual text to send the player tomorrow morning, or empty string"}.',
    ].filter(Boolean).join('\n\n') },
  ];
  const raw = await call(s, 'large', msgs, 500);
  const c = raw === null ? null : validateReflection(raw);
  if (!c || !c.ok || blocked(c.value.summary + c.value.text)) { s.usage.fallbacks++; return { r: fallbackReflection(s, id), source: 'fallback' }; }
  return { r: c.value, source: 'llm' };
}

/** Runs after sleep() has advanced the day. Recaps yesterday and teases today. */
export async function directorRecap(s: GameState): Promise<{ recap: string; hook: string; source: Source }> {
  const prev = s.log.filter((l) => l.day === s.day - 1).map((l) => `- ${fmtTime(l.minute)} ${l.text}`).join('\n');
  const today = upcoming(s).map((u) => `- ${fmtTime(u.minute)} ${u.label}${u.status ? ` (${u.status})` : ''}`).join('\n');
  const rels = AGENTS.filter((a) => a.tier === 'core').map((a) => `${a.name}: ${s.agents[a.id].rel}/100`).join(', ');
  const raw = await call(s, 'large', [
    { role: 'system', content: 'You are the director of an episodic college life game. You write short TV-style recaps. Use only the facts given. Never mention numbers, scores, clock times or hours of sleep; describe feelings and events instead. Reply only with JSON.' },
    { role: 'user', content: `Player: ${s.setup.name} (${s.setup.pronouns}).\nYesterday (day ${s.day - 1}):\n${prev || '- Nothing notable.'}\n\nRelationships: ${rels}\n\nScheduled today (day ${s.day}):\n${today || '- Nothing scheduled.'}\n\nReturn {"recap": "2-3 sentences in second person, starting with Previously", "hook": "one sentence teaser for today, based only on the schedule"}.` },
  ], 450);
  const c = raw === null ? null : validateRecap(raw);
  if (!c || !c.ok) { s.usage.fallbacks++; return { ...fallbackRecap(s), source: 'fallback' }; }
  return { ...c.value, source: 'llm' };
}

export async function directorEpilogue(s: GameState): Promise<{ closing: string; characters: Record<string, string>; source: Source }> {
  const core = AGENTS.filter((a) => a.tier === 'core');
  const log = s.log.map((l) => `- day ${l.day} ${fmtTime(l.minute)} ${l.text}`).slice(-40).join('\n');
  const raw = await call(s, 'large', [
    { role: 'system', content: 'You are the director of an episodic college life game. Write the closing of an episode. Use only the facts given. Reply only with JSON.' },
    { role: 'user', content: `Player: ${s.setup.name} (${s.setup.pronouns}). Quiz score: ${s.quizScore ?? 'did not take it'}.\nLog:\n${log}\n\nCharacters: ${core.map((a) => `${a.id} = ${a.name}, relationship ${s.agents[a.id].rel}/100, note: ${s.agents[a.id].note}`).join('; ')}\n\nReturn {"closing": "3-4 sentences in second person", "characters": {${core.map((a) => `"${a.id}": "one sentence on where they stand with the player"`).join(', ')}}}.` },
  ], 700);
  const c = raw === null ? null : validateEpilogue(raw, core.map((a) => a.id));
  if (!c || !c.ok) { s.usage.fallbacks++; return { ...fallbackEpilogue(s), source: 'fallback' }; }
  return { ...c.value, source: 'llm' };
}
