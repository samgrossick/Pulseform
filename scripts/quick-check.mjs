import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const requests = [], errors = [];
page.on('request', request => { if (/models\/demucs|ort-wasm/.test(request.url())) requests.push(request.url()); });
page.on('pageerror', error => errors.push(error.message));
const rate = 44100, samples = rate * 180;
const wav = Buffer.alloc(44 + samples * 4);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(samples * 4, 40);
for (let i = 0; i < samples; i++) {
  const t = i / rate;
  const bass = Math.sin(2 * Math.PI * 80 * t) * .2;
  const lead = Math.sin(2 * Math.PI * 900 * t) * .1;
  const beat = Math.sin(2 * Math.PI * 3400 * t) * Math.exp(-(t % .5) * 60) * .18;
  wav.writeInt16LE(Math.round((bass + lead + beat) * 25000), 44 + i * 4);
  wav.writeInt16LE(Math.round((bass + lead - beat) * 25000), 46 + i * 4);
}
try {
  await page.goto(process.env.PULSEFORM_TEST_URL || 'http://127.0.0.1:5173');
  await page.getByLabel('Choose local audio file').setInputFiles({ name: 'three-minute-check.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.getByText('three-minute-check', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Sound', exact: true }).click();
  await page.getByRole('button', { name: /^AI stems/ }).click();
  await expect(page.getByRole('button', { name: 'Separate AI stems', exact: true })).toBeVisible();
  await page.locator('.separation-modes button').first().click();
  // Cancellation remains responsive because the work stays in its own worker.
  await page.getByRole('button', { name: 'Quick split', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel separation' }).click();
  await expect(page.getByRole('button', { name: 'Quick split', exact: true })).toBeVisible();
  const started = performance.now();
  await page.getByRole('button', { name: 'Quick split', exact: true }).click();
  await expect(page.getByText('Quick layers ready.', { exact: false }).last()).toBeVisible({ timeout: 30000 });
  console.log(`Three-minute stereo quick split: ${((performance.now() - started) / 1000).toFixed(2)} seconds.`);
  expect(requests).toEqual([]);
  await expect(page.getByRole('slider', { name: 'vocals level', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Solo vocals', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('canvas').first().getAttribute('data-audio-energy'))).toBeGreaterThan(.1);
  await expect(page.getByText('3:00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mute vocals', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('canvas').first().getAttribute('data-audio-energy'))).toBeLessThan(.01);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '.cache/quick-split.png', fullPage: true });
  console.log('Cancellation, no model download, full duration, solo playback and mute passed.');
} finally { await browser.close(); }

