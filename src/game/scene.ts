import Phaser from 'phaser';
import { ctx, bus, save } from '../core';
import { MAPS } from '../maps/index';
import { AGENTS, CROWD_LINES } from '../data/agents';
import {
  agentHere, walkTime, passTime, busRunning, BUS, boardBus, leaveBus, struckByCar, startDriving, parkCar, redLightTicket, TALK_RANGE,
} from '../engine/engine';
import { findPath, findRoute, smoothRoute, walkCost } from '../engine/grid';
import type { GameState } from '../engine/state';
import { moveBody, stepCar, drivable, onParkingLot, carPoints, type CarBody } from './motion';
import { openObjectives, type Objective } from '../ui/objectives';
import { type GameMap, type Pt, isSolid } from '../engine/types';
import {
  CHUNK, FACINGS, FRAMES, type Facing, isChunked, renderPerson, renderTag, TS,
  CAR_PALETTE, renderCar, renderBus, renderCarSignal, renderWalkHead,
} from './render';
import { Traffic, carLight, walkLight, type Vehicle, type Rect } from './traffic';
import { BUS_ROUTE, BUS_STOPS } from '../maps/campus';
import type { SignalHead } from '../engine/roads';
import { MapRenderer } from './mapRenderer';
import { interact, handleEvents, after, setBusEta, type Target } from '../ui/actions';
import { toast } from '../ui/dom';

/** What E does in the scene: the shared targets, plus getting on and off the bus. */
type SceneTarget = Target | { type: 'board'; stop: string; bus: Vehicle } | { type: 'alight'; stop: string } | { type: 'car' } | { type: 'park' };

interface Walker {
  img: Phaser.GameObjects.Image;
  label?: Phaser.GameObjects.Image;
  base: string;               // texture key prefix: `${base}:${facing}:${frame}`
  facing: Facing;
  flip: boolean;              // facing left
  anim: number;               // seconds spent walking, drives the step frames
  x: number; y: number;       // current tile
  path: Pt[];
  t: number;                  // progress to the next tile, 0..1
  speed: number;              // tiles per second
}

interface CrowdMember { w: Walker; wait: number; sitter: boolean }

const CROWD_COLORS = ['#c0392b', '#2c3e50', '#16a085', '#8e44ad', '#d35400', '#7f8c8d', '#27ae60', '#2980b9', '#f1c40f', '#e84393'];
const SKINS = ['#f1d0b0', '#e0b48f', '#c68e63', '#a8754f', '#8d5a3b', '#5e3a24'];
const HAIRS = ['#1d1410', '#4a2c1a', '#8b5a2b', '#d8b26e', '#2b2b2b', '#a33b20'];

/** Canvas pixels per world pixel for the low-detail picture of a large map. */
const OVERVIEW_SCALE = 0.2;

const cheb = (a: Pt, b: Pt) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export class WorldScene extends Phaser.Scene {
  private map!: GameMap;
  private bg?: Phaser.GameObjects.Image;
  /** Full-detail chunks of a large map, keyed "cx,cy", drawn over a low-detail overview. */
  private chunks = new Map<string, Phaser.GameObjects.Image>();
  /** Chunk keys asked of the map worker and not back yet. */
  private requested = new Set<string>();
  /** Bumped on every map load, so late replies for the previous map are dropped. */
  private generation = 0;
  private drawer = new MapRenderer();
  /** Tiles where people stand behind a raised building (see render.roofCover). */
  private cover: Uint8Array | null = null;
  private zoomTarget = 1;
  private player!: Walker;
  private agents = new Map<string, Walker & { visible: boolean }>();
  private crowd: CrowdMember[] = [];
  private night!: Phaser.GameObjects.Rectangle;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private target: SceneTarget | null = null;
  private lastPrompt = '';
  private rng = new Phaser.Math.RandomDataGenerator(['campus']);
  /** Traffic per map with streets; kept across visits so the buses keep their places. */
  private traffic = new Map<string, Traffic>();
  private vehImgs = new Map<number, Phaser.GameObjects.Image>();
  private vehPool: Phaser.GameObjects.Image[] = [];
  private heads: { img: Phaser.GameObjects.Image; h: SignalHead; key: string }[] = [];
  /** The bus you are on, or null. */
  private riding: Vehicle | null = null;
  private hitCooldown = 0;
  private lastCrossing = -1;
  /** Camera view in tiles, refreshed each frame. */
  private view: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** The player's exact position (tiles); the tile in GameState is the one under it. */
  private pos = { x: 0, y: 0 };
  /** Where you are walking: waypoints (tile coordinates) and whether you walk it yourself. */
  private route: { pts: Pt[]; auto: boolean } | null = null;
  private objective: Objective | null = null;
  private routeGfx!: Phaser.GameObjects.Graphics;
  private routeDirty = false;
  private routeTimer = 0;
  private lastChip: string | null = null;
  private stuck = 0;
  /** Your car while you drive it; null on foot. */
  private driving: CarBody | null = null;
  private carImg: Phaser.GameObjects.Image | null = null;
  private canDrive: (x: number, y: number) => boolean = () => false;
  private ticketAt = -99;

  constructor() { super('world'); }

  create() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE,P,M,O,G,X') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.disableGlobalCapture();
    this.keys.E.on('down', () => this.tryInteract());
    this.keys.SPACE.on('down', () => this.tryInteract());
    this.keys.P.on('down', () => { if (!typing()) bus.emit('phone'); });
    this.keys.M.on('down', () => { if (!typing() && !ctx.modal) this.toggleOverview(); });
    this.keys.O.on('down', () => { if (!typing() && !ctx.modal && ctx.state) openObjectives(this.objective); });
    this.keys.G.on('down', () => {
      if (typing() || ctx.modal || !this.objective || this.driving || this.riding) return;
      if (this.replan()) { this.route!.auto = true; this.routeChanged(); }
    });
    this.keys.X.on('down', () => { if (!typing() && !ctx.modal && this.objective) this.clearObjective(); });
    bus.on('goto', () => { if (ctx.state && !ctx.modal) openObjectives(this.objective); });
    bus.on('objective', (o: Objective | null) => this.setObjective(o));
    this.routeGfx = this.add.graphics().setDepth(6);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (ctx.modal || !ctx.state || p.button !== 0) return;
      this.clickMove(Math.floor(p.worldX / TS), Math.floor(p.worldY / TS));
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.zoomTarget = Phaser.Math.Clamp(this.zoomTarget * (dy > 0 ? 0.85 : 1.18), this.minZoom(), 2.5);
    });

    this.makeTrafficTextures();
    setBusEta((stop) => {
      const sec = this.busEtaSeconds(stop);
      if (sec === null) return '';
      const min = Math.round(sec / this.map.secPerMinute);
      return min <= 0 ? 'pulling in now' : `in about ${min} min`;
    });

    this.night = this.add.rectangle(0, 0, 10, 10, 0x0a1030, 0).setOrigin(0).setScrollFactor(0).setDepth(1000);
    this.scale.on('resize', () => this.fitOverlay());
    bus.on('map', () => this.loadMap());
    this.loadMap();
  }

  private fitOverlay() {
    this.night.setSize(this.scale.width, this.scale.height);
    const cam = this.cameras.main;
    if (cam.zoom < this.minZoom()) cam.setZoom(this.minZoom());
    this.zoomTarget = Math.max(this.zoomTarget, this.minZoom());
  }

  private minZoom() {
    if (!this.map) return 0.3;
    const floor = isChunked(this.map) ? 0.08 : 0.3;
    return Math.max(this.scale.width / (this.map.w * TS), this.scale.height / (this.map.h * TS), floor);
  }

  private toggleOverview() {
    const cam = this.cameras.main;
    const base = this.map.outdoor ? 1 : 1.25;
    this.zoomTarget = this.zoomTarget > this.minZoom() + 0.01 ? this.minZoom() : base;
  }

  /** Registers the nine frames (three facings x three steps) of a person; returns the key prefix. */
  private personTexture(key: string, colors: { skin: string; hair: string; shirt: string; pants: string }) {
    for (const f of FACINGS) for (const n of FRAMES) {
      const k = `${key}:${f}:${n}`;
      if (!this.textures.exists(k)) this.textures.addCanvas(k, renderPerson(colors, f, n));
    }
    return key;
  }

  private makeWalker(tex: string, x: number, y: number, speed: number, name?: string, accent = '#ffffff'): Walker {
    const img = this.add.image(x * TS + TS / 2, y * TS + TS / 2, `${tex}:down:0`).setDepth(10 + y);
    let label: Phaser.GameObjects.Image | undefined;
    if (name) {
      const key = `tag:${name}:${accent}`;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, renderTag(name, accent));
      label = this.add.image(img.x, img.y - 20, key).setOrigin(0.5, 1).setScale(0.5).setDepth(900);
    }
    return { img, label, base: tex, facing: 'down', flip: false, anim: 0, x, y, path: [], t: 0, speed };
  }

  loadMap() {
    const s = ctx.state;
    if (!s) return;
    this.map = MAPS[s.mapId];
    this.generation++;
    this.bg?.destroy();
    this.bg = undefined;
    this.clearChunks();
    this.cover = null;
    // The whole campus at low detail stays underneath; chunks stream in over it near the camera.
    // Interiors are one picture. Both are drawn by the map worker and appear when ready.
    const chunked = isChunked(this.map);
    const scale = chunked ? OVERVIEW_SCALE : 1;
    this.backdrop(`map:${this.map.id}:${chunked ? 'overview' : 'full'}`, scale);
    if (chunked) {
      const gen = this.generation;
      void this.drawer.cover(this.map.id).then((m) => { if (gen === this.generation) this.cover = m; });
    }

    this.player?.img.destroy();
    this.player?.label?.destroy();
    const col = playerColors();
    this.player = this.makeWalker(this.personTexture(`player:${col.shirt}`, col), s.x, s.y, this.map.outdoor ? 6 : 5);
    this.player.img.setDepth(500);
    this.placePlayer(s.x, s.y);
    this.canDrive = drivable(this.map);

    for (const a of this.agents.values()) { a.img.destroy(); a.label?.destroy(); }
    this.agents.clear();
    for (const def of AGENTS) {
      const w = this.makeWalker(this.personTexture(`agent:${def.id}`, def.colors), 0, 0, 3, def.name.split(' ')[0], def.colors.shirt);
      this.agents.set(def.id, { ...w, visible: false });
      w.img.setVisible(false); w.label?.setVisible(false);
    }
    this.spawnCrowd();
    this.setupTraffic();
    this.placeParkedCar();
    // Carry on toward the objective on the new map
    this.route = null;
    if (this.objective && !this.replan()) this.clearObjective();
    this.routeChanged();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.map.w * TS, this.map.h * TS);
    cam.startFollow(this.player.img, true, 0.15, 0.15);
    cam.setZoom(this.map.outdoor ? 1 : 1.25);
    this.zoomTarget = cam.zoom;
    cam.setBackgroundColor(this.map.outdoor ? '#3c5a32' : '#1b1c22');
    this.fitOverlay();
    this.syncAgents(true);
  }

  /** Shows the map's backdrop texture, drawing it in the worker the first time. */
  private backdrop(key: string, scale: number) {
    const show = () => { this.bg = this.add.image(0, 0, key).setOrigin(0).setDepth(0).setScale(1 / scale); };
    if (this.textures.exists(key)) { show(); return; }
    const gen = this.generation, map = this.map;
    void this.drawer.region(map.id, 0, 0, map.w, map.h, scale).then((bmp) => {
      if (!this.textures.exists(key)) this.textures.addImage(key, bmp as unknown as HTMLImageElement);
      else bmp.close();
      if (gen === this.generation) show();
    });
  }

  private clearChunks() {
    this.requested.clear();
    for (const img of this.chunks.values()) { const key = img.texture.key; img.destroy(); this.textures.remove(key); }
    this.chunks.clear();
  }

  /** Draws the chunks around the camera (a few per frame) and drops far ones. */
  private updateChunks() {
    if (!isChunked(this.map)) return;
    const cam = this.cameras.main;
    const size = CHUNK * TS;
    const v = cam.worldView;
    const detail = cam.zoom >= 0.4;
    const cx0 = Math.floor(v.x / size) - 1, cx1 = Math.floor((v.x + v.width) / size) + 1;
    const cy0 = Math.floor(v.y / size) - 1, cy1 = Math.floor((v.y + v.height) / size) + 1;
    for (const [k, img] of this.chunks) {
      const [cx, cy] = k.split(',').map(Number);
      const far = cx < cx0 - 2 || cx > cx1 + 2 || cy < cy0 - 2 || cy > cy1 + 2;
      if (far || (!detail && this.chunks.size > 24)) { const key = img.texture.key; img.destroy(); this.textures.remove(key); this.chunks.delete(k); }
      else img.setVisible(detail);
    }
    if (!detail) return;
    const want: [number, number, number][] = [];
    const mid = { x: (v.x + v.width / 2) / size, y: (v.y + v.height / 2) / size };
    for (let cy = Math.max(0, cy0); cy <= Math.min(cy1, Math.ceil(this.map.h / CHUNK) - 1); cy++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(cx1, Math.ceil(this.map.w / CHUNK) - 1); cx++) {
        if (!this.chunks.has(`${cx},${cy}`)) want.push([cx, cy, (cx + 0.5 - mid.x) ** 2 + (cy + 0.5 - mid.y) ** 2]);
      }
    }
    want.sort((a, b) => a[2] - b[2]);
    // Nearest first, a few at a time, so a change of direction is answered quickly.
    const gen = this.generation, mapId = this.map.id;
    for (const [cx, cy] of want) {
      if (this.drawer.inFlight >= 4) break;
      const k = `${cx},${cy}`;
      if (this.requested.has(k)) continue;
      this.requested.add(k);
      // Drawn with a 2 px bleed on every side so neighbouring chunks overlap: no seams when the
      // camera lands between pixels.
      const bleed = 2 / TS;
      void this.drawer.region(mapId, cx * CHUNK - bleed, cy * CHUNK - bleed, CHUNK + 2 * bleed, CHUNK + 2 * bleed, 1).then((bmp) => {
        if (gen !== this.generation || !this.requested.delete(k)) { bmp.close(); return; }
        const key = `chunk:${mapId}:${k}:${gen}`;
        this.textures.addImage(key, bmp as unknown as HTMLImageElement);
        this.chunks.set(k, this.add.image(cx * size - 2, cy * size - 2, key).setOrigin(0).setDepth(1));
      });
    }
  }

  private makeTrafficTextures() {
    const add = (k: string, cv: HTMLCanvasElement) => { if (!this.textures.exists(k)) this.textures.addCanvas(k, cv); };
    CAR_PALETTE.forEach((col, i) => { add(`car:${i}:0`, renderCar(col, false)); add(`car:${i}:1`, renderCar(col, true)); });
    add('bus:0', renderBus(false)); add('bus:1', renderBus(true));
    add('mycar:0', renderCar('#cc0000', false, true)); add('mycar:1', renderCar('#cc0000', true, true));
    for (const l of ['green', 'yellow', 'red'] as const) add(`sig:${l}`, renderCarSignal(l));
    add('walk:go', renderWalkHead(true, 0)); add('walk:stop', renderWalkHead(false, 0));
    for (let n = 1; n <= 9; n++) add(`walk:${n}`, renderWalkHead(false, n));
  }

  /** Vehicles and signal heads for the map just loaded. */
  private setupTraffic() {
    for (const img of this.vehImgs.values()) { img.setVisible(false); this.vehPool.push(img); }
    this.vehImgs.clear();
    for (const h of this.heads) h.img.destroy();
    this.heads = [];
    this.riding = null;
    this.driving = null;
    this.player.img.setVisible(true);
    const net = this.map.roads;
    if (!net) return;
    let tr = this.traffic.get(this.map.id);
    if (!tr) { tr = new Traffic(net); this.traffic.set(this.map.id, tr); }
    tr.reset();
    for (const h of net.heads) {
      const car = h.kind === 'car';
      const img = this.add.image(h.x * TS, h.y * TS, car ? 'sig:red' : 'walk:stop')
        .setOrigin(0.5, car ? 1 : 0.5).setDepth(10 + h.y).setScale(car ? 0.9 : 0.8).setVisible(false);
      this.heads.push({ img, h, key: '' });
    }
  }

  private get tr(): Traffic | null { return this.map.roads ? this.traffic.get(this.map.id) ?? null : null; }

  /** Seconds until a bus next reaches `stop`, or null with no bus running. */
  private busEtaSeconds(stop: string): number | null {
    const tr = this.tr;
    if (!tr) return null;
    let best = Infinity;
    for (const b of tr.buses) best = Math.min(best, tr.eta(b, stop));
    return best < Infinity ? best : null;
  }

  /** Buses run in service hours: four of them, spaced evenly round the loop. */
  private manageBuses(tr: Traffic) {
    const running = busRunning(ctx.state!.minute);
    if (running && !tr.buses.length && BUS_ROUTE.length) {
      const total = BUS_ROUTE.reduce((a, st) => a + st.s1 - st.s0, 0);
      let acc = 0, k = 0;
      for (let n = 0; n < 4; n++) {
        while (k < BUS_ROUTE.length - 1 && acc < (total * n) / 4) { acc += BUS_ROUTE[k].s1 - BUS_ROUTE[k].s0; k++; }
        tr.addBus(BUS_ROUTE, k);
      }
    } else if (!running && tr.buses.length && !this.riding) tr.removeBuses();
  }

  /** People standing on the road near the camera, in tile coordinates, for cars to brake for. */
  private roadPeds(): Pt[] {
    const out: Pt[] = [];
    const m = this.map, v = this.view;
    const add = (w: Walker) => {
      const g = m.ground[w.y * m.w + w.x];
      if (g !== 'road' && g !== 'underpass') return;
      const x = w.img.x / TS, y = w.img.y / TS;
      if (x > v.x0 - 30 && x < v.x1 + 30 && y > v.y0 - 30 && y < v.y1 + 30) out.push({ x, y });
    };
    if (!this.riding && !this.driving) add(this.player);
    // Traffic brakes for your car as it would for anyone in the road
    if (this.driving) for (const q of carPoints(this.driving.x, this.driving.y, this.driving.angle)) out.push(q);
    for (const a of this.agents.values()) if (a.visible) add(a);
    for (const c of this.crowd) add(c.w);
    return out;
  }

  /** Moves vehicle images to their vehicles, reusing images from a pool. */
  private drawVehicles(tr: Traffic) {
    const live = new Set<number>();
    for (const v of tr.vehicles) {
      live.add(v.id);
      let img = this.vehImgs.get(v.id);
      if (!img) {
        img = this.vehPool.pop() ?? this.add.image(0, 0, 'bus:0');
        img.setVisible(true);
        this.vehImgs.set(v.id, img);
      }
      const key = v.kind === 'bus' ? `bus:${v.braking ? 1 : 0}` : `car:${v.color}:${v.braking ? 1 : 0}`;
      if (img.texture.key !== key) img.setTexture(key);
      img.setPosition(v.x * TS, v.y * TS).setRotation(v.angle).setDepth(10 + v.y + 0.4);
    }
    for (const [id, img] of this.vehImgs) if (!live.has(id)) { img.setVisible(false); this.vehPool.push(img); this.vehImgs.delete(id); }
  }

  /** Lights the signal heads in view. Off-screen heads wait until they come into view. */
  private updateHeads(tr: Traffic, detail: boolean) {
    const v = this.view;
    for (const h of this.heads) {
      const on = detail && h.h.x > v.x0 - 2 && h.h.x < v.x1 + 2 && h.h.y > v.y0 - 2 && h.h.y < v.y1 + 2;
      if (h.img.visible !== on) h.img.setVisible(on);
      if (!on) continue;
      let key: string;
      if (h.h.kind === 'car') key = `sig:${carLight(tr.net, h.h.signal, h.h.main, tr.clock)}`;
      else {
        const w = walkLight(tr.net, h.h.signal, h.h.main, tr.clock);
        key = w.walk ? 'walk:go' : w.count ? `walk:${Math.min(9, w.count)}` : 'walk:stop';
      }
      if (key !== h.key) { h.key = key; h.img.setTexture(key); }
    }
  }

  /** True when the player is on a road and not on a crosswalk showing Walk (or counting down). */
  private againstSignal(tr: Traffic): boolean {
    const s = ctx.state!;
    const k = tr.net.crossTile.get(s.y * this.map.w + s.x);
    if (k === undefined) return true;
    const c = tr.net.crossings[k];
    const w = walkLight(tr.net, c.signal, c.overMain, tr.clock);
    return !w.walk && w.count === 0;
  }

  /** A car or bus ran into the player: the engine applies the cost; the player lands on the kerb. */
  private checkHit(tr: Traffic) {
    const s = ctx.state!;
    if (this.hitCooldown > 0) return;
    const g = this.map.ground[s.y * this.map.w + s.x];
    if (g !== 'road' && g !== 'underpass') return;
    const me = { x: this.pos.x, y: this.pos.y };
    const car = tr.vehicles.find((v) => v.v > 1.2 && tr.touches(v, me));
    if (!car) return;
    const against = this.againstSignal(tr);
    car.v = 0;
    this.hitCooldown = 3;
    this.cameras.main.shake(160, 0.006);
    const kerb = this.nearestKerb(s.x, s.y);
    s.x = kerb.x; s.y = kerb.y;
    this.placePlayer(kerb.x, kerb.y);
    if (this.route) { this.route.auto = false; this.routeChanged(); }
    after(struckByCar(s, against));
  }

  private nearestKerb(x0: number, y0: number): Pt {
    for (let r = 1; r < 10; r++) for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) {
      if (Math.max(Math.abs(x - x0), Math.abs(y - y0)) !== r || isSolid(this.map, x, y)) continue;
      const g = this.map.ground[y * this.map.w + x];
      if (g !== 'road' && g !== 'underpass') return { x, y };
    }
    return { x: x0, y: y0 };
  }

  /** Warns once when stepping onto a crosswalk against the signal. */
  private crossingHint(tr: Traffic) {
    const s = ctx.state!;
    const k = tr.net.crossTile.get(s.y * this.map.w + s.x) ?? -1;
    if (k === this.lastCrossing) return;
    this.lastCrossing = k;
    if (k >= 0 && this.againstSignal(tr)) toast("Don't Walk: cross traffic has the green. Wait for the walking figure.", 'warn');
  }

  private board(stop: string, v: Vehicle) {
    const r = boardBus(ctx.state!, stop);
    after(r);
    if (!r.ok) return;
    this.riding = v;
    if (this.route) { this.route.auto = false; this.routeChanged(); }
    this.player.img.setVisible(false);
  }

  private alight(stop: string) {
    const s = ctx.state!;
    const r = leaveBus(s, stop);
    this.riding = null;
    this.placePlayer(s.x, s.y);
    this.player.img.setVisible(true);
    if (this.objective) this.replan();
    after(r);
  }

  // ------------------------------------------------------------ walking

  /** Puts the player on a tile's centre. */
  private placePlayer(x: number, y: number) {
    const p = this.player;
    this.pos.x = x + 0.5; this.pos.y = y + 0.5;
    p.x = x; p.y = y;
    p.img.setPosition(this.pos.x * TS, this.pos.y * TS);
  }

  /** Arrow keys or WASD as a direction (-1..1 on each axis); nothing while a menu is open. */
  private moveKeys(): { x: number; y: number } {
    if (ctx.modal || typing()) return { x: 0, y: 0 };
    const k = this.keys, c = this.cursors;
    return {
      x: (c.right.isDown || k.D.isDown ? 1 : 0) - (c.left.isDown || k.A.isDown ? 1 : 0),
      y: (c.down.isDown || k.S.isDown ? 1 : 0) - (c.up.isDown || k.W.isDown ? 1 : 0),
    };
  }

  /**
   * Moves the player freely: the keys in eight directions, or along the route when it is
   * walking itself. Returns false when the player left the map (a door, a pass-out).
   */
  private walk(s: GameState, dt: number): boolean {
    const p = this.player, key = this.moveKeys();
    let vx = 0, vy = 0;
    if (key.x || key.y) {
      const l = Math.hypot(key.x, key.y);
      vx = key.x / l; vy = key.y / l;
      if (this.route?.auto) { this.route.auto = false; this.routeChanged(); }
    } else if (this.route?.auto && !ctx.modal) {
      const pts = this.route.pts;
      while (pts.length && Math.hypot(pts[0].x - this.pos.x, pts[0].y - this.pos.y) < 0.25) pts.shift();
      if (pts.length) {
        const d = Math.hypot(pts[0].x - this.pos.x, pts[0].y - this.pos.y);
        vx = (pts[0].x - this.pos.x) / d; vy = (pts[0].y - this.pos.y) / d;
      } else this.routeDone();
    }
    const want = p.speed * dt;
    const moved = vx || vy ? moveBody(this.map, this.pos, vx * want, vy * want) : 0;

    if (this.route) {
      // Walking by hand: the line shortens as you pass its waypoints
      const pts = this.route.pts;
      if (!this.route.auto) while (pts.length && Math.hypot(pts[0].x - this.pos.x, pts[0].y - this.pos.y) < 1.2) pts.shift();
      if (moved) this.routeDirty = true;
      // Blocked while walking itself (someone in the way): plan again, then give up
      if (this.route?.auto && (vx || vy) && moved < want * 0.2) {
        this.stuck += dt;
        if (this.stuck > 0.6) { this.stuck = 0; if (!this.replan()) this.clearObjective('No way through from here.'); }
      } else this.stuck = 0;
    }

    if (moved > 1e-4) {
      handleEvents(walkTime(s, dt / this.map.secPerMinute));
      if (s.mapId !== this.map.id || ctx.state !== s) return false;
      if (Math.abs(vx) > Math.abs(vy) + 0.1) { p.facing = 'side'; p.flip = vx < 0; } else { p.facing = vy < 0 ? 'up' : 'down'; p.flip = false; }
      p.anim += moved;
    } else p.anim = 0;
    p.img.setPosition(this.pos.x * TS, this.pos.y * TS);
    const frame = moved > 1e-4 ? 1 + (Math.floor(p.anim * 1.4) % 2) : 0;
    const tex = `${p.base}:${p.facing}:${frame}`;
    if (p.img.texture.key !== tex) p.img.setTexture(tex);
    p.img.setFlipX(p.flip);
    if (this.cover) {
      const hidden = this.cover[Math.floor(this.pos.y) * this.map.w + Math.floor(this.pos.x)] === 1;
      const a = hidden ? 0.38 : 1;
      if (p.img.alpha !== a) p.img.setAlpha(a);
    }

    // Onto a new tile: doors, the HUD, arriving
    const tx = Math.floor(this.pos.x), ty = Math.floor(this.pos.y);
    if (tx !== s.x || ty !== s.y) {
      s.x = tx; s.y = ty; p.x = tx; p.y = ty;
      const portal = this.map.portals.find((q) => q.x === tx && q.y === ty);
      if (portal) {
        s.mapId = portal.toMap; s.x = portal.tx; s.y = portal.ty;
        save();
        bus.emit('state');
        this.loadMap();
        return false;
      }
      bus.emit('state');
      this.checkArrival();
    }

    // Standing at a bus stop: the clock keeps running while you wait
    if (moved <= 1e-4 && !ctx.modal && busRunning(s.minute) && this.map.interactables.some((it) => it.kind === 'bus' && cheb(it, p) <= 1)) {
      handleEvents(passTime(s, dt / this.map.secPerMinute));
      if (s.mapId !== this.map.id || ctx.state !== s) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ routes and objectives

  private setObjective(o: Objective | null) {
    if (!o) { this.clearObjective(); return; }
    this.objective = o;
    this.route = null;
    if (!this.replan()) { toast(`Can't find a way to ${o.label} from here.`, 'warn'); this.clearObjective(); return; }
    this.route!.auto = !this.driving && !this.riding;
    this.routeChanged();
    if (this.driving) toast(`Route to ${o.label} drawn. Park, then press G to walk it.`);
  }

  private clearObjective(msg?: string) {
    if (msg) toast(msg, 'warn');
    this.objective = null;
    this.route = null;
    this.routeChanged();
  }

  /** The tiles from which you count as at the objective: its own tile if walkable, else around it. */
  private approachTiles(o: Objective): Pt[] {
    const out: Pt[] = [];
    if (o.w === 1 && o.h === 1 && !isSolid(this.map, o.x, o.y)) out.push({ x: o.x, y: o.y });
    for (let y = o.y - 1; y <= o.y + o.h; y++) for (let x = o.x - 1; x <= o.x + o.w; x++) {
      const edge = x === o.x - 1 || x === o.x + o.w || y === o.y - 1 || y === o.y + o.h;
      if (edge && !isSolid(this.map, x, y)) out.push({ x, y });
    }
    return out;
  }

  /** The door on this map that starts the way to another map (by the fewest doors). */
  private portalToward(mapId: string) {
    const first = new Map<string, (typeof this.map.portals)[number]>();
    const queue: string[] = [];
    for (const p of this.map.portals) if (!first.has(p.toMap)) { first.set(p.toMap, p); queue.push(p.toMap); }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (id === mapId) return first.get(id)!;
      for (const p of MAPS[id].portals) if (!first.has(p.toMap) && p.toMap !== this.map.id) { first.set(p.toMap, first.get(id)!); queue.push(p.toMap); }
    }
    return null;
  }

  /** Plans the walking route to the objective, or to the door toward its map. */
  private replan(): boolean {
    const o = this.objective;
    if (!o) return false;
    const from = { x: Math.floor(this.pos.x), y: Math.floor(this.pos.y) };
    let goals: Pt[];
    if (o.mapId === this.map.id) goals = this.approachTiles(o);
    else {
      const door = this.portalToward(o.mapId);
      if (!door) return false;
      goals = [{ x: door.x, y: door.y }];
    }
    goals.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    const cost = walkCost(this.map, this.map.roads?.crossTile);
    for (const g of goals.slice(0, 3)) {
      const path = findRoute(this.map, from, g, cost);
      if (!path) continue;
      const auto = this.route?.auto ?? true;
      this.route = { pts: path.length ? smoothRoute(this.map, from, path, cost) : [{ x: g.x + 0.5, y: g.y + 0.5 }], auto };
      this.routeChanged();
      return true;
    }
    return false;
  }

  /** Arrived when next to the objective on its map. */
  private checkArrival() {
    const o = this.objective, s = ctx.state!;
    if (!o || o.mapId !== this.map.id) return;
    const dx = Math.max(o.x - s.x, 0, s.x - (o.x + o.w - 1)), dy = Math.max(o.y - s.y, 0, s.y - (o.y + o.h - 1));
    if (Math.max(dx, dy) > 1) return;
    toast(`You're at ${o.label}.`, 'ok');
    this.clearObjective();
  }

  /** The end of an auto-walked route: arrived, or a click-to-move finished. */
  private routeDone() {
    if (this.objective) {
      this.checkArrival();
      if (this.objective && !this.replan()) this.clearObjective();
    } else { this.route = null; this.routeChanged(); }
  }

  private routeChanged() {
    this.routeDirty = true;
    this.routeChip(true);
  }

  /** The HUD line for the active objective; refreshed when its numbers change. */
  private routeChip(force = false) {
    const o = this.objective;
    let text: string | null = null;
    if (o) {
      let len = 0, x = this.pos.x, y = this.pos.y;
      for (const q of this.route?.pts ?? []) { len += Math.hypot(q.x - x, q.y - y); x = q.x; y = q.y; }
      const min = Math.max(1, Math.round(len / this.player.speed / this.map.secPerMinute));
      const mode = this.driving ? 'park, then [G] to walk' : this.route?.auto ? 'walking there' : '[G] walk it for me';
      text = `→ ${o.label} · about ${min} min on foot · ${mode} · [X] clear`;
    }
    if (force || text !== this.lastChip) { this.lastChip = text; bus.emit('route', text); }
  }

  /** Draws the route as a dotted line with a ring at the end. */
  private drawRoute() {
    const g = this.routeGfx;
    g.clear();
    if (!this.route || !this.route.pts.length) return;
    const pts = [{ x: this.pos.x, y: this.pos.y }, ...this.route.pts];
    g.fillStyle(0xffd34d, 0.95);
    // Only the dots on screen: a cross-campus route would otherwise be hundreds of shapes a frame
    const v = this.view, pad = 3;
    const shown = (x: number, y: number) => x > v.x0 - pad && x < v.x1 + pad && y > v.y0 - pad && y < v.y1 + pad;
    let carry = 0.5;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y);
      let d = carry;
      for (; d < len; d += 0.7) {
        const x = a.x + ((b.x - a.x) * d) / len, y = a.y + ((b.y - a.y) * d) / len;
        if (shown(x, y)) g.fillCircle(x * TS, y * TS, 3.5);
      }
      carry = d - len;
    }
    const end = pts[pts.length - 1];
    g.lineStyle(3, 0xffd34d, 1);
    g.strokeCircle(end.x * TS, end.y * TS, 11);
    g.fillStyle(0xffd34d, 0.35);
    g.fillCircle(end.x * TS, end.y * TS, 11);
  }

  // ------------------------------------------------------------ your car

  /** The parked car, drawn on campus wherever it was left. */
  private placeParkedCar() {
    const s = ctx.state!;
    if (this.map.id !== 'campus') { this.carImg?.setVisible(false); return; }
    this.carImg ??= this.add.image(0, 0, 'mycar:0');
    this.carImg.setVisible(true).setTexture('mycar:0').setPosition(s.car.x * TS, s.car.y * TS).setRotation(s.car.angle).setDepth(10 + s.car.y + 0.4);
  }

  private getInCar() {
    const s = ctx.state!;
    const r = startDriving(s);
    after(r);
    if (!r.ok) return;
    this.driving = { x: s.car.x, y: s.car.y, angle: s.car.angle, v: 0, steer: 0 };
    this.player.img.setVisible(false);
    if (this.route) { this.route.auto = false; this.routeChanged(); }
    this.zoomTarget = Math.min(this.zoomTarget, 0.75);
  }

  private getOutOfCar() {
    const s = ctx.state!, c = this.driving!;
    if (Math.abs(c.v) > 0.4) { toast('Stop first: hold S to brake.'); return; }
    const r = parkCar(s, c, onParkingLot(this.map, c));
    after(r);
    if (!r.ok) return;
    this.driving = null;
    const spot = this.besideCar(c);
    s.x = spot.x; s.y = spot.y;
    this.placePlayer(spot.x, spot.y);
    this.player.img.setVisible(true);
    this.placeParkedCar();
    this.zoomTarget = Math.max(this.zoomTarget, 1);
    bus.emit('state');
  }

  /** A walkable tile next to the car, clear of it. */
  private besideCar(c: { x: number; y: number }): Pt {
    const cx = Math.floor(c.x), cy = Math.floor(c.y);
    for (let r = 1; r < 6; r++) {
      let best: Pt | null = null, bd = Infinity;
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || isSolid(this.map, x, y)) continue;
        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
        const g = this.map.ground[y * this.map.w + x];
        const score = d + (g === 'road' ? 3 : 0);
        if (d > 1.1 && score < bd) { bd = score; best = { x, y }; }
      }
      if (best) return best;
    }
    return { x: cx, y: cy };
  }

  /** Whether the car at these points would hit a vehicle or a person. */
  private carBlocked(pts: Pt[], tr: Traffic | null): boolean {
    if (tr) for (const v of tr.vehicles) {
      if (Math.abs(v.x - pts[0].x) > 4 || Math.abs(v.y - pts[0].y) > 4) continue;
      if (pts.some((p) => tr.touches(v, p, 0.05))) return true;
    }
    const near = (w: Walker) => pts.some((p) => Math.hypot(w.img.x / TS - p.x, w.img.y / TS - p.y) < 0.45);
    for (const a of this.agents.values()) if (a.visible && near(a)) return true;
    for (const c of this.crowd) if (near(c.w)) return true;
    return false;
  }

  /** One frame at the wheel. Returns false when the map changed (a pass-out). */
  private drive(s: GameState, dt: number, tr: Traffic | null): boolean {
    const c = this.driving!, key = this.moveKeys();
    const prev = { x: c.x, y: c.y };
    stepCar(c, -key.y, key.x, dt, this.canDrive, (pts) => this.carBlocked(pts, tr), (x, y) => isSolid(this.map, x, y));
    const braking = (key.y > 0 && c.v > 0.2) || (key.y < 0 && c.v < -0.2);
    const img = this.carImg!;
    const tex = `mycar:${braking ? 1 : 0}`;
    if (img.texture.key !== tex) img.setTexture(tex);
    img.setPosition(c.x * TS, c.y * TS).setRotation(c.angle).setDepth(10 + c.y + 0.4);
    this.pos.x = c.x; this.pos.y = c.y;
    this.player.img.setPosition(c.x * TS, c.y * TS);
    if (Math.abs(c.v) > 0.1) {
      handleEvents(passTime(s, dt / this.map.secPerMinute));
      if (s.mapId !== this.map.id || ctx.state !== s || !this.driving) return false;
    }
    const tx = Math.floor(c.x), ty = Math.floor(c.y);
    if ((tx !== s.x || ty !== s.y) && !isSolid(this.map, tx, ty)) { s.x = tx; s.y = ty; this.player.x = tx; this.player.y = ty; bus.emit('state'); }
    if (tr && c.v > 0.5) this.checkRedLight(tr, prev, c);
    return true;
  }

  /** Crossing a stop line on red gets you a ticket (the engine sets the fine). */
  private checkRedLight(tr: Traffic, a: Pt, b: Pt) {
    if (tr.clock - this.ticketAt < 6) return;
    for (const l of tr.net.stopLines) {
      if (Math.abs(l.x0 - b.x) > 4 || Math.abs(l.y0 - b.y) > 4) continue;
      if (!segmentsCross(a.x, a.y, b.x, b.y, l.x0, l.y0, l.x1, l.y1)) continue;
      if (carLight(tr.net, l.signal, l.main, tr.clock) !== 'red') continue;
      this.ticketAt = tr.clock;
      this.cameras.main.flash(250, 40, 60, 255);
      after(redLightTicket(ctx.state!));
      return;
    }
  }

  private spawnCrowd() {
    for (const c of this.crowd) c.w.img.destroy();
    this.crowd = [];
    const s = ctx.state!;
    const hour = (s.minute / 60) % 24;
    const factor = hour >= 8 && hour < 21 ? 1 : hour >= 21 || hour < 1 ? 0.5 : 0.2;
    const spots = this.map.crowdSpots.filter((p) => !isSolid(this.map, p.x, p.y));
    const n = Math.min(spots.length, Math.round(this.map.crowd * factor));
    const shuffled = this.rng.shuffle(spots.slice());
    for (let i = 0; i < n; i++) {
      const p = shuffled[i];
      const col = { skin: this.rng.pick(SKINS), hair: this.rng.pick(HAIRS), shirt: this.rng.pick(CROWD_COLORS), pants: this.rng.pick(['#2b2f45', '#33363d', '#5a4a3a', '#1e2230']) };
      const tex = this.personTexture(`crowd:${col.skin}${col.hair}${col.shirt}${col.pants}`, col);
      const w = this.makeWalker(tex, p.x, p.y, 2.2);
      w.img.setAlpha(0.92);
      this.crowd.push({ w, wait: this.rng.between(2, 15), sitter: i % 3 !== 0 });
    }
  }

  private syncAgents(snap = false) {
    const s = ctx.state!;
    for (const def of AGENTS) {
      const a = this.agents.get(def.id)!;
      const here = agentHere(s, def.id);
      if (!here) {
        if (a.visible) { a.visible = false; a.img.setVisible(false); a.label?.setVisible(false); a.path = []; }
        continue;
      }
      const goal = here.pos;
      if (!a.visible || snap) {
        a.visible = true; a.x = goal.x; a.y = goal.y; a.path = []; a.t = 0;
        a.img.setVisible(true).setPosition(goal.x * TS + TS / 2, goal.y * TS + TS / 2);
        a.label?.setVisible(true);
        continue;
      }
      const last = a.path.length ? a.path[a.path.length - 1] : { x: a.x, y: a.y };
      if (last.x !== goal.x || last.y !== goal.y) {
        const p = findPath(this.map, { x: a.x, y: a.y }, goal);
        if (p) { a.path = p; a.t = 0; } else { a.x = goal.x; a.y = goal.y; a.path = []; }
      }
    }
  }

  /** Advances a walker along its path. Returns the tiles it arrived on. */
  /** `shown` false skips the cosmetic work (frames, see-through, depth) for walkers off screen. */
  private step(w: Walker, dt: number, ignoreSolid = true, shown = true): Pt[] {
    const arrived: Pt[] = [];
    if (!w.path.length) {
      w.img.setPosition(w.x * TS + TS / 2, w.y * TS + TS / 2);
    } else {
      w.t += dt * w.speed;
      while (w.t >= 1 && w.path.length) {
        const n = w.path.shift()!;
        if (!ignoreSolid && isSolid(this.map, n.x, n.y)) { w.path = []; w.t = 0; break; }
        w.x = n.x; w.y = n.y; w.t -= 1;
        arrived.push(n);
      }
      if (!w.path.length) w.t = 0;
      const next = w.path[0];
      const fx = next ? w.x + (next.x - w.x) * w.t : w.x;
      const fy = next ? w.y + (next.y - w.y) * w.t : w.y;
      w.img.setPosition(fx * TS + TS / 2, fy * TS + TS / 2);
      if (next) {
        const dx = next.x - w.x, dy = next.y - w.y;
        if (dx) { w.facing = 'side'; w.flip = dx < 0; } else if (dy) { w.facing = dy < 0 ? 'up' : 'down'; w.flip = false; }
      }
    }
    if (!shown) return arrived;
    // Two-step walk cycle while moving; stand still otherwise
    const moving = w.path.length > 0;
    w.anim = moving ? w.anim + dt : 0;
    const frame = moving ? 1 + (Math.floor(w.anim * w.speed * 1.6) % 2) : 0;
    const key = `${w.base}:${w.facing}:${frame}`;
    if (w.img.texture.key !== key) w.img.setTexture(key);
    w.img.setFlipX(w.flip);
    // Behind a raised wall or roof: show the person see-through instead of standing on the roof.
    if (this.cover) {
      const tx = Math.round(w.img.x / TS - 0.5), ty = Math.round(w.img.y / TS - 0.5);
      const hidden = this.cover[ty * this.map.w + tx] === 1;
      const want = hidden ? 0.38 : w === this.player ? 1 : w.label ? 1 : 0.92;
      if (w.img.alpha !== want) w.img.setAlpha(want);
    }
    w.label?.setPosition(w.img.x, w.img.y - 14);
    if (w !== this.player) w.img.setDepth(10 + w.img.y / TS);
    return arrived;
  }

  private clickMove(tx: number, ty: number) {
    const s = ctx.state!;
    let goal = { x: tx, y: ty };
    if (isSolid(this.map, tx, ty)) {
      const opts = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]
        .map(([dx, dy]) => ({ x: tx + dx, y: ty + dy }))
        .filter((p) => !isSolid(this.map, p.x, p.y))
        .sort((a, b) => cheb(a, s) - cheb(b, s));
      if (!opts.length) return;
      goal = opts[0];
    }
    if (this.driving || this.riding) return;
    const from = { x: Math.floor(this.pos.x), y: Math.floor(this.pos.y) };
    const cost = walkCost(this.map, this.map.roads?.crossTile);
    const path = findRoute(this.map, from, goal, cost);
    if (!path) return;
    // A click replaces any objective with a plain walk to that spot
    this.objective = null;
    this.route = { pts: path.length ? smoothRoute(this.map, from, path, cost) : [], auto: true };
    this.routeChanged();
  }

  private findTarget(): SceneTarget | null {
    const s = ctx.state!;
    const me = { x: s.x, y: s.y };
    if (this.riding) {
      const b = this.riding;
      return b.dwell! > 0 && b.at ? { type: 'alight', stop: b.at } : null;
    }
    if (this.driving) return Math.abs(this.driving.v) < 0.4 ? { type: 'park' } : null;
    const tr = this.tr;
    if (tr) for (const b of tr.buses) {
      if (!(b.dwell! > 0.3) || !b.at) continue;
      if (cheb(BUS_STOPS[b.at], me) <= 2) return { type: 'board', stop: b.at, bus: b };
    }
    if (this.map.id === 'campus' && Math.hypot(s.car.x - this.pos.x, s.car.y - this.pos.y) < 2.4) return { type: 'car' };
    let best: { d: number; t: Target } | null = null;
    for (const def of AGENTS) {
      const a = this.agents.get(def.id)!;
      if (!a.visible) continue;
      const d = cheb(a, me);
      if (d <= TALK_RANGE && (!best || d < best.d)) best = { d, t: { type: 'agent', id: def.id } };
    }
    // Someone right next to you wins; otherwise a thing you are touching beats a person two tiles away.
    if (best && best.d <= 1) return best.t;
    for (const it of this.map.interactables) {
      const dx = Math.max(it.x - s.x, 0, s.x - (it.x + it.w - 1));
      const dy = Math.max(it.y - s.y, 0, s.y - (it.y + it.h - 1));
      if (Math.max(dx, dy) <= 1) return { type: 'obj', it };
    }
    if (best) return best.t;
    for (const c of this.crowd) {
      if (cheb(c.w, me) <= 1) return { type: 'crowd', line: CROWD_LINES[(c.w.x * 7 + c.w.y) % CROWD_LINES.length] };
    }
    return null;
  }

  private describe(t: SceneTarget): string {
    if (t.type === 'board') return 'Board the Wolfline (free)';
    if (t.type === 'alight') return `Get off at ${BUS_STOPS[t.stop].name}`;
    if (t.type === 'car') return 'Drive your car';
    if (t.type === 'park') return onParkingLot(this.map, this.driving!) ? 'Park here and get out' : 'No parking here: find a lot marked P';
    if (t.type === 'obj' && t.it.kind === 'bus') {
      if (!busRunning(ctx.state!.minute)) return `${t.it.label} · no buses until 7 AM`;
      const sec = this.busEtaSeconds(t.it.ref!);
      if (sec === null) return t.it.label;
      return `${t.it.label} · next bus in about ${Math.max(1, Math.round(sec / this.map.secPerMinute))} min`;
    }
    return describeTarget(t);
  }

  private inView(w: Walker) {
    const v = this.view, x = w.img.x / TS, y = w.img.y / TS;
    return x > v.x0 - 2 && x < v.x1 + 2 && y > v.y0 - 2 && y < v.y1 + 2;
  }

  private tryInteract() {
    if (typing() || ctx.modal || !ctx.state) return;
    const t = this.findTarget();
    if (!t) return;
    if (t.type === 'board') return this.board(t.stop, t.bus);
    if (t.type === 'alight') return this.alight(t.stop);
    if (t.type === 'car') return this.getInCar();
    if (t.type === 'park') return this.getOutOfCar();
    if (this.route?.auto) { this.route.auto = false; this.routeChanged(); }
    interact(t);
  }

  update(_time: number, deltaMs: number) {
    const s = ctx.state;
    if (!s || !this.map || s.mapId !== this.map.id) return;
    const dt = Math.min(deltaMs, 100) / 1000;

    const cam = this.cameras.main;
    const wv = cam.worldView;
    this.view = { x0: wv.x / TS, y0: wv.y / TS, x1: (wv.x + wv.width) / TS, y1: (wv.y + wv.height) / TS };
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    const p = this.player;

    // On the bus: the clock runs, you go where it goes, and you get off at a stop
    if (this.riding) {
      const b = this.riding;
      handleEvents(passTime(s, (dt / this.map.secPerMinute) * BUS.rideRate));
      if (s.mapId !== this.map.id || ctx.state !== s || !this.riding) return;
      p.img.setPosition(b.x * TS, b.y * TS);
      const tx = Math.floor(b.x), ty = Math.floor(b.y);
      if ((tx !== s.x || ty !== s.y) && !isSolid(this.map, tx, ty)) { s.x = tx; s.y = ty; p.x = tx; p.y = ty; bus.emit('state'); }
      if (this.route) this.routeDirty = true;
      // Service over: everyone off at the next stop
      if (b.dwell! > 0 && b.at && !busRunning(s.minute)) { toast('Last stop of the night. Everybody off.'); this.alight(b.at); }
    }

    // On foot or at the wheel
    if (!this.riding) {
      if (this.driving) { if (!this.drive(s, dt, this.tr)) return; }
      else if (!this.walk(s, dt)) return;
    } else { this.pos.x = this.riding.x; this.pos.y = this.riding.y; }

    // The route line follows you, redrawn a few times a second
    this.routeTimer -= dt;
    if (this.routeDirty && this.routeTimer <= 0) { this.routeDirty = false; this.routeTimer = 0.12; this.drawRoute(); this.routeChip(); }

    // Traffic: cars near the camera, the buses everywhere, the lights in view
    const tr = this.tr;
    if (tr) {
      const detail = cam.zoom >= 0.4;
      const hour = (s.minute / 60) % 24;
      const busy = hour >= 7 && hour < 19 ? 1 : hour >= 19 && hour < 23 ? 0.55 : 0.2;
      this.manageBuses(tr);
      tr.update(dt, detail ? this.view : null, this.roadPeds(), busy);
      this.drawVehicles(tr);
      this.updateHeads(tr, detail);
      if (!this.riding && !this.driving) { this.checkHit(tr); this.crossingHint(tr); }
    }

    // Agents and crowd
    this.syncAgents();
    for (const a of this.agents.values()) if (a.visible) this.step(a, dt);
    for (const c of this.crowd) {
      if (c.w.path.length) { this.step(c.w, dt, true, this.inView(c.w)); continue; }
      c.wait -= dt;
      if (c.wait <= 0 && !c.sitter) {
        // Wander to a spot nearby; on a big map a random spot could be across campus.
        const spots = this.map.crowdSpots;
        let goal = spots[this.rng.between(0, spots.length - 1)];
        for (let k = 0; k < 12 && cheb(goal, c.w) > 30; k++) goal = spots[this.rng.between(0, spots.length - 1)];
        if (cheb(goal, c.w) <= 40 && !isSolid(this.map, goal.x, goal.y)) {
          const path = findPath(this.map, { x: c.w.x, y: c.w.y }, goal);
          if (path && path.length < 60) c.w.path = path;
        }
        c.wait = this.rng.between(6, 20);
      }
    }

    // Ease toward the wanted zoom; snap when close so the camera settles
    if (Math.abs(cam.zoom - this.zoomTarget) > 0.002) cam.setZoom(cam.zoom + (this.zoomTarget - cam.zoom) * Math.min(1, dt * 12));
    else if (cam.zoom !== this.zoomTarget) cam.setZoom(this.zoomTarget);
    this.updateChunks();

    // Night tint outdoors
    const hour = (s.minute / 60) % 24;
    const dark = hour >= 19 || hour < 6 ? Math.min(0.5, (hour >= 19 ? hour - 19 : 5) * 0.12) : 0;
    this.night.setFillStyle(0x0a1030, this.map.outdoor ? dark : 0);

    // Interaction prompt
    this.target = this.findTarget();
    const prompt = this.target ? this.describe(this.target) : '';
    if (prompt !== this.lastPrompt) { this.lastPrompt = prompt; bus.emit('prompt', prompt || null); }
  }
}

function describeTarget(t: Target): string {
  if (t.type === 'agent') return `Talk to ${AGENTS.find((a) => a.id === t.id)!.name}`;
  if (t.type === 'crowd') return 'Say hi';
  return t.it.label;
}

function typing() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

function playerColors() {
  return { skin: '#c68e63', hair: '#2b1d14', shirt: '#cc0000', pants: '#22252e' };
}

/** Whether segment a-b crosses segment c-d. */
function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return o(ax, ay, bx, by, cx, cy) !== o(ax, ay, bx, by, dx, dy) && o(cx, cy, dx, dy, ax, ay) !== o(cx, cy, dx, dy, bx, by);
}
