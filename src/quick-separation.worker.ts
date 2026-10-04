/// <reference lib="webworker" />
import { quickSeparate } from './quick-separation';

self.onmessage = ({ data }: MessageEvent<{ left: Float32Array; right: Float32Array; sampleRate: number }>) => {
  try {
    const result = quickSeparate(data.left, data.right, data.sampleRate, progress => self.postMessage({ type: 'progress', stage: 'Quick split · shaping your layers', progress }));
    self.postMessage({ type: 'complete', result }, { transfer: Object.values(result).flatMap(stem => [stem.left.buffer, stem.right.buffer]) as ArrayBuffer[] });
  } catch (error) {
    self.postMessage({ type: 'error', message: `Quick split could not finish. ${error instanceof Error ? error.message : String(error)}` });
  }
};
