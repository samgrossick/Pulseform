import { describe, expect, it } from 'vitest';
import { audibleGain, defaultMix, waveform } from './audio';

describe('stem mixer', () => {
  it('isolates all soloed stems and respects mute even during solo', () => {
    const mix = defaultMix(); mix.vocals.solo = true; mix.bass.solo = true; mix.bass.volume = 0.4;
    expect(audibleGain(mix, 'vocals')).toBe(1);
    expect(audibleGain(mix, 'drums')).toBe(0);
    expect(audibleGain(mix, 'bass')).toBe(0.4);
    mix.bass.muted = true;
    expect(audibleGain(mix, 'bass')).toBe(0);
  });
  it('restores regular mixing when all solos are removed', () => {
    const mix = defaultMix(); mix.drums.volume = 0.6; mix.vocals.muted = true;
    expect(audibleGain(mix, 'drums')).toBe(0.6);
    expect(audibleGain(mix, 'vocals')).toBe(0);
    expect(audibleGain(mix, 'other')).toBe(1);
  });
});
describe('waveform extraction', () => {
  it('keeps silence finite and extracts relative real peaks', () => {
    const silent = { getChannelData: () => new Float32Array(400) } as unknown as AudioBuffer;
    expect(waveform(silent, 4)).toEqual([0, 0, 0, 0]);
    const data = new Float32Array(400); data[20] = 0.5; data[120] = -1; data[320] = 0.25;
    const audio = { getChannelData: () => data } as unknown as AudioBuffer;
    expect(waveform(audio, 4)).toEqual([0.5, 1, 0, 0.25]);
  });
});
