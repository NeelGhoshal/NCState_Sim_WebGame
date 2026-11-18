// "Go to…": pick a destination and the scene plans a walking route to it, draws it on the map
// and walks it for you. Pure presentation: choosing an objective changes nothing in GameState.
import { ctx, bus } from '../core';
import { AGENTS } from '../data/agents';
import { agentHere } from '../engine/engine';
import type { GameMap } from '../engine/types';
import { MAPS } from '../maps/index';
import { menu } from './dom';

export interface Objective {
  label: string;
  mapId: string;
  /** The area to reach (tiles). Arriving means standing next to it. */
  x: number; y: number; w: number; h: number;
}

const KINDS: Record<string, number> = { class: 0, study: 1, venue: 2, sleep: 3, bus: 6, tunnel: 7, wolfears: 8 };

/** Destinations on a map: places you can use there, and the people on it now. */
export function objectivesOn(map: GameMap): Objective[] {
  const s = ctx.state!;
  const out: (Objective & { order: number })[] = [];
  for (const it of map.interactables) {
    const order = KINDS[it.kind];
    if (order === undefined && map.outdoor) continue;
    const label = it.kind === 'sleep' ? 'Your room (Tucker Hall)' : it.label;
    out.push({ label, mapId: map.id, x: it.x, y: it.y, w: it.w, h: it.h, order: order ?? 5 });
  }
  if (map.id === 'campus') {
    // Talley: its north door, which leads inside
    const door = map.portals.find((p) => p.toMap.startsWith('talley'));
    if (door) out.push({ label: 'Talley Student Union', mapId: map.id, x: door.x, y: door.y, w: 1, h: 1, order: 4 });
    for (const [spot, label] of [['c.brickyard', 'The Brickyard'], ['c.rec', 'Carmichael (rec)']] as const) {
      const p = map.spots[spot];
      if (p) out.push({ label, mapId: map.id, x: p.x, y: p.y, w: 1, h: 1, order: 8 });
    }
    out.push({ label: 'Your car', mapId: map.id, x: Math.floor(s.car.x - 1), y: Math.floor(s.car.y), w: 2, h: 1, order: 5 });
  }
  for (const def of AGENTS) {
    const here = s.mapId === map.id ? agentHere(s, def.id) : null;
    if (here) out.push({ label: `Find ${def.name}`, mapId: map.id, x: here.pos.x, y: here.pos.y, w: 1, h: 1, order: 9 });
  }
  return out.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/** Opens the picker. `current` is the active objective, if any, so it can be cleared. */
export function openObjectives(current: Objective | null) {
  const s = ctx.state;
  if (!s) return;
  const here = MAPS[s.mapId];
  const list = objectivesOn(here);
  // Inside a building, campus places are still reachable: the route leads out first
  if (s.mapId !== 'campus') list.push(...objectivesOn(MAPS.campus).filter((o) => !o.label.startsWith('Find ')));
  const opts = list.map((o) => ({
    label: o.label,
    detail: o.mapId !== s.mapId ? 'on campus' : '',
    onClick: () => bus.emit('objective', o),
  }));
  if (current) opts.unshift({ label: `Stop going to ${current.label}`, detail: 'clears the route', onClick: () => bus.emit('objective', null) });
  menu('Go to…', 'Pick a destination. A route is drawn on the map and you walk it automatically; press any movement key to take over, G to resume.', opts);
}
