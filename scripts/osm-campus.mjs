// Builds src/data/campusOsm.json from OpenStreetMap data for NC State's Main Campus.
//
//   node scripts/osm-campus.mjs --fetch          download from the Overpass API, then build
//   node scripts/osm-campus.mjs path/to/raw.json build from a saved Overpass response
//
// Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).
// The output is a derived database and is published under the same licence.
//
// Coordinates in the output are tiles (METERS_PER_TILE metres each), (0,0) at the north-west
// corner of BBOX, rounded to 0.1 tile. Names of buildings are kept only for buildings inside
// the university's own OSM area that are not businesses, so no real business name reaches
// the game. src/maps/campus.ts turns this file into the tile map.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/campusOsm.json');

// Hillsborough Street to Western Boulevard, Gorman Street to Pullen Road.
const BBOX = { south: 35.7790, west: -78.6895, north: 35.7895, east: -78.6615 };
const METERS_PER_TILE = 5;
const FETCH_PAD = 0.0012;

const LAT0 = (BBOX.south + BBOX.north) / 2;
const MX = Math.cos((LAT0 * Math.PI) / 180) * 111320; // metres per degree of longitude
const MY = 110574;                                    // metres per degree of latitude
const W = Math.round(((BBOX.east - BBOX.west) * MX) / METERS_PER_TILE);
const H = Math.round(((BBOX.north - BBOX.south) * MY) / METERS_PER_TILE);

const r1 = (v) => Math.round(v * 10) / 10;
const proj = (p) => [r1(((p.lon - BBOX.west) * MX) / METERS_PER_TILE), r1(((BBOX.north - p.lat) * MY) / METERS_PER_TILE)];

async function load() {
  const arg = process.argv[2];
  if (arg && arg !== '--fetch') return JSON.parse(readFileSync(arg, 'utf8'));
  const b = `(${BBOX.south - FETCH_PAD},${BBOX.west - FETCH_PAD},${BBOX.north + FETCH_PAD},${BBOX.east + FETCH_PAD})`;
  const parts = ['way["building"]', 'relation["building"]', 'way["highway"]', 'way["railway"]', 'way["leisure"]',
    'way["amenity"="parking"]', 'way["natural"="water"]', 'way["landuse"]', 'way["amenity"="university"]',
    'relation["amenity"="university"]'];
  const q = `[out:json][timeout:90];(${parts.map((p) => p + b + ';').join('')});out geom;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', headers: { 'User-Agent': 'campus-sim-mapgen/0.1' }, body: new URLSearchParams({ data: q }),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- geometry helpers

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplifies a closed ring (first point repeated last) by splitting it at its farthest point. */
function simplifyRing(pts, tol) {
  let far = 1, best = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) { best = d; far = i; }
  }
  return simplify(pts.slice(0, far + 1), tol).concat(simplify(pts.slice(far), tol).slice(1));
}

function inRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lat > lat) !== (b.lat > lat) && lon < ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

/** Joins the open ways of a multipolygon into closed rings. */
function rings(members) {
  const segs = members.filter((m) => m.role !== 'inner' && m.geometry?.length).map((m) => m.geometry.slice());
  const out = [];
  const same = (p, q) => p.lat === q.lat && p.lon === q.lon;
  while (segs.length) {
    let ring = segs.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], end = ring[ring.length - 1];
        if (same(s[0], end)) ring = ring.concat(s.slice(1));
        else if (same(s[s.length - 1], end)) ring = ring.concat(s.slice(0, -1).reverse());
        else continue;
        segs.splice(i, 1); grew = true; break;
      }
    }
    out.push(ring);
  }
  return out;
}

const centroid = (g) => ({ lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lon: g.reduce((s, p) => s + p.lon, 0) / g.length });
const inBox = (g) => g.some((p) => p.lat >= BBOX.south - 0.0004 && p.lat <= BBOX.north + 0.0004 && p.lon >= BBOX.west - 0.0004 && p.lon <= BBOX.east + 0.0004);

// ---------------------------------------------------------------- classification

const ROADS = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'service']);
const PATHS = new Set(['footway', 'pedestrian', 'path', 'cycleway', 'steps', 'track']);
const BUSINESS = new Set(['retail', 'commercial', 'hotel', 'apartments', 'house', 'terrace', 'cathedral', 'church']);

function roadKind(t) {
  const h = t.highway.replace('_link', '');
  if (h === 'unclassified') return 'tertiary';
  if (h === 'service') return t.service === 'parking_aisle' ? 'aisle' : 'service';
  return h;
}

function areaKind(t) {
  if (t.amenity === 'parking') return t.parking === 'multi-storey' ? null : 'parking';
  if (t.leisure === 'pitch' || t.leisure === 'track') return 'pitch';
  if (t.leisure === 'swimming_pool') return 'water';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass' || t.landuse === 'flowerbed' || t.landuse === 'recreation_ground') return 'park';
  if (t.natural === 'water') return 'water';
  if (t.landuse === 'construction') return 'construction';
  if (t.highway === 'pedestrian' && t.area === 'yes') return 'plaza';
  if (t.leisure === 'outdoor_seating') return 'plaza';
  return null;
}

// ---------------------------------------------------------------- build

const raw = await load();
const els = raw.elements;
const uni = [];
for (const e of els) {
  if (e.tags?.amenity !== 'university') continue;
  if (e.geometry) uni.push(e.geometry);
  else for (const r of rings(e.members ?? [])) uni.push(r);
}
const onCampus = (g) => { const c = centroid(g); return uni.some((r) => inRing(c.lat, c.lon, r)); };

const buildings = [], lines = [], areas = [];
for (const e of els) {
  const t = e.tags ?? {};
  const geoms = e.geometry ? [e.geometry] : e.type === 'relation' ? rings(e.members ?? []) : [];
  for (const g of geoms) {
    if (!inBox(g)) continue;
    const closed = g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
    const pts = closed ? simplifyRing(g.map(proj), 0.15) : simplify(g.map(proj), 0.15);
    if (t.building) {
      if (!closed || pts.length < 4) continue;
      const b = { id: `${e.type[0]}${e.id}`, tag: t.building, p: pts.slice(0, -1).flat() };
      const campus = onCampus(g);
      // Dining halls carry amenity tags too, so those only count off campus.
      const business = BUSINESS.has(t.building) || t.shop || t.brand
        || (!campus && ['restaurant', 'fast_food', 'cafe', 'bank', 'bar', 'pub', 'fuel'].includes(t.amenity));
      if (t.name && campus && !business) b.name = t.name.replace(/[‎‏]/g, '').trim();
      if (campus) b.campus = 1;
      if (t['building:levels']) b.levels = +t['building:levels'] || undefined;
      buildings.push(b);
    } else if (t.railway === 'rail') {
      lines.push({ k: 'rail', p: pts.flat(), ...(t.bridge ? { bridge: 1 } : {}) });
    } else if (t.highway && (ROADS.has(t.highway) || PATHS.has(t.highway)) && !(t.area === 'yes')) {
      const k = PATHS.has(t.highway) ? (t.highway === 'steps' ? 'steps' : 'path') : roadKind(t);
      const l = { k, p: pts.flat() };
      if (t.name && k !== 'path' && k !== 'steps') l.name = t.name;
      if (t.name === 'Free Expression Tunnel') l.name = t.name;
      if (t.tunnel && t.tunnel !== 'building_passage') l.tunnel = 1;
      if (t.bridge) l.bridge = 1;
      lines.push(l);
    } else {
      const k = areaKind(t);
      if (!k || !closed) continue;
      const a = { k, p: pts.slice(0, -1).flat() };
      if (t.name && onCampus(g)) a.name = t.name;
      areas.push(a);
    }
  }
}

const out = {
  source: 'OpenStreetMap',
  license: 'Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)',
  generated: raw.osm3s?.timestamp_osm_base ?? new Date().toISOString(),
  bbox: BBOX, metersPerTile: METERS_PER_TILE, w: W, h: H,
  buildings, lines, areas,
};
writeFileSync(OUT, JSON.stringify(out));
console.log(`${W}x${H} tiles · ${buildings.length} buildings (${buildings.filter((b) => b.name).length} named) · ${lines.length} lines · ${areas.length} areas → ${OUT}`);
