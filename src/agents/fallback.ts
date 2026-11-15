// Scripted behavior used when no model is configured, a call fails, or output is invalid.
import { AGENT_BY_ID, ALL_INVITES, INVITE_OWNER } from '../data/agents';
import { type AgentTurn, type Allowed, type Reflection, fmtTime } from '../engine/engine';
import type { GameState } from '../engine/state';

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

function seedOf(s: GameState, extra: string) {
  let h = s.day * 1009 + s.minute;
  for (const c of extra) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

export function fallbackTurn(s: GameState, agentId: string, allowed: Allowed, exchange: number, playerText: string): AgentTurn {
  const def = AGENT_BY_ID[agentId];
  const seed = seedOf(s, agentId + playerText);
  const turn: AgentTurn = {
    say: pick(def.lines, seed + exchange), action: 'none', action_arg: '',
    relationship_delta: 1, replies: def.replies.slice(), memory: '',
  };
  const lower = playerText.toLowerCase();
  if (/\b(bye|later|gotta go|see you)\b/.test(lower)) {
    turn.say = pick(def.leave, seed); turn.action = 'end_conversation'; turn.relationship_delta = 0;
    return turn;
  }
  if (allowed.argsFor.invite && exchange >= 1) {
    const inv = ALL_INVITES.find((i) => i.id === allowed.argsFor.invite[0])!;
    turn.say = `Hey, are you free at ${fmtTime(inv.from)}? ${inv.label}. You should come.`;
    turn.action = 'invite'; turn.action_arg = inv.id;
    turn.memory = `I invited the player to ${inv.label}.`;
  } else if (allowed.argsFor.give && exchange >= 1) {
    turn.say = 'Here, on the house. Do not tell my manager.';
    turn.action = 'give'; turn.action_arg = allowed.argsFor.give[0];
  } else if (allowed.argsFor.share_info && (exchange >= 2 || /\b(tip|know|where|how|what)\b/.test(lower))) {
    const fact = def.facts.find((f) => f.id === allowed.argsFor.share_info[0])!;
    turn.say = `Oh, here is something: ${fact.text}`;
    turn.action = 'share_info'; turn.action_arg = fact.id;
  }
  if (playerText) turn.memory ||= `The player said: "${playerText.slice(0, 80)}"`;
  return turn;
}

export function fallbackGreeting(s: GameState, agentId: string): string {
  const def = AGENT_BY_ID[agentId];
  const a = s.agents[agentId];
  const missed = Object.entries(s.invites).find(([id, st]) => INVITE_OWNER[id] === agentId && st.status === 'missed');
  if (missed && a.rel < 50) return `Oh. Hey. ${a.rel < 40 ? 'Did not expect to see you.' : 'You around now?'}`;
  return pick(def.greet, seedOf(s, agentId));
}

export function fallbackReflection(s: GameState, agentId: string): Reflection {
  const def = AGENT_BY_ID[agentId];
  const a = s.agents[agentId];
  const today = a.memories.filter((m) => m.day === s.day);
  const top = today.slice().sort((x, y) => y.importance - x.importance)[0];
  return {
    summary: top ? `Day ${s.day}: ${top.text}` : '',
    importance: top ? Math.max(4, top.importance) : 3,
    note: a.rel >= 60 ? 'Someone I am starting to count on.' : a.rel <= 35 ? 'Not sure about them.' : a.note,
    goal: def.dayGoals[Math.min(s.day, def.dayGoals.length - 1)],
    text: def.morningTexts[s.day + 1] ?? '',
  };
}

export function fallbackRecap(s: GameState): { recap: string; hook: string } {
  const prev = s.log.filter((l) => l.day === s.day - 1).map((l) => l.text);
  const highlights = prev.filter((t) => /Went to|Missed|Met|Said yes|Turned down|quiz|Painted|Crashed/i.test(t)).slice(0, 4);
  const recap = highlights.length
    ? `Previously: ${highlights.join('. ')}.`
    : 'Previously: a quiet day. You kept to yourself, and campus kept moving without you.';
  const hooks: Record<number, string> = {
    2: 'Today, someone wants to share a meal, and someone else wants to win.',
    3: 'Today is quiz day. Whatever you studied is what you have.',
  };
  return { recap, hook: hooks[s.day] ?? '' };
}

export function fallbackEpilogue(s: GameState): { closing: string; characters: Record<string, string> } {
  const attended = Object.values(s.invites).filter((i) => i.status === 'attended').length;
  const missed = Object.values(s.invites).filter((i) => i.status === 'missed').length;
  const quiz = s.quizScore === null ? 'skipped the quiz' : `scored ${s.quizScore} on the quiz`;
  const closing = `Three days in. You ${quiz}, showed up for ${attended} invitation${attended === 1 ? '' : 's'} and missed ${missed}. `
    + (attended > missed ? 'People are starting to save you a seat.' : 'Campus is big, and it is easy to drift through it alone.');
  const characters: Record<string, string> = {};
  for (const [id, a] of Object.entries(s.agents)) {
    if (AGENT_BY_ID[id].tier !== 'core') continue;
    const first = AGENT_BY_ID[id].name.split(' ')[0];
    characters[id] = a.rel >= 60 ? `${first} counts you as a friend.` : a.rel >= 45 ? `${first} is still making up their mind about you.` : `${first} has mostly written you off, for now.`;
  }
  return { closing, characters };
}
