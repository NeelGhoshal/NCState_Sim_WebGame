// Which memories a character brings to a conversation. Replaces "the last eight": each
// memory is scored by how important it was, how recent it is and how much it has to do with
// what is being said, and the best few are returned in the order they happened.
import type { Memory } from './state';

export const RECALL = { importance: 1.5, recency: 1.0, relevance: 1.5, halfLifeHours: 12 };

const STOP = new Set('a an and are as at be but by for from has have i if in is it me my of on or so that the this to was we were what with you your yeah ok okay hey hi just like really'.split(' '));

export function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9']+/g)?.map((w) => w.replace(/'s$|s$/, '')).filter((w) => w.length > 2 && !STOP.has(w)) ?? []);
}

/** Minutes since the start of day 1, for comparing memories across days. */
const stamp = (day: number, minute: number) => day * 1440 + minute;

export function scoreMemory(m: Memory, query: Set<string>, now: { day: number; minute: number }): number {
  const hours = Math.max(0, stamp(now.day, now.minute) - stamp(m.day, m.minute)) / 60;
  const recency = Math.pow(0.5, hours / RECALL.halfLifeHours);
  let relevance = 0;
  if (query.size) {
    const mw = words(m.text);
    let hit = 0;
    for (const w of query) if (mw.has(w)) hit++;
    relevance = hit / query.size;
  }
  return RECALL.importance * (m.importance / 10) + RECALL.recency * recency + RECALL.relevance * relevance;
}

export function recallMemories(memories: Memory[], query: string, now: { day: number; minute: number }, n = 8): Memory[] {
  if (memories.length <= n) return memories.slice();
  const q = words(query);
  const best = memories
    .map((m, i) => ({ m, i, score: scoreMemory(m, q, now) }))
    .sort((a, b) => b.score - a.score || b.i - a.i)
    .slice(0, n);
  return best.sort((a, b) => a.i - b.i).map((x) => x.m);
}
