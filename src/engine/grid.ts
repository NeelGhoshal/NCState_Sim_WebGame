import { type GameMap, type Pt, isSolid } from './types';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Breadth-first path on the tile grid. Returns the tiles after `from`, ending at `to`. */
export function findPath(map: GameMap, from: Pt, to: Pt): Pt[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  if (isSolid(map, to.x, to.y)) return null;
  const prev = new Int32Array(map.w * map.h).fill(-1);
  const start = from.y * map.w + from.x;
  const goal = to.y * map.w + to.x;
  const queue = [start];
  prev[start] = start;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === goal) break;
    const cx = cur % map.w, cy = (cur - cx) / map.w;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (isSolid(map, nx, ny)) continue;
      const ni = ny * map.w + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return null;
  const path: Pt[] = [];
  for (let cur = goal; cur !== start; cur = prev[cur]) path.push({ x: cur % map.w, y: Math.floor(cur / map.w) });
  return path.reverse();
}

/** Every tile reachable on foot from `from`. */
export function reachable(map: GameMap, from: Pt): Set<number> {
  const seen = new Set<number>([from.y * map.w + from.x]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    for (const [dx, dy] of DIRS) {
      const nx = c.x + dx, ny = c.y + dy;
      if (isSolid(map, nx, ny)) continue;
      const ni = ny * map.w + nx;
      if (seen.has(ni)) continue;
      seen.add(ni);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

// ---------------------------------------------------------------- routes for the player

/** Cost of stepping onto a tile, or Infinity when it cannot be walked. */
export type TileCost = (x: number, y: number) => number;

/** Walking costs: footpaths and crosswalks are cheapest, lawns cost a little more, streets much more. */
export function walkCost(map: GameMap, crossTile?: Map<number, number>): TileCost {
  return (x, y) => {
    if (isSolid(map, x, y)) return Infinity;
    const i = y * map.w + x;
    if (crossTile?.has(i)) return 1;
    switch (map.ground[i]) {
      case 'grass': case 'field': return 1.7;
      case 'parking': return 1.4;
      case 'road': case 'underpass': return 4;
      default: return 1;
    }
  };
}

class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    let i = this.ids.length;
    this.ids.push(id); this.keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.ids[i] = this.ids[p]; this.keys[i] = this.keys[p]; i = p;
    }
    this.ids[i] = id; this.keys[i] = key;
  }
  pop(): number {
    const top = this.ids[0];
    const id = this.ids.pop()!, key = this.keys.pop()!;
    const n = this.ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mk = key;
        if (l < n && this.keys[l] < mk) { m = l; mk = this.keys[l]; }
        if (r < n && this.keys[r] < mk) { m = r; mk = this.keys[r]; }
        if (m === i) break;
        this.ids[i] = this.ids[m]; this.keys[i] = this.keys[m]; i = m;
      }
      this.ids[i] = id; this.keys[i] = key;
    }
    return top;
  }
}

const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/**
 * Cheapest 8-way path by `cost` (A*). Diagonals may not cut a solid corner. Returns the tiles
 * after `from`, ending at `to`, or null when there is no way through.
 */
export function findRoute(map: GameMap, from: Pt, to: Pt, cost: TileCost): Pt[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  if (!isFinite(cost(to.x, to.y))) return null;
  const W = map.w, n = map.w * map.h;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const start = from.y * W + from.x, goal = to.y * W + to.x;
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - to.x), dy = Math.abs(y - to.y);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new Heap();
  g[start] = 0; prev[start] = start;
  open.push(start, h(from.x, from.y));
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) break;
    const cx = cur % W, cy = (cur - cx) / W;
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx, ny = cy + dy;
      const c = cost(nx, ny);
      if (!isFinite(c)) continue;
      if (dx && dy && (isSolid(map, cx + dx, cy) || isSolid(map, cx, cy + dy))) continue;
      const ng = g[cur] + c * (dx && dy ? Math.SQRT2 : 1);
      const ni = ny * W + nx;
      if (ng >= g[ni]) continue;
      g[ni] = ng; prev[ni] = cur;
      open.push(ni, ng + h(nx, ny));
    }
  }
  if (prev[goal] === -1) return null;
  const path: Pt[] = [];
  for (let cur = goal; cur !== start; cur = prev[cur]) path.push({ x: cur % W, y: Math.floor(cur / W) });
  return path.reverse();
}

/**
 * Straightens a tile path into waypoints (tile centres) for smooth walking: a shortcut is taken
 * only when a body of radius `r` fits all along it and it crosses nothing costlier than the
 * stretch it replaces, so a path along a footpath stays on the footpath.
 */
export function smoothRoute(map: GameMap, from: Pt, path: Pt[], cost: TileCost, r = 0.3): Pt[] {
  const pts = [from, ...path];
  if (pts.length <= 2) return path.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
  const clear = (a: Pt, b: Pt, limit: number) => {
    const ax = a.x + 0.5, ay = a.y + 0.5, bx = b.x + 0.5, by = b.y + 0.5;
    const len = Math.hypot(bx - ax, by - ay), steps = Math.ceil(len / 0.2);
    for (let k = 0; k <= steps; k++) {
      const x = ax + ((bx - ax) * k) / steps, y = ay + ((by - ay) * k) / steps;
      // The line itself keeps to ground no costlier than the stretch; the body just has to fit
      if (cost(Math.floor(x), Math.floor(y)) > limit) return false;
      for (const [ox, oy] of [[r, r], [-r, r], [r, -r], [-r, -r]]) {
        if (isSolid(map, Math.floor(x + ox), Math.floor(y + oy))) return false;
      }
    }
    return true;
  };
  const out: Pt[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    let best = i + 1, worst = cost(pts[i + 1].x, pts[i + 1].y);
    for (let j = i + 2; j < pts.length && j < i + 60; j++) {
      worst = Math.max(worst, cost(pts[j].x, pts[j].y));
      if (clear(pts[i], pts[j], worst)) best = j;
    }
    out.push({ x: pts[best].x + 0.5, y: pts[best].y + 0.5 });
    i = best;
  }
  return out;
}
