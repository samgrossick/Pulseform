import { STEMS, type Stem } from './audio';

export type QuickResult = Record<Stem, { left: Float32Array; right: Float32Array }>;
const SIZE = 2048;
const HOP = SIZE / 2;

// In-place radix-2 transform; shared buffers keep per-frame allocations small.
function fft(real: Float64Array, imaginary: Float64Array, inverse = false) {
  for (let i = 1, j = 0; i < SIZE; i++) {
    let bit = SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= SIZE; length *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    const stepR = Math.cos(angle), stepI = Math.sin(angle);
    for (let start = 0; start < SIZE; start += length) {
      let wr = 1, wi = 0;
      for (let j = 0; j < length / 2; j++) {
        const a = start + j, b = a + length / 2;
        const br = real[b] * wr - imaginary[b] * wi;
        const bi = real[b] * wi + imaginary[b] * wr;
        real[b] = real[a] - br; imaginary[b] = imaginary[a] - bi;
        real[a] += br; imaginary[a] += bi;
        const next = wr * stepR - wi * stepI;
        wi = wr * stepI + wi * stepR; wr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < SIZE; i++) { real[i] /= SIZE; imaginary[i] /= SIZE; }
}

// Complementary spectral masks reconstruct the original when all faders are at
// unity. These are approximate remix layers, not semantic AI instrument stems.
export function quickSeparate(left: Float32Array, right: Float32Array, sampleRate: number, progress?: (value: number) => void): QuickResult {
  if (left.length !== right.length || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid audio input.');
  const result = Object.fromEntries(STEMS.map(stem => [stem, { left: new Float32Array(left.length), right: new Float32Array(left.length) }])) as QuickResult;
  const window = Float64Array.from({ length: SIZE }, (_, i) => Math.sin(Math.PI * i / SIZE));
  const re = [new Float64Array(SIZE), new Float64Array(SIZE)];
  const im = [new Float64Array(SIZE), new Float64Array(SIZE)];
  const outR = new Float64Array(SIZE), outI = new Float64Array(SIZE);
  const magnitude = new Float64Array(HOP + 1), history = new Float64Array(HOP + 1);
  const masks = STEMS.map(() => new Float64Array(SIZE));
  const normalization = new Float32Array(left.length);
  const inputs = [left, right];
  let frame = 0;
  for (let start = -HOP; start < left.length; start += HOP, frame++) {
    for (let ch = 0; ch < 2; ch++) {
      for (let i = 0; i < SIZE; i++) { re[ch][i] = (inputs[ch][start + i] ?? 0) * window[i]; im[ch][i] = 0; }
      fft(re[ch], im[ch]);
    }
    for (let k = 0; k <= HOP; k++) magnitude[k] = Math.hypot(re[0][k], im[0][k]) + Math.hypot(re[1][k], im[1][k]);
    for (let k = 0; k <= HOP; k++) {
      const hz = k * sampleRate / SIZE;
      // Narrow sustained peaks favour harmony; broad spectral energy and
      // sudden rises favour percussion. A short history follows tempo changes.
      let broad = 0;
      const lo = Math.max(0, k - 6), hi = Math.min(HOP, k + 6);
      for (let j = lo; j <= hi; j++) broad += magnitude[j];
      broad /= hi - lo + 1;
      const tonal = Math.max(history[k], magnitude[k] * .45);
      const transient = Math.max(0, magnitude[k] - history[k] * 1.4);
      const percussion = broad * .8 + transient * .55;
      const drums = Math.min(.92, percussion ** 2 / (percussion ** 2 + tonal ** 2 + 1e-16));
      history[k] = history[k] * .8 + magnitude[k] * .2;
      const bass = (1 - drums) / (1 + (hz / 230) ** 6);
      const side = Math.hypot(re[0][k] - re[1][k], im[0][k] - im[1][k]);
      const center = Math.max(0, 1 - side / (magnitude[k] + 1e-10));
      const voiceBand = (1 / (1 + (220 / Math.max(1, hz)) ** 6)) / (1 + (hz / 5200) ** 6);
      const vocals = (1 - drums - bass) * center ** 2 * voiceBand * .9;
      const weights = [vocals, drums, bass, 1 - vocals - drums - bass];
      for (let stem = 0; stem < 4; stem++) {
        masks[stem][k] = weights[stem];
        if (k > 0 && k < HOP) masks[stem][SIZE - k] = weights[stem];
      }
    }
    for (let stem = 0; stem < 4; stem++) for (let ch = 0; ch < 2; ch++) {
      for (let i = 0; i < SIZE; i++) { outR[i] = re[ch][i] * masks[stem][i]; outI[i] = im[ch][i] * masks[stem][i]; }
      fft(outR, outI, true);
      const output = ch === 0 ? result[STEMS[stem]].left : result[STEMS[stem]].right;
      for (let i = Math.max(0, -start); i < Math.min(SIZE, left.length - start); i++) output[start + i] += outR[i] * window[i];
    }
    for (let i = Math.max(0, -start); i < Math.min(SIZE, left.length - start); i++) normalization[start + i] += window[i] ** 2;
    if (frame % 32 === 0) progress?.(Math.min(1, (start + HOP) / Math.max(1, left.length)));
  }
  for (const stem of STEMS) for (let i = 0; i < left.length; i++) {
    result[stem].left[i] /= Math.max(1e-8, normalization[i]);
    result[stem].right[i] /= Math.max(1e-8, normalization[i]);
  }
  progress?.(1);
  return result;
}
