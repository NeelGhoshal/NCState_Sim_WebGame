// Draws a GameMap to offscreen canvases. No art assets: everything is shapes.
// Interiors are drawn tile by tile in one canvas. Maps with vector data (the OSM campus) are
// drawn in chunks: lawn tiles first, then smooth areas, streets, paths and the railroad, then
// building outlines in brick, then labels. Collision still uses the tile grid.
import type { BuildingMeta, BuildingStyle, GameMap, Ground, MapArea, MapLine, Obj } from '../engine/types';
import type { RoadNet } from '../engine/roads';

export const TS = 32;

/** A canvas on the main thread, or an OffscreenCanvas inside the map worker. */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** CPU-backed canvases: they become WebGL textures, and reading a GPU canvas back for the
 * upload costs 50-150 ms per chunk. */
export function makeCanvas(w: number, h: number): { canvas: AnyCanvas; c: CanvasRenderingContext2D } {
  if (typeof document === 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, c: canvas.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return { canvas, c: canvas.getContext('2d', { willReadFrequently: true })! };
}

const GROUND: Record<Ground, string> = {
  void: '#111317', grass: '#6b9b52', sidewalk: '#d3ccbc', plaza: '#a65a45', roadH: '#4a4b51', roadV: '#4a4b51',
  roadX: '#4a4b51', crosswalk: '#4a4b51', rail: '#7b7266', tunnel: '#3a3a42', parking: '#8c8c8c', field: '#4e9a40',
  water: '#4f86b8', site: '#a5845e', bldg: '#9a9a9a', door: '#8b5a2b', floor: '#e2dccf', tile: '#ebe8e1',
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
  if (g !== 'door') c.fillRect(px, py, TS, TS); // doors draw only their opening, over a wall or a building
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
      // Large stone slabs (two tiles each), a faint grout line, barely-there tone shifts
      c.fillStyle = `rgba(120,110,95,${0.03 + n * 0.035})`; c.fillRect(px, py, TS, TS);
      c.fillStyle = 'rgba(110,100,85,0.16)';
      if (x % 2 === 0) c.fillRect(px, py, 1, TS);
      if (y % 2 === 0) c.fillRect(px, py, TS, 1);
      break;
    case 'floor':
      c.fillStyle = `rgba(120,100,70,${0.02 + n * 0.03})`; c.fillRect(px, py, TS, TS);
      c.fillStyle = 'rgba(110,95,70,0.12)'; c.fillRect(px, py + TS - 1, TS, 1); break;
    case 'carpet':
      c.fillStyle = 'rgba(255,255,255,0.04)'; if ((x + y) % 2) c.fillRect(px, py, TS, TS); break;
    case 'wood':
      c.strokeStyle = 'rgba(80,40,10,0.25)'; for (let k = 0; k < TS; k += 8) { c.beginPath(); c.moveTo(px, py + k + 0.5); c.lineTo(px + TS, py + k + 0.5); c.stroke(); } break;
    case 'wall':
      // Seen from above: a lighter cap over the face
      c.fillStyle = '#3d3e4a'; c.fillRect(px, py, TS, TS);
      c.fillStyle = '#545565'; c.fillRect(px, py, TS, 6);
      c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(px, py + 6, TS, 1);
      break;
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
    case 'door': {
      // A doorway on the side that opens onto walkable ground: a dark opening with a pale step
      const open = (dx: number, dy: number) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) return false;
        const g2 = map.ground[ny * map.w + nx];
        return g2 !== 'bldg' && g2 !== 'wall' && g2 !== 'door' && g2 !== 'void' && g2 !== 'glass';
      };
      const dirs: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      const [dx, dy] = dirs.find(([a, b]) => open(a, b)) ?? [0, 1];
      if (!map.vectors) { c.fillStyle = GROUND.floor; c.fillRect(px, py, TS, TS); }
      c.fillStyle = '#2b211b';
      if (dy) c.fillRect(px + 6, dy > 0 ? py + TS - 12 : py, TS - 12, 12);
      else c.fillRect(dx > 0 ? px + TS - 12 : px, py + 6, 12, TS - 12);
      c.fillStyle = '#d8cfbd';
      if (dy) c.fillRect(px + 4, dy > 0 ? py + TS - 3 : py, TS - 8, 3);
      else c.fillRect(dx > 0 ? px + TS - 3 : px, py + 4, 3, TS - 8);
      break;
    }
    default: break;
  }
}

function drawObj(c: CanvasRenderingContext2D, o: Obj, x: number, y: number, map: GameMap) {
  const px = x * TS, py = y * TS;
  /** Same object next door, so runs of tables and counters draw as one piece. */
  const same = (dx: number, dy: number) => {
    const nx = x + dx, ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && map.obj[ny * map.w + nx] === o;
  };
  /** A rounded box that joins its neighbours on the left and right, with a soft shadow. */
  const piece = (top: number, h: number, fill: string, edge: string, r = 5) => {
    const l = same(-1, 0), rt = same(1, 0);
    const x0 = px + (l ? 0 : 2), x1 = px + TS - (rt ? 0 : 2);
    const radii = [l ? 0 : r, rt ? 0 : r, rt ? 0 : r, l ? 0 : r];
    c.fillStyle = 'rgba(40,30,20,0.18)'; c.beginPath(); c.roundRect(x0 + 1, py + top + 3, x1 - x0, h, radii); c.fill();
    c.fillStyle = fill; c.beginPath(); c.roundRect(x0, py + top, x1 - x0, h, radii); c.fill();
    c.fillStyle = edge; c.fillRect(x0 + (l ? 0 : 2), py + top + h - 3, x1 - x0 - (l ? 0 : 2) - (rt ? 0 : 2), 3);
  };
  switch (o) {
    case 'tree': {
      // The crown varies a little per tree so rows of trees do not look stamped
      const v = noise(x * 3, y * 5);
      const r = 12 + v * 3;
      c.fillStyle = 'rgba(20,40,15,0.22)'; c.beginPath(); c.ellipse(px + 19, py + 23, r, r * 0.55, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = v > 0.5 ? '#2e6a33' : '#2a6230'; c.beginPath(); c.arc(px + 16, py + 14, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = v > 0.5 ? '#3c8441' : '#377a3b'; c.beginPath(); c.arc(px + 13, py + 11, r * 0.62, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,220,0.12)'; c.beginPath(); c.arc(px + 11, py + 8, r * 0.3, 0, Math.PI * 2); c.fill();
      break;
    }
    case 'fence':
      c.strokeStyle = '#e0a020'; c.lineWidth = 3; c.strokeRect(px + 4, py + 4, TS - 8, TS - 8);
      c.strokeStyle = '#333'; c.lineWidth = 1; c.beginPath(); c.moveTo(px + 4, py + 4); c.lineTo(px + TS - 4, py + TS - 4); c.stroke(); break;
    case 'counter': {
      piece(3, TS - 6, '#8a5b37', '#6a4227', 4);
      const l = same(-1, 0) ? 0 : 4, r = same(1, 0) ? 0 : 4;
      c.fillStyle = 'rgba(255,240,220,0.18)'; c.fillRect(px + l, py + 5, TS - l - r, 3);
      break;
    }
    case 'table': {
      piece(6, TS - 12, '#a5754b', '#7f5532', 6);
      const l = same(-1, 0) ? 0 : 5, r = same(1, 0) ? 0 : 5;
      c.fillStyle = 'rgba(255,235,210,0.16)'; c.fillRect(px + l, py + 8, TS - l - r, 2);
      break;
    }
    case 'seatN': case 'seatS': {
      // Booth bench: a high back away from the table, a cushion toward it
      const back = o === 'seatN' ? py + 2 : py + TS - 10;
      const seat = o === 'seatN' ? py + 10 : py + 4;
      const l = same(-1, 0) ? 0 : 2, r = same(1, 0) ? 0 : 2;
      c.fillStyle = '#7d2323'; c.beginPath(); c.roundRect(px + l, back, TS - l - r, 8, 3); c.fill();
      c.fillStyle = '#a83434'; c.beginPath(); c.roundRect(px + l + 1, seat, TS - l - r - 2, 16, 4); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(px + l + 3, seat + 2, TS - l - r - 6, 2);
      break;
    }
    case 'chair':
      c.fillStyle = 'rgba(40,30,20,0.16)'; c.beginPath(); c.roundRect(px + 9, py + 11, 15, 15, 4); c.fill();
      c.fillStyle = '#5d6170'; c.beginPath(); c.roundRect(px + 8, py + 9, 16, 15, 4); c.fill();
      c.fillStyle = '#767b8c'; c.beginPath(); c.roundRect(px + 10, py + 11, 12, 9, 3); c.fill();
      break;
    case 'sofa': {
      const l = same(-1, 0) ? 0 : 1, r = same(1, 0) ? 0 : 1;
      c.fillStyle = '#34446e'; c.beginPath(); c.roundRect(px + l, py + 5, TS - l - r, 22, 5); c.fill();
      c.fillStyle = '#4f6299'; c.beginPath(); c.roundRect(px + l + 2, py + 11, TS - l - r - 4, 13, 4); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(px + l + 4, py + 13, TS - l - r - 8, 2);
      break;
    }
    case 'shelf': {
      c.fillStyle = '#5d4227'; c.fillRect(px, py + 4, TS, TS - 8);
      const cols = ['#c0392b', '#2980b9', '#f39c12', '#27ae60', '#ecf0f1'];
      for (let k = 0; k < 5; k++) { c.fillStyle = cols[(x + y + k) % cols.length]; c.fillRect(px + 2 + k * 6, py + 7, 4, 18); }
      break;
    }
    case 'fridge':
      c.fillStyle = '#e8f1f7'; c.fillRect(px + 1, py + 1, TS - 2, TS - 2); c.fillStyle = '#9fc6df'; c.fillRect(px + 4, py + 4, TS - 8, TS - 14); break;
    case 'plant': {
      c.fillStyle = 'rgba(40,30,20,0.18)'; c.beginPath(); c.ellipse(px + 17, py + 27, 8, 3, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#b5764a'; c.beginPath(); c.roundRect(px + 10, py + 18, 12, 9, [2, 2, 4, 4]); c.fill();
      const leaves: [number, number, number, string][] = [[-4, -1, 6, '#2f7a3a'], [4, -2, 6, '#2f7a3a'], [0, -6, 6.5, '#3d9147'], [0, -1, 5, '#4ea457']];
      for (const [ox, oy, r, col] of leaves) { c.fillStyle = col; c.beginPath(); c.arc(px + 16 + ox, py + 15 + oy, r, 0, Math.PI * 2); c.fill(); }
      break;
    }
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

// ---------------------------------------------------------------- lawn texture

let lawn: AnyCanvas | null = null;

/** A 256 px tile of mown grass: soft light and dark patches, then fine blades. Built once. */
function lawnTile(): AnyCanvas {
  if (lawn) return lawn;
  const N = 256;
  const { canvas, c } = makeCanvas(N, N);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  c.fillStyle = GROUND.grass; c.fillRect(0, 0, N, N);
  // Patches, drawn wrapped so the tile repeats without a seam
  const blob = (x: number, y: number, r: number, col: string) => {
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  };
  for (let i = 0; i < 14; i++) blob(rnd() * N, rnd() * N, 30 + rnd() * 50, rnd() > 0.5 ? 'rgba(150,190,90,0.10)' : 'rgba(40,70,25,0.10)');
  // Blades
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * N, y = rnd() * N, len = 2 + rnd() * 3;
    c.strokeStyle = rnd() > 0.5 ? 'rgba(160,200,110,0.22)' : 'rgba(35,65,25,0.22)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rnd() - 0.5) * 1.5, y - len); c.stroke();
  }
  lawn = canvas;
  return canvas;
}

// ---------------------------------------------------------------- vector maps

interface Box { x0: number; y0: number; x1: number; y1: number }
/** A wall that faces the viewer: its base edge in pixels and how much it turns east (-1..1). */
interface Wall { ax: number; ay: number; bx: number; by: number; turn: number; mid: number }
type PBuilding = BuildingMeta & { b: Box; lx: number; ly: number; h: number; walls: Wall[] };

/** Pixels of height per floor, and the cap, so tall towers overlap the walk north of them by
 * at most about two tiles. The camera looks from the south: roofs shift up, south walls show. */
export const LEVEL_PX = 7;
export const MAX_HEIGHT_PX = 72;

/** Even-odd point-in-polygon on a flat [x0,y0,x1,y1,...] list. */
function insidePoly(x: number, y: number, p: number[]) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The walls of a footprint that face south, so the viewer can see them. */
function southWalls(p: number[]): Wall[] {
  const out: Wall[] = [];
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    const ax = p[i], ay = p[i + 1], bx = p[j], by = p[j + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.05) continue;
    let nx = -(by - ay) / len, ny = (bx - ax) / len;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    if (insidePoly(mx + nx * 0.05, my + ny * 0.05, p)) { nx = -nx; ny = -ny; }
    if (ny <= 0.08) continue;
    out.push({ ax: ax * TS, ay: ay * TS, bx: bx * TS, by: by * TS, turn: nx, mid: my });
  }
  return out.sort((a, b) => a.mid - b.mid);
}
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
  const buildings = map.buildings.slice().sort((p, q) => (p.y + p.h) - (q.y + q.h)).map((m) => {
    const b = m.poly ? boxOf(m.poly) : { x0: m.x, y0: m.y, x1: m.x + m.w, y1: m.y + m.h };
    const lp = m.poly ? labelPoint(m.poly, b) : { x: m.x + m.w / 2, y: m.y + m.h / 2 };
    const h = Math.min(MAX_HEIGHT_PX, (m.levels ?? 2) * LEVEL_PX);
    const walls = m.poly ? southWalls(m.poly) : [];
    return { ...m, b, lx: lp.x, ly: lp.y - h / TS, h, walls };
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

/** Zebra crosswalks and stop lines at signalized junctions. */
function drawRoadMarks(c: CanvasRenderingContext2D, net: RoadNet, view: Box) {
  const near = (x: number, y: number) => x >= view.x0 && x <= view.x1 && y >= view.y0 && y <= view.y1;
  c.setLineDash([]);
  c.lineCap = 'butt';
  c.strokeStyle = '#f1f1ec';
  for (const k of net.crossings) {
    if (!near(k.x0, k.y0)) continue;
    // Bars run along the street, spaced across it
    const dx = k.x1 - k.x0, dy = k.y1 - k.y0, len = Math.hypot(dx, dy);
    c.lineWidth = 0.17 * TS;
    c.beginPath();
    for (let s = 0.18; s < len - 0.1; s += 0.36) {
      const x = k.x0 + (dx / len) * s, y = k.y0 + (dy / len) * s;
      c.moveTo((x - k.tx * 0.42) * TS, (y - k.ty * 0.42) * TS);
      c.lineTo((x + k.tx * 0.42) * TS, (y + k.ty * 0.42) * TS);
    }
    c.stroke();
  }
  c.lineWidth = 0.14 * TS;
  c.beginPath();
  for (const l of net.stopLines) {
    if (!near(l.x0, l.y0)) continue;
    c.moveTo(l.x0 * TS, l.y0 * TS); c.lineTo(l.x1 * TS, l.y1 * TS);
  }
  c.stroke();
  c.lineCap = 'round';
}

/** Air handlers and stair housings on big roofs: small boxes with their own south face. */
function drawRooftop(c: CanvasRenderingContext2D, m: PBuilding) {
  if (!m.poly || m.style === 'parking' || m.style === 'closed') return;
  const area = (m.b.x1 - m.b.x0) * (m.b.y1 - m.b.y0);
  if (area < 50) return;
  const count = area > 400 ? 3 : area > 150 ? 2 : 1;
  const cx = (m.b.x0 + m.b.x1) / 2, cy = (m.b.y0 + m.b.y1) / 2;
  for (let i = 0; i < count; i++) {
    // Spread along the long side, nudged by a stable per-building value
    const v = noise(Math.round(cx * 7) + i, Math.round(cy * 5));
    const along = (i - (count - 1) / 2) * 0.28 + (v - 0.5) * 0.12;
    const wide = m.b.x1 - m.b.x0 >= m.b.y1 - m.b.y0;
    const tx = wide ? cx + along * (m.b.x1 - m.b.x0) : cx + (v - 0.5) * 2;
    const ty = wide ? cy + (v - 0.5) * 2 + 1.2 : cy + along * (m.b.y1 - m.b.y0);
    const w = 12 + v * 8, h = 9 + v * 4, rise = 4;
    const x = tx * TS - w / 2, y = ty * TS - h / 2;
    // Keep the whole box on the roof
    if (![[x, y], [x + w, y], [x, y + h], [x + w, y + h]].every(([px, py]) => insidePoly(px / TS, py / TS, m.poly!))) continue;
    c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(x + 3, y + 3, w, h);
    c.fillStyle = '#8b8d93'; c.fillRect(x, y + h - rise, w, rise);
    c.fillStyle = '#b9bcc2'; c.fillRect(x, y - rise, w, h);
    c.strokeStyle = 'rgba(40,40,48,0.55)'; c.lineWidth = 1; c.strokeRect(x + 0.5, y - rise + 0.5, w - 1, h + rise - 1);
    c.fillStyle = 'rgba(60,62,70,0.45)'; c.fillRect(x + 3, y - rise + 2, w - 6, 1.2); c.fillRect(x + 3, y - rise + 5, w - 6, 1.2);
  }
}

/** The ground shadow, drawn for every building before any walls so it never covers one. */
function drawBuildingShadow(c: CanvasRenderingContext2D, m: PBuilding) {
  if (!m.poly) return;
  // Sun from the north-west: longer shadows for taller buildings, falling south-east
  const sx = 3 + m.h * 0.45, sy = 4 + m.h * 0.2;
  c.save(); c.translate(sx, sy); tracePoly(c, m.poly); c.restore();
  c.fillStyle = 'rgba(20,28,16,0.26)'; c.fill();
}

function drawBuilding(c: CanvasRenderingContext2D, m: PBuilding, overview: boolean) {
  const [fill, edge] = STYLE[m.style];
  if (!m.poly) {
    c.fillStyle = fill; c.fillRect(m.x * TS, m.y * TS, m.w * TS, m.h * TS);
    return;
  }
  const H = m.h;
  const brick = BRICK.has(m.style);

  // Walls: each south-facing edge rises H pixels. Walls turned east catch the light.
  for (const w of m.walls) {
    const quad = () => {
      c.beginPath(); c.moveTo(w.ax, w.ay); c.lineTo(w.bx, w.by); c.lineTo(w.bx, w.by - H); c.lineTo(w.ax, w.ay - H); c.closePath();
    };
    quad(); c.fillStyle = shade(fill, -34 + w.turn * 16); c.fill();
    if (!overview && H >= 6) {
      c.save(); quad(); c.clip();
      const dx = w.bx - w.ax, dy = w.by - w.ay, len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      if (brick) {
        // Brick courses follow the wall
        c.strokeStyle = 'rgba(40,12,6,0.16)'; c.lineWidth = 1;
        for (let k = 2; k < H; k += 3) { c.beginPath(); c.moveTo(w.ax, w.ay - k); c.lineTo(w.bx, w.by - k); c.stroke(); }
      }
      if (m.style === 'parking') {
        // Open decks: a dark band on every level
        c.strokeStyle = 'rgba(25,25,30,0.55)'; c.lineWidth = 2.4;
        for (let lv = 0; lv < H / LEVEL_PX; lv++) { const k = lv * LEVEL_PX + 2.5; c.beginPath(); c.moveTo(w.ax, w.ay - k); c.lineTo(w.bx, w.by - k); c.stroke(); }
      } else if (len > 10) {
        // A row of windows per floor, set in from the corners
        c.lineCap = 'butt';
        const levels = Math.max(1, Math.round(H / LEVEL_PX));
        for (let lv = 0; lv < levels; lv++) {
          const k = lv * LEVEL_PX + 2.7;
          for (let t = 4; t + 4 < len - 3; t += 7.5) {
            const x0 = w.ax + ux * t, y0 = w.ay + uy * t - k;
            c.strokeStyle = 'rgba(28,36,52,0.62)'; c.lineWidth = 2.4;
            c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + ux * 4, y0 + uy * 4); c.stroke();
            c.strokeStyle = 'rgba(170,200,230,0.28)'; c.lineWidth = 0.8;
            c.beginPath(); c.moveTo(x0, y0 - 0.8); c.lineTo(x0 + ux * 4, y0 + uy * 4 - 0.8); c.stroke();
          }
        }
        c.lineCap = 'round';
      }
      // Ground contact and the top edge
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.beginPath(); c.moveTo(w.ax, w.ay); c.lineTo(w.bx, w.by); c.lineTo(w.bx, w.by - 2); c.lineTo(w.ax, w.ay - 2); c.closePath(); c.fill();
      c.restore();
    }
    quad(); c.strokeStyle = shade(edge, -10); c.lineWidth = overview ? 1.5 : 1.2; c.lineJoin = 'round'; c.stroke();
  }

  // Roof: the footprint lifted by H
  c.save(); c.translate(0, -H);
  tracePoly(c, m.poly); c.fillStyle = shade(fill, 6); c.fill();
  if (!overview) {
    c.save(); tracePoly(c, m.poly); c.clip();
    if (m.style === 'closed') {
      c.strokeStyle = 'rgba(30,20,10,0.25)'; c.lineWidth = 3;
      const span = (m.b.y1 - m.b.y0) * TS;
      for (let k = m.b.x0 * TS - span; k < m.b.x1 * TS; k += 14) { c.beginPath(); c.moveTo(k, m.b.y1 * TS); c.lineTo(k + span, m.b.y0 * TS); c.stroke(); }
    }
    // A parapet: a lighter band just inside the roof edge, and a soft inner shade
    tracePoly(c, m.poly); c.strokeStyle = shade(fill, 30); c.lineWidth = 6; c.stroke();
    tracePoly(c, m.poly); c.strokeStyle = 'rgba(0,0,0,0.08)'; c.lineWidth = 14; c.stroke();
    c.restore();
    drawRooftop(c, m);
  }
  tracePoly(c, m.poly); c.strokeStyle = edge; c.lineWidth = overview ? 2 : 2; c.lineJoin = 'round'; c.stroke();
  c.restore();
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
export function renderRegion(map: GameMap, x0: number, y0: number, w: number, h: number, scale = 1): AnyCanvas {
  const { canvas, c } = makeCanvas(Math.ceil(w * TS * scale), Math.ceil(h * TS * scale));
  c.scale(scale, scale);
  c.translate(-x0 * TS, -y0 * TS);
  const overview = scale < 0.5;
  const tx0 = Math.max(0, Math.floor(x0)), ty0 = Math.max(0, Math.floor(y0));
  const tx1 = Math.min(map.w, Math.ceil(x0 + w)), ty1 = Math.min(map.h, Math.ceil(y0 + h));
  const tiles = (fn: (x: number, y: number, i: number) => void) => {
    for (let y = ty0; y < ty1; y++) for (let x = tx0; x < tx1; x++) fn(x, y, y * map.w + x);
  };

  if (!map.vectors) {
    tiles((x, y, i) => drawGround(c, map.ground[i], x, y, map));
    // Walls cast a short shadow onto the floor below them
    tiles((x, y, i) => {
      if (y === 0 || map.ground[i] === 'wall' || map.ground[i - map.w] !== 'wall') return;
      const g = c.createLinearGradient(0, y * TS, 0, y * TS + 10);
      g.addColorStop(0, 'rgba(30,25,20,0.22)'); g.addColorStop(1, 'rgba(30,25,20,0)');
      c.fillStyle = g; c.fillRect(x * TS, y * TS, TS, 10);
    });
    drawRectBuildings(c, map);
    tiles((x, y, i) => { const o = map.obj[i]; if (o) drawObj(c, o, x, y, map); });
    drawLabels(c, map, { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity });
    return canvas;
  }

  const P = prepare(map);
  const pad = 10; // tiles: wide strokes and labels that start outside still reach in
  const view: Box = { x0: x0 - pad, y0: y0 - pad, x1: x0 + w + pad, y1: y0 + h + pad };

  if (overview) { c.fillStyle = GROUND.grass; c.fillRect(x0 * TS, y0 * TS, w * TS, h * TS); }
  else {
    // The pattern is anchored to world coordinates, so neighbouring chunks continue it seamlessly.
    c.fillStyle = c.createPattern(lawnTile() as CanvasImageSource, 'repeat')!;
    c.fillRect(x0 * TS, y0 * TS, w * TS, h * TS);
  }

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
    else if (a.k === 'parking') {
      c.strokeStyle = '#d6d3cc'; c.lineWidth = 2; c.stroke();
      // Designated parking: a blue P on lots big enough to park in
      if ((a.b.x1 - a.b.x0) * (a.b.y1 - a.b.y0) > 30) {
        const px = ((a.b.x0 + a.b.x1) / 2) * TS, py = ((a.b.y0 + a.b.y1) / 2) * TS;
        c.fillStyle = '#1f5fbf'; c.strokeStyle = '#f4f1ea'; c.lineWidth = 2;
        c.beginPath(); c.roundRect(px - 11, py - 11, 22, 22, 4); c.fill(); c.stroke();
        c.fillStyle = '#f4f1ea'; c.font = `bold 15px ${LABEL_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('P', px, py + 1);
      }
    }
    else if (a.k === 'water') { c.strokeStyle = '#3c6f9c'; c.lineWidth = 2; c.stroke(); }
  }
  drawLines(c, P.lines.filter((l) => hits(l.b, view)), overview);
  if (!overview && map.roads) drawRoadMarks(c, map.roads, view);

  // Roofs rise above the footprint, so look a little further south for buildings that reach in.
  const tall: Box = { ...view, y1: view.y1 + MAX_HEIGHT_PX / TS };
  const bs = P.buildings.filter((m) => hits(m.b, tall));
  for (const m of bs) drawBuildingShadow(c, m);
  for (const m of bs) drawBuilding(c, m, overview);
  if (!overview) tiles((x, y, i) => {
    if (map.ground[i] === 'door') drawGround(c, 'door', x, y, map);
    const o = map.obj[i];
    if (o) drawObj(c, o, x, y, map);
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

/**
 * Walkable tiles a person would be hidden behind a building on (its raised walls and roof
 * reach over them). 1 = covered. The scene draws people there see-through.
 */
export function roofCover(map: GameMap): Uint8Array {
  const mask = new Uint8Array(map.w * map.h);
  if (!map.vectors) return mask;
  for (const m of prepare(map).buildings) {
    if (!m.poly || m.h < 4) continue;
    const ht = m.h / TS;
    const x0 = Math.max(0, Math.floor(m.b.x0)), x1 = Math.min(map.w - 1, Math.ceil(m.b.x1));
    const y0 = Math.max(0, Math.floor(m.b.y0 - ht)), y1 = Math.min(map.h - 1, Math.ceil(m.b.y1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * map.w + x;
      if (mask[i] || map.ground[i] === 'bldg') continue;
      // The figure's head is about 0.4 tile above its tile centre; the building hides it when
      // a point of the head sits in front of the lifted footprint.
      for (let k = 0.2; k <= ht; k += 0.2) {
        if (insidePoly(x + 0.5, y + 0.15 + k, m.poly)) { mask[i] = 1; break; }
      }
    }
  }
  return mask;
}

/** The whole map in one canvas. Used for interiors, which are small. */
export function renderMap(map: GameMap): AnyCanvas {
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

export type Facing = 'down' | 'up' | 'side';
export const FACINGS: Facing[] = ['down', 'up', 'side'];
/** 0 = standing, 1 and 2 = the two steps of a walk. */
export const FRAMES = [0, 1, 2] as const;

const INK = 'rgba(28,20,16,0.85)';

/**
 * A 32x32 top-down person, three-quarter view, with an ink outline so it reads on any floor.
 * `side` faces right; flip it for left.
 */
export function renderPerson(col: PersonColors, facing: Facing = 'down', frame = 0): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = TS; cv.height = TS;
  const c = cv.getContext('2d')!;
  const step = frame === 0 ? 0 : frame === 1 ? 1 : -1;
  const bob = frame === 0 ? 0 : -1;
  const shape = (draw: () => void, fill: string) => { draw(); c.fillStyle = fill; c.fill(); c.lineWidth = 1.5; c.strokeStyle = INK; c.stroke(); };
  const rr = (x: number, y: number, w: number, h: number, r: number) => () => { c.beginPath(); c.roundRect(x, y + bob, w, h, r); };

  // Shadow
  c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.ellipse(16, 28.5, 8.5, 3.2, 0, 0, Math.PI * 2); c.fill();

  // Legs: they swing opposite each other while walking
  const pants = col.pants;
  if (facing === 'side') {
    shape(rr(13 + step * 2, 21, 4, 7, 2), shade(pants, -12));
    shape(rr(15 - step * 2, 21, 4, 7, 2), pants);
  } else {
    shape(rr(11.5, 21 - Math.max(0, step), 4, 7, 2), pants);
    shape(rr(16.5, 21 - Math.max(0, -step), 4, 7, 2), pants);
  }

  // Arms behind the body when facing away, in front otherwise
  const arm = (x: number, swing: number) => shape(rr(x, 13 + swing, 3.5, 8, 1.75), shade(col.shirt, -18));
  if (facing === 'side') arm(13.5 - step * 1.5, 0);
  else { arm(7.5, facing === 'down' ? -step : step); arm(21, facing === 'down' ? step : -step); }

  // Torso
  shape(rr(9.5, 12, 13, 11, 4.5), col.shirt);
  c.fillStyle = 'rgba(255,255,255,0.14)'; c.beginPath(); c.roundRect(11, 13 + bob, 10, 3, 1.5); c.fill();
  if (facing === 'side') arm(15 + step * 1.5, 0);

  // Head and hair
  const hx = facing === 'side' ? 17 : 16, hy = 8 + bob;
  shape(() => { c.beginPath(); c.arc(hx, hy, 6.2, 0, Math.PI * 2); }, col.skin);
  c.fillStyle = col.hair;
  c.beginPath();
  if (facing === 'up') c.arc(hx, hy, 6.4, 0, Math.PI * 2);
  else if (facing === 'side') { c.arc(hx - 0.5, hy - 0.5, 6.4, Math.PI * 0.75, Math.PI * 1.95); c.lineTo(hx - 6, hy + 3); }
  else { c.arc(hx, hy - 0.5, 6.4, Math.PI * 1.02, Math.PI * 1.98); c.quadraticCurveTo(hx, hy - 3, hx - 6.3, hy - 1); }
  c.fill(); c.lineWidth = 1.5; c.strokeStyle = INK; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.ellipse(hx - 2, hy - 4, 2.2, 1.1, -0.4, 0, Math.PI * 2); c.fill();

  // Face
  c.fillStyle = '#1d1612';
  if (facing === 'down') { c.fillRect(hx - 2.8, hy + 0.8, 1.6, 2); c.fillRect(hx + 1.2, hy + 0.8, 1.6, 2); }
  else if (facing === 'side') c.fillRect(hx + 2.6, hy + 0.6, 1.6, 2);
  return cv;
}

/** A small rounded name tag, drawn once per name. */
export function renderTag(text: string, accent: string): HTMLCanvasElement {
  const probe = document.createElement('canvas').getContext('2d')!;
  const font = `600 11px ${LABEL_FONT}`;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + 16, h = 17;
  const cv = document.createElement('canvas');
  cv.width = w * 2; cv.height = h * 2;
  const c = cv.getContext('2d')!;
  c.scale(2, 2);
  c.fillStyle = 'rgba(22,22,28,0.82)'; c.beginPath(); c.roundRect(0.5, 0.5, w - 1, h - 1, 8); c.fill();
  c.fillStyle = accent; c.beginPath(); c.arc(8, h / 2, 2.5, 0, Math.PI * 2); c.fill();
  c.font = font; c.fillStyle = '#f4f1ea'; c.textBaseline = 'middle'; c.fillText(text, 13, h / 2 + 0.5);
  return cv;
}

// ---------------------------------------------------------------- vehicles and signals
// Drawn once each on the main thread and reused as textures. Vehicles face east (+x); the scene
// rotates them. Sizes are in world pixels.

export const CAR_PALETTE = ['#c0392b', '#2c3e50', '#ecf0f1', '#7f8c8d', '#2471a3', '#1e8449', '#f0b429', '#1b1b1f'];

function vehicleCanvas(w: number, h: number) {
  const cv = document.createElement('canvas');
  cv.width = w + 4; cv.height = h + 4;
  const c = cv.getContext('2d')!;
  c.translate(2, 2);
  return { cv, c };
}

/** A car seen from above, 1.7 x 0.9 tiles. Brake lights glow when `braking`. */
export function renderCar(color: string, braking: boolean, stripe = false): HTMLCanvasElement {
  const w = Math.round(1.7 * TS), h = Math.round(0.9 * TS);
  const { cv, c } = vehicleCanvas(w, h);
  c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.roundRect(2, 3, w - 2, h - 2, 7); c.fill();
  c.fillStyle = color; c.strokeStyle = INK; c.lineWidth = 1.5;
  c.beginPath(); c.roundRect(0, 0, w - 2, h - 2, 7); c.fill(); c.stroke();
  // Windscreen, rear window, roof
  c.fillStyle = 'rgba(30,40,55,0.85)';
  c.beginPath(); c.roundRect(w * 0.58, 3, w * 0.16, h - 8, 3); c.fill();
  c.beginPath(); c.roundRect(w * 0.14, 4, w * 0.12, h - 10, 3); c.fill();
  c.fillStyle = shade(color, 18); c.beginPath(); c.roundRect(w * 0.28, 4, w * 0.28, h - 10, 3); c.fill();
  if (stripe) { c.fillStyle = '#f4f1ea'; c.fillRect(2, h / 2 - 3.5, w - 6, 3); }
  // Headlights and tail lights
  c.fillStyle = '#fff6c8'; c.fillRect(w - 5, 2, 3, 4); c.fillRect(w - 5, h - 8, 3, 4);
  c.fillStyle = braking ? '#ff2a2a' : '#8a1c1c';
  c.fillRect(0, 2, 3, 5); c.fillRect(0, h - 9, 3, 5);
  if (braking) {
    c.fillStyle = 'rgba(255,40,40,0.35)';
    c.beginPath(); c.arc(0, 4, 5, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(0, h - 6, 5, 0, Math.PI * 2); c.fill();
  }
  return cv;
}

/** The Wolfline bus, 2.8 x 1.05 tiles, red with a white band. */
export function renderBus(braking: boolean): HTMLCanvasElement {
  const w = Math.round(2.8 * TS), h = Math.round(1.05 * TS);
  const { cv, c } = vehicleCanvas(w, h);
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.roundRect(3, 4, w - 3, h - 3, 6); c.fill();
  c.fillStyle = '#cc0000'; c.strokeStyle = INK; c.lineWidth = 1.5;
  c.beginPath(); c.roundRect(0, 0, w - 2, h - 2, 6); c.fill(); c.stroke();
  c.fillStyle = '#f4f1ea'; c.fillRect(6, h / 2 - 5, w - 18, 8);
  c.fillStyle = '#9b0000'; c.font = `bold 7px ${LABEL_FONT}`; c.textBaseline = 'middle'; c.textAlign = 'center';
  c.fillText('WOLFLINE', w / 2 - 4, h / 2 - 1);
  c.fillStyle = 'rgba(30,40,55,0.85)'; c.fillRect(w - 11, 3, 5, h - 8);
  c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(w * 0.22, 2, 10, 3); c.fillRect(w * 0.55, 2, 10, 3);
  c.fillStyle = '#fff6c8'; c.fillRect(w - 5, 2, 3, 5); c.fillRect(w - 5, h - 9, 3, 5);
  c.fillStyle = braking ? '#ff2a2a' : '#8a1c1c'; c.fillRect(0, 2, 3, 6); c.fillRect(0, h - 10, 3, 6);
  return cv;
}

/** A traffic light on a short pole. */
export function renderCarSignal(light: 'green' | 'yellow' | 'red'): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 12; cv.height = 30;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#2b2b2b'; c.fillRect(5, 22, 2, 8);
  c.fillStyle = '#1c1c1c'; c.strokeStyle = '#000'; c.lineWidth = 1;
  c.beginPath(); c.roundRect(1, 0, 10, 24, 3); c.fill(); c.stroke();
  const lamp = (y: number, on: boolean, col: string) => {
    if (on) { c.fillStyle = col + '55'; c.beginPath(); c.arc(6, y, 4.5, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = on ? col : 'rgba(255,255,255,0.08)'; c.beginPath(); c.arc(6, y, 2.8, 0, Math.PI * 2); c.fill();
  };
  lamp(5, light === 'red', '#ff3b30'); lamp(12, light === 'yellow', '#ffcc00'); lamp(19, light === 'green', '#34c759');
  return cv;
}

/** A pedestrian signal: a walking figure, a raised hand, or the countdown number. */
export function renderWalkHead(walk: boolean, count: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 18; cv.height = 18;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#151515'; c.strokeStyle = '#000'; c.lineWidth = 1;
  c.beginPath(); c.roundRect(0.5, 0.5, 17, 17, 3); c.fill(); c.stroke();
  if (walk) {
    c.fillStyle = '#f4f4f0'; c.strokeStyle = '#f4f4f0'; c.lineWidth = 1.8; c.lineCap = 'round';
    c.beginPath(); c.arc(9.5, 4, 1.8, 0, Math.PI * 2); c.fill();
    c.beginPath();
    c.moveTo(9, 6.5); c.lineTo(8.5, 11); c.lineTo(6, 15); c.moveTo(8.5, 11); c.lineTo(11, 15);
    c.moveTo(9, 8); c.lineTo(6.5, 10); c.moveTo(9, 8); c.lineTo(12, 9.5);
    c.stroke();
  } else if (count > 0) {
    c.fillStyle = '#ff8a1e'; c.font = `bold 12px ${LABEL_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(count), 9, 9.5);
  } else {
    c.fillStyle = '#ff8a1e';
    c.beginPath(); c.roundRect(5, 7, 8, 7, 2); c.fill();
    for (let i = 0; i < 4; i++) c.fillRect(5 + i * 2.1, 3.5, 1.6, 5);
    c.fillRect(3, 8, 3, 1.6);
  }
  return cv;
}
