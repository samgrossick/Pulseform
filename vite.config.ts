import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// All app and model assets are same-origin. Isolation is safe for local audio.
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
export default defineConfig({ plugins: [react()], server: { headers }, preview: { headers } });
