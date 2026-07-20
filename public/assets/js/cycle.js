import * as THREE from "../vendor/three.module.js";
import { STR } from "./strings.js";
import { COL } from "./world.js";
import { RNG, Store, clamp, damp } from "./util.js";

// design/thresholds.md - FROZEN
const ARENA = 82;             // expanded square arena for longer reads and setup time
const WALL_IN = 81.35;
const SPEEDS = [14, 18, 22];
const THROTTLE_MULT = 1.35;                        // both triggers held (W on web)
const BOOST_MULT = 1.85, BURST_T = 1.15;           // A/X or Shift: timed surge
const BOOST_DRAIN = 1 / 1.2, BOOST_REGEN = 1 / 3;
const BRAKE_MULT = 0.55;
const LEAN_TURN = 0.22, LEAN_REARM = 0.10;         // metres of lateral headset lean
const TRAIL_H = 1.5, TRAIL_W = 0.22;
const GRACE = 0.25;
const MAX_SEG = 1024;

const DIRS = [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }];
const YAWS = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

const _v1 = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _lv = new THREE.Vector3();
const _ld = new THREE.Object3D();

class Cycle {
  constructor(kit, group, color, isPlayer) {
    this.color = color;
    this.isPlayer = isPlayer;
    this.mesh = kit.makeCycle(color, isPlayer);
    this.mesh.scale.setScalar(isPlayer ? 1 : 1.35);
    group.add(this.mesh);
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.trailMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    this.trail = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.trailMat, MAX_SEG);
    this.trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trail.frustumCulled = false;
    // white-hot edge running along the ribbon top, movie-style
    const hot = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.75);
    this.coreMat = new THREE.MeshBasicMaterial({ color: hot, transparent: true, opacity: 1 });
    this.trailCore = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.coreMat, MAX_SEG);
    this.trailCore.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trailCore.frustumCulled = false;
    group.add(this.trail, this.trailCore);
    this.segs = [];
    this.alive = true;
    this.fade = 0;
  }

  spawn(x, z, dirIdx) {
    this.pos.set(x, 0, z);
    this.prev.copy(this.pos);
    this.dirIdx = dirIdx;
    this.alive = true;
    this.fade = 0;
    this.graceT = 0;
    this.bank = 0;
    this.mesh.rotation.z = 0;
    this.boost = 1;
    this.boosting = false;
    this.aiT = Math.random() * 0.1;
    this.segs.length = 0;
    this.newSeg();
    this.trailMat.opacity = 1;
    this.coreMat.opacity = 1;
    this.mesh.visible = true;
    this.syncMesh(1);
    const zero = _dummy;
    zero.position.set(0, -10, 0); zero.scale.setScalar(0.0001); zero.updateMatrix();
    for (let i = 0; i < MAX_SEG; i++) {
      this.trail.setMatrixAt(i, zero.matrix);
      this.trailCore.setMatrixAt(i, zero.matrix);
    }
    this.trail.instanceMatrix.needsUpdate = true;
    this.trailCore.instanceMatrix.needsUpdate = true;
  }

  get dir() { return DIRS[this.dirIdx]; }
  get yaw() { return YAWS[this.dirIdx]; }

  newSeg() {
    const d = this.dir;
    this.segs.push({ ax: this.pos.x, az: this.pos.z, bx: this.pos.x, bz: this.pos.z, vertical: d.z !== 0 });
    if (this.segs.length > MAX_SEG) this.segs.shift();
  }

  turn(left) {
    if (!this.alive) return;
    // close current segment at the pivot
    const s = this.segs[this.segs.length - 1];
    s.bx = this.pos.x; s.bz = this.pos.z;
    this.dirIdx = (this.dirIdx + (left ? 3 : 1)) % 4;
    this.newSeg();
    this.graceT = GRACE;
    this.bank = left ? 1 : -1; // cinematic lean into the corner
    this.writeSeg(this.segs.length - 2);
  }

  advance(dist) {
    this.prev.copy(this.pos);
    this.pos.x += this.dir.x * dist;
    this.pos.z += this.dir.z * dist;
    const s = this.segs[this.segs.length - 1];
    s.bx = this.pos.x; s.bz = this.pos.z;
    this.graceT = Math.max(0, this.graceT - 1 / 60);
    this.writeSeg(this.segs.length - 1);
  }

  writeSeg(i) {
    if (i < 0 || i >= this.segs.length) return;
    const s = this.segs[i];
    const lx = Math.abs(s.bx - s.ax), lz = Math.abs(s.bz - s.az);
    _dummy.position.set((s.ax + s.bx) / 2, TRAIL_H / 2, (s.az + s.bz) / 2);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(Math.max(lx, TRAIL_W), TRAIL_H, Math.max(lz, TRAIL_W));
    _dummy.updateMatrix();
    this.trail.setMatrixAt(i, _dummy.matrix);
    this.trail.instanceMatrix.needsUpdate = true;
    _dummy.position.y = TRAIL_H + 0.02;
    _dummy.scale.set(Math.max(lx, TRAIL_W * 1.4), 0.06, Math.max(lz, TRAIL_W * 1.4));
    _dummy.updateMatrix();
    this.trailCore.setMatrixAt(i, _dummy.matrix);
    this.trailCore.instanceMatrix.needsUpdate = true;
  }

  // distance to nearest obstacle from (px,pz) along axis dir (dx,dz in {-1,0,1})
  static rayDist(px, pz, dx, dz, cycles, self) {
    let best;
    if (dx > 0) best = WALL_IN - px;
    else if (dx < 0) best = px + WALL_IN;
    else if (dz > 0) best = WALL_IN - pz;
    else best = pz + WALL_IN;
    for (const c of cycles) {
      if (c.fade > 0 && c.trailMat.opacity <= 0.35) continue;
      const nseg = c.segs.length;
      for (let i = 0; i < nseg; i++) {
        if (c === self) {
          if (i === nseg - 1) continue;
          if (i === nseg - 2 && self.graceT > 0) continue;
        }
        const s = c.segs[i];
        if (s.vertical) {
          const zmin = Math.min(s.az, s.bz) - TRAIL_W, zmax = Math.max(s.az, s.bz) + TRAIL_W;
          if (dx !== 0) {
            const t = (s.ax - px) * dx;
            if (t > 0 && t < best && pz >= zmin && pz <= zmax) best = t;
          } else if (Math.abs(s.ax - px) < 0.5) {
            const t1 = (s.az - pz) * dz, t2 = (s.bz - pz) * dz;
            const t = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
            if (pz >= zmin && pz <= zmax) best = 0;
            else if (t < best) best = t;
          }
        } else {
          const xmin = Math.min(s.ax, s.bx) - TRAIL_W, xmax = Math.max(s.ax, s.bx) + TRAIL_W;
          if (dz !== 0) {
            const t = (s.az - pz) * dz;
            if (t > 0 && t < best && px >= xmin && px <= xmax) best = t;
          } else if (Math.abs(s.az - pz) < 0.5) {
            const t1 = (s.ax - px) * dx, t2 = (s.bx - px) * dx;
            const t = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
            if (px >= xmin && px <= xmax) best = 0;
            else if (t < best) best = t;
          }
        }
      }
    }
    return best;
  }

  syncMesh(alpha) {
    this.mesh.position.lerpVectors(this.prev, this.pos, alpha);
    this.mesh.rotation.y = this.yaw;
  }
}

export class CycleMode {
  constructor() { this.name = "cycle"; this.group = null; }

  build(g) {
    const kit = g.kit;
    this.group = new THREE.Group();

    // reflective base + additive grid overlay
    const base = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2), kit.matFloor);
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.02;
    const floorTex = kit.gridTex.clone();
    floorTex.needsUpdate = true;
    floorTex.repeat.set(ARENA / 2, ARENA / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
      new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2;
    this.group.add(base, floor);
    // Grid City beyond the walls: tower ring, distant mega-tower, glowing horizon
    this.group.add(kit.makeSkyline(22, 170, 320, 7));
    const mega = kit.makeMegaTower();
    mega.position.set(0, 0, -330);
    this.group.add(mega, kit.makeHorizonGlow(430));

    const wallTex = kit.wallTex.clone();
    wallTex.needsUpdate = true;
    wallTex.repeat.set(28, 3);
    this.wallTex = wallTex;
    const WALL_H = 12;
    const wallMat = new THREE.MeshBasicMaterial({ map: wallTex, color: COL.cyanHi, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, WALL_H), wallMat);
      w.position.y = WALL_H / 2;
      if (i === 0) { w.position.z = -ARENA; }
      if (i === 1) { w.position.z = ARENA; w.rotation.y = Math.PI; }
      if (i === 2) { w.position.x = -ARENA; w.rotation.y = Math.PI / 2; }
      if (i === 3) { w.position.x = ARENA; w.rotation.y = -Math.PI / 2; }
      this.group.add(w);
    }
    for (const [x, z] of [[-ARENA, -ARENA], [ARENA, -ARENA], [-ARENA, ARENA], [ARENA, ARENA]]) {
      const p = kit.makePylon();
      p.scale.setScalar(3.0);
      p.position.set(x, 0, z);
      this.group.add(p);
    }
    // glowing top edge on the boundary walls
    const edgeMat = new THREE.MeshBasicMaterial({ color: COL.cyan });
    for (let i = 0; i < 4; i++) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(i < 2 ? ARENA * 2 : 0.18, 0.18, i < 2 ? 0.18 : ARENA * 2), edgeMat);
      e.position.y = WALL_H;
      if (i === 0) e.position.z = -ARENA;
      if (i === 1) e.position.z = ARENA;
      if (i === 2) e.position.x = -ARENA;
      if (i === 3) e.position.x = ARENA;
      this.group.add(e);
    }
    // Bright lower rails make the square collision boundary readable from the cockpit.
    for (let i = 0; i < 4; i++) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(i < 2 ? ARENA * 2 : 0.3, 0.28, i < 2 ? 0.3 : ARENA * 2), edgeMat);
      rail.position.y = 0.18;
      if (i === 0) rail.position.z = -ARENA;
      if (i === 1) rail.position.z = ARENA;
      if (i === 2) rail.position.x = -ARENA;
      if (i === 3) rail.position.x = ARENA;
      this.group.add(rail);
    }

    this.cycles = [
      new Cycle(kit, this.group, COL.cyan, true),
      new Cycle(kit, this.group, COL.amber, false),
      new Cycle(kit, this.group, COL.magenta, false),
      new Cycle(kit, this.group, COL.green, false),
    ];

    // ambient life: drifting motes, light beams, distant traffic, speed lines
    this.motes = kit.makeMotes(200, 90, 22);
    this.group.add(this.motes);
    this.beamMat = null;
    for (let i = 0; i < 3; i++) {
      const b = kit.makeBeam(80 + i * 30);
      const a = (i / 3) * Math.PI * 2 + 1.1;
      b.position.x = Math.cos(a) * 175;
      b.position.z = Math.sin(a) * 175;
      this.beamMat = b.material;
      this.group.add(b);
    }
    this.traffic = kit.makeTraffic(8);
    this.group.add(this.traffic);
    this.trafficData = [];
    for (let i = 0; i < 8; i++) {
      this.trafficData.push({
        side: i % 2 ? 1 : -1,
        z0: Math.random() * 320,
        y: 2.5 + (i % 3) * 5,
        spd: 30 + Math.random() * 45,
        dir: i % 2 ? 1 : -1,
      });
    }
    this.lines = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.03, 0.03, 2.6),
      new THREE.MeshBasicMaterial({ color: COL.cyanHi, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
      24
    );
    this.lines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.group.add(this.lines);
    this.lineData = [];
    for (let i = 0; i < 24; i++) {
      this.lineData.push({ ang: Math.random() * Math.PI * 2, rad: 1.7 + Math.random() * 3.2, z: Math.random() * 30 - 18 });
    }

    this.time = 0;
  }

  enter(g) {
    if (!this.group) this.build(g);
    // AR: shrink to a floor-anchored holo-table diorama
    this.holo = g.isAR;
    if (this.holo) {
      this.group.scale.setScalar(0.014);
      this.group.position.set(0, 0.02, -1.9);
    } else {
      this.group.scale.setScalar(1);
      this.group.position.set(0, 0, 0);
    }
    g.scene.add(this.group);
    g.audio.playMusic("mus_combat");
    g.hud.showGameplay(true);
    g.hud.hint(g.inXR || g.input.touch.active ? "" : STR.quitHint);
    // minimap: DOM canvas on flat screens, camera-anchored panel in VR
    this.mapCanvas = document.getElementById("minimap");
    this.mapCtx = this.mapCanvas.getContext("2d");
    this.mapAt = 0;
    if (g.inXR) {
      if (!this.mapTex) {
        this.mapTex = new THREE.CanvasTexture(this.mapCanvas);
        this.mapTex.colorSpace = THREE.SRGBColorSpace;
        this.mapPanel = new THREE.Mesh(
          new THREE.PlaneGeometry(0.26, 0.26),
          new THREE.MeshBasicMaterial({ map: this.mapTex, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false })
        );
        this.mapPanel.renderOrder = 40;
      }
      g.camera.add(this.mapPanel);
      this.mapPanel.position.set(0.3, 0.27, -0.85);
      this.mapPanel.visible = true;
    } else {
      this.mapCanvas.style.display = "block";
    }
    this.tier = clamp(Store.get("cycleTier") || 0, 0, 2);
    this.pWins = 0; this.eWins = 0;
    this.rng = new RNG((Date.now() & 0xffff) * 17 + 5);
    this.yawAnim = null;
    g.rig.rotation.set(0, 0, 0);
    g.setDesktopEye(this.holo ? 1.65 : 1.38);
    g.audio.startEngine();
    this.startRound(g);
    g.lockPointer();
  }

  exit(g) {
    g.scene.remove(this.group);
    g.audio.stopEngine();
    g.hud.showGameplay(false);
    g.vignetteSet(0);
    if (this.mapCanvas) this.mapCanvas.style.display = "none";
    if (this.mapPanel && this.mapPanel.parent) this.mapPanel.parent.remove(this.mapPanel);
    g.camera.rotation.z = 0;
  }

  startRound(g) {
    const c = this.cycles;
    // Formation starts keep every opponent visible before the chase begins.
    const patterns = [
      [[0, 68, 0], [-38, 30, 0], [0, -5, 0], [38, -40, 0]],
      [[0, 68, 0], [38, 30, 0], [0, -8, 0], [-38, -43, 0]],
    ];
    const pat = this.rng.pick(patterns);
    for (let i = 0; i < 4; i++) {
      c[i].spawn(pat[i][0], pat[i][1], pat[i][2]);
      c[i].spdMul = c[i].isPlayer ? 1 : this.rng.range(0.95, 1.06);
    }
    this.state = "countdown";
    this.t = g.testSpeed > 1 ? 0.05 : 5.0;
    this.cdTick = 4;
    this.lastAlert = false;
    this.sealed = false;
    this.playerMult = 1;
    this.runT = 0;
    this.boostBurstT = 0;
    this.leanCenterX = null;
    this.leanArmed = true;
    this.leanDwell = 0;
    this.speed = SPEEDS[this.tier];
    g.banner([`${STR.cycleArena}  ·  ${STR.cycleTier} ${this.tier + 1}`, `${STR.hudRound} ${this.pWins + this.eWins + 1}`], 1.2);
    if (!this.holo) {
      g.rig.position.set(c[0].pos.x, 0, c[0].pos.z);
      g.rig.rotation.y = c[0].yaw;
    }
    this.hudDirty = true;
  }

  crash(g, cyc) {
    cyc.alive = false;
    cyc.fade = 1.5;
    _v1.copy(cyc.pos).setY(0.6);
    if (!this.holo) g.shatter.spawn(_v1, cyc.color, 42, 4.5, 3.5, 2);
    else {
      _v1.applyMatrix4(this.group.matrixWorld);
      g.shatter.spawn(_v1, cyc.color, 20, 0.6, 0.5, 0.3);
    }
    g.audio.sfx("sfx_crash", { pos: _v1, vol: cyc.isPlayer ? 1 : 0.8 });
    cyc.mesh.visible = false;
    if (cyc.isPlayer) {
      g.flash(0.5);
      g.hapticDisc(1, 200); g.hapticGuard(1, 200);
    }
  }

  update(g, dt, events) {
    this.time += dt;
    const player = this.cycles[0];
    const inXR = g.inXR;

    if (this.state === "countdown") {
      this.t -= dt;
      const tick = Math.ceil(this.t);
      if (tick !== this.cdTick && tick >= 1 && tick <= 3) {
        this.cdTick = tick;
        g.banner([String(tick)], 0.8);
        g.audio.count();
      }
      if (this.t <= 0) {
        this.state = "run";
        g.banner([STR.cycleGo], 0.8);
        g.audio.countGo();
      }
      // consume stray events during countdown
      events.length = 0;
      return;
    }

    if (this.state === "roundEnd" || this.state === "exitMode") {
      this.t -= dt;
      this.integrate(g, dt, true);
      if (this.t <= 0) {
        if (this.state === "exitMode") { g.setMode("hub"); return; }
        this.decide(g);
      }
      return;
    }

    this.runT += dt;

    // ---- controller events: discrete 90-degree turns + A/X boost burst
    for (const e of events) {
      if (e.type === "turnL") this.doTurn(g, player, true);
      else if (e.type === "turnR") this.doTurn(g, player, false);
      else if ((e.type === "boostBurst" || e.type === "dash") && player.boost > 0.2 && this.state === "run") {
        this.boostBurstT = BURST_T;
        g.audio.boost();
        g.hapticDisc(0.6, 80); g.hapticGuard(0.6, 80);
      }
    }

    // ---- body-lean steering: a quick deliberate lean fires ONE sharp turn.
    // The neutral center adapts continuously (fast while disarmed), so
    // straightening back up or the frame shift of a 90-degree rig rotation
    // re-neutralizes instead of firing a phantom opposite turn.
    if (inXR && !this.holo && this.state === "run") {
      g.headWorld(_v1);
      g.rig.worldToLocal(_v1);
      if (this.leanCenterX == null) this.leanCenterX = _v1.x;
      this.leanCenterX = damp(this.leanCenterX, _v1.x, this.leanArmed ? 0.25 : 1.6, dt);
      const lean = _v1.x - this.leanCenterX;
      if (this.leanArmed && Math.abs(lean) > LEAN_TURN) {
        this.doTurn(g, player, lean < 0);
      } else if (!this.leanArmed) {
        if (Math.abs(lean) < LEAN_REARM) {
          this.leanDwell += dt;
          if (this.leanDwell > 0.3) this.leanArmed = true;
        } else this.leanDwell = 0;
      }
    }

    // ---- speed: both triggers = throttle, A/X burst = boost, grips = brake
    const throttle = g.input.throttleHeld(inXR);
    this.boostBurstT = Math.max(0, this.boostBurstT - dt);
    player.boosting = this.boostBurstT > 0 && player.boost > 0.05;
    if (player.boosting) player.boost = Math.max(0, player.boost - BOOST_DRAIN * dt);
    else player.boost = Math.min(1, player.boost + BOOST_REGEN * dt);
    const braking = g.input.brakeHeld(inXR);
    this.playerMult = player.boosting ? BOOST_MULT : braking ? BRAKE_MULT : throttle ? THROTTLE_MULT : 1;

    if (inXR) {
      const adjust = g.input.dashboardAdjust();
      if (Math.abs(adjust) > 0.01) {
        this.dashboardHeight = clamp((this.dashboardHeight || 0) + adjust * dt * 0.32, -0.28, 0.38);
        Store.set("dashboardHeight", this.dashboardHeight);
      }
    }

    this.integrate(g, dt, false);

    // near-miss whoosh + engine haptics
    if (player.alive) {
      this.nearT = Math.max(0, (this.nearT || 0) - dt);
      this.nearScan = (this.nearScan || 0) - dt;
      if (this.nearScan <= 0) {
        this.nearScan = 0.15;
        const lIdx = (player.dirIdx + 3) % 4, rIdx = (player.dirIdx + 1) % 4;
        const dL = Cycle.rayDist(player.pos.x, player.pos.z, DIRS[lIdx].x, DIRS[lIdx].z, this.cycles, player);
        const dR = Cycle.rayDist(player.pos.x, player.pos.z, DIRS[rIdx].x, DIRS[rIdx].z, this.cycles, player);
        if (Math.min(dL, dR) < 1.7 && this.nearT <= 0) {
          this.nearT = 0.7;
          g.audio.noise(0.18, 0.22, 700, 3600);
          g.hapticDisc(0.3, 60); g.hapticGuard(0.3, 60);
        }
      }
      if (inXR) {
        this.hapT = (this.hapT || 0) - dt;
        if (this.hapT <= 0) {
          this.hapT = 0.12;
          const v = Math.max(0.04, 0.05 + (this.playerMult - 0.8) * 0.15);
          g.hapticDisc(v, 25); g.hapticGuard(v, 25);
        }
      }
    }

    // engine pitch + hud
    g.audio.setEngineRate(0.85 + this.playerMult * 0.45);
    let aliveAI = 0;
    for (const c of this.cycles) if (!c.isPlayer && c.alive) aliveAI++;
    if (aliveAI === 1 && !this.lastAlert && player.alive) {
      this.lastAlert = true;
      g.banner([STR.lastCycle], 1.4);
    }
    if ((this.time * 10 | 0) !== this.hudTick) {
      this.hudTick = this.time * 10 | 0;
      g.hud.set({
        boost: player.boost,
        round: `${STR.cycleTier} ${this.tier + 1}  ·  ${this.pWins} - ${this.eWins}`,
        enemy: STR.cycleArena,
        pips: null, epips: null,
        disc: player.boosting ? STR.hudBoosting : this.playerMult > 1 ? STR.hudThrottle : "",
      });
    }

    // ---- round resolution
    if (!player.alive) {
      this.eWins++;
      this.state = "roundEnd"; this.t = 2.2;
      g.banner([STR.trailCollision, STR.roundLost], 2.0);
      g.audio.stingLose();
    } else if (aliveAI === 0) {
      this.pWins++;
      this.state = "roundEnd"; this.t = 2.2;
      g.banner([STR.roundWon], 2.0);
      g.audio.stingWin();
    }
  }

  doTurn(g, player, left) {
    if (this.state !== "run" || !player.alive) return;
    player.turn(left);
    // every turn rotates the rig frame: disarm lean until posture re-settles
    this.leanArmed = false;
    this.leanDwell = 0;
    if (!this.holo) {
      const smooth = Store.get("smoothTurn") || !g.inXR;
      if (smooth) this.yawAnim = { from: g.rig.rotation.y, to: this.nearestYaw(g.rig.rotation.y, player.yaw), t: 0, dur: g.inXR ? 0.18 : 0.11 };
      else { g.rig.rotation.y = player.yaw; this.yawAnim = null; }
      this.turnPulse = 0.6;
    }
    g.audio.blip();
  }

  nearestYaw(from, to) {
    while (to - from > Math.PI) to -= Math.PI * 2;
    while (to - from < -Math.PI) to += Math.PI * 2;
    return to;
  }

  integrate(g, dt, endgame) {
    const cycles = this.cycles;
    for (const c of cycles) {
      if (!c.alive) {
        c.fade = Math.max(0, c.fade - dt);
        c.trailMat.opacity = Math.min(1, c.fade);
        c.coreMat.opacity = Math.min(1, c.fade);
        continue;
      }
      let spd = this.speed;
      if (c.isPlayer) spd *= this.playerMult;
      else spd *= c.spdMul || 1;
      if (endgame && c.isPlayer && !c.alive) continue;

      if (!c.isPlayer && this.state === "run") this.ai(c, dt);

      const step = spd * dt;
      const d = Cycle.rayDist(c.pos.x, c.pos.z, c.dir.x, c.dir.z, cycles, c);
      if (d <= step + 0.28) {
        const move = Math.max(0, d - 0.3);
        c.advance(move);
        this.crash(g, c);
        continue;
      }
      c.advance(step);
    }
    // body-vs-body collisions
    for (let i = 0; i < cycles.length; i++) {
      for (let j = i + 1; j < cycles.length; j++) {
        const a = cycles[i], b = cycles[j];
        if (!a.alive || !b.alive) continue;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        if (dx * dx + dz * dz < 2.2) { this.crash(g, a); this.crash(g, b); }
      }
    }
  }

  ai(c, dt) {
    c.aiT -= dt;
    if (c.aiT > 0) return;
    c.aiT = 0.1;
    const cycles = this.cycles;
    const player = cycles[0];
    const react = [0.85, 1.0, 1.15][this.tier] + this.rng.range(-0.1, 0.1);
    const dF = Cycle.rayDist(c.pos.x, c.pos.z, c.dir.x, c.dir.z, cycles, c);
    const lIdx = (c.dirIdx + 3) % 4, rIdx = (c.dirIdx + 1) % 4;
    const dL = Cycle.rayDist(c.pos.x, c.pos.z, DIRS[lIdx].x, DIRS[lIdx].z, cycles, c);
    const dR = Cycle.rayDist(c.pos.x, c.pos.z, DIRS[rIdx].x, DIRS[rIdx].z, cycles, c);

    if (dF < this.speed * react) {
      if (dL < 3 && dR < 3) return; // doomed, ride it out
      c.turn(dL > dR ? true : dR > dL ? false : this.rng.chance(0.5));
      return;
    }
    // spawn protection: no hunting or wandering in the first moments of a round
    if (this.runT < 8) return;
    // unpredictable wander: sometimes just carve a new line
    if (this.rng.chance(0.008)) {
      const left = this.rng.chance(0.5);
      const side = left ? dL : dR;
      if (side > this.speed * 1.6) { c.turn(left); return; }
    }
    // aggression: drift toward the player's lane / cutoff
    if (!player.alive) return;
    const aggr = [0.008, 0.02, 0.04][this.tier];
    if (this.rng.chance(aggr)) {
      const px = player.pos.x - c.pos.x, pz = player.pos.z - c.pos.z;
      let left;
      if (c.dir.x !== 0) left = c.dir.x > 0 ? pz > 0 === false : pz > 0; // toward player z
      else left = c.dir.z > 0 ? px > 0 : px < 0;
      const side = left ? dL : dR;
      if (side > this.speed * 1.4) c.turn(left);
    }
  }

  decide(g) {
    if (this.pWins >= 2) {
      const cleared = Math.max(Store.get("cycleTier") || 0, this.tier + 1);
      Store.set("cycleTier", cleared);
      if (this.tier >= 2) {
        g.banner([STR.campaignDone], 3.0);
        this.state = "exitMode"; this.t = 3.2;
      } else {
        this.tier++;
        this.pWins = 0; this.eWins = 0;
        g.banner([`${STR.tierCleared}`, `${STR.cycleTier} ${this.tier + 1}`], 2.2);
        this.state = "roundEnd"; this.t = 2.4;
      }
    } else if (this.eWins >= 2) {
      g.banner([STR.matchLost], 2.4);
      this.state = "exitMode"; this.t = 2.6;
    } else {
      this.startRound(g);
    }
  }

  frame(g, rdt, alpha, time) {
    const player = this.cycles[0];
    for (const c of this.cycles) {
      if (c.alive) c.syncMesh(alpha);
      // every cycle leans hard into its snap turn, then settles dead level
      c.bank = damp(c.bank || 0, 0, 5.5, rdt);
      c.mesh.rotation.z = -c.bank * 0.45;
    }
    // rig follows the player cycle in immersive modes
    if (!this.holo) {
      if (player.alive) {
        g.rig.position.x = player.prev.x + (player.pos.x - player.prev.x) * alpha;
        g.rig.position.z = player.prev.z + (player.pos.z - player.prev.z) * alpha;
      }
      if (this.yawAnim) {
        this.yawAnim.t += rdt;
        const k = clamp(this.yawAnim.t / this.yawAnim.dur, 0, 1);
        g.rig.rotation.y = this.yawAnim.from + (this.yawAnim.to - this.yawAnim.from) * (k * k * (3 - 2 * k));
        if (k >= 1) this.yawAnim = null;
      }
      // comfort vignette: speed + turn pulses (XR only, setting-gated)
      if (g.inXR && Store.get("vignette")) {
        this.turnPulse = Math.max(0, (this.turnPulse || 0) - rdt * 2.2);
        const base = this.state === "run" ? 0.32 : 0;
        g.vignetteSet(Math.min(0.75, base + (this.turnPulse || 0)));
      }
    }
    // wheels spin
    const spin = time * this.speed * 1.4;
    for (const c of this.cycles) {
      if (!c.mesh.visible) continue;
      const wheels = c.mesh.userData.wheels;
      if (wheels) { wheels[0].rotation.x = spin; wheels[1].rotation.x = spin * 0.9; }
    }
    this.wallTex.offset.x = (time * 0.02) % 1;

    // cockpit: canopy seal, grip glow, live dash
    const pc = this.cycles[0].mesh.userData;
    if (pc.dash && pc.dash.mesh) {
      this.dashboardHeight ??= clamp(Store.get("dashboardHeight") || 0, -0.28, 0.38);
      pc.dash.mesh.position.y = 1.04 + this.dashboardHeight;
    }
    // rider view stays dead level - no idle wobble in the headset
    if (g.inXR) g.camera.rotation.z = 0;
    if (pc.canopy) {
      const wantClosed = (this.state === "countdown" || this.state === "run") && !this.holo && this.cycles[0].alive;
      pc.canopy.rotation.x = damp(pc.canopy.rotation.x, wantClosed ? 0 : 1.15, 3.0, rdt);
      if (wantClosed && !this.sealed && pc.canopy.rotation.x < 0.08) {
        this.sealed = true;
        g.audio.tone(72, 0.22, "sine", 0.4);
        g.hapticDisc(0.5, 90); g.hapticGuard(0.5, 90);
      }
      if (!wantClosed) this.sealed = false;
    }
    if (pc.grips && g.inXR) {
      pc.grips[0].material.color.setHex(g.input.gripHeld("left") ? COL.cyanHi : this.cycles[0].color);
      pc.grips[1].material.color.setHex(g.input.gripHeld("right") ? COL.cyanHi : this.cycles[0].color);
    }
    if (pc.dash && time - (this.dashAt || 0) > 0.25) {
      this.dashAt = time;
      const ctx = pc.dash.ctx;
      ctx.clearRect(0, 0, 256, 128);
      ctx.fillStyle = "rgba(2,8,14,0.85)";
      ctx.beginPath(); ctx.roundRect(2, 2, 252, 124, 12); ctx.fill();
      ctx.strokeStyle = "rgba(0,229,255,0.6)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.textBaseline = "middle";
      ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 8;
      ctx.fillStyle = "#00e5ff";
      ctx.font = "700 40px Menlo, Consolas, monospace";
      ctx.textAlign = "left";
      ctx.fillText(String(Math.round(this.speed * this.playerMult)), 18, 40);
      ctx.font = "700 15px Menlo, Consolas, monospace";
      ctx.fillStyle = "#7ad9e8";
      ctx.fillText(STR.dashSpd, 18, 72);
      ctx.textAlign = "right";
      ctx.fillText(`${STR.dashTier} ${this.tier + 1}`, 240, 40);
      ctx.shadowBlur = 4;
      ctx.strokeStyle = "rgba(0,229,255,0.7)";
      ctx.strokeRect(18, 92, 220, 16);
      ctx.fillStyle = "#00e5ff";
      ctx.fillRect(20, 94, 216 * this.cycles[0].boost, 12);
      pc.dash.tex.needsUpdate = true;
    }

    // speed lines streaming past the rider
    const showLines = this.state === "run" && !this.holo && this.cycles[0].alive;
    this.lines.visible = showLines;
    if (showLines) {
      g.rig.updateMatrixWorld();
      for (let i = 0; i < this.lineData.length; i++) {
        const ld = this.lineData[i];
        ld.z += this.speed * this.playerMult * rdt * 1.5;
        if (ld.z > 12) ld.z -= 32;
        _lv.set(Math.cos(ld.ang) * ld.rad, Math.max(0.25, 1.3 + Math.sin(ld.ang) * ld.rad * 0.5), ld.z);
        _lv.applyMatrix4(g.rig.matrixWorld);
        _ld.position.copy(_lv);
        _ld.quaternion.copy(g.rig.quaternion);
        _ld.scale.setScalar(1);
        _ld.updateMatrix();
        this.lines.setMatrixAt(i, _ld.matrix);
      }
      this.lines.instanceMatrix.needsUpdate = true;
    }

    // ambient: motes drift, beams pulse, distant traffic races, sky turns
    this.motes.rotation.y += rdt * 0.008;
    if (this.beamMat) this.beamMat.opacity = 0.16 + 0.08 * Math.sin(time * 0.6);
    for (let i = 0; i < this.trafficData.length; i++) {
      const td = this.trafficData[i];
      const z = ((td.z0 + time * td.spd * td.dir) % 320 + 320) % 320 - 160;
      _ld.position.set(td.side * (ARENA + 16), td.y, z);
      _ld.rotation.set(0, 0, 0);
      _ld.scale.set(1, 1, 0.8 + td.spd / 45);
      _ld.updateMatrix();
      this.traffic.setMatrixAt(i, _ld.matrix);
    }
    this.traffic.instanceMatrix.needsUpdate = true;
    g.sky.rotation.y += rdt * 0.004;

    // minimap redraw ~8 Hz
    if (time - this.mapAt > 0.12 && this.mapCtx) {
      this.mapAt = time;
      this.drawMinimap(g);
    }
  }

  drawMinimap(g) {
    const ctx = this.mapCtx;
    const M = (v) => ((v + ARENA) / (ARENA * 2)) * 236 + 10;
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = "rgba(1,6,12,0.82)";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "rgba(0,229,255,0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, 236, 236);
    ctx.strokeStyle = "rgba(0,229,255,0.16)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = 10 + i * 59;
      ctx.beginPath(); ctx.moveTo(p, 10); ctx.lineTo(p, 246); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10, p); ctx.lineTo(246, p); ctx.stroke();
    }
    ctx.fillStyle = "rgba(155,239,255,0.86)";
    ctx.font = "700 10px Menlo, Consolas, monospace";
    ctx.fillText("LIGHTFIELD // OVERHEAD", 16, 24);
    for (const c of this.cycles) {
      const hex = "#" + c.color.toString(16).padStart(6, "0");
      if (c.segs.length && (c.alive || c.fade > 0)) {
        ctx.strokeStyle = hex;
        ctx.globalAlpha = c.alive ? 0.9 : Math.max(0, c.fade / 1.5) * 0.9;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const s of c.segs) {
          ctx.moveTo(M(s.ax), M(s.az));
          ctx.lineTo(M(s.bx), M(s.bz));
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (c.alive) {
        ctx.fillStyle = hex;
        ctx.beginPath();
        ctx.arc(M(c.pos.x), M(c.pos.z), c.isPlayer ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
        if (c.isPlayer) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }
    if (this.mapTex) this.mapTex.needsUpdate = true;
  }
}
