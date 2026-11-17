// The rumor network. Facts move between characters who spend time in the same place, and
// between characters and the player in conversation. Numbers decide who hears what; models
// only narrate it (a heard fact becomes a memory and something they may share).
//
// Rules:
//  - Every half hour, characters within SAME_PLACE tiles of each other on the same map may
//    pass on a fact the other does not know. Chance = fact.spread x teller.gossip, halved
//    for secrets. Chance is a stable hash of the moment, so a replay gives the same result.
//  - The player can tell a character a fact they learned. Spreading someone's secret is
//    remembered: the listener judges it (or enjoys it, if they like gossip), and if a copy
//    the player started reaches the secret's owner, the owner finds out and minds.
import { AGENTS, AGENT_BY_ID, FACTS } from '../data/agents';
import { MAPS } from '../maps/index';
import { agentWhere } from './schedule';
import type { GameState } from './state';
import { type Ev, type Result, addMemory, chance, changeRel, logEvent } from './util';

export const GOSSIP_EVERY = 30;   // minutes
export const SAME_PLACE = 16;     // tiles: a counter and the tables it serves, not the far end of a floor
export const SECRET_FACTOR = 0.5;
export const EXPOSED_REL = -8;

const first = (id: string) => AGENT_BY_ID[id].name.split(' ')[0];

export function knowsFact(s: GameState, agentId: string, factId: string): boolean {
  const f = FACTS[factId];
  return !!f && (f.owner === agentId || !!s.agents[agentId].heard[factId]);
}

/** Facts this character could tell: their own and what they have heard. */
export function factsKnownBy(s: GameState, agentId: string): string[] {
  return Object.keys(FACTS).filter((id) => knowsFact(s, agentId, id));
}

/** Where a character is, as a map and tile, or null when offscreen. */
export function placeOf(agentId: string, day: number, minute: number): { mapId: string; x: number; y: number } | null {
  const w = agentWhere(AGENT_BY_ID[agentId], day, minute);
  if (!w?.entry.mapId || !w.entry.spot) return null;
  const p = MAPS[w.entry.mapId]?.spots[w.entry.spot];
  return p ? { mapId: w.entry.mapId, x: p.x, y: p.y } : null;
}

export function together(a: string, b: string, day: number, minute: number): boolean {
  const pa = placeOf(a, day, minute), pb = placeOf(b, day, minute);
  return !!pa && !!pb && pa.mapId === pb.mapId && Math.max(Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y)) <= SAME_PLACE;
}

function hear(s: GameState, to: string, factId: string, from: string, origin: string) {
  s.agents[to].heard[factId] = { from, origin, day: s.day, minute: s.minute };
  s.rumors.push({ fact: factId, from, to, day: s.day, minute: s.minute, kind: 'told' });
  const f = FACTS[factId];
  const who = from === 'player' ? s.setup.name : first(from);
  addMemory(s, to, `${who} told me: ${f.text}`, f.secret ? 5 : 3);
}

/** The owner learns the player spread their secret. Happens once per fact. */
function expose(s: GameState, factId: string, via: string, evs: Ev[]) {
  const f = FACTS[factId];
  const owner = f.owner;
  if (s.rumors.some((r) => r.kind === 'exposed' && r.fact === factId)) return;
  s.rumors.push({ fact: factId, from: via, to: owner, day: s.day, minute: s.minute, kind: 'exposed' });
  changeRel(s, owner, EXPOSED_REL);
  addMemory(s, owner, `${first(via)} mentioned that ${s.setup.name} has been telling people about ${f.topic ?? 'something I said in private'}.`, 8);
  const body = `${first(via).toLowerCase()} mentioned you've been telling people about ${f.topic ?? 'what I told you'}. not cool.`;
  s.texts.push({ from: owner, day: s.day, minute: s.minute, body, read: false });
  evs.push({ kind: 'text', text: `${AGENT_BY_ID[owner].name}: ${body}` });
  logEvent(s, `${AGENT_BY_ID[owner].name} found out you spread ${f.topic ?? 'their secret'}`);
}

/** Runs on the half hour from the engine's clock. */
export function gossipTick(s: GameState, evs: Ev[]) {
  if (s.minute % GOSSIP_EVERY !== 0) return;
  for (const teller of AGENTS) {
    for (const listener of AGENTS) {
      if (teller.id === listener.id || !together(teller.id, listener.id, s.day, s.minute)) continue;
      for (const factId of factsKnownBy(s, teller.id)) {
        const f = FACTS[factId];
        const heard = s.agents[teller.id].heard[factId];
        const roll = chance(s.day, s.minute, teller.id, listener.id, factId);
        if (listener.id === f.owner) {
          // A copy the player started has come home.
          if (f.secret && heard?.origin === 'player' && roll < teller.gossip) expose(s, factId, teller.id, evs);
          continue;
        }
        if (knowsFact(s, listener.id, factId)) continue;
        const p = (f.spread ?? 0.5) * teller.gossip * (f.secret ? SECRET_FACTOR : 1);
        if (roll < p) hear(s, listener.id, factId, teller.id, heard?.origin ?? f.owner);
      }
    }
  }
}

/** Facts the player could tell this character. */
export function tellable(s: GameState, agentId: string): string[] {
  return s.knownFacts.filter((id) => FACTS[id] && !knowsFact(s, agentId, id));
}

/**
 * The player tells a character something. Costs nothing by itself: it happens inside an
 * exchange the caller already paid for. Returns notes for the conversation.
 */
export function tellFact(s: GameState, agentId: string, factId: string): Result {
  const f = FACTS[factId];
  if (!f || !s.knownFacts.includes(factId)) return { ok: false, msg: 'You do not know that.', events: [] };
  if (knowsFact(s, agentId, factId)) return { ok: false, msg: `${first(agentId)} already knows.`, events: [] };
  hear(s, agentId, factId, 'player', 'player');
  const listener = AGENT_BY_ID[agentId];
  let msg = `You told ${first(agentId)}.`;
  if (f.secret) {
    // Someone else's secret: gossips enjoy it, the rest think less of you for it.
    const likes = listener.gossip >= 0.5;
    changeRel(s, agentId, likes ? 1 : -2);
    addMemory(s, agentId, `${s.setup.name} passed on something ${first(f.owner)} said in private.`, likes ? 4 : 6);
    msg += likes ? ` ${first(agentId)} leans in.` : ` ${first(agentId)} looks uneasy about hearing it.`;
  } else {
    changeRel(s, agentId, 1);
  }
  logEvent(s, `Told ${listener.name}: ${f.text}`);
  return { ok: true, msg, events: [] };
}

/** The player learned a fact from a character (share_info). */
export function learnFact(s: GameState, agentId: string, factId: string) {
  if (!s.knownFacts.includes(factId)) s.knownFacts.push(factId);
  s.rumors.push({ fact: factId, from: agentId, to: 'player', day: s.day, minute: s.minute, kind: 'told' });
}

/** How a fact reads in a prompt for a character who might tell it. */
export function factForPrompt(s: GameState, agentId: string, factId: string): string {
  const f = FACTS[factId];
  const heard = s.agents[agentId].heard[factId];
  if (!heard) return f.text;
  const who = heard.from === 'player' ? s.setup.name : AGENT_BY_ID[heard.from].name;
  return `${f.text} (heard from ${who}${f.secret ? `; ${first(f.owner)} said it in private` : ''})`;
}
