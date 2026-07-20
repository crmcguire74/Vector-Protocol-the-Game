import * as THREE from "../vendor/three.module.js";
import { mergeGeometries } from "../vendor/BufferGeometryUtils.js";

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
      // Legacy-style: near-black gloss panels, hairline sub-grid, hot seam lines
      g.fillStyle = "#010207"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(0,229,255,0.06)"; g.lineWidth = 1;
      for (let i = 0; i <= 16; i++) {
        const p = (i * w) / 16;
        g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke();
        g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke();
      }
      g.strokeStyle = "rgba(120,240,255,0.85)"; g.lineWidth = 2;
      g.shadowColor = "#00e5ff"; g.shadowBlur = 10;
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

    // obsidian armor-panel material map (generated asset, tiles seamlessly)
    this.armorTex = new THREE.TextureLoader().load("./assets/tex/obsidian-armor.jpg");
    this.armorTex.colorSpace = THREE.SRGBColorSpace;
    this.armorTex.wrapS = this.armorTex.wrapT = THREE.RepeatWrapping;
    this.armorTex.repeat.set(2, 2);
    this.armorTex.anisotropy = 8;

    // env-map-ready PBR set (scene.environment is assigned in main.js)
    this.matGraphite = new THREE.MeshStandardMaterial({ color: COL.graphite, metalness: 0.92, roughness: 0.22, envMapIntensity: 1.25 });
    this.matBody = new THREE.MeshStandardMaterial({ color: COL.bodyDark, metalness: 0.78, roughness: 0.34, envMapIntensity: 1.1 });
    this.matGlass = new THREE.MeshStandardMaterial({ color: 0x0c141f, metalness: 1.0, roughness: 0.12, envMapIntensity: 0.85 });
    this.matFloor = new THREE.MeshStandardMaterial({ color: 0x03040a, metalness: 0.9, roughness: 0.14, envMapIntensity: 1.35 });

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

  // curved tube along a set of points (energy veins, frames)
  tubePath(points, radius, material, tubularSegments = 28, radialSegments = 7) {
    const curve = new THREE.CatmullRomCurve3(points);
    return new THREE.Mesh(new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false), material);
  }

  // straight strut between two points (suspension links, spokes)
  link(start, end, radius, material, radialSegments = 8) {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, radialSegments), material);
    m.position.copy(start).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  }

  // Collapse every static mesh under `root` into one mesh per material.
  // Subtrees flagged userData.noMerge (spinning wheels, canopy, dash, grips)
  // are left alone; call again on each of those if they hold many parts.
  mergeStatic(root) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const buckets = new Map();
    const doomed = [];
    const collect = (node) => {
      if (node !== root && node.userData.noMerge) return;
      if (node.isMesh && !node.userData.noMerge) {
        const geo = node.geometry.clone();
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, node.matrixWorld));
        if (!buckets.has(node.material)) buckets.set(node.material, []);
        buckets.get(node.material).push(geo);
        doomed.push(node);
      }
      for (const child of node.children) collect(child);
    };
    collect(root);
    for (const mesh of doomed) mesh.parent.remove(mesh);
    for (const [material, geos] of buckets) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      root.add(new THREE.Mesh(merged, material));
      if (geos.length > 1) for (const geo of geos) geo.dispose();
    }
  }

  // ---------- mdl_light_cycle (v8: sculpted monocoque light runner) ----------
  makeCycle(color, cockpit = false) {
    const g = new THREE.Group();
    const accent = new THREE.Color(color);

    const shellMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x1a2126).lerp(accent, 0.1),
      map: this.armorTex, metalness: 0.84, roughness: 0.2,
      clearcoat: 0.92, clearcoatRoughness: 0.12,
      emissive: color, emissiveIntensity: 0.055,
    });
    const carbon = new THREE.MeshPhysicalMaterial({
      color: 0x10151b, map: this.armorTex, metalness: 0.78, roughness: 0.28,
      clearcoat: 0.72, clearcoatRoughness: 0.18,
      emissive: accent.clone().multiplyScalar(0.05),
    });
    const brushed = new THREE.MeshStandardMaterial({ color: 0x82939a, metalness: 0.96, roughness: 0.24 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x030506, metalness: 0.12, roughness: 0.76 });
    const energyMat = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(0.72), transparent: true, opacity: 0.88, toneMapped: false });
    const iceMat = new THREE.MeshBasicMaterial({ color: 0xd8ffff, toneMapped: false });
    // NOTE: no `transmission` here - it forces an extra full scene render pass
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: accent.clone().lerp(new THREE.Color(0x06131e), 0.68),
      metalness: 0.08, roughness: 0.06,
      transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false,
    });
    g.userData.mat = energyMat;

    // sculpted aerodynamic monocoque
    const bodyProfile = [
      new THREE.Vector2(0.018, -1.46), new THREE.Vector2(0.2, -1.36),
      new THREE.Vector2(0.36, -1.05), new THREE.Vector2(0.44, -0.56),
      new THREE.Vector2(0.45, 0.08), new THREE.Vector2(0.4, 0.55),
      new THREE.Vector2(0.27, 0.94), new THREE.Vector2(0.07, 1.15),
    ];
    const body = new THREE.Mesh(new THREE.LatheGeometry(bodyProfile, 40), shellMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.51;
    body.scale.set(0.95, 0.62, 1);
    g.add(body);

    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.92, 8, 16), carbon);
    belly.rotation.x = Math.PI / 2;
    belly.position.set(0, 0.36, 0.08);
    belly.scale.set(1.05, 0.54, 1);
    g.add(belly);

    for (const side of [-1, 1]) {
      const fairing = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.78, 7, 14), carbon);
      fairing.rotation.x = Math.PI / 2;
      fairing.rotation.z = side * 0.11;
      fairing.position.set(side * 0.34, 0.5, 0.02);
      fairing.scale.set(0.82, 1, 1.15);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 14), shellMat);
      shoulder.position.set(side * 0.3, 0.61, -0.45);
      shoulder.scale.set(0.7, 0.52, 1.36);
      shoulder.rotation.z = side * 0.13;
      g.add(fairing, shoulder);
      g.add(this.tubePath([
        new THREE.Vector3(side * 0.39, 0.42, -1.12), new THREE.Vector3(side * 0.46, 0.47, -0.46),
        new THREE.Vector3(side * 0.43, 0.5, 0.35), new THREE.Vector3(side * 0.31, 0.55, 0.96),
      ], 0.024, energyMat, 36, 7));
      g.add(this.tubePath([
        new THREE.Vector3(side * 0.31, 0.22, -0.92), new THREE.Vector3(side * 0.39, 0.2, -0.1),
        new THREE.Vector3(side * 0.31, 0.23, 0.82),
      ], 0.029, energyMat, 28, 7));
      for (const z of [-0.36, 0.02, 0.4]) {
        const vent = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.009, 5, 18, Math.PI * 1.25), energyMat);
        vent.position.set(side * 0.48, 0.5, z);
        vent.rotation.y = Math.PI / 2;
        vent.rotation.z = side * Math.PI / 2;
        vent.scale.y = 0.52;
        g.add(vent);
      }
    }

    const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.38, 7, 16), carbon);
    seat.rotation.x = Math.PI / 2;
    seat.position.set(0, 0.75, 0.48);
    seat.scale.set(1.08, 0.34, 1.08);
    const tailCowl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 14), shellMat);
    tailCowl.position.set(0, 0.69, 0.86);
    tailCowl.scale.set(0.9, 0.5, 1.2);
    g.add(seat, tailCowl);

    const windscreen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.55, 0.38, 32, 1, true, Math.PI - 0.66, 1.32), glassMat);
    windscreen.position.set(0, 0.86, -0.22);
    windscreen.rotation.x = -0.12;
    windscreen.scale.x = 0.9;
    windscreen.userData.noMerge = true; // transparency needs its own draw
    g.add(windscreen);
    g.add(this.tubePath([
      new THREE.Vector3(-0.36, 0.72, -0.5), new THREE.Vector3(-0.31, 1.02, -0.56),
      new THREE.Vector3(0, 1.08, -0.61), new THREE.Vector3(0.31, 1.02, -0.56),
      new THREE.Vector3(0.36, 0.72, -0.5),
    ], 0.018, brushed, 36, 6));

    // spoked wheels: dark tire, brushed rims + hub + spokes, energy light rings
    const wheelRadius = 0.37;
    const mkWheel = () => {
      const wheel = new THREE.Group();
      wheel.userData.noMerge = true; // spins as a unit
      const tire = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius, 0.064, 14, 48), tireMat);
      tire.rotation.y = Math.PI / 2;
      wheel.add(tire);
      for (const x of [-0.072, 0.072]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius * 0.79, 0.017, 7, 40), brushed);
        rim.position.x = x;
        rim.rotation.y = Math.PI / 2;
        const lightRing = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius * 0.93, 0.014, 6, 44), energyMat);
        lightRing.position.x = x * 1.06;
        lightRing.rotation.y = Math.PI / 2;
        wheel.add(rim, lightRing);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.26, 16), brushed);
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        wheel.add(this.link(
          new THREE.Vector3(0, Math.cos(a) * 0.075, Math.sin(a) * 0.075),
          new THREE.Vector3(0, Math.cos(a) * 0.27, Math.sin(a) * 0.27),
          0.009, brushed, 5));
      }
      const hubLight = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), iceMat);
      hubLight.scale.x = 1.45;
      wheel.add(hubLight);
      this.mergeStatic(wheel);
      return wheel;
    };
    const wheelF = mkWheel();
    wheelF.position.set(0, wheelRadius, -0.94);
    const wheelR = mkWheel();
    wheelR.position.set(0, wheelRadius, 0.82);
    g.add(wheelF, wheelR);
    // suspension struts
    for (const side of [-1, 1]) {
      g.add(this.link(new THREE.Vector3(side * 0.17, wheelRadius, -0.94), new THREE.Vector3(side * 0.22, 0.77, -0.63), 0.025, brushed, 9));
      g.add(this.link(new THREE.Vector3(side * 0.12, wheelRadius, 0.82), new THREE.Vector3(side * 0.3, 0.51, 0.18), 0.027, carbon, 9));
    }

    // lights: projector headlight, tail ring, dorsal energy spine
    const headlight = new THREE.Mesh(new THREE.CircleGeometry(0.105, 28), iceMat);
    headlight.position.set(0, 0.52, -1.47);
    headlight.rotation.y = Math.PI;
    const headBezel = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.014, 7, 28), carbon);
    headBezel.position.copy(headlight.position);
    headBezel.rotation.y = Math.PI;
    const tailLight = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 7, 26), energyMat);
    tailLight.position.set(0, 0.62, 1.15);
    g.add(headlight, headBezel, tailLight);
    g.add(this.tubePath([
      new THREE.Vector3(0, 0.7, -1.25), new THREE.Vector3(0, 0.82, -0.52),
      new THREE.Vector3(0, 0.81, 0.35), new THREE.Vector3(0, 0.66, 1.07),
    ], 0.019, energyMat, 34, 7));

    // grounding: soft contact shadow + wheel glows + headlight bloom
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.78, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.y = 2.15;
    shadow.position.y = 0.012;
    shadow.userData.noMerge = true;
    const glowF = this.glow(color, 0.92, 0.4); glowF.position.set(0, wheelRadius, -0.94);
    const glowB = this.glow(color, 0.92, 0.4); glowB.position.set(0, wheelRadius, 0.82);
    const headGlow = this.glow(color, 0.5, 0.8); headGlow.position.set(0, 0.52, -1.5);
    const beacon = this.glow(color, cockpit ? 0.5 : 0.6, cockpit ? 0.18 : 0.4);
    beacon.position.set(0, cockpit ? 1.1 : 1.35, 0.4);
    g.add(shadow, glowF, glowB, headGlow, beacon);

    g.userData.wheels = [wheelF, wheelR];

    if (cockpit) {
      // handlebars: distinct glowing handles the rider grips
      const grips = [];
      for (const side of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.26, 8), brushed);
        bar.position.set(0.18 * side, 0.98, -0.62); bar.rotation.z = 0.55 * side;
        const gripMat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
        const grip = new THREE.Mesh(this._box, gripMat);
        grip.scale.set(0.04, 0.13, 0.04);
        grip.position.set(0.27 * side, 1.09, -0.62);
        grip.rotation.z = 0.55 * side;
        grip.userData.noMerge = true; // color swaps on squeeze
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
      dash.userData.noMerge = true;
      g.add(dash);
      g.userData.dash = { mesh: dash, canvas: dc, ctx: dc.getContext("2d"), tex: dtex };

      // interior conduits framing the rider
      for (const side of [-1, 1]) {
        const con = this.strip(0.014, 0.012, 1.0, energyMat);
        con.position.set(0.16 * side, 0.9, -0.2);
        g.add(con);
      }

      // hinged canopy shell: closes over the rider before each round
      const hinge = new THREE.Group();
      hinge.userData.noMerge = true; // animates open/closed
      hinge.position.set(0, 0.8, 0.5);
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 20, 14),
        new THREE.MeshStandardMaterial({ color: 0x0c141f, metalness: 1.0, roughness: 0.1, envMapIntensity: 0.9, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false })
      );
      shell.scale.set(0.75, 0.55, 1.9);
      shell.position.set(0, 0.28, -0.85);
      const edge = this.strip(0.5, 0.016, 0.016, energyMat);
      edge.position.set(0, 0.36, -1.45);
      hinge.add(shell, edge);
      hinge.rotation.x = 1.15; // open
      g.add(hinge);
      g.userData.canopy = hinge;
    }
    // one draw per material for everything that never moves
    this.mergeStatic(g);
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

  // ---------- Grid City skyline: one ring of towers in 2 instanced draws ----------
  makeSkyline(count = 22, rMin = 170, rMax = 320, seed = 7) {
    const g = new THREE.Group();
    const rand = (() => { let a = seed >>> 0; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.matGraphite, count);
    const lights = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: COL.cyan, toneMapped: false }),
      count * 2
    );
    const d = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.5;
      const r = rMin + rand() * (rMax - rMin);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const w = 12 + rand() * 22, dep = 10 + rand() * 18, h = 55 + rand() * 130;
      const rot = rand() * Math.PI;
      d.position.set(x, h / 2 - 14, z);
      d.rotation.set(0, rot, 0);
      d.scale.set(w, h, dep);
      d.updateMatrix();
      slabs.setMatrixAt(i, d.matrix);
      // two vertical light seams per tower, offset to its faces
      for (let k = 0; k < 2; k++) {
        const off = (k === 0 ? -0.28 : 0.3) * w;
        d.position.set(x + Math.cos(rot) * off, h * (0.42 + rand() * 0.12) - 14, z - Math.sin(rot) * off);
        d.rotation.set(0, rot, 0);
        d.scale.set(0.5, h * (0.55 + rand() * 0.3), dep * 1.02);
        d.updateMatrix();
        lights.setMatrixAt(i * 2 + k, d.matrix);
      }
    }
    slabs.instanceMatrix.needsUpdate = true;
    lights.instanceMatrix.needsUpdate = true;
    g.add(slabs, lights);
    return g;
  }

  // central mega-tower on the horizon (the one every Grid vista points at)
  makeMegaTower() {
    const g = new THREE.Group();
    const seam = new THREE.MeshBasicMaterial({ color: COL.cyan, toneMapped: false });
    const tiers = [[44, 110, 44, 0], [30, 90, 30, 100], [18, 80, 18, 180], [8, 70, 8, 250]];
    for (const [w, h, dep, y] of tiers) {
      const slab = this.box(w, h, dep, this.matGraphite);
      slab.position.y = y + h / 2 - 14;
      g.add(slab);
      for (const side of [-1, 1]) {
        const s = this.strip(1.1, h * 0.92, 1.1, seam);
        s.position.set(side * (w * 0.34), y + h / 2 - 14, dep / 2 + 0.4);
        g.add(s);
      }
    }
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 260, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.y = 330;
    const apex = this.glow(COL.cyanHi, 30, 0.9); apex.position.y = 322;
    const halo = this.glow(COL.cyan, 120, 0.4); halo.position.y = 300;
    g.add(beam, apex, halo);
    return g;
  }

  // low luminous band that reads as the Grid's glowing horizon line
  makeHorizonGlow(radius = 430) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 26, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: this.glowTex, color: COL.cyan, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, fog: false })
    );
    m.position.y = 4;
    return m;
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
