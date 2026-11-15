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
