import * as THREE from "../vendor/three.module.js";
import { STR } from "./strings.js";
import { Store } from "./util.js";
import { WorldKit, ShatterPool, COL, pulse } from "./world.js";
import { AudioMan } from "./audio.js";
import { Input } from "./input.js";
import { HubMode } from "./hub.js";
import { DiscMode } from "./disc.js";
import { CycleMode } from "./cycle.js";

const STEP = 1 / 60;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

class Game {
  constructor() {
    Store.load();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COL.bg);
    this.scene.fog = new THREE.Fog(COL.bg, 70, 680);

    this.rig = new THREE.Group();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 900);
    this.camera.rotation.order = "YXZ";
    this.camera.position.set(0, 1.65, 0);
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    // lighting derived from STYLE FORMULA blocks 3-4 (cold ambient, neon accents)
    this.scene.add(new THREE.HemisphereLight(0x14313d, 0x030408, 1.4));
    const key = new THREE.DirectionalLight(0x77ccee, 0.55);
    key.position.set(6, 12, 4);
    this.scene.add(key);

    this.kit = new WorldKit();
    this.shatter = new ShatterPool(this.scene);
    this.audio = new AudioMan();
    this.audio.attach(this.camera, this.scene);
    this.input = new Input();
    this.input.bindXR(this.renderer);

    this.sky = this.kit.makeSky(null);
    this.voidFloor = this.kit.makeVoidFloor();
    this.scene.add(this.sky, this.voidFloor);
    // environment reflections: PMREM of the sky so every metal panel picks up the Grid
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.applyEnv(this.sky);
    new THREE.TextureLoader().load("./assets/tex/skybox.jpg", (t) => {
      const old = this.sky;
      this.sky = this.kit.makeSky(t);
      this.sky.visible = old.visible;
      this.scene.remove(old);
      this.scene.add(this.sky);
      t.mapping = THREE.EquirectangularReflectionMapping;
      try {
        const env = this.pmrem.fromEquirectangular(t);
        this.scene.environment = env.texture;
      } catch { /* keep sky-scene env */ }
    }, undefined, () => { /* procedural sky stays */ });

    this.vignette = this.kit.makeVignette();
    this.camera.add(this.vignette);
    this.vigTarget = 0;
    this.vigFlash = 0;

    // XR hands: gauntlets + rays + guard buckler
    this.xrRight = null; this.xrLeft = null;
    this.buildXRHands();

    // 3D banner
    this.banner3d = this.kit.textPanel(4.6, 1.5);
    this.banner3d.mesh.visible = false;
    this.scene.add(this.banner3d.mesh);
    this.bannerT = 0;

    // wrist HUD panel (XR)
    this.wrist = this.kit.textPanel(0.3, 0.15, 1200);
    this.wrist.mesh.visible = false;

    // XR pause panel
    this.pausePanel = this.kit.textPanel(1.6, 1.0);
    this.pausePanel.mesh.visible = false;
    this.scene.add(this.pausePanel.mesh);
    this.pauseHotspots = [];
    for (let i = 0; i < 2; i++) {
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.06),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.userData.action = i === 0 ? "resume" : "hub";
      this.pausePanel.mesh.add(hit);
      hit.position.set(0, i === 0 ? -0.05 : -0.38, 0.02);
      this.pauseHotspots.push(hit);
    }

    this.inXR = false;
    this.isAR = false;
    this.simulateAR = new URLSearchParams(location.search).has("simulateAR");
    if (this.simulateAR) {
      this.isAR = true;
      this.roomBounds = { x: 0, z: -3, r: 4, minX: -3.5, maxX: 3.5, minZ: -7, maxZ: 1, source: "simulation" };
    }
    this.paused = false;
    this.camPitch = 0;

    this.modes = { hub: new HubMode(), disc: new DiscMode(), cycle: new CycleMode() };
    this.mode = null;
    this.modeName = "";

    this.hud = this.buildHud();
    this.buildMenu();
    this.audio.setMusicOn(Store.get("music"));
    this.bindSessionEvents();

    addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "KeyF") {
        if (document.fullscreenElement) document.exitFullscreen();
        else this.renderer.domElement.requestFullscreen?.();
      } else if (e.code === "KeyM") {
        Store.set("music", !Store.get("music"));
        this.audio.setMusicOn(Store.get("music"));
        this.updateMusicButton();
      }
    });

    // desktop: canvas click re-locks pointer during gameplay
    this.renderer.domElement.addEventListener("click", () => {
      if (!this.inXR && !this.paused && this.modeName !== "hub" && !document.pointerLockElement && !this.input.touch.active) {
        this.lockPointer();
      }
    });

    this.dev = new URLSearchParams(location.search).has("dev");
    this.testSpeed = new URLSearchParams(location.search).has("fastTest") ? 6 : 1;
    this.testBreach = new URLSearchParams(location.search).has("testBreach");
    if (this.dev) {
      this.devEl = document.getElementById("dev");
      this.devEl.style.display = "block";
      this.devFrames = 0; this.devAt = performance.now();
    }

    this.audio.load();
    this.acc = 0;
    this.lastT = performance.now();
    this.timeSec = 0;
    this.setMode("hub");
    const forcedMode = new URLSearchParams(location.search).get("mode");
    if (forcedMode === "disc" || forcedMode === "cycle") this.setMode(forcedMode);
    this.renderer.setAnimationLoop((t) => this.frame(t));
    window.__game = this;
  }

  applyEnv(skyMesh) {
    try {
      const envScene = new THREE.Scene();
      const clone = skyMesh.clone();
      envScene.add(clone);
      const env = this.pmrem.fromScene(envScene, 0.04);
      this.scene.environment = env.texture;
      envScene.remove(clone);
    } catch { /* env optional */ }
  }

  // ---------------- XR hands ----------------
  buildXRHands() {
    const mkRay = () => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -6)]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.4 }));
      return line;
    };
    this.xrHandRoots = [];
    for (let i = 0; i < 2; i++) {
      const grip = this.renderer.xr.getControllerGrip(i);
      const ctrl = this.renderer.xr.getController(i);
      const gaunt = this.kit.makeGauntlet(COL.cyan);
      gaunt.rotation.x = -0.5;
      gaunt.visible = false; // shown only inside an XR session
      grip.add(gaunt);
      const ray = mkRay();
      ray.visible = false;
      ctrl.add(ray);
      ctrl.userData.ray = ray;
      this.scene.add(grip, ctrl);
      this.xrHandRoots.push(gaunt, ray);
    }
    this.guardShield = this.kit.makeBuckler(COL.cyan);
    this.guardShield.visible = false;
    this.scene.add(this.guardShield);
    this.desktopShield = this.kit.makeBuckler(COL.cyan);
    this.desktopShield.visible = false;
    this.camera.add(this.desktopShield);
    this.desktopShield.position.set(0, -0.18, -0.55);
  }

  // ---------------- DOM ----------------
  buildMenu() {
    const $ = (id) => document.getElementById(id);
    $("logo").textContent = STR.title;
    $("subtitle").textContent = STR.subtitle;
    $("version").textContent = STR.version;
    $("howTitle").textContent = STR.howTitle;
    const how = $("howto"), howButton = $("btnHow"), helpBody = $("helpBody");
    const help = {
      discVR: [STR.helpDiscVRTitle, STR.helpDiscVR],
      discAR: [STR.helpDiscARTitle, STR.helpDiscAR],
      cycleVR: [STR.helpCycleVRTitle, STR.helpCycleVR],
      desktop: [STR.helpDesktopTitle, STR.helpDesktop],
    };
    const tabs = [...document.querySelectorAll("[data-help]")];
    const selectHelp = (key) => {
      for (const tab of tabs) tab.classList.toggle("active", tab.dataset.help === key);
      helpBody.textContent = help[key][1];
    };
    for (const tab of tabs) {
      tab.textContent = help[tab.dataset.help][0];
      tab.onclick = () => selectHelp(tab.dataset.help);
    }
    selectHelp("discVR");
    howButton.textContent = STR.menuInstructions;
    howButton.onclick = () => {
      const open = how.classList.toggle("open");
      howButton.textContent = open ? STR.menuHideInstructions : STR.menuInstructions;
    };
    $("btnMusic").onclick = () => {
      this.audio.resume();
      Store.set("music", !Store.get("music"));
      this.audio.setMusicOn(Store.get("music"));
      this.updateMusicButton();
      if (Store.get("music")) this.audio.playMusic("mus_hub");
    };
    this.updateMusicButton();
    const bVR = $("btnVR"), bAR = $("btnAR"), bDesk = $("btnDesk"), noxr = $("noXR");
    bVR.textContent = STR.menuEnterVR;
    bAR.textContent = STR.menuEnterAR;
    bDesk.textContent = STR.menuDesktop;
    bVR.disabled = true; bAR.disabled = true;
    const framed = window.self !== window.top;
    if (!window.isSecureContext) {
      noxr.textContent = STR.menuXRInsecure;
    } else if (navigator.xr) {
      noxr.textContent = STR.menuXRChecking;
      const probe = () => {
        Promise.allSettled([
          navigator.xr.isSessionSupported("immersive-vr"),
          navigator.xr.isSessionSupported("immersive-ar"),
        ]).then(([vr, ar]) => {
          const vrOK = vr.status === "fulfilled" && vr.value;
          const arOK = ar.status === "fulfilled" && ar.value;
          // A rejected capability probe should not permanently block a user gesture.
          bVR.disabled = vr.status === "fulfilled" ? !vrOK : false;
          bAR.disabled = ar.status === "fulfilled" ? !arOK : false;
          noxr.textContent = vrOK || arOK ? STR.menuXRReady : STR.menuNoXR;
          this.xrSupport = { vr: vrOK, ar: arOK, secure: true, framed };
        });
      };
      probe();
      navigator.xr.addEventListener?.("devicechange", probe);
    } else if (framed) {
      // Marketplace embeds frequently omit the xr-spatial-tracking permission.
      // Keep the buttons actionable and escape to a direct, top-level secure page.
      bVR.disabled = false; bAR.disabled = false;
      noxr.textContent = STR.menuXRDirect;
      this.xrSupport = { vr: false, ar: false, secure: true, framed: true, blockedByEmbed: true };
    } else {
      noxr.textContent = STR.menuNoXR;
      this.xrSupport = { vr: false, ar: false, secure: true, framed: false };
    }
    bDesk.onclick = () => { this.audio.resume(); this.hideMenu(); this.audio.playMusic("mus_hub"); };
    bVR.onclick = () => this.requestXRFromMenu("immersive-vr");
    bAR.onclick = () => this.requestXRFromMenu("immersive-ar");
    $("pauseTitle").textContent = STR.paused;
    $("btnResume").textContent = STR.backToGame;
    $("btnHub").textContent = STR.returnToHub;
    $("btnResume").onclick = () => this.setPaused(false);
    $("btnHub").onclick = () => { this.setPaused(false); this.setMode("hub"); };
    // touch button labels
    document.querySelectorAll("[data-label]").forEach((el) => { el.textContent = STR[el.dataset.label]; });
  }

  updateMusicButton() {
    const b = document.getElementById("btnMusic");
    if (b) b.textContent = `${STR.setMusic}: ${Store.get("music") ? STR.on : STR.off}`;
  }

  hideMenu() { document.getElementById("menu").classList.add("hidden"); }
  showMenu() { document.getElementById("menu").classList.remove("hidden"); }

  buildHud() {
    const $ = (id) => document.getElementById(id);
    const els = {
      root: $("hud"), pips: $("pips"), epips: $("epips"), round: $("round"),
      enemy: $("enemy"), disc: $("discState"), boostWrap: $("boostWrap"), boost: $("boostFill"),
      hint: $("hint"), cross: $("crosshair"), flash: $("flash"), touch: $("touchUI"),
    };
    const game = this;
    return {
      state: {},
      showGameplay(on) {
        els.root.style.display = on && !game.inXR ? "block" : "none";
        els.cross.style.display = on && !game.inXR && !game.input.touch.active ? "block" : "none";
        els.touch.style.display = on && !game.inXR && game.input.touch.active ? "block" : "none";
        els.touch.dataset.mode = game.modeName;
        if (!on) {
          game.wrist.mesh.visible = false;
          els.boostWrap.style.display = "none";
          this.state = {};
        }
      },
      hint(t) { els.hint.textContent = t || ""; },
      set(s) {
        Object.assign(this.state, s);
        const st = this.state;
        const sep = document.getElementById("pipSep");
        if (st.pips != null) {
          els.pips.textContent = "◆".repeat(st.pips) + "◇".repeat(Math.max(0, 3 - st.pips));
          els.epips.textContent = st.epips != null ? "◆".repeat(st.epips) + "◇".repeat(Math.max(0, 3 - st.epips)) : "";
          sep.style.visibility = st.epips != null ? "visible" : "hidden";
        } else { els.pips.textContent = ""; els.epips.textContent = ""; sep.style.visibility = "hidden"; }
        els.round.textContent = st.round || "";
        els.enemy.textContent = st.enemy || "";
        els.disc.textContent = st.disc || "";
        if (st.boost != null) {
          els.boostWrap.style.display = "block";
          els.boost.style.width = `${Math.round(st.boost * 100)}%`;
        } else els.boostWrap.style.display = "none";
        // XR wrist mirror
        if (game.inXR) {
          const lines = [];
          if (st.enemy) lines.push(st.enemy);
          if (st.round) lines.push(st.round);
          if (st.pips != null) lines.push(`${STR.hudIntegrity} ${"◆".repeat(st.pips)}${"◇".repeat(Math.max(0, 3 - st.pips))}`);
          if (st.boost != null) lines.push(`${STR.hudBoost} ${"█".repeat(Math.round(st.boost * 8))}`);
          if (st.disc) lines.push(st.disc);
          game.wrist.set(lines.length ? lines : [" "], { bg: "rgba(2,8,14,0.72)", size: 0.24 });
          game.wrist.mesh.visible = true;
        }
      },
    };
  }

  // ---------------- sessions ----------------
  bindSessionEvents() {
    this.renderer.xr.addEventListener("sessionstart", () => {
      this.inXR = true;
      this.camPitch = 0;
      this.camera.rotation.set(0, 0, 0);
      for (const h of this.xrHandRoots) h.visible = true;
      this.renderer.xr.setFoveation && this.renderer.xr.setFoveation(1);
      if (this.isAR) {
        this.scene.background = null;
        this.scene.fog = null;
        this.sky.visible = false;
        this.voidFloor.visible = false;
      }
      // wrist panel on the guard hand
      const gc = this.input.guardCtrl();
      const grip = gc ? gc.grip : this.renderer.xr.getControllerGrip(1);
      grip.add(this.wrist.mesh);
      this.wrist.mesh.position.set(0, 0.03, 0.12);
      this.wrist.mesh.rotation.set(-1.1, 0, 0);
      this.hideMenu();
      this.hud.showGameplay(this.modeName !== "hub");
      this.setMode("hub");
    });
    this.renderer.xr.addEventListener("sessionend", () => {
      this.inXR = false;
      this.isAR = false;
      for (const h of this.xrHandRoots) h.visible = false;
      this.scene.background = new THREE.Color(COL.bg);
      this.scene.fog = new THREE.Fog(COL.bg, 70, 680);
      this.sky.visible = true;
      this.voidFloor.visible = true;
      this.pausePanel.mesh.visible = false;
      this.setPaused(false);
      this.setMode("hub");
      this.showMenu();
    });
  }

  requestXRFromMenu(kind) {
    if (!window.isSecureContext) {
      document.getElementById("noXR").textContent = STR.menuXRInsecure;
      return;
    }
    if (!navigator.xr) {
      if (window.self !== window.top) {
        document.getElementById("noXR").textContent = STR.menuXRDirect;
        window.open(location.href, "_blank", "noopener,noreferrer");
      } else {
        document.getElementById("noXR").textContent = STR.menuNoXR;
      }
      return;
    }
    this.enterXR(kind);
  }

  async enterXR(kind) {
    this.audio.resume();
    try {
      const opts = kind === "immersive-ar"
        ? { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "plane-detection", "hit-test", "anchors"] }
        : { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"] };
      this.renderer.xr.setReferenceSpaceType("local-floor");
      const session = await navigator.xr.requestSession(kind, opts);
      this.isAR = kind === "immersive-ar";
      await this.renderer.xr.setSession(session);
      try { this.xrBoundedSpace = await session.requestReferenceSpace("bounded-floor"); }
      catch { this.xrBoundedSpace = null; }
    } catch (err) {
      this.isAR = false;
      const code = err && err.name ? ` (${err.name})` : "";
      document.getElementById("noXR").textContent = STR.menuXRError + code;
    }
  }

  // ---------------- helpers for modes ----------------
  setMode(name) {
    if (this.mode) this.mode.exit(this);
    this.modeName = name;
    this.mode = this.modes[name];
    this.vigTarget = 0;
    this.mode.enter(this);
    this.hud.showGameplay(name !== "hub");
  }

  setDesktopEye(h = 1.65) {
    if (!this.inXR) {
      this.camera.position.set(0, h, 0);
    }
  }

  viewYaw() {
    this.camera.getWorldDirection(_v);
    return Math.atan2(_v.x, _v.z);
  }

  camForward(out) { return this.camera.getWorldDirection(out); }
  headWorld(out) { return this.camera.getWorldPosition(out); }

  discHandWorld(out) {
    const c = this.inXR ? this.input.discCtrl() : null;
    if (c) return c.obj.getWorldPosition(out);
    out.set(0.32, -0.28, -0.58);
    return out.applyMatrix4(this.camera.matrixWorld);
  }

  guardWorld(out) {
    const c = this.inXR ? this.input.guardCtrl() : null;
    if (c) return c.obj.getWorldPosition(out);
    out.set(0, -0.18, -0.55);
    return out.applyMatrix4(this.camera.matrixWorld);
  }

  hapticDisc(v, ms) { const c = this.input.discCtrl(); if (c) pulse(c.source, v, ms); }
  hapticGuard(v, ms) { const c = this.input.guardCtrl(); if (c) pulse(c.source, v, ms); }

  lockPointer() {
    if (this.inXR || this.input.touch.active) return;
    const el = this.renderer.domElement;
    if (!document.pointerLockElement && el.requestPointerLock) {
      try {
        const pending = el.requestPointerLock();
        if (pending && typeof pending.catch === "function") pending.catch(() => {});
      } catch { /* needs gesture */ }
    }
  }
  unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }

  raycastFrom(e) {
    if (e && e.src === "xr" && e.ctrl) {
      e.ctrl.obj.getWorldPosition(_v);
      _q.setFromRotationMatrix(e.ctrl.obj.matrixWorld);
      _v2.set(0, 0, -1).applyQuaternion(_q);
      _ray.set(_v, _v2);
    } else if (e && e.ndc) {
      _ndc.set(e.ndc.x, e.ndc.y);
      _ray.setFromCamera(_ndc, this.camera);
    } else {
      _ndc.set(0, 0);
      _ray.setFromCamera(_ndc, this.camera);
    }
    return _ray;
  }

  raycastHotspots(e, hotspots) {
    const r = this.raycastFrom(e);
    const hits = r.intersectObjects(hotspots, false);
    return hits.length ? hits[0].object : null;
  }

  hoverHotspot(hotspots) {
    let e = null;
    if (this.inXR) {
      const c = this.input.discCtrl();
      if (!c) return null;
      e = { src: "xr", ctrl: c };
    } else if (!document.pointerLockElement) {
      e = { ndc: this.input.pointerNDC };
    }
    const r = this.raycastFrom(e);
    const hits = r.intersectObjects(hotspots, false);
    return hits.length ? hits[0].object : null;
  }

  banner(lines, dur = 2) {
    this.banner3d.set(lines, { size: lines.length > 1 ? 0.3 : 0.42 });
    this.bannerT = dur;
    this.banner3d.mesh.visible = true;
    this.placeFront(this.banner3d.mesh, 4.4, 0.55);
  }

  placeFront(mesh, dist, up = 0) {
    this.camera.updateWorldMatrix(true, false);
    this.headWorld(_v);
    this.camera.getWorldDirection(_v2);
    _v2.y = 0;
    if (_v2.lengthSq() < 0.001) _v2.set(0, 0, -1);
    _v2.normalize();
    mesh.position.copy(_v).addScaledVector(_v2, dist);
    mesh.position.y = Math.max(_v.y + up, 1.0);
    mesh.lookAt(_v.x, mesh.position.y, _v.z);
  }

  flash(a) { this.vigFlash = Math.max(this.vigFlash, a); }
  vignetteSet(v) { this.vigTarget = v; }

  // Read the user's configured boundary first, then fall back to detected floor planes.
  scanRoomPlanes() {
    try {
      const boundary = this.xrBoundedSpace && this.xrBoundedSpace.boundsGeometry;
      if (boundary && boundary.length >= 3) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of boundary) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
        const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
        this.roomBounds = { x, z, r: Math.min(maxX - minX, maxZ - minZ) / 2, minX, maxX, minZ, maxZ, source: "guardian" };
        return;
      }
      const frame = this.renderer.xr.getFrame ? this.renderer.xr.getFrame() : null;
      const refSpace = this.renderer.xr.getReferenceSpace ? this.renderer.xr.getReferenceSpace() : null;
      if (!frame || !refSpace || !frame.detectedPlanes) return;
      let best = null;
      for (const plane of frame.detectedPlanes) {
        if (plane.orientation !== "horizontal" || !plane.polygon || plane.polygon.length < 3) continue;
        const pose = frame.getPose(plane.planeSpace, refSpace);
        if (!pose) continue;
        const py = pose.transform.position.y;
        if (py > 0.35 || py < -0.5) continue; // floors only
        // polygon points live in plane space on x/z
        let cx = 0, cz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of plane.polygon) { cx += p.x; cz += p.z; }
        cx /= plane.polygon.length; cz /= plane.polygon.length;
        let r = 0;
        for (const p of plane.polygon) {
          const d = Math.hypot(p.x - cx, p.z - cz);
          if (d > r) r = d;
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
        // transform the centroid into world space (ignore rotation about y for the circle)
        const wx = pose.transform.position.x + cx;
        const wz = pose.transform.position.z + cz;
        if (!best || r > best.r) best = { x: wx, z: wz, r, minX: wx + minX - cx, maxX: wx + maxX - cx, minZ: wz + minZ - cz, maxZ: wz + maxZ - cz, source: "plane" };
      }
      if (best) this.roomBounds = best;
    } catch { /* plane detection unavailable */ }
  }

  setPaused(p) {
    if (this.paused === p) return;
    this.paused = p;
    const overlay = document.getElementById("pause");
    if (p) {
      if (this.inXR) {
        this.pausePanel.set([STR.paused, STR.backToGame, STR.returnToHub], { bg: "rgba(2,8,14,0.9)", size: 0.26 });
        this.pausePanel.mesh.visible = true;
        this.placeFront(this.pausePanel.mesh, 2.2, 0);
      } else {
        overlay.classList.remove("hidden");
        this.unlockPointer();
      }
    } else {
      overlay.classList.add("hidden");
      this.pausePanel.mesh.visible = false;
      if (!this.inXR && this.modeName !== "hub") this.lockPointer();
    }
  }

  // ---------------- main loop ----------------
  frame(t) {
    const rdt = Math.min(Math.max((t - this.lastT) / 1000, 0), 0.1);
    this.lastT = t;
    this.timeSec += rdt;

    this.input.pollGamepad(rdt, this.modeName);
    if (this.inXR) this.input.pollXR(rdt, this.modeName, this.camera);

    // AR room bounds from detected planes (throttled)
    if (this.inXR && this.isAR && this.timeSec - (this.roomScanAt || 0) > 1) {
      this.roomScanAt = this.timeSec;
      this.scanRoomPlanes();
    }

    let events = this.input.drain();
    // global events
    const passed = [];
    for (const e of events) {
      if (e.type === "pause") {
        if (this.modeName !== "hub") this.setPaused(!this.paused);
        continue;
      }
      if (e.type === "quit") {
        if (this.modeName !== "hub") {
          this.setPaused(false);
          this.audio.select();
          this.setMode("hub");
        }
        continue;
      }
      if (e.type === "lockLost") {
        if (!this.inXR && this.modeName !== "hub" && !this.paused && !this.input.touch.active) this.setPaused(true);
        continue;
      }
      if (this.paused && e.type === "primary") {
        if (this.inXR) {
          const hit = this.raycastHotspots(e, this.pauseHotspots);
          if (hit) {
            this.audio.select();
            if (hit.userData.action === "resume") this.setPaused(false);
            else { this.setPaused(false); this.setMode("hub"); }
          }
        }
        continue;
      }
      passed.push(e);
    }
    events = passed;

    // desktop look
    if (!this.inXR) {
      this.input.consumeLook(_look);
      const sens = 0.0022;
      if (this.modeName === "cycle") {
        this.camera.rotation.y = Math.max(-1.2, Math.min(1.2, this.camera.rotation.y - _look.x * sens));
        this.camPitch = Math.max(-1.2, Math.min(1.2, this.camPitch - _look.y * sens));
      } else {
        this.rig.rotation.y -= _look.x * sens;
        this.camPitch = Math.max(-1.45, Math.min(1.45, this.camPitch - _look.y * sens));
        this.camera.rotation.y = 0;
      }
      this.camera.rotation.x = this.camPitch;
    }

    if (!this.paused) {
      this.acc += rdt;
      let n = 0;
      while (this.acc >= STEP && n < 5) {
        this.mode.update(this, STEP, n === 0 ? events : _noEvents);
        this.acc -= STEP;
        n++;
      }
      if (n === 5) this.acc = 0;
      const alpha = this.acc / STEP;
      this.mode.frame(this, rdt, alpha, this.timeSec);
      this.shatter.update(rdt);
    }

    // banner
    if (this.bannerT > 0) {
      this.bannerT -= rdt;
      const m = this.banner3d.mesh.material;
      m.opacity = Math.max(0, Math.min(1, this.bannerT * 2.5));
      if (this.modeName === "cycle" && !this.isAR) this.placeFront(this.banner3d.mesh, 4.4, 0.55);
      if (this.bannerT <= 0) this.banner3d.mesh.visible = false;
    }

    // controller rays only matter for hub/pause selection
    if (this.inXR) {
      const wantRays = this.modeName === "hub" || this.paused;
      for (const h of this.xrHandRoots) {
        if (h.isLine) h.visible = wantRays;
      }
    }

    // guard shields
    const guarding = this.input.guardHeld(this.inXR) && this.modeName === "disc" && !this.paused;
    if (this.inXR) {
      this.guardShield.visible = guarding;
      if (guarding) {
        this.guardWorld(this.guardShield.position);
        this.guardShield.quaternion.copy(this.camera.getWorldQuaternion(_q));
      }
      this.desktopShield.visible = false;
    } else {
      this.desktopShield.visible = guarding;
      this.guardShield.visible = false;
    }

    // vignette
    const vt = Math.min(1, this.vigTarget + this.vigFlash);
    this.vigFlash = Math.max(0, this.vigFlash - rdt * 2.5);
    const vm = this.vignette.material;
    vm.opacity += (vt - vm.opacity) * Math.min(1, rdt * 10);
    this.vignette.visible = vm.opacity > 0.02;
    const fl = document.getElementById("flash");
    if (!this.inXR) fl.style.opacity = String(this.vigFlash * 0.6);
    else fl.style.opacity = "0";

    if (this.dev) {
      this.devFrames++;
      const now = performance.now();
      if (now - this.devAt > 500) {
        const fps = Math.round((this.devFrames * 1000) / (now - this.devAt));
        this.devFrames = 0; this.devAt = now;
        const i = this.renderer.info.render;
        this.devEl.textContent = `${fps} fps · ${i.calls} calls · ${(i.triangles / 1000) | 0}k tri`;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  renderTextState() {
    const base = {
      coordinateSystem: "Three.js world coordinates: +x right, +y up, -z forward",
      mode: this.modeName,
      paused: this.paused,
      xr: { active: this.inXR, ar: this.isAR, support: this.xrSupport || null },
    };
    if (this.modeName === "cycle" && this.mode.cycles) {
      base.arena = { shape: "square", min: -82, max: 82, overheadMap: true };
      base.state = this.mode.state;
      base.runTime = Number((this.mode.runT || 0).toFixed(2));
      base.controls = {
        boostSurge: !!this.mode.cycles[0].boosting,
        boostSurgeLeft: Number((this.mode.boostBurstT || 0).toFixed(2)),
        speedMult: Number((this.mode.playerMult || 1).toFixed(2)),
        dashboardHeight: Number((this.mode.dashboardHeight || 0).toFixed(2)),
      };
      base.cycles = this.mode.cycles.map((c) => ({
        player: c.isPlayer,
        alive: c.alive,
        x: Number(c.pos.x.toFixed(2)),
        z: Number(c.pos.z.toFixed(2)),
        direction: c.dirIdx,
        trailSegments: c.segs.length,
      }));
    } else if (this.modeName === "disc" && this.mode.disc) {
      base.arena = { shape: this.mode.ar ? "detected-room" : "square", floorRicochet: true, wallRicochet: true };
      base.state = this.mode.state;
      base.roomBounds = this.roomBounds || null;
      base.openings = {
        floor: this.mode.holes?.filter((h) => h.active).length || 0,
        wall: this.mode.breaches?.filter((b) => b.life > 0).length || 0,
      };
      base.playerDisc = { state: this.mode.disc.state, banks: this.mode.disc.banks, x: Number(this.mode.disc.pos.x.toFixed(2)), y: Number(this.mode.disc.pos.y.toFixed(2)), z: Number(this.mode.disc.pos.z.toFixed(2)) };
      base.enemyDisc = { state: this.mode.eDisc.state, banks: this.mode.eDisc.banks };
      base.enemy = { x: Number(this.mode.enemy.pos.x.toFixed(2)), y: Number(this.mode.enemy.pos.y.toFixed(2)), z: Number(this.mode.enemy.pos.z.toFixed(2)), pips: this.mode.enemy.pips };
    }
    return JSON.stringify(base);
  }

  advanceForTest(ms) {
    ms *= this.testSpeed || 1;
    const steps = Math.max(1, Math.round(ms / (STEP * 1000)));
    const queued = this.input.drain();
    for (let i = 0; i < steps; i++) {
      this.timeSec += STEP;
      this.mode.update(this, STEP, i === 0 ? queued : _noEvents);
    }
    this.mode.frame(this, 0, 1, this.timeSec);
    this.renderer.render(this.scene, this.camera);
  }
}

const _look = { x: 0, y: 0 };
const _noEvents = [];

const game = new Game();
window.render_game_to_text = () => game.renderTextState();
window.advanceTime = (ms) => game.advanceForTest(ms);
