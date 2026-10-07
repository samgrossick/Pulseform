/** Music features in [0, 1], derived only from the supplied audio samples. */
export type AudioFeatures = {
  bass: number;
  mid: number;
  treble: number;
  energy: number;
  pulse: number;
  flux: number;
  crest: number;
  rms: number;
};

export const silentAudioFeatures = (): AudioFeatures => ({ bass: 0, mid: 0, treble: 0, energy: 0, pulse: 0, flux: 0, crest: 0, rms: 0 });
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const follow = (value: number, target: number, dt: number, attack: number, release: number) =>
  value + (target - value) * (1 - Math.exp(-dt / (target > value ? attack : release)));

/** Quick musical attacks with smooth decay, rather than averaging away beats. */
export class LiquidMotion {
  private state = silentAudioFeatures();

  reset() { this.state = silentAudioFeatures(); }

  update(target: AudioFeatures, deltaSeconds: number): AudioFeatures {
    const dt = Math.max(0, Math.min(.1, deltaSeconds));
    for (const key of Object.keys(this.state) as (keyof AudioFeatures)[]) {
      this.state[key] = follow(this.state[key], target[key], dt, key === 'pulse' ? .025 : .035, key === 'treble' ? .16 : .24);
    }
    return { ...this.state };
  }
}

/**
 * Stateful, frame-rate-independent audio analysis. Frequency samples are FFT dB
 * magnitudes; waveform samples are linear [-1, 1]. An RMS gate prevents adaptive
 * gain from magnifying silence. Onsets require an actual positive low-band change,
 * so a sustained tone cannot generate a repeating beat.
 */
export class AudioResponse {
  private peaks = [.055, .035, .018];
  private levels = [0, 0, 0];
  private previousBands = [0, 0, 0];
  private lowBaseline = 0;
  private rmsPeak = .12;
  private previousRms = 0;
  private energy = 0;
  private pulse = 0;
  private flux = 0;
  private crest = 0;
  private cooldown = 0;
  private previousSpectrum = new Float32Array(0);
  private priming = false;

  reset() {
    this.peaks = [.055, .035, .018];
    this.levels.fill(0);
    this.previousBands.fill(0);
    this.previousSpectrum.fill(0);
    this.lowBaseline = 0;
    this.rmsPeak = .12;
    this.previousRms = 0;
    this.energy = this.pulse = this.flux = this.crest = this.cooldown = 0;
    this.priming = false;
  }

  /** Seed a new passage without mistaking the seek itself for a drum hit. */
  prime(frequencies: Float32Array, waveform: Float32Array, sampleRate: number, fftSize: number) {
    this.reset();
    this.priming = true;
    this.update(frequencies, waveform, sampleRate, fftSize, .001);
  }

  update(frequencies: Float32Array, waveform: Float32Array, sampleRate: number, fftSize: number, deltaSeconds: number): AudioFeatures {
    const dt = Math.max(.001, Math.min(.1, deltaSeconds));
    let sum = 0;
    let peak = 0;
    for (const sample of waveform) {
      const finite = Number.isFinite(sample) ? sample : 0;
      sum += finite * finite;
      peak = Math.max(peak, Math.abs(finite));
    }
    const rms = Math.sqrt(sum / Math.max(1, waveform.length));
    // Below -64 dBFS remains completely quiet; quiet music opens the gate gradually.
    const gate = clamp((rms - .0006) / .0074);
    const bandPower = [0, 0, 0];
    const hzPerBin = sampleRate / Math.max(1, fftSize);
    let positiveFlux = 0;
    let totalAmplitude = 0;
    if (this.previousSpectrum.length !== frequencies.length) this.previousSpectrum = new Float32Array(frequencies.length);
    for (let i = 1; i < frequencies.length; i++) {
      const hz = i * hzPerBin;
      const amplitude = Number.isFinite(frequencies[i]) ? Math.pow(10, frequencies[i] / 20) : 0;
      if (hz >= 30 && hz < 16000) {
        const band = hz < 220 ? 0 : hz < 2500 ? 1 : 2;
        bandPower[band] += amplitude * amplitude;
        if (!this.priming) positiveFlux += Math.max(0, amplitude - this.previousSpectrum[i]);
        totalAmplitude += amplitude;
      }
      this.previousSpectrum[i] = amplitude;
    }
    const raw = bandPower.map(value => Math.sqrt(value));
    if (this.priming) {
      this.previousBands = raw;
      this.previousRms = rms;
      this.lowBaseline = raw[0];
      this.priming = false;
    }
    const floors = [.035, .025, .012];
    const normalized = raw.map((value, i) => {
      this.peaks[i] = Math.max(floors[i], follow(this.peaks[i], value, dt, .035, 3.5));
      // Fixed references preserve quiet/loud contrast. Peaks serve onset detection.
      return Math.sqrt(clamp(value / [.32, .24, .16][i])) * gate;
    });
    const lowRise = Math.max(0, raw[0] - this.previousBands[0]) / Math.max(.025, this.peaks[0]);
    const rmsRise = Math.max(0, rms - this.previousRms) / Math.max(.04, this.rmsPeak);
    const onset = clamp(lowRise * 2.8 + rmsRise * .85);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.pulse *= Math.exp(-dt / .20);
    if (gate > .25 && raw[0] > .009 && raw[0] > this.lowBaseline * 1.15 && onset > .14 && this.cooldown === 0) {
      this.pulse = Math.max(this.pulse, clamp(.30 + onset * .9));
      this.cooldown = .095;
    }
    this.lowBaseline = follow(this.lowBaseline, raw[0], dt, .22, .28);
    this.rmsPeak = Math.max(.07, follow(this.rmsPeak, rms, dt, .045, 4));
    this.energy = follow(this.energy, Math.sqrt(clamp(rms / .45)) * gate, dt, .018, .22);
    this.flux = follow(this.flux, clamp(positiveFlux / Math.max(.08, totalAmplitude) * 3.0) * gate, dt, .012, .13);
    this.crest = follow(this.crest, clamp((peak / Math.max(.001, rms) - 1.15) / 3.5) * gate, dt, .018, .16);
    normalized.forEach((value, i) => { this.levels[i] = follow(this.levels[i], value, dt, .014, i === 0 ? .19 : .13); });
    this.previousBands = raw;
    this.previousRms = rms;
    return {
      bass: this.levels[0], mid: this.levels[1], treble: this.levels[2],
      energy: this.energy, pulse: this.pulse, flux: this.flux, crest: this.crest, rms,
    };
  }
}
