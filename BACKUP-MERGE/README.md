# Vector Protocol

Vector Protocol is an original first-person digital-sport game built with Three.js and WebXR — a modern take on Discs of Tron and the light-cycle duel, rendered in a clean TRON: Legacy Grid aesthetic (cyan player, orange adversaries, electric-blue Grid on glass-black). It contains two complete campaign loops:

- **Shard Arena** — a best-of-3 disc duel up an authored program ladder: **BIT-3 → VANTA → SENTINEL-9**, across the shrinking, reconfiguring **PROVING RING → SHARD SPIRE → CORE VAULT** arenas. Throw and recall flat frisbee discs, bank them off walls and obstacles, guard the front arc, dash and jump between platforms (falling off costs a life), and read each program's telegraphs, feints, and reactive guard. Three integrity pips per round; win two rounds to decompile a program; beat all three to win the match. Progress persists.
- **Lightline Pursuit** — a first-person light-cycle survival against three tactical rivals across three speed tiers, best-of-3 per tier. Lay a lethal energy wall, out-turn the pack after an eight-second safe vector, boost, brake, spend one of three emergency stops, and cut openings with a disruption pulse. Cleared tiers persist.

The same application supports desktop presentation, `immersive-vr`, and `immersive-ar`. Unsupported immersive modes automatically launch a desktop spatial preview so the content remains inspectable without a headset.

Opponents are skinned, articulated digital-human Sentinels with real sprint cycles and hand-origin throwing animation. Lightline Pursuit uses sculpted motorcycles and a detailed first-person cockpit with curved glass, live instruments, visible controls, wheel/fork/suspension motion, and progressive corner lean. Campaign progress is saved in `localStorage` and can be cleared from the menu's **Reset** control.

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
- `X` — use one of three emergency stops
- `Q` — toggle the lightline
- `E` — disruption pulse
- `Page Up` / `Page Down` or `[` / `]` — adjust and save dashboard height

### Shared

- `P`, `Enter`, or `Esc` — pause / resume
- `F` — toggle fullscreen
- `M` — toggle music

In VR, a controller trigger charges/releases a disc or boosts the bike; grip guards/parries or fires the bike disruption pulse. Lightline steering supports the left stick, headset lean, or two gripped controllers used as handlebars. A/X spends an emergency stop, B/Y toggles the lightline, and the right stick adjusts dashboard height. Controller haptics are used when available.

## AR room mapping

Immersive AR requests a WebXR `bounded-floor` reference space and transforms its polygon into the placed game root. The player must confirm a cyan floor marker before combat begins; walls and surfaces tilted more than about 20° are rejected, and pitch/roll are removed from the final anchor so actors remain upright. The accepted room polygon governs player support, Sentinel spawning and roaming, containment, and disc banks. If the device does not expose usable bounds, the menu offers explicit small, large, and compact room-size fallbacks.

AR also requests hit testing, anchors, plane detection, depth sensing, light estimation, and DOM overlay as optional capabilities. The room remains the visible environment: only faint calibration lines are added before combat. A disc striking a real **wall** also cracks the **floor** open beneath it — the floor breaks apart into tumbling neon-edged shards revealing an animated 3D neon tunnel (moving rings, lattice, helixes, particles) of the digital world below. Falling into a floor breach costs a life; a disc that knocks a fighter through an opening costs two. The program roams throughout the mapped room footprint.

## Testability

The game exposes:

- `window.render_game_to_text()` — concise JSON for the active presentation, mode, player, enemies, projectiles/trails, HUD, score, and capability state.
- `window.advanceTime(ms)` — deterministic 60 Hz simulation stepping for automated browser checks.

Desktop flows were exercised with the bundled Playwright game client. Real VR comfort, controller mapping, passthrough alignment, anchors, and depth occlusion still require testing on the target headset/phone before a production release.

## Visual assets

The runtime includes original generated environment/armor textures plus an adapted skinned example character used for Sentinel animation. See [ASSET_NOTES.md](./ASSET_NOTES.md) for provenance and the commercial-release caveat.
