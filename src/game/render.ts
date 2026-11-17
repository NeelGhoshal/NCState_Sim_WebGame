// Draws a GameMap to offscreen canvases. No art assets: everything is shapes.
// Interiors are drawn tile by tile in one canvas. Maps with vector data (the OSM campus) are
// drawn in chunks: lawn tiles first, then smooth areas, streets, paths and the railroad, then
// building outlines in brick, then labels. Collision still uses the tile grid.
import type { BuildingMeta, BuildingStyle, GameMap, Ground, MapArea, MapLine, Obj } from '../engine/types';

export const TS = 32;

const GROUND: Record<Ground, string> = {
  void: '#111317', grass: '#6b9b52', sidewalk: '#d3ccbc', plaza: '#a65a45', roadH: '#4a4b51', roadV: '#4a4b51',
  roadX: '#4a4b51', crosswalk: '#4a4b51', rail: '#7b7266', tunnel: '#3a3a42', parking: '#8c8c8c', field: '#4e9a40',
  water: '#4f86b8', site: '#a5845e', bldg: '#9a9a9a', door: '#8b5a2b', floor: '#ddd6c6', tile: '#e8e8e6',
  carpet: '#6e7d9c', wood: '#bb8d5f', rug: '#9c3b3b', wall: '#2f3039', glass: '#9cc9e3', kitchen: '#a3a8ad',
  stage: '#5b3c2b', stairsUp: '#c9c2b3', stairsDown: '#b3ad9f', road: '#4a4c52', underpass: '#55565c',
};

const STYLE: Record<BuildingStyle, [string, string]> = {
  academic: ['#b5574a', '#7c3329'], union: ['#c2413b', '#7f1f1b'], residence: ['#c58a5c', '#86552f'],
  dining: ['#d0a14a', '#8d6a24'], athletic: ['#8a8f99', '#545862'], shop: ['#6f8fa8', '#41596b'],
  parking: ['#9b9b9b', '#666'], landmark: ['#e0d2b4', '#9c8a62'], service: ['#9c9a8c', '#68665a'],
  offcampus: ['#b8b0a2', '#857c6c'], closed: ['#8f7f6b', '#5a4c3b'],
};

/** Red brick reads as NC State; brick courses are drawn on these styles. */
const BRICK = new Set<BuildingStyle>(['academic', 'residence', 'union', 'dining', 'landmark']);

/** Tiles per chunk side for vector maps. */
export const CHUNK = 32;
/** A map bigger than this many pixels is drawn in chunks. */
export const isChunked = (map: GameMap) => !!map.vectors && map.w * map.h * TS * TS > 4096 * 4096;

function noise(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawGround(c: CanvasRenderingContext2D, g: Ground, x: number, y: number, map: GameMap) {
  const px = x * TS, py = y * TS;
  const base = GROUND[g];
  const n = noise(x, y);
  const grain = map.vectors ? 5 : 14;
  c.fillStyle = g === 'grass' || g === 'field' ? shade(base, (n - 0.5) * grain) : base;
  c.fillRect(px, py, TS, TS);
  switch (g) {
    case 'sidewalk':
      c.strokeStyle = 'rgba(0,0,0,0.07)'; c.strokeRect(px + 0.5, py + 0.5, TS - 1, TS - 1); break;
    case 'plaza':
      c.strokeStyle = 'rgba(60,20,10,0.35)'; c.lineWidth = 1;
      for (let r = 0; r < 4; r++) {
        c.beginPath(); c.moveTo(px, py + r * 8 + 0.5); c.lineTo(px + TS, py + r * 8 + 0.5); c.stroke();
        const off = (r % 2) * 8;
        for (let k = off; k < TS; k += 16) { c.beginPath(); c.moveTo(px + k + 0.5, py + r * 8); c.lineTo(px + k + 0.5, py + r * 8 + 8); c.stroke(); }
      }
      break;
    case 'roadH': {
      const above = y > 0 && map.ground[(y - 1) * map.w + x] === 'roadH';
      if (above) { c.fillStyle = '#e6c84a'; for (let k = 4; k < TS; k += 16) c.fillRect(px + k, py - 1, 8, 2); }
      break;
    }
    case 'roadV': {
      const left = x > 0 && map.ground[y * map.w + x - 1] === 'roadV';
      if (left) { c.fillStyle = '#e6c84a'; for (let k = 4; k < TS; k += 16) c.fillRect(px - 1, py + k, 2, 8); }
      break;
    }
    case 'crosswalk': {
      const horizontalRoad = (y > 0 && map.ground[(y - 1) * map.w + x] === 'crosswalk') || (y < map.h - 1 && map.ground[(y + 1) * map.w + x] === 'crosswalk');
      c.fillStyle = '#f2f2f2';
      if (horizontalRoad) for (let k = 2; k < TS; k += 8) c.fillRect(px + k, py + 2, 4, TS - 4);
      else for (let k = 2; k < TS; k += 8) c.fillRect(px + 2, py + k, TS - 4, 4);
      break;
    }
    case 'rail':
      c.fillStyle = '#5b4a3a'; for (let k = 2; k < TS; k += 8) c.fillRect(px + k, py + 4, 4, TS - 8);
      c.fillStyle = '#c9c9c9'; c.fillRect(px, py + 9, TS, 3); c.fillRect(px, py + 20, TS, 3); break;
    case 'tunnel': {
      const colors = ['#e74c3c', '#f1c40f', '#3498db', '#9b59b6', '#2ecc71', '#ffffff'];
      for (let k = 0; k < 5; k++) { c.fillStyle = colors[Math.floor(noise(x * 7 + k, y * 3) * colors.length)]; c.fillRect(px + 2 + k * 6, py + 3 + (k % 2) * 8, 5, 14); }
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(px, py, 3, TS); c.fillRect(px + TS - 3, py, 3, TS);
      break;
    }
    case 'parking':
      c.strokeStyle = '#eee'; c.beginPath(); c.moveTo(px + 0.5, py); c.lineTo(px + 0.5, py + TS); c.stroke(); break;
    case 'field':
      if (y % 2 === 0) { c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(px, py, TS, TS); } break;
    case 'site':
      c.fillStyle = 'rgba(80,60,30,0.3)'; c.fillRect(px + n * 20, py + 6, 8, 5); c.fillRect(px + 4, py + 18 + n * 6, 10, 4); break;
    case 'tile':
      if ((x + y) % 2 === 0) { c.fillStyle = '#d9d9d6'; c.fillRect(px, py, TS, TS); } break;
    case 'floor':
      c.strokeStyle = 'rgba(0,0,0,0.05)'; c.strokeRect(px + 0.5, py + 0.5, TS - 1, TS - 1); break;
    case 'carpet':
      c.fillStyle = 'rgba(255,255,255,0.04)'; if ((x + y) % 2) c.fillRect(px, py, TS, TS); break;
    case 'wood':
      c.strokeStyle = 'rgba(80,40,10,0.25)'; for (let k = 0; k < TS; k += 8) { c.beginPath(); c.moveTo(px, py + k + 0.5); c.lineTo(px + TS, py + k + 0.5); c.stroke(); } break;
    case 'wall':
      c.fillStyle = '#3b3c47'; c.fillRect(px, py, TS, TS - 6); break;
    case 'glass':
      c.fillStyle = '#c8e4f3'; c.fillRect(px + 3, py + 10, TS - 6, 4); break;
    case 'kitchen':
      c.strokeStyle = 'rgba(0,0,0,0.12)'; c.strokeRect(px + 0.5, py + 0.5, TS - 1, TS - 1);
      c.fillStyle = '#7f858b'; c.fillRect(px + 6, py + 6, 8, 8); break;
    case 'stage':
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.moveTo(px, py + 16.5); c.lineTo(px + TS, py + 16.5); c.stroke(); break;
    case 'stairsUp': case 'stairsDown':
      c.fillStyle = 'rgba(0,0,0,0.18)'; for (let k = 0; k < TS; k += 6) c.fillRect(px, py + k, TS, 2); break;
    case 'underpass':
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(px, py, TS, 4); c.fillRect(px, py + TS - 4, TS, 4); break;
    case 'door':
      c.fillStyle = '#a8743d'; c.fillRect(px + 2, py + 2, TS - 4, TS - 4); break;
    default: break;
  }
}

function drawObj(c: CanvasRenderingContext2D, o: Obj, x: number, y: number) {
  const px = x * TS, py = y * TS;
  switch (o) {
    case 'tree':
      c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath(); c.ellipse(px + 17, py + 22, 12, 7, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2f6b31'; c.beginPath(); c.arc(px + 16, py + 14, 12, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#3f8a3e'; c.beginPath(); c.arc(px + 13, py + 11, 6, 0, Math.PI * 2); c.fill(); break;
    case 'fence':
      c.strokeStyle = '#e0a020'; c.lineWidth = 3; c.strokeRect(px + 4, py + 4, TS - 8, TS - 8);
      c.strokeStyle = '#333'; c.lineWidth = 1; c.beginPath(); c.moveTo(px + 4, py + 4); c.lineTo(px + TS - 4, py + TS - 4); c.stroke(); break;
    case 'counter':
      c.fillStyle = '#6e4325'; c.fillRect(px, py + 2, TS, TS - 4); c.fillStyle = '#9a6a43'; c.fillRect(px, py + 2, TS, 7); break;
    case 'table':
      c.fillStyle = '#7b4f2c'; c.fillRect(px + 2, py + 4, TS - 4, TS - 8); c.fillStyle = '#9b6a42'; c.fillRect(px + 2, py + 4, TS - 4, 4); break;
    case 'seatN': case 'seatS':
      c.fillStyle = '#8f2525'; c.fillRect(px + 1, o === 'seatN' ? py + 2 : py + 14, TS - 2, 16);
      c.fillStyle = '#b53a3a'; c.fillRect(px + 3, o === 'seatN' ? py + 14 : py + 6, TS - 6, 12); break;
    case 'chair':
      c.fillStyle = '#4b4b55'; c.fillRect(px + 9, py + 9, 14, 14); break;
    case 'sofa':
      c.fillStyle = '#3d4d7a'; c.fillRect(px, py + 6, TS, 20); c.fillStyle = '#566aa3'; c.fillRect(px + 2, py + 10, TS - 4, 12); break;
    case 'shelf': {
      c.fillStyle = '#5d4227'; c.fillRect(px, py + 4, TS, TS - 8);
      const cols = ['#c0392b', '#2980b9', '#f39c12', '#27ae60', '#ecf0f1'];
      for (let k = 0; k < 5; k++) { c.fillStyle = cols[(x + y + k) % cols.length]; c.fillRect(px + 2 + k * 6, py + 7, 4, 18); }
      break;
    }
    case 'fridge':
      c.fillStyle = '#e8f1f7'; c.fillRect(px + 1, py + 1, TS - 2, TS - 2); c.fillStyle = '#9fc6df'; c.fillRect(px + 4, py + 4, TS - 8, TS - 14); break;
    case 'plant':
      c.fillStyle = '#7a4a2a'; c.fillRect(px + 10, py + 18, 12, 10);
      c.fillStyle = '#3b8a3a'; c.beginPath(); c.arc(px + 16, py + 13, 9, 0, Math.PI * 2); c.fill(); break;
    case 'aud':
      for (let k = 0; k < 2; k++) { c.fillStyle = '#7c1f1f'; c.fillRect(px + 2 + k * 15, py + 6, 13, 20); c.fillStyle = '#a33'; c.fillRect(px + 4 + k * 15, py + 8, 9, 10); }
      break;
    case 'desk':
      c.fillStyle = '#5c5f66'; c.fillRect(px + 1, py + 6, TS - 2, TS - 12); c.fillStyle = '#9fd3f0'; c.fillRect(px + 10, py + 8, 12, 8); break;
    case 'busstop':
      c.fillStyle = '#333'; c.fillRect(px + 14, py + 6, 4, 24);
      c.fillStyle = '#cc0000'; c.fillRect(px + 6, py + 2, 20, 12); c.fillStyle = '#fff'; c.font = 'bold 9px sans-serif'; c.fillText('BUS', px + 8, py + 11); break;
    case 'ears':
      c.fillStyle = '#8a8f99'; c.beginPath(); c.moveTo(px + 6, py + 28); c.lineTo(px + 16, py + 2); c.lineTo(px + 26, py + 28); c.closePath(); c.fill();
      c.fillStyle = '#5c616b'; c.beginPath(); c.moveTo(px + 11, py + 26); c.lineTo(px + 16, py + 10); c.lineTo(px + 21, py + 26); c.closePath(); c.fill(); break;
  }
}

function wrapText(c: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function outlinedText(c: CanvasRenderingContext2D, text: string, x: number, y: number, fill = '#fff', stroke = 'rgba(0,0,0,0.75)') {
  c.lineWidth = 3; c.strokeStyle = stroke; c.strokeText(text, x, y); c.fillStyle = fill; c.fillText(text, x, y);
}

// ---------------------------------------------------------------- vector maps

interface Box { x0: number; y0: number; x1: number; y1: number }
type PBuilding = BuildingMeta & { b: Box; lx: number; ly: number };
interface Prepared {
  lines: (MapLine & { b: Box })[];
  areas: (MapArea & { b: Box })[];
  buildings: PBuilding[];
  roadLabels: { name: string; x: number; y: number; a: number }[];
}
const prepared = new WeakMap<GameMap, Prepared>();

function boxOf(p: number[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  return { x0, y0, x1, y1 };
}
const hits = (b: Box, r: Box) => b.x0 <= r.x1 && b.x1 >= r.x0 && b.y0 <= r.y1 && b.y1 >= r.y0;

/** Label point of a polygon: its area centroid, or the box centre for a degenerate one. */
function labelPoint(p: number[], b: Box) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length, f = p[i] * p[j + 1] - p[j] * p[i + 1];
    a += f; cx += (p[i] + p[j]) * f; cy += (p[i + 1] + p[j + 1]) * f;
  }
  return a ? { x: cx / (3 * a), y: cy / (3 * a) } : { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
}

const ROAD_KINDS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'service', 'aisle']);
const SHORT: [RegExp, string][] = [[/ Street$/, ' St'], [/ Avenue$/, ' Ave'], [/ Drive$/, ' Dr'], [/ Boulevard$/, ' Blvd'], [/ Road$/, ' Rd']];

function prepare(map: GameMap): Prepared {
  const hit = prepared.get(map);
  if (hit) return hit;
  const v = map.vectors!;
  const lines = v.lines.map((l) => ({ ...l, b: boxOf(l.p) }));
  const areas = v.areas.map((a) => ({ ...a, b: boxOf(a.p) }));
  const buildings = map.buildings.map((m) => {
    const b = m.poly ? boxOf(m.poly) : { x0: m.x, y0: m.y, x1: m.x + m.w, y1: m.y + m.h };
    const lp = m.poly ? labelPoint(m.poly, b) : { x: m.x + m.w / 2, y: m.y + m.h / 2 };
    return { ...m, b, lx: lp.x, ly: lp.y };
  });
  // Street names go on the longest straight stretches, at least 70 tiles apart per name.
  const segs: { name: string; x: number; y: number; a: number; len: number }[] = [];
  for (const l of lines) {
    if (!l.name || !ROAD_KINDS.has(l.k) || l.k === 'service') continue;
    for (let i = 0; i + 3 < l.p.length; i += 2) {
      const dx = l.p[i + 2] - l.p[i], dy = l.p[i + 3] - l.p[i + 1], len = Math.hypot(dx, dy);
      if (len < 14) continue;
      let a = Math.atan2(dy, dx);
      if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
      const name = SHORT.reduce((s, [re, to]) => s.replace(re, to), l.name);
      segs.push({ name, x: (l.p[i] + l.p[i + 2]) / 2, y: (l.p[i + 1] + l.p[i + 3]) / 2, a, len });
    }
  }
  segs.sort((p, q) => q.len - p.len);
  const roadLabels: Prepared['roadLabels'] = [];
  for (const s of segs) {
    if (s.x < 4 || s.y < 2 || s.x > map.w - 4 || s.y > map.h - 2) continue;
    if (roadLabels.some((r) => r.name === s.name && Math.hypot(r.x - s.x, r.y - s.y) < 70)) continue;
    roadLabels.push(s);
  }
  const out = { lines, areas, buildings, roadLabels };
  prepared.set(map, out);
  return out;
}

function tracePoly(c: CanvasRenderingContext2D, p: number[], close = true) {
  c.beginPath();
  c.moveTo(p[0] * TS, p[1] * TS);
  for (let i = 2; i < p.length; i += 2) c.lineTo(p[i] * TS, p[i + 1] * TS);
  if (close) c.closePath();
}

const AREA_FILL: Record<string, string> = {
  park: '#77a659', pitch: '#4f9a45', parking: '#8f9196', water: '#4f86b8', plaza: '#b4644e', construction: '#a5845e',
};
// Street widths in tiles, matching the rasterized widths in src/maps/campus.ts.
const ROAD_W: Record<string, number> = { primary: 4, secondary: 3.2, tertiary: 2.4, residential: 2.2, service: 1.5, aisle: 1.2 };
const ROAD_ORDER = ['aisle', 'service', 'residential', 'tertiary', 'secondary', 'primary'];

function drawLines(c: CanvasRenderingContext2D, ls: Prepared['lines'], overview: boolean) {
  c.lineJoin = 'round'; c.lineCap = 'round';
  const stroke = (l: MapLine, w: number, col: string, dash: number[] = []) => {
    tracePoly(c, l.p, false);
    c.lineWidth = w; c.strokeStyle = col; c.setLineDash(dash); c.stroke();
  };
  const paths = ls.filter((l) => (l.k === 'path' || l.k === 'steps') && !l.tunnel && !l.bridge);
  const roads = ls.filter((l) => ROAD_KINDS.has(l.k) && !l.bridge).sort((a, b) => ROAD_ORDER.indexOf(a.k) - ROAD_ORDER.indexOf(b.k));
  // Paths: a soft edge, then concrete
  for (const l of paths) stroke(l, overview ? 14 : 24, '#b9b09c');
  for (const l of paths) stroke(l, overview ? 10 : 19, l.k === 'steps' ? '#cfc6b2' : '#e2dbca');
  if (!overview) for (const l of paths) if (l.k === 'steps') stroke(l, 19, 'rgba(0,0,0,0.18)', [2, 5]);
  // Streets: kerb, asphalt, then markings
  for (const l of roads) stroke(l, ROAD_W[l.k] * TS + 6, '#cfc8b8');
  for (const l of roads) stroke(l, ROAD_W[l.k] * TS, l.k === 'aisle' ? '#5a5c62' : '#4a4c52');
  if (!overview) for (const l of roads) {
    if (l.k === 'primary') stroke(l, 2.5, '#e6c84a');
    else if (l.k === 'secondary' || l.k === 'tertiary') stroke(l, 2, '#e6c84a', [14, 12]);
  }
  // The railroad: ballast, ties, two rails
  const rail = ls.filter((l) => l.k === 'rail');
  for (const l of rail) stroke(l, 2.2 * TS, '#8a7d6b');
  if (!overview) {
    for (const l of rail) stroke(l, 1.4 * TS, '#5b4a3a', [5, 6]);
    for (const l of rail) { stroke(l, 0.95 * TS, '#c9c9c9'); stroke(l, 0.95 * TS - 5, '#5b4a3a', [5, 6]); }
  }
  // Passages under the tracks: dark, and the Free Expression Tunnel painted
  for (const l of ls) {
    if (!l.tunnel) continue;
    const w = l.k === 'path' ? 26 : (ROAD_W[l.k] ?? 1.5) * TS;
    stroke(l, w + 6, '#2c2c33');
    stroke(l, w, '#4b4b55');
    if (l.name && !overview) {
      // Layers of paint: short butt-ended dashes in each colour, offset from one another
      const paint = ['#e74c3c', '#f1c40f', '#3498db', '#9b59b6', '#2ecc71', '#f5f5f5'];
      c.lineCap = 'butt';
      paint.forEach((col, i) => { c.lineDashOffset = i * 5; stroke(l, w - 8 - (i % 2) * 6, col, [3, 27]); });
      c.lineDashOffset = 0; c.lineCap = 'round';
    }
  }
  // Bridges sit on top: streets with a dark parapet, footbridges with a thin rail
  for (const l of ls) {
    if (!l.bridge || l.k === 'rail') continue;
    const foot = l.k === 'path' || l.k === 'steps';
    const w = foot ? 19 : (ROAD_W[l.k] ?? 1.5) * TS;
    stroke(l, w + (foot ? 5 : 8), foot ? '#9a907c' : '#3a3a40');
    stroke(l, w, foot ? '#e2dbca' : '#4a4c52');
  }
  c.setLineDash([]);
}

function drawBuilding(c: CanvasRenderingContext2D, m: PBuilding, overview: boolean) {
  const [fill, edge] = STYLE[m.style];
  const trace = () => { if (m.poly) tracePoly(c, m.poly); else { c.beginPath(); c.rect(m.x * TS, m.y * TS, m.w * TS, m.h * TS); } };
  c.save();
  c.translate(overview ? 3 : 5, overview ? 4 : 7); trace(); c.fillStyle = 'rgba(25,30,20,0.28)'; c.fill();
  c.restore();
  trace(); c.fillStyle = fill; c.fill();
  if (!overview) {
    c.save(); trace(); c.clip();
    if (BRICK.has(m.style)) {
      c.strokeStyle = 'rgba(60,20,10,0.13)'; c.lineWidth = 1;
      for (let y = Math.floor((m.b.y0 * TS) / 6) * 6; y < m.b.y1 * TS; y += 6) { c.beginPath(); c.moveTo(m.b.x0 * TS, y + 0.5); c.lineTo(m.b.x1 * TS, y + 0.5); c.stroke(); }
    } else if (m.style === 'closed') {
      c.strokeStyle = 'rgba(30,20,10,0.25)'; c.lineWidth = 3;
      const h = (m.b.y1 - m.b.y0) * TS;
      for (let k = m.b.x0 * TS - h; k < m.b.x1 * TS; k += 14) { c.beginPath(); c.moveTo(k, m.b.y1 * TS); c.lineTo(k + h, m.b.y0 * TS); c.stroke(); }
    }
    // A lighter roof band inside the edge
    trace(); c.strokeStyle = shade(fill, 24); c.lineWidth = 8; c.stroke();
    c.restore();
  }
  trace(); c.strokeStyle = edge; c.lineWidth = overview ? 2 : 2.5; c.lineJoin = 'round'; c.stroke();
}

const LABEL_FONT = "'Segoe UI Semibold', 'Helvetica Neue', system-ui, sans-serif";

function drawBuildingLabel(c: CanvasRenderingContext2D, m: PBuilding, scale: number) {
  if (!m.name || m.label === false) return;
  const overview = scale < 0.5;
  if (overview && !m.major) return;
  const wpx = (m.b.x1 - m.b.x0) * TS, hpx = (m.b.y1 - m.b.y0) * TS;
  const size = overview ? 17 / scale : Math.max(11, Math.min(17, Math.sqrt(wpx * hpx) / 14));
  c.font = `600 ${size}px ${LABEL_FONT}`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const lines = wrapText(c, m.name, Math.max(overview ? 7 * size : wpx - 8, 70));
  const lh = size * 1.15;
  lines.forEach((ln, i) => {
    const x = m.lx * TS, y = m.ly * TS + (i - (lines.length - 1) / 2) * lh;
    c.lineWidth = overview ? 4 / scale : 3.5; c.strokeStyle = 'rgba(30,14,10,0.8)'; c.lineJoin = 'round'; c.strokeText(ln, x, y);
    c.fillStyle = m.style === 'offcampus' ? '#eee8dc' : '#fff8ef'; c.fillText(ln, x, y);
  });
}

/**
 * Draws part of a map: `w` x `h` tiles from (x0, y0), at `scale` canvas pixels per world pixel.
 * Features that cross the edge are drawn whole and clipped, so neighbouring chunks line up.
 */
export function renderRegion(map: GameMap, x0: number, y0: number, w: number, h: number, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * TS * scale);
  canvas.height = Math.ceil(h * TS * scale);
  const c = canvas.getContext('2d')!;
  c.scale(scale, scale);
  c.translate(-x0 * TS, -y0 * TS);
  const overview = scale < 0.5;
  const tx0 = Math.max(0, x0), ty0 = Math.max(0, y0), tx1 = Math.min(map.w, x0 + w), ty1 = Math.min(map.h, y0 + h);
  const tiles = (fn: (x: number, y: number, i: number) => void) => {
    for (let y = ty0; y < ty1; y++) for (let x = tx0; x < tx1; x++) fn(x, y, y * map.w + x);
  };

  if (!map.vectors) {
    tiles((x, y, i) => drawGround(c, map.ground[i], x, y, map));
    drawRectBuildings(c, map);
    tiles((x, y, i) => { const o = map.obj[i]; if (o) drawObj(c, o, x, y); });
    drawLabels(c, map, { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity });
    return canvas;
  }

  const P = prepare(map);
  const pad = 10; // tiles: wide strokes and labels that start outside still reach in
  const view: Box = { x0: x0 - pad, y0: y0 - pad, x1: x0 + w + pad, y1: y0 + h + pad };

  if (overview) { c.fillStyle = GROUND.grass; c.fillRect(x0 * TS, y0 * TS, w * TS, h * TS); }
  else tiles((x, y) => drawGround(c, 'grass', x, y, map));

  for (const a of P.areas) {
    if (!hits(a.b, view) || !AREA_FILL[a.k]) continue;
    tracePoly(c, a.p); c.fillStyle = AREA_FILL[a.k]; c.fill();
    if (overview) continue;
    if (a.k === 'plaza') {
      c.save(); tracePoly(c, a.p); c.clip();
      c.strokeStyle = 'rgba(60,20,10,0.3)'; c.lineWidth = 1;
      for (let y = Math.floor(a.b.y0 * TS / 8) * 8; y < a.b.y1 * TS; y += 8) {
        c.beginPath(); c.moveTo(a.b.x0 * TS, y + 0.5); c.lineTo(a.b.x1 * TS, y + 0.5); c.stroke();
        for (let x = Math.floor(a.b.x0 * TS / 16) * 16 + ((y / 8) % 2) * 8; x < a.b.x1 * TS; x += 16) { c.beginPath(); c.moveTo(x + 0.5, y); c.lineTo(x + 0.5, y + 8); c.stroke(); }
      }
      c.restore();
      tracePoly(c, a.p); c.strokeStyle = '#7d3a2b'; c.lineWidth = 2; c.stroke();
    } else if (a.k === 'pitch') { c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 2; c.stroke(); }
    else if (a.k === 'parking') { c.strokeStyle = '#d6d3cc'; c.lineWidth = 2; c.stroke(); }
    else if (a.k === 'water') { c.strokeStyle = '#3c6f9c'; c.lineWidth = 2; c.stroke(); }
  }
  drawLines(c, P.lines.filter((l) => hits(l.b, view)), overview);

  const bs = P.buildings.filter((m) => hits(m.b, view));
  for (const m of bs) drawBuilding(c, m, overview);
  if (!overview) tiles((x, y, i) => {
    if (map.ground[i] === 'door') drawGround(c, 'door', x, y, map);
    const o = map.obj[i];
    if (o) drawObj(c, o, x, y);
  });

  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const r of P.roadLabels) {
    if (r.x < view.x0 || r.x > view.x1 || r.y < view.y0 || r.y > view.y1) continue;
    const size = overview ? 13 / scale : 13;
    c.save(); c.translate(r.x * TS, r.y * TS); c.rotate(r.a);
    c.font = `600 ${size}px ${LABEL_FONT}`;
    c.lineWidth = overview ? 3 / scale : 3; c.strokeStyle = 'rgba(20,20,24,0.85)'; c.lineJoin = 'round';
    c.strokeText(r.name, 0, 0); c.fillStyle = '#f2efe6'; c.fillText(r.name, 0, 0);
    c.restore();
  }
  for (const m of bs) drawBuildingLabel(c, m, scale);
  if (!overview) drawLabels(c, map, view);
  return canvas;
}

/** The whole map in one canvas. Used for interiors, which are small. */
export function renderMap(map: GameMap): HTMLCanvasElement {
  return renderRegion(map, 0, 0, map.w, map.h, 1);
}

function drawRectBuildings(c: CanvasRenderingContext2D, map: GameMap) {
  for (const b of map.buildings) {
    const [fill, edge] = STYLE[b.style];
    const px = b.x * TS, py = b.y * TS, w = b.w * TS, h = b.h * TS;
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(px + 5, py + 6, w, h);
    c.fillStyle = fill; c.fillRect(px, py, w, h);
    c.fillStyle = shade(fill, 18); c.fillRect(px + 4, py + 4, w - 8, h - 8);
    c.strokeStyle = edge; c.lineWidth = 3; c.strokeRect(px + 1.5, py + 1.5, w - 3, h - 3);
    // Doors drawn over the footprint stay visible
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (map.ground[y * map.w + x] === 'door') drawGround(c, 'door', x, y, map);
    }
    const size = b.w >= 10 ? 15 : 12;
    c.font = `600 ${size}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const lines = wrapText(c, b.name, w - 10);
    lines.forEach((ln, i) => outlinedText(c, ln, px + w / 2, py + h / 2 + (i - (lines.length - 1) / 2) * (size + 2)));
  }
}

function drawLabels(c: CanvasRenderingContext2D, map: GameMap, view: Box) {
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const l of map.labels) {
    if (l.x < view.x0 || l.x > view.x1 || l.y < view.y0 || l.y > view.y1) continue;
    const px = l.x * TS + TS / 2, py = l.y * TS + TS / 2;
    if (l.kind === 'road') {
      c.font = '600 13px system-ui, sans-serif'; outlinedText(c, l.text, px, py + 16, '#f5f5f5', 'rgba(0,0,0,0.6)');
    } else if (l.kind === 'roadV') {
      c.save(); c.translate(px + 16, py); c.rotate(-Math.PI / 2);
      c.font = '600 13px system-ui, sans-serif'; outlinedText(c, l.text, 0, 0, '#f5f5f5', 'rgba(0,0,0,0.6)'); c.restore();
    } else if (l.kind === 'sign') {
      c.font = '700 13px system-ui, sans-serif';
      const w = c.measureText(l.text).width + 14;
      c.fillStyle = 'rgba(20,20,26,0.82)'; c.fillRect(px - w / 2, py - 10, w, 20);
      c.fillStyle = '#ffd9d9'; c.fillText(l.text, px, py + 1);
    } else if (l.kind === 'zone') {
      c.font = '700 20px system-ui, sans-serif'; c.globalAlpha = 0.55; outlinedText(c, l.text, px, py, '#fff', 'rgba(0,0,0,0.6)'); c.globalAlpha = 1;
    } else {
      c.font = 'italic 600 12px system-ui, sans-serif'; outlinedText(c, l.text, px, py, '#fff4c2');
    }
  }
}

export interface PersonColors { skin: string; hair: string; shirt: string; pants: string }

/** A 32x32 top-down person. */
export function renderPerson(col: PersonColors, highlight = false): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = TS; cv.height = TS;
  const c = cv.getContext('2d')!;
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(16, 28, 9, 4, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = col.pants; c.fillRect(11, 20, 4, 8); c.fillRect(17, 20, 4, 8);
  c.fillStyle = col.shirt; c.beginPath(); c.roundRect(9, 11, 14, 12, 4); c.fill();
  c.fillStyle = col.skin; c.beginPath(); c.arc(16, 9, 6, 0, Math.PI * 2); c.fill();
  c.fillStyle = col.hair; c.beginPath(); c.arc(16, 7, 6, Math.PI, Math.PI * 2); c.fill(); c.fillRect(10, 6, 12, 2);
  if (highlight) { c.strokeStyle = '#ffd34d'; c.lineWidth = 2; c.beginPath(); c.arc(16, 16, 14, 0, Math.PI * 2); c.stroke(); }
  return cv;
}
