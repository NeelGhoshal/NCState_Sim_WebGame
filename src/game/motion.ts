// Free movement for the player: walking with a small round body that slides along walls and
// eases round corners, and a car with simple bicycle steering. Pure TypeScript (no Phaser), so it
// is tested in Node. Positions are in tiles; a tile's centre is (x + 0.5, y + 0.5).
import { type GameMap, isSolid } from '../engine/types';

export interface Body { x: number; y: number }

/** Radius of the player's body, in tiles. Fits through a one-tile door. */
export const BODY_R = 0.28;

function blocked(map: GameMap, x: number, y: number, r: number): boolean {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isSolid(map, tx, ty)) return true;
  return false;
}

/**
 * Moves the body by (dx, dy) and returns the distance it actually moved. Each axis moves on its
 * own, so pushing into a wall at an angle slides along it. Pushing straight at a corner that
 * the body only just clips nudges it sideways into the opening, the way top-down games feel fair.
 */
export function moveBody(map: GameMap, b: Body, dx: number, dy: number, r = BODY_R): number {
  const x0 = b.x, y0 = b.y;
  const axis = (along: 'x' | 'y', d: number, pushing: boolean) => {
    if (!d) return;
    const nx = along === 'x' ? b.x + d : b.x, ny = along === 'y' ? b.y + d : b.y;
    if (!blocked(map, nx, ny, r)) { b.x = nx; b.y = ny; return; }
    // Up against the wall: close the gap exactly
    const p = along === 'x' ? b.x : b.y;
    const edge = d > 0 ? Math.floor(p + r + d) - r - 1e-4 : Math.floor(p - r + d) + 1 + r + 1e-4;
    if ((d > 0 && edge > p) || (d < 0 && edge < p)) {
      if (along === 'x') { if (!blocked(map, edge, b.y, r)) b.x = edge; } else if (!blocked(map, b.x, edge, r)) b.y = edge;
    }
    if (!pushing) return;
    // Corner assist: if the way ahead opens up once the body moves a little to one side
    // (it straddles two rows and only one is blocked), slide toward the open one
    const step = Math.abs(d);
    const side = along === 'x' ? 'y' : 'x';
    const q = side === 'x' ? b.x : b.y;
    for (const dir of [-1, 1]) {
      const shift = dir < 0 ? (q + r) - Math.floor(q + r) + 1e-3 : Math.ceil(q - r) - (q - r) + 1e-3;
      if (shift > 0.45 || shift <= 0) continue;
      const ax = along === 'x' ? b.x + d : b.x + (side === 'x' ? dir * shift : 0);
      const ay = along === 'y' ? b.y + d : b.y + (side === 'y' ? dir * shift : 0);
      if (blocked(map, ax, ay, r)) continue;
      const m = Math.min(step, shift);
      const tx = side === 'x' ? b.x + dir * m : b.x, ty = side === 'y' ? b.y + dir * m : b.y;
      if (!blocked(map, tx, ty, r)) { b.x = tx; b.y = ty; }
      return;
    }
  };
  axis('x', dx, dy === 0);
  axis('y', dy, dx === 0);
  return Math.hypot(b.x - x0, b.y - y0);
}

// ---------------------------------------------------------------- the car

export interface CarBody { x: number; y: number; angle: number; v: number; steer: number }
export const CAR = { len: 1.7, width: 0.9, maxV: 10, maxReverse: 3.5, accel: 6, brake: 14, coast: 2.5, wheelbase: 1.15, maxSteer: 0.6 };

/** Four corners and the nose of a car at (x, y, angle). */
export function carPoints(x: number, y: number, angle: number, len = CAR.len, width = CAR.width) {
  const c = Math.cos(angle), s = Math.sin(angle), hl = len / 2, hw = width / 2;
  return [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0]].map(([a, b]) => ({ x: x + a * c - b * s, y: y + a * s + b * c }));
}

/**
 * One frame of driving. `throttle` and `steer` are -1..1. The car only goes where `free` allows
 * (a tile test) and where `obstacle` does not object; running into either stops it with a small
 * bounce. Returns 'bump' on contact.
 */
export function stepCar(
  car: CarBody, throttle: number, steer: number, dt: number,
  free: (x: number, y: number) => boolean, obstacle: (pts: { x: number; y: number }[]) => boolean = () => false,
  solid: (x: number, y: number) => boolean = (x, y) => !free(x, y),
): 'ok' | 'bump' {
  // Steering eases toward the input; the wheel is stiffer at speed
  const want = steer * (1 - Math.min(0.45, Math.abs(car.v) / CAR.maxV * 0.45));
  car.steer += Math.max(-dt * 5, Math.min(dt * 5, want - car.steer));
  if (throttle > 0) car.v += (car.v < 0 ? CAR.brake : CAR.accel) * throttle * dt;
  else if (throttle < 0) car.v += (car.v > 0 ? CAR.brake : CAR.accel * 0.6) * throttle * dt;
  else car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), CAR.coast * dt);
  car.v = Math.max(-CAR.maxReverse, Math.min(CAR.maxV, car.v));
  if (Math.abs(car.v) < 1e-3) return 'ok';
  const angle = car.angle + (car.v / CAR.wheelbase) * Math.tan(car.steer * CAR.maxSteer) * dt;
  const x = car.x + Math.cos(angle) * car.v * dt, y = car.y + Math.sin(angle) * car.v * dt;
  // The car's spine (nose, middle, tail) must be on the street; the body may overhang the kerb,
  // which on a tile map is a staircase, but not into anything solid
  const body = carPoints(x, y, angle);
  const spine = [body[4], { x, y }, { x: 2 * x - body[4].x, y: 2 * y - body[4].y }];
  if (spine.some((p) => !free(Math.floor(p.x), Math.floor(p.y))) || body.some((p) => solid(Math.floor(p.x), Math.floor(p.y))) || obstacle(body)) {
    car.v = -car.v * 0.2;
    return 'bump';
  }
  car.x = x; car.y = y; car.angle = angle;
  return 'ok';
}

/** Ground a car may drive on: streets, parking, and the passages under the tracks. */
export function drivable(map: GameMap) {
  return (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
    const i = y * map.w + x, g = map.ground[i];
    return (g === 'road' || g === 'parking' || g === 'underpass') && !isSolid(map, x, y);
  };
}

/** True when every corner of the car is on a designated parking lot. */
export function onParkingLot(map: GameMap, car: { x: number; y: number; angle: number }) {
  return carPoints(car.x, car.y, car.angle).every((p) => map.ground[Math.floor(p.y) * map.w + Math.floor(p.x)] === 'parking');
}
