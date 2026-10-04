import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'public/models/demucs');
const cacheFile = path.join(root, '.cache/htdemucs_embedded.onnx');
const source = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
const chunkSize = 24 * 1024 * 1024;
const expectedHash = 'e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077';
const digest = data => createHash('sha256').update(data).digest('hex');

async function prepared() {
  try {
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    if (manifest.version !== 1 || manifest.sha256 !== expectedHash || !manifest.chunks?.length) return false;
    for (const chunk of manifest.chunks) {
      const data = await readFile(path.join(output, chunk.file));
      if (data.length !== chunk.bytes || data.length > chunkSize || digest(data) !== chunk.sha256) return false;
    }
    return true;
  } catch { return false; }
}
if (await prepared()) {
  console.log('Pages-ready model chunks verified.');
} else {
  await mkdir(output, { recursive: true });
  await mkdir(path.dirname(cacheFile), { recursive: true });
  let data;
  try { data = await readFile(cacheFile); } catch {
    console.log('Downloading the separation model for static hosting (about 172 MB)…');
    const response = await fetch(source, { signal: AbortSignal.timeout(240000) });
    if (!response.ok) throw new Error(`Model download failed: ${response.status}. Retry npm run prepare:model.`);
    data = Buffer.from(await response.arrayBuffer());
    if (data.length < 100 * 1024 * 1024) throw new Error('The downloaded model is incomplete.');
    await writeFile(cacheFile, data);
  }
  const sha256 = digest(data);
  if (sha256 !== expectedHash) throw new Error('Unexpected model checksum. Remove .cache/htdemucs_embedded.onnx and retry; do not deploy unverified weights.');
  const chunks = [];
  for (let offset = 0, i = 0; offset < data.length; offset += chunkSize, i++) {
    const chunk = data.subarray(offset, offset + chunkSize);
    const file = `htdemucs-${sha256.slice(0, 12)}-${String(i).padStart(2, '0')}.bin`;
    await writeFile(path.join(output, file), chunk);
    chunks.push({ file, bytes: chunk.length, sha256: digest(chunk) });
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ version: 1, model: 'htdemucs', sampleRate: 44100, bytes: data.length, sha256, chunks }, null, 2));
  console.log(`Prepared ${chunks.length} model chunks, each at most 24 MiB (${(data.length / 1048576).toFixed(1)} MiB total).`);
}
