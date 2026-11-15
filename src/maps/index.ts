import type { GameMap } from '../engine/types';
import { TALLEY_MAPS } from './talley';
import { buildCampus } from './campus';

export const MAPS: Record<string, GameMap> = {};
for (const m of [buildCampus(), ...TALLEY_MAPS]) MAPS[m.id] = m;

export const START = { mapId: 'campus', x: MAPS.campus.spawn.x, y: MAPS.campus.spawn.y };
