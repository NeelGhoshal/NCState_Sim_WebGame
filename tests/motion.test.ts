import { describe, it, expect } from 'vitest';
import { MapBuilder } from '../src/engine/mapBuilder';
import { MAPS } from '../src/maps/index';
import { CAR_START, BUS_STOPS } from '../src/maps/campus';
import { findRoute, smoothRoute, walkCost } from '../src/engine/grid';
import { isSolid, type GameMap } from '../src/engine/types';
import { BODY_R, CAR, carPoints, drivable, moveBody, onParkingLot, stepCar, type CarBody } from '../src/game/motion';

/** A 12x12 room: floor inside a wall, with a one-tile door in a wall across the middle. */
function room(): GameMap {
  const b = new MapBuilder('t', 'Test', 12, 12, 'floor', { outdoor: false, secPerMinute: 1, crowd: 0, spawn: { x: 2, y: 2 } });
  b.outline(0, 0, 12, 12, 'wall');
  for (let x = 1; x < 11; x++) if (x !== 6) b.set(x, 6, 'wall');
  return b.build();
}

describe('walking', () => {
  it('stops flush against a wall and never overlaps it', () => {
    const m = room(), body = { x: 3.5, y: 4.5 };
    for (let i = 0; i < 60; i++) moveBody(m, body, 0, 0.1);
    expect(body.y + BODY_R).toBeLessThanOrEqual(6);
    expect(body.y + BODY_R).toBeGreaterThan(5.98);
  });

  it('slides along a wall when pushed into it at an angle', () => {
    const m = room(), body = { x: 3.5, y: 5.6 };
    const x0 = body.x;
    for (let i = 0; i < 10; i++) moveBody(m, body, 0.07, 0.07);
    expect(body.x).toBeGreaterThan(x0 + 0.6);
    expect(body.y + BODY_R).toBeLessThanOrEqual(6);
  });

  it('eases through a one-tile door even when not lined up with it', () => {
    const m = room(), body = { x: 6.2, y: 4.5 }; // door column is x 6..7, centre 6.5
    for (let i = 0; i < 80; i++) moveBody(m, body, 0, 0.1);
    expect(body.y).toBeGreaterThan(7);
    for (let y = Math.floor(body.y - BODY_R); y <= Math.floor(body.y + BODY_R); y++) {
      for (let x = Math.floor(body.x - BODY_R); x <= Math.floor(body.x + BODY_R); x++) expect(isSolid(m, x, y)).toBe(false);
    }
  });
});

describe('routes', () => {
  const m = MAPS.campus;
  const cost = walkCost(m, m.roads!.crossTile);
  const from = m.spawn, to = { x: BUS_STOPS.belltower.x, y: BUS_STOPS.belltower.y };

  it('finds a walking route across campus that keeps mostly off the streets', () => {
    const path = findRoute(m, from, to, cost)!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toEqual(to);
    const onRoad = path.filter((p) => m.ground[p.y * m.w + p.x] === 'road' && !m.roads!.crossTile.has(p.y * m.w + p.x)).length;
    expect(onRoad / path.length).toBeLessThan(0.15);
    for (const p of path) expect(isSolid(m, p.x, p.y)).toBe(false);
  });

  it('smooths the route into far fewer waypoints that are each walkable in a straight line', () => {
    const path = findRoute(m, from, to, cost)!;
    const pts = smoothRoute(m, from, path, cost);
    expect(pts.length).toBeLessThan(path.length / 3);
    let a = { x: from.x + 0.5, y: from.y + 0.5 };
    for (const b of pts) {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2);
      for (let k = 0; k <= n; k++) expect(isSolid(m, Math.floor(a.x + ((b.x - a.x) * k) / n), Math.floor(a.y + ((b.y - a.y) * k) / n))).toBe(false);
      a = b;
    }
  });
});

describe('driving', () => {
  const m = MAPS.campus;
  const free = drivable(m);

  it('your car starts on a parking lot, and the lot connects to the streets', () => {
    expect(onParkingLot(m, CAR_START)).toBe(true);
    // Flood the drivable ground from the car and reach the street network (a bus stop's kerb)
    const seen = new Set<number>(), q = [Math.floor(CAR_START.y) * m.w + Math.floor(CAR_START.x)];
    seen.add(q[0]);
    for (let i = 0; i < q.length; i++) {
      const x = q[i] % m.w, y = (q[i] - x) / m.w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = (y + dy) * m.w + x + dx;
        if (!seen.has(k) && free(x + dx, y + dy)) { seen.add(k); q.push(k); }
      }
    }
    const at = BUS_STOPS.talley.at;
    expect(seen.has(Math.floor(at.y) * m.w + Math.floor(at.x))).toBe(true);
  });

  it('accelerates, steers, and stays on drivable ground', () => {
    const car: CarBody = { ...CAR_START, v: 0, steer: 0 };
    let bumps = 0;
    for (let i = 0; i < 600; i++) {
      if (stepCar(car, 1, i % 120 < 60 ? 1 : -1, 1 / 60, free, undefined, (x, y) => isSolid(m, x, y)) === 'bump') bumps++;
      const body = carPoints(car.x, car.y, car.angle);
      // The middle and nose stay on drivable ground; no part of the car is ever inside anything solid
      expect(free(Math.floor(car.x), Math.floor(car.y))).toBe(true);
      expect(free(Math.floor(body[4].x), Math.floor(body[4].y))).toBe(true);
      for (const p of body) expect(isSolid(m, Math.floor(p.x), Math.floor(p.y))).toBe(false);
    }
    expect(Math.abs(car.v)).toBeLessThanOrEqual(CAR.maxV);
    expect(bumps).toBeGreaterThan(0); // the lot is small: it ran into its edge and stopped
  });

  it('stops for an obstacle instead of driving into it', () => {
    const car: CarBody = { ...CAR_START, v: 0, steer: 0 };
    const res = stepCar(car, 1, 0, 0.5, free, () => true);
    expect(res).toBe('bump');
    expect(car.x).toBe(CAR_START.x);
  });
});
