# Pulseform design direction

A listening room around a living, psychedelic canvas. The interface feels precise; the artwork feels fluid. The canvas is the main working surface, with transport directly underneath and a quiet control rail beside it.

## Interface

The redesign uses the audit and theme guidance in [Taste Skill](https://github.com/Leonxlnx/taste-skill), especially its existing-project redesign skill.

- Graphite background `#111113`, raised player surface `#1c1c20`, dividers `#333338`.
- Warm coral `#ed8e7a` is the sole interface accent: primary actions, active controls, played waveform and focus.
- Off-white text `#f0edf0`; muted labels remain readable against the graphite base.
- Space Grotesk for the interface; IBM Plex Mono for time, numeric values and secondary metadata. Both are self-hosted.
- Canvas corners 16px; transport 12px; controls and scene previews 8px. Circular shapes identify playback and small selectors.
- Flat control groups, thin separators, restrained surfaces, clear hover, press and keyboard focus states.
- Saturated colours belong to the artwork and palette swatches. Avoid green-tinted neutrals or unrelated interface accents.

## Motion

Art direction: dreamy liquid-colour ribbons, organic deformation and slow continuous drift. The music should visibly shape the field without abrupt zooms, phase jumps or flashing.

- Bass guides broad swells and flowing deformation.
- Mids bend and advect the ribbons.
- Highs add restrained shimmer and texture.
- Attacks register within tens of milliseconds; short smooth releases retain fluid motion without smearing beats. Fixed loudness references preserve quiet/loud contrast.
- Every scene uses spatial frequency detail to change shape. During playback, music drives flow more strongly than the ambient clock. Seeking clears old envelopes and primes the new passage without inventing a beat.
- Silence decays to ambient flow. Disabling music response removes audio modulation. Freeze stops motion completely.
- Pointer movement gently bends the field. Reduced-motion preferences suppress continuous motion.

## Layout and verification

Desktop: large canvas and a right control rail that flows with the page, without an inner scrollbar. Transport stays visible on a 1366 × 768 laptop. Mobile: canvas and transport first, with controls below. No horizontal overflow.

Keep local-file playback, EQ, stems and model caching functional through visual changes. Verify real audio-driven feature response, freeze stability, transport, EQ, stem controls, screenshots and the static Cloudflare Pages asset limits.

Custom colour stories use four user-selected colours, persisted locally. Presets remain unchanged; the interface keeps its coral accent. Range tracks reflect their values, with generous pointer targets and vertical EQ controls.
