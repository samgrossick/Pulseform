import { expect, it } from 'vitest';
import { quickSeparate } from './quick-separation';

const rate = 44100;
const energy = (data: Float32Array) => data.reduce((sum, value) => sum + value * value, 0);
it('reconstructs stereo audio at unity with finite aligned layers, including edges', () => {
  const left = Float32Array.from({ length: 12345 }, (_, i) => .3 * Math.sin(i * .17) + .1 * Math.cos(i * .039));
  const right = Float32Array.from(left, (value, i) => value * Math.cos(i * .01));
  const layers = Object.values(quickSeparate(left, right, rate));
  for (let i = 0; i < left.length; i++) {
    expect(layers.reduce((sum, stem) => sum + stem.left[i], 0)).toBeCloseTo(left[i], 5);
    expect(layers.reduce((sum, stem) => sum + stem.right[i], 0)).toBeCloseTo(right[i], 5);
  }
});
it('routes a sustained low tone predominantly to bass', () => {
  const input = Float32Array.from({ length: rate }, (_, i) => .4 * Math.sin(2 * Math.PI * 80 * i / rate));
  const result = quickSeparate(input, input, rate);
  expect(energy(result.bass.left)).toBeGreaterThan(energy(result.drums.left) * 3);
  expect(energy(result.bass.left)).toBeGreaterThan(energy(result.vocals.left) * 10);
});
it('favours centred lead over stereo side content and preserves silence', () => {
  const input = Float32Array.from({ length: rate / 4 }, (_, i) => .3 * Math.sin(2 * Math.PI * 900 * i / rate));
  const centred = quickSeparate(input, input, rate);
  const side = quickSeparate(input, Float32Array.from(input, value => -value), rate);
  expect(energy(centred.vocals.left)).toBeGreaterThan(energy(side.vocals.left) * 10 + 1);
  const silent = quickSeparate(new Float32Array(20), new Float32Array(20), rate);
  for (const stem of Object.values(silent)) expect(energy(stem.left) + energy(stem.right)).toBe(0);
});
