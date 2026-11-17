// The street network of an outdoor map, built from its OSM street centrelines: a graph of
// edges between junctions, traffic signals at the busy junctions, a crosswalk on each arm of a
// signal, and routes along the graph (the Wolfline loop). Pure data: no DOM, no Phaser.
// The traffic simulation (src/game/traffic.ts) drives on it and the renderer paints it.
import type { MapLine, Pt } from './types';

/** Half the paved width of each street kind, in tiles. Matches the rasterized roads in campus.ts. */
export const DRIVE_HALF: Record<string, number> = { primary: 2, secondary: 1.6, tertiary: 1.2, residential: 1.1 };
const RANK: Record<string, number> = { primary: 4, secondary: 3, tertiary: 2, residential: 1 };

export interface RoadNode { x: number; y: number; edges: number[]; signal: number }
export interface RoadEdge {
  a: number; b: number;
  /** Flat [x0,y0,x1,y1,...] in tiles, from node a to node b. */
  p: number[];
  /** Arc length at each vertex. */
  cum: number[];
  len: number; name: string; kind: string; half: number;
}
/** One controller for a junction (or a cluster of close junctions on a divided road). */
export interface Signal {
  x: number; y: number;
  /** Streets with this name get the first green; every other street gets the second. */
  main: string;
  /** Seconds added to the clock so neighbouring signals do not change together. */
  offset: number;
}
/** A zebra crossing over one arm of a signalized junction. */
export interface Crossing {
  signal: number;
  /** True when the crossing is over the main street, so walkers go while it is red. */
  overMain: boolean;
  x0: number; y0: number; x1: number; y1: number;
  /** Unit vector along the street at the crossing. */
  tx: number; ty: number;
}
export interface SignalHead { kind: 'car' | 'ped'; signal: number; main: boolean; x: number; y: number; crossing?: number }

export interface RoadNet {
  nodes: RoadNode[];
  edges: RoadEdge[];
  signals: Signal[];
  crossings: Crossing[];
  /** Stop-line distance from the node at each end: index edge*2 for end a, edge*2+1 for end b. -1 = no line. */
  stopAt: Float32Array;
  stopLines: { x0: number; y0: number; x1: number; y1: number }[];
  heads: SignalHead[];
  /** Tile index (y * mapWidth + x) -> crossing index. */
  crossTile: Map<number, number>;
}

/** A point on the network: an edge and the arc length from its node a. */
export interface NetPoint { edge: number; arc: number; x: number; y: number }
/** One stretch of a route: drive `edge` in direction `dir` from s0 to s1 (distances measured in travel direction). */
export interface RouteStep { edge: number; dir: 1 | -1; s0: number; s1: number; /** A bus stop at the end of this step. */ stop?: string }

function hash(n: number) {
  let h = n * 2654435761;
  h = (h ^ (h >>> 15)) * 2246822519;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export function pointOnEdge(e: RoadEdge, arc: number): { x: number; y: number; tx: number; ty: number } {
  const a = Math.max(0, Math.min(e.len, arc));
  let i = 1;
  while (i < e.cum.length - 1 && e.cum[i] < a) i++;
  const x0 = e.p[(i - 1) * 2], y0 = e.p[(i - 1) * 2 + 1], x1 = e.p[i * 2], y1 = e.p[i * 2 + 1];
  const seg = e.cum[i] - e.cum[i - 1] || 1;
  const f = (a - e.cum[i - 1]) / seg;
  return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, tx: (x1 - x0) / seg, ty: (y1 - y0) / seg };
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

/** Builds the street graph from map lines. `w`/`h` bound where signals and crosswalks go. */
export function buildRoadNet(lines: MapLine[], w: number, h: number): RoadNet {
  const drive = lines.filter((l) => DRIVE_HALF[l.k] !== undefined && l.p.length >= 4);
  // A vertex is a junction when two streets share it, or it ends a street.
  const uses = new Map<string, number>();
  const key = (x: number, y: number) => `${x},${y}`;
  for (const l of drive) for (let i = 0; i < l.p.length; i += 2) {
    const k = key(l.p[i], l.p[i + 1]);
    const end = i === 0 || i === l.p.length - 2;
    uses.set(k, (uses.get(k) ?? 0) + (end ? 2 : 1));
  }
  const nodes: RoadNode[] = [];
  const nodeAt = new Map<string, number>();
  const node = (x: number, y: number) => {
    const k = key(x, y);
    let id = nodeAt.get(k);
    if (id === undefined) { id = nodes.length; nodes.push({ x, y, edges: [], signal: -1 }); nodeAt.set(k, id); }
    return id;
  };
  const edges: RoadEdge[] = [];
  for (const l of drive) {
    let start = 0;
    for (let i = 2; i < l.p.length; i += 2) {
      const last = i === l.p.length - 2;
      if (!last && (uses.get(key(l.p[i], l.p[i + 1])) ?? 0) < 2) continue;
      const p = l.p.slice(start, i + 2);
      const cum = [0];
      for (let j = 2; j < p.length; j += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[j] - p[j - 2], p[j + 1] - p[j - 1]));
      const len = cum[cum.length - 1];
      if (len > 0.05) {
        const a = node(p[0], p[1]), b = node(p[p.length - 2], p[p.length - 1]);
        const id = edges.length;
        edges.push({ a, b, p, cum, len, name: l.name ?? '', kind: l.k, half: DRIVE_HALF[l.k] });
        nodes[a].edges.push(id);
        if (b !== a) nodes[b].edges.push(id);
      }
      start = i;
    }
  }

  // ---- Signals: junctions of two or more named streets where at least two arms are through streets
  const signals: Signal[] = [];
  for (let n = 0; n < nodes.length; n++) {
    const nd = nodes[n];
    if (nd.edges.length < 3 || nd.x < 2 || nd.y < 2 || nd.x > w - 2 || nd.y > h - 2) continue;
    const es = nd.edges.map((e) => edges[e]);
    const names = new Set(es.map((e) => e.name).filter(Boolean));
    const through = es.filter((e) => RANK[e.kind] >= 2).length;
    if (names.size < 2 || through < 2) continue;
    // Close junctions (a divided street meeting another) share one controller
    let sig = signals.findIndex((s) => Math.hypot(s.x - nd.x, s.y - nd.y) < 7);
    if (sig < 0) { sig = signals.length; signals.push({ x: nd.x, y: nd.y, main: '', offset: hash(n) * 30 }); }
    nd.signal = sig;
  }
  // The main street of each controller is its highest-ranked, then longest, named street.
  signals.forEach((s, i) => {
    const score = new Map<string, number>();
    for (const nd of nodes) if (nd.signal === i) for (const e of nd.edges) {
      const ed = edges[e];
      if (ed.name) score.set(ed.name, (score.get(ed.name) ?? 0) + RANK[ed.kind] * 1000 + ed.len);
    }
    s.main = [...score.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? '';
  });

  // ---- Crosswalks and stop lines on each arm that leaves a signal's cluster
  const crossings: Crossing[] = [];
  const stopAt = new Float32Array(edges.length * 2).fill(-1);
  const stopLines: RoadNet['stopLines'] = [];
  const heads: SignalHead[] = [];
  const crossTile = new Map<number, number>();
  for (let n = 0; n < nodes.length; n++) {
    const nd = nodes[n];
    if (nd.signal < 0) continue;
    const reach = Math.max(...nd.edges.map((e) => edges[e].half)) + 1.1;
    for (const ei of nd.edges) {
      const e = edges[ei];
      const atA = e.a === n;
      const other = nodes[atA ? e.b : e.a];
      if (other.signal === nd.signal && e.len < 14) continue; // a link inside the cluster
      if (e.len < reach + 3) continue;
      const arc = atA ? reach : e.len - reach;
      const pt = pointOnEdge(e, arc);
      // Tangent pointing away from the junction
      const tx = atA ? pt.tx : -pt.tx, ty = atA ? pt.ty : -pt.ty;
      const nx = -ty, ny = tx;
      // Skip arms whose crossing would land on another street of the same junction (divided roads)
      const onOther = nodes.some((m) => m.signal === nd.signal && m.edges.some((oi) => {
        const o = edges[oi];
        if (oi === ei || (o.name && o.name === e.name)) return false;
        for (let j = 0; j + 3 < o.p.length; j += 2) if (segDist(pt.x, pt.y, o.p[j], o.p[j + 1], o.p[j + 2], o.p[j + 3]) < o.half + 0.3) return true;
        return false;
      }));
      if (onOther) continue;
      const half = e.half + 0.2;
      const overMain = !!e.name && e.name === signals[nd.signal].main;
      const ci = crossings.length;
      crossings.push({ signal: nd.signal, overMain, x0: pt.x - nx * half, y0: pt.y - ny * half, x1: pt.x + nx * half, y1: pt.y + ny * half, tx, ty });
      for (let s = -half; s <= half; s += 0.25) for (const along of [-0.45, 0, 0.45]) {
        const x = Math.floor(pt.x + nx * s + tx * along), y = Math.floor(pt.y + ny * s + ty * along);
        if (x >= 0 && y >= 0 && x < w && y < h) crossTile.set(y * w + x, ci);
      }
      // Walk heads on both kerbs
      for (const side of [-1, 1]) {
        heads.push({ kind: 'ped', signal: nd.signal, main: overMain, x: pt.x + nx * side * (half + 0.55), y: pt.y + ny * side * (half + 0.55), crossing: ci });
      }
      // Traffic coming in toward the junction stops just behind the crosswalk. Incoming traffic
      // drives on its right, which (seen from the junction looking out) is the -n side.
      const stop = reach + 0.9;
      stopAt[ei * 2 + (atA ? 0 : 1)] = stop;
      const sp = pointOnEdge(e, atA ? stop : e.len - stop);
      stopLines.push({ x0: sp.x, y0: sp.y, x1: sp.x - nx * e.half, y1: sp.y - ny * e.half });
      heads.push({ kind: 'car', signal: nd.signal, main: overMain, x: sp.x - nx * (e.half + 0.5), y: sp.y - ny * (e.half + 0.5) });
    }
  }
  return { nodes, edges, signals, crossings, stopAt, stopLines, heads, crossTile };
}

/** The nearest point on the network to p. `ok` limits which edges count. */
export function projectToNet(net: RoadNet, p: Pt, ok: (e: RoadEdge) => boolean = () => true): NetPoint {
  let best: NetPoint | null = null, bd = Infinity;
  net.edges.forEach((e, ei) => {
    if (!ok(e)) return;
    for (let i = 0; i + 3 < e.p.length; i += 2) {
      const ax = e.p[i], ay = e.p[i + 1], bx = e.p[i + 2], by = e.p[i + 3];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2));
      const x = ax + dx * t, y = ay + dy * t, d = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d < bd) { bd = d; best = { edge: ei, arc: e.cum[i / 2] + Math.sqrt(l2) * t, x, y }; }
    }
  });
  if (!best) throw new Error('roads: empty network');
  return best;
}

/** Shortest drive from one network point to another, as route steps. Null when unconnected. */
export function routeBetween(net: RoadNet, from: NetPoint, to: NetPoint): RouteStep[] | null {
  const fe = net.edges[from.edge], te = net.edges[to.edge];
  // Same edge: drive straight along it
  if (from.edge === to.edge) {
    return from.arc <= to.arc
      ? [{ edge: from.edge, dir: 1, s0: from.arc, s1: to.arc }]
      : [{ edge: from.edge, dir: -1, s0: fe.len - from.arc, s1: fe.len - to.arc }];
  }
  const n = net.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const via = new Int32Array(n).fill(-1); // edge used to reach the node
  const done = new Uint8Array(n);
  dist[fe.a] = Math.min(dist[fe.a], from.arc);
  dist[fe.b] = Math.min(dist[fe.b], fe.len - from.arc);
  for (;;) {
    let u = -1, du = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i; }
    if (u < 0) break;
    done[u] = 1;
    for (const ei of net.nodes[u].edges) {
      if (ei === from.edge) continue;
      const e = net.edges[ei], v = e.a === u ? e.b : e.a;
      if (du + e.len < dist[v]) { dist[v] = du + e.len; via[v] = ei; }
    }
  }
  const endA = dist[te.a] + to.arc, endB = dist[te.b] + (te.len - to.arc);
  if (!isFinite(endA) && !isFinite(endB)) return null;
  const last = endA <= endB ? te.a : te.b;
  const steps: RouteStep[] = [];
  steps.push(last === te.a ? { edge: to.edge, dir: 1, s0: 0, s1: to.arc } : { edge: to.edge, dir: -1, s0: 0, s1: te.len - to.arc });
  let u = last;
  while (via[u] >= 0) {
    const e = net.edges[via[u]];
    const prev = e.a === u ? e.b : e.a;
    steps.push({ edge: via[u], dir: e.b === u ? 1 : -1, s0: 0, s1: e.len });
    u = prev;
  }
  // u is now an end of the start edge
  steps.push(u === fe.b
    ? { edge: from.edge, dir: 1, s0: from.arc, s1: fe.len }
    : { edge: from.edge, dir: -1, s0: fe.len - from.arc, s1: fe.len });
  return steps.reverse().filter((s) => s.s1 - s.s0 > 1e-6);
}

export const routeLength = (steps: RouteStep[]) => steps.reduce((a, s) => a + s.s1 - s.s0, 0);
