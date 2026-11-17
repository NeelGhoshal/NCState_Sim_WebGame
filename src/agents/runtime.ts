// Client side of the agent layer. Builds a snapshot of what each call needs, sends it to
// the Python AI service (ai/), re-checks the result, and falls back to scripts on any
// failure. Never applies state itself: callers pass results to the engine.
import { AGENT_BY_ID, AGENTS, ALL_INVITES } from '../data/agents';
import { N } from '../data/names';
import { type AgentTurn, type Reflection, allowedActions, agentHere, fmtTime, upcoming } from '../engine/engine';
import type { GameState } from '../engine/state';
import { post, type CallUsage } from './gateway';
import { validateTurn } from './schema';
import { fallbackTurn, fallbackReflection, fallbackRecap, fallbackEpilogue } from './fallback';
import { blocked } from './filter';

export type Source = 'llm' | 'fallback';
export interface Line { who: 'player' | 'agent'; text: string }

type Reply<T> = ({ ok: true } & T | { ok: false; reason: string }) & { usage?: CallUsage };

function record(s: GameState, u: CallUsage | undefined) {
  if (!u || !u.calls) return;
  s.usage.calls += u.calls;
  const t = s.usage[u.tier];
  t.calls += u.calls;
  t.promptTokens += u.promptTokens;
  t.completionTokens += u.completionTokens;
}

/** Sends a request; returns the reply only when ok, recording usage either way. */
async function ask<T>(s: GameState, path: string, body: unknown): Promise<T | null> {
  const r = await post<Reply<T>>(path, body);
  if (!r) return null;
  record(s, r.usage);
  if (!r.ok) { console.info('[ai] fallback:', r.reason); return null; }
  return r as T;
}

const player = (s: GameState) => ({ name: s.setup.name, pronouns: s.setup.pronouns });

export async function dialogueTurn(s: GameState, id: string, history: Line[], playerText: string, exchange: number): Promise<{ turn: AgentTurn; source: Source; warnings: string[] }> {
  const def = AGENT_BY_ID[id];
  const a = s.agents[id];
  const allowed = allowedActions(s, id);
  const fallback = () => { s.usage.fallbacks++; return { turn: fallbackTurn(s, id, allowed, exchange, playerText), source: 'fallback' as Source, warnings: [] }; };
  if (blocked(playerText)) {
    return { turn: { say: "Let's talk about something else.", action: 'none', action_arg: '', relationship_delta: -1, replies: def.replies, memory: '' }, source: 'fallback', warnings: ['player input filtered'] };
  }
  const here = agentHere(s, id);
  const r = await ask<{ turn: AgentTurn; warnings: string[] }>(s, '/api/agent/turn', {
    university: N.university,
    day: s.day, minute: s.minute,
    player: player(s),
    agent: {
      id, name: def.name, pronouns: def.pronouns, role: def.role, persona: def.persona, speech: def.speech,
      values: def.values, semesterGoal: def.semesterGoal, goal: a.goal, rel: a.rel, note: a.note,
      activity: here?.activity ?? 'around', minutesLeft: here ? here.endsAt - s.minute : 0,
      memories: a.memories.slice(-8),
      topics: def.topics,
    },
    allowed,
    invites: (allowed.argsFor.invite ?? []).map((iid) => {
      const inv = ALL_INVITES.find((i) => i.id === iid)!;
      return { id: iid, label: inv.label, day: inv.day, start: inv.from };
    }),
    facts: (allowed.argsFor.share_info ?? []).map((fid) => def.facts.find((f) => f.id === fid)!),
    gift: def.gift && allowed.argsFor.give ? { id: def.gift.id, label: def.gift.label } : null,
    history: history.slice(-12),
    playerText,
  });
  if (!r) return fallback();
  // Second guard: the service validated already, but the client never trusts the network.
  const checked = validateTurn(JSON.stringify(r.turn), allowed);
  if (!checked.ok) return fallback();
  if (!checked.value.replies.length) checked.value.replies = def.replies.slice();
  return { turn: checked.value, source: 'llm', warnings: [...r.warnings, ...checked.warnings] };
}

export async function reflect(s: GameState, id: string): Promise<{ r: Reflection; source: Source }> {
  const def = AGENT_BY_ID[id];
  const today = s.agents[id].memories.filter((m) => m.day === s.day);
  if (!today.length || def.tier !== 'core') return { r: fallbackReflection(s, id), source: 'fallback' };
  const res = await ask<{ reflection: Reflection }>(s, '/api/agent/reflect', {
    day: s.day, agentId: id, topics: def.topics,
    player: player(s), agentName: def.name, persona: def.persona, semesterGoal: def.semesterGoal,
    rel: s.agents[id].rel, memoriesToday: today,
    tomorrowPlans: def.invites.filter((i) => i.day === s.day + 1).map((i) => `${i.label} at ${fmtTime(i.from)}`),
  });
  if (!res) { s.usage.fallbacks++; return { r: fallbackReflection(s, id), source: 'fallback' }; }
  return { r: res.reflection, source: 'llm' };
}

/** Runs after sleep() has advanced the day. Recaps yesterday and teases today. */
export async function directorRecap(s: GameState): Promise<{ recap: string; hook: string; source: Source }> {
  const res = await ask<{ recap: string; hook: string }>(s, '/api/director/recap', {
    day: s.day, player: player(s),
    yesterday: s.log.filter((l) => l.day === s.day - 1).map((l) => `${fmtTime(l.minute)} ${l.text}`),
    relationships: AGENTS.filter((a) => a.tier === 'core').map((a) => `${a.name}: ${s.agents[a.id].rel}/100`),
    today: upcoming(s).map((u) => `${fmtTime(u.minute)} ${u.label}${u.status ? ` (${u.status})` : ''}`),
  });
  if (!res) { s.usage.fallbacks++; return { ...fallbackRecap(s), source: 'fallback' }; }
  return { recap: res.recap, hook: res.hook, source: 'llm' };
}

export async function directorEpilogue(s: GameState): Promise<{ closing: string; characters: Record<string, string>; source: Source }> {
  const core = AGENTS.filter((a) => a.tier === 'core');
  const res = await ask<{ closing: string; characters: Record<string, string> }>(s, '/api/director/epilogue', {
    player: player(s), quizScore: s.quizScore,
    log: s.log.map((l) => `day ${l.day} ${fmtTime(l.minute)} ${l.text}`).slice(-40),
    characters: core.map((a) => ({ id: a.id, name: a.name, rel: s.agents[a.id].rel, note: s.agents[a.id].note })),
  });
  if (!res) { s.usage.fallbacks++; return { ...fallbackEpilogue(s), source: 'fallback' }; }
  return { closing: res.closing, characters: res.characters, source: 'llm' };
}
