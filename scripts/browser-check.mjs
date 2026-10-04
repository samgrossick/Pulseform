import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('.cache', { recursive: true });
const baseURL = process.env.PULSEFORM_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR:', error.message); });
page.on('response', response => { if (response.status() >= 400) console.log('HTTP:', response.status(), response.url()); });
page.on('console', message => { if (message.type() === 'error') console.log('CONSOLE:', message.text()); });
await page.addInitScript(() => {
  window.__eqFilters = [];
  const create = AudioContext.prototype.createBiquadFilter;
  AudioContext.prototype.createBiquadFilter = function () {
    const node = create.call(this); window.__eqFilters.push(node); return node;
  };
});
async function dragRange(locator, fraction, vertical = false) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(vertical ? box.x + box.width / 2 : box.x + box.width * fraction,
    vertical ? box.y + box.height * (1 - fraction) : box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}
try {
  await page.goto(baseURL);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  await expect(page.getByRole('heading', { name: 'See your sound.' })).toBeVisible();
  await page.screenshot({ path: '.cache/desktop.png', fullPage: true });
  expect(await page.locator('.control-panel').evaluate(el => getComputedStyle(el).overflowY)).toBe('visible');
  console.log('Desktop loaded without a sidebar scrollbar.');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(page.getByText('A little further', { exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.locator('canvas').first().getAttribute('data-audio-energy'))).toBeGreaterThan(0.1);
  await page.getByRole('switch', { name: 'Audio reactive visuals' }).click();
  await expect.poll(async () => Number(await page.locator('canvas').first().getAttribute('data-audio-energy'))).toBe(0);
  await page.getByRole('switch', { name: 'Audio reactive visuals' }).click();
  await expect.poll(async () => Number(await page.locator('canvas').first().getAttribute('data-audio-energy'))).toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Freeze visuals' }).click();
  await page.waitForTimeout(100);
  const frame = await page.locator('canvas').first().evaluate(canvas => canvas.toDataURL());
  await page.waitForTimeout(300);
  const secondFrame = await page.locator('canvas').first().evaluate(canvas => canvas.toDataURL());
  if (frame !== secondFrame) throw new Error('Freeze failed: rendered frame changed.');
  await page.getByRole('button', { name: 'Unfreeze visuals' }).click();
  for (const scene of ['Bloom', 'Afterhours', 'Oscilloscope', 'Currents']) {
    await page.getByRole('button', { name: new RegExp(`^${scene}`) }).click();
    await page.waitForTimeout(150);
    const image = await page.locator('canvas').first().evaluate(canvas => canvas.toDataURL());
    if (image === frame) throw new Error(`Scene ${scene} did not change the frame.`);
  }
  const volume = page.getByRole('slider', { name: 'Master volume', exact: true });
  await dragRange(volume, 0.25);
  const level = Number(await volume.inputValue());
  expect(level).toBeLessThan(0.4);
  expect(await volume.evaluate(el => el.style.getPropertyValue('--fill'))).toBe(`${level * 100}%`);
  await expect(page.getByLabel('Volume percentage')).toHaveText(`${Math.round(level * 100)}%`);
  await volume.fill('0.75');
  await page.getByRole('tab', { name: 'Sound', exact: true }).click();
  const bassEQ = page.getByRole('slider', { name: 'EQ 60 Hz', exact: true });
  await dragRange(bassEQ, 0.85, true);
  expect(Number(await bassEQ.inputValue())).toBeGreaterThan(5);
  await expect.poll(() => page.evaluate(() => window.__eqFilters[0].gain.value)).toBeGreaterThan(5);
  const boost = await page.evaluate(() => {
    const magnitude = new Float32Array(1); window.__eqFilters[0].getFrequencyResponse(new Float32Array([40]), magnitude, new Float32Array(1)); return magnitude[0];
  });
  await dragRange(bassEQ, 0.15, true);
  expect(Number(await bassEQ.inputValue())).toBeLessThan(-5);
  await expect.poll(() => page.evaluate(() => window.__eqFilters[0].gain.value)).toBeLessThan(-5);
  const cut = await page.evaluate(() => {
    const magnitude = new Float32Array(1); window.__eqFilters[0].getFrequencyResponse(new Float32Array([40]), magnitude, new Float32Array(1)); return magnitude[0];
  });
  expect(boost).toBeGreaterThan(cut * 2);
  await page.getByRole('slider', { name: 'bass level', exact: true }).fill('0.3');
  expect(await page.getByRole('slider', { name: 'bass level', exact: true }).evaluate(el => el.style.getPropertyValue('--fill'))).toBe('20%');
  await page.getByRole('button', { name: 'Warm', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'EQ 60 Hz', exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Solo bass', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Solo bass', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Mute bass', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute bass', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reset sound' }).click();
  await expect(page.getByRole('slider', { name: 'EQ 60 Hz', exact: true })).toHaveValue('0');
  await page.screenshot({ path: '.cache/sound.png', fullPage: true });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const seek = page.getByRole('slider', { name: 'Seek track', exact: true });
  const waveform = page.locator('.waveform-track');
  await waveform.scrollIntoViewIfNeeded();
  const waveBox = await waveform.boundingBox();
  expect((await seek.boundingBox()).height).toBe(waveBox.height);
  for (const yFraction of [.15, .5, .85]) {
    await seek.fill('0');
    await page.mouse.click(waveBox.x + waveBox.width * .6, waveBox.y + waveBox.height * yFraction);
    expect(Number(await seek.inputValue())).toBeGreaterThan(18);
    expect(Number(await seek.inputValue())).toBeLessThan(21);
  }
  await page.mouse.move(waveBox.x + waveBox.width * .6, waveBox.y + waveBox.height * .85);
  await page.mouse.down();
  await page.mouse.move(waveBox.x + waveBox.width * .25, waveBox.y + waveBox.height * .85, { steps: 10 });
  await page.mouse.up();
  expect(Number(await seek.inputValue())).toBeGreaterThan(7);
  expect(Number(await seek.inputValue())).toBeLessThan(9);
  console.log('Waveform seeks at top, middle and bottom, including dragging.');
  await page.getByRole('slider', { name: 'Seek track', exact: true }).fill('16');
  await expect(page.getByText('0:16', { exact: true })).toBeVisible();
  console.log('Demo, transport, freeze, scenes, EQ and stem controls passed.');
  await page.getByRole('tab', { name: 'Visuals', exact: true }).click();
  await page.getByRole('button', { name: 'Your colours', exact: true }).click();
  await page.getByRole('button', { name: 'Freeze visuals' }).click();
  await page.waitForTimeout(100);
  const beforeColour = await page.locator('canvas').first().evaluate(el => el.toDataURL());
  await page.getByLabel('Custom colour 1', { exact: true }).fill('#00ffcc');
  await page.waitForTimeout(100);
  expect(await page.locator('canvas').first().evaluate(el => el.toDataURL())).not.toBe(beforeColour);
  await page.reload();
  await expect(page.getByLabel('Custom colour 1', { exact: true })).toHaveValue('#00ffcc');
  await expect(page.getByRole('button', { name: 'Your colours', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Solar flare', exact: true }).click();
  console.log('Pointer EQ, real filter response, volume/stem fills and persistent custom colours passed.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.cache/mobile.png', fullPage: true });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (mobileOverflow) throw new Error('Mobile layout overflows horizontally.');
  await expect(page.getByRole('button', { name: 'Open audio' })).toBeVisible();
  console.log('Mobile layout passed.');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: '.cache/laptop.png', fullPage: true });
  const transportFits = await page.locator('.transport').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight);
  if (!transportFits) throw new Error('Laptop transport controls fall below the viewport.');
  console.log('Laptop transport fits the viewport.');
  if (process.env.PULSEFORM_TEST_STEMS === '1') {
    console.log('Resizing for AI check.');
    await page.setViewportSize({ width: 1440, height: 1050 });
    // Two seconds of original synthetic audio: validates real model inference,
    // worker assets, import decoding and stem buffer installation end-to-end.
    const rate = 44100; const samples = rate * 2; const wav = Buffer.alloc(44 + samples * 4);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples * 4, 40);
    for (let i = 0; i < samples; i++) { const v = Math.round(Math.sin(2 * Math.PI * 110 * i / rate) * 7000); wav.writeInt16LE(v, 44 + i * 4); wav.writeInt16LE(v, 46 + i * 4); }
    console.log('Uploading fixture to local file input.');
    await page.getByLabel('Choose local audio file').setInputFiles({ name: 'separation-check.wav', mimeType: 'audio/wav', buffer: wav }, { timeout: 30000 });
    await expect(page.getByText('separation-check', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Sound', exact: true }).click();
    console.log('Imported test audio. Starting real stem separation.');
    await page.getByRole('button', { name: /^AI stems/ }).click();
    await page.getByRole('button', { name: 'Separate AI stems', exact: true }).click();
    const status = setInterval(async () => { try { console.log('Stem status:', await page.locator('.separation-status').innerText()); } catch { /* Completed. */ } }, 25000);
    try {
      await expect(page.getByText('AI stems ready.', { exact: false })).toBeVisible({ timeout: 600000 });
      await expect(page.getByRole('button', { name: 'Solo vocals', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      console.log('Real local-file AI separation passed.');
    } finally { clearInterval(status); }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Browser verification passed.');
} finally { await browser.close(); }
