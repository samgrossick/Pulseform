import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const packages = ['react', 'react-dom', '@phosphor-icons/react', 'demucs-web', 'onnxruntime-web', 'onnxruntime-common', 'flatbuffers', 'long', 'platform', 'protobufjs'];
let notices = 'Pulseform third-party notices\n\nFonts and the HTDemucs model have additional licence files alongside their static assets.\n';
for (const name of packages) {
  const folder = path.join(root, 'node_modules', name);
  let licence;
  for (const candidate of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENSE-MIT', 'LICENSE-MIT.txt', 'license']) {
    try { licence = await readFile(path.join(folder, candidate), 'utf8'); break; } catch { /* Try common licence filename conventions. */ }
  }
  if (!licence && name.startsWith('onnxruntime-')) licence = await readFile(path.join(root, 'public/licenses/ONNX-Runtime-LICENSE.txt'), 'utf8');
  if (!licence) throw new Error(`Missing third-party licence for ${name}`);
  notices += `\n${'='.repeat(72)}\n${name}\n${'='.repeat(72)}\n\n${licence}\n`;
}
await writeFile(path.join(root, 'public/THIRD_PARTY_NOTICES.txt'), notices);
console.log('Third-party licences prepared.');
