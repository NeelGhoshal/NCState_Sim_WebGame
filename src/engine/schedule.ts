import type { AgentDef, SchedEntry } from '../data/agents';

export interface Where { entry: SchedEntry; endsAt: number }

/** The schedule entry an agent is in at a given time. Day-specific entries win. */
export function agentWhere(def: AgentDef, day: number, minute: number): Where | null {
  let best: SchedEntry | null = null;
  for (const e of def.schedule) {
    if (e.days && !e.days.includes(day)) continue;
    if (minute < e.from || minute >= e.to) continue;
    if (!best || (e.days && !best.days)) best = e;
  }
  if (!best) return null;
  // A day-specific entry can cut an everyday one short.
  let endsAt = best.to;
  if (!best.days) {
    for (const e of def.schedule) {
      if (e.days?.includes(day) && e.from > minute && e.from < endsAt) endsAt = e.from;
    }
  }
  return { entry: best, endsAt };
}
