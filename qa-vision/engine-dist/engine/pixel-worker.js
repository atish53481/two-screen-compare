"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Worker thread for screenshot pixel diffs (compiled to engine-dist/engine/pixel-worker.js). Keeps PNG decode,
 * pixelmatch and PNG encode off the server's main thread, where they would freeze the Live view and the socket.
 * Message in: {id, a, b, threshold} (a/b PNG bytes). Message out: {id, result} or {id, error}.
 */
const worker_threads_1 = require("worker_threads");
const pixel_diff_1 = require("./pixel-diff");
const toBuffer = (u) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);
worker_threads_1.parentPort?.on('message', (msg) => {
    try {
        const result = (0, pixel_diff_1.diffPixels)(toBuffer(msg.a), toBuffer(msg.b), msg.threshold);
        const transfer = result.overlayPng ? [result.overlayPng.buffer] : [];
        // A pooled small Buffer shares its ArrayBuffer: only transfer one the overlay owns outright
        const owned = result.overlayPng && result.overlayPng.byteOffset === 0 && result.overlayPng.byteLength === result.overlayPng.buffer.byteLength;
        worker_threads_1.parentPort.postMessage({ id: msg.id, result }, owned ? transfer : []);
    }
    catch (e) {
        worker_threads_1.parentPort.postMessage({ id: msg.id, error: String(e?.message || e) });
    }
});
