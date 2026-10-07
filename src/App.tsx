import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowCounterClockwiseIcon, ArrowsOutIcon, AsteriskIcon, CheckIcon, CircleNotchIcon, DownloadSimpleIcon, EqualizerIcon, FolderOpenIcon, HeadphonesIcon, InfoIcon, MagicWandIcon, MusicNotesIcon, PauseIcon, PlayIcon, RepeatIcon, SkipBackIcon, SlidersHorizontalIcon, SnowflakeIcon, SpeakerHighIcon, SpeakerSlashIcon, WaveformIcon, XIcon } from '@phosphor-icons/react';
import Visualizer, { type VisualizerSettings } from './Visualizer';
import { AudioEngine, defaultMix, EQ_BANDS, STEMS, waveform, type Mix, type Stem } from './audio';
import { createDemo } from './demo';
import type { SeparationResult } from 'demucs-web';

const DEFAULT_SETTINGS: VisualizerSettings = { scene: 'currents', palette: 'solar', customColors: ['#e84221', '#ffad5c', '#ad3dbd', '#36296e'], intensity: 0.8, speed: 0.8, detail: 0.55, grain: 0.1, reactive: true, frozen: false };
const SCENES = [
  { id: 'currents', name: 'Currents', subtitle: 'Liquid interference' },
  { id: 'bloom', name: 'Bloom', subtitle: 'Petals in motion' },
  { id: 'tunnel', name: 'Afterhours', subtitle: 'Into the infinite' },
  { id: 'scope', name: 'Oscilloscope', subtitle: 'Sound, traced' },
] as const;
const PALETTES = [{ id: 'solar', name: 'Solar flare', colors: ['#ff945b', '#e14345', '#a449b5'] }, { id: 'acid', name: 'Acid dream', colors: ['#daff63', '#66d4a1', '#14acaa'] }, { id: 'moon', name: 'Blue hour', colors: ['#aecbff', '#647fea', '#b65bdb'] }] as const;
const EQ_PRESETS: Record<string, number[]> = { Flat: [0, 0, 0, 0, 0, 0, 0], Warm: [3, 2, 1, 0, -1, -2, -1], Bright: [-1, 0, 0, 1, 2, 3, 2], 'Bass boost': [5, 3, 1, 0, 0, 0, 0] };
function readSettings(): VisualizerSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('pulseform-visuals') || '{}');
    const settings = { ...DEFAULT_SETTINGS };
    if (SCENES.some(s => s.id === saved.scene)) settings.scene = saved.scene;
    if (saved.palette === 'custom' || PALETTES.some(p => p.id === saved.palette)) settings.palette = saved.palette;
    for (const key of ['intensity', 'speed', 'detail', 'grain'] as const) if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) settings[key] = Math.max(0, Math.min(key === 'speed' ? 2 : 1, saved[key]));
    if (Array.isArray(saved.customColors) && saved.customColors.length === 4 && saved.customColors.every((color: unknown) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) settings.customColors = saved.customColors;
    // Update the previous ambient defaults without overwriting custom values.
    if (saved.revision !== 2) {
      if (saved.speed === 0.45) settings.speed = DEFAULT_SETTINGS.speed;
      if (saved.intensity === 0.7) settings.intensity = DEFAULT_SETTINGS.intensity;
      if (saved.grain === 0.18) settings.grain = DEFAULT_SETTINGS.grain;
    }
    if (typeof saved.reactive === 'boolean') settings.reactive = saved.reactive;
    return settings;
  } catch { return DEFAULT_SETTINGS; }
}
function time(seconds: number) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function Slider({ label, value, min = 0, max = 1, step = 0.01, display, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; display?: string; onChange: (value: number) => void }) {
  return <label className="slider-control"><span><span>{label}</span><output>{display ?? `${Math.round(value * 100)}%`}</output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as CSSProperties} onChange={event => onChange(Number(event.target.value))} /></label>;
}

export default function App() {
  const [settings, setSettings] = useState(readSettings);
  const [tab, setTab] = useState<'visuals' | 'sound'>('visuals');
  const [track, setTrack] = useState<{ name: string; description: string; demo: boolean } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [volume, setVolume] = useState(0.75);
  const [loop, setLoop] = useState(false);
  const [eq, setEq] = useState([0, 0, 0, 0, 0, 0, 0]);
  const [eqEnabled, setEqEnabled] = useState(true);
  const [mix, setMix] = useState(defaultMix);
  const [stemsReady, setStemsReady] = useState(false);
  const [separationMode, setSeparationMode] = useState<'quick' | 'ai'>('quick');
  const [stemKind, setStemKind] = useState<'quick' | 'ai' | 'demo'>('demo');
  const [separation, setSeparation] = useState<{ stage: string; progress: number | null } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const engine = useRef<AudioEngine | null>(null);
  const audioBuffer = useRef<AudioBuffer | null>(null);
  const worker = useRef<Worker | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const importGeneration = useRef(0);
  const dragDepth = useRef(0);

  const setting = <K extends keyof VisualizerSettings>(key: K, value: VisualizerSettings[K]) => setSettings(s => ({ ...s, [key]: value }));
  function getEngine() {
    if (!engine.current) {
      engine.current = new AudioEngine();
      engine.current.setVolume(volume); engine.current.setEQ(eqEnabled ? eq : EQ_PRESETS.Flat); engine.current.loop = loop;
      setAnalyser(engine.current.analyser);
    }
    return engine.current;
  }
  function cancelSeparation() { worker.current?.terminate(); worker.current = null; setSeparation(null); }
  function applyTrack(buffer: AudioBuffer, nextTrack: NonNullable<typeof track>, stems?: Record<Stem, AudioBuffer>) {
    const audio = getEngine(); audio.load(buffer, stems); audioBuffer.current = buffer;
    setTrack(nextTrack); setDuration(buffer.duration); setPosition(0); setPlaying(false); setPeaks(waveform(buffer));
    setMix(defaultMix()); setStemsReady(Boolean(stems)); setStemKind('demo'); setError('');
  }
  async function loadFile(file: File) {
    const generation = ++importGeneration.current;
    cancelSeparation(); setLoading(true); setError('');
    try {
      if (file.size > 250 * 1024 * 1024) throw new Error('Choose an audio file smaller than 250 MB.');
      const audio = getEngine();
      // Resume from the file-picker gesture; decode is separate from playback.
      await audio.context.resume();
      const buffer = await audio.context.decodeAudioData(await file.arrayBuffer());
      if (generation !== importGeneration.current) return;
      applyTrack(buffer, { name: file.name.replace(/\.[^.]+$/, ''), description: `${file.name.split('.').pop()?.toUpperCase()} · ${buffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'} · ${(buffer.sampleRate / 1000).toFixed(1)} kHz`, demo: false });
    } catch (cause) {
      if (generation === importGeneration.current) setError(cause instanceof Error && cause.message.includes('250 MB') ? cause.message : 'This file could not be decoded. Try MP3, WAV, FLAC, OGG or a browser-supported M4A file.');
    } finally { if (generation === importGeneration.current) setLoading(false); }
  }
  async function loadDemo() {
    ++importGeneration.current; cancelSeparation(); setLoading(true); setError('');
    try {
      const audio = getEngine(); await audio.context.resume();
      const demo = createDemo(audio.context);
      applyTrack(demo.buffer, { name: 'A little further', description: 'Original synth demo · 120 BPM', demo: true }, demo.stems);
      await audio.play(); setPlaying(audio.playing);
    } catch { setError('Audio could not start. Check that your browser allows audio playback.'); }
    finally { setLoading(false); }
  }
  async function togglePlay() {
    if (!track) return;
    try {
      const audio = getEngine();
      if (audio.playing) audio.pause(); else await audio.play();
      setPlaying(audio.playing); setPosition(audio.position);
    } catch { setError('Playback could not start. Try pressing play again.'); }
  }
  function updateMix(stem: Stem, patch: Partial<Mix[Stem]>) {
    setMix(previous => { const next = { ...previous, [stem]: { ...previous[stem], ...patch } }; engine.current?.setMix(next); return next; });
  }
  async function separate() {
    if (!audioBuffer.current || separation || stemsReady) return;
    if (duration > 600) { setError('For browser memory, separate tracks up to 10 minutes long. EQ and visuals work with longer tracks.'); return; }
    setError(''); setSeparation({ stage: separationMode === 'quick' ? 'Starting quick split' : 'Starting the AI worker', progress: null });
    const source = audioBuffer.current;
    const generation = importGeneration.current;
    try {
      const mode = separationMode;
      const separationWorker = mode === 'quick'
        ? new Worker(new URL('./quick-separation.worker.ts', import.meta.url), { type: 'module' })
        : new Worker(new URL('./separation.worker.ts', import.meta.url), { type: 'module' });
      worker.current = separationWorker;
      const fail = (message: string) => { if (worker.current !== separationWorker) return; cancelSeparation(); setError(message); };
      separationWorker.onerror = () => fail('The separation worker could not start. Try a current desktop Chrome or Edge browser.');
      separationWorker.onmessage = async ({ data }: MessageEvent<{ type: string; stage: string; progress: number | null; message: string; result: SeparationResult }>) => {
        if (generation !== importGeneration.current || worker.current !== separationWorker) return;
        if (data.type === 'progress') setSeparation({ stage: data.stage, progress: data.progress });
        if (data.type === 'error') fail(data.message);
        if (data.type === 'complete') {
          try {
            const audio = getEngine();
            const buffers = Object.fromEntries(STEMS.map(stem => {
              const separated = data.result[stem];
              const buffer = audio.context.createBuffer(2, separated.left.length, mode === 'quick' ? source.sampleRate : 44100);
              buffer.getChannelData(0).set(separated.left); buffer.getChannelData(1).set(separated.right);
              return [stem, buffer];
            })) as Record<Stem, AudioBuffer>;
            await audio.setStems(buffers);
            setStemsReady(true); setStemKind(mode); setMix(defaultMix()); setNotice(mode === 'quick' ? 'Quick layers ready. Try soloing and blending them.' : 'AI stems ready. Make the mix your own.');
            cancelSeparation();
          } catch { fail('Your browser ran out of memory loading the stems. Try a shorter track.'); }
        }
      };
      const left = new Float32Array(source.getChannelData(0));
      const right = new Float32Array(source.getChannelData(source.numberOfChannels > 1 ? 1 : 0));
      separationWorker.postMessage({ left, right, sampleRate: source.sampleRate }, [left.buffer, right.buffer]);
    } catch { cancelSeparation(); setError('Separation could not start in this browser. Try desktop Chrome or Edge.'); }
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.current?.requestFullscreen(); }
    catch { setNotice('Fullscreen is unavailable in this browser.'); }
  }
  function saveFrame() {
    canvas.current?.toBlob(blob => {
      if (!blob) { setError('This browser could not save the frame.'); return; }
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `pulseform-${settings.scene}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Frame saved.');
    });
  }

  useEffect(() => { try { localStorage.setItem('pulseform-visuals', JSON.stringify({ ...settings, frozen: false, revision: 2 })); } catch { /* Storage is optional. */ } }, [settings]);
  useEffect(() => {
    const timer = setInterval(() => { if (engine.current) { setPosition(engine.current.position); setPlaying(engine.current.playing); } }, 100);
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => { clearInterval(timer); document.removeEventListener('fullscreenchange', onFullscreen); worker.current?.terminate(); void engine.current?.destroy(); engine.current = null; };
  }, []);
  useEffect(() => { const timer = notice ? setTimeout(() => setNotice(''), 4500) : undefined; return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable) return;
      if (event.code === 'Space') { event.preventDefault(); void togglePlay(); }
      if (event.key.toLowerCase() === 'f') void toggleFullscreen();
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });

  const activeScene = SCENES.find(s => s.id === settings.scene)!;
  return <div className="app-shell" onDragEnter={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current++; setDragging(true); }} onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (event.dataTransfer.files[0]) void loadFile(event.dataTransfer.files[0]); }}>
    <input ref={input} className="sr-only" type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.aiff,.opus" aria-label="Choose local audio file" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.target.value = ''; }} />
    <header className="app-header">
      <a className="wordmark" href="./" aria-label="Pulseform home"><WaveformIcon size={27} weight="bold" /><span>pulseform<span className="wordmark-dot">.</span></span></a>
      <div className="header-center"><span className="header-label">VISUALISER STUDIO</span><span className="session-status"><span /> On your device</span></div>
      <div className="header-actions"><button className="button primary small" onClick={() => input.current?.click()} disabled={loading}>{loading ? <CircleNotchIcon className="spin" size={18} /> : <FolderOpenIcon size={18} />} Open audio</button></div>
    </header>
    <a className="skip-link" href="#studio">Skip to studio</a>
    <main className="studio" id="studio">
      <div className="workspace-heading"><div><span className="section-kicker">THE LISTENING ROOM</span><h1>See your sound.</h1></div><span className="private-note"><HeadphonesIcon size={17} /> Headphones on. World off.</span></div>
      <div className="workspace-grid">
        <section className="visual-workspace" aria-label="Visualiser and audio player">
          <div className={`visual-stage ${fullscreen ? 'is-fullscreen' : ''}`} ref={stage}>
            <Visualizer settings={settings} analyser={analyser} playing={playing} canvasRef={canvas} getTransport={() => ({ position: engine.current?.position ?? 0, revision: engine.current?.transportRevision ?? 0, readyAt: engine.current?.transportReadyAt ?? Infinity })} />
            <div className="stage-top"><div className="stage-title"><span className="stage-tag">LIVE CANVAS</span><span>{activeScene.name}</span></div><div className="stage-actions"><button className={`stage-button ${settings.frozen ? 'active' : ''}`} aria-label={settings.frozen ? 'Unfreeze visuals' : 'Freeze visuals'} title={settings.frozen ? 'Unfreeze visuals' : 'Freeze visuals'} aria-pressed={settings.frozen} onClick={() => setting('frozen', !settings.frozen)}>{settings.frozen ? <PlayIcon size={17} /> : <SnowflakeIcon size={17} />}</button><button className="stage-button" title="Save image" aria-label="Save visualiser image" onClick={saveFrame}><DownloadSimpleIcon size={17} /></button><button className="stage-button" title="Fullscreen (F)" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => void toggleFullscreen()}><ArrowsOutIcon size={17} /></button></div></div>
            {!track && <div className="stage-welcome"><p>Drop a track. Get lost.</p><div><button className="button primary" disabled={loading} onClick={() => input.current?.click()}><MusicNotesIcon size={18} /> Choose a track</button><button className="button stage-secondary" disabled={loading} onClick={() => void loadDemo()}><PlayIcon size={16} weight="fill" /> Try the demo</button></div><span className="format-note">MP3, WAV, FLAC + more · Nothing uploaded</span></div>}
            <div className="stage-bottom"><span>{settings.frozen ? 'Visuals frozen' : 'Move to bend the flow'}</span><span className="stage-mode">{track && playing && settings.reactive ? 'AUDIO REACTIVE' : 'AMBIENT MODE'}<span className={track && playing && settings.reactive ? 'live-indicator active' : 'live-indicator'} /></span></div>
            {fullscreen && <button className="fullscreen-play button stage-secondary" onClick={() => void togglePlay()} disabled={!track}>{playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />} {playing ? 'Pause music' : 'Play music'}</button>}
          </div>
          <div className="transport">
            <div className="track-art"><WaveformIcon size={25} /></div><div className="track-info"><strong>{loading ? 'Decoding your audio…' : track?.name || 'The next track is yours'}</strong><span>{track?.description || 'Open a local file or explore the demo'}</span></div>
            <div className="playback-buttons"><button className="icon-button restart" aria-label="Restart track" disabled={!track} onClick={() => void engine.current?.seek(0)}><SkipBackIcon size={20} weight="fill" /></button><button className="play-button" aria-label={playing ? 'Pause' : 'Play'} disabled={!track || loading} onClick={() => void togglePlay()}>{playing ? <PauseIcon weight="fill" size={22} /> : <PlayIcon weight="fill" size={22} />}</button><button className={`icon-button ${loop ? 'selected' : ''}`} aria-label="Loop track" aria-pressed={loop} disabled={!track} onClick={() => { setLoop(!loop); void engine.current?.setLoop(!loop); }}><RepeatIcon size={20} /></button></div>
            <div className="volume-control"><button className="icon-button" aria-label={volume ? 'Mute master volume' : 'Unmute master volume'} onClick={() => { const next = volume ? 0 : 0.75; setVolume(next); engine.current?.setVolume(next); }}>{volume ? <SpeakerHighIcon size={19} /> : <SpeakerSlashIcon size={19} />}</button><input type="range" aria-label="Master volume" min="0" max="1" step="0.01" value={volume} style={{ '--fill': `${volume * 100}%` } as CSSProperties} onChange={event => { const next = Number(event.target.value); setVolume(next); engine.current?.setVolume(next); }} /><output aria-label="Volume percentage">{Math.round(volume * 100)}%</output></div>
            <div className="timeline"><span>{time(position)}</span><div className="waveform-track"><div className="waveform-bars" aria-hidden="true">{(peaks.length ? peaks : Array(160).fill(0.04)).map((peak, i) => <i key={i} className={duration && i / 160 <= position / duration ? 'played' : ''} style={{ height: `${Math.max(6, peak * 100)}%` }} />)}</div><input type="range" aria-label="Seek track" min="0" max={duration || 1} step="0.1" value={position} disabled={!track} onChange={event => { const next = Number(event.target.value); setPosition(next); void engine.current?.seek(next); }} /></div><span>{time(duration)}</span></div>
          </div>
          <div className="workspace-caption"><span><AsteriskIcon className="caption-mark" size={16} /> {playing && settings.reactive ? 'Bass expands. Mids bend. Highs shimmer.' : 'Press play. Watch the music take shape.'}</span><span><kbd>space</kbd> play / pause <span className="caption-separator">·</span> <kbd>F</kbd> fullscreen</span></div>
        </section>
        <aside className="control-panel" aria-label="Customise your experience">
          <div className="panel-tabs" role="tablist" aria-label="Studio controls" onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'visuals' : event.key === 'End' ? 'sound' : tab === 'visuals' ? 'sound' : 'visuals'; setTab(next); (event.currentTarget.querySelector(`#${next}-tab`) as HTMLButtonElement)?.focus(); }}><button id="visuals-tab" role="tab" tabIndex={tab === 'visuals' ? 0 : -1} aria-selected={tab === 'visuals'} aria-controls="visuals-panel" className={tab === 'visuals' ? 'selected' : ''} onClick={() => setTab('visuals')}><SlidersHorizontalIcon size={18} /> Visuals</button><button id="sound-tab" role="tab" tabIndex={tab === 'sound' ? 0 : -1} aria-selected={tab === 'sound'} aria-controls="sound-panel" className={tab === 'sound' ? 'selected' : ''} onClick={() => setTab('sound')}><EqualizerIcon size={18} /> Sound</button></div>
          {tab === 'visuals' ? <div id="visuals-panel" role="tabpanel" aria-labelledby="visuals-tab" className="panel-body">
            <div className="control-section scene-section"><div className="control-heading"><h2>Choose your scene</h2><span>{String(SCENES.findIndex(s => s.id === settings.scene) + 1).padStart(2, '0')} / 04</span></div><div className="scene-grid">{SCENES.map(scene => <button className={`scene-option ${scene.id === settings.scene ? 'selected' : ''}`} aria-pressed={settings.scene === scene.id} key={scene.id} onClick={() => setting('scene', scene.id)}><div className={`scene-swatch ${scene.id}`} aria-hidden="true"><img src={`/previews/${scene.id}.png`} alt="" />{scene.id === settings.scene && <span className="scene-check"><CheckIcon size={11} weight="bold" /></span>}</div><strong>{scene.name}</strong><span>{scene.subtitle}</span></button>)}</div></div>
            <div className="control-section"><div className="control-heading"><h2>Colour story</h2><span>3 presets + yours</span></div><div className="palette-list">{PALETTES.map(palette => <button className={`palette-option ${settings.palette === palette.id ? 'selected' : ''}`} key={palette.id} aria-pressed={settings.palette === palette.id} onClick={() => setting('palette', palette.id)}><span className="palette-colors">{palette.colors.map(color => <i key={color} style={{ backgroundColor: color }} />)}</span><span>{palette.name}</span>{settings.palette === palette.id && <CheckIcon size={16} weight="bold" />}</button>)}<button className={`palette-option ${settings.palette === 'custom' ? 'selected' : ''}`} aria-pressed={settings.palette === 'custom'} onClick={() => setting('palette', 'custom')}><span className="palette-colors">{settings.customColors.map((color, i) => <i key={i} style={{ backgroundColor: color }} />)}</span><span>Your colours</span>{settings.palette === 'custom' && <CheckIcon size={16} weight="bold" />}</button></div>{settings.palette === 'custom' && <div className="custom-palette"><p>Choose four colours to blend through the flow.</p><div className="custom-color-grid">{settings.customColors.map((color, i) => <label key={i}><span>Colour {i + 1}</span><input type="color" aria-label={`Custom colour ${i + 1}`} value={color} onChange={event => setting('customColors', settings.customColors.map((value, j) => j === i ? event.target.value : value) as VisualizerSettings['customColors'])} /><output>{color.toUpperCase()}</output></label>)}</div></div>}</div>
            <div className="control-section motion-section"><div className="control-heading"><h2>Motion & texture</h2><MagicWandIcon size={16} /></div><Slider label="Intensity" value={settings.intensity} onChange={value => setting('intensity', value)} /><Slider label="Motion speed" value={settings.speed} max={2} display={`${settings.speed.toFixed(2)}×`} onChange={value => setting('speed', value)} /><Slider label="Detail" value={settings.detail} onChange={value => setting('detail', value)} /><Slider label="Film grain" value={settings.grain} onChange={value => setting('grain', value)} /></div>
            <div className="reactive-control"><div><WaveformIcon size={21} /><span><strong>Follow the music</strong><span>Let the sound lead.</span></span></div><button role="switch" aria-checked={settings.reactive} aria-label="Audio reactive visuals" className={`switch ${settings.reactive ? 'on' : ''}`} onClick={() => setting('reactive', !settings.reactive)}><span /></button></div>
            <button className="reset-button" onClick={() => { setSettings(DEFAULT_SETTINGS); setNotice('Visuals reset to the original flow.'); }}><ArrowCounterClockwiseIcon size={15} /> Reset visuals</button>
          </div> : <div id="sound-panel" role="tabpanel" aria-labelledby="sound-tab" className="panel-body sound-panel">
            <div className="control-section eq-section"><div className="control-heading"><h2>Shape your sound</h2><button role="switch" aria-checked={eqEnabled} aria-label="Enable equalizer" className={`switch ${eqEnabled ? 'on' : ''}`} onClick={() => { setEqEnabled(!eqEnabled); engine.current?.setEQ(!eqEnabled ? eq : EQ_PRESETS.Flat); }}><span /></button></div><div className="eq-presets">{Object.entries(EQ_PRESETS).map(([name, values]) => <button key={name} aria-pressed={values.every((value, i) => value === eq[i])} className={values.every((value, i) => value === eq[i]) ? 'selected' : ''} onClick={() => { setEq(values); engine.current?.setEQ(eqEnabled ? values : EQ_PRESETS.Flat); }}>{name}</button>)}</div><div className={`equalizer ${eqEnabled ? '' : 'bypassed'}`}><div className="eq-scale"><span>+12</span><span>0 dB</span><span>−12</span></div>{EQ_BANDS.map((frequency, i) => <label className="eq-band" key={frequency}><output>{eq[i] > 0 ? '+' : ''}{eq[i]}</output><input type="range" aria-label={`EQ ${frequency} Hz`} min="-12" max="12" step="1" value={eq[i]} style={{ '--fill': `${(eq[i] + 12) / 24 * 100}%` } as CSSProperties} aria-orientation="vertical" disabled={!eqEnabled} onChange={event => { const next = eq.map((value, j) => j === i ? Number(event.target.value) : value); setEq(next); engine.current?.setEQ(next); }} /><span>{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span></label>)}</div></div>
            <div className="control-section stem-section"><div className="control-heading"><h2>Inside the music</h2><span>4 stems</span></div><p className="section-description">Pull apart the layers. Find what moves you.</p>
              {!stemsReady && !separation && <div className="separate-intro"><div className="separation-modes" role="group" aria-label="Separation quality"><button aria-pressed={separationMode === 'quick'} className={separationMode === 'quick' ? 'selected' : ''} onClick={() => setSeparationMode('quick')}>Quick split<span>Fast · rough layers</span></button><button aria-pressed={separationMode === 'ai'} className={separationMode === 'ai' ? 'selected' : ''} onClick={() => setSeparationMode('ai')}>AI stems<span>Slower · cleaner</span></button></div><button className="button primary separate-button" disabled={!track} onClick={() => void separate()}><MagicWandIcon size={18} /> {separationMode === 'quick' ? 'Quick split' : 'Separate AI stems'}</button><span>{track ? (separationMode === 'quick' ? 'No download. Entirely on your device.' : 'Free AI separation, on your device.') : 'Open a track to separate its stems.'}</span><p>{separationMode === 'quick' ? 'Approximate layers from sound texture and stereo position. Vocals includes centred instruments; expect bleed.' : 'First use downloads a ~172 MB model. Processing can take several minutes.'}</p></div>}
              {separation && <div className="separation-status" role="status"><CircleNotchIcon className="spin" size={22} /><strong>{separation.stage}</strong><progress aria-label="Stem separation progress" max="1" {...(separation.progress === null ? {} : { value: separation.progress })} /><button className="text-button" onClick={cancelSeparation}>Cancel separation</button></div>}
              <div className={`stem-mixer ${stemsReady ? '' : 'unavailable'}`}>{STEMS.map(stem => <div className="stem-row" key={stem}><div className="stem-heading"><span className={`stem-symbol ${stem}`}><WaveformIcon size={15} /></span><strong>{stem.charAt(0).toUpperCase() + stem.slice(1)}</strong><output>{Math.round(mix[stem].volume * 100)}%</output><button disabled={!stemsReady} className={mix[stem].muted ? 'active' : ''} aria-pressed={mix[stem].muted} aria-label={`Mute ${stem}`} onClick={() => updateMix(stem, { muted: !mix[stem].muted })}>M</button><button disabled={!stemsReady} className={mix[stem].solo ? 'active' : ''} aria-pressed={mix[stem].solo} aria-label={`Solo ${stem}`} onClick={() => updateMix(stem, { solo: !mix[stem].solo })}>S</button></div><input type="range" aria-label={`${stem} level`} min="0" max="1.5" step="0.01" value={mix[stem].volume} style={{ '--fill': `${mix[stem].volume / 1.5 * 100}%` } as CSSProperties} disabled={!stemsReady} onChange={event => updateMix(stem, { volume: Number(event.target.value) })} /></div>)}</div>
              {stemsReady && <p className="stem-note"><CheckIcon size={15} /> {track?.demo ? 'Demo source tracks. Vocals carries the synth lead.' : stemKind === 'quick' ? 'Quick layers ready. Vocals is a centre/lead approximation, with instrument bleed.' : 'AI stems ready. Some bleed between instruments is normal.'}</p>}
            </div><button className="reset-button" onClick={() => { setEq(EQ_PRESETS.Flat); engine.current?.setEQ(EQ_PRESETS.Flat); const next = defaultMix(); setMix(next); engine.current?.setMix(next); }}><ArrowCounterClockwiseIcon size={15} /> Reset sound</button>
          </div>}
        </aside>
      </div>
    </main>
    <footer className="app-footer"><span>PULSEFORM <span> / </span> A space between sound & sight</span><span>Local files. Limitless feeling.</span></footer>
    {notice && <div className="toast" role="status"><CheckIcon size={18} /> {notice}</div>}
    {error && <div className="error-toast" role="alert"><InfoIcon size={20} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><XIcon size={18} /></button></div>}
    {dragging && <div className="drop-overlay"><FolderOpenIcon size={48} /><strong>Let it flow.</strong><span>Drop your audio file here</span></div>}
  </div>;
}
