import * as THREE from "../vendor/three.module.js";
import { STR } from "./strings.js";
import { COL } from "./world.js";
import { RNG, Store, clamp, damp } from "./util.js";
import { createSentinelRig, updateSentinelRig } from "./sentinel.js";

// design/thresholds.md - FROZEN agency metrics (v2)
const RING_R = [6, 4.5, 3.4];
const SIZE_MUL = [1, 0.85, 0.72];
const ENEMY_R = 3.4;
const ENEMY_CZ = -20;
const DISC_SPEED = 18;
const ENEMY_DISC_SPEED = [13, 15, 17];
const RETURN_T = 2.5, MAX_BANKS = 3;
const MOVE_SPD = 4.5, DASH_SPD = 8, DASH_T = 0.2, DASH_CD = 1.5;
const JUMP_V = 5.0, GRAV = 12;
const WINDUP = [0.9, 0.6, 0.5];
const FEINT = [0, 0.35, 0.5];
const GUARDP = [0.1, 0.35, 0.6];
const DODGE = [0.2, 0.4, 0.55];
const AIM_ERR = [0.5, 0.35, 0.22];
const PIPS = 3;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _camP = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dummy = new THREE.Object3D();

// dedicated scratch for the segment test - NEVER the shared _v* the callers use
const _sA = new THREE.Vector3();
const _sB = new THREE.Vector3();
const _sC = new THREE.Vector3();
function distPointSeg(p, a, b) {
  _sA.subVectors(b, a);
  const l2 = _sA.lengthSq();
  if (l2 === 0) return p.distanceTo(a);
  let t = _sB.subVectors(p, a).dot(_sA) / l2;
  t = clamp(t, 0, 1);
  _sC.copy(a).addScaledVector(_sA, t);
  return p.distanceTo(_sC);
}

// player-side pad layouts per enemy tier: [{cx, cz, r, big}]
function layoutFor(tier, round) {
  const mul = SIZE_MUL[round - 1];
  if (tier === 0) return [{ cx: 0, cz: 0, r: RING_R[round - 1], big: true }];
  if (tier === 1) {
    const r = 2.3 * mul;
    return [{ cx: 0, cz: 1.4, r }, { cx: -3.0, cz: -1.8, r }, { cx: 3.0, cz: -1.8, r }];
  }
  const r = 1.9 * mul;
  return [
    { cx: 0, cz: 0, r }, { cx: -3.2, cz: 0, r }, { cx: 3.2, cz: 0, r },
    { cx: 0, cz: -3.2, r }, { cx: 0, cz: 3.2, r },
  ];
}

// ---------------------------------------------------------------- platform
class Platform {
  constructor(kit, tint) {
    this.kit = kit;
    this.group = new THREE.Group();
    this.tint = tint;
    this.tiles = [];
    this.inst = null;
    this.deco = new THREE.Group();
    this.group.add(this.deco);
  }

  rebuild(layout) {
    if (this.inst) { this.group.remove(this.inst); this.inst.geometry.dispose(); }
    while (this.deco.children.length) {
      const c = this.deco.children.pop();
      if (c.geometry && c.geometry.type !== "BoxGeometry") c.geometry.dispose();
    }
    this.tiles.length = 0;
    const defs = [];
    for (const pad of layout) {
      if (pad.big) {
        defs.push({ pad, r: 0, count: 1, bandW: pad.r * 0.42 });
        defs.push({ pad, r: pad.r * 0.4, count: 10, bandW: pad.r * 0.34 });
        defs.push({ pad, r: pad.r * 0.76, count: 18, bandW: pad.r * 0.34 });
      } else {
        defs.push({ pad, r: 0, count: 1, bandW: pad.r * 0.55 });
        defs.push({ pad, r: pad.r * 0.66, count: 8, bandW: pad.r * 0.48 });
      }
    }
    let total = 0;
    for (const d of defs) total += d.count;
    this.inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.12, 1),
      new THREE.MeshBasicMaterial({ map: this.kit.tileTex, color: this.tint }),
      total
    );
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    let idx = 0;
    for (const d of defs) {
      for (let i = 0; i < d.count; i++) {
        const ang = (i / d.count) * Math.PI * 2 + d.r * 0.3;
        const x = d.pad.cx + Math.cos(ang) * d.r;
        const z = d.pad.cz + Math.sin(ang) * d.r;
        const arc = d.r === 0 ? d.bandW * 1.7 : ((Math.PI * 2 * d.r) / d.count) * 0.9;
        _dummy.position.set(x, -0.06, z);
        _dummy.rotation.set(0, -ang, 0);
        _dummy.scale.set(d.bandW, 1, arc);
        _dummy.updateMatrix();
        this.inst.setMatrixAt(idx, _dummy.matrix);
        this.tiles.push({ x, z, alive: true, matrix: _dummy.matrix.clone(), sr: Math.max(d.bandW, arc) * 0.66 });
        idx++;
      }
    }
    this.inst.instanceMatrix.needsUpdate = true;
    this.group.add(this.inst);

    for (const pad of layout) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(pad.r, 0.06, 8, 56), this.kit.basic(this.tint));
      rim.rotation.x = Math.PI / 2; rim.position.set(pad.cx, 0.02, pad.cz);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(pad.r * 0.9, pad.r * 0.5, 40, 20, 1, true), this.kit.matGraphite);
      ped.position.set(pad.cx, -20.05, pad.cz);
      const under = this.kit.glow(this.tint, pad.r * 1.5, 0.3);
      under.position.set(pad.cx, -0.4, pad.cz);
      this.deco.add(rim, ped, under);
    }
  }

  reset() {
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      t.alive = true;
      this.inst.setMatrixAt(i, t.matrix);
    }
    this.inst.instanceMatrix.needsUpdate = true;
  }

  supported(wx, wz) {
    const lx = wx - this.group.position.x;
    const lz = wz - this.group.position.z;
    for (const t of this.tiles) {
      if (!t.alive) continue;
      const dx = t.x - lx, dz = t.z - lz;
      if (dx * dx + dz * dz < t.sr * t.sr) return true;
    }
    return false;
  }

  shatterNear(p, n, pool, colorHex, excludeR = 0) {
    const lx = p.x - this.group.position.x;
    const lz = p.z - this.group.position.z;
    const ex2 = excludeR * excludeR;
    const order = this.tiles
      .map((t, i) => ({ i, t, d: (t.x - lx) * (t.x - lx) + (t.z - lz) * (t.z - lz) }))
      .filter((o) => o.t.alive && o.d >= ex2)
      .sort((a, b) => a.d - b.d)
      .slice(0, n);
    for (const o of order) {
      o.t.alive = false;
      _dummy.position.set(o.t.x, -0.06, o.t.z);
      _dummy.scale.setScalar(0.0001);
      _dummy.updateMatrix();
      this.inst.setMatrixAt(o.i, _dummy.matrix);
      _v1.set(o.t.x + this.group.position.x, 0.1, o.t.z + this.group.position.z);
      pool.spawn(_v1, colorHex, 10, 2.0, 1.6);
    }
    this.inst.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- disc
class Disc {
  constructor(kit, color, hi) {
    this.mesh = kit.makeDisc(color, hi, true);
    this.color = color;
    this.state = "held";
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.home = new THREE.Vector3();
    this.t = 0;
    this.banks = 0;
    this.harmless = 0;
    this.trailPositions = new Float32Array(12 * 3);
    const trailGeo = new THREE.BufferGeometry();
    const trailAttr = new THREE.BufferAttribute(this.trailPositions, 3);
    trailAttr.setUsage(THREE.DynamicDrawUsage);
    trailGeo.setAttribute("position", trailAttr);
    const line = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false }));
    const sparks = new THREE.Points(trailGeo, new THREE.PointsMaterial({ color: hi, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trail = new THREE.Group();
    this.trail.add(line, sparks);
    this.trail.visible = false;
  }

  throwFrom(pos, dir, speed) {
    this.state = "fly";
    this.pos.copy(pos);
    this.prev.copy(pos);
    this.vel.copy(dir).multiplyScalar(speed);
    this.t = 0; this.banks = 0; this.harmless = 0;
    for (let i = 0; i < 12; i++) this.trailPositions.set([pos.x, pos.y, pos.z], i * 3);
    this.trail.children[0].geometry.attributes.position.needsUpdate = true;
    this.trail.visible = true;
  }

  startReturn() { if (this.state === "fly") this.state = "return"; }

  update(dt, cfg, onBank) {
    if (this.state === "held") { this.trail.visible = false; return; }
    this.harmless = Math.max(0, this.harmless - dt);
    this.prev.copy(this.pos);
    if (this.state === "fly") {
      this.t += dt;
      this.pos.addScaledVector(this.vel, dt);
      if (cfg.square) {
        if (this.pos.x < cfg.minX) this.reflectPlane("x", cfg.minX, 1, onBank);
        else if (this.pos.x > cfg.maxX) this.reflectPlane("x", cfg.maxX, -1, onBank);
        if (this.pos.z < cfg.minZ) this.reflectPlane("z", cfg.minZ, 1, onBank);
        else if (this.pos.z > cfg.maxZ) this.reflectPlane("z", cfg.maxZ, -1, onBank);
      } else {
        // AR rooms continue to use the detected play-space circle.
        const dx = this.pos.x - cfg.wallCX, dz = this.pos.z - cfg.wallCZ;
        const r = Math.hypot(dx, dz);
        if (r > cfg.wallR - 0.2) {
          _n.set(-dx / r, 0, -dz / r);
          const d = this.vel.dot(_n);
          if (d < 0) {
            this.vel.addScaledVector(_n, -2 * d);
            this.pos.x = cfg.wallCX - _n.x * (cfg.wallR - 0.22);
            this.pos.z = cfg.wallCZ - _n.z * (cfg.wallR - 0.22);
            this.banks++;
            onBank(this.pos, _n);
          }
        }
      }
      if (this.pos.y < cfg.wallBot) {
        this.pos.y = cfg.wallBot; this.vel.y = Math.abs(this.vel.y);
        this.banks++;
        onBank(this.pos, _nUp);
      }
      if (this.pos.y > cfg.wallTop) {
        this.pos.y = cfg.wallTop; this.vel.y = -Math.abs(this.vel.y);
        this.banks++;
        onBank(this.pos, _nDown);
      }
      for (const o of cfg.obstacles) {
        _v1.copy(this.pos).sub(o.pos);
        if (o.cylinder) _v1.y = 0;
        const dist = _v1.length();
        if (dist < o.r + 0.16 && dist > 0.0001) {
          _n.copy(_v1).normalize();
          const d = this.vel.dot(_n);
          if (d < 0) {
            this.vel.addScaledVector(_n, -2 * d);
            this.pos.copy(o.pos).addScaledVector(_n, o.r + 0.18);
            this.banks++;
            onBank(this.pos, _n);
          }
        }
      }
      if (this.t > cfg.returnT || this.banks > MAX_BANKS) this.startReturn();
    } else if (this.state === "return") {
      _v1.copy(this.home).sub(this.pos);
      const d = _v1.length();
      if (d < 0.45) { this.state = "held"; this.caught = true; this.trail.visible = false; return; }
      _v1.normalize();
      this.vel.lerp(_v1.multiplyScalar(22), Math.min(1, dt * 10));
      this.pos.addScaledVector(this.vel, dt);
    }
    for (let i = 11; i > 0; i--) {
      this.trailPositions[i * 3] = this.trailPositions[(i - 1) * 3];
      this.trailPositions[i * 3 + 1] = this.trailPositions[(i - 1) * 3 + 1];
      this.trailPositions[i * 3 + 2] = this.trailPositions[(i - 1) * 3 + 2];
    }
    this.trailPositions[0] = this.pos.x;
    this.trailPositions[1] = this.pos.y;
    this.trailPositions[2] = this.pos.z;
    this.trail.children[0].geometry.attributes.position.needsUpdate = true;
  }

  reflectPlane(axis, value, inward, onBank) {
    const normal = axis === "x" ? _n.set(inward, 0, 0) : _n.set(0, 0, inward);
    const d = this.vel.dot(normal);
    if (d >= 0) return;
    this.vel.addScaledVector(normal, -2 * d);
    this.pos[axis] = value + inward * 0.02;
    this.banks++;
    onBank(this.pos, normal);
  }
}

// ---------------------------------------------------------------- enemy
class Enemy {
  constructor(kit) {
    this.mesh = kit.makeEnemy();
    this.refs = this.mesh.userData;
    this.pos = new THREE.Vector3(0, 0, ENEMY_CZ);
    this.prev = this.pos.clone();
    this.state = "move";
    this.pips = PIPS;
    this.yaw = 0;
    this.movePhase = 0;
    this.windupDur = 0.7;
    this.target = new THREE.Vector2(0, ENEMY_CZ);
    this.buckler = kit.makeBuckler(COL.amber);
    this.buckler.visible = false;
    this.refs.armL.mount.add(this.buckler);
  }

  // swap the procedural program body for the skinned Sentinel once loaded
  attachRig(rig) {
    const parent = this.mesh.parent;
    if (parent) {
      parent.remove(this.mesh);
      parent.add(rig.root);
    }
    rig.root.visible = this.mesh.visible;
    rig.root.position.copy(this.mesh.position);
    rig.root.rotation.copy(this.mesh.rotation);
    this.mesh = rig.root;
    this.rig = rig;
    this.buckler = rig.buckler;
    // the cross-file contract: held-disc visibility + the flash material
    this.refs = { heldDisc: rig.handDisc, seamMat: rig.chestLight.material };
  }

  reset(rng, roam) {
    this.roam = roam;
    this.state = "move";
    this.pips = PIPS;
    this.pos.set(roam.cx + rng.range(-0.8, 0.8), 0, roam.cz + rng.range(-0.8, 0.8));
    this.prev.copy(this.pos);
    this.cool = rng.range(1.2, 2.0);
    this.moveT = 0;
    this.t = 0;
    this.dodgeCd = 0;
    this.velX = 0; this.velZ = 0;
    this.mesh.visible = true;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, 0, 0);
    this.refs.seamMat.color.setHex(COL.amber);
    this.buckler.visible = false;
    this.refs.heldDisc.visible = true;
  }

  update(dt, ctx) {
    const { rng, tier, playerHead, myDisc, playerDisc, onThrow } = ctx;
    this.prev.copy(this.pos);
    const wantYaw = Math.atan2(playerHead.x - this.pos.x, playerHead.z - this.pos.z);
    this.yaw += (wantYaw - this.yaw) * Math.min(1, dt * 8);

    if (this.state === "move") {
      this.moveT -= dt;
      if (this.moveT <= 0) {
        this.moveT = rng.range(0.7, 2.0);
        const a = rng.range(0, Math.PI * 2), rr = rng.range(0, this.roam.r);
        this.target.set(this.roam.cx + Math.cos(a) * rr, this.roam.cz + Math.sin(a) * rr * 0.85);
      }
      const dx = this.target.x - this.pos.x, dz = this.target.y - this.pos.z;
      const d = Math.hypot(dx, dz);
      const spd = 2.0 + tier * 0.5 + rng.range(-0.2, 0.2);
      if (d > 0.15) {
        this.pos.x += (dx / d) * spd * dt;
        this.pos.z += (dz / d) * spd * dt;
        this.movePhase += dt * spd * 2.4;
      }
      this.cool -= dt;
      this.dodgeCd = Math.max(0, this.dodgeCd - dt);
      if (this.cool <= 0 && myDisc.state === "held") {
        this.state = "windup";
        this.windupDur = WINDUP[tier] * rng.range(0.85, 1.25);
        this.t = this.windupDur;
        this.isFeint = rng.chance(FEINT[tier]);
      }
      if (playerDisc.state === "fly" && playerDisc.harmless <= 0) {
        _v1.copy(playerDisc.pos); _v1.y = 0;
        _v2.copy(this.pos); _v2.y = 0;
        const dd = _v1.distanceTo(_v2);
        const closing = playerDisc.vel.dot(_v2.sub(_v1)) > 0;
        // agile programs side-dash, or leap clean over the disc
        if (dd < 6.5 && closing && this.dodgeCd <= 0 && rng.chance(DODGE[tier] * dt * 9)) {
          this.state = "dodge";
          this.t = 0.3;
          this.dodgeCd = 1.8;
          this.jumpDodge = rng.chance(0.5);
          if (this.jumpDodge) this.vy = 3.4;
          const vx = playerDisc.vel.x, vz = playerDisc.vel.z;
          const inv = 1 / (Math.hypot(vx, vz) || 1);
          const side = rng.chance(0.5) ? 1 : -1;
          const spd = this.jumpDodge ? 0.6 : 1;
          this.dodgeX = -vz * inv * side * spd;
          this.dodgeZ = vx * inv * side * spd;
        } else if (dd < 7 && closing && rng.chance(GUARDP[tier] * dt * 6)) {
          this.state = "guard";
          this.t = 0.55;
        }
      }
    } else if (this.state === "dodge") {
      this.t -= dt;
      this.pos.x += this.dodgeX * 7 * dt;
      this.pos.z += this.dodgeZ * 7 * dt;
      this.movePhase += dt * 8;
      if (this.vy || this.pos.y > 0) {
        this.vy -= 10 * dt;
        this.pos.y = Math.max(0, this.pos.y + this.vy * dt);
        if (this.pos.y === 0) this.vy = 0;
      }
      const rx = this.pos.x - this.roam.cx, rz = this.pos.z - this.roam.cz;
      const rr = Math.hypot(rx, rz);
      if (rr > this.roam.r) {
        this.pos.x = this.roam.cx + (rx / rr) * this.roam.r;
        this.pos.z = this.roam.cz + (rz / rr) * this.roam.r;
      }
      if (this.t <= 0 && this.pos.y <= 0) this.state = "move";
    } else if (this.state === "windup") {
      this.t -= dt;
      if (this.isFeint && this.t < this.windupDur * 0.45) {
        this.state = "move";
        this.cool = rng.range(0.3, 0.7);
      } else if (this.t <= 0) {
        onThrow(this);
        this.state = "move";
        this.cool = rng.range(1.1, 2.9) - tier * 0.25;
      }
    } else if (this.state === "guard") {
      this.t -= dt;
      if (this.t <= 0) this.state = "move";
    } else if (this.state === "stagger") {
      this.t -= dt;
      if (this.t <= 0) this.state = "move";
    }
    this.velX = (this.pos.x - this.prev.x) / dt;
    this.velZ = (this.pos.z - this.prev.z) / dt;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  pose(rdt, time) {
    if (this.rig) {
      // skinned Sentinel: GLB gait clips + procedural throw/guard bone layers
      const spd = Math.hypot(this.velX || 0, this.velZ || 0);
      updateSentinelRig(this.rig, rdt, {
        running: (this.state === "move" && spd > 0.4) || this.state === "dodge",
        attacking: this.state === "windup",
        attackProgress: this.state === "windup" ? clamp(1 - this.t / this.windupDur, 0, 1) : 0,
        guarding: this.state === "guard",
        hit: this.state === "stagger" ? 1 : 0,
        speed: Math.max(1, spd),
      });
      if (this.thrownFlash > 0) this.thrownFlash -= rdt;
      const pitch = this.state === "stagger" ? -0.35 : this.thrownFlash > 0 ? 0.12 : 0;
      this.mesh.rotation.x = damp(this.mesh.rotation.x, pitch, 10, rdt);
      const latVel = (this.velX || 0) * Math.cos(this.yaw) - (this.velZ || 0) * Math.sin(this.yaw);
      this.mesh.rotation.z = damp(this.mesh.rotation.z, clamp(-latVel * 0.07, -0.35, 0.35), 9, rdt);
      return;
    }
    const r = this.refs;
    const breathe = Math.sin(time * 2.2) * 0.02;
    r.head.position.y = 0.61 + breathe * 0.4;
    const moving = this.state === "move" || this.state === "dodge";
    const swing = moving ? Math.sin(this.movePhase) * 0.45 : 0;
    // legs: run cycle, throw lunge, or airborne tuck
    let legL = swing, legR = -swing;
    let kneeL = Math.max(0, -swing) * 0.8, kneeR = Math.max(0, swing) * 0.8;
    if (this.thrownFlash > 0) { legL = -0.55; legR = 0.4; kneeL = 0.15; kneeR = 0.5; }
    if (this.state === "dodge" && this.pos.y > 0.05) { legL = -0.7; legR = -0.7; kneeL = 1.25; kneeR = 1.25; }
    r.legL.hip.rotation.x = damp(r.legL.hip.rotation.x, legL, 12, rdt);
    r.legR.hip.rotation.x = damp(r.legR.hip.rotation.x, legR, 12, rdt);
    r.legL.knee.rotation.x = damp(r.legL.knee.rotation.x, kneeL, 12, rdt);
    r.legR.knee.rotation.x = damp(r.legR.knee.rotation.x, kneeR, 12, rdt);

    let armRx = 0.15 + breathe, elbowRx = -0.2;
    let armLx = 0.12, elbowLx = -0.15;
    if (this.state === "move") {
      // arms counter-swing the run
      armRx += swing * -0.4;
      armLx += swing * 0.4;
    }
    if (this.state === "windup") {
      const p = 1 - this.t / this.windupDur;
      armRx = -2.1 * Math.min(1, p * 1.6);
      elbowRx = -1.2 * Math.min(1, p * 1.6);
      const flick = 0.6 + 0.4 * Math.sin(time * 30);
      r.seamMat.color.setHex(COL.amber).lerp(_white, Math.min(1, p) * flick * 0.7);
      r.suitMat.emissiveIntensity = 1.5 + Math.min(1, p) * flick * 1.3;
    } else if (this.state === "stagger") {
      armRx = 0.6; elbowRx = -0.4;
      r.seamMat.color.setHex(COL.amber);
      r.suitMat.emissiveIntensity = 1.5;
    } else {
      r.seamMat.color.setHex(COL.amber);
      r.suitMat.emissiveIntensity = 1.5;
    }
    if (this.thrownFlash > 0) { this.thrownFlash -= rdt; armRx = 1.1; elbowRx = 0.2; }
    r.armR.shoulder.rotation.x = damp(r.armR.shoulder.rotation.x, armRx, 14, rdt);
    r.armR.elbow.rotation.x = damp(r.armR.elbow.rotation.x, elbowRx, 14, rdt);
    const guardOn = this.state === "guard";
    r.armL.shoulder.rotation.x = damp(r.armL.shoulder.rotation.x, guardOn ? -1.4 : armLx, 14, rdt);
    r.armL.elbow.rotation.x = damp(r.armL.elbow.rotation.x, guardOn ? -0.5 : elbowLx, 14, rdt);
    this.buckler.visible = guardOn;
    const pitch = this.state === "stagger" ? -0.35 : this.thrownFlash > 0 ? 0.12 : 0;
    this.mesh.rotation.x = damp(this.mesh.rotation.x, pitch, 10, rdt);

    // torso wind + release twist
    let twist = 0;
    if (this.state === "windup") twist = -0.55 * Math.min(1, (1 - this.t / this.windupDur) * 1.5);
    else if (this.thrownFlash > 0) twist = 0.4;
    r.torsoGrp.rotation.y = damp(r.torsoGrp.rotation.y, twist, 11, rdt);

    // idle head scan
    const scan = this.state === "move" ? Math.sin(time * 0.8) * 0.25 : 0;
    r.head.rotation.y = damp(r.head.rotation.y, scan, 6, rdt);

    // bank into lateral motion (strafes and dodges read in the body)
    const latVel = this.velX * Math.cos(this.yaw) - this.velZ * Math.sin(this.yaw);
    const lean = clamp(-latVel * 0.07, -0.35, 0.35);
    this.mesh.rotation.z = damp(this.mesh.rotation.z, lean, 9, rdt);
  }
}
const _white = new THREE.Color(0xffffff);

// ---------------------------------------------------------------- mode
export class DiscMode {
  constructor() {
    this.name = "disc";
    this.group = null;
    this.playerVel = new THREE.Vector3();
    this.dashDir = new THREE.Vector3();
    this.hopVel = new THREE.Vector3();
  }

  build(g) {
    const kit = g.kit;
    this.group = new THREE.Group();

    this.playerPlat = new Platform(kit, COL.cyan);
    this.enemyPlat = new Platform(kit, COL.amber);
    this.enemyPlat.group.position.set(0, 0, ENEMY_CZ);
    this.group.add(this.playerPlat.group, this.enemyPlat.group);

    const wallTex = kit.hexTex.clone();
    wallTex.needsUpdate = true;
    wallTex.repeat.set(26, 3);
    this.wallTex = wallTex;
    this.wall = new THREE.Group();
    this.wallMat = new THREE.MeshBasicMaterial({ map: wallTex, color: COL.cyan, transparent: true, opacity: 0.48, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const half = 14.5, cy = 3.25, cz = -10;
    for (let i = 0; i < 4; i++) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 6.5), this.wallMat);
      panel.position.y = cy;
      if (i === 0) panel.position.set(0, cy, cz - half);
      if (i === 1) { panel.position.set(0, cy, cz + half); panel.rotation.y = Math.PI; }
      if (i === 2) { panel.position.set(-half, cy, cz); panel.rotation.y = Math.PI / 2; }
      if (i === 3) { panel.position.set(half, cy, cz); panel.rotation.y = -Math.PI / 2; }
      this.wall.add(panel);
    }
    const floorTex = kit.gridTex.clone();
    floorTex.needsUpdate = true;
    floorTex.repeat.set(30, 30);
    this.arenaFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2, half * 2),
      new THREE.MeshBasicMaterial({ map: floorTex, color: 0x9befff, transparent: true, opacity: 0.76, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.arenaFloor.rotation.x = -Math.PI / 2;
    this.arenaFloor.position.set(0, -0.015, cz);
    this.group.add(this.arenaFloor, this.wall);

    // Grid City on the horizon: tower ring + glowing horizon band
    this.monoliths = new THREE.Group();
    const skyline = kit.makeSkyline(16, 110, 240, 13);
    skyline.position.z = -10;
    const horizon = kit.makeHorizonGlow(380);
    horizon.position.z = -10;
    this.monoliths.add(skyline, horizon);
    this.group.add(this.monoliths);

    // ambient life around the duel
    this.ambient = new THREE.Group();
    this.ribbons = [];
    const ribbonDefs = [[18, 3.2, 0.14], [23, 5.6, -0.1], [28, 7.6, 0.07]];
    for (const [r, y, spd] of ribbonDefs) {
      const wrap = new THREE.Group();
      wrap.position.set(0, y, -10);
      wrap.add(kit.makeDataRibbon(r));
      this.ambient.add(wrap);
      this.ribbons.push({ wrap, spd });
    }
    this.barges = [];
    for (let i = 0; i < 2; i++) {
      const b = kit.makeBarge();
      this.ambient.add(b);
      this.barges.push({ mesh: b, phase: i * Math.PI, r: 72 + i * 18, y: 13 + i * 9, spd: 0.03 + i * 0.012 });
    }
    this.motes = kit.makeMotes(180, 42, 12);
    this.motes.position.set(0, 0, -10);
    this.ambient.add(this.motes);
    this.group.add(this.ambient);

    this.enemy = new Enemy(kit);
    this.group.add(this.enemy.mesh);
    // async: the skinned Sentinel swaps in when the GLB lands; the procedural
    // program keeps playing (and stays as the no-network fallback) until then
    createSentinelRig(kit, COL.amber, COL.amberHi)
      .then((rig) => this.enemy.attachRig(rig))
      .catch(() => { /* procedural program remains */ });

    this.disc = new Disc(kit, COL.cyan, COL.cyanHi);
    this.eDisc = new Disc(kit, COL.amber, COL.amberHi);
    this.disc.mesh.visible = false;
    this.eDisc.mesh.visible = false;
    this.group.add(this.disc.mesh, this.disc.trail, this.eDisc.mesh, this.eDisc.trail);

    this.obstacles = [];
    this.shards = [];
    for (let i = 0; i < 2; i++) {
      const s = kit.makeShard();
      s.visible = false;
      this.group.add(s);
      this.shards.push(s);
      this.obstacles.push({ pos: new THREE.Vector3(), r: 1.25, active: false, mesh: s });
    }
    const py = kit.makePylon();
    py.visible = false;
    py.position.set(0, 0, -10);
    this.group.add(py);
    this.pylon = { pos: new THREE.Vector3(0, 0, -10), r: 1.35, cylinder: true, active: false, mesh: py };
    this.obstacles.push(this.pylon);

    // AR pieces: floor pits + bank flashes
    this.holes = [];
    for (let i = 0; i < 10; i++) {
      const h = kit.makeHole(0.5 + Math.random() * 0.35);
      h.visible = false;
      this.group.add(h);
      this.holes.push({ mesh: h, active: false, x: 0, z: 0, r: h.userData.r, grow: 0 });
    }
    this.flashes = [];
    for (let i = 0; i < 4; i++) {
      const f = kit.makeBankFlash();
      this.group.add(f);
      this.flashes.push({ mesh: f, life: 0 });
    }
    // AR breaches: impact points blast the real surface open into the Grid
    this.breaches = [];
    for (let i = 0; i < 6; i++) {
      const b = kit.makeBreach();
      this.group.add(b);
      this.breaches.push({ mesh: b, life: 0, normal: new THREE.Vector3(), r: 0.62 });
    }

    this.time = 0;
  }

  enter(g) {
    if (!this.group) this.build(g);
    g.scene.add(this.group);
    g.audio.playMusic("mus_combat");
    g.hud.showGameplay(true);
    g.hud.hint(g.inXR || g.input.touch.active ? "" : STR.quitHint);
    this.ar = g.isAR && (g.inXR || g.simulateAR);
    this.spdMul = this.ar ? 0.6 : 1;
    this.enemyIdx = clamp(Store.get("discWins") || 0, 0, 2);
    this.pWins = 0; this.eWins = 0;
    this.round = 1;
    this.rng = new RNG(((Date.now() >>> 2) & 0xffff) * 31 + this.enemyIdx * 7 + 1);
    this.playerPips = PIPS;
    this.dashT = 0; this.dashCd = 0;
    this.py = 0; this.vy = 0; this.grounded = true;
    this.warned = false;
    // world visibility per mode
    this.playerPlat.group.visible = !this.ar;
    this.enemyPlat.group.visible = !this.ar;
    this.wall.visible = !this.ar;
    this.arenaFloor.visible = !this.ar;
    this.monoliths.visible = !this.ar;
    this.ambient.visible = !this.ar;
    g.rig.position.set(0, 0, 0);
    g.rig.rotation.set(0, 0, 0);
    g.setDesktopEye();
    if (this.ar && !g.roomBounds) {
      this.state = "arSetup";
      this.t = 0;
      this.enemy.mesh.visible = false;
      this.disc.mesh.visible = false;
      this.eDisc.mesh.visible = false;
      g.banner([STR.arSetup, STR.arRoomHint], 4.0);
    } else {
      this.startRound(g, true);
      if (this.ar && g.testBreach) {
        const rb = g.roomBounds;
        this.spawnBreach(g, _v1.set(rb.maxX, 1.2, rb.z), _v2.set(-1, 0, 0));
        this.spawnHole(g, rb.x + 1.2, rb.z - 0.5, 0, 0);
      }
    }
    g.lockPointer();
  }

  exit(g) {
    g.scene.remove(this.group);
    g.hud.showGameplay(false);
    g.vignetteSet(0);
  }

  // wall + roam config for the current mode/room
  refreshConfig(g) {
    if (this.ar) {
      const rb = g.roomBounds;
      const r = rb ? clamp(rb.r, 2.2, 5) : 4.2;
      const cx = rb ? rb.x : 0, cz = rb ? rb.z : -1.2;
      this.cfg = rb && Number.isFinite(rb.minX)
        ? { square: true, minX: rb.minX + 0.08, maxX: rb.maxX - 0.08, minZ: rb.minZ + 0.08, maxZ: rb.maxZ - 0.08, wallTop: 2.8, wallBot: 0.12, obstacles: _noObs, returnT: 2.0 }
        : { wallR: r + 0.6, wallCX: cx, wallCZ: cz, wallTop: 3.0, wallBot: 0.12, obstacles: _noObs, returnT: 2.0 };
      // enemy roams the far side of the room from the player
      g.headWorld(_v1);
      _v2.set(cx - _v1.x, 0, cz - _v1.z);
      if (_v2.lengthSq() < 0.04) _v2.set(0, 0, -1);
      _v2.normalize();
      const minX = rb && Number.isFinite(rb.minX) ? rb.minX : cx - r;
      const maxX = rb && Number.isFinite(rb.maxX) ? rb.maxX : cx + r;
      const minZ = rb && Number.isFinite(rb.minZ) ? rb.minZ : cz - r;
      const maxZ = rb && Number.isFinite(rb.maxZ) ? rb.maxZ : cz + r;
      const ex = clamp(cx + _v2.x * r * 0.55, minX + 0.45, maxX - 0.45);
      const ez = clamp(cz + _v2.z * r * 0.55, minZ + 0.45, maxZ - 0.45);
      this.roam = { cx: ex, cz: ez, r: Math.min(1.2, r * 0.35) };
    } else {
      const obs = [];
      for (const o of this.obstacles) if (o.active) obs.push(o);
      this.cfg = { square: true, minX: -14.25, maxX: 14.25, minZ: -24.25, maxZ: 4.25, wallTop: 6.25, wallBot: 0.18, obstacles: obs, returnT: RETURN_T };
      this.roam = { cx: 0, cz: ENEMY_CZ, r: ENEMY_R - 0.6 };
    }
  }

  arenaSetup() {
    const shardsOn = this.enemyIdx === 1 && !this.ar;
    for (const o of this.obstacles) {
      if (o === this.pylon) { o.active = this.enemyIdx === 2 && !this.ar; o.mesh.visible = o.active; }
      else { o.active = shardsOn; o.mesh.visible = shardsOn; }
    }
  }

  startRound(g, matchIntro) {
    this.layout = layoutFor(this.enemyIdx, this.round);
    if (!this.ar) {
      this.playerPlat.rebuild(this.layout);
      this.enemyPlat.rebuild([{ cx: 0, cz: 0, r: ENEMY_R + 0.6, big: true }]);
    }
    for (const h of this.holes) { h.active = false; h.mesh.visible = false; }
    this.arenaSetup();
    this.refreshConfig(g);
    this.playerPips = PIPS;
    this.enemy.reset(this.rng, this.roam);
    this.disc.state = "held";
    this.eDisc.state = "held";
    this.py = 0; this.vy = 0; this.grounded = true;
    this.openingCooldown = 0;
    if (!this.ar) {
      g.rig.position.set(this.layout[0].cx, 0, this.layout[0].cz);
    }
    this.state = "intro";
    this.t = matchIntro ? 2.6 : 1.8;
    g.banner([
      matchIntro ? `${STR.you} ${STR.vs} ${STR.enemies[this.enemyIdx]}` : STR.enemies[this.enemyIdx],
      `${STR.discArenas[this.enemyIdx]}  ·  ${STR.hudRound} ${this.round} / 3`,
    ], this.t - 0.3);
    this.hudDirty = true;
  }

  playerHeadPos(g, out) { return g.headWorld(out); }

  throwPlayerDisc(g, dirHint, fromXR) {
    if (this.disc.state !== "held" || this.state !== "fight") return;
    const from = _v1;
    g.discHandWorld(from);
    const dir = _v2;
    _chest.set(this.enemy.pos.x, 1.15, this.enemy.pos.z);
    if (fromXR && dirHint) {
      dir.copy(dirHint).normalize();
      _v3.copy(_chest).sub(from).normalize();
      if (dir.dot(_v3) > 0.45) dir.lerp(_v3, 0.18).normalize();
    } else {
      // converge the throw on the crosshair: aim from the HAND at what the CAMERA sees
      g.headWorld(_camP);
      g.camForward(dir);
      let snapped = false;
      const s = _mid.copy(_chest).sub(_camP).dot(dir);
      if (s > 2) {
        _v3.copy(_camP).addScaledVector(dir, s);
        if (_v3.distanceTo(_chest) < 1.5) {
          dir.copy(_chest).sub(from).normalize();
          snapped = true;
        }
      }
      if (!snapped) {
        _v3.copy(_camP).addScaledVector(dir, 26);
        dir.copy(_v3).sub(from).normalize();
      }
    }
    this.disc.throwFrom(from, dir, DISC_SPEED * this.spdMul);
    g.audio.sfx("sfx_disc_throw", { vol: 1 });
    g.hapticDisc(0.7, 60);
    this.hudDirty = true;
  }

  enemyThrow(enemy) {
    const g = this.g;
    const tier = this.enemyIdx;
    const from = _v1.set(enemy.pos.x, 1.45, enemy.pos.z);
    const head = _v2;
    this.playerHeadPos(g, head);
    const dist = from.distanceTo(head);
    const speed = ENEMY_DISC_SPEED[tier] * this.spdMul;
    const tFly = dist / speed;
    // variable lead: sometimes aims where you are, sometimes where you're going
    head.addScaledVector(this.playerVel, Math.min(tFly, 0.8) * this.rng.range(0.25, 1.0));
    let e = AIM_ERR[tier];
    if (this.rng.chance(0.2)) e *= 2.2; // wild shot
    head.x += this.rng.range(-e, e);
    head.y += this.rng.range(-e * 0.5, e * 0.4);
    head.z += this.rng.range(-e, e);
    const dir = _v3;
    const bankP = Math.min(0.15 + tier * 0.18, 0.55);
    if (this.rng.chance(bankP)) {
      const c = this.cfg;
      const side = this.rng.chance(0.5) ? 1 : -1;
      if (c.square) {
        const wallX = side < 0 ? c.minX : c.maxX;
        _bankPt.copy(head);
        _bankPt.x = 2 * wallX - head.x;
        dir.copy(_bankPt).sub(from).normalize();
      } else {
        const bearing = Math.atan2(head.x - from.x, head.z - from.z);
        const th = bearing + side * this.rng.range(0.6, 1.15);
        const bx = c.wallCX + Math.sin(th) * c.wallR, bz = c.wallCZ + Math.cos(th) * c.wallR;
        const B = _bankPt.set(bx, 1.6, bz);
        const n = _bankN.set((c.wallCX - bx) / c.wallR, 0, (c.wallCZ - bz) / c.wallR);
        const dRef = (head.x - B.x) * n.x + (head.y - B.y) * n.y + (head.z - B.z) * n.z;
        head.addScaledVector(n, -2 * dRef);
        dir.copy(head).sub(from).normalize();
      }
    } else {
      dir.copy(head).sub(from).normalize();
    }
    this.eDisc.throwFrom(from, dir, speed);
    enemy.thrownFlash = 0.25;
    enemy.refs.heldDisc.visible = false;
    g.audio.sfx("sfx_disc_throw", { pos: from, vol: 0.85, rate: 0.9 });
  }

  spawnHole(g, nearX, nearZ, minD, maxD) {
    const slot = this.holes.find((h) => !h.active);
    if (!slot) return;
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(minD, maxD);
    let x = nearX + Math.cos(a) * d, z = nearZ + Math.sin(a) * d;
    if (g.roomBounds) {
      const rb = g.roomBounds;
      const dd = Math.hypot(x - rb.x, z - rb.z);
      const maxR = Math.max(0.5, rb.r - slot.r - 0.2);
      if (dd > maxR) { x = rb.x + ((x - rb.x) / dd) * maxR; z = rb.z + ((z - rb.z) / dd) * maxR; }
    }
    slot.active = true;
    slot.x = x; slot.z = z;
    slot.grow = 0;
    slot.mesh.position.set(x, 0, z);
    slot.mesh.scale.setScalar(0.01);
    slot.mesh.visible = true;
    _v1.set(x, 0.05, z);
    g.shatter.spawn(_v1, COL.cyan, 18, 2.0, 2.2);
    g.audio.sfx("sfx_shatter", { pos: _v1, rate: 0.9 });
    if (!this.warned) {
      this.warned = true;
      g.banner([STR.arFloorWarn], 2.2);
    }
  }

  overHole(x, z) {
    for (const h of this.holes) {
      if (!h.active || h.grow < 0.9) continue;
      const dx = x - h.x, dz = z - h.z;
      if (dx * dx + dz * dz < (h.r * 0.85) * (h.r * 0.85)) return true;
    }
    return false;
  }

  nearWallOpening(x, z) {
    for (const b of this.breaches) {
      if (b.life <= 0.8 || Math.abs(b.normal.y) > 0.45) continue;
      const dx = x - b.mesh.position.x, dz = z - b.mesh.position.z;
      if (dx * dx + dz * dz < b.r * b.r) return true;
    }
    return false;
  }

  nearOpening(x, z) { return this.overHole(x, z) || this.nearWallOpening(x, z); }

  // AR portals are lethal: touch one and you fall into the digital world.
  fallIntoGrid(g) {
    if (this.state !== "fight") return;
    this.state = "gridFall";
    this.t = 1.4;
    this.playerPips = 0;
    g.banner([STR.gridFall], 1.8);
    g.audio.tone(320, 1.2, "sawtooth", 0.32, 40);
    g.audio.sfx("sfx_shatter", { vol: 1 });
    const head = this.playerHeadPos(g, _v1);
    g.shatter.spawn(head, COL.cyan, 70, 3.4, 2.8, 1.4);
    g.hapticDisc(1, 300); g.hapticGuard(1, 300);
    g.flash(0.6);
    this.hudDirty = true;
  }

  loseEnemyToOpening(g) {
    this.enemy.pips = 0;
    this.openingCooldown = 1.8;
    g.banner([STR.enemyOpeningFall], 1.4);
    g.audio.sfx("sfx_shatter", { pos: this.enemy.pos });
    this.hudDirty = true;
    this.roundOver(g, true);
  }

  hitEnemy(g) {
    this.enemy.state = "stagger";
    this.enemy.t = 0.6;
    _v1.set(this.enemy.pos.x, 1.2, this.enemy.pos.z);
    g.shatter.spawn(_v1, COL.amber, 22, 2.6, 2.4);
    if (!this.ar) this.enemyPlat.shatterNear(this.enemy.pos, 3, g.shatter, COL.amber);
    g.audio.sfx("sfx_shatter", { pos: _v1 });
    this.disc.startReturn();
    this.disc.harmless = 0.5;
    if (this.ar && this.nearOpening(this.enemy.pos.x, this.enemy.pos.z)) {
      this.loseEnemyToOpening(g);
      return;
    }
    this.enemy.pips--;
    this.hudDirty = true;
    if (this.enemy.pips <= 0) this.roundOver(g, true);
  }

  hitPlayer(g) {
    const head = this.playerHeadPos(g, _v1);
    g.shatter.spawn(head, COL.cyan, 16, 2.2, 1.6);
    if (!this.ar) this.playerPlat.shatterNear(g.rig.position, 3, g.shatter, COL.cyan, 1.2);
    g.audio.sfx("sfx_shatter", { vol: 0.9 });
    g.audio.hurt();
    g.hapticDisc(1.0, 120); g.hapticGuard(1.0, 120);
    g.flash(0.35);
    this.eDisc.startReturn();
    this.eDisc.harmless = 0.5;
    if (this.ar && this.nearOpening(head.x, head.z)) {
      this.fallIntoGrid(g);
      return;
    }
    this.playerPips--;
    this.hudDirty = true;
    if (this.playerPips <= 0) this.roundOver(g, false);
  }

  roundOver(g, playerWon, fell = false) {
    if (playerWon) {
      this.pWins++;
      this.state = "enemyDeath";
      this.t = 1.9;
      g.audio.stingWin();
    } else {
      this.eWins++;
      this.state = "reboot";
      this.t = 3.2;
      this.rebootTick = 3;
      g.banner([fell ? STR.fellVoid : STR.playerDown, `${STR.rebooting} 3`], 3.0);
      g.audio.stingLose();
    }
    this.hudDirty = true;
  }

  advance(g) {
    const matchOver = this.pWins >= 2 || this.eWins >= 2;
    if (!matchOver) {
      this.round++;
      this.startRound(g, false);
      return;
    }
    if (this.pWins >= 2) {
      const wins = Math.max(Store.get("discWins") || 0, this.enemyIdx + 1);
      Store.set("discWins", wins);
      if (this.enemyIdx >= 2) {
        g.banner([STR.campaignDone], 3.5);
        this.state = "exit";
        this.t = 3.6;
      } else {
        this.enemyIdx++;
        this.pWins = 0; this.eWins = 0; this.round = 1;
        g.banner([STR.enemyDown, `${STR.nextChallenger}: ${STR.enemies[this.enemyIdx]}`], 2.4);
        this.state = "nextEnemy";
        this.t = 2.6;
      }
    } else {
      g.banner([STR.matchLost], 2.6);
      this.state = "exit";
      this.t = 2.8;
    }
  }

  // does anything hold the player up at this position?
  hasSupport(g, x, z) {
    if (this.ar) return !this.overHole(x, z);
    return x > -14.2 && x < 14.2 && z > -24.2 && z < 4.2;
  }

  update(g, dt, events) {
    this.g = this.g || g;
    this.time += dt;
    const inXR = g.inXR;
    if (this.ar) this.refreshConfig(g); // room bounds can refine over time
    if (this.state === "arSetup") {
      if (!g.roomBounds && events.some((e) => e.type === "primary" || e.type === "xrThrow")) {
        g.headWorld(_head);
        g.roomBounds = { x: _head.x, z: _head.z - 1.5, r: 2.6, minX: _head.x - 2.2, maxX: _head.x + 2.2, minZ: _head.z - 4.2, maxZ: _head.z + 1.2, source: "manual" };
      }
      if (g.roomBounds) {
        this.refreshConfig(g);
        this.startRound(g, true);
        g.banner([STR.arSpaceReady], 1.8);
      }
      return;
    }

    // ---- state timers
    if (this.state !== "fight") {
      this.t -= dt;
      if (this.state === "enemyDeath") {
        if (!this.deathBurst && this.t < 1.4) {
          this.deathBurst = true;
          _v1.set(this.enemy.pos.x, 1.2, this.enemy.pos.z);
          g.shatter.spawn(_v1, COL.amber, 60, 3.4, 3.2, 1.6);
          g.audio.sfx("sfx_shatter", { pos: _v1, rate: 0.8 });
          this.enemy.mesh.visible = false;
          if (this.ar) this.spawnHole(g, this.enemy.pos.x, this.enemy.pos.z, 0, 0.2);
          else this.enemyPlat.shatterNear(this.enemy.pos, 6, g.shatter, COL.amber);
          const won = this.pWins >= 2;
          g.banner([won ? STR.enemyDown : STR.roundWon], 1.4);
        }
        if (this.t <= 0) { this.deathBurst = false; this.advance(g); }
      } else if (this.state === "reboot") {
        const tick = Math.ceil(this.t - 0.2);
        if (tick !== this.rebootTick && tick >= 1) {
          this.rebootTick = tick;
          g.banner([STR.playerDown, `${STR.rebooting} ${tick}`], 1.0);
          g.audio.count();
        }
        g.vignetteSet(clamp((3.2 - this.t) * 1.4, 0, 1));
        if (this.t <= 0) {
          g.vignetteSet(0);
          this.advance(g);
        }
      } else if (this.state === "gridFall") {
        // the room tears away: vignette closes in while the fall plays out
        g.vignetteSet(clamp((1.4 - this.t) * 1.2, 0, 1));
        if (this.t <= 0) this.roundOver(g, false, true);
      } else if (this.state === "intro") {
        if (this.t <= 0) this.state = "fight";
      } else if (this.state === "nextEnemy") {
        if (this.t <= 0) this.startRound(g, true);
      } else if (this.state === "exit") {
        if (this.t <= 0) { g.setMode("hub"); return; }
      }
    }

    // ---- player motion + vertical physics
    g.input.moveVec(_mv, inXR);
    this.playerVel.set(0, 0, 0);
    const inPlay = this.state === "fight" || this.state === "intro";
    if (inPlay) {
      const yaw = g.viewYaw();
      const f = _v1.set(Math.sin(yaw), 0, Math.cos(yaw));
      const rgt = _v2.set(f.z, 0, -f.x);
      const spd = (inXR ? 3.2 : MOVE_SPD) * (this.grounded ? 1 : 0.7);
      _v3.set(0, 0, 0);
      _v3.addScaledVector(f, -_mv.y * spd);
      _v3.addScaledVector(rgt, -_mv.x * spd);
      if (this.dashT > 0) {
        this.dashT -= dt;
        _v3.copy(this.dashDir).multiplyScalar(DASH_SPD);
      }
      if (!this.grounded) _v3.add(this.hopVel);
      this.dashCd = Math.max(0, this.dashCd - dt);
      g.rig.position.x += _v3.x * dt;
      g.rig.position.z += _v3.z * dt;
      this.playerVel.copy(_v3);

      // support + gravity (real falling; no invisible rails)
      const head = this.playerHeadPos(g, _head);
      const px = inXR ? head.x : g.rig.position.x;
      const pz = inXR ? head.z : g.rig.position.z;
      // stepping onto a floor portal or against a wall portal is fatal in AR
      const floorOpening = this.ar && this.overHole(px, pz);
      const wallOpening = this.ar && this.nearWallOpening(px, pz);
      if ((floorOpening || wallOpening) && this.state === "fight") this.fallIntoGrid(g);
      if (this.grounded) {
        if (!this.ar && !this.hasSupport(g, px, pz)) { this.grounded = false; this.vy = 0; }
      }
      if (!this.grounded) {
        this.vy -= GRAV * dt;
        this.py += this.vy * dt;
        if (this.py <= 0 && this.vy <= 0 && this.hasSupport(g, px, pz)) {
          this.py = 0; this.vy = 0; this.grounded = true;
          this.hopVel.set(0, 0, 0);
          g.audio.blip();
        }
        if (this.py < 0) g.vignetteSet(clamp(-this.py * 0.5, 0, 1));
        if (this.py < -3 && this.state === "fight") {
          this.roundOver(g, false, true);
          this.py = -3;
        }
      }
      g.rig.position.y = this.py;
    }

    // ---- events
    for (const e of events) {
      if (!inPlay) break;
      if (e.type === "primary" && !inXR) this.throwPlayerDisc(g, null, false);
      else if (e.type === "xrThrow" && e.velocity && e.velocity.length() > 1.3) this.throwPlayerDisc(g, e.velocity, true);
      else if (e.type === "jump" && this.grounded && !this.ar) {
        this.grounded = false; this.vy = JUMP_V;
        g.audio.dash();
      }
      else if (e.type === "hop" && this.grounded && !this.ar && inXR) {
        this.grounded = false; this.vy = 4.0;
        g.camForward(_v1); _v1.y = 0; _v1.normalize();
        this.hopVel.copy(_v1).multiplyScalar(2.6);
        g.audio.dash();
      }
      else if (e.type === "dash" && this.dashCd <= 0 && !inXR) {
        g.input.moveVec(_mv, false);
        const yaw = g.viewYaw();
        const f = _v1.set(Math.sin(yaw), 0, Math.cos(yaw));
        const rgt = _v2.set(f.z, 0, -f.x);
        if (Math.abs(_mv.x) + Math.abs(_mv.y) < 0.1) this.dashDir.copy(f);
        else this.dashDir.set(0, 0, 0).addScaledVector(f, -_mv.y).addScaledVector(rgt, -_mv.x).normalize();
        this.dashT = DASH_T; this.dashCd = DASH_CD;
        g.audio.dash();
      }
      else if (e.type === "recall") this.disc.startReturn();
      else if (e.type === "gripSqueeze" && inXR && this.disc.state === "fly") {
        // thumb-grip squeeze after a toss calls the disc home
        this.disc.startReturn();
        g.hapticDisc(0.3, 40);
      }
      else if (e.type === "snapL") g.rig.rotation.y += Math.PI / 6;
      else if (e.type === "snapR") g.rig.rotation.y -= Math.PI / 6;
    }

    if (this.state !== "fight") {
      this.updateDiscs(g, dt);
      return;
    }

    // ---- enemy
    const head = this.playerHeadPos(g, _head);
    this.enemy.roam = this.roam;
    this.enemy.update(dt, {
      rng: this.rng,
      tier: this.enemyIdx,
      playerHead: head,
      myDisc: this.eDisc,
      playerDisc: this.disc,
      onThrow: (en) => this.enemyThrow(en),
    });

    this.updateDiscs(g, dt);
    this.openingCooldown = Math.max(0, (this.openingCooldown || 0) - dt);
    if (this.ar && this.openingCooldown <= 0) {
      if (this.nearOpening(this.enemy.pos.x, this.enemy.pos.z)) this.loseEnemyToOpening(g);
    }

    // ---- hits (swept: test endpoint AND midpoint of this step)
    if (this.disc.state === "fly" && this.disc.harmless <= 0 && this.enemy.pips > 0) {
      _v1.set(this.enemy.pos.x, 0.25 + this.enemy.pos.y, this.enemy.pos.z);
      _v2.set(this.enemy.pos.x, 1.75 + this.enemy.pos.y, this.enemy.pos.z);
      _mid.lerpVectors(this.disc.prev, this.disc.pos, 0.5);
      const d = Math.min(distPointSeg(this.disc.pos, _v1, _v2), distPointSeg(_mid, _v1, _v2));
      if (this.enemy.state === "guard" && d < 1.0) {
        _n.copy(this.disc.pos).sub(this.enemy.pos).setY(0.4).normalize();
        this.disc.vel.reflect(_n).multiplyScalar(0.9);
        this.disc.harmless = 0.8;
        g.audio.deflect();
        g.audio.sfx("sfx_ricochet", { pos: this.disc.pos, rate: 0.8 });
      } else if (d < 0.55) {
        this.hitEnemy(g);
      }
    }
    if (this.eDisc.state === "fly" && this.eDisc.harmless <= 0) {
      const guardOn = g.input.guardHeld(inXR);
      if (guardOn) {
        g.guardWorld(_v3);
        if (this.eDisc.pos.distanceTo(_v3) < 0.6) {
          _n.copy(this.eDisc.pos).sub(_v3).normalize();
          if (_n.dot(this.eDisc.vel) < 0) {
            this.eDisc.vel.reflect(_n);
            this.eDisc.vel.y = Math.abs(this.eDisc.vel.y) * 0.5 + 2;
            this.eDisc.harmless = 1.0;
            g.audio.deflect();
            g.hapticGuard(0.8, 80);
          }
        }
      }
      // player capsule follows the actual body (headset or rig), dash grants i-frames
      if (this.dashT <= 0) {
        const bx = inXR ? head.x : g.rig.position.x;
        const bz = inXR ? head.z : g.rig.position.z;
        _v1.set(bx, this.py + 0.35, bz);
        _v2.set(bx, head.y, bz);
        _mid.lerpVectors(this.eDisc.prev, this.eDisc.pos, 0.5);
        const dp = Math.min(distPointSeg(this.eDisc.pos, _v1, _v2), distPointSeg(_mid, _v1, _v2));
        if (dp < 0.3) this.hitPlayer(g);
      }
    }

    if (this.hudDirty) {
      this.hudDirty = false;
      g.hud.set({
        pips: this.playerPips, epips: this.enemy.pips,
        round: `${STR.hudRound} ${this.round} / 3`,
        enemy: STR.enemies[this.enemyIdx],
        disc: this.disc.state === "held" ? STR.hudDiscReady : this.disc.state === "fly" ? STR.hudDiscFlying : STR.hudDiscReturning,
      });
    }
  }

  updateDiscs(g, dt) {
    const onBank = (p, normal) => {
      g.audio.sfx("sfx_ricochet", { pos: p });
      this.bankFlash(p, normal);
      if (this.ar) {
        this.spawnBreach(g, p, normal);
        if (normal.y > 0.55) this.spawnHole(g, p.x, p.z, 0, 0);
      }
    };
    const prevState = this.disc.state;
    g.discHandWorld(_handP);
    this.disc.home.copy(_handP);
    this.disc.update(dt, this.cfg, onBank);
    if (this.disc.caught) {
      this.disc.caught = false;
      g.audio.catchSnap();
      g.hapticDisc(0.4, 40);
      this.hudDirty = true;
    }
    if (prevState !== this.disc.state) this.hudDirty = true;

    this.eDisc.home.set(this.enemy.pos.x, 1.45, this.enemy.pos.z);
    this.eDisc.update(dt, this.cfg, onBank);
    if (this.eDisc.state === "held") this.enemy.refs.heldDisc.visible = true;
  }

  bankFlash(p, normal) {
    const slot = this.flashes.find((f) => f.life <= 0) || this.flashes[0];
    slot.life = 0.4;
    slot.mesh.visible = true;
    slot.mesh.position.copy(p);
    _v1.copy(p).add(normal);
    slot.mesh.lookAt(_v1);
  }

  spawnBreach(g, p, normal) {
    let slot = this.breaches.find((b) => b.life <= 0);
    if (!slot) slot = this.breaches.reduce((a, b) => (a.life < b.life ? a : b));
    slot.life = 7;
    slot.normal.copy(normal);
    slot.r = 0.62;
    slot.mesh.visible = true;
    slot.mesh.position.copy(p).addScaledVector(normal, 0.03);
    _v1.copy(p).add(normal);
    slot.mesh.lookAt(_v1);
    slot.mesh.scale.setScalar(0.05);
    g.shatter.spawn(p, COL.cyan, 26, 2.4, 2.2);
    g.audio.sfx("sfx_shatter", { pos: p, rate: 1.15, vol: 0.8 });
  }

  frame(g, rdt, alpha, time) {
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      if (!s.visible) continue;
      const a = time * 0.35 + i * Math.PI;
      const o = this.obstacles[i];
      o.pos.set(Math.cos(a) * 6.5, 1.8 + Math.sin(time * 0.8 + i) * 0.6, -10 + Math.sin(a) * 6.5);
      s.position.copy(o.pos);
      s.rotation.y += rdt * 0.8;
      s.rotation.x += rdt * 0.3;
    }
    this.wallTex.offset.y = (time * 0.02) % 1;
    this.wallTex.offset.x = (time * 0.008) % 1;
    this.wallMat.opacity = 0.43 + 0.12 * Math.sin(time * 1.7);

    // ambient motion: ribbons orbit, barges patrol, motes drift, grid flows
    if (this.ambient.visible) {
      for (const rb of this.ribbons) rb.wrap.rotation.y += rdt * rb.spd;
      for (const bg of this.barges) {
        bg.phase += rdt * bg.spd;
        const bx = Math.cos(bg.phase) * bg.r;
        const bz = -10 + Math.sin(bg.phase) * bg.r;
        bg.mesh.position.set(bx, bg.y + Math.sin(time * 0.4 + bg.phase) * 0.8, bz);
        bg.mesh.rotation.y = -bg.phase;
        bg.mesh.rotation.z = 0.1;
      }
      this.motes.rotation.y += rdt * 0.012;
      if (g.sky.visible) g.sky.rotation.y += rdt * 0.004;
      if (g.voidFloor.visible) g.voidFloor.material.map.offset.y = (time * 0.005) % 1;
    }

    // AR holes scale in; bank flashes fade
    for (const h of this.holes) {
      if (!h.active) continue;
      if (h.grow < 1) {
        h.grow = Math.min(1, h.grow + rdt * 2.2);
        h.mesh.scale.setScalar(Math.max(0.01, h.grow));
      }
    }
    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= rdt;
        f.mesh.material.opacity = Math.max(0, f.life * 2);
        if (f.life <= 0) f.mesh.visible = false;
      }
    }
    for (const b of this.breaches) {
      if (b.life <= 0) continue;
      b.life -= rdt;
      const s = b.life > 6.6 ? (7 - b.life) / 0.4 : b.life < 0.8 ? b.life / 0.8 : 1;
      b.mesh.scale.setScalar(Math.max(0.02, s));
      if (b.life <= 0) b.mesh.visible = false;
    }

    this.renderDisc(g, this.disc, alpha, true, time);
    this.renderDisc(g, this.eDisc, alpha, false, time);

    this.enemy.pose(rdt, time);
    if (this.enemy.mesh.visible) {
      if (this.state === "enemyDeath") {
        // defeated program spins down and sinks before the burst
        this.enemy.mesh.rotation.y += rdt * 9;
        this.enemy.mesh.position.y -= rdt * 0.55;
        this.enemy.refs.seamMat.color.lerp(_white, Math.min(1, rdt * 12));
      } else {
        this.enemy.mesh.position.lerpVectors(this.enemy.prev, this.enemy.pos, alpha);
        if (this.enemy.state === "move") {
          this.enemy.mesh.position.y += Math.abs(Math.sin(this.enemy.movePhase)) * 0.05;
        }
      }
    }
  }

  renderDisc(g, disc, alpha, mine, time) {
    if (disc.state === "held") {
      if (mine) {
        disc.mesh.visible = true;
        g.discHandWorld(_handP);
        disc.mesh.position.copy(_handP);
        disc.mesh.rotation.set(-0.08, g.viewYaw(), 0.04);
        if (disc.mesh.userData.rotor) disc.mesh.userData.rotor.rotation.y = time * 3;
        disc.mesh.scale.setScalar(g.inXR ? 1 : 0.55);
      } else {
        disc.mesh.visible = false;
      }
      return;
    }
    disc.mesh.scale.setScalar(g.inXR ? 1.15 : 1.4);
    disc.mesh.visible = true;
    disc.mesh.position.lerpVectors(disc.prev, disc.pos, alpha);
    const horiz = Math.max(1, Math.hypot(disc.vel.x, disc.vel.z));
    disc.mesh.rotation.set(clamp(-disc.vel.y / horiz * 0.22, -0.28, 0.28), 0, Math.sin(time * 7) * 0.035);
    if (disc.mesh.userData.rotor) disc.mesh.userData.rotor.rotation.y = time * 24;
  }
}

const _mv = new THREE.Vector2();
const _head = new THREE.Vector3();
const _handP = new THREE.Vector3();
const _bankPt = new THREE.Vector3();
const _bankN = new THREE.Vector3();
const _nUp = new THREE.Vector3(0, 1, 0);
const _nDown = new THREE.Vector3(0, -1, 0);
const _noObs = [];
