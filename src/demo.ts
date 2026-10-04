import type { Stem } from './audio';

// An original synthesised loop, with its real source tracks supplied separately.
// No copyrighted recording is bundled and no separation is simulated.
export function createDemo(context: AudioContext) {
  const duration = 32; const rate = context.sampleRate; const length = duration * rate;
  const names: Stem[] = ['vocals', 'drums', 'bass', 'other'];
  const stems = Object.fromEntries(names.map(name => [name, context.createBuffer(2, length, rate)])) as Record<Stem, AudioBuffer>;
  const buffer = context.createBuffer(2, length, rate);
  const roots = [55, 65.406, 49, 73.416];
  let seed = 1729;
  for (let i = 0; i < length; i++) {
    const t = i / rate; const beat = t % 0.5; const eighth = t % 0.25; const bar = Math.floor(t / 4) % 4;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = (seed >>> 0) / 2147483648 - 1;
    const fade = Math.min(1, t * 3, (duration - t) * 3);
    const kick = Math.sin(2 * Math.PI * (45 * beat + 10 * (1 - Math.exp(-beat * 32)))) * Math.exp(-beat * 19) * 0.34;
    const snareAge = (t + 0.5) % 1;
    const drums = kick + noise * Math.exp(-snareAge * 27) * 0.12 + noise * Math.exp(-eighth * 95) * 0.045;
    const bassFrequency = roots[bar];
    const bass = (Math.sin(2 * Math.PI * bassFrequency * t) + 0.17 * Math.sin(4 * Math.PI * bassFrequency * t)) * (0.11 + 0.045 * Math.exp(-beat * 10));
    const chord = [1, 1.1892, 1.4983, 1.7818];
    for (let channel = 0; channel < 2; channel++) {
      const drift = channel === 0 ? 0.998 : 1.002;
      const pad = chord.reduce((v, ratio) => v + Math.sin(2 * Math.PI * bassFrequency * ratio * 4 * drift * t), 0) * 0.023 * (0.7 + 0.3 * Math.sin(t * 0.7));
      const note = [1, 1.4983, 1.1892, 1.7818, 2, 1.7818, 1.4983, 1.1892][Math.floor(t * 2) % 8];
      const lead = Math.sin(2 * Math.PI * bassFrequency * note * 8 * t + 0.18 * Math.sin(t * 12)) * Math.exp(-beat * 4) * 0.045;
      const values = { vocals: lead, drums, bass, other: pad };
      let total = 0;
      for (const name of names) { const value = values[name] * fade; stems[name].getChannelData(channel)[i] = value; total += value; }
      buffer.getChannelData(channel)[i] = total;
    }
  }
  return { buffer, stems };
}
