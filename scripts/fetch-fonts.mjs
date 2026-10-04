import { mkdir, writeFile } from 'node:fs/promises';
const fonts = new URL('../public/fonts/', import.meta.url);
await mkdir(fonts, { recursive: true });
const files = [
  ['space-grotesk.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf'],
  ['ibm-plex-mono.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-Regular.ttf'],
  ['Space-Grotesk-OFL.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/OFL.txt'],
  ['IBM-Plex-Mono-OFL.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/OFL.txt'],
];
for (const [name, url] of files) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font download failed: ${name}`);
  await writeFile(new URL(name, fonts), new Uint8Array(await response.arrayBuffer()));
  console.log(`Saved ${name}`);
}
