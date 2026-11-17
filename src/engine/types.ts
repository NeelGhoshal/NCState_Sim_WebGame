// Tile and map types. Each cell has a ground tile and an optional object on top.

export type Ground =
  | 'void' | 'grass' | 'sidewalk' | 'plaza' | 'roadH' | 'roadV' | 'roadX' | 'crosswalk'
  | 'rail' | 'tunnel' | 'parking' | 'field' | 'water' | 'site' | 'bldg' | 'door'
  | 'floor' | 'tile' | 'carpet' | 'wood' | 'rug' | 'wall' | 'glass' | 'kitchen'
  | 'stage' | 'stairsUp' | 'stairsDown' | 'road' | 'underpass';

export type Obj =
  | 'tree' | 'fence' | 'counter' | 'table' | 'seatN' | 'seatS' | 'chair' | 'sofa'
  | 'shelf' | 'fridge' | 'plant' | 'aud' | 'desk' | 'busstop' | 'ears';

const SOLID_GROUND = new Set<Ground>(['void', 'rail', 'water', 'bldg', 'wall', 'glass', 'kitchen', 'stage']);
const SOLID_OBJ = new Set<Obj>(['tree', 'fence', 'counter', 'table', 'shelf', 'fridge', 'plant', 'aud', 'desk', 'ears']);
const OBJ_NAMES = new Set<string>([
  'tree', 'fence', 'counter', 'table', 'seatN', 'seatS', 'chair', 'sofa', 'shelf', 'fridge',
  'plant', 'aud', 'desk', 'busstop', 'ears',
]);
export const isObj = (t: Ground | Obj): t is Obj => OBJ_NAMES.has(t);

export interface Pt { x: number; y: number }

export type InteractKind = 'venue' | 'booth' | 'bus' | 'sleep' | 'tunnel' | 'wolfears' | 'info' | 'closed' | 'class' | 'study';

export interface Interactable {
  id: string;
  kind: InteractKind;
  x: number; y: number; w: number; h: number;
  label: string;
  ref?: string;
}

export interface Portal { x: number; y: number; toMap: string; tx: number; ty: number }

export type BuildingStyle =
  | 'academic' | 'union' | 'residence' | 'dining' | 'athletic' | 'shop' | 'parking' | 'landmark' | 'service'
  | 'offcampus' | 'closed';
/**
 * A building. x/y/w/h is its bounding box in tiles. `poly` (flat [x0,y0,x1,y1,...] in tiles) is its
 * real outline when it has one; without it the box is the footprint.
 */
export interface BuildingMeta {
  name: string; x: number; y: number; w: number; h: number; style: BuildingStyle;
  poly?: number[];
  /** Draw the name on the map. Off for the second and later parts of a multi-part building. */
  label?: boolean;
  /** Large enough to label on the zoomed-out overview. */
  major?: boolean;
}

/** Smooth shapes drawn under the buildings of an outdoor map. Coordinates are tiles. */
export interface MapLine { k: string; p: number[]; name?: string; tunnel?: 1; bridge?: 1 }
export interface MapArea { k: string; p: number[]; name?: string }
export interface MapVectors { lines: MapLine[]; areas: MapArea[] }

export interface LabelMeta {
  x: number; y: number; text: string;
  kind: 'road' | 'roadV' | 'zone' | 'sign' | 'note';
}

export interface Zone { name: string; x: number; y: number; w: number; h: number }

export interface GameMap {
  id: string;
  name: string;
  w: number; h: number;
  ground: Ground[];
  obj: (Obj | null)[];
  interactables: Interactable[];
  portals: Portal[];
  spots: Record<string, Pt>;
  crowdSpots: Pt[];
  buildings: BuildingMeta[];
  labels: LabelMeta[];
  zones: Zone[];
  outdoor: boolean;
  secPerMinute: number; // real seconds of walking per game minute
  crowd: number;
  spawn: Pt;
  vectors?: MapVectors;
  /** Data credit shown while on this map. */
  credit?: string;
}

export function isSolid(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return true;
  const i = y * map.w + x;
  if (SOLID_GROUND.has(map.ground[i])) return true;
  const o = map.obj[i];
  return o !== null && SOLID_OBJ.has(o);
}

export function zoneAt(map: GameMap, x: number, y: number): string {
  // Later zones win, so specific rooms can be listed after broad areas.
  for (let i = map.zones.length - 1; i >= 0; i--) {
    const z = map.zones[i];
    if (x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h) return z.name;
  }
  return map.name;
}
