import { describe, expect, it } from 'vitest';
import { AudioResponse, LiquidMotion, silentAudioFeatures } from './audio-response';

const sampleRate = 48000;
const fftSize = 2048;
const dt = 1 / 60;
const frame = (amplitude = 0, hz = 70) => {
  const frequency = new Float32Array(fftSize / 2).fill(-Infinity);
  const waveform = new Float32Array(fftSize);
  if (amplitude) {
    frequency[Math.round(hz / (sampleRate / fftSize))] = 20 * Math.log10(amplitude * .5);
    for (let i = 0; i < waveform.length; i++) waveform[i] = Math.sin(i / sampleRate * hz * Math.PI * 2) * amplitude;
  }
  return { frequency, waveform };
};
const update = (response: AudioResponse, input: ReturnType<typeof frame>, elapsed = dt) =>
  response.update(input.frequency, input.waveform, sampleRate, fftSize, elapsed);

describe('AudioResponse', () => {
  it('keeps digital silence at zero even after adaptive normalization', () => {
    const response = new AudioResponse();
    let features = update(response, frame());
    for (let i = 0; i < 600; i++) features = update(response, frame());
    expect(features).toEqual({ bass: 0, mid: 0, treble: 0, energy: 0, pulse: 0, flux: 0, crest: 0, rms: 0 });
  });

  it('reacts within a frame to a real bass onset, then releases into silence', () => {
    const response = new AudioResponse();
    update(response, frame());
    const kick = update(response, frame(.55));
    expect(kick.bass).toBeGreaterThan(.6);
    expect(kick.pulse).toBeGreaterThan(.8);
    expect(kick.energy).toBeGreaterThan(.55);
    expect(kick.flux).toBeGreaterThan(.6);
    let quiet = kick;
    for (let i = 0; i < 120; i++) quiet = update(response, frame());
    expect(quiet.bass).toBeLessThan(.001);
    expect(quiet.pulse).toBeLessThan(.001);
    expect(quiet.energy).toBeLessThan(.001);
    expect(quiet.flux).toBeLessThan(.001);
  });

  it('does not invent periodic beats during a sustained tone', () => {
    const response = new AudioResponse();
    const tone = frame(.3);
    expect(update(response, tone).pulse).toBeGreaterThan(.5);
    let held = update(response, tone);
    for (let i = 0; i < 180; i++) held = update(response, tone);
    expect(held.bass).toBeGreaterThan(.75);
    expect(held.energy).toBeGreaterThan(.75);
    expect(held.pulse).toBeLessThan(.001);
    expect(held.flux).toBeLessThan(.001);
  });

  it('detects a second kick after release and keeps mid/high activity independent', () => {
    const response = new AudioResponse();
    update(response, frame(.4));
    for (let i = 0; i < 25; i++) update(response, frame());
    expect(update(response, frame(.4)).pulse).toBeGreaterThan(.8);
    response.reset();
    const middle = update(response, frame(.35, 1000));
    expect(middle.mid).toBeGreaterThan(.6);
    expect(middle.bass).toBe(0);
    expect(middle.pulse).toBe(0);
    response.reset();
    const high = update(response, frame(.2, 7000));
    expect(high.treble).toBeGreaterThan(.6);
    expect(high.bass).toBe(0);
    expect(high.mid).toBe(0);
  });

  it('does not turn subaudible noise into full-strength geometry', () => {
    const response = new AudioResponse();
    let features = update(response, frame(.0001));
    for (let i = 0; i < 360; i++) features = update(response, frame(.0001));
    expect(features.bass).toBe(0);
    expect(features.energy).toBe(0);
    expect(features.pulse).toBe(0);
  });

  it('has similar attack and decay envelopes at different render frame rates', () => {
    const at = (fps: number) => {
      const response = new AudioResponse();
      for (let i = 0; i < fps / 2; i++) update(response, frame(.3), 1 / fps);
      let features = update(response, frame(), 1 / fps);
      for (let i = 1; i < fps / 2; i++) features = update(response, frame(), 1 / fps);
      return features;
    };
    const slow = at(30);
    const fast = at(120);
    expect(slow.bass).toBeCloseTo(fast.bass, 2);
    expect(slow.energy).toBeCloseTo(fast.energy, 2);
  });
});

describe('LiquidMotion', () => {
  it('spreads a sudden onset into gradual motion and a long, smooth release', () => {
    const motion = new LiquidMotion();
    const loud = { ...silentAudioFeatures(), bass: 1, pulse: 1, energy: 1 };
    const first = motion.update(loud, dt);
    expect(first.bass).toBeLessThan(.10);
    expect(first.pulse).toBeLessThan(.09);
    let rising = first;
    for (let i = 0; i < 11; i++) rising = motion.update(loud, dt);
    expect(rising.bass).toBeGreaterThan(.60);
    expect(rising.bass).toBeLessThan(.75);
    const release = motion.update(silentAudioFeatures(), dt);
    expect(release.bass).toBeGreaterThan(rising.bass * .97);
    let quiet = release;
    for (let i = 0; i < 360; i++) quiet = motion.update(silentAudioFeatures(), dt);
    expect(quiet.bass).toBeLessThan(.001);
    motion.reset();
    expect(motion.update(silentAudioFeatures(), dt)).toEqual(silentAudioFeatures());
  });
});
