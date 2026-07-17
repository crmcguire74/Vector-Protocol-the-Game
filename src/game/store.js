// Deterministic backbone: seeded RNG + persistent campaign store.
// Ported from the OTHER project's util.js so AI, campaign progression, and the
// window.advanceTime() headless tests are all reproducible.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1) {
    this.f = mulberry32(seed);
  }
  next() {
    return this.f();
  }
  range(a, b) {
    return a + (b - a) * this.f();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p) {
    return this.f() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.f() * arr.length) % arr.length];
  }
  // signed jitter in [-m, m]
  spread(m) {
    return (this.f() * 2 - 1) * m;
  }
}

const KEY = 'vector-protocol-digi-v1';
// Preserve campaign progress from earlier builds released under other names.
const LEGACY_KEYS = ['vector-protocol-v1', 'grid-protocol-v1'];

export const Store = {
  data: null,
  load() {
    if (this.data) return this.data;
    let parsed = null;
    try {
      const raw = localStorage.getItem(KEY) || LEGACY_KEYS.map((k) => localStorage.getItem(k)).find(Boolean);
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }
    this.data = parsed || {};
    if (typeof this.data.discWins !== 'number') this.data.discWins = 0; // programs defeated 0..3
    if (typeof this.data.cycleTier !== 'number') this.data.cycleTier = 0; // cycle tiers cleared 0..3
    if (typeof this.data.music !== 'boolean') this.data.music = true;
    if (typeof this.data.vignette !== 'boolean') this.data.vignette = true;
    if (typeof this.data.smoothTurn !== 'boolean') this.data.smoothTurn = false;
    return this.data;
  },
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* private mode / storage disabled */
    }
  },
  set(k, v) {
    this.load()[k] = v;
    this.save();
    return v;
  },
  get(k) {
    return this.load()[k];
  },
  reset() {
    this.data = {};
    this.load();
    this.save();
  },
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
