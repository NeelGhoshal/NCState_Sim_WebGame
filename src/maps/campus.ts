// Schematic road plan of Main Campus: Hillsborough Street down to Western Boulevard.
// Positions are approximate and from memory. Phase 2 replaces this with footprints
// generated from OpenStreetMap.
import { MapBuilder } from '../engine/mapBuilder';
import type { GameMap } from '../engine/types';
import { N } from '../data/names';

const W = 100, H = 72;
const B = N.bldg;

export const BUS_STOPS: Record<string, { name: string; x: number; y: number }> = {
  talley: { name: 'Dunn Ave at Talley', x: 52, y: 29 },
  carmichael: { name: 'Cates Ave at Carmichael', x: 36, y: 45 },
  fountain: { name: 'Dan Allen Dr at Fountain', x: 10, y: 49 },
  belltower: { name: 'Pullen Rd at the Belltower', x: 91, y: 10 },
};

function hash(x: number, y: number) {
  let h = (x * 73856093) ^ (y * 19349663);
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

export function buildCampus(): GameMap {
  const b = new MapBuilder('campus', N.zone.central, W, H, 'grass', {
    outdoor: true, secPerMinute: 0.6, crowd: 30, spawn: { x: 49, y: 46 },
  });

  // Trees first; anything laid later clears them.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hash(x, y) % 100 < 6) b.set(x, y, 'tree');

  // Railroad between North and Central Campus
  b.fill(0, 24, W, 2, 'rail');
  b.fill(11, 23, 80, 1, 'sidewalk');

  // Roads: [row or column, from, to]
  const hRoads: [number, number, number][] = [[4, 0, 99], [27, 8, 93], [43, 8, 93], [63, 0, 99]];
  const vRoads: [number, number, number][] = [[8, 4, 64], [92, 4, 64], [26, 44, 63], [60, 28, 43]];
  for (const [y, x0, x1] of hRoads) { b.fill(x0, y - 1, x1 - x0 + 1, 1, 'sidewalk'); b.fill(x0, y + 2, x1 - x0 + 1, 1, 'sidewalk'); }
  for (const [x, y0, y1] of vRoads) { b.fill(x - 1, y0, 1, y1 - y0 + 1, 'sidewalk'); b.fill(x + 2, y0, 1, y1 - y0 + 1, 'sidewalk'); }
  for (const [y, x0, x1] of hRoads) b.fill(x0, y, x1 - x0 + 1, 2, 'roadH');
  for (const [x, y0, y1] of vRoads) {
    for (let yy = y0; yy <= y1; yy++) for (let xx = x; xx < x + 2; xx++) {
      b.set(xx, yy, b.g(xx, yy) === 'roadH' ? 'roadX' : 'roadV');
    }
  }
  b.fill(46, 27, 3, 2, 'crosswalk');
  b.fill(66, 27, 2, 2, 'crosswalk');
  b.fill(82, 27, 2, 2, 'crosswalk');
  b.fill(47, 43, 3, 2, 'crosswalk');
  b.fill(35, 43, 2, 2, 'crosswalk');
  b.fill(44, 4, 2, 2, 'crosswalk');
  b.fill(88, 4, 2, 2, 'crosswalk');
  b.fill(40, 63, 2, 2, 'crosswalk');

  // Pedestrian tunnels under the tracks
  b.fill(46, 24, 2, 2, 'tunnel');
  b.fill(66, 24, 2, 2, 'tunnel');
  b.fill(82, 24, 2, 2, 'tunnel');
  b.interact('tunnel', 46, 24, 2, 2, N.place.freeExpression, 'paint');
  b.label(47, 22.4, N.place.freeExpression, 'note');
  b.label(67, 22.4, N.place.reynoldsTunnel, 'note');
  b.label(83, 22.4, N.place.thompsonTunnel, 'note');

  // --- Hillsborough Street storefronts (invented stand-ins)
  N.hillsboroughVenues.forEach((name, i) => b.building(name, 2 + i * 12, 0, 10, 3, 'shop'));

  // --- North Campus
  b.building(B.cox, 14, 8, 8, 5, 'academic');
  b.building(B.dabney, 14, 15, 8, 6, 'academic');
  b.building(B.atrium, 28, 9, 5, 4, 'dining');
  b.building(B.dhhill, 37, 7, 14, 5, 'academic');
  b.fill(36, 13, 17, 8, 'plaza');
  b.fill(46, 21, 2, 2, 'sidewalk');
  b.fill(35, 7, 1, 7, 'sidewalk');
  b.fill(23, 13, 13, 1, 'sidewalk');
  b.fill(53, 16, 7, 1, 'sidewalk');
  b.building(B.page, 54, 8, 4, 4, 'academic');
  b.building(B.tompkins, 61, 7, 6, 2, 'academic');
  b.building(B.caldwell, 68, 7, 5, 2, 'academic');
  b.building(B.winston, 74, 7, 5, 2, 'academic');
  b.fill(60, 10, 15, 10, 'grass');
  b.outline(60, 10, 15, 10, 'sidewalk');
  for (const [x, y] of [[63, 12], [67, 13], [71, 12], [64, 16], [69, 17], [72, 15]]) b.set(x, y, 'tree');
  b.building(B.leazar, 54, 20, 5, 3, 'academic');
  b.building(B.b1911, 62, 21, 8, 2, 'academic');
  b.fill(77, 11, 7, 7, 'site');
  b.outline(77, 11, 7, 7, 'fence');
  b.label(80.5, 14.5, B.poe, 'note');
  b.building(B.holladay, 81, 7, 6, 3, 'academic');
  b.building(B.belltower, 88, 7, 2, 2, 'landmark');
  b.fill(54, 17, 5, 3, 'grass');
  b.set(55, 18, 'ears'); b.set(57, 18, 'ears');
  b.interact('wolfears', 55, 18, 3, 1, N.place.wolfEars);
  b.label(56.5, 19.4, N.place.wolfEars, 'note');
  b.label(44.5, 17, N.place.brickyard, 'zone');
  b.label(67.5, 15, N.place.court, 'zone');

  // --- Central Campus, between Dunn and Cates
  b.building(B.witherspoon, 13, 32, 8, 7, 'union');
  b.building(B.health, 24, 32, 5, 6, 'service');
  b.building(B.deck, 31, 31, 7, 8, 'parking');
  b.building(B.talley, 40, 30, 16, 11, 'union');
  b.building(B.reynolds, 64, 31, 12, 9, 'athletic');
  b.building(B.thompson, 79, 30, 8, 4, 'academic');
  b.building(B.caseDining, 79, 36, 8, 5, 'dining');
  // Talley doors
  for (const x of [47, 48]) {
    b.set(x, 30, 'door'); b.portal(x, 30, 'talley1', x === 47 ? 31 : 32, 1);
    b.set(x, 40, 'door'); b.portal(x, 40, 'talley1', x === 47 ? 31 : 32, 42);
  }
  b.fill(46, 41, 4, 1, 'sidewalk');
  b.fill(39, 41, 18, 1, 'sidewalk');

  // --- Central Campus, between Cates and Western
  b.fill(0, 47, 6, 10, 'field'); b.label(3, 52, B.doak, 'zone');
  b.building(B.fountain, 12, 47, 7, 5, 'dining');
  b.building(B.bragaw, 12, 54, 11, 6, 'residence');
  b.building(B.carmichael, 31, 47, 10, 7, 'athletic');
  b.building(B.wellrec, 31, 54, 10, 6, 'athletic');
  b.fill(34, 46, 3, 1, 'sidewalk');
  b.building(B.tucker, 46, 48, 7, 4, 'residence');
  b.building(B.owen, 46, 54, 7, 4, 'residence');
  b.fill(47, 46, 5, 2, 'sidewalk');
  b.interact('sleep', 49, 48, 1, 1, `${B.tucker} — your room`);
  b.building(B.bowen, 58, 48, 4, 4, 'residence');
  b.building(B.metcalf, 63, 48, 4, 4, 'residence');
  b.building(B.carroll, 68, 48, 4, 4, 'residence');
  b.building(B.clark, 76, 47, 7, 5, 'dining');
  b.fill(76, 54, 6, 6, 'field'); b.label(79, 57, B.dailSoftball, 'zone');
  b.fill(83, 54, 7, 6, 'field'); b.label(86.5, 57, B.dailSoccer, 'zone');

  // Bus stops
  for (const [id, s] of Object.entries(BUS_STOPS)) {
    b.set(s.x, s.y, 'sidewalk');
    b.set(s.x, s.y, 'busstop');
    b.interact('bus', s.x, s.y, 1, 1, `${N.bus.name} stop: ${s.name}`, id);
  }

  // Road names
  const R = N.road;
  for (const x of [22, 72]) {
    b.label(x, 5, R.hillsborough, 'road'); b.label(x, 28, R.dunn, 'road');
    b.label(x, 44, R.cates, 'road'); b.label(x, 64, R.western, 'road');
  }
  for (const y of [15, 54]) { b.label(9, y, R.danAllen, 'roadV'); b.label(93, y, R.pullen, 'roadV'); }
  b.label(27, 54, R.morrill, 'roadV');
  b.label(61, 36, R.jeter, 'roadV');
  b.label(50, 68.5, `To ${N.place.centennial} by ${N.bus.name} — a later phase`, 'note');

  // Agent spots
  b.spot('c.dorm', 50, 47);
  b.spot('c.rec', 35, 46);
  b.spot('c.brickyard', 44, 16);
  for (const [x, y] of [[40, 15], [48, 18], [44, 14], [50, 16], [38, 19], [47, 23], [47, 26], [44, 29], [50, 42], [42, 42],
    [30, 45], [55, 45], [62, 42], [70, 29], [20, 29], [35, 6], [60, 6], [80, 6], [67, 19], [60, 14], [56, 16], [48, 46],
    [24, 13], [86, 23], [30, 23], [75, 45], [20, 45], [58, 41], [43, 41], [52, 41]] as const) {
    b.crowdSpots.push({ x, y });
  }

  // Zones for the HUD (later entries win)
  b.zone(N.zone.hillsborough, 0, 0, W, 7);
  b.zone(N.zone.north, 0, 7, W, 17);
  b.zone(N.zone.tunnels, 0, 24, W, 2);
  b.zone(N.zone.central, 0, 26, W, 37);
  b.zone(N.zone.south, 0, 63, W, 9);
  b.zone(N.place.brickyard, 36, 13, 17, 8);
  b.zone(N.place.court, 60, 10, 15, 10);
  b.zone(N.place.freeExpression, 46, 23, 2, 4);

  return b.build();
}
