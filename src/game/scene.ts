import Phaser from 'phaser';
import { ctx, bus, save } from '../core';
import { MAPS } from '../maps/index';
import { AGENTS, CROWD_LINES } from '../data/agents';
import { agentHere, walkTime, TALK_RANGE } from '../engine/engine';
import { findPath } from '../engine/grid';
import { type GameMap, type Pt, isSolid } from '../engine/types';
import { CHUNK, FACINGS, FRAMES, type Facing, isChunked, renderMap, renderPerson, renderRegion, renderTag, TS } from './render';
import { interact, handleEvents, type Target } from '../ui/actions';

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
  private player!: Walker;
  private agents = new Map<string, Walker & { visible: boolean }>();
  private crowd: CrowdMember[] = [];
  private night!: Phaser.GameObjects.Rectangle;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private target: Target | null = null;
  private lastPrompt = '';
  private rng = new Phaser.Math.RandomDataGenerator(['campus']);

  constructor() { super('world'); }

  create() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE,P,M') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.disableGlobalCapture();
    this.keys.E.on('down', () => this.tryInteract());
    this.keys.SPACE.on('down', () => this.tryInteract());
    this.keys.P.on('down', () => { if (!typing()) bus.emit('phone'); });
    this.keys.M.on('down', () => { if (!typing() && !ctx.modal) this.toggleOverview(); });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (ctx.modal || !ctx.state || p.button !== 0) return;
      this.clickMove(Math.floor(p.worldX / TS), Math.floor(p.worldY / TS));
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), this.minZoom(), 2.5));
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
  }

  private minZoom() {
    if (!this.map) return 0.3;
    const floor = isChunked(this.map) ? 0.08 : 0.3;
    return Math.max(this.scale.width / (this.map.w * TS), this.scale.height / (this.map.h * TS), floor);
  }

  private toggleOverview() {
    const cam = this.cameras.main;
    const base = this.map.outdoor ? 1 : 1.25;
    cam.setZoom(cam.zoom > this.minZoom() + 0.01 ? this.minZoom() : base);
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
    this.bg?.destroy();
    this.clearChunks();
    if (isChunked(this.map)) {
      // The whole campus at low detail stays underneath; chunks stream in over it near the camera.
      const key = `map:${this.map.id}:overview`;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, renderRegion(this.map, 0, 0, this.map.w, this.map.h, OVERVIEW_SCALE));
      this.bg = this.add.image(0, 0, key).setOrigin(0).setDepth(0).setScale(1 / OVERVIEW_SCALE);
    } else {
      const key = `map:${this.map.id}`;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, renderMap(this.map));
      this.bg = this.add.image(0, 0, key).setOrigin(0).setDepth(0);
    }

    this.player?.img.destroy();
    this.player?.label?.destroy();
    const col = playerColors();
    this.player = this.makeWalker(this.personTexture(`player:${col.shirt}`, col), s.x, s.y, this.map.outdoor ? 6 : 5);
    this.player.img.setDepth(500);

    for (const a of this.agents.values()) { a.img.destroy(); a.label?.destroy(); }
    this.agents.clear();
    for (const def of AGENTS) {
      const w = this.makeWalker(this.personTexture(`agent:${def.id}`, def.colors), 0, 0, 3, def.name.split(' ')[0], def.colors.shirt);
      this.agents.set(def.id, { ...w, visible: false });
      w.img.setVisible(false); w.label?.setVisible(false);
    }
    this.spawnCrowd();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.map.w * TS, this.map.h * TS);
    cam.startFollow(this.player.img, true, 0.15, 0.15);
    cam.setZoom(this.map.outdoor ? 1 : 1.25);
    cam.setBackgroundColor(this.map.outdoor ? '#3c5a32' : '#1b1c22');
    this.fitOverlay();
    this.syncAgents(true);
  }

  private clearChunks() {
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
    let budget = 2;
    const want: [number, number, number][] = [];
    const mid = { x: (v.x + v.width / 2) / size, y: (v.y + v.height / 2) / size };
    for (let cy = Math.max(0, cy0); cy <= Math.min(cy1, Math.ceil(this.map.h / CHUNK) - 1); cy++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(cx1, Math.ceil(this.map.w / CHUNK) - 1); cx++) {
        if (!this.chunks.has(`${cx},${cy}`)) want.push([cx, cy, (cx + 0.5 - mid.x) ** 2 + (cy + 0.5 - mid.y) ** 2]);
      }
    }
    want.sort((a, b) => a[2] - b[2]);
    for (const [cx, cy] of want) {
      if (budget-- <= 0) break;
      const k = `${cx},${cy}`, key = `chunk:${this.map.id}:${k}`;
      // Drawn with a 2 px bleed on every side so neighbouring chunks overlap: no seams when the
      // camera lands between pixels.
      const bleed = 2 / TS;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, renderRegion(this.map, cx * CHUNK - bleed, cy * CHUNK - bleed, CHUNK + 2 * bleed, CHUNK + 2 * bleed, 1));
      this.chunks.set(k, this.add.image(cx * size - 2, cy * size - 2, key).setOrigin(0).setDepth(1));
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
  private step(w: Walker, dt: number, ignoreSolid = true): Pt[] {
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
    // Two-step walk cycle while moving; stand still otherwise
    const moving = w.path.length > 0;
    w.anim = moving ? w.anim + dt : 0;
    const frame = moving ? 1 + (Math.floor(w.anim * w.speed * 1.6) % 2) : 0;
    const key = `${w.base}:${w.facing}:${frame}`;
    if (w.img.texture.key !== key) w.img.setTexture(key);
    w.img.setFlipX(w.flip);
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
    const path = findPath(this.map, { x: this.player.x, y: this.player.y }, goal);
    if (path) { this.player.path = path; }
  }

  private findTarget(): Target | null {
    const s = ctx.state!;
    const me = { x: s.x, y: s.y };
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

  private tryInteract() {
    if (typing() || ctx.modal || !ctx.state) return;
    const t = this.findTarget();
    if (t) { this.player.path = []; interact(t); }
  }

  update(_time: number, deltaMs: number) {
    const s = ctx.state;
    if (!s || !this.map || s.mapId !== this.map.id) return;
    const dt = Math.min(deltaMs, 100) / 1000;

    // Player input
    const p = this.player;
    if (!ctx.modal && !typing() && !p.path.length) {
      const k = this.keys, c = this.cursors;
      let dx = 0, dy = 0;
      if (c.left.isDown || k.A.isDown) dx = -1; else if (c.right.isDown || k.D.isDown) dx = 1;
      else if (c.up.isDown || k.W.isDown) dy = -1; else if (c.down.isDown || k.S.isDown) dy = 1;
      if ((dx || dy) && !isSolid(this.map, p.x + dx, p.y + dy)) p.path = [{ x: p.x + dx, y: p.y + dy }];
    }
    if (ctx.modal) p.path = [];
    if (p.path.length) {
      handleEvents(walkTime(s, dt / this.map.secPerMinute));
      if (s.mapId !== this.map.id || ctx.state !== s) return; // a pass-out or bus may have moved us
      const arrived = this.step(p, dt, false);
      for (const tile of arrived) {
        s.x = tile.x; s.y = tile.y;
        const portal = this.map.portals.find((q) => q.x === tile.x && q.y === tile.y);
        if (portal) {
          s.mapId = portal.toMap; s.x = portal.tx; s.y = portal.ty;
          save();
          bus.emit('state');
          this.loadMap();
          return;
        }
      }
      if (arrived.length) bus.emit('state');
    } else {
      this.step(p, dt, false);
    }

    // Agents and crowd
    this.syncAgents();
    for (const a of this.agents.values()) if (a.visible) this.step(a, dt);
    for (const c of this.crowd) {
      if (c.w.path.length) { this.step(c.w, dt); continue; }
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

    this.updateChunks();

    // Night tint outdoors
    const hour = (s.minute / 60) % 24;
    const dark = hour >= 19 || hour < 6 ? Math.min(0.5, (hour >= 19 ? hour - 19 : 5) * 0.12) : 0;
    this.night.setFillStyle(0x0a1030, this.map.outdoor ? dark : 0);

    // Interaction prompt
    this.target = this.findTarget();
    const prompt = this.target ? describe(this.target) : '';
    if (prompt !== this.lastPrompt) { this.lastPrompt = prompt; bus.emit('prompt', prompt || null); }
  }
}

function describe(t: Target): string {
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
