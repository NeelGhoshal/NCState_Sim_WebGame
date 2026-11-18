// Main Campus from OpenStreetMap: Hillsborough Street down to Western Boulevard, Gorman Street
// across to Pullen Road. Footprints, streets, paths, the railroad and its tunnels come from
// src/data/campusOsm.json (built by scripts/osm-campus.mjs). This file turns that data into
// the tile map and adds the game's own things: doors, venues, bus stops, agent spots.
//
// Map data © OpenStreetMap contributors, ODbL.
import { MapBuilder, polyArea, polyBounds } from '../engine/mapBuilder';
import { reachable } from '../engine/grid';
import { buildRoadNet, projectToNet, routeBetween, type NetPoint, type RouteStep } from '../engine/roads';
import type { BuildingMeta, BuildingStyle, GameMap, Ground, MapLine, Pt } from '../engine/types';
import { isSolid } from '../engine/types';
import { N } from '../data/names';
import osm from '../data/campusOsm.json';

interface OsmBuilding { id: string; tag: string; p: number[]; name?: string; campus?: number; levels?: number }
interface OsmData {
  bbox: { south: number; west: number; north: number; east: number };
  metersPerTile: number; w: number; h: number; license: string;
  buildings: OsmBuilding[]; lines: MapLine[]; areas: { k: string; p: number[]; name?: string }[];
}
const D = osm as unknown as OsmData;

export const W = D.w, H = D.h;
const B = N.bldg;
const LAT0 = (D.bbox.south + D.bbox.north) / 2;

/** Tile for a latitude and longitude. */
export function geo(lat: number, lon: number): Pt {
  const mx = Math.cos((LAT0 * Math.PI) / 180) * 111320;
  return {
    x: Math.floor(((lon - D.bbox.west) * mx) / D.metersPerTile),
    y: Math.floor(((D.bbox.north - lat) * 110574) / D.metersPerTile),
  };
}

export interface BusStop { name: string; x: number; y: number; /** Where the bus pulls in. */ at: NetPoint }
export const BUS_STOPS: Record<string, BusStop> = {};
/** The Wolfline loop, stop by stop. */
export const BUS_ORDER = ['talley', 'fountain', 'belltower', 'quad'];
/** The loop as driving steps on the campus street network; each leg ends at a stop. */
export const BUS_ROUTE: RouteStep[] = [];
/** Where your car starts the game: the parking lot nearest your hall. Tile coordinates of its centre. */
export const CAR_START = { x: 0, y: 0, angle: 0 };

/** Outside tiles of Talley's doors, where the interior's exits land. */
export const TALLEY_EXITS = { north: { x: 0, y: 0 }, south: { x: 0, y: 0 } };

function hash(x: number, y: number) {
  let h = (x * 73856093) ^ (y * 19349663);
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

const SHORT: [RegExp, string][] = [[/ Street$/, ' St'], [/ Avenue$/, ' Ave'], [/ Drive$/, ' Dr'], [/ Boulevard$/, ' Blvd'], [/ Road$/, ' Rd']];
export const shortRoad = (name: string) => SHORT.reduce((s, [re, to]) => s.replace(re, to), name);

function displayName(raw: string) {
  return N.osmRename[raw] ?? raw.replace(/ Residence Hall$/, ' Hall');
}

/** Floors when OSM does not say: a typical height for the kind of building. */
const DEFAULT_LEVELS: Record<BuildingStyle, number> = {
  academic: 3, union: 3, residence: 4, dining: 2, athletic: 3, shop: 2, parking: 4, landmark: 8,
  service: 2, offcampus: 2, closed: 4,
};
function levelsFor(o: OsmBuilding, style: BuildingStyle, area: number): number {
  if (o.levels && o.levels > 0) return Math.min(o.levels, 14);
  if (area < 12) return 1; // sheds, kiosks, small outbuildings
  return DEFAULT_LEVELS[style];
}

function styleFor(b: OsmBuilding, name: string | undefined): BuildingStyle {
  if (!b.campus) return 'offcampus';
  if (!name) return b.tag === 'parking' ? 'parking' : 'service';
  if (name === B.poe || /under construction/.test(name)) return 'closed';
  if (name === B.talley || name === B.witherspoon) return 'union';
  if (name === B.belltower) return 'landmark';
  if (/Dining|Commons$/.test(name)) return 'dining';
  if (/Coliseum|Gymnasium|Recreation|Athletic|Tennis/.test(name)) return 'athletic';
  if (/Parking|Deck/.test(name) || b.tag === 'parking') return 'parking';
  if (/Plant|Shops|Services|Safety|EMS|Annex|Bureau/.test(name)) return 'service';
  if (b.tag === 'dormitory' || b.tag === 'residential' || /Residence|Towers|Village|Avent Ferry|Wood Hall|^(Alpha|Beta|Delta|Kappa|Lambda|Pi|Sigma) /.test(name)) return 'residence';
  return 'academic';
}

/** y of a polyline at column x (the first segment that spans it), or null. */
function lineYAt(lines: MapLine[], x: number): number | null {
  for (const l of lines) for (let i = 0; i + 3 < l.p.length; i += 2) {
    const ax = l.p[i], ay = l.p[i + 1], bx = l.p[i + 2], by = l.p[i + 3];
    if ((ax <= x && x <= bx) || (bx <= x && x <= ax)) return bx === ax ? ay : ay + ((x - ax) / (bx - ax)) * (by - ay);
  }
  return null;
}

export function buildCampus(): GameMap {
  const b = new MapBuilder('campus', N.zone.central, W, H, 'grass', {
    outdoor: true, secPerMinute: 2.5, crowd: 260, spawn: { x: 0, y: 0 },
    credit: '© OpenStreetMap contributors',
  });
  b.vectors = { lines: D.lines, areas: D.areas };
  const R = N.osmRoad;
  const roadsNamed = (name: string) => D.lines.filter((l) => l.name === name);

  // ---- Ground: areas, then streets, paths, the railroad, and what passes over or under it
  const AREA_GROUND: Record<string, Ground> = { pitch: 'field', parking: 'parking', water: 'water', plaza: 'plaza', construction: 'site' };
  for (const a of D.areas) if (AREA_GROUND[a.k]) b.fillPoly(a.p, AREA_GROUND[a.k]);

  const ROAD_R: Record<string, number> = { primary: 2, secondary: 1.6, tertiary: 1.2, residential: 1.1, service: 0.8, aisle: 0.75 };
  const lines = D.lines;
  for (const l of lines) if (ROAD_R[l.k] && !l.tunnel) b.strokeLine(l.p, ROAD_R[l.k], 'road', (g) => g !== 'water');
  for (const l of lines) if ((l.k === 'path' || l.k === 'steps') && !l.tunnel) b.strokeLine(l.p, 0.75, 'sidewalk', (g) => g !== 'road' && g !== 'water');
  for (const l of lines) if (l.k === 'rail' && !l.bridge) b.strokeLine(l.p, 1.1, 'rail');
  for (const l of lines) {
    if (!l.tunnel) continue;
    const ground: Ground = l.name === N.place.freeExpression ? 'tunnel' : 'underpass';
    b.strokeLine(l.p, l.k === 'path' ? 0.8 : ROAD_R[l.k] ?? 0.8, ground, (g) => g !== 'bldg');
  }
  for (const l of lines) if (l.bridge && l.k !== 'rail') b.strokeLine(l.p, ROAD_R[l.k] ?? 0.75, l.k === 'path' ? 'sidewalk' : 'road');

  // ---- Buildings
  const tilesOf = new Map<string, Pt[]>();
  const metaOf = new Map<string, BuildingMeta>();
  const seen = new Map<string, number>();
  const sorted = D.buildings.filter((x) => x.tag !== 'roof').sort((p, q) => polyArea(q.p) - polyArea(p.p));
  for (const o of sorted) {
    const name = o.name ? displayName(o.name) : undefined;
    const area = polyArea(o.p);
    const first = name ? !seen.has(name) : false;
    if (name) seen.set(name, (seen.get(name) ?? 0) + 1);
    const style = styleFor(o, name);
    const tiles = b.polyBuilding(name ?? '', o.p, style, {
      label: first, major: first && (area >= 160 || name === B.belltower || name === B.talley || name === B.dhhill),
      levels: levelsFor(o, style, area),
    });
    if (first && name) { tilesOf.set(name, tiles); metaOf.set(name, b.buildings[b.buildings.length - 1]); }
  }
  const need = (name: string) => {
    const t = tilesOf.get(name), m = metaOf.get(name);
    if (!t || !m) throw new Error(`campus: no building named ${name} in campusOsm.json`);
    return { tiles: t, meta: m };
  };
  const box = (name: string) => {
    const { meta: m } = need(name);
    const x = Math.floor(m.x), y = Math.floor(m.y);
    return { x, y, w: Math.ceil(m.x + m.w) - x, h: Math.ceil(m.y + m.h) - y };
  };

  // ---- Hillsborough Street storefronts: real footprints, invented names
  const hills = roadsNamed(R.hillsborough);
  const shops = b.buildings.filter((m) => {
    if (m.style !== 'offcampus' || m.w * m.h < 20) return false;
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2, ry = lineYAt(hills, cx);
    return ry !== null && cy < ry && ry - cy < 16 && cx > 30 && cx < W - 60;
  }).sort((p, q) => p.x - q.x);
  const venueShop = new Map<string, BuildingMeta>();
  N.hillsboroughVenues.forEach((name, i) => {
    const m = shops[Math.floor(((i + 0.5) * shops.length) / N.hillsboroughVenues.length)];
    if (!m) return;
    m.name = name; m.style = 'shop'; m.label = true; m.major = false;
    venueShop.set(name, m);
  });

  // ---- Helpers that need the finished ground
  const walk = (x: number, y: number) => b.inb(x, y) && !['bldg', 'rail', 'water'].includes(b.g(x, y)) && !b.obj[y * W + x];
  /** Nearest walkable tile to p that passes `ok`, searching outward. */
  const nearest = (p: Pt, ok: (x: number, y: number) => boolean = walk, max = 40): Pt => {
    for (let r = 0; r <= max; r++) {
      let best: Pt | null = null, bd = Infinity;
      for (let y = p.y - r; y <= p.y + r; y++) for (let x = p.x - r; x <= p.x + r; x++) {
        if (Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) !== r || !walk(x, y) || !ok(x, y)) continue;
        const d = (x - p.x) ** 2 + (y - p.y) ** 2;
        if (d < bd) { bd = d; best = { x, y }; }
      }
      if (best) return best;
    }
    throw new Error(`campus: nothing walkable near ${p.x},${p.y}`);
  };
  /** A door on a building's edge nearest `toward`, and the walkable tile outside it. */
  const entrance = (name: string, toward: Pt) => {
    const { tiles } = need(name);
    let best: { door: Pt; out: Pt; d: number } | null = null;
    for (const t of tiles) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const o = { x: t.x + dx, y: t.y + dy };
      if (!walk(o.x, o.y)) continue;
      const d = (t.x - toward.x) ** 2 + (t.y - toward.y) ** 2;
      if (!best || d < best.d) best = { door: t, out: o, d };
    }
    if (!best) throw new Error(`campus: ${name} has no walkable edge`);
    return best;
  };
  const center = (name: string): Pt => { const m = need(name).meta; return { x: Math.round(m.x + m.w / 2), y: Math.round(m.y + m.h / 2) }; };
  const nearRoad = (x: number, y: number) => [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => b.inb(x + dx, y + dy) && b.g(x + dx, y + dy) === 'road') && b.g(x, y) !== 'road';

  // ---- Talley's doors lead inside
  const tb = need(B.talley).meta;
  const tc = center(B.talley);
  for (const [side, y] of [['north', tb.y - 2], ['south', tb.y + tb.h + 2]] as const) {
    const e = entrance(B.talley, { x: tc.x, y: Math.round(y) });
    b.set(e.door.x, e.door.y, 'door');
    b.portal(e.door.x, e.door.y, 'talley1', 31, side === 'north' ? 1 : 42);
    TALLEY_EXITS[side] = e.out;
  }

  // ---- Your room, and where you wake up
  const tucker = entrance(B.tucker, { x: center(B.tucker).x, y: Math.round(need(B.tucker).meta.y + need(B.tucker).meta.h) + 2 });
  b.set(tucker.door.x, tucker.door.y, 'door');
  const tk = box(B.tucker);
  b.interact('sleep', tk.x, tk.y, tk.w, tk.h, `${B.tucker} — your room`);
  b.spot('c.dorm', tucker.out.x, tucker.out.y);

  // ---- Things to do
  const dab = box(B.dabney); b.interact('class', dab.x, dab.y, dab.w, dab.h, `${B.dabney}: CH 101`, 'ch101');
  const lib = box(B.dhhill); b.interact('study', lib.x, lib.y, lib.w, lib.h, B.dhhill, 'library');
  for (const [name, venue, label] of [[B.fountain, 'fountain', B.fountain], [B.clark, 'clark', B.clark], ['Case Academic Center', 'case', B.caseDining]] as const) {
    const r = box(name); b.interact('venue', r.x, r.y, r.w, r.h, label, venue);
  }
  for (const [i, venue] of [[1, 'brickline'], [3, 'nightowl']] as const) {
    const m = venueShop.get(N.hillsboroughVenues[i]);
    if (m) b.interact('venue', Math.floor(m.x), Math.floor(m.y), Math.ceil(m.w), Math.ceil(m.h), m.name, venue);
  }
  // Poe Hall is fenced off
  const poe = box(B.poe);
  b.interact('closed', poe.x, poe.y, poe.w, poe.h, B.poe);
  for (const t of need(B.poe).tiles) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const x = t.x + dx, y = t.y + dy;
    if (b.inb(x, y) && b.g(x, y) === 'grass' && !b.obj[y * W + x]) b.set(x, y, 'fence');
  }

  // Free Expression Tunnel and the other passages under the tracks
  const fet = lines.filter((l) => l.name === N.place.freeExpression);
  if (fet.length) {
    const fb = polyBounds(fet.flatMap((l) => l.p));
    const x = Math.floor(fb.x0), y = Math.floor(fb.y0);
    b.interact('tunnel', x, y, Math.max(1, Math.ceil(fb.x1) - x), Math.max(1, Math.ceil(fb.y1) - y), N.place.freeExpression, 'paint');
    b.label(fb.x1 + 3, (fb.y0 + fb.y1) / 2, N.place.freeExpression, 'note');
  }
  const underpasses = lines.filter((l) => l.tunnel && l.k === 'path' && !l.name && polyBounds(l.p).y0 > 60 && polyBounds(l.p).y0 < 140);
  for (const l of underpasses) {
    const pb = polyBounds(l.p), cx = (pb.x0 + pb.x1) / 2;
    const near = (n: string) => Math.abs(center(n).x - cx);
    const label = near(B.reynolds) < near(B.thompson) ? N.place.reynoldsTunnel : N.place.thompsonTunnel;
    b.label(pb.x1 + 3, (pb.y0 + pb.y1) / 2, label, 'note');
  }

  // Wolf Ears in the middle of the Court of North Carolina
  const court = D.areas.find((a) => a.name === N.place.court);
  if (court) {
    const cb = polyBounds(court.p);
    const c = nearest({ x: Math.round((cb.x0 + cb.x1) / 2), y: Math.round((cb.y0 + cb.y1) / 2) }, (x, y) => b.g(x, y) === 'grass' && walk(x + 1, y) && walk(x + 2, y));
    b.set(c.x, c.y, 'ears'); b.set(c.x + 2, c.y, 'ears');
    b.interact('wolfears', c.x, c.y, 3, 1, N.place.wolfEars);
    b.label(c.x + 1, c.y + 1.4, N.place.wolfEars, 'note');
    b.label((cb.x0 + cb.x1) / 2, cb.y0 + 2, N.place.court, 'zone');
  }

  // The Brickyard: the open brick plaza east of D.H. Hill
  // (not mapped as an area in OSM, so drawn here, east of West Broughton Drive)
  const brick = nearest(geo(35.78655, -78.66885), (x, y) => b.g(x, y) !== 'road');
  const yard = [brick.x - 3, brick.y - 6, brick.x + 10, brick.y - 6, brick.x + 10, brick.y + 5, brick.x - 3, brick.y + 5];
  b.vectors!.areas = [...b.vectors!.areas, { k: 'plaza', p: yard, name: N.place.brickyard }]; // drawn over the lawn
  for (const t of b.polyTiles(yard)) if (['grass', 'sidewalk'].includes(b.g(t.x, t.y)) && !b.obj[t.y * W + t.x]) b.set(t.x, t.y, 'plaza');
  const yardSpot = nearest({ x: brick.x + 3, y: brick.y }, (x, y) => b.g(x, y) === 'plaza');
  b.spot('c.brickyard', yardSpot.x, yardSpot.y);
  b.label(brick.x + 3, brick.y - 3.5, N.place.brickyard, 'zone');

  // Rec center spot
  const rec = entrance(B.carmichael, { x: center(B.carmichael).x, y: 0 });
  b.spot('c.rec', rec.out.x, rec.out.y);

  // ---- Bus stops: on the kerb of the street nearest each landmark, on the landmark's side
  const net = buildRoadNet(D.lines, W, H);
  const onMap = (e: { p: number[] }) => e.p.every((v, i) => (i % 2 ? v > 2 && v < H - 2 : v > 2 && v < W - 2));
  const stops: Record<string, [string, string]> = {
    talley: [B.talley, 'Talley'], fountain: [B.fountain, 'Fountain'], belltower: [B.belltower, 'the Belltower'], quad: ['Quad Commons', 'the Quad'],
  };
  for (const id of BUS_ORDER) {
    const [bldg, where] = stops[id];
    const c = center(bldg);
    const np = projectToNet(net, c, onMap);
    const e = net.edges[np.edge];
    const d = Math.hypot(c.x - np.x, c.y - np.y) || 1;
    const toward = { x: Math.round(np.x + ((c.x - np.x) / d) * (e.half + 1.2)), y: Math.round(np.y + ((c.y - np.y) / d) * (e.half + 1.2)) };
    const s = nearest(toward, nearRoad, 30);
    b.set(s.x, s.y, 'busstop');
    BUS_STOPS[id] = { name: `${e.name ? shortRoad(e.name) : 'Campus'} at ${where}`, x: s.x, y: s.y, at: projectToNet(net, s, onMap) };
    b.interact('bus', s.x, s.y, 1, 1, `${N.bus.name} stop: ${BUS_STOPS[id].name}`, id);
  }
  BUS_ORDER.forEach((id, i) => {
    const to = BUS_ORDER[(i + 1) % BUS_ORDER.length];
    const leg = routeBetween(net, BUS_STOPS[id].at, BUS_STOPS[to].at);
    if (!leg?.length) throw new Error(`campus: no street route from the ${id} stop to the ${to} stop`);
    leg[leg.length - 1].stop = to;
    BUS_ROUTE.push(...leg);
  });

  // ---- Trees on open lawn, clear of paths and doors
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (hash(x, y) % 100 >= 7 || b.g(x, y) !== 'grass') continue;
    let open = true;
    for (let dy = -1; dy <= 1 && open; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (b.g(x + dx, y + dy) !== 'grass' || b.obj[(y + dy) * W + x + dx]) { open = false; break; }
    }
    if (open && !Object.values(b.spots).some((s) => Math.abs(s.x - x) <= 1 && Math.abs(s.y - y) <= 1)) b.set(x, y, 'tree');
  }

  // ---- Labels
  const tun = lines.filter((l) => l.k === 'rail');
  if (tun.length) b.label(W / 2 - 40, (lineYAt(tun, W / 2 - 40) ?? 100) - 2, 'Railroad', 'note');
  b.label(W / 2, H - 1.2, `To ${N.place.centennial} by ${N.bus.name} — a later phase`, 'note');
  const quad = need('Quad Commons').meta;
  b.label(quad.x + quad.w / 2, quad.y - 3, N.place.quad, 'zone');

  // ---- Zones for the HUD (later entries win)
  const rail = lines.filter((l) => l.k === 'rail');
  const danAllenX = (() => { const ys = roadsNamed(R.danAllen).flatMap((l) => l.p.filter((_, i) => i % 2 === 0)); return ys.length ? Math.min(...ys) : 200; })();
  const quadX = Math.floor(need('Bagwell Hall').meta.x) - 12;
  for (let x = 0; x < W; x += 8) {
    const hy = Math.round(lineYAt(hills, x + 4) ?? 6);
    const ry = Math.round(lineYAt(rail, x + 4) ?? H);
    b.zone(x < danAllenX ? N.place.westCampus : N.zone.north, x, 0, 8, Math.max(1, ry));
    b.zone(x < danAllenX ? N.place.westCampus : x >= quadX ? N.place.eastCampus : N.zone.central, x, ry, 8, H - ry);
    b.zone(N.zone.hillsborough, x, 0, 8, Math.max(1, hy + 3));
    const wy = lineYAt(roadsNamed(R.western), x + 4);
    if (wy !== null) b.zone(N.zone.south, x, Math.round(wy) - 3, 8, H);
  }
  for (const a of D.areas) if (a.name) {
    const ab = polyBounds(a.p);
    b.zone(a.name, Math.floor(ab.x0), Math.floor(ab.y0), Math.ceil(ab.x1 - ab.x0), Math.ceil(ab.y1 - ab.y0));
  }
  b.zone(N.place.brickyard, brick.x - 3, brick.y - 6, 14, 12);
  if (fet.length) { const fb = polyBounds(fet.flatMap((l) => l.p)); b.zone(N.place.freeExpression, Math.floor(fb.x0) - 1, Math.floor(fb.y0), Math.ceil(fb.x1 - fb.x0) + 3, Math.ceil(fb.y1 - fb.y0) + 1); }

  // ---- Spawn outside your hall, and crowd spots on the paths you can reach from it
  const map = b.build();
  map.spawn = { ...tucker.out };
  map.roads = net;
  // Your car: on the nearest lot to the hall with room for it (three tiles of parking in a row)
  let bestCar = Infinity;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 2; x++) {
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 2; dx++) if (map.ground[(y + dy) * W + x + dx] !== 'parking' || map.obj[(y + dy) * W + x + dx]) { ok = false; break; }
    if (!ok) continue;
    const d = (x - map.spawn.x) ** 2 + (y - map.spawn.y) ** 2;
    if (d < bestCar) { bestCar = d; CAR_START.x = x + 1; CAR_START.y = y + 0.5; }
  }
  if (!isFinite(bestCar)) throw new Error('campus: no parking lot for the car');
  const reach = reachable(map, map.spawn);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const g = map.ground[y * W + x];
    if ((g === 'sidewalk' || g === 'plaza') && hash(x * 3, y * 5) % 7 === 0 && reach.has(y * W + x) && !isSolid(map, x, y)) map.crowdSpots.push({ x, y });
  }
  return map;
}

export const CAMPUS = buildCampus();
