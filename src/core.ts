// Shared runtime context: the current game state and a tiny event bus.
import type { GameState } from './engine/state';
import { MAPS, START } from './maps/index';
import { isSolid } from './engine/types';

type Fn = (...args: any[]) => void;

class Bus {
  private handlers = new Map<string, Set<Fn>>();
  on(event: string, fn: Fn): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return () => this.handlers.get(event)?.delete(fn);
  }
  emit(event: string, ...args: any[]) {
    this.handlers.get(event)?.forEach((fn) => fn(...args));
  }
}

/**
 * Events:
 *  'state'    meters, clock or text changed; re-render the HUD
 *  'map'      the player moved to another map or was teleported; rebuild the scene
 *  'prompt'   (text | null) what pressing E would do
 */
export const bus = new Bus();

export const ctx: { state: GameState | null; modal: number } = { state: null, modal: 0 };

const SAVE_KEY = 'campus-life-sim.save.v1';

export function save() {
  if (!ctx.state) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(ctx.state)); } catch { /* storage unavailable */ }
}

export function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    if (s.version !== 1) return null;
    // Saves from before the OpenStreetMap campus hold positions on the old, smaller map.
    const m = MAPS[s.mapId];
    if (!m || isSolid(m, s.x, s.y)) { s.mapId = START.mapId; s.x = START.x; s.y = START.y; }
    return s;
  } catch {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
