import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

await mkdir('.cache', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
// Hold only the shader's ambient phase during this test. Pixel differences must
// come from the music, not from time passing or reanchoring after a seek.
await page.addInitScript(() => {
  const names = new WeakMap();
  const getLocation = WebGLRenderingContext.prototype.getUniformLocation;
  WebGLRenderingContext.prototype.getUniformLocation = function (program, name) {
    const location = getLocation.call(this, program, name);
    if (location) names.set(location, name);
    return location;
  };
  const uniform = WebGLRenderingContext.prototype.uniform1f;
  WebGLRenderingContext.prototype.uniform1f = function (location, value) {
    return uniform.call(this, location, names.get(location) === 'uTime' ? 0 : value);
  };
  const uniform3 = WebGLRenderingContext.prototype.uniform3f;
  WebGLRenderingContext.prototype.uniform3f = function (location, x, y, z) {
    return window.__holdBroad && names.get(location) === 'uAudio'
      ? uniform3.call(this, location, .3, .3, .3) : uniform3.call(this, location, x, y, z);
  };
  const uniform4 = WebGLRenderingContext.prototype.uniform4f;
  WebGLRenderingContext.prototype.uniform4f = function (location, x, y, z, w) {
    return window.__holdBroad && names.get(location) === 'uDynamics'
      ? uniform4.call(this, location, .3, 0, 0, 0) : uniform4.call(this, location, x, y, z, w);
  };
});
const rate = 44100, samples = rate * 18;
const wav = Buffer.alloc(44 + samples * 4);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(samples * 4, 40);
// Equal-level bands, then a quiet repeat and silence. Synthetic audio makes
// the expected response unambiguous instead of trusting a nonzero analyser.
for (let i = 0; i < samples; i++) {
  const t = i / rate, section = Math.floor(t / 3);
  const hz = [80, 1000, 7000, 80, 80, 80][section];
  const level = section === 5 ? .4 * Math.exp(-((t - 15) % .5) * 20) : [.4, .4, .4, .025, 0][section];
  const value = Math.round(Math.sin(2 * Math.PI * hz * t) * level * 32767);
  wav.writeInt16LE(value, 44 + i * 4); wav.writeInt16LE(value, 46 + i * 4);
}
try {
  await page.goto(process.env.PULSEFORM_TEST_URL || 'http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Reset visuals', exact: true }).click();
  await page.getByLabel('Choose local audio file').setInputFiles({ name: 'reactivity-sections.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.getByText('reactivity-sections', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const canvas = page.locator('canvas').first();
  const seek = page.getByRole('slider', { name: 'Seek track', exact: true });
  const features = () => canvas.evaluate(el => ({
    bass: Number(el.dataset.visualBass), mid: Number(el.dataset.visualMid), treble: Number(el.dataset.visualTreble),
    energy: Number(el.dataset.visualEnergy), pulse: Number(el.dataset.visualPulse),
  }));
  const pixels = () => canvas.evaluate(el => {
    const gl = el.getContext('webgl');
    if (!gl || document.querySelectorAll('canvas').length !== 1) throw new Error('Shader failed: rendering fell back to 2D.');
    const data = new Uint8Array(el.width * el.height * 4);
    gl.readPixels(0, 0, el.width, el.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    // Sample RGB across the canvas; per-cell averages would cancel displaced
    // bright/dark filaments and miss real changes in contour geometry.
    const fingerprint = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      const index = (Math.floor((y + .5) * el.height / 32) * el.width + Math.floor((x + .5) * el.width / 64)) * 4;
      fingerprint.push(data[index], data[index + 1], data[index + 2]);
    }
    return fingerprint;
  });
  for (const scene of ['Currents', 'Bloom', 'Afterhours', 'Oscilloscope']) {
    await page.getByRole('button', { name: new RegExp(`^${scene}`) }).click();
    // Also hold broad envelopes: every scene must actually use the detailed
    // spectrum, rather than merely scaling a fixed shape with three levels.
    await page.evaluate(() => { window.__holdBroad = true; });
    const images = [];
    for (const [position, dominant] of [[.5, 'bass'], [3.5, 'mid'], [6.5, 'treble']]) {
      await seek.fill(String(position));
      await page.waitForTimeout(250);
      const state = await features();
      expect(state[dominant]).toBeGreaterThan(.45);
      for (const band of ['bass', 'mid', 'treble'].filter(band => band !== dominant)) expect(state[band]).toBeLessThan(.12);
      expect(state.pulse).toBeLessThan(.05);
      images.push(await pixels());
    }
    for (let i = 1; i < images.length; i++) {
      const difference = images[i].reduce((sum, value, cell) => sum + Math.abs(value - images[0][cell]), 0) / images[i].length;
      expect(difference).toBeGreaterThan(3);
    }
    await page.evaluate(() => { window.__holdBroad = false; });
    await seek.fill('0.5'); await page.waitForTimeout(250);
    const loud = await features();
    await seek.fill('9.5'); await page.waitForTimeout(250);
    const quiet = await features();
    expect(loud.bass).toBeGreaterThan(quiet.bass * 2);
    expect(loud.energy).toBeGreaterThan(quiet.energy * 2);
    await seek.fill('12.5'); await page.waitForTimeout(250);
    expect((await features()).energy).toBeLessThan(.01);
    expect((await features()).bass).toBeLessThan(.01);
    await canvas.screenshot({ path: `.cache/reactivity-${scene.toLowerCase()}.png` });
    await seek.fill('15.2');
    await expect.poll(async () => (await features()).pulse, { timeout: 1500, intervals: [20] }).toBeGreaterThan(.3);
    console.log(`${scene}: distinct rendered band shapes, loud/quiet contrast, real beat response and clean seeks passed.`);
  }
  expect(errors).toEqual([]);
} finally { await browser.close(); }
