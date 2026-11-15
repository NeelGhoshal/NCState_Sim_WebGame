// Talley Student Union, three floors. The layout is schematic and built from memory of
// what the building holds, not from surveyed floor plans (see BUILD_PLAN.md, Phase 2).
import { MapBuilder } from '../engine/mapBuilder';
import type { GameMap } from '../engine/types';
import { N } from '../data/names';

const W = 64, H = 44;
const T = N.talley;

function shell(b: MapBuilder) {
  b.outline(0, 0, W, H, 'wall');
  for (let x = 2; x <= 61; x++) b.set(x, 43, 'glass');
}

/** Stair core in the same place on every floor. Down is on the left, up on the right. */
function core(b: MapBuilder, floor: Parameters<MapBuilder['fill']>[4], down?: string, up?: string) {
  b.fill(28, 7, 9, 1, 'wall');
  b.fill(28, 8, 1, 2, 'wall');
  b.fill(36, 8, 1, 2, 'wall');
  b.fill(29, 8, 7, 2, 'wall');
  if (down) {
    b.fill(29, 8, 3, 2, 'stairsDown');
    for (let x = 29; x <= 31; x++) for (let y = 8; y <= 9; y++) b.portal(x, y, down, 30, 11);
  }
  if (up) {
    b.fill(33, 8, 3, 2, 'stairsUp');
    for (let x = 33; x <= 35; x++) for (let y = 8; y <= 9; y++) b.portal(x, y, up, 34, 11);
  }
  b.fill(29, 10, 7, 2, floor);
}

function floor1(): GameMap {
  const b = new MapBuilder('talley1', `${N.bldg.talley} · Floor 1`, W, H, 'floor', {
    outdoor: false, secPerMinute: 2, crowd: 12, spawn: { x: 31, y: 41 },
  });
  shell(b);
  for (const x of [30, 31, 32, 33]) {
    b.set(x, 0, 'door'); b.portal(x, 0, 'campus', x < 32 ? 47 : 48, 29);
    b.set(x, 43, 'door'); b.portal(x, 43, 'campus', x < 32 ? 47 : 48, 41);
  }
  core(b, 'floor', undefined, 'talley2');

  // Wolfpack Outfitters (west)
  b.room(0, 0, 23, 27, 'carpet');
  for (let y = 3; y <= 9; y++) b.set(22, y, 'glass');
  for (let y = 16; y <= 23; y++) b.set(22, y, 'glass');
  b.fill(22, 12, 1, 2, 'door');
  for (const y of [3, 6, 9, 16, 19, 22]) { b.fill(3, y, 7, 1, 'shelf'); b.fill(12, y, 7, 1, 'shelf'); }
  b.counter(14, 13, 4, 1, 'outfitters', T.outfitters);
  b.zone(T.outfitters, 0, 0, 23, 27);
  b.label(11.5, 1.6, T.outfitters, 'sign');

  // Talley Market and Howling Cow (north-east)
  b.room(41, 0, 23, 19, 'tile');
  b.fill(41, 9, 1, 2, 'door');
  b.fill(50, 18, 2, 1, 'door');
  for (const sx of [45, 48, 51, 54]) { b.fill(sx, 3, 1, 5, 'shelf'); b.fill(sx, 12, 1, 4, 'shelf'); }
  b.fill(43, 1, 12, 1, 'fridge');
  b.fill(57, 1, 6, 3, 'kitchen');
  b.counter(57, 4, 6, 1, 'howlingcow', T.howlingCow);
  b.counter(57, 12, 5, 1, 'market', T.market);
  b.zone(T.market, 41, 0, 23, 19);
  b.label(49, 9.5, T.market, 'sign');
  b.label(60, 2.5, T.howlingCow, 'sign');

  // Port City Java (east)
  b.fill(42, 21, 21, 14, 'wood');
  b.fill(59, 22, 4, 8, 'kitchen');
  b.counter(58, 22, 1, 8, 'pcj', T.pcj);
  b.set(59, 25, 'wood');
  b.spot('f1.pcj.staff', 59, 25);
  b.tableSet(45, 24, false); b.spot('f1.pcj.t1', 45, 23);
  b.tableSet(50, 24); b.tableSet(54, 24);
  b.tableSet(45, 29); b.tableSet(50, 29); b.tableSet(54, 29);
  b.zone(T.pcj, 42, 21, 21, 14);
  b.label(52, 21.6, T.pcj, 'sign');

  // Information desk and lobby
  b.fill(29, 20, 6, 1, 'counter');
  b.interact('info', 29, 20, 6, 1, 'Information desk', 'walt');
  b.spot('f1.info.staff', 31, 21);
  b.spot('f1.lobby', 27, 24);
  for (const [x, y] of [[27, 19], [36, 19], [24, 41], [39, 41], [24, 2], [39, 2]]) b.set(x, y, 'plant');
  b.label(32, 16, 'Main Lobby', 'zone');
  b.label(34, 10.6, 'Stairs up', 'note');

  // Lounge (south-west)
  b.fill(1, 28, 21, 15, 'carpet');
  b.booth('f1.w1', 1, 29); b.booth('f1.w2', 1, 33); b.booth('f1.w3', 1, 37);
  b.set(1, 32, 'plant'); b.set(1, 36, 'plant');
  for (const x of [7, 14]) {
    b.fill(x, 31, 5, 5, 'rug');
    b.fill(x, 31, 5, 1, 'sofa');
    b.fill(x, 35, 5, 1, 'sofa');
    b.fill(x + 1, 33, 3, 1, 'table');
  }
  b.spot('f1.lounge.sofa', 15, 31);
  b.crowdSpots.push({ x: 8, y: 31 }, { x: 10, y: 35 }, { x: 17, y: 35 });
  b.set(21, 28, 'plant'); b.set(21, 42, 'plant');
  b.zone('Lounge', 1, 28, 21, 15);
  b.label(12, 39, 'Lounge', 'zone');

  // Booths along the south glass
  for (let i = 0; i < 6; i++) b.booth(`f1.s${i + 1}`, 43 + i * 3, 40, i !== 5);
  b.label(52, 37.5, 'Booths', 'zone');

  return b.build();
}

function floor2(): GameMap {
  const b = new MapBuilder('talley2', `${N.bldg.talley} · Floor 2`, W, H, 'tile', {
    outdoor: false, secPerMinute: 2, crowd: 22, spawn: { x: 30, y: 11 },
  });
  shell(b);
  b.fill(26, 1, 12, 6, 'wall');
  core(b, 'tile', 'talley1', 'talley3');
  b.label(30, 10.6, 'Down', 'note');
  b.label(34, 10.6, 'Up', 'note');

  const bay = (x: number, id: string, label: string) => {
    b.fill(x, 1, 12, 4, 'kitchen');
    b.counter(x, 5, 12, 1, id, label);
    b.zone(label, x, 5, 12, 4);
    b.label(x + 6, 2.5, label, 'sign');
  };
  bay(1, 'tuffys', T.tuffys);
  b.fill(13, 1, 1, 5, 'wall');
  bay(14, 'loslobos', T.losLobos);
  bay(38, 'oneearth', T.oneEarth);
  b.fill(50, 1, 1, 5, 'wall');
  bay(51, 'jasons', T.jasons);
  b.spot('f2.tuffys.line', 6, 6);
  b.spot('f2.tuffys.line2', 9, 7);

  // Sushi kiosk (east wall)
  b.fill(59, 10, 4, 6, 'kitchen');
  b.counter(58, 10, 1, 6, 'sushi', T.sushi);
  b.zone(T.sushi, 54, 9, 9, 8);
  b.label(60.5, 12.5, 'Sushi', 'sign');

  // Starbucks (east)
  b.fill(48, 20, 15, 12, 'wood');
  b.fill(59, 21, 4, 8, 'kitchen');
  b.counter(58, 21, 1, 8, 'starbucks', T.starbucks);
  b.tableSet(50, 23, false); b.spot('f2.sbux.chair', 50, 22);
  b.tableSet(54, 23); b.tableSet(50, 28); b.tableSet(54, 28);
  b.zone(T.starbucks, 48, 20, 15, 12);
  b.label(53, 20.6, T.starbucks, 'sign');

  // Talley Pavilions: open seating
  b.zone(T.pavilions, 3, 9, 45, 22);
  for (const y of [12, 17, 22, 27]) {
    for (const x of [8, 13, 18, 23, 28, 33, 38, 43]) {
      if (y === 12 && (x === 28 || x === 33)) continue; // keep the stair landing clear
      const reserved = x === 38 && y === 12;
      b.tableSet(x, y, !reserved);
    }
  }
  b.spot('f2.oneearth.seat', 38, 11);
  b.label(20, 14.5, T.pavilions, 'zone');

  // Booths: west wall, a middle row, and the south glass
  for (let i = 0; i < 5; i++) b.booth(`f2.w${i + 1}`, 1, 8 + i * 4, i !== 2);
  for (let i = 0; i < 6; i++) b.booth(`f2.m${i + 1}`, 28 + i * 3, 33, i !== 1);
  for (let i = 0; i < 12; i++) b.booth(`f2.s${i + 1}`, 26 + i * 3, 40, i !== 3);
  b.label(44, 37.5, 'Booths', 'zone');

  // Stewart Theatre (south-west)
  b.room(0, 31, 24, 13, 'carpet');
  b.fill(1, 33, 4, 9, 'stage');
  for (const y of [33, 35, 37, 39, 41]) b.fill(8, y, 13, 1, 'aud');
  b.fill(20, 31, 2, 1, 'door');
  b.fill(23, 36, 1, 2, 'door');
  b.zone(T.stewart, 0, 31, 24, 13);
  b.label(12, 32.4, T.stewart, 'sign');

  for (const [x, y] of [[4, 7], [25, 7], [38, 7], [47, 8], [25, 30], [47, 33], [62, 33], [62, 18]]) b.set(x, y, 'plant');
  return b.build();
}

function floor3(): GameMap {
  const b = new MapBuilder('talley3', `${N.bldg.talley} · Floor 3`, W, H, 'carpet', {
    outdoor: false, secPerMinute: 2, crowd: 9, spawn: { x: 34, y: 11 },
  });
  shell(b);
  b.fill(26, 1, 12, 6, 'wall');
  core(b, 'carpet', 'talley2', undefined);
  b.label(30, 10.6, 'Stairs down', 'note');

  // State Ballroom
  b.room(0, 0, 26, 22, 'wood');
  b.fill(1, 1, 24, 3, 'stage');
  b.fill(25, 10, 1, 2, 'door');
  b.fill(12, 21, 2, 1, 'door');
  for (const y of [8, 13, 17]) for (const x of [4, 9, 14, 19]) b.tableSet(x, y, false);
  b.zone(T.stateBallroom, 0, 0, 26, 22);
  b.label(13, 5, T.stateBallroom, 'sign');

  // Coastal Ballroom
  b.room(38, 0, 26, 16, 'wood');
  b.fill(44, 15, 2, 1, 'door');
  b.fill(38, 10, 1, 2, 'door');
  for (const y of [4, 9]) for (const x of [42, 47, 52, 57]) b.tableSet(x, y, false);
  b.zone(T.coastalBallroom, 38, 0, 26, 16);
  b.label(51, 1.6, T.coastalBallroom, 'sign');

  // Student organization offices along the south side
  const offices = [T.involvement, T.government, `${N.club} club room`, T.uab];
  offices.forEach((name, i) => {
    const x = i * 10;
    b.room(x, 30, 11, 14, 'floor');
    b.fill(x + 5, 30, 2, 1, 'door');
    b.fill(x + 1, 31, 3, 1, 'shelf');
    b.fill(x + 7, 33, 2, 1, 'desk');
    b.tableSet(x + 4, 37, false);
    b.fill(x + 4, 40, 3, 1, 'sofa');
    b.zone(name, x, 30, 11, 14);
    b.label(x + 5.5, 41.8, name, 'sign');
  });
  b.spot('f3.club', 26, 35);

  // Study lounge (east)
  b.zone('Study Lounge', 41, 17, 22, 26);
  for (let i = 0; i < 6; i++) b.booth(`f3.e${i + 1}`, 61, 19 + i * 4, i !== 1);
  for (const y of [21, 26, 31, 36]) {
    for (const x of [44, 49, 54]) b.tableSet(x, y, !(x === 44 && y === 21));
  }
  b.spot('f3.lounge.desk', 44, 20);
  b.fill(44, 40, 4, 1, 'sofa'); b.fill(50, 40, 4, 1, 'sofa');
  b.crowdSpots.push({ x: 45, y: 40 }, { x: 52, y: 40 });
  b.label(51, 18, 'Study Lounge', 'zone');

  // Corridor seating
  b.fill(28, 16, 5, 1, 'sofa'); b.fill(28, 20, 5, 1, 'sofa'); b.fill(29, 18, 3, 1, 'table');
  b.crowdSpots.push({ x: 29, y: 16 }, { x: 31, y: 20 }, { x: 15, y: 26 }, { x: 36, y: 26 });
  for (const [x, y] of [[27, 13], [37, 13], [1, 23], [40, 29], [1, 28], [60, 17]]) b.set(x, y, 'plant');
  b.label(20, 26, 'Student Organizations', 'zone');

  return b.build();
}

export const TALLEY_MAPS: GameMap[] = [floor1(), floor2(), floor3()];
