/**
 * Worker thread for screenshot pixel diffs (compiled to engine-dist/engine/pixel-worker.js). Keeps PNG decode,
 * pixelmatch and PNG encode off the server's main thread, where they would freeze the Live view and the socket.
 * Message in: {id, a, b, threshold} (a/b PNG bytes). Message out: {id, result} or {id, error}.
 */
import { parentPort } from 'worker_threads';
import { diffPixels } from './pixel-diff';

const toBuffer = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);

parentPort?.on('message', (msg: { id: number; a: Uint8Array; b: Uint8Array; threshold: number }) => {
  try {
    const result = diffPixels(toBuffer(msg.a), toBuffer(msg.b), msg.threshold);
    const transfer = result.overlayPng ? [result.overlayPng.buffer as ArrayBuffer] : [];
    // A pooled small Buffer shares its ArrayBuffer: only transfer one the overlay owns outright
    const owned = result.overlayPng && result.overlayPng.byteOffset === 0 && result.overlayPng.byteLength === result.overlayPng.buffer.byteLength;
    parentPort!.postMessage({ id: msg.id, result }, owned ? transfer : []);
  } catch (e) {
    parentPort!.postMessage({ id: msg.id, error: String((e as Error)?.message || e) });
  }
});
