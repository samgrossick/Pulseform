export const STEMS = ['vocals', 'drums', 'bass', 'other'] as const;
export type Stem = typeof STEMS[number];
export type Mix = Record<Stem, { volume: number; muted: boolean; solo: boolean }>;
export const defaultMix = (): Mix => Object.fromEntries(STEMS.map(s => [s, { volume: 1, muted: false, solo: false }])) as Mix;
export const EQ_BANDS = [60, 170, 350, 1000, 3000, 6000, 12000];
export function audibleGain(mix: Mix, stem: Stem) {
  const anySolo = STEMS.some(s => mix[s].solo);
  return mix[stem].muted || (anySolo && !mix[stem].solo) ? 0 : mix[stem].volume;
}
export function waveform(buffer: AudioBuffer, count = 160) {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / count));
  const peaks = Array.from({ length: count }, (_, i) => {
    let peak = 0;
    for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += Math.max(1, Math.floor(step / 80))) peak = Math.max(peak, Math.abs(data[j]));
    return peak;
  });
  const max = Math.max(0.01, ...peaks);
  return peaks.map(p => p / max);
}

export class AudioEngine {
  context = new AudioContext({ sampleRate: 44100 });
  analyser = this.context.createAnalyser();
  private input = this.context.createGain();
  private master = this.context.createGain();
  private filters = EQ_BANDS.map((frequency, i) => {
    const node = this.context.createBiquadFilter();
    node.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    node.frequency.value = frequency;
    node.Q.value = 0.85;
    return node;
  });
  private sources: AudioBufferSourceNode[] = [];
  private gains = new Map<string, GainNode>();
  private original: AudioBuffer | null = null;
  private stems: Partial<Record<Stem, AudioBuffer>> = {};
  private offset = 0;
  private startedAt = 0;
  private running = false;
  mix = defaultMix();
  loop = false;
  transportRevision = 0;
  transportReadyAt = Infinity;
  constructor() {
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    let previous: AudioNode = this.input;
    for (const filter of this.filters) { previous.connect(filter); previous = filter; }
    const limiter = this.context.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 3; limiter.ratio.value = 12;
    previous.connect(limiter); limiter.connect(this.master); this.master.connect(this.analyser); this.analyser.connect(this.context.destination);
    this.master.gain.value = 0.75;
  }
  get duration() { return this.original?.duration ?? 0; }
  get playing() { return this.running; }
  get position() {
    if (!this.running) return this.offset;
    const current = this.offset + Math.max(0, this.context.currentTime - this.startedAt);
    if (this.loop && this.duration) return current % this.duration;
    if (current >= this.duration) { this.pause(); return this.duration; }
    return current;
  }
  load(buffer: AudioBuffer, stems: Partial<Record<Stem, AudioBuffer>> = {}) {
    this.transportRevision++;
    this.transportReadyAt = Infinity;
    this.pause(); this.original = buffer; this.stems = stems; this.offset = 0;
    this.mix = defaultMix();
  }
  async play() {
    if (!this.original || this.running) return;
    await this.context.resume();
    if (this.running || !this.original) return;
    if (this.offset >= this.duration) this.offset = 0;
    this.startedAt = this.context.currentTime + 0.015;
    // Allow the fresh PCM/FFT windows and limiter startup to settle before
    // seeding onset history. Regular beat detection has no such waiting period.
    this.transportReadyAt = this.startedAt + 3 * this.analyser.fftSize / this.context.sampleRate;
    this.running = true;
    const entries = Object.entries(this.stems).length ? Object.entries(this.stems) : [['original', this.original]];
    for (const [name, buffer] of entries as [string, AudioBuffer][]) {
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer; source.loop = this.loop;
      gain.gain.value = name === 'original' ? 1 : audibleGain(this.mix, name as Stem);
      source.connect(gain); gain.connect(this.input);
      source.start(this.startedAt, Math.min(this.offset, buffer.duration));
      this.sources.push(source); this.gains.set(name, gain);
    }
  }
  pause() {
    if (this.running) {
      const current = this.offset + Math.max(0, this.context.currentTime - this.startedAt);
      this.offset = this.loop && this.duration ? current % this.duration : Math.min(current, this.duration);
    }
    this.running = false;
    for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    for (const gain of this.gains.values()) gain.disconnect();
    this.sources = []; this.gains.clear();
  }
  async seek(seconds: number) {
    this.transportRevision++;
    this.transportReadyAt = Infinity;
    const wasPlaying = this.running; this.pause();
    this.offset = Math.max(0, Math.min(seconds, this.duration));
    if (wasPlaying) await this.play();
  }
  async setLoop(loop: boolean) {
    this.transportRevision++;
    this.transportReadyAt = Infinity;
    const position = this.position; const wasPlaying = this.running;
    this.pause(); this.loop = loop; this.offset = position;
    if (wasPlaying) await this.play();
  }
  async setStems(stems: Record<Stem, AudioBuffer>) {
    this.transportRevision++;
    this.transportReadyAt = Infinity;
    const position = this.position; const wasPlaying = this.running;
    this.pause(); this.stems = stems; this.offset = position;
    if (wasPlaying) await this.play();
  }
  setMix(mix: Mix) {
    this.mix = mix;
    for (const stem of STEMS) this.gains.get(stem)?.gain.setTargetAtTime(audibleGain(mix, stem), this.context.currentTime, 0.015);
  }
  setVolume(volume: number) { this.master.gain.setTargetAtTime(volume, this.context.currentTime, 0.02); }
  setEQ(values: number[]) { this.filters.forEach((filter, i) => filter.gain.setTargetAtTime(values[i] ?? 0, this.context.currentTime, 0.02)); }
  async destroy() { this.pause(); await this.context.close(); }
}
