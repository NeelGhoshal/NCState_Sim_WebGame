import { describe, it, expect } from 'vitest';
import { MAPS } from '../src/maps/index';
import { AGENTS, ALL_INVITES } from '../src/data/agents';
import { VENUES } from '../src/data/venues';
import { BUS_STOPS } from '../src/maps/campus';
import { N } from '../src/data/names';
import { reachable } from '../src/engine/grid';
import { isSolid, type GameMap } from '../src/engine/types';

const maps = Object.values(MAPS);
const key = (m: GameMap, x: number, y: number) => y * m.w + x;

/** Tiles reachable from the campus spawn, following portals across maps. */
function worldReach(): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const queue: [string, number, number][] = [['campus', MAPS.campus.spawn.x, MAPS.campus.spawn.y]];
  while (queue.length) {
    const [id, x, y] = queue.shift()!;
    const m = MAPS[id];
    if (out.get(id)?.has(key(m, x, y))) continue;
    const r = reachable(m, { x, y });
    out.set(id, new Set([...(out.get(id) ?? []), ...r]));
    for (const p of m.portals) if (r.has(key(m, p.x, p.y))) queue.push([p.toMap, p.tx, p.ty]);
  }
  return out;
}
const reach = worldReach();

function nearReachable(m: GameMap, x: number, y: number, w = 1, h = 1, range = 1) {
  const r = reach.get(m.id)!;
  for (let yy = y - range; yy < y + h + range; yy++) for (let xx = x - range; xx < x + w + range; xx++) {
    if (xx >= 0 && yy >= 0 && xx < m.w && yy < m.h && r.has(key(m, xx, yy))) return true;
  }
  return false;
}

describe('maps', () => {
  it('every map is reachable on foot from the campus spawn', () => {
    for (const m of maps) expect(reach.has(m.id), m.id).toBe(true);
  });

  for (const m of maps) {
    describe(m.id, () => {
      it('spawn is walkable', () => expect(isSolid(m, m.spawn.x, m.spawn.y)).toBe(false));

      it('portals lead to walkable, non-portal tiles', () => {
        for (const p of m.portals) {
          const t = MAPS[p.toMap];
          expect(t, `${m.id} portal to ${p.toMap}`).toBeDefined();
          expect(isSolid(t, p.tx, p.ty), `${p.toMap} (${p.tx},${p.ty})`).toBe(false);
          expect(t.portals.some((q) => q.x === p.tx && q.y === p.ty), `arrival on a portal at ${p.toMap} (${p.tx},${p.ty})`).toBe(false);
        }
      });

      it('every interactable can be reached', () => {
        for (const it of m.interactables) expect(nearReachable(m, it.x, it.y, it.w, it.h), it.id).toBe(true);
      });

      it('every venue referenced exists', () => {
        for (const it of m.interactables.filter((i) => i.kind === 'venue')) expect(VENUES[it.ref!], it.ref).toBeDefined();
      });

      it('spots are walkable and close enough to talk to', () => {
        for (const [name, p] of Object.entries(m.spots)) {
          expect(isSolid(m, p.x, p.y), `${name} solid`).toBe(false);
          expect(nearReachable(m, p.x, p.y, 1, 1, 2), `${name} unreachable`).toBe(true);
        }
      });
    });
  }

  it('every agent schedule spot and invite spot exists', () => {
    for (const a of AGENTS) for (const e of a.schedule) {
      if (!e.mapId) continue;
      expect(MAPS[e.mapId], `${a.id} map ${e.mapId}`).toBeDefined();
      expect(MAPS[e.mapId].spots[e.spot!], `${a.id} spot ${e.spot}`).toBeDefined();
    }
    for (const i of ALL_INVITES) expect(MAPS[i.mapId].spots[i.spot], `${i.id} spot`).toBeDefined();
  });

  it('bus stops are walkable', () => {
    for (const s of Object.values(BUS_STOPS)) expect(isSolid(MAPS.campus, s.x, s.y)).toBe(false);
  });

  it('campus has the major buildings from OpenStreetMap', () => {
    const names = new Set(MAPS.campus.buildings.map((b) => b.name));
    const B = N.bldg;
    for (const n of [B.talley, B.witherspoon, B.reynolds, B.carmichael, B.dhhill, B.belltower, B.holladay, B.b1911,
      B.tompkins, B.caldwell, B.winston, B.page, B.leazar, B.cox, B.dabney, B.poe, B.thompson, B.health, B.deck,
      B.fountain, B.clark, B.tucker, B.owen, B.bowen, B.metcalf, B.carroll, B.bragaw,
      'Riddick Hall', 'Mann Hall', 'Withers Hall', 'Nelson Hall', 'SAS Hall', 'Harris Hall', 'Price Music Center',
      'Case Academic Center', 'Lee Hall', 'Sullivan Hall', 'Syme Hall', 'Gold Hall', 'Welch Hall', 'Bagwell Hall',
      'Becton Hall', 'Berry Hall', 'Marye Anne Fox Science Teaching Laboratory', 'Jordan Hall', 'Biltmore Hall']) {
      expect(names.has(n), n).toBe(true);
    }
    expect(MAPS.campus.buildings.filter((b) => b.name && b.style !== 'shop').length).toBeGreaterThan(120);
  });
});
