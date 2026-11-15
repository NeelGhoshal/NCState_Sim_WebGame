// Draws a GameMap to an offscreen canvas once. No art assets: everything is shapes.
import type { BuildingStyle, GameMap, Ground, Obj } from '../engine/types';

export const TS = 32;

const GROUND: Record<Ground, string> = {
  void: '#111317', grass: '#6b9b52', sidewalk: '#d3ccbc', plaza: '#a65a45', roadH: '#4a4b51', roadV: '#4a4b51',
  roadX: '#4a4b51', crosswalk: '#4a4b51', rail: '#7b7266', tunnel: '#3a3a42', parking: '#8c8c8c', field: '#4e9a40',
  water: '#4f86b8', site: '#a5845e', bldg: '#9a9a9a', door: '#8b5a2b', floor: '#ddd6c6', tile: '#e8e8e6',
  carpet: '#6e7d9c', wood: '#bb8d5f', rug: '#9c3b3b', wall: '#2f3039', glass: '#9cc9e3', kitchen: '#a3a8ad',
  stage: '#5b3c2b', stairsUp: '#c9c2b3', stairsDown: '#b3ad9f',
};

const STYLE: Record<BuildingStyle, [string, string]> = {
  academic: ['#b5574a', '#7c3329'], union: ['#c2413b', '#7f1f1b'], residence: ['#c58a5c', '#86552f'],
  dining: ['#d0a14a', '#8d6a24'], athletic: ['#8a8f99', '#545862'], shop: ['#6f8fa8', '#41596b'],
  parking: ['#9b9b9b', '#666'], landmark: ['#e0d2b4', '#9c8a62'], service: ['#8fae9a', '#56715f'],
};

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
  c.fillStyle = g === 'grass' || g === 'field' ? shade(base, (n - 0.5) * 14) : base;
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

export function renderMap(map: GameMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.w * TS;
  canvas.height = map.h * TS;
  const c = canvas.getContext('2d')!;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) drawGround(c, map.ground[y * map.w + x], x, y, map);

  // Buildings as whole footprints
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

  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const o = map.obj[y * map.w + x];
    if (o) drawObj(c, o, x, y);
  }

  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const l of map.labels) {
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
  return canvas;
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
