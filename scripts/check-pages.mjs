import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const maxBytes = 25 * 1024 * 1024;
let count = 0; let largest = { file: '', bytes: 0 }; let total = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await scan(file); continue; }
    const { size } = await stat(file); count++; total += size;
    if (size > maxBytes) throw new Error(`Pages asset exceeds 25 MiB: ${file} (${size} bytes)`);
    if (size > largest.bytes) largest = { file: path.relative(dist, file), bytes: size };
  }
}
await scan(dist);
if (count > 20000) throw new Error(`Pages Free supports 20,000 files; found ${count}.`);
await readFile(path.join(dist, 'models/demucs/manifest.json'));
console.log(`Cloudflare Pages Free check passed: ${count} files; ${(total / 1048576).toFixed(1)} MiB total. Largest asset: ${(largest.bytes / 1048576).toFixed(1)} MiB (${largest.file}). No Functions required.`);
