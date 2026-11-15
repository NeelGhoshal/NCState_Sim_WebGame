import {
  type BuildingMeta, type BuildingStyle, type GameMap, type Ground, type Interactable, type InteractKind,
  type LabelMeta, type Obj, type Portal, type Pt, type Zone, isObj,
} from './types';

export interface MapOpts { outdoor: boolean; secPerMinute: number; crowd: number; spawn: Pt }

/** Builds a tile map in code. Coordinates are tiles; (0,0) is the top-left. */
export class MapBuilder {
  ground: Ground[];
  obj: (Obj | null)[];
  interactables: Interactable[] = [];
  portals: Portal[] = [];
  spots: Record<string, Pt> = {};
  crowdSpots: Pt[] = [];
  buildings: BuildingMeta[] = [];
  labels: LabelMeta[] = [];
  zones: Zone[] = [];

  constructor(public id: string, public name: string, public w: number, public h: number, base: Ground, private opts: MapOpts) {
    this.ground = new Array(w * h).fill(base);
    this.obj = new Array(w * h).fill(null);
  }

  inb(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  g(x: number, y: number): Ground { return this.ground[y * this.w + x]; }

  set(x: number, y: number, t: Ground | Obj) {
    if (!this.inb(x, y)) throw new Error(`${this.id}: (${x},${y}) out of bounds`);
    const i = y * this.w + x;
    if (isObj(t)) this.obj[i] = t;
    else { this.ground[i] = t; this.obj[i] = null; }
  }

  fill(x: number, y: number, w: number, h: number, t: Ground | Obj) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, t);
  }

  outline(x: number, y: number, w: number, h: number, t: Ground | Obj = 'wall') {
    for (let xx = x; xx < x + w; xx++) { this.set(xx, y, t); this.set(xx, y + h - 1, t); }
    for (let yy = y; yy < y + h; yy++) { this.set(x, yy, t); this.set(x + w - 1, yy, t); }
  }

  /** Walled room: the rectangle includes its walls. */
  room(x: number, y: number, w: number, h: number, floor: Ground, wall: Ground = 'wall') {
    this.fill(x, y, w, h, floor);
    this.outline(x, y, w, h, wall);
  }

  label(x: number, y: number, text: string, kind: LabelMeta['kind'] = 'zone') { this.labels.push({ x, y, text, kind }); }
  zone(name: string, x: number, y: number, w: number, h: number) { this.zones.push({ name, x, y, w, h }); }

  spot(name: string, x: number, y: number) {
    if (this.spots[name]) throw new Error(`${this.id}: duplicate spot ${name}`);
    this.spots[name] = { x, y };
  }

  interact(kind: InteractKind, x: number, y: number, w: number, h: number, label: string, ref?: string) {
    this.interactables.push({ id: `${this.id}:${kind}:${ref ?? label}:${x},${y}`, kind, x, y, w, h, label, ref });
  }

  portal(x: number, y: number, toMap: string, tx: number, ty: number) { this.portals.push({ x, y, toMap, tx, ty }); }

  /** Counter with a venue attached. The player orders from any side they can reach. */
  counter(x: number, y: number, w: number, h: number, venueId: string, label: string) {
    this.fill(x, y, w, h, 'counter');
    this.interact('venue', x, y, w, h, label, venueId);
  }

  /**
   * Booth, 2 tiles wide and 3 tall: a bench, a table, a bench.
   * Registers spots `${id}.a` (north bench) and `${id}.b` (south bench).
   */
  booth(id: string, x: number, y: number, crowd = true) {
    this.fill(x, y, 2, 1, 'seatN');
    this.fill(x, y + 1, 2, 1, 'table');
    this.fill(x, y + 2, 2, 1, 'seatS');
    this.spot(`${id}.a`, x, y);
    this.spot(`${id}.b`, x, y + 2);
    this.interact('booth', x, y + 1, 2, 1, 'Booth', id);
    if (crowd) this.crowdSpots.push({ x: x + 1, y }, { x: x + 1, y: y + 2 });
  }

  /** Two-tile table with chairs above and below. */
  tableSet(x: number, y: number, crowd = true) {
    this.fill(x, y, 2, 1, 'table');
    this.fill(x, y - 1, 2, 1, 'chair');
    this.fill(x, y + 1, 2, 1, 'chair');
    if (crowd) this.crowdSpots.push({ x, y: y - 1 }, { x: x + 1, y: y + 1 });
  }

  building(name: string, x: number, y: number, w: number, h: number, style: BuildingStyle) {
    for (const b of this.buildings) {
      if (x < b.x + b.w && b.x < x + w && y < b.y + b.h && b.y < y + h) {
        throw new Error(`${this.id}: building ${name} overlaps ${b.name}`);
      }
    }
    this.fill(x, y, w, h, 'bldg');
    this.buildings.push({ name, x, y, w, h, style });
  }

  build(): GameMap {
    return {
      id: this.id, name: this.name, w: this.w, h: this.h,
      ground: this.ground, obj: this.obj,
      interactables: this.interactables, portals: this.portals, spots: this.spots,
      crowdSpots: this.crowdSpots, buildings: this.buildings, labels: this.labels, zones: this.zones,
      outdoor: this.opts.outdoor, secPerMinute: this.opts.secPerMinute, crowd: this.opts.crowd, spawn: this.opts.spawn,
    };
  }
}
