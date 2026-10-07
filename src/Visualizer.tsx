import { useEffect, useRef, type RefObject } from 'react';
import { AudioResponse, LiquidMotion, silentAudioFeatures } from './audio-response';
import './Visualizer.css';

export type VisualizerSettings = {
  scene: 'currents' | 'bloom' | 'tunnel' | 'scope';
  palette: 'solar' | 'acid' | 'moon' | 'custom';
  customColors: [string, string, string, string];
  intensity: number;
  speed: number;
  detail: number;
  grain: number;
  reactive: boolean;
  frozen: boolean;
};

type Props = {
  settings: VisualizerSettings;
  analyser: AnalyserNode | null;
  playing: boolean;
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  getTransport?: () => { position: number; revision: number; readyAt?: number };
};

const vertexSource = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0., 1.); }
`;

const fragmentSource = `
precision highp float;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;
uniform vec3 uAudio;
uniform vec4 uDynamics;
uniform float uMotion;
uniform float uIntensity;
uniform float uDetail;
uniform float uGrain;
uniform int uScene;
uniform int uPalette;
uniform vec3 uCustom0;
uniform vec3 uCustom1;
uniform vec3 uCustom2;
uniform vec3 uCustom3;
uniform sampler2D uSpectrum;
const float PI = 3.14159265359;

mat2 rotate(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Broad interpolation across real log-frequency bands produces fluid, local folds.
float spectrumAt(float x) {
  x = clamp(x, .025, .975);
  return (texture2D(uSpectrum, vec2(x, .5)).r * .34
    + texture2D(uSpectrum, vec2(x - .024, .5)).r * .23
    + texture2D(uSpectrum, vec2(x + .024, .5)).r * .23
    + texture2D(uSpectrum, vec2(x - .050, .5)).r * .10
    + texture2D(uSpectrum, vec2(x + .050, .5)).r * .10) * uMotion;
}

// A deliberately limited, ink-like colour spectrum, rather than rainbow noise.
vec3 ink(float t) {
  t = fract(t);
  vec3 a; vec3 b; vec3 c; vec3 d;
  if (uPalette == 0) {
    a = vec3(.91, .26, .13); b = vec3(1., .68, .36);
    c = vec3(.68, .24, .74); d = vec3(.21, .16, .43);
  } else if (uPalette == 1) {
    a = vec3(.72, .96, .28); b = vec3(.94, 1., .66);
    c = vec3(.16, .64, .46); d = vec3(.21, .23, .51);
  } else if (uPalette == 3) {
    a = uCustom0; b = uCustom1; c = uCustom2; d = uCustom3;
  } else {
    a = vec3(.32, .49, .95); b = vec3(.64, .88, 1.);
    c = vec3(.65, .40, .85); d = vec3(.23, .27, .61);
  }
  if (t < .33) return mix(a, b, smoothstep(0., .33, t));
  if (t < .60) return mix(b, c, smoothstep(.33, .60, t));
  if (t < .83) return mix(c, d, smoothstep(.60, .83, t));
  return mix(d, a, smoothstep(.83, 1., t));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = (gl_FragCoord.xy * 2. - uResolution) / min(uResolution.x, uResolution.y);
  float t = uTime;
  float strength = .45 + uIntensity * .9;
  float bass = uAudio.x * strength;
  float mid = uAudio.y * strength;
  float treble = uAudio.z * strength;
  float energy = uDynamics.x * strength;
  float pulse = uDynamics.y * strength;
  float flux = uDynamics.z * strength;
  float crest = uDynamics.w * strength;
  p -= uPointer * .045;
  // Audio changes the silhouette and its internal flow, not merely the exposure.
  p /= 1. + bass * .13 + pulse * .07;
  float density = 12. + uDetail * 22.;
  vec3 background = mix(vec3(.040, .040, .050), vec3(.069, .068, .080), .6);
  float haze = exp(-length(p * vec2(.7, 1.)) * 1.8);
  vec3 color = background + ink(.72) * haze * .034;
  float field = 0.;
  float mask = 0.;
  float shade = 1.;
  float chroma = 0.;
  float edge = 0.;

  if (uScene == 0) {
    // Slowly advected contours overlap like luminous folds in liquid silk.
    vec2 q = rotate(-.36 + sin(t * .12) * .15 + uPointer.x * .04 + mid * .12) * p;
    q *= vec2(.89, 1.12);
    q.x += (.14 + mid * .065) * sin(q.y * 3.1 + t * .31)
      + (.055 + treble * .014) * sin(q.y * 5.2 - t * .19);
    q.y += (.105 + bass * .04) * sin(q.x * 3.5 + t * .24 + pulse * .18);
    float r = length(q);
    float a = atan(q.y, q.x);
    float spectralFold = spectrumAt(.50 + .46 * cos(a + r * .7)) * strength;
    float spectralCurl = spectrumAt(.50 + .46 * sin(a - r * .8)) * strength;
    float warp = (.080 + bass * .035 + pulse * .025) * sin(a * 3. + t * .23 + r * 3.5)
      + (.035 + mid * .025) * cos(a * 2. - t * .17 + r * 4.)
      + treble * .006 * sin(a * 9. + r * 7. - t * .6);
    float surface = r + (warp - spectralFold * .20 + spectralCurl * .07) * smoothstep(.05, .4, r);
    float outer = .80 + bass * .025;
    float inner = .08 + pulse * .025 + .022 * sin(a * 2. + t * .18);
    mask = smoothstep(inner, inner + .095, surface) * (1. - smoothstep(outer - .075, outer + .05, surface));
    float curl = (.13 + mid * .075 + spectralCurl * .10) * sin(a + r * (4. + bass * .65) + t * .18);
    field = (surface + curl * smoothstep(.10, .7, r)) * density - t * .27
      + flux * .09 * sin(a * 5. + r * 8. - t * .5);
    shade = .36 + .64 * pow(.5 + .5 * cos(a - .9 + r * 4.), 1.5);
    shade += .32 * exp(-pow((surface - .65) * 8., 2.));
    chroma = .04 + surface * .63 + .13 * sin(a - .7) + t * .009;
    edge = exp(-pow((surface - outer + .03) * 26., 2.)) * .14;
    color += ink(chroma + .08) * exp(-pow((surface - .53) * 3.1, 2.)) * .075;
  } else if (uScene == 1) {
    vec2 q = rotate(t * .045 + mid * .12) * p * 1.04;
    float r = length(q);
    float a = atan(q.y, q.x);
    float spectralPetal = spectrumAt(.5 + .46 * cos(a + r)) * strength;
    float spectralVein = spectrumAt(.5 + .46 * sin(a - r)) * strength;
    float petals = .72 * sin(a * 5. + r * (3. + mid) - t * .24)
      + .28 * sin(a * 3. - r * 2. + t * .16);
    float surface = r / (1. + (.22 + bass * .09) * petals
      + spectralPetal * .27 + spectralVein * .10 * sin(a * 3. + r * 2.)
      + (.045 + treble * .025) * sin(a * 8. + t * .23));
    mask = smoothstep(.035, .13 + pulse * .06, surface) * (1. - smoothstep(.68 + bass * .04, .73 + bass * .04, surface));
    field = surface * density + sin(a * 3. + surface * (6. + mid * 2.) - t * .24) * (.7 + mid * .60 + spectralVein * .8)
      - t * .31 + flux * .08 * sin(a * 9. - t * .3);
    shade = .42 + .6 * pow(.5 + .5 * cos(a * 6. + r * 5. - t * .3), 1.7);
    chroma = surface * .85 + petals * .095 + t * .012;
    edge = pow(.5 + .5 * petals, 6.) * smoothstep(.4, .75, surface) * .18;
  } else if (uScene == 2) {
    vec2 q = rotate(.30 * sin(t * .09) + length(p) * (.25 + mid * .25)) * p;
    q += vec2((.11 + mid * .09) * sin(t * .23), (.07 + bass * .08) * cos(t * .27)) / (1. + length(q));
    float shape = 2.7 - bass * .35 + treble * .12;
    float r = pow(pow(abs(q.x), shape) + pow(abs(q.y), shape), 1. / shape);
    float a = atan(q.y, q.x);
    float spectralWall = spectrumAt(.5 + .46 * cos(a + r * .5)) * strength;
    float spectralTwist = spectrumAt(.5 + .46 * sin(a - r * .7)) * strength;
    r *= 1. - spectralWall * .25;
    float z = log(max(.065, r)) * .34;
    field = z * density - t * .8 + (0.8 + mid * .6) * sin(a * 3. + z * 4. + t * .15)
      + spectralTwist * .7 * sin(a * 2. + z * 3.)
      + treble * .12 * sin(a * 8. + z * 6. - t * .4);
    mask = smoothstep(.065, .18, r) * (1. - smoothstep(1.15, 2.1, r));
    shade = (.5 + .5 * smoothstep(.08, .8, r)) * (.62 + .38 * sin(a * 2. + z * 2.));
    chroma = z * .65 + .13 * sin(a * 2.) + t * .023;
  } else {
    // Contour topography around the live waveform; the static carrier remains quiet at rest.
    vec2 q = rotate(-.12 + mid * .12) * p;
    float tx = clamp(q.x * .42 + .5, .001, .999);
    float wave = ((texture2D(uSpectrum, vec2(tx, .5)).g * .40
      + texture2D(uSpectrum, vec2(tx - .012, .5)).g * .24
      + texture2D(uSpectrum, vec2(tx + .012, .5)).g * .24
      + texture2D(uSpectrum, vec2(tx - .025, .5)).g * .06
      + texture2D(uSpectrum, vec2(tx + .025, .5)).g * .06) * 2. - 1.) * uMotion;
    float amplitude = spectrumAt(tx) * strength;
    float carrier = sin(q.x * (3.4 + bass * 1.7) - t * .65) * (.12 + bass * .12)
      + sin(q.x * (6. + mid * 3.) + t * .35) * (.035 + mid * .055);
    float center = carrier + wave * (.48 + energy * .28) * strength
      + amplitude * .18 * sin(q.x * 2. + t * .12);
    float envelope = pow(max(0., 1. - pow(abs(q.x) / 1.13, 2.)), .65);
    float y = abs(q.y - center);
    float surface = y / max(.08, envelope);
    field = surface * density * .9 + sin(q.x * (4. + mid * 1.5) + surface * 4. - t * .3) * (.7 + treble * .2);
    mask = (1. - smoothstep(.30 + amplitude * .16 + bass * .07, .39 + amplitude * .16 + bass * .07, surface))
      * (1. - smoothstep(.99, 1.15, abs(q.x)));
    shade = .45 + .55 * (1. - smoothstep(.02, .5, surface));
    chroma = q.x * .25 + surface * 1.1 + .2 + t * .008;
    edge = exp(-y * 130.) * (.3 + mid * .5);
  }

  float band = .5 + .5 * sin(field * 6.2831853);
  float filament = pow(band, 2.1 - crest * .15);
  float shoulder = pow(band, .7) * .28;
  vec3 pigment = ink(chroma);
  vec3 light = pigment * (filament * .62 + shoulder) * shade;
  light += ink(chroma + .08) * pow(band, 7.) * .13 * (1. + treble * .18);
  color += (light * (.72 + uIntensity * .52) + pigment * edge) * mask;

  // Fine film texture and an unobtrusive lens falloff keep the dark canvas tactile.
  float vignette = 1. - smoothstep(.4, 1.6, length((uv - .5) * vec2(1.25, 1.)));
  color *= .80 + .20 * vignette;
  color += (hash(gl_FragCoord.xy + floor(t * 8.)) - .5) * (.005 + uGrain * .055);
  color = max(color, vec3(0.));
  gl_FragColor = vec4(color, 1.);
}
`;

const sceneIds = { currents: 0, bloom: 1, tunnel: 2, scope: 3 };
const paletteIds = { solar: 0, acid: 1, moon: 2, custom: 3 };
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export default function Visualizer({ settings, analyser, playing, canvasRef, getTransport }: Props) {
  const localRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ settings, analyser, playing, getTransport });
  latest.current = { settings, analyser, playing, getTransport };

  useEffect(() => {
    const canvas = localRef.current;
    if (!canvas) return;
    if (canvasRef) canvasRef.current = canvas;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery.matches;
    let disposed = false;
    let frame = 0;
    let lastTime = 0;
    let elapsed = 0;
    let lastDrawSignature = '';
    let width = 1;
    let height = 1;
    let pointerX = 0;
    let pointerY = 0;
    let smoothX = 0;
    let smoothY = 0;
    const response = new AudioResponse();
    const liquidMotion = new LiquidMotion();
    let features = silentAudioFeatures();
    let visualFeatures = silentAudioFeatures();
    let frequencyData: Float32Array<ArrayBuffer> = new Float32Array(0);
    let waveformData: Float32Array<ArrayBuffer> = new Float32Array(0);
    let audioSource: AnalyserNode | null = null;
    let visualAnalyser: AnalyserNode | null = null;
    let transportRevision: number | undefined;
    let transportPosition: number | undefined;
    let primeNextSample = false;
    let primeAfter = 0;
    let primeUsesTransportClock = false;
    let wasPlaying = false;
    let historyResets = 0;
    const spectrumHistory = new Float32Array(128);
    const waveformHistory = new Float32Array(128);
    const spectrum = new Uint8Array(128 * 4);
    for (let i = 0; i < 128; i++) {
      spectrum[i * 4 + 1] = 128;
      spectrum[i * 4 + 3] = 255;
    }

    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    let program: WebGLProgram | null = null;
    let vertex: WebGLShader | null = null;
    let fragment: WebGLShader | null = null;
    let buffer: WebGLBuffer | null = null;
    let texture: WebGLTexture | null = null;
    let fallback: HTMLCanvasElement | null = null;
    let fallbackContext: CanvasRenderingContext2D | null = null;
    const uniforms: Record<string, WebGLUniformLocation | null> = {};

    const enableFallback = () => {
      if (fallback) return;
      // A second canvas also works when a WebGL canvas cannot acquire a 2D context.
      fallback = document.createElement('canvas');
      fallback.className = 'visualizer-canvas';
      fallback.setAttribute('aria-hidden', 'true');
      fallback.style.pointerEvents = 'none';
      fallback.width = width;
      fallback.height = height;
      canvas.insertAdjacentElement('afterend', fallback);
      fallbackContext = fallback.getContext('2d');
      if (canvasRef) canvasRef.current = fallback;
    };

    if (gl) {
      const compile = (kind: number, source: string) => {
        const shader = gl.createShader(kind);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          gl.deleteShader(shader);
          return null;
        }
        return shader;
      };
      vertex = compile(gl.VERTEX_SHADER, vertexSource);
      fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      if (vertex && fragment) {
        program = gl.createProgram();
        if (program) {
          gl.attachShader(program, vertex);
          gl.attachShader(program, fragment);
          gl.linkProgram(program);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            gl.deleteProgram(program);
            program = null;
          }
        }
      }
      if (program) {
        gl.useProgram(program);
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'aPosition');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        for (const key of ['uResolution', 'uPointer', 'uTime', 'uAudio', 'uDynamics', 'uMotion', 'uIntensity', 'uDetail', 'uGrain', 'uScene', 'uPalette', 'uCustom0', 'uCustom1', 'uCustom2', 'uCustom3', 'uSpectrum']) {
          uniforms[key] = gl.getUniformLocation(program, key);
        }
        texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, spectrum);
        gl.uniform1i(uniforms.uSpectrum, 0);
      } else enableFallback();
    } else enableFallback();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      lastDrawSignature = '';
      if (fallback) { fallback.width = width; fallback.height = height; }
      gl?.viewport(0, 0, width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const sampleAudio = (dt: number) => {
      const state = latest.current;
      // A loaded/paused node has no fresh sample window yet. Start its priming
      // deadline when playback actually begins, including pause/resume.
      let resetHistory = state.playing && !wasPlaying;
      wasPlaying = state.playing;
      if (state.analyser !== audioSource) {
        if (audioSource && visualAnalyser) audioSource.disconnect(visualAnalyser);
        visualAnalyser?.disconnect();
        audioSource = state.analyser;
        visualAnalyser = audioSource?.context.createAnalyser() ?? null;
        if (audioSource && visualAnalyser) {
          // This silent analysis branch preserves the main graph and meter smoothing.
          visualAnalyser.fftSize = 2048;
          visualAnalyser.smoothingTimeConstant = .05;
          audioSource.connect(visualAnalyser);
          frequencyData = new Float32Array(visualAnalyser.frequencyBinCount).fill(-Infinity);
          waveformData = new Float32Array(visualAnalyser.fftSize);
        }
        resetHistory = true;
      }
      const transport = state.getTransport?.();
      const loopRestarted = !!transport && transport.revision === transportRevision
        && transportPosition !== undefined && transport.position < transportPosition - .12;
      if (transport && (transport.revision !== transportRevision
        || loopRestarted)) {
        transportRevision = transport.revision;
        elapsed = Math.max(0, Number.isFinite(transport.position) ? transport.position : 0) * .45 * clamp(state.settings.speed, 0, 2);
        resetHistory = true;
      }
      if (transport) transportPosition = transport.position;
      if (resetHistory) {
        response.reset();
        liquidMotion.reset();
        features = silentAudioFeatures();
        visualFeatures = silentAudioFeatures();
        spectrumHistory.fill(0);
        waveformHistory.fill(0);
        for (let i = 0; i < 128; i++) { spectrum[i * 4] = 0; spectrum[i * 4 + 1] = 128; }
        primeNextSample = true;
        // The engine knows when its source was actually scheduled, after resume.
        // Its readyAt includes fresh PCM/FFT windows; Infinity means scheduling
        // is still pending. Standalone callers and loops use a local window.
        primeUsesTransportClock = transport?.readyAt !== undefined && !loopRestarted;
        primeAfter = primeUsesTransportClock ? transport!.readyAt! : (visualAnalyser?.context.currentTime ?? 0)
          + 2 * (visualAnalyser?.fftSize ?? 2048) / (visualAnalyser?.context.sampleRate ?? 44100) + .015;
        historyResets++;
        canvas.dataset.transportRevision = String(transportRevision ?? 0);
        canvas.dataset.audioHistoryResets = String(historyResets);
      }
      const node = visualAnalyser;
      if (node && state.playing && state.settings.reactive) {
        if (primeNextSample && primeUsesTransportClock && transport?.readyAt !== undefined) primeAfter = transport.readyAt;
        node.getFloatFrequencyData(frequencyData);
        node.getFloatTimeDomainData(waveformData);
        if (primeNextSample && node.context.currentTime < primeAfter) {
          frequencyData.fill(-Infinity);
          waveformData.fill(0);
        } else if (primeNextSample) {
          response.prime(frequencyData, waveformData, node.context.sampleRate, node.fftSize);
          primeNextSample = false;
        }
        features = response.update(frequencyData, waveformData, node.context.sampleRate, node.fftSize, dt);
        const hzPerBin = node.context.sampleRate / node.fftSize;
        const waveBlend = 1 - Math.exp(-dt / .045);
        const gate = clamp((features.rms - .0006) / .004);
        for (let i = 0; i < 128; i++) {
          const low = 30 * Math.pow(16000 / 30, Math.max(0, i - .65) / 127);
          const high = 30 * Math.pow(16000 / 30, Math.min(127, i + .65) / 127);
          const start = Math.min(frequencyData.length - 1, Math.max(1, Math.floor(low / hzPerBin)));
          const end = Math.min(frequencyData.length, Math.max(start + 1, Math.ceil(high / hzPerBin)));
          let power = 0;
          for (let bin = start; bin < end; bin++) {
            const db = frequencyData[bin];
            if (Number.isFinite(db)) power += Math.pow(10, db / 10);
          }
          // Absolute linear energy retains differences in loudness; it never stretches
          // a quiet/noisy spectrum to full scale or clips all audible bins to white.
          const magnitude = (1 - Math.exp(-Math.sqrt(power) * 12)) * gate;
          const blend = 1 - Math.exp(-dt / (magnitude > spectrumHistory[i] ? .035 : .16));
          spectrumHistory[i] += (magnitude - spectrumHistory[i]) * blend;
          spectrum[i * 4] = Math.round(spectrumHistory[i] * 255);
          const sample = waveformData[Math.min(waveformData.length - 1, Math.floor(i / 127 * (waveformData.length - 1)))];
          waveformHistory[i] += (sample - waveformHistory[i]) * waveBlend;
          spectrum[i * 4 + 1] = Math.round(clamp(waveformHistory[i] * .8 + .5) * 255);
        }
      } else {
        const decay = state.settings.reactive ? Math.exp(-dt / .16) : 0;
        for (let i = 0; i < 128; i++) {
          spectrumHistory[i] *= decay;
          waveformHistory[i] *= decay;
          spectrum[i * 4] = Math.round(spectrumHistory[i] * 255);
          spectrum[i * 4 + 1] = Math.round(clamp(waveformHistory[i] * .8 + .5) * 255);
        }
        if (!state.settings.reactive) {
          response.reset();
          liquidMotion.reset();
          features = silentAudioFeatures();
        } else {
          frequencyData.fill(-Infinity);
          waveformData.fill(0);
          features = response.update(frequencyData, waveformData, node?.context.sampleRate ?? 48000, node?.fftSize ?? 2048, dt);
        }
      }
      visualFeatures = liquidMotion.update(features, dt);
      // Inspectable evidence for audio/render integration without an artificial beat clock.
      canvas.dataset.audioBass = features.bass.toFixed(3);
      canvas.dataset.audioPulse = features.pulse.toFixed(3);
      canvas.dataset.audioEnergy = features.energy.toFixed(3);
      canvas.dataset.audioMid = features.mid.toFixed(3);
      canvas.dataset.audioTreble = features.treble.toFixed(3);
      canvas.dataset.spectrumPeak = Math.max(...spectrumHistory).toFixed(3);
    };

    const drawFallback = (s: VisualizerSettings) => {
      const ctx = fallbackContext;
      if (!ctx) return;
      const unit = Math.min(width, height) * .5;
      const drive = s.reactive ? (.45 + s.intensity * .9) * (reducedMotion ? .15 : 1) : 0;
      const bass = visualFeatures.bass * drive;
      const mid = visualFeatures.mid * drive;
      const high = visualFeatures.treble * drive;
      const pulse = visualFeatures.pulse * drive;
      ctx.fillStyle = '#101014';
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2 + smoothX * unit * .04, height / 2 + smoothY * unit * .04);
      ctx.rotate((s.scene === 'currents' ? -.36 + Math.sin(elapsed * .12) * .15 : s.scene === 'scope' ? -.12 : elapsed * .045) + mid * .12);
      ctx.scale(1 + bass * .13 + pulse * .07, 1 + bass * .13 + pulse * .07);
      const hues = s.palette === 'solar' ? [16, 32, 275, 258] : s.palette === 'acid' ? [78, 100, 155, 245] : [220, 192, 278, 250];
      const count = Math.round(20 + clamp(s.detail) * 26);
      ctx.lineWidth = Math.max(1.2, unit / 155);
      ctx.shadowBlur = unit * .012;
      const spectrumAt = (position: number) => {
        const sample = (x: number) => {
          const bin = clamp(x) * 127;
          const left = Math.floor(bin);
          return spectrumHistory[left] * (1 - (bin - left)) + spectrumHistory[Math.min(127, left + 1)] * (bin - left);
        };
        return (sample(position) * .34 + sample(position - .024) * .23 + sample(position + .024) * .23
          + sample(position - .05) * .1 + sample(position + .05) * .1) * drive;
      };
      for (let i = 0; i < count; i++) {
        const f = i / count;
        ctx.strokeStyle = s.palette === 'custom' ? s.customColors[Math.min(3, Math.floor(f * 4))] : `hsla(${hues[Math.min(3, Math.floor(f * 4))]}, 75%, ${44 + Math.sin(f * Math.PI) * 24}%, ${.40 + clamp(s.intensity) * .45})`;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.beginPath();
        for (let j = 0; j <= 240; j++) {
          const a = j / 240 * Math.PI * 2;
          let r = (.12 + f * .66 + bass * .045) * unit;
          let x: number;
          let y: number;
          if (s.scene === 'scope') {
            x = (j / 240 * 2 - 1) * unit * 1.1;
            const waveIndex = Math.min(127, Math.floor(j / 240 * 127));
            const spectralWave = spectrumAt(j / 240);
            y = Math.sin(x / unit * (3.4 + mid) - elapsed * .65) * unit * (.12 + bass * .12)
              + (spectrum[waveIndex * 4 + 1] / 255 * 2 - 1) * unit * .55 * drive
              + (f - .5) * unit * (.65 + bass * .2 + spectralWave * .32) * Math.sqrt(Math.max(0, 1 - (x / unit / 1.1) ** 2))
              + spectralWave * unit * .18 * Math.sin(x / unit * 2 + elapsed * .12);
          } else {
            const spectralFold = spectrumAt(.5 + .46 * Math.cos(a + f * .7));
            const spectralCurl = spectrumAt(.5 + .46 * Math.sin(a - f * .8));
            if (s.scene === 'bloom') r *= 1 + (Math.sin(a * 5 + f * (3 + mid) - elapsed * .24) * .72 + Math.sin(a * 3 - f * 2 + elapsed * .16) * .28) * (.22 + bass * .065);
            else if (s.scene === 'tunnel') r = Math.pow(1.03 - ((f + elapsed * .025) % 1), 1.8) * unit * 2.1;
            else r += Math.sin(a * 3 + f * 3.5 + elapsed * .23) * unit * (.08 + bass * .035 + pulse * .025);
            r += (spectralFold * .20 - spectralCurl * .07) * unit * Math.min(1, f * 3);
            r += Math.sin(a * 9 + f * 7 - elapsed * .6) * unit * high * .006;
            const angle = a + Math.sin(f * 4 + elapsed * .18) * (.12 + mid * .12 + spectralCurl * .13);
            x = Math.cos(angle) * r * (s.scene === 'currents' ? 1.12 : 1);
            y = Math.sin(angle) * r * (s.scene === 'currents' ? .89 : 1);
          }
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    };

    const draw = (now: number) => {
      if (disposed || document.hidden) return;
      const dt = lastTime ? Math.min((now - lastTime) / 1000, .05) : 1 / 60;
      lastTime = now;
      const s = latest.current.settings;
      const drawSignature = `${s.scene}:${s.palette}:${s.customColors.join()}:${s.intensity}:${s.detail}:${s.grain}:${s.reactive}:${width}:${height}:${reducedMotion}`;
      // Keep the last rendered pixels intact while frozen, including the film grain.
      // Explicit appearance edits and resizes may still redraw the frozen time sample.
      if (s.frozen && lastDrawSignature === drawSignature) {
        frame = requestAnimationFrame(draw);
        return;
      }
      if (!s.frozen) {
        sampleAudio(dt);
        const musicLed = s.reactive && latest.current.playing && !!latest.current.analyser;
        if (!reducedMotion) elapsed += dt * (clamp(s.speed, 0, 2) * (musicLed ? .10 : .75)
          + (visualFeatures.energy * 1.5 + visualFeatures.pulse * .80 + visualFeatures.flux * .80) * clamp(s.intensity));
        smoothX += (pointerX - smoothX) * (1 - Math.exp(-dt * 3));
        smoothY += (pointerY - smoothY) * (1 - Math.exp(-dt * 3));
      }
      const renderedMotion = s.reactive ? (reducedMotion ? .15 : 1) : 0;
      canvas.dataset.visualBass = (visualFeatures.bass * renderedMotion).toFixed(3);
      canvas.dataset.visualMid = (visualFeatures.mid * renderedMotion).toFixed(3);
      canvas.dataset.visualTreble = (visualFeatures.treble * renderedMotion).toFixed(3);
      canvas.dataset.visualEnergy = (visualFeatures.energy * renderedMotion).toFixed(3);
      canvas.dataset.visualPulse = (visualFeatures.pulse * renderedMotion).toFixed(3);
      canvas.dataset.visualPhase = elapsed.toFixed(3);
      if (gl && program && !gl.isContextLost()) {
        gl.uniform2f(uniforms.uResolution, width, height);
        gl.uniform2f(uniforms.uPointer, reducedMotion ? 0 : smoothX, reducedMotion ? 0 : smoothY);
        gl.uniform1f(uniforms.uTime, elapsed);
        const motion = s.reactive ? (reducedMotion ? .15 : 1) : 0;
        gl.uniform3f(uniforms.uAudio, visualFeatures.bass * motion, visualFeatures.mid * motion, visualFeatures.treble * motion);
        gl.uniform4f(uniforms.uDynamics, visualFeatures.energy * motion, visualFeatures.pulse * motion, visualFeatures.flux * motion, visualFeatures.crest * motion);
        gl.uniform1f(uniforms.uMotion, motion);
        gl.uniform1f(uniforms.uIntensity, clamp(s.intensity));
        gl.uniform1f(uniforms.uDetail, clamp(s.detail));
        gl.uniform1f(uniforms.uGrain, clamp(s.grain));
        gl.uniform1i(uniforms.uScene, sceneIds[s.scene]);
        gl.uniform1i(uniforms.uPalette, paletteIds[s.palette]);
        s.customColors.forEach((color, i) => {
          const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);
          gl.uniform3f(uniforms[`uCustom${i}`], rgb[0], rgb[1], rgb[2]);
        });
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 1, gl.RGBA, gl.UNSIGNED_BYTE, spectrum);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } else drawFallback(s);
      lastDrawSignature = drawSignature;
      frame = requestAnimationFrame(draw);
    };
    const move = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerX = ((event.clientX - rect.left) / Math.max(1, rect.width) - .5) * 2;
      pointerY = -((event.clientY - rect.top) / Math.max(1, rect.height) - .5) * 2;
    };
    const leave = () => { pointerX = 0; pointerY = 0; };
    const visibility = () => {
      cancelAnimationFrame(frame);
      lastTime = 0;
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    const motion = (event: MediaQueryListEvent) => { reducedMotion = event.matches; };
    const lost = (event: Event) => {
      event.preventDefault();
      program = null;
      enableFallback();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('webglcontextlost', lost);
    document.addEventListener('visibilitychange', visibility);
    motionQuery.addEventListener('change', motion);
    frame = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('webglcontextlost', lost);
      document.removeEventListener('visibilitychange', visibility);
      motionQuery.removeEventListener('change', motion);
      if (audioSource && visualAnalyser) audioSource.disconnect(visualAnalyser);
      visualAnalyser?.disconnect();
      if (gl) {
        if (texture) gl.deleteTexture(texture);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        if (vertex) gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
      }
      fallback?.remove();
      if (canvasRef && (canvasRef.current === canvas || canvasRef.current === fallback)) canvasRef.current = null;
    };
  }, [canvasRef]);

  return <canvas ref={localRef} className="visualizer-canvas" role="img" aria-label={`${settings.scene} visualizer in the ${settings.palette} palette${playing && settings.reactive ? ', responding to your audio' : ', ambient motion'}${settings.frozen ? ', frozen' : ''}`} />;
}
