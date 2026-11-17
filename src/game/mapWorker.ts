// Draws map regions off the main thread. The scene asks for a region; this worker draws it on
// an OffscreenCanvas and sends back an ImageBitmap, which uploads to the GPU in a few
// milliseconds. Maps are rebuilt here from the same code, so only small messages cross over.
import { MAPS } from '../maps/index';
import { renderRegion, roofCover } from './render';

export type MapJob =
  | { type: 'region'; id: number; mapId: string; x: number; y: number; w: number; h: number; scale: number }
  | { type: 'cover'; id: number; mapId: string };

export type MapReply =
  | { type: 'region'; id: number; bitmap: ImageBitmap }
  | { type: 'cover'; id: number; mask: Uint8Array }
  | { type: 'error'; id: number; message: string };

const post = (msg: MapReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<MapJob>) => {
  const job = e.data;
  try {
    const map = MAPS[job.mapId];
    if (!map) throw new Error(`no map ${job.mapId}`);
    if (job.type === 'region') {
      const canvas = renderRegion(map, job.x, job.y, job.w, job.h, job.scale) as OffscreenCanvas;
      const bitmap = canvas.transferToImageBitmap();
      post({ type: 'region', id: job.id, bitmap }, [bitmap]);
    } else {
      const mask = roofCover(map);
      post({ type: 'cover', id: job.id, mask }, [mask.buffer]);
    }
  } catch (err) {
    post({ type: 'error', id: job.id, message: String(err) });
  }
};
