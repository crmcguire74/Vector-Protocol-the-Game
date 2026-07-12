# Vector Protocol - plan capture

Experience formula: the player feels like a gladiator inside a machine because the game
constantly telegraphs enemy intent and rewards physically reading and countering it.

## Profile
- Time: real-time · Space: continuous 3D · Agency: one hero · Conflict: vs system (AI)
- Content: authored · Outcome: win/lose per match · Players: solo · Session: 5-15 min
- Engagement: execution primary, discovery (reading AI patterns) secondary
- Delivery: desktop browser + WebXR VR + WebXR AR passthrough + touch + gamepad.
  Weakest platform: Quest browser (72 Hz mobile chipset) - budgets set for it.

## Modes
1. DISC ARENA - first-person disc duel inside a square hard-surface Grid court.
   The floor and four visible energy walls allow deliberate banked throws. 3 integrity
   pips per round; the disc always returns after its ricochet path completes.
   Campaign: BIT-3 (straight telegraphed throws) -> VANTA (feints, curved throws) ->
   SENTINEL-9 (multi-wall banks, double feints, reactive guard). Best of 3 rounds each,
   ring shrinks per round (PROVING RING / SHARD SPIRE / CORE VAULT).
2. CYCLE RUN - first-person light cycle survival vs 3 AI in a 164 m square
   LIGHTFIELD. Rivals start far apart in a readable formation, then begin hunting after 8 s.
   Ribbon trails kill. Last cycle running wins round; first to 2 rounds wins match;
   3 speed tiers. VR turns are 90-degree snaps (comfort + arcade-authentic).

Hub: THE STAGING PLATFORM - two portals picked by ray/mouse/touch.

## Verbs
THROW (enemy=damage, wall=bank, buckler=deflected, pylon=blocked), GUARD (front-arc
deflect; beaten by banks), DODGE/MOVE (dash on desktop, physical movement in VR),
TURN/BOOST/BRAKE (cycle). Guard turtling beaten by banked shots; feints beat premature
guard; dodge beats everything but costs position on a shrinking ring.

## Controls
- Desktop: WASD move (KeyW/A/S/D physical codes), mouse look pointer lock, LMB throw,
  RMB hold guard, Space dash, KeyR recall, Esc pause. Cycle: KeyA/KeyD 90-degree turn,
  KeyW boost, KeyS brake.
- VR: trigger hold+swing+release = throw (controller velocity), off-hand grip = guard,
  left stick = locomotion (disc) / analog cycle steering and pull-back brake. Cycles also
  read physical headset lean and handlebar lean; either trigger fires a short boost,
  A/X performs one of three emergency stops, and right-stick vertical adjusts the dash.
- Touch: drag right half = look, tap right = throw, GUARD button left, dash double-tap.
  Cycle: left/right screen halves = turns, BOOST button.
- Gamepad: standard mapping - left stick move, right stick look, RT throw, LT guard,
  A dash; cycle: dpad/stick-flick turns, RT boost, LT brake.

## Comfort (VR)
Snap turns default in cycle mode, tunnel vignette during cycle motion (toggleable),
no artificial player push in disc mode. AR uses the guardian/detected floor footprint
without importing an artificial court; cycle mode is unavailable in AR.

## Teaching loop
Enemy ladder introduces one pattern at a time; each enemy's round 3 on the smallest ring
is the exam. Cycle tiers escalate speed then AI cutoff behavior.

## Structure / entry
Menu -> hub -> portal: first meaningful action within ~15 s. Return shows campaign badges
(localStorage). Comfort + audio toggles reachable from menu and pause.

## Audio mix law (from audio reference)
SFX -10..-12 dBFS, music -18..-20 dBFS, true peak <= -3 dBFS: music gain 0.22,
SFX gain 0.65-0.8, stings 0.8. Music loops on playback.

## Lighting (derived from STYLE FORMULA blocks 3-4)
Background #000004, fog black subtle, low cold ambient (#0a1420), cyan accents from
emissive surfaces, amber rim on enemies. Emissive materials carry the scene; bloom faked
with additive halo sprites (no postprocessing in XR).
