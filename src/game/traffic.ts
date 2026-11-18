// Cars, the Wolfline bus and traffic signals on a RoadNet. Pure TypeScript (no Phaser, no DOM)
// so it runs in tests. This is presentation, not game state: nothing here changes time, money or
// meters. The scene reads vehicle positions to draw them and asks the engine to apply the
// consequences (riding the bus, being clipped by a car).
//
// Only cars near the camera are simulated: they spawn just outside the view and are dropped
// once they leave the area around it, so the cost depends on what is on screen, not on the map.
import { type RoadNet, type RouteStep, pointOnEdge } from '../engine/roads';
import type { Pt } from '../engine/types';

// ---------------------------------------------------------------- signals

/** Seconds in one signal cycle. Main street: green 0-12, yellow 12-15; side streets: green 16-26, yellow 26-29. */
export const CYCLE = 30;
export type Light = 'green' | 'yellow' | 'red';

const phase = (net: RoadNet, sig: number, t: number) => {
  const u = (t + net.signals[sig].offset) % CYCLE;
  return u < 0 ? u + CYCLE : u;
};

export function carLight(net: RoadNet, sig: number, main: boolean, t: number): Light {
  const u = phase(net, sig, t);
  if (main) return u < 12 ? 'green' : u < 15 ? 'yellow' : 'red';
  return u >= 16 && u < 26 ? 'green' : u >= 26 && u < 29 ? 'yellow' : 'red';
}

/**
 * The walk signal for a crossing. Walkers go while the street they cross has red, starting two
 * seconds after it turns red so late cars have cleared: WALK, then a flashing countdown, then a
 * steady DON'T WALK before cars get the green. `count` is the seconds left on the countdown.
 */
export function walkLight(net: RoadNet, sig: number, overMain: boolean, t: number): { walk: boolean; count: number } {
  const u = phase(net, sig, t);
  // Over the main street: its red runs 15-30. Over a side street: its red runs 29-46 (wrapping).
  const r = ((overMain ? u - 17 : u - 1) + CYCLE) % CYCLE;
  if (r < 7) return { walk: true, count: 0 };
  if (r < 11) return { walk: false, count: Math.ceil(11 - r) };
  return { walk: false, count: 0 };
}

// ---------------------------------------------------------------- vehicles

export type BusStep = RouteStep;

export interface Vehicle {
  id: number;
  kind: 'car' | 'bus';
  edge: number; dir: 1 | -1;
  /** Distance along the edge in the direction of travel (centre of the vehicle). */
  s: number;
  v: number; vmax: number;
  len: number; width: number;
  next: { edge: number; dir: 1 | -1 } | null;
  /** Drawn position (tiles) and heading (radians). */
  x: number; y: number; angle: number;
  braking: boolean;
  color: number;
  /** Unsignalized junction this vehicle holds, or -1. */
  claim: number;
  wait: number;
  /** Bus only: its loop, where it is on it, and how long it has left at a stop. */
  route?: BusStep[]; step?: number; dwell?: number; at?: string;
}

const ACCEL = 6;          // tiles/s²
const BRAKE = 8;          // comfortable braking, used to plan stops
const MAX_BRAKE = 16;     // the hardest a car can brake
const MIN_GAP = 0.7;      // tiles between bumpers when queued
const DWELL = 4;          // seconds at each bus stop
export const CAR_COLORS = 8;

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }
const inside = (r: Rect, x: number, y: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;

export class Traffic {
  vehicles: Vehicle[] = [];
  /** Seconds of signal time; drives every light. */
  clock = 0;
  private nextId = 1;
  private rand: () => number;
  private claims: Int32Array;
  private boxes: Rect[];
  private lanes = new Map<number, Vehicle[]>();
  private densityAt = -1;
  private target = 0;
  /** Edges in the area around the camera, where new cars can start. */
  private near: number[] = [];
  /** Crosswalks by 16-tile cell, so each vehicle only looks at the ones around it. */
  private crossCells = new Map<number, number[]>();
  private warm = true;

  constructor(public net: RoadNet, seed = 7) {
    this.rand = mulberry(seed);
    this.claims = new Int32Array(net.nodes.length).fill(-1);
    net.crossings.forEach((k, i) => {
      const key = this.cell((k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2);
      if (!this.crossCells.has(key)) this.crossCells.set(key, []);
      this.crossCells.get(key)!.push(i);
    });
    this.boxes = net.edges.map((e) => {
      const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (let i = 0; i < e.p.length; i += 2) {
        b.x0 = Math.min(b.x0, e.p[i]); b.x1 = Math.max(b.x1, e.p[i]);
        b.y0 = Math.min(b.y0, e.p[i + 1]); b.y1 = Math.max(b.y1, e.p[i + 1]);
      }
      return b;
    });
  }

  private cell(x: number, y: number) { return Math.floor(y / 16) * 4096 + Math.floor(x / 16); }

  get buses() { return this.vehicles.filter((v) => v.kind === 'bus'); }

  /** Drops every car (not the buses) and lets the next update fill the view again. */
  reset() {
    for (const v of this.vehicles) if (v.kind === 'car') this.release(v);
    this.vehicles = this.vehicles.filter((v) => v.kind === 'bus');
    this.warm = true;
  }

  /** Adds a bus at the start of route step `step`. */
  addBus(route: BusStep[], step = 0): Vehicle {
    const st = route[step];
    const v: Vehicle = {
      id: this.nextId++, kind: 'bus', edge: st.edge, dir: st.dir, s: st.s0, v: 0, vmax: 9.5, len: 2.8, width: 1.05,
      next: null, x: 0, y: 0, angle: 0, braking: false, color: 0, claim: -1, wait: 0, route, step, dwell: 0,
    };
    this.place(v, true);
    this.vehicles.push(v);
    return v;
  }

  removeBuses() {
    for (const v of this.vehicles) if (v.kind === 'bus') this.release(v);
    this.vehicles = this.vehicles.filter((v) => v.kind === 'car');
  }

  /**
   * One frame. `view` is the camera in tiles; cars live in the area around it. `peds` are people
   * standing on the road (tile centres). `busy` scales how many cars there are (0 to 1).
   */
  update(dt: number, view: Rect | null, peds: Pt[], busy: number) {
    this.clock += dt;
    if (view) this.populate(view, busy); else this.reset();
    this.buildLanes();
    for (const v of this.vehicles) this.drive(v, dt, peds);
    if (view) {
      const far = { x0: view.x0 - 28, y0: view.y0 - 28, x1: view.x1 + 28, y1: view.y1 + 28 };
      this.vehicles = this.vehicles.filter((v) => {
        if (v.kind === 'bus' || inside(far, v.x, v.y)) return true;
        this.release(v);
        return false;
      });
    }
  }

  /** Whether vehicle v overlaps a person at p (tile centre coordinates). */
  touches(v: Vehicle, p: Pt, pad = 0.15) {
    const dx = p.x - v.x, dy = p.y - v.y, c = Math.cos(v.angle), s = Math.sin(v.angle);
    return Math.abs(dx * c + dy * s) < v.len / 2 + pad && Math.abs(-dx * s + dy * c) < v.width / 2 + pad;
  }

  /** Seconds until `bus` next stops at `stop` (0 while it is standing there). */
  eta(bus: Vehicle, stop: string): number {
    const r = bus.route!;
    if (bus.dwell! > 0 && bus.at === stop) return 0;
    let dist = r[bus.step!].s1 - bus.s, stops = 0;
    for (let k = 0; k < r.length; k++) {
      const st = r[(bus.step! + k) % r.length];
      if (k > 0) dist += st.s1 - st.s0;
      if (st.stop === stop) return dist / (bus.vmax * 0.7) + stops * DWELL;
      if (st.stop) stops++;
    }
    return Infinity;
  }

  // ------------------------------------------------------------ internals

  private release(v: Vehicle) {
    if (v.claim >= 0 && this.claims[v.claim] === v.id) this.claims[v.claim] = -1;
    v.claim = -1;
  }

  private buildLanes() {
    for (const l of this.lanes.values()) l.length = 0;
    for (const v of this.vehicles) {
      const k = v.edge * 2 + (v.dir > 0 ? 1 : 0);
      let l = this.lanes.get(k);
      if (!l) { l = []; this.lanes.set(k, l); }
      l.push(v);
    }
    for (const l of this.lanes.values()) if (l.length > 1) l.sort((a, b) => a.s - b.s);
  }

  private laneKey(v: Vehicle) { return v.edge * 2 + (v.dir > 0 ? 1 : 0); }

  /** Keeps the lane lists right when a vehicle moves to another edge mid-frame. */
  private relane(v: Vehicle, oldKey: number) {
    const k = this.laneKey(v);
    if (k === oldKey) return;
    const old = this.lanes.get(oldKey);
    if (old) { const i = old.indexOf(v); if (i >= 0) old.splice(i, 1); }
    let l = this.lanes.get(k);
    if (!l) { l = []; this.lanes.set(k, l); }
    let i = 0;
    while (i < l.length && l[i].s < v.s) i++;
    l.splice(i, 0, v);
  }

  /** Where this vehicle's current stretch ends, in its travel coordinates. */
  private endS(v: Vehicle) { return v.route ? v.route[v.step!].s1 : this.net.edges[v.edge].len; }

  /** Distance to the vehicle ahead (bumper to bumper), looking one edge ahead. Infinity if clear. */
  private gapAhead(v: Vehicle): number {
    const lane = this.lanes.get(this.laneKey(v)) ?? [];
    for (let i = lane.indexOf(v) + 1; i < lane.length; i++) {
      const o = lane[i];
      if (o !== v && o.s >= v.s) return o.s - v.s - (o.len + v.len) / 2;
    }
    if (!v.next) return Infinity;
    const nl = this.lanes.get(v.next.edge * 2 + (v.next.dir > 0 ? 1 : 0));
    if (!nl?.length) return Infinity;
    const o = nl[0] === v ? nl[1] : nl[0];
    if (!o) return Infinity;
    return this.endS(v) - v.s + o.s - (o.len + v.len) / 2;
  }

  /** Chooses where a car goes after this edge: mostly straight on, sometimes a turn. */
  private chooseNext(edge: number, dir: 1 | -1): { edge: number; dir: 1 | -1 } | null {
    const net = this.net, e = net.edges[edge];
    const node = dir > 0 ? e.b : e.a;
    const end = pointOnEdge(e, dir > 0 ? e.len : 0);
    const ix = end.tx * dir, iy = end.ty * dir;
    const opts: { edge: number; dir: 1 | -1; w: number }[] = [];
    for (const ei of net.nodes[node].edges) {
      if (ei === edge) continue;
      const o = net.edges[ei];
      if (o.a === o.b) continue;
      const d: 1 | -1 = o.a === node ? 1 : -1;
      const st = pointOnEdge(o, d > 0 ? 0 : o.len);
      const dot = ix * st.tx * d + iy * st.ty * d;
      let w = dot > 0.85 ? (o.name && o.name === e.name ? 12 : 8) : dot > -0.2 ? 2 : 0.4;
      if (net.nodes[d > 0 ? o.b : o.a].edges.length === 1) w *= 0.05; // cul-de-sacs, rarely
      opts.push({ edge: ei, dir: d, w });
    }
    if (!opts.length) return null;
    let r = this.rand() * opts.reduce((a, o) => a + o.w, 0);
    for (const o of opts) { r -= o.w; if (r <= 0) return { edge: o.edge, dir: o.dir }; }
    return opts[opts.length - 1];
  }

  private drive(v: Vehicle, dt: number, peds: Pt[]) {
    const net = this.net;
    if (v.kind === 'bus' && v.dwell! > 0) {
      v.dwell! -= dt; v.v = 0; v.braking = true;
      if (v.dwell! > 0) return;
      v.at = undefined;
      const k0 = this.laneKey(v);
      this.advanceStep(v);
      this.relane(v, k0);
    }
    const e = net.edges[v.edge];
    if (!v.next) v.next = v.route ? this.routeNext(v) : this.chooseNext(v.edge, v.dir);
    const endS = this.endS(v);
    const stopFor = (d: number) => Math.sqrt(2 * BRAKE * Math.max(0, d));
    let target = v.vmax;
    let hard = Infinity; // never move past this point (behind another vehicle, at a red)

    // The vehicle ahead
    const gap = this.gapAhead(v);
    if (gap < Infinity) { target = Math.min(target, stopFor(gap - MIN_GAP)); hard = v.s + Math.max(0, gap - 0.25); }

    // A bus pulls in at the end of a stretch that ends at a stop
    if (v.route && v.route[v.step!].stop) target = Math.min(target, stopFor(endS - v.s) + 0.4);

    // Stop lines at the end of this edge and of the next one (a short edge leaves no room to
    // brake if the line only comes into view once you are on it)
    const line = (edge: number, dir: 1 | -1, toStart: number, after: { edge: number; dir: 1 | -1 } | null) => {
      const ed = net.edges[edge];
      const stop = net.stopAt[edge * 2 + (dir > 0 ? 1 : 0)], sig = net.nodes[dir > 0 ? ed.b : ed.a].signal;
      if (stop < 0 || sig < 0) return;
      const toLine = toStart + ed.len - stop;
      if (toLine < -0.3 || toLine > 40) return;
      const light = carLight(net, sig, !!ed.name && ed.name === net.signals[sig].main, this.clock);
      const canStop = toLine > (v.v * v.v) / (2 * BRAKE) - 0.5;
      // Turning into a street whose crosswalk has people on it during Walk: wait at the line
      const yieldNext = !!after && canStop && this.walkersOn(net.crossAt[after.edge * 2 + (after.dir > 0 ? 0 : 1)], peds);
      if (light === 'red' || (light === 'yellow' && canStop) || yieldNext) {
        target = Math.min(target, stopFor(toLine - 0.1));
        hard = Math.min(hard, v.s + Math.max(0, toLine));
      }
    };
    const atEnd = !v.route || Math.abs(endS - e.len) < 1e-6;
    if (atEnd) {
      line(v.edge, v.dir, -(v.s + v.len / 2), v.next);
      const n = v.next;
      const nextFull = !v.route || (() => { const st = v.route![(v.step! + 1) % v.route!.length]; return st.s0 === 0 && Math.abs(st.s1 - net.edges[st.edge].len) < 1e-6; })();
      if (n && nextFull) line(n.edge, n.dir, e.len - v.s - v.len / 2, null);
    }
    if (atEnd) {
      const node = v.dir > 0 ? e.b : e.a;
      if (net.stopAt[v.edge * 2 + (v.dir > 0 ? 1 : 0)] >= 0 && net.nodes[node].signal >= 0) {
        // signalized: handled above
      } else if (net.nodes[node].edges.length >= 3) {
        // Unsignalized junction: one vehicle in the box at a time, give up waiting after a while
        const toNode = e.len - v.s - v.len / 2 - e.half;
        const owner = this.claims[node];
        if (toNode < 2.2 && owner !== v.id) {
          if (owner < 0 || v.wait > 4 || !this.vehicles.some((o) => o.id === owner)) { this.release(v); this.claims[node] = v.id; v.claim = node; v.wait = 0; }
          else if (toNode > 0.2) { target = Math.min(target, stopFor(toNode - 0.2)); v.wait += dt; }
        }
      }
    }

    // A crosswalk just ahead with people on it during Walk: stop short of the stripes. Checked by
    // position, not by edge, so it holds however the streets are split up in the map data.
    const hx = Math.cos(v.angle), hy = Math.sin(v.angle);
    const cx = Math.floor(v.x / 16), cy = Math.floor(v.y / 16);
    for (let gy = cy - 1; gy <= cy + 1; gy++) for (let gx = cx - 1; gx <= cx + 1; gx++) for (const ci of this.crossCells.get(gy * 4096 + gx) ?? []) {
      const k = net.crossings[ci];
      const mx = (k.x0 + k.x1) / 2 - v.x, my = (k.y0 + k.y1) / 2 - v.y;
      if (Math.abs(mx) > 8 || Math.abs(my) > 8) continue;
      const align = hx * k.tx + hy * k.ty;
      if (Math.abs(align) < 0.5) continue;
      const half = Math.hypot(k.x1 - k.x0, k.y1 - k.y0) / 2;
      if (Math.abs(mx * k.ty - my * k.tx) > half + 0.3) continue; // beside it, not heading over it
      const toStripes = (mx * k.tx + my * k.ty) * Math.sign(align) - v.len / 2 - 0.45;
      if (toStripes < -0.05 || toStripes > 7 || !this.walkersOn(ci, peds)) continue;
      target = Math.min(target, stopFor(toStripes - 0.3));
      hard = Math.min(hard, v.s + Math.max(0, toStripes - 0.1));
    }

    // People on the road ahead: brake for them. A car can only brake so hard.
    const c = Math.cos(v.angle), sn = Math.sin(v.angle);
    for (const p of peds) {
      const dx = p.x - v.x, dy = p.y - v.y;
      const along = dx * c + dy * sn - v.len / 2;
      if (along < -0.2 || along > 7) continue;
      if (Math.abs(-dx * sn + dy * c) > v.width / 2 + 0.55) continue;
      target = Math.min(target, stopFor(along - 0.9));
    }

    // Accelerate gently, brake as hard as allowed
    const before = v.v;
    v.v = target > v.v ? Math.min(target, v.v + ACCEL * dt) : Math.max(target, v.v - MAX_BRAKE * dt);
    v.braking = v.v < before - 0.01 || (v.v < 0.05 && target < 0.05);
    const was = v.s;
    v.s = Math.min(v.s + v.v * dt, hard);
    // Held back by the clamp: the speed drops with it, so it cannot carry on through next frame
    if (dt > 0 && v.s < was + v.v * dt - 1e-6) v.v = Math.min(v.v, Math.max(0, (v.s - was) / dt));

    // Onto the next edge
    const key = this.laneKey(v);
    while (v.s >= this.endS(v)) {
      if (v.route) {
        const st = v.route[v.step!];
        if (st.stop) { v.s = st.s1; v.dwell = DWELL; v.at = st.stop; v.v = 0; break; }
        this.advanceStep(v);
        continue;
      }
      const over = v.s - e.len;
      if (!v.next) {
        // Dead end: turn round once the other lane is clear at this end
        const back = this.lanes.get(v.edge * 2 + (v.dir > 0 ? 0 : 1));
        if (back?.some((o) => o.s < v.len + 1.5)) { v.s = e.len; v.v = 0; break; }
        v.dir = v.dir > 0 ? -1 : 1; v.s = 0; break;
      }
      v.edge = v.next.edge; v.dir = v.next.dir; v.s = over; v.next = null;
      break;
    }
    this.relane(v, key);
    // Release a held junction once clear of it
    if (v.claim >= 0) {
      const ce = net.edges[v.edge];
      if ((v.dir > 0 ? ce.a : ce.b) === v.claim && v.s > v.len + 2.5) this.release(v);
    }
    this.place(v, false, dt);
  }

  /** Whether crossing `ci` shows Walk (or its countdown) with someone on it or stepping onto it. */
  private walkersOn(ci: number, peds: Pt[]): boolean {
    if (ci < 0 || !peds.length) return false;
    const k = this.net.crossings[ci];
    const w = walkLight(this.net, k.signal, k.overMain, this.clock);
    if (!w.walk && !w.count) return false;
    const dx = k.x1 - k.x0, dy = k.y1 - k.y0, len = Math.hypot(dx, dy) || 1;
    for (const p of peds) {
      const along = ((p.x - k.x0) * dx + (p.y - k.y0) * dy) / len;
      const off = Math.abs((p.x - k.x0) * k.tx + (p.y - k.y0) * k.ty);
      if (along > -1.2 && along < len + 1.2 && off < 1.3) return true;
    }
    return false;
  }

  private routeNext(v: Vehicle) {
    const r = v.route!, n = r[(v.step! + 1) % r.length];
    return { edge: n.edge, dir: n.dir };
  }

  private advanceStep(v: Vehicle) {
    const r = v.route!;
    const over = Math.max(0, v.s - r[v.step!].s1);
    v.step = (v.step! + 1) % r.length;
    const st = r[v.step];
    v.edge = st.edge; v.dir = st.dir; v.s = st.s0 + over; v.next = null;
  }

  /** Puts the vehicle in its lane: the right-hand side of the centreline. */
  private place(v: Vehicle, snap: boolean, dt = 0) {
    const e = this.net.edges[v.edge];
    const pt = pointOnEdge(e, v.dir > 0 ? v.s : e.len - v.s);
    const hx = pt.tx * v.dir, hy = pt.ty * v.dir;
    const off = e.half * 0.48;
    v.x = pt.x - hy * off; v.y = pt.y + hx * off;
    const want = Math.atan2(hy, hx);
    if (snap) { v.angle = want; return; }
    let d = want - v.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    v.angle += Math.abs(d) > 2.5 ? d : d * Math.min(1, dt * 9);
  }

  private populate(view: Rect, busy: number) {
    const area = { x0: view.x0 - 22, y0: view.y0 - 22, x1: view.x1 + 22, y1: view.y1 + 22 };
    // How many cars the area should hold, recomputed twice a second
    if (this.clock - this.densityAt > 0.5 || this.warm) {
      this.densityAt = this.clock;
      let len = 0;
      this.near.length = 0;
      this.net.edges.forEach((e, i) => {
        const b = this.boxes[i];
        if (b.x1 < area.x0 || b.x0 > area.x1 || b.y1 < area.y0 || b.y0 > area.y1) return;
        len += e.len;
        if (e.len >= 6) this.near.push(i);
      });
      this.target = Math.min(48, Math.round((len / 14) * busy));
    }
    const cars = this.vehicles.length - this.buses.length;
    const tries = this.warm ? this.target * 3 : 3;
    for (let k = 0, n = cars; k < tries && n < this.target && this.near.length; k++) {
      const ei = this.near[Math.floor(this.rand() * this.near.length)];
      const e = this.net.edges[ei];
      const dir: 1 | -1 = this.rand() < 0.5 ? 1 : -1;
      const s = 1.5 + this.rand() * Math.max(0, e.len - 3);
      // Not where it would have to brake hard: near a stop line ahead, or on a crosswalk
      const stopEnd = this.net.stopAt[ei * 2 + (dir > 0 ? 1 : 0)];
      if (stopEnd >= 0 && s > e.len - stopEnd - 9) continue;
      const startEnd = ei * 2 + (dir > 0 ? 0 : 1);
      if (this.net.crossAt[startEnd] >= 0 && s < this.net.crossDist[startEnd] + 2) continue;
      const v: Vehicle = {
        id: this.nextId++, kind: 'car', edge: ei, dir, s, v: 0, vmax: 8 + this.rand() * 2.5, len: 1.7, width: 0.9,
        next: null, x: 0, y: 0, angle: 0, braking: false, color: Math.floor(this.rand() * CAR_COLORS), claim: -1, wait: 0,
      };
      this.place(v, true);
      if (!inside(area, v.x, v.y) || (!this.warm && inside(view, v.x, v.y, 2))) continue;
      if (this.vehicles.some((o) => Math.hypot(o.x - v.x, o.y - v.y) < 4)) continue;
      v.v = v.vmax * 0.6;
      this.vehicles.push(v);
      n++;
    }
    this.warm = false;
  }
}
