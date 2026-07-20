# Grid Protocol - numeric thresholds (fixed before code)

## Performance budgets (weakest platform: Quest browser, 72 Hz)
- Frame budget: 13.8 ms XR / 16.6 ms desktop. Dev overlay via ?dev=1 measures it.
- Draw calls worst case: <= 80. Triangles: <= 150k.
- Trails: instanced, <= 4096 segments per cycle, 1 draw call per trail.
- Platform tiles: 1 InstancedMesh. Particles: single pooled instanced system, <= 512.
- Zero allocations inside the fixed-step sim loop (preallocated vectors, pools).
- Pixel ratio cap 2.0 desktop; XR foveation 1.0; no shadows, no postprocessing.

## Agency metrics (FROZEN)
- Platform ring radius per round: 6.0 / 4.5 / 3.0 m. Void gap between platforms: 10 m.
- Disc: speed 18 m/s (player), 13/15/17 m/s by enemy tier; auto-return 2.5 s;
  max 3 wall banks per flight.
- Desktop move 4.5 m/s; dash 8 m/s for 0.2 s, cooldown 1.5 s.
- Enemy windup: 0.9 / 0.6 / 0.5 s (tiers 1/2/3). Feint chance: 0 / 0.35 / 0.5.
  Bank-shot chance: 0 / 0.25 / 0.5. Guard chance: 0.1 / 0.35 / 0.6.
- Integrity: 3 pips per combatant per round. Best of 3 rounds per enemy.
- Cycle speed tiers: 20 / 26 / 32 m/s; boost x1.6 for up to 1.2 s, meter refills in 3 s;
  brake x0.55. Arena 200 x 200 m, wall/trail height 1.5 m. Grid cell 2 m.

## Tolerance windows (player-favoring)
- Disc auto-catch radius: 0.30 m (VR hand) / always-catch on return end (desktop).
- Guard deflect arc: 100 degrees frontal; deflect grace 80 ms after raise.
- Enemy disc hitbox vs player: r=0.18 m (visual 0.25 m). Player disc vs enemy: r=0.30 m.
- Cycle turn input buffer: 120 ms; suicide-forgiveness: own-trail collision ignored for
  0.25 s after each turn; AI trail hitbox honest.
- Round transition delays: 1.2 s win/lose banner, 3 s decompile reboot.

## Determinism
- Fixed sim step 1/60 s, accumulator with 5-step cap; render decoupled.
- Seeded RNG (mulberry32): seed = matchSeed + roundIndex; logic RNG split from FX RNG.

## v2 revisions (2026-07-04)
- Player vertical: jump v0 5.0 m/s, hop (VR) 4.0 m/s + 2.6 m/s forward, gravity 12 m/s^2,
  air control x0.7, void decompile at y -3. No invisible edge rails: falling is real.
- Dash grants i-frames for its 0.2 s duration.
- Hit tests are 2-sample swept (endpoint + step midpoint). Enemy disc vs player r = 0.30;
  player disc vs enemy r = 0.55 (player-favoring both ways).
- Desktop throws converge hand -> crosshair target; ray within 1.5 m of enemy chest snaps.
  VR assist: cone dot > 0.45, lerp 0.18.
- Pad layouts: tier 0 = 1 big ring (6/4.5/3.4 m); tier 1 = 3 pads r 2.3; tier 2 = 5 pads
  r 1.9; per-round size multiplier 1 / 0.85 / 0.72. Gaps are jumpable at jump+dash specs.
- Enemy randomization: cooldown 1.1-2.9 s, windup x0.85-1.25, bank chance 0.15+0.18/tier
  (cap 0.55), lead factor 0.25-1.0, wild-shot chance 0.2 (error x2.2).
- Cycle randomization: 4 spawn patterns, AI speed x0.95-1.06, wander-turn chance 0.022/decision.
- AR: wall radius = room floor circle (clamped 2.2-5 m) + 0.6, disc speeds x0.6, return 2.0 s,
  max 10 floor holes r 0.5-0.85 (+1 big on enemy defeat), over-hole fall at 0.85 r,
  enemy roams far side of the room, radius <= 1.2 m. Cycles disabled in AR.
- Minimap: 8 Hz redraw. Quit: Shift+Q / gamepad Back / both grips held 1 s.
- Renderer: ACES tone mapping (exposure 1.15), PMREM environment from the sky, 2 dynamic
  point lights (one per live disc). Budgets unchanged: <= 80 calls, <= 150k tris.

## v3 revisions (2026-07-04)
- VR cycle controls: grips = handlebars. Lean steering active only while BOTH grips held:
  hand height delta > 0.14 m fires a turn (left hand lower = left turn), re-arms under
  0.06 m. Right trigger = analog accelerator (+15% max), left trigger = boost (meter),
  left stick back = brake, B = pause. Grip-pause / grip-quit suppressed in cycle mode.
- Canopy seals over the rider during the countdown (damp 3.0), reopens between rounds;
  seal thunk at < 0.08 rad. Dash console redraws at 4 Hz.
- Enemy dodge: chance 0.2/0.4/0.55 by tier (scaled per step), side-dash 7 m/s for 0.3 s,
  cooldown 1.8 s, clamped to roam circle. Pose adds torso wind/release twist, lateral
  lean (cap 0.35 rad), idle head scan, death spin+sink.
- Speed lines: 24 instances, respawn window 32 m. Near-miss whoosh under 1.7 m lateral,
  rate-limited 0.7 s. Engine haptics every 0.12 s in VR, intensity 0.04-0.1.
- Ambient budget: +8 draws disc (3 ribbons, 2 barges x2, motes), +6 cycle (3 beams,
  traffic instanced, motes, speed lines). Worst case ~90 desktop calls measured locally;
  conservative 80 target intentionally exceeded, flagged for headset measurement.

## v4 revisions (2026-07-05)
- Enemy rebuilt from primitives to organic forms: capsule arms/legs, cylinder torso,
  sphere shoulders/chest/boots, curved torus visor. Emissive suit texture (circuit
  lines glow from surface); windup pumps emissiveIntensity 1.5 -> ~2.8.
- Animation set: run cycle now counter-swings arms; throw = leg lunge (L -0.55/R 0.4);
  jump-dodge (50% of dodges) tucks knees to 1.25 rad with vy 3.4, gravity 10; walk bob
  0.05 m. Disc hitbox tracks enemy.pos.y so airborne dodges can still be hit.
- Cycle rebuilt: capsule fuselage, cone nose/tail, 4-sided cone fin, arched torus wheel
  guards, cylinder tube light strips (no boxes).
- AR breaches: disc hitting any wall OR floor/ceiling bound spawns a grid "window" with
  cyan rim + glow into the digital world at the impact, plus shatter burst. Pool of 6,
  grow-in 0.4 s, hold ~6 s, fade 0.8 s. Vertical bounds now also trigger onBank in AR.

## v5 revisions (2026-07-12)
- Disc court is a 29 x 29 m square with a continuous luminous floor and four 6.5 m walls.
  Flight attitude stays flat while an internal rotor spins; floor, ceiling, wall, and
  obstacle contacts all count as banks and produce a visible impact flash.
- Cycle LIGHTFIELD is 92 x 92 m with 8 m walls and bright lower/top collision rails.
  Speed tiers are 12 / 16 / 20 m/s. All rivals start ahead in parallel formation;
  AI hunting and wandering remain disabled for the first 5.5 s of a run.
- XR detection keeps gesture entry available after a rejected capability probe and
  escapes hosted iframes to a direct secure page when xr-spatial-tracking is blocked.
