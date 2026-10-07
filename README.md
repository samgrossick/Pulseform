# Pulseform

A static, browser-only psychedelic music studio. Built with React, TypeScript, Web Audio, WebGL and an Astra-authored visual engine.

- Import local MP3, WAV, FLAC, OGG, M4A and other formats supported by your browser.
- Four interactive scenes: Currents, Bloom, Afterhours and Oscilloscope. Three preset palettes plus four custom colours, intensity, motion, detail, grain, freeze, image capture and fullscreen. Live frequency detail shapes every scene, with fast musical attacks, smooth decay and preserved quiet/loud contrast. Seeking refreshes analysis history for the new passage.
- Seven-band EQ, playback, seeking, master volume and looping.
- Quick split creates approximate vocals/lead, drums, bass and other layers without a model download. Optional HTDemucs AI stems offer cleaner separation. Both run in dedicated browser workers, with level, mute and solo controls.
- An original synth demo with its actual source tracks lets you explore immediately. Its Vocals channel contains the synth lead.
- Desktop studio layout and a responsive mobile layout. Visual preferences are stored locally.

## Run locally

Requires Node 22.12+.

```sh
npm ci
npm run prepare:model
npm run dev
```

The model preparation downloads approximately 172 MiB once into `.cache/`, verifies its pinned SHA-256 and creates eight model chunks under `public/models/demucs/`. Both the cache and generated model chunks are ignored by Git. The preparation script is also run automatically during production builds. Fonts are checked in and self-hosted.

Open the URL printed by Vite. Choose a file or select **Try the demo**. Open **Sound** for EQ and stems. Space plays/pauses when a form control is not focused; F enters fullscreen.

## Cloudflare Pages Free

This app is entirely static. It requires no Pages Functions, Workers, R2, database, authentication or music API. Audio files never leave the user's browser. The app and separation model are served from the same Pages deployment.

For Cloudflare Pages Git integration, use:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 22 or later (`NODE_VERSION=22`) |

```sh
npm run build
```

The build automatically prepares the model, builds the app and checks every emitted asset against Pages Free's **25 MiB per file** and **20,000 files** limits. The model is split into **24 MiB** chunks and reconstructed with integrity checks inside the separation worker. The ONNX WASM runtime is approximately 14 MiB. `public/_headers` provides cross-origin isolation and immutable caching for hashed assets.

For a direct upload, after authenticating Wrangler to your Cloudflare account:

```sh
npx wrangler pages deploy dist --project-name pulseform
```

The initial Pages build needs internet access to download the pinned model. Subsequent local builds reuse prepared chunks. Do not upload the original `.onnx` file to Pages; the build only includes the smaller chunks.

Reference: [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/).

## Stem separation and privacy

**Quick split** is the default. It uses complementary spectral masks based on sustained versus transient sound, bass frequency and stereo centre position. It runs locally without any model or network request, and the layers sum back to the original at unity gain. These are rough remix layers: the vocals channel includes centred instruments, and drum/bass layers have bleed. This is not AI instrument isolation.

Select **AI stems** and **Separate AI stems** for the slower, cleaner option. The browser fetches the model chunks from this app's own origin and caches them locally where storage is available. Your audio is decoded at 44.1 kHz and transferred only to an in-browser worker. No audio upload, inference service, API key or per-track fee is involved.

AI separation can take several minutes, uses substantial RAM and works best in current desktop Chrome or Edge. Cancelling terminates the worker. For browser memory, AI separation accepts tracks up to 10 minutes; playback, EQ and visuals support longer tracks within available memory. Mobile devices may not have enough RAM for the model. AI stems can contain bleed and artefacts. The app surfaces download and inference errors and leaves the original track available.

There is no YouTube, Spotify or Apple Music integration in this local-files version. Browser storage caches the model and preferences; this release is not an installable PWA and does not guarantee offline app loading.

## Verification

```sh
npm test
```

With the dev server running, Chrome installed and Playwright dependencies installed:

```sh
node scripts/browser-check.mjs
node scripts/quick-check.mjs
node scripts/reactivity-check.mjs
```

The quick check times a three-minute synthetic stereo file and checks cancellation, no model download and solo/mute playback. The reactivity check compares actual rendered frames and visual envelopes while seeking between bass, mid, treble, quiet and silent sections. Set `PULSEFORM_TEST_STEMS=1` to additionally exercise real model inference on an original two-second synthetic WAV. Set `PULSEFORM_TEST_URL` to check a production preview instead. Screenshots are written to `.cache/`.

## Credits

The visual engine was implemented by Astra. The demo is original procedurally generated audio. Separation uses [Demucs Web](https://github.com/timcsy/demucs-web), the [HTDemucs ONNX export](https://huggingface.co/timcsy/demucs-web-onnx) and [ONNX Runtime Web](https://github.com/microsoft/onnxruntime). The original [Demucs](https://github.com/facebookresearch/demucs) licence accompanies the model in `public/models/demucs/LICENSE.txt`. Space Grotesk and IBM Plex Mono are distributed under their included SIL Open Font Licences. Interface icons come from Phosphor.

