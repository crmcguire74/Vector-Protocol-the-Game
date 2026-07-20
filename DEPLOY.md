# Vector Protocol - deploy record

- Play URL: https://windy-glade-357.higgsfield.gg/
- game_id: 8615fa37-9178-454e-8e80-abe3271c4a2c
  (pass this game_id back to deploy_game to UPDATE the same game in place;
  never redeploy without it or a second game with a new URL is created)
- Deployed: 2026-07-03 (v1) · updated in place 2026-07-04 (v2) · 2026-07-04 (v3) · 2026-07-06 (v4)
- v7 DEPLOY BLOCKED (2026-07-20): the connected Higgsfield account
  (user_3GeArTotS7d7Yb4DXE43wBHrL8E, private workspace 01add5dc-a23d-4538-abe7-8e32cd11368e)
  is NOT the account that owns game_id 8615fa37 (deployed under
  user_2xekAI8hIqYqFSjlvU4oslAX5Ni) - deploy_game returned "this game belongs to
  another user". Re-connect the original Higgsfield account, then deploy_game with
  the game_id above and this already-uploaded v7 zip:
  https://d2ol7oe51mr4n9.cloudfront.net/user_3GeArTotS7d7Yb4DXE43wBHrL8E/6b032b71-eb67-4848-aafe-be1b23db8dfc.zip
  (Alternative: deploy WITHOUT game_id under the new account -> creates a second
  game with a new URL; only on explicit user approval.)
- v7 source prepared 2026-07-20 (vector-protocol-v7.zip): discrete VR cycle controls
  (stick-flick / body-lean 90-degree snap turns, dual-trigger throttle, A/X boost
  surge, grip brake, zero camera wobble), grip-squeeze disc recall, lethal AR
  portals with gridFall derez, Legacy-style cycle model (glowing wheel rims,
  hugging fenders, spine strip, turn bank anim), white-hot trail edges, Grid City
  skyline + mega-tower + horizon glow environment.
- v6 source prepared 2026-07-12: planar frisbee discs with brief light trails; room-scale
  VR locomotion; passthrough AR driven by guardian/detected room bounds with enemies and
  playable wall/floor breaches; 164 m cycle arena with distant spawns, body/controller
  steering, trigger boost, three emergency stops, and adjustable dashboard; selectable
  mode instructions and a persistent music toggle.
- v5 source prepared 2026-07-12: compact square cycle arena with staged formation starts,
  brighter walls/rails, larger enemy cycles, upgraded upper-right tactical map; square
  hard-surface disc court with flat frisbee rotor flight and visible floor/wall banks;
  embed-aware XR capability detection and direct-window recovery for blocked WebXR.
- v4: enemy programs rebuilt from blocks to organic Tron figures (capsule limbs,
  emissive circuit-line light suit, curved visor, spherical shoulders/boots); richer
  animation (arm counter-swing run, throw lunge, jump-dodges with knee tuck, walk bob);
  cycles rebuilt digital-sleek (capsule fuselage, cone nose/tail, arched wheel guards,
  tube light strips); AR disc impacts blast glowing grid "breach" windows into the real
  walls/floor opening onto the digital world. Trimmed wheel hubs/fin to hold draw budget
  (disc 60 calls, cycle 71).
- v3: VR handlebar lean-steering (grip both handles, lean hands), analog accelerator
  (right trigger) + boost (left trigger) + stick-back brake, sealed canopy sequence,
  live dash console, cockpit interior, speed lines, near-miss + engine haptics,
  cycle spawn protection 2.5 s, enemy dodge + torso twist/lean/head-scan/death-spin
  animation set, ambient environment (ribbons, barges, beams, traffic, motes,
  pulsing walls, flowing grid, rotating sky).
- Published to the Higgsfield marketplace: 2026-07-03 (status: published)
- v2: hit-detection fix (scratch-vector aliasing in distPointSeg), converging throws,
  real falling + jump/hop, multi-pad layouts per tier, randomized AI, cycle minimap,
  Shift+Q / Back / both-grips quit, AR room mode with floor pits (cycles disabled in AR),
  ACES + PMREM environment visuals, splash instructions.
- Zip source: vector-protocol-v6.zip built from public/ (logic.js + index.html at root)
- Thumbnail (16:9): https://d8j0ntlcm91z4.cloudfront.net/user_2xekAI8hIqYqFSjlvU4oslAX5Ni/hf_20260703_173505_5081e948-cb42-4d2a-a111-564cd3a93dd0.png
- Favicon (1:1): https://d8j0ntlcm91z4.cloudfront.net/user_2xekAI8hIqYqFSjlvU4oslAX5Ni/hf_20260703_173506_d426d49d-2c29-47dd-ba8e-bd10961254ba.png

## Rebuild + update procedure
1. Edit files under public/
2. cd public && zip -rq ../vector-protocol.zip . -x ".*" -x "*/.*"
3. media_upload the zip, PUT bytes, media_confirm type "file"
4. deploy_game with the SAME game_id above and the new zip URL
