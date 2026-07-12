# Digi World

Digi World is an original first-person digital-sport game built with Three.js and WebXR. It contains two complete arcade loops:

- **Shard Arena** — throw and recall arc discs, parry hostile throws, dash, jump between circular platforms, and defeat increasingly dangerous humanoid Sentinels.
- **Lightline Pursuit** — pilot a first-person light runner, lay a lethal energy wall, out-turn three tactical rivals, boost, brake, and cut openings with a disruption pulse.

The same application supports desktop presentation, `immersive-vr`, and `immersive-ar`. Unsupported immersive modes automatically launch a desktop spatial preview so the content remains inspectable without a headset.

The current visual pass uses skinned, articulated digital-human opponents with real sprint cycles and hand-origin throwing animation. Lightline Pursuit uses sculpted motorcycles and a detailed first-person cockpit with curved glass, live instruments, visible controls, wheel/fork/suspension motion, and progressive corner lean.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. WebXR requires a secure context; `localhost` is accepted for development, while deployed builds must use HTTPS.

Create an optimized build with:

```bash
npm run build
```

## Controls

### Shard Arena

- `WASD` / arrow keys — move
- Mouse — aim
- Hold/release left mouse — charge and throw
- Right mouse — guard and reflect
- `Q` or `E` — recall active shards
- `Space` — jump / air step
- `Shift` — dash

### Lightline Pursuit

- `A` / `D` or left/right arrows — queue a 90° turn
- `Space` — boost
- `Shift` — brake
- `Q` — toggle the lightline
- `E` — disruption pulse

### Shared

- `P`, `Enter`, or `Esc` — pause / resume
- `F` — toggle fullscreen

In VR, a controller trigger charges/releases a shard or boosts the bike; grip guards/parries or fires the bike disruption pulse. Controller haptics are used when available.

## AR room presets

- **Portal** — a focused breakable wall aperture
- **Arena** — a wider room shell
- **Tabletop** — a compact scaled breach

AR requests hit testing, anchors, plane detection, depth sensing, light estimation, and DOM overlay as optional capabilities. The core experience never assumes those features: preset virtual panels remain usable with a fixed local-space fallback. Disc impacts remove seeded shell fragments and expose a parallax digital world behind them.

## Testability

The game exposes:

- `window.render_game_to_text()` — concise JSON for the active presentation, mode, player, enemies, projectiles/trails, HUD, score, and capability state.
- `window.advanceTime(ms)` — deterministic 60 Hz simulation stepping for automated browser checks.

Desktop flows were exercised with the bundled Playwright game client. Real VR comfort, controller mapping, passthrough alignment, anchors, and depth occlusion still require testing on the target headset/phone before a production release.

## Visual assets

The runtime includes original generated environment/armor textures plus an adapted skinned example character used for Sentinel animation. See [ASSET_NOTES.md](./ASSET_NOTES.md) for provenance and the commercial-release caveat.
