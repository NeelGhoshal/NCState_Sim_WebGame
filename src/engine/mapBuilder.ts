import {
  type BuildingMeta, type BuildingStyle, type GameMap, type Ground, type Interactable, type InteractKind,
  type LabelMeta, type MapVectors, type Obj, type Portal, type Pt, type Zone, isObj,
} from './types';

export interface MapOpts { outdoor: boolean; secPerMinute: number; crowd: number; spawn: Pt; credit?: string }

/** Bounding box of a flat [x0,y0,x1,y1,...] point list. */
export function polyBounds(p: number[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

/** Area of a flat polygon, in square tiles. */
export function polyArea(p: number[]) {
  let a = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return Math.abs(a / 2);
}

/** Even-odd point-in-polygon test on a flat point list. */
export function inPoly(x: number, y: number, p: number[]) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

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
  vectors?: MapVectors;

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

  /** Tiles whose centres fall inside a polygon (flat tile coordinates). Clipped to the map. */
  polyTiles(p: number[]): Pt[] {
    const b = polyBounds(p);
    const out: Pt[] = [];
    for (let y = Math.max(0, Math.floor(b.y0)); y <= Math.min(this.h - 1, Math.ceil(b.y1)); y++) {
      for (let x = Math.max(0, Math.floor(b.x0)); x <= Math.min(this.w - 1, Math.ceil(b.x1)); x++) {
        if (inPoly(x + 0.5, y + 0.5, p)) out.push({ x, y });
      }
    }
    return out;
  }

  fillPoly(p: number[], t: Ground | Obj) { for (const c of this.polyTiles(p)) this.set(c.x, c.y, t); }

  /**
   * Paints every tile within `radius` tiles of a polyline (flat tile coordinates), clipped to the
   * map. A radius of 0.75 or more keeps diagonal lines connected for 4-way movement.
   */
  strokeLine(p: number[], radius: number, t: Ground | Obj, when?: (g: Ground) => boolean) {
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius)), x1 = Math.min(this.w - 1, Math.ceil(Math.max(ax, bx) + radius));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - radius)), y1 = Math.min(this.h - 1, Math.ceil(Math.max(ay, by) + radius));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const cx = x + 0.5, cy = y + 0.5;
        const k = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2));
        const ex = ax + k * dx - cx, ey = ay + k * dy - cy;
        if (ex * ex + ey * ey <= radius * radius && (!when || when(this.g(x, y)))) this.set(x, y, t);
      }
    }
  }

  /**
   * Building with a real outline. Its tiles become solid; outlines may touch or overlap, as
   * mapped buildings sometimes do. Returns the tiles it covers.
   */
  polyBuilding(name: string, p: number[], style: BuildingStyle, extra: Partial<BuildingMeta> = {}): Pt[] {
    const tiles = this.polyTiles(p);
    for (const c of tiles) this.set(c.x, c.y, 'bldg');
    const b = polyBounds(p);
    this.buildings.push({ name, x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, style, poly: p, ...extra });
    return tiles;
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
      vectors: this.vectors, credit: this.opts.credit,
    };
  }
}
