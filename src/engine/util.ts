// Small helpers shared by the engine modules. Pure TypeScript.
import type { GameState } from './state';

export interface Ev { kind: 'toast' | 'text' | 'feed' | 'invite' | 'passout' | 'bucket' | 'rumor'; text: string }
export interface Result { ok: boolean; msg: string; events: Ev[] }

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function logEvent(s: GameState, text: string) { s.log.push({ day: s.day, minute: s.minute, text }); }

export function changeRel(s: GameState, id: string, delta: number) {
  const a = s.agents[id];
  a.rel = clamp(Math.round(a.rel + delta), 0, 100);
}

export function addMemory(s: GameState, id: string, text: string, importance: number) {
  const mem = s.agents[id].memories;
  mem.push({ day: s.day, minute: s.minute, text: text.slice(0, 240), importance: clamp(Math.round(importance), 1, 10) });
  while (mem.length > 40) {
    let drop = 0;
    for (let i = 1; i < mem.length; i++) if (mem[i].importance < mem[drop].importance) drop = i;
    mem.splice(drop, 1);
  }
}

/** A stable number in [0, 1) from any strings. The engine's only source of chance, so replays match. */
export function chance(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
