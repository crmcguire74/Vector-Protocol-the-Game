import * as THREE from "../vendor/three.module.js";

// Palette from STYLE FORMULA v1: near-black graphite world etched with electric
// cyan; player gear cyan-white; enemies/hazards amber-orange. Signal hues for
// extra AI cycles stay distinct (magenta/green).
export const COL = {
  cyan: 0x00e5ff,
  cyanHi: 0xd9ffff,
  amber: 0xff6a00,
  amberHi: 0xffd9a8,
  magenta: 0xff2fb3,
  green: 0x39ff88,
  graphite: 0x11161f,
  bodyDark: 0x07080d,
  bg: 0x000004,
};

export function pulse(inputSource, val = 0.5, ms = 40) {
  try { inputSource?.gamepad?.hapticActuators?.[0]?.pulse(val, ms); } catch { /* no haptics */ }
}

function canvasTex(size, draw, { repeat = false, sizeY = null } = {}) {
  const c = document.createElement("canvas");
  c.width = size; c.height = sizeY || size;
  draw(c.getContext("2d"), c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  return t;
}

export class WorldKit {
  constructor() {
    // --- tex_floor_grid (manifest): exact-period lines => mathematically seamless
    this.gridTex = canvasTex(512, (g, w, h) => {
      g.fillStyle = "#01030a"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(0,229,255,0.09)"; g.lineWidth = 1;
      for (let i = 0; i <= 16; i++) {
        const p = (i * w) / 16;
        g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke();
        g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke();
      }
      g.strokeStyle = "rgba(0,229,255,0.6)"; g.lineWidth = 2;
      g.shadowColor = "#00e5ff"; g.shadowBlur = 7;
      for (let i = 0; i <= 4; i++) {
        const p = (i * w) / 4;
        g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke();
        g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke();
      }
    }, { repeat: true });

    // --- tex_platform_hex (manifest): grayscale tile with circuit traces, tinted per side
    this.tileTex = canvasTex(256, (g, w, h) => {
      g.fillStyle = "#101010"; g.fillRect(0, 0, w, h);
      // beveled border glow
      g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 9;
      g.shadowColor = "#ffffff"; g.shadowBlur = 20;
      g.strokeRect(7, 7, w - 14, h - 14);
      g.shadowBlur = 0;
      g.strokeStyle = "rgba(255,255,255,0.16)"; g.lineWidth = 2;
      g.strokeRect(24, 24, w - 48, h - 48);
      // circuit traces
      g.strokeStyle = "rgba(255,255,255,0.28)"; g.lineWidth = 3;
      g.shadowColor = "#ffffff"; g.shadowBlur = 6;
      g.beginPath(); g.moveTo(40, h / 2); g.lineTo(w / 2 - 18, h / 2); g.lineTo(w / 2 - 18, 52); g.stroke();
      g.beginPath(); g.moveTo(w - 40, h / 2 + 26); g.lineTo(w / 2 + 30, h / 2 + 26); g.lineTo(w / 2 + 30, h - 52); g.stroke();
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.fillRect(w / 2 - 22, 46, 9, 9);
      g.fillRect(w / 2 + 26, h - 56, 9, 9);
      // subtle center sheen
      const r = g.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w * 0.7);
      r.addColorStop(0, "rgba(255,255,255,0.07)");
      r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });

    // --- tex_wall_energy (manifest): scanlines, tinted + additive (cycle walls)
    this.wallTex = canvasTex(128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) {
        const a = 0.25 + 0.3 * ((y / 8) % 2);
        g.fillStyle = `rgba(255,255,255,${a})`;
        g.fillRect(0, y, w, 3);
      }
      g.fillStyle = "rgba(255,255,255,0.18)";
      for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h);
    }, { repeat: true });

    // --- hex energy field (disc arena wall) - exact-period hex rows, seamless
    this.hexTex = canvasTex(256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = "rgba(255,255,255,0.5)";
      g.lineWidth = 2;
      g.shadowColor = "#ffffff"; g.shadowBlur = 5;
      const s = 32; // hex size => 4 cols x 4 rows per tile
      const hstep = s * 1.5, vstep = s * Math.sqrt(3);
      for (let row = -1; row <= 5; row++) {
        for (let col = -1; col <= 6; col++) {
          const cx = col * hstep;
          const cy = row * vstep + (col % 2 ? vstep / 2 : 0);
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i;
            const x = cx + s * Math.cos(a), y = cy + s * Math.sin(a);
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.closePath(); g.stroke();
        }
      }
    }, { repeat: true });

    this.glowTex = canvasTex(128, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
      r.addColorStop(0, "rgba(255,255,255,1)");
      r.addColorStop(0.35, "rgba(255,255,255,0.45)");
      r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });

    this.vigTex = canvasTex(256, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, "rgba(0,0,0,0)");
      r.addColorStop(0.52, "rgba(0,0,0,0)");
      r.addColorStop(0.78, "rgba(0,0,0,0.85)");
      r.addColorStop(1, "rgba(0,0,0,1)");
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });

    // env-map-ready PBR set (scene.environment is assigned in main.js)
    this.matGraphite = new THREE.MeshStandardMaterial({ color: COL.graphite, metalness: 0.92, roughness: 0.22, envMapIntensity: 1.25 });
    this.matBody = new THREE.MeshStandardMaterial({ color: COL.bodyDark, metalness: 0.78, roughness: 0.34, envMapIntensity: 1.1 });
    this.matGlass = new THREE.MeshStandardMaterial({ color: 0x0c141f, metalness: 1.0, roughness: 0.12, envMapIntensity: 0.85 });
    this.matFloor = new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 0.85, roughness: 0.3, envMapIntensity: 1.0 });

    // program suit: circuit lines glow from the surface itself (emissive map)
    this.suitTex = canvasTex(256, (g, w, h) => {
      g.fillStyle = "#000000"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#ffffff"; g.lineWidth = 5;
      g.shadowColor = "#ffffff"; g.shadowBlur = 5;
      // vertical traces with elbows, ring bands - wraps cleanly around capsules
      for (let i = 0; i < 4; i++) {
        const x = (i + 0.5) * (w / 4);
        g.beginPath();
        g.moveTo(x, 0); g.lineTo(x, h * 0.3);
        g.lineTo(x + (i % 2 ? 14 : -14), h * 0.42);
        g.lineTo(x + (i % 2 ? 14 : -14), h * 0.72);
        g.lineTo(x, h * 0.84); g.lineTo(x, h);
        g.stroke();
      }
      g.lineWidth = 4;
      for (const y of [h * 0.18, h * 0.58, h * 0.9]) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }
      g.fillStyle = "#ffffff";
      g.fillRect(w * 0.42, h * 0.47, 12, 12);
    }, { repeat: true });

    this._box = new THREE.BoxGeometry(1, 1, 1);
  }

  basic(color) { return new THREE.MeshBasicMaterial({ color }); }

  glow(color, scale = 1, opacity = 0.85) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.scale.setScalar(scale);
    return m;
  }

  strip(w, h, d, mat) {
    const m = new THREE.Mesh(this._box, mat);
    m.scale.set(w, h, d);
    return m;
  }

  box(w, h, d, mat) {
    const m = new THREE.Mesh(this._box, mat);
    m.scale.set(w, h, d);
    return m;
  }

  // ---------- mdl_disc ----------
  makeDisc(color, hiColor, withLight = false, detail = true) {
    const g = new THREE.Group();
    // Outer group controls flight attitude; the inner rotor spins flat like a frisbee.
    const rotor = new THREE.Group();
    const mat = this.basic(color);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.03, 12, 48), mat);
    ring.rotation.x = Math.PI / 2;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.128, 0.02, 32), this.matGlass);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.03, 20), this.basic(hiColor));
    if (detail) {
      const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 8, 36), mat);
      innerRing.rotation.x = Math.PI / 2;
      rotor.add(innerRing);
      for (let i = 0; i < 4; i++) {
        const n = this.strip(0.05, 0.012, 0.018, this.basic(hiColor));
        const a = (i / 4) * Math.PI * 2;
        n.position.set(Math.cos(a) * 0.155, 0.012, Math.sin(a) * 0.155);
        n.rotation.y = -a;
        rotor.add(n);
      }
    }
    // A planar aura preserves the frisbee silhouette in XR. A Sprite would
    // billboard toward each eye and make a flat disc appear upright.
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.52),
      new THREE.MeshBasicMaterial({ map: this.glowTex, color, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    halo.rotation.x = -Math.PI / 2;
    rotor.add(ring, plate, core, halo);
    g.add(rotor);
    if (withLight) {
      const light = new THREE.PointLight(color, 2.6, 9, 2);
      light.position.y = 0.05;
      g.add(light);
    }
    g.userData.mat = mat;
    g.userData.rotor = rotor;
    return g;
  }

  // ---------- mdl_gauntlet ----------
  makeGauntlet(color) {
    const g = new THREE.Group();
    const seam = this.basic(color);
    const fore = this.box(0.075, 0.06, 0.18, this.matBody); fore.position.set(0, -0.01, 0.06);
    const plate = this.box(0.082, 0.02, 0.11, this.matGraphite); plate.position.set(0, 0.026, 0.02);
    const s1 = this.strip(0.008, 0.012, 0.16, seam); s1.position.set(-0.041, 0, 0.06);
    const s2 = this.strip(0.008, 0.012, 0.16, seam); s2.position.set(0.041, 0, 0.06);
    const knuckle = this.box(0.07, 0.03, 0.04, this.matGraphite); knuckle.position.set(0, -0.01, -0.05);
    const mount = new THREE.Object3D(); mount.position.set(0, 0.05, -0.06);
    g.add(fore, plate, s1, s2, knuckle, mount);
    g.userData.mount = mount;
    return g;
  }

  // ---------- guard buckler ----------
  makeBuckler(color) {
    const g = new THREE.Group();
    const face = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.012, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    face.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.015, 8, 6), this.basic(color));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 6), this.basic(color));
    hub.rotation.x = Math.PI / 2;
    g.add(face, rim, hub);
    return g;
  }

  // ---------- mdl_enemy_program (v4: organic capsule body, glowing suit lines) ----------
  makeEnemy() {
    const g = new THREE.Group();
    const seam = this.basic(COL.amber);
    const hi = this.basic(COL.amberHi);
    const u = g.userData;
    u.seamMat = seam;

    // one suit material: circuit lines glow from the surface (less "blocks", more "program")
    const suit = new THREE.MeshStandardMaterial({
      color: 0x0a0b10, metalness: 0.55, roughness: 0.42, envMapIntensity: 0.9,
      emissive: new THREE.Color(COL.amber), emissiveMap: this.suitTex, emissiveIntensity: 1.5,
    });
    u.suitMat = suit;

    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.175, 0.2, 14), suit);
    hips.scale.z = 0.75; hips.position.y = 0.98; g.add(hips);

    // upper body pivots at the spine so throws can wind the torso
    const torsoGrp = new THREE.Group();
    torsoGrp.position.y = 1.05;
    g.add(torsoGrp);
    u.torsoGrp = torsoGrp;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.145, 0.48, 16), suit);
    torso.scale.z = 0.7; torso.position.y = 0.24; torsoGrp.add(torso);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), this.matGraphite);
    chest.scale.set(1.0, 0.7, 0.5); chest.position.set(0, 0.36, -0.07); torsoGrp.add(chest);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16), hi);
    core.rotation.x = Math.PI / 2; core.position.set(0, 0.33, -0.155); torsoGrp.add(core);
    const coreGlow = this.glow(COL.amber, 0.28, 0.6); coreGlow.position.set(0, 0.33, -0.19); torsoGrp.add(coreGlow);
    const backRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 8, 24), seam);
    backRing.position.set(0, 0.27, 0.14); torsoGrp.add(backRing);

    const head = new THREE.Group(); head.position.y = 0.63;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 16), this.matGlass);
    skull.scale.set(0.92, 1.05, 1.0);
    // curved visor band wrapping the face
    const visor = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.016, 8, 24, Math.PI * 1.1), hi);
    visor.rotation.set(0, Math.PI - Math.PI * 0.05, 0);
    visor.rotation.z = Math.PI;
    visor.position.set(0, 0.01, -0.015);
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 8), this.matGraphite);
    crest.scale.x = 0.25; crest.position.set(0, 0.12, 0.02); crest.rotation.x = 0.35;
    head.add(skull, visor, crest); torsoGrp.add(head);
    u.head = head;

    const mkArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.24 * side, 0.42, 0);
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), this.matGraphite);
      pad.scale.set(1.15, 0.85, 1.05); shoulder.add(pad);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.22, 4, 10), suit);
      upper.position.y = -0.17; shoulder.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -0.34; shoulder.add(elbow);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.2, 4, 10), suit);
      lower.position.y = -0.15; elbow.add(lower);
      const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.044, 0.14, 10), this.matGraphite);
      guard.position.y = -0.2; elbow.add(guard);
      const mount = new THREE.Object3D(); mount.position.y = -0.33; elbow.add(mount);
      torsoGrp.add(shoulder);
      return { shoulder, elbow, mount };
    };
    u.armR = mkArm(1);
    u.armL = mkArm(-1);

    const mkLeg = (side) => {
      const hip = new THREE.Group(); hip.position.set(0.1 * side, 0.94, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.28, 4, 10), suit);
      upper.position.y = -0.2; hip.add(upper);
      const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.26, 4, 10), suit);
      lower.position.y = -0.18; knee.add(lower);
      const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.16, 10), this.matGraphite);
      boot.position.set(0, -0.38, 0); knee.add(boot);
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), this.matGraphite);
      toe.scale.set(0.9, 0.55, 1.5); toe.position.set(0, -0.44, -0.06); knee.add(toe);
      g.add(hip);
      return { hip, knee };
    };
    u.legR = mkLeg(1);
    u.legL = mkLeg(-1);

    const base = this.glow(COL.amber, 1.25, 0.35); base.position.y = 0.06; g.add(base);

    const disc = this.makeDisc(COL.amber, COL.amberHi, false, false);
    disc.scale.setScalar(0.9);
    u.armR.mount.add(disc);
    u.heldDisc = disc;
    return g;
  }

  // ---------- AR breach: the real surface explodes open into the Grid ----------
  makeBreach() {
    const g = new THREE.Group();
    const wt = this.gridTex.clone(); wt.needsUpdate = true; wt.repeat.set(2, 2);
    const window = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24),
      new THREE.MeshBasicMaterial({ map: wt, transparent: true, opacity: 1 }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.028, 8, 32),
      new THREE.MeshBasicMaterial({ color: COL.cyan, transparent: true, opacity: 1 }));
    const depth = this.glow(COL.cyan, 1.3, 0.5);
    depth.position.z = -0.05;
    g.add(window, rim, depth);
    g.visible = false;
    g.userData.mats = [window.material, rim.material, depth.material];
    return g;
  }

  // ---------- mdl_light_cycle ----------
  makeCycle(color, cockpit = false) {
    const g = new THREE.Group();
    const cmat = this.basic(color);
    g.userData.mat = cmat;
    const glowDiscMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

    const mkWheel = (r, tube, z, y) => {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 12, 36), cmat);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(r * 0.82, 24), glowDiscMat);
      wheel.add(tire, inner);
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(0, y, z);
      return wheel;
    };
    const wheelF = mkWheel(0.42, 0.055, -0.98, 0.46);
    const wheelR = mkWheel(0.5, 0.07, 0.9, 0.54);

    // signature arched wheel guards
    const mkGuard = (r, z, y) => {
      const wrap = new THREE.Group();
      const arc = Math.PI * 0.92;
      const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 8, 22, arc), this.matGraphite);
      t.rotation.z = Math.PI / 2 - arc / 2;
      wrap.add(t);
      wrap.rotation.y = Math.PI / 2;
      wrap.position.set(0, y, z);
      return wrap;
    };
    const guardF = mkGuard(0.52, -0.98, 0.46);
    const guardR = mkGuard(0.6, 0.9, 0.54);

    // hull: rounded capsule fuselage + cone nose and tail (no more blocks)
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.5, 6, 14), this.matGraphite);
    body.rotation.x = Math.PI / 2;
    body.scale.set(0.85, 1, 1.1);
    body.position.y = 0.66;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.135, 0.6, 14), this.matGraphite);
    nose.rotation.x = -Math.PI / 2;
    nose.scale.y = 1.0; nose.scale.x = 0.85;
    nose.position.set(0, 0.58, -1.32);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.45, 14), this.matGraphite);
    tail.rotation.x = Math.PI / 2;
    tail.scale.x = 0.85;
    tail.position.set(0, 0.64, 1.22);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), this.matGlass);
    canopy.scale.set(0.5, 0.42, 1.35); canopy.position.set(0, 0.9, -0.18);
    const mkTube = (x) => {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.9, 8), cmat);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(x, 0.64, 0);
      return tube;
    };
    const sL = mkTube(-0.155);
    const sR = mkTube(0.155);
    const under = this.glow(color, 1.8, 0.45); under.position.y = 0.12;
    const headlight = this.glow(color, 0.5, 0.8); headlight.position.set(0, 0.5, -1.55);
    const beacon = this.glow(color, cockpit ? 0.55 : 1.35, cockpit ? 0.2 : 0.95);
    beacon.position.set(0, cockpit ? 1.15 : 1.75, 0);

    g.add(wheelF, wheelR, guardF, guardR, body, nose, tail, canopy, sL, sR, under, headlight, beacon);
    g.userData.wheels = [wheelF, wheelR];

    if (cockpit) {
      // handlebars: distinct glowing handles the rider grips to lean-steer
      const grips = [];
      for (const side of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.26, 8), this.matGraphite);
        bar.position.set(0.18 * side, 0.98, -0.62); bar.rotation.z = 0.55 * side;
        const gripMat = new THREE.MeshBasicMaterial({ color });
        const grip = new THREE.Mesh(this._box, gripMat);
        grip.scale.set(0.04, 0.13, 0.04);
        grip.position.set(0.27 * side, 1.09, -0.62);
        grip.rotation.z = 0.55 * side;
        g.add(bar, grip);
        grips.push(grip);
      }
      g.userData.grips = grips; // [left, right]

      // live dash console (canvas panel: speed / boost / tier)
      const dc = document.createElement("canvas");
      dc.width = 256; dc.height = 128;
      const dtex = new THREE.CanvasTexture(dc);
      dtex.colorSpace = THREE.SRGBColorSpace;
      dtex.minFilter = THREE.LinearFilter;
      dtex.generateMipmaps = false;
      const dash = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4, 0.2),
        new THREE.MeshBasicMaterial({ map: dtex, transparent: true, depthWrite: false })
      );
      dash.position.set(0, 1.04, -0.8);
      dash.rotation.x = -0.6;
      g.add(dash);
      g.userData.dash = { mesh: dash, canvas: dc, ctx: dc.getContext("2d"), tex: dtex };

      // interior conduits framing the rider
      for (const side of [-1, 1]) {
        const con = this.strip(0.014, 0.012, 1.0, cmat);
        con.position.set(0.16 * side, 0.9, -0.2);
        g.add(con);
      }

      // hinged canopy shell: closes over the rider before each round
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.8, 0.5);
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 20, 14),
        new THREE.MeshStandardMaterial({ color: 0x0c141f, metalness: 1.0, roughness: 0.1, envMapIntensity: 0.9, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false })
      );
      shell.scale.set(0.75, 0.55, 1.9);
      shell.position.set(0, 0.28, -0.85);
      const edge = this.strip(0.5, 0.016, 0.016, cmat);
      edge.position.set(0, 0.36, -1.45);
      hinge.add(shell, edge);
      hinge.rotation.x = 1.15; // open
      g.add(hinge);
      g.userData.canopy = hinge;
    }
    return g;
  }

  // ---------- ambient environment motion ----------
  makeDataRibbon(radius, arc = Math.PI * 0.55) {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.06, 6, 64, arc),
      new THREE.MeshBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    m.rotation.x = Math.PI / 2;
    return m;
  }

  makeBarge() {
    const g = new THREE.Group();
    const hull = this.box(5, 1.1, 14, this.matGraphite);
    const seam = this.strip(5.05, 0.12, 0.1, this.basic(COL.cyan));
    seam.position.set(0, 0.2, -7);
    g.add(hull, seam);
    return g;
  }

  makeBeam(h = 90) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(5, h),
      new THREE.MeshBasicMaterial({ map: this.glowTex, color: COL.cyan, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    m.position.y = h / 2 - 10;
    return m;
  }

  makeMotes(count = 220, spread = 60, height = 14) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * spread * 2;
      pos[i * 3 + 1] = Math.random() * height + 0.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * spread * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.Points(geo, new THREE.PointsMaterial({
      color: COL.cyan, size: 0.16, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    m.frustumCulled = false;
    return m;
  }

  makeTraffic(n = 8) {
    const m = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.4, 0.4, 7),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      n
    );
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    const c = new THREE.Color();
    const hues = [COL.cyan, COL.cyanHi, COL.amber, COL.magenta];
    for (let i = 0; i < n; i++) m.setColorAt(i, c.setHex(hues[i % hues.length]));
    return m;
  }

  // ---------- arena props ----------
  makeShard() {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), this.matGraphite);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(core.geometry),
      new THREE.LineBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.9 })
    );
    const heart = this.glow(COL.cyan, 0.9, 0.5);
    g.add(core, edges, heart);
    return g;
  }

  makePylon() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 5, 12), this.matGraphite);
    body.position.y = 2.5;
    g.add(body);
    for (const y of [0.8, 4.2]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.03, 8, 28), this.basic(COL.cyan));
      ring.rotation.x = Math.PI / 2; ring.position.y = y;
      g.add(ring);
    }
    const cap = this.glow(COL.cyan, 1.6, 0.5); cap.position.y = 5.1; g.add(cap);
    return g;
  }

  // distant void architecture - dark monolith slab with circuit seams
  makeMonolith(w = 10, h = 46, d = 6) {
    const g = new THREE.Group();
    const slab = this.box(w, h, d, this.matGraphite);
    slab.position.y = h / 2 - 18;
    g.add(slab);
    const seam = this.basic(COL.cyan);
    for (let i = 0; i < 2; i++) {
      const s = this.strip(0.12, h * (0.45 + 0.25 * i), 0.1, seam);
      s.position.set((-0.22 + i * 0.44) * w, h * 0.45 - 18, d / 2 + 0.03);
      g.add(s);
    }
    const band = this.strip(w * 1.01, 0.16, d * 1.01, seam);
    band.position.y = h * 0.68 - 18;
    g.add(band);
    return g;
  }

  // ---------- AR floor pit: the real floor "falls out" into the Grid ----------
  makeHole(r = 0.7) {
    const g = new THREE.Group();
    const depth = 1.7;
    // rim
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 10, 40), this.basic(COL.cyan));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.012;
    // inner shaft wall (viewed from inside)
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 0.94, depth, 28, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 0.8, roughness: 0.4, side: THREE.BackSide })
    );
    wall.position.y = -depth / 2;
    // ring lights down the shaft
    for (const yy of [-0.4, -0.95]) {
      const rg = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, 0.014, 6, 32), this.basic(COL.cyan));
      rg.rotation.x = Math.PI / 2; rg.position.y = yy;
      g.add(rg);
    }
    // grid world at the bottom
    const bt = this.gridTex.clone(); bt.needsUpdate = true; bt.repeat.set(3, 3);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 28),
      new THREE.MeshBasicMaterial({ map: bt }));
    bottom.rotation.x = -Math.PI / 2; bottom.position.y = -depth + 0.02;
    const up = this.glow(COL.cyan, r * 2.4, 0.4); up.position.y = -depth * 0.5;
    g.add(rim, wall, bottom, up);
    g.userData.r = r;
    return g;
  }

  // transient hex flash where a disc banks off an invisible AR wall
  makeBankFlash() {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 6),
      new THREE.MeshBasicMaterial({ map: this.hexTex, color: COL.cyan, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    m.visible = false;
    return m;
  }

  // ---------- skybox_pano (generated) with procedural fallback ----------
  makeSky(tex) {
    let material;
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
    } else {
      const t = canvasTex(1024, (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "#00000d"); grad.addColorStop(0.5, "#000006"); grad.addColorStop(1, "#000002");
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 420; i++) {
          const a = Math.random() * 0.5 + 0.1;
          g.fillStyle = `rgba(180,240,255,${a})`;
          g.fillRect(Math.random() * w, Math.random() * h * 0.55, 1.4, 1.4);
        }
        g.strokeStyle = "rgba(0,229,255,0.16)"; g.lineWidth = 22; g.shadowColor = "#00e5ff"; g.shadowBlur = 40;
        for (let i = 0; i < 3; i++) {
          g.beginPath();
          g.moveTo(0, h * (0.12 + 0.09 * i));
          g.bezierCurveTo(w * 0.3, h * (0.06 + 0.09 * i), w * 0.7, h * (0.18 + 0.09 * i), w, h * (0.1 + 0.09 * i));
          g.stroke();
        }
        g.shadowBlur = 26; g.strokeStyle = "rgba(0,229,255,0.75)"; g.lineWidth = 5;
        g.beginPath(); g.moveTo(0, h * 0.62); g.lineTo(w, h * 0.62); g.stroke();
      }, { sizeY: 512 });
      material = new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false });
    }
    const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 42, 24), material);
    sky.rotation.y = Math.PI;
    return sky;
  }

  makeVoidFloor() {
    const t = this.gridTex.clone();
    t.needsUpdate = true;
    t.repeat.set(56, 56);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(560, 560),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = -30;
    return m;
  }

  // ---------- text panel (canvas texture on a plane) ----------
  textPanel(w, h, pxPerM = 256) {
    const c = document.createElement("canvas");
    c.width = Math.round(w * pxPerM); c.height = Math.round(h * pxPerM);
    const ctx = c.getContext("2d");
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    );
    mesh.renderOrder = 20;
    const panel = {
      mesh, ctx, tex,
      set(lines, o = {}) {
        const { color = "#00e5ff", sub = "#7ad9e8", bg = null, size = 0.32 } = o;
        const W = c.width, H = c.height;
        ctx.clearRect(0, 0, W, H);
        if (bg) {
          ctx.fillStyle = bg;
          ctx.beginPath(); ctx.roundRect(2, 2, W - 4, H - 4, 18); ctx.fill();
          ctx.strokeStyle = "rgba(0,229,255,0.5)"; ctx.lineWidth = 3; ctx.stroke();
        }
        const n = lines.length;
        lines.forEach((ln, i) => {
          const main = i === 0;
          let px = Math.round(H * size * (main ? 1 : 0.55));
          ctx.font = `700 ${px}px Menlo, Consolas, monospace`;
          const tw = ctx.measureText(ln).width;
          if (tw > W * 0.94) {
            px = Math.max(10, Math.floor((px * W * 0.94) / tw));
            ctx.font = `700 ${px}px Menlo, Consolas, monospace`;
          }
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.shadowColor = main ? color : sub; ctx.shadowBlur = px * 0.45;
          ctx.fillStyle = main ? color : sub;
          const y = H * ((i + 1) / (n + 1));
          ctx.fillText(ln, W / 2, y);
        });
        tex.needsUpdate = true;
      },
    };
    return panel;
  }

  makeVignette() {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4),
      new THREE.MeshBasicMaterial({ map: this.vigTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false })
    );
    m.position.z = -1.0;
    m.renderOrder = 999;
    m.visible = false;
    return m;
  }
}

// ---------- shatter particles (single instanced pool, 1 draw call) ----------
export class ShatterPool {
  constructor(scene, max = 512) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.07, 0.07, 0.02),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      max
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.px = new Float32Array(max); this.py = new Float32Array(max); this.pz = new Float32Array(max);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.life = new Float32Array(max);
    this.cursor = 0;
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  spawn(pos, colorHex, n = 24, spread = 2.6, up = 2.2, scale = 1) {
    this.color.setHex(colorHex);
    for (let k = 0; k < n; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      this.px[i] = pos.x + (Math.random() - 0.5) * 0.3 * scale;
      this.py[i] = pos.y + (Math.random() - 0.5) * 0.3 * scale;
      this.pz[i] = pos.z + (Math.random() - 0.5) * 0.3 * scale;
      this.vx[i] = (Math.random() - 0.5) * spread;
      this.vy[i] = Math.random() * up + 0.4;
      this.vz[i] = (Math.random() - 0.5) * spread;
      this.life[i] = 0.65 + Math.random() * 0.55;
      this.mesh.setColorAt(i, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const d = this.dummy;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      this.vy[i] -= 5.5 * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      const s = Math.max(this.life[i], 0) * 1.4;
      d.position.set(this.px[i], this.py[i], this.pz[i]);
      d.rotation.set(this.life[i] * 7, this.life[i] * 5, 0);
      d.scale.setScalar(Math.min(s, 1));
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      if (this.life[i] <= 0) {
        d.scale.setScalar(0); d.updateMatrix();
        this.mesh.setMatrixAt(i, d.matrix);
      }
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
