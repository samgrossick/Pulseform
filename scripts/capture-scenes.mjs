import { chromium } from '@playwright/test';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('.cache/previews', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  await page.goto('http://127.0.0.1:5173');
  await page.addStyleTag({ content: '.visual-stage{width:480px!important;height:320px!important}.stage-top,.stage-bottom,.stage-welcome{display:none!important}' });
  const scenes = [['currents', 'Currents'], ['bloom', 'Bloom'], ['tunnel', 'Afterhours'], ['scope', 'Oscilloscope']];
  for (const [id, name] of scenes) {
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await page.waitForTimeout(800);
    await page.locator('canvas').first().screenshot({ path: `.cache/previews/${id}.png` });
  }
} finally { await browser.close(); }
await mkdir('public/previews', { recursive: true });
for (const id of ['currents', 'bloom', 'tunnel', 'scope']) await copyFile(`.cache/previews/${id}.png`, `public/previews/${id}.png`);
console.log('Captured four real visualiser scene previews.');
