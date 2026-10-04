/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import moduleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { DemucsProcessor, CONSTANTS, type SeparationResult } from 'demucs-web';

const send = (stage: string, progress: number | null = null) => self.postMessage({ type: 'progress', stage, progress });
type ModelManifest = { bytes: number; sha256: string; chunks: { file: string; bytes: number; sha256: string }[] };
const MODEL_ROOT = `${import.meta.env.BASE_URL}models/demucs/`;
const sha256 = async (data: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), byte => byte.toString(16).padStart(2, '0')).join('');

async function downloadModel() {
  const response = await fetch(`${MODEL_ROOT}manifest.json`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Model assets are missing. Build the app with npm run build first.');
  const manifest: ModelManifest = await response.json();
  if (!manifest.bytes || !Array.isArray(manifest.chunks) || !manifest.chunks.length) throw new Error('Invalid model manifest.');
  const data = new Uint8Array(manifest.bytes); let offset = 0;
  let cache: Cache | null = null;
  try { cache = await caches.open('pulseform-demucs-v1'); } catch { /* Storage is optional. */ }
  for (const chunk of manifest.chunks) {
    if (!/^[a-zA-Z0-9._-]+\.bin$/.test(chunk.file)) throw new Error('Invalid model chunk name.');
    const url = new URL(`${MODEL_ROOT}${chunk.file}`, self.location.origin).href;
    let cached = false;
    let part: ArrayBuffer | undefined;
    try { const hit = await cache?.match(url); if (hit) { part = await hit.arrayBuffer(); cached = true; } } catch { /* Continue with a normal request. */ }
    if (part && (part.byteLength !== chunk.bytes || await sha256(part) !== chunk.sha256)) { part = undefined; cached = false; await cache?.delete(url); }
    if (!part) {
      send(`Downloading separation model · ${Math.round(offset / 1048576)} / ${Math.round(manifest.bytes / 1048576)} MB`, offset / manifest.bytes);
      const fetched = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!fetched.ok) throw new Error(`Model chunk download failed (${fetched.status}). Please retry.`);
      part = await fetched.arrayBuffer();
      if (part.byteLength !== chunk.bytes || await sha256(part) !== chunk.sha256) throw new Error('Model integrity check failed. Please retry.');
      try { await cache?.put(url, new Response(part)); } catch { /* Cache quota is optional. */ }
    }
    data.set(new Uint8Array(part), offset); offset += part.byteLength;
    send(cached ? 'Loading cached separation model' : 'Downloading separation model', offset / manifest.bytes);
  }
  if (offset !== manifest.bytes || await sha256(data.buffer) !== manifest.sha256) throw new Error('Model integrity check failed.');
  return data.buffer;
}

self.onmessage = async (event: MessageEvent<{ left: Float32Array; right: Float32Array }>) => {
  let processor: DemucsProcessor | null = null;
  try {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: moduleUrl };
    // A dedicated single-thread WASM worker works on static hosts as well as
    // isolated ones, without nested worker or cross-origin resource problems.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const stride = Math.floor(CONSTANTS.TRAINING_SAMPLES * (1 - CONSTANTS.SEGMENT_OVERLAP));
    const segments = Math.ceil(event.data.left.length / stride);
    processor = new DemucsProcessor({
      ort,
      sessionOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
      onProgress: ({ currentSegment }) => send(`Separating audio · segment ${currentSegment} of ${segments}`, Math.min(1, currentSegment / segments)),
    });
    const model = await downloadModel();
    send('Preparing the AI model. This can take a minute.');
    await processor.loadModel(model);
    send('Separating audio on your device', 0);
    const result: SeparationResult = await processor.separate(event.data.left, event.data.right);
    const transfers = Object.values(result).flatMap(stem => [stem.left.buffer, stem.right.buffer]) as ArrayBuffer[];
    self.postMessage({ type: 'complete', result }, { transfer: transfers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'error', message: `Stem separation could not finish. ${detail}` });
  } finally {
    try { await processor?.session?.release(); } catch { /* Worker disposal also releases resources. */ }
  }
};
