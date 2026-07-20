import * as THREE from "../vendor/three.module.js";
import { MotionTrace } from "./util.js";

const _v = new THREE.Vector3();

// Every source (keyboard by physical code, mouse, touch zones, gamepad, XR
// controllers) is folded into one command surface: held state + edge events.
export class Input {
  constructor() {
    this.keys = new Set();
    this.events = [];
    this.lookX = 0; this.lookY = 0;
    this.pointerNDC = { x: 0, y: 0 };
    this.pointerLocked = false;

    this.mouseGuard = false;
    this.touch = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, guard: false, boost: false, brake: false, active: false };
    this.padPrev = [];
    this.padGuard = false; this.padBoost = false; this.padBrake = false;
    this.padStickPrevX = 0;

    // XR
    this.xrSession = null;
    this.ctrls = [];            // {obj, grip, source, hand, trace, stickPrevX, squeezeT}
    this.discHand = "right";
    this.xrThrowHeld = false;
    this.xrGuard = false;

    this._bindDom();
  }

  push(type, data) { this.events.push(Object.assign({ type }, data)); }

  drain() {
    const out = this.events;
    this.events = [];
    return out;
  }

  _bindDom() {
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Space") { this.push("jump"); e.preventDefault(); }
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.push("dash");
      if (e.code === "KeyQ" && e.shiftKey) { this.push("quit"); e.preventDefault(); }
      if (e.code === "KeyR") this.push("recall");
      if (e.code === "KeyA" || e.code === "ArrowLeft") this.push("turnL");
      if (e.code === "KeyD" || e.code === "ArrowRight") this.push("turnR");
      if (e.code === "KeyP") this.push("pause");
      if (e.code === "KeyB") this.push("emergencyStop");
      if (e.code === "Enter") this.push("primary", { src: "center" });
      if (["KeyW", "KeyS", "KeyA", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));

    addEventListener("mousemove", (e) => {
      if (this.pointerLocked) {
        this.lookX += e.movementX; this.lookY += e.movementY;
      }
      this.pointerNDC.x = (e.clientX / innerWidth) * 2 - 1;
      this.pointerNDC.y = -(e.clientY / innerHeight) * 2 + 1;
    });
    const overlayOpen = () => {
      const m = document.getElementById("menu");
      const p = document.getElementById("pause");
      return (m && !m.classList.contains("hidden")) || (p && !p.classList.contains("hidden"));
    };
    addEventListener("mousedown", (e) => {
      if (overlayOpen()) return; // DOM overlays own their clicks
      if (e.button === 0) this.push("primary", { src: "mouse", ndc: { x: this.pointerNDC.x, y: this.pointerNDC.y } });
      if (e.button === 2) this.mouseGuard = true;
    });
    addEventListener("mouseup", (e) => { if (e.button === 2) this.mouseGuard = false; });
    addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement != null;
      if (!this.pointerLocked) this.push("lockLost");
    });

    // Touch: left half = move stick (disc mode), right half = look drag.
    // Buttons come from DOM elements tagged data-cmd (index.html builds them).
    const touches = new Map();
    addEventListener("touchstart", (e) => {
      this.touch.active = true;
      for (const t of e.changedTouches) {
        const el = t.target;
        if (el && el.dataset && el.dataset.cmd) {
          const c = el.dataset.cmd;
          touches.set(t.identifier, { kind: "btn", cmd: c });
          if (c === "throw") this.push("primary", { src: "touch" });
          else if (c === "guard") this.touch.guard = true;
          else if (c === "dash") this.push("dash");
          else if (c === "boost") this.touch.boost = true;
          else if (c === "brake") this.touch.brake = true;
          else if (c === "turnL") this.push("turnL");
          else if (c === "turnR") this.push("turnR");
          else if (c === "pause") this.push("pause");
          e.preventDefault();
          continue;
        }
        if (overlayOpen()) continue; // let menu/pause buttons work natively
        if (t.clientX < innerWidth * 0.42) {
          touches.set(t.identifier, { kind: "move", ox: t.clientX, oy: t.clientY });
        } else {
          touches.set(t.identifier, { kind: "look", px: t.clientX, py: t.clientY, moved: 0 });
        }
        e.preventDefault();
      }
    }, { passive: false });
    addEventListener("touchmove", (e) => {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier);
        if (!s) continue;
        if (s.kind === "move") {
          this.touch.move.x = Math.max(-1, Math.min(1, (t.clientX - s.ox) / 60));
          this.touch.move.y = Math.max(-1, Math.min(1, (t.clientY - s.oy) / 60));
        } else if (s.kind === "look") {
          this.touch.look.dx += (t.clientX - s.px) * 2.2;
          this.touch.look.dy += (t.clientY - s.py) * 2.2;
          s.moved += Math.abs(t.clientX - s.px) + Math.abs(t.clientY - s.py);
          s.px = t.clientX; s.py = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier);
        touches.delete(t.identifier);
        if (!s) continue;
        if (s.kind === "move") { this.touch.move.x = 0; this.touch.move.y = 0; }
        if (s.kind === "btn") {
          if (s.cmd === "guard") this.touch.guard = false;
          if (s.cmd === "boost") this.touch.boost = false;
          if (s.cmd === "brake") this.touch.brake = false;
        }
        if (s.kind === "look" && s.moved < 12) {
          const ndcx = (t.clientX / innerWidth) * 2 - 1;
          const ndcy = -(t.clientY / innerHeight) * 2 + 1;
          this.push("primary", { src: "touchTap", ndc: { x: ndcx, y: ndcy } });
        }
      }
      if (touches.size === 0) { /* keep touch.active latched for UI layout */ }
    };
    addEventListener("touchend", endTouch);
    addEventListener("touchcancel", endTouch);
    addEventListener("blur", () => { this.keys.clear(); this.mouseGuard = false; });
  }

  // ---------- gamepad ----------
  pollGamepad(dt, mode) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const prev = this.padPrev[gp.index] || { buttons: [], ax: 0 };
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const was = (i) => !!prev.buttons[i];
      if (b(7) && !was(7)) this.push("primary", { src: "center" });
      this.padGuard = b(6);
      this.padBoost = b(0);
      this.padBrake = b(1) || b(6);
      if (b(0) && !was(0)) this.push("jump");
      if (b(2) && !was(2)) this.push("dash");
      if (b(3) && !was(3)) this.push("recall");
      if (b(8) && !was(8)) this.push("quit");
      if (b(9) && !was(9)) this.push("pause");
      if (b(14) && !was(14)) this.push("turnL");
      if (b(15) && !was(15)) this.push("turnR");
      const ax = gp.axes[0] || 0;
      if (mode === "cycle") {
        if (ax < -0.65 && prev.ax >= -0.65) this.push("turnL");
        if (ax > 0.65 && prev.ax <= 0.65) this.push("turnR");
      }
      this.lookX += (gp.axes[2] || 0) * 1400 * dt * (Math.abs(gp.axes[2] || 0) > 0.15 ? 1 : 0);
      this.lookY += (gp.axes[3] || 0) * 1000 * dt * (Math.abs(gp.axes[3] || 0) > 0.15 ? 1 : 0);
      this.padMoveX = Math.abs(ax) > 0.18 && mode !== "cycle" ? ax : 0;
      this.padMoveY = Math.abs(gp.axes[1] || 0) > 0.18 ? gp.axes[1] : 0;
      this.padPrev[gp.index] = { buttons: gp.buttons.map((x) => x.pressed), ax };
    }
  }

  // ---------- XR ----------
  bindXR(renderer, onSqueezePause) {
    for (let i = 0; i < 2; i++) {
      const obj = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const c = { obj, grip, source: null, hand: null, trace: new MotionTrace(24), stickPrevX: 0, squeezeT: 0, pausedFired: false };
      obj.addEventListener("connected", (e) => { c.source = e.data; c.hand = e.data.handedness || (i === 0 ? "right" : "left"); });
      obj.addEventListener("disconnected", () => { c.source = null; });
      obj.addEventListener("selectstart", () => {
        if (c.hand === this.discHand) { this.xrThrowHeld = true; this.push("xrGrab", { hand: c.hand }); }
        this.push("primary", { src: "xr", ctrl: c });
      });
      obj.addEventListener("selectend", () => {
        if (c.hand === this.discHand) {
          this.xrThrowHeld = false;
          const vel = new THREE.Vector3();
          const ok = c.trace.velocity(performance.now() / 1000, 0.1, vel);
          this.push("xrThrow", { hand: c.hand, velocity: ok ? vel : null, ctrl: c });
        }
      });
      obj.addEventListener("squeezestart", () => {
        c.squeezeHeld = true;
        c.squeezeT = performance.now();
        c.pausedFired = false;
        this.xrQuitFired = false;
        if (c.hand !== this.discHand) this.xrGuard = true;
      });
      obj.addEventListener("squeezeend", () => {
        c.squeezeHeld = false;
        if (c.hand !== this.discHand) this.xrGuard = false;
        c.squeezeT = 0;
        this.xrQuitFired = false;
      });
      this.ctrls.push(c);
    }
    this._onSqueezePause = onSqueezePause;
  }

  pollXR(dt, mode, xrCamera) {
    const now = performance.now() / 1000;
    if (mode === "cycle") {
      this.xrSteer = 0;
      this.xrBoost = false;
      this.xrBrake = false;
      this.xrDashAdjust = 0;
    }
    for (const c of this.ctrls) {
      if (!c.source) continue;
      c.obj.getWorldPosition(_v);
      c.trace.push(_v.x, _v.y, _v.z, now);
      const gp = c.source.gamepad;
      if (gp && gp.axes.length >= 4) {
        const x = gp.axes[2] || 0, y = gp.axes[3] || 0;
        if (c.hand === "left") { this.xrMoveX = Math.abs(x) > 0.2 ? x : 0; this.xrMoveY = Math.abs(y) > 0.2 ? y : 0; }
        if (mode === "cycle") {
          if (c.hand === "left") {
            this.xrSteer = Math.abs(x) > 0.16 ? x : 0;
            this.xrBrake = y > 0.68;
          } else if (c.hand === "right") {
            this.xrDashAdjust = Math.abs(y) > 0.28 ? -y : 0;
          }
        } else if (c.hand === "right") {
          if (x < -0.6 && c.stickPrevX >= -0.6) this.push("snapL");
          if (x > 0.6 && c.stickPrevX <= 0.6) this.push("snapR");
        }
        c.stickPrevX = x;
        if (mode === "cycle") {
          // Either controller trigger engages the timed boost.
          const trigger = (gp.buttons[0] && gp.buttons[0].value) || 0;
          if (trigger > 0.12) this.xrBoost = true;
        }
      }
      // face buttons: A/X (4) = hop, B/Y (5) = pause
      if (gp && gp.buttons.length > 4) {
        const face = !!(gp.buttons[4] && gp.buttons[4].pressed);
        if (face && !c.facePrev) this.push(mode === "cycle" ? "emergencyStop" : "hop", { hand: c.hand });
        c.facePrev = face;
        const face2 = !!(gp.buttons[5] && gp.buttons[5].pressed);
        if (face2 && !c.face2Prev) this.push("pause");
        c.face2Prev = face2;
      }
      // grips are HANDLEBARS in cycle mode: no grip-pause / grip-quit there
      if (mode !== "cycle") {
        const other = this.ctrls.find((o) => o !== c && o.source);
        const otherHeld = other && other.squeezeHeld;
        if (c.squeezeT && !c.pausedFired && !otherHeld && c.hand !== this.discHand &&
            performance.now() - c.squeezeT > 600) {
          c.pausedFired = true;
          this.push("pause");
        }
        // both grips held 1s = quit to hub
        if (c.squeezeHeld && otherHeld && !this.xrQuitFired) {
          const t0 = Math.max(c.squeezeT || 0, other.squeezeT || 0);
          if (t0 && performance.now() - t0 > 1000) {
            this.xrQuitFired = true;
            this.push("quit");
          }
        }
      }
    }
  }

  bothGripsHeld() {
    let n = 0;
    for (const c of this.ctrls) if (c.source && c.squeezeHeld) n++;
    return n >= 2;
  }

  gripHeld(hand) {
    const c = this.ctrls.find((o) => o.source && o.hand === hand);
    return !!(c && c.squeezeHeld);
  }

  handY(hand) {
    const c = this.ctrls.find((o) => o.source && o.hand === hand);
    if (!c) return null;
    c.obj.getWorldPosition(_v);
    return _v.y;
  }

  cycleSteer() { return this.xrSteer || 0; }
  dashboardAdjust() { return this.xrDashAdjust || 0; }

  discCtrl() { return this.ctrls.find((c) => c.source && c.hand === this.discHand) || null; }
  guardCtrl() { return this.ctrls.find((c) => c.source && c.hand !== this.discHand) || null; }

  // ---------- unified reads ----------
  guardHeld(inXR) {
    return inXR ? this.xrGuard : (this.mouseGuard || this.padGuard || this.touch.guard || this.keys.has("KeyQ"));
  }

  boostHeld(inXR) {
    return inXR ? !!this.xrBoost : (this.keys.has("KeyW") || this.keys.has("ArrowUp") || this.padBoost || this.touch.boost);
  }

  brakeHeld(inXR) {
    return inXR ? !!this.xrBrake : (this.keys.has("KeyS") || this.keys.has("ArrowDown") || this.padBrake || this.touch.brake);
  }

  moveVec(out, inXR) {
    let x = 0, y = 0;
    if (inXR) {
      x = this.xrMoveX || 0; y = this.xrMoveY || 0;
    } else {
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y -= 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y += 1;
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
      x += this.padMoveX || 0; y += this.padMoveY || 0;
      x += this.touch.move.x; y += this.touch.move.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    out.set(x, y);
    return out;
  }

  consumeLook(out) {
    out.x = this.lookX + this.touch.look.dx;
    out.y = this.lookY + this.touch.look.dy;
    this.lookX = 0; this.lookY = 0;
    this.touch.look.dx = 0; this.touch.look.dy = 0;
    return out;
  }
}
