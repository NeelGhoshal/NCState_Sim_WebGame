// The scene's side of map drawing. Uses the map worker when the browser has OffscreenCanvas,
// and otherwise draws on the main thread. Either way the result is an ImageBitmap, which
// uploads to WebGL much faster than a canvas.
import { MAPS } from '../maps/index';
import { renderRegion, roofCover } from './render';
import type { MapJob, MapReply } from './mapWorker';

type Pending = { resolve: (v: ImageBitmap | Uint8Array) => void; reject: (e: Error) => void; job: MapJob };

export class MapRenderer {
  private worker: Worker | null = null;
  private next = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./mapWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<MapReply>) => this.reply(e.data);
      this.worker.onerror = (e) => { console.warn('[map] worker failed, drawing on the main thread', e.message); this.fallBack(); };
    } catch {
      this.worker = null;
    }
  }

  /** Jobs still waiting; the scene uses this to avoid queueing more than it needs. */
  get inFlight() { return this.pending.size; }

  region(mapId: string, x: number, y: number, w: number, h: number, scale = 1): Promise<ImageBitmap> {
    return this.send({ type: 'region', id: this.next++, mapId, x, y, w, h, scale }) as Promise<ImageBitmap>;
  }

  cover(mapId: string): Promise<Uint8Array> {
    return this.send({ type: 'cover', id: this.next++, mapId }) as Promise<Uint8Array>;
  }

  private send(job: MapJob): Promise<ImageBitmap | Uint8Array> {
    return new Promise((resolve, reject) => {
      if (!this.worker) { this.local(job).then(resolve, reject); return; }
      this.pending.set(job.id, { resolve, reject, job });
      this.worker.postMessage(job);
    });
  }

  private reply(r: MapReply) {
    const p = this.pending.get(r.id);
    if (!p) { if (r.type === 'region') r.bitmap.close(); return; }
    this.pending.delete(r.id);
    if (r.type === 'region') p.resolve(r.bitmap);
    else if (r.type === 'cover') p.resolve(r.mask);
    else this.local(p.job).then(p.resolve, p.reject); // one bad job: draw it here instead
  }

  /** The worker died: finish its queue on the main thread and stop using it. */
  private fallBack() {
    this.worker?.terminate();
    this.worker = null;
    const queued = [...this.pending.values()];
    this.pending.clear();
    for (const p of queued) this.local(p.job).then(p.resolve, p.reject);
  }

  private async local(job: MapJob): Promise<ImageBitmap | Uint8Array> {
    const map = MAPS[job.mapId];
    if (job.type === 'cover') return roofCover(map);
    return createImageBitmap(renderRegion(map, job.x, job.y, job.w, job.h, job.scale) as HTMLCanvasElement);
  }
}
