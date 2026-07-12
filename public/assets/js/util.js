// Seeded RNG (mulberry32), persistence, small math helpers.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.f() < p; }
  pick(arr) { return arr[Math.floor(this.f() * arr.length) % arr.length]; }
}

const KEY = "vector-protocol-v1";
const LEGACY_KEY = "grid-protocol-v1";

export const Store = {
  data: null,
  load() {
    if (this.data) return this.data;
    try {
      // Preserve campaign progress from builds released under the former name.
      this.data = JSON.parse(localStorage.getItem(KEY)) || JSON.parse(localStorage.getItem(LEGACY_KEY)) || {};
    }
    catch { this.data = {}; }
    if (typeof this.data.discWins !== "number") this.data.discWins = 0;   // enemies defeated 0..3
    if (typeof this.data.cycleTier !== "number") this.data.cycleTier = 0; // tiers cleared 0..3
    if (typeof this.data.music !== "boolean") this.data.music = true;
    if (typeof this.data.vignette !== "boolean") this.data.vignette = true;
    if (typeof this.data.smoothTurn !== "boolean") this.data.smoothTurn = false;
    return this.data;
  },
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ }
  },
  set(k, v) { this.load()[k] = v; this.save(); },
  get(k) { return this.load()[k]; },
  reset() { this.data = {}; this.load(); this.save(); },
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

// Ring buffer of {x,y,z,t} samples for XR throw-velocity estimation.
export class MotionTrace {
  constructor(n = 16) { this.n = n; this.buf = []; this.i = 0; }
  push(x, y, z, t) {
    if (this.buf.length < this.n) this.buf.push({ x, y, z, t });
    else { const s = this.buf[this.i]; s.x = x; s.y = y; s.z = z; s.t = t; }
    this.i = (this.i + 1) % this.n;
  }
  // average velocity over the last `win` seconds, written into out {x,y,z}; false if not enough data
  velocity(now, win, out) {
    let newest = null, oldest = null;
    for (const s of this.buf) {
      if (now - s.t > win) continue;
      if (!newest || s.t > newest.t) newest = s;
      if (!oldest || s.t < oldest.t) oldest = s;
    }
    if (!newest || !oldest || newest.t - oldest.t < 0.02) return false;
    const dt = newest.t - oldest.t;
    out.x = (newest.x - oldest.x) / dt;
    out.y = (newest.y - oldest.y) / dt;
    out.z = (newest.z - oldest.z) / dt;
    return true;
  }
  clear() { this.buf.length = 0; this.i = 0; }
}
