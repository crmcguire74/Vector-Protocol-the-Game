import * as THREE from "../vendor/three.module.js";

// Mix law (design/plan.md): music -18..-20 dBFS, SFX -10..-12 dBFS, peak <= -3 dBFS.
const MUSIC_GAIN = 0.22;
const SFX_GAIN = 0.7;

const FILES = {
  mus_hub: "./assets/audio/mus_hub.m4a",
  mus_combat: "./assets/audio/mus_combat.m4a",
  sfx_disc_throw: "./assets/audio/sfx_disc_throw.mp3",
  sfx_ricochet: "./assets/audio/sfx_ricochet.mp3",
  sfx_shatter: "./assets/audio/sfx_shatter.mp3",
  sfx_cycle_engine: "./assets/audio/sfx_cycle_engine.mp3",
  sfx_crash: "./assets/audio/sfx_crash.mp3",
};

export class AudioMan {
  constructor() {
    this.listener = new THREE.AudioListener();
    this.ctx = this.listener.context;
    this.buffers = {};
    this.musicOn = true;
    this.music = null;
    this.musicId = null;
    this.engine = null;
    this.engineOsc = null;
    this.pool = [];
    this.scene = null;
    this.ready = false;
  }

  attach(camera, scene) {
    camera.add(this.listener);
    this.scene = scene;
    for (let i = 0; i < 10; i++) {
      const holder = new THREE.Object3D();
      const pa = new THREE.PositionalAudio(this.listener);
      pa.setRefDistance(5);
      pa.setVolume(SFX_GAIN);
      holder.add(pa);
      scene.add(holder);
      this.pool.push({ holder, pa });
    }
  }

  async load() {
    const jobs = Object.entries(FILES).map(async ([id, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const arr = await res.arrayBuffer();
        this.buffers[id] = await this.ctx.decodeAudioData(arr);
      } catch { this.buffers[id] = null; }
    });
    await Promise.allSettled(jobs);
    this.ready = true;
    // retrigger music picked before buffers landed
    if (this.musicId && (!this.music || !this.music.isPlaying || !this.music.buffer)) {
      const id = this.musicId;
      this.musicId = null;
      this.playMusic(id);
    }
  }

  resume() { if (this.ctx.state === "suspended") this.ctx.resume(); }

  // ---------- music ----------
  setMusicOn(on) {
    this.musicOn = on;
    if (!on) this.stopMusic();
    else if (this.musicId) { const id = this.musicId; this.musicId = null; this.playMusic(id); }
  }

  playMusic(id) {
    if (this.musicId === id && this.music && this.music.isPlaying) return;
    this.stopMusic(false);
    this.musicId = id;
    if (!this.musicOn) return;
    const buf = this.buffers[id];
    if (!buf) return;
    this.music = new THREE.Audio(this.listener);
    this.music.setBuffer(buf);
    this.music.setLoop(true);
    this.music.setVolume(MUSIC_GAIN);
    this.music.play();
  }

  stopMusic(clearId = true) {
    if (this.music && this.music.isPlaying) this.music.stop();
    this.music = null;
    if (clearId) this.musicId = null;
  }

  // ---------- positional / plain SFX ----------
  sfx(id, opts = {}) {
    const { pos = null, vol = 1, rate = 1 } = opts;
    const buf = this.buffers[id];
    if (!buf) { this.fallback(id, vol); return; }
    if (pos && this.pool.length) {
      const slot = this.pool.find((s) => !s.pa.isPlaying) || this.pool[0];
      if (slot.pa.isPlaying) slot.pa.stop();
      slot.holder.position.copy(pos);
      slot.pa.setBuffer(buf);
      slot.pa.setVolume(SFX_GAIN * vol);
      slot.pa.setPlaybackRate(rate);
      slot.pa.play();
    } else {
      const a = new THREE.Audio(this.listener);
      a.setBuffer(buf);
      a.setVolume(SFX_GAIN * vol);
      a.setPlaybackRate(rate);
      a.play();
    }
  }

  // ---------- engine loop (player cycle) ----------
  startEngine() {
    this.stopEngine();
    const buf = this.buffers.sfx_cycle_engine;
    if (buf) {
      this.engine = new THREE.Audio(this.listener);
      this.engine.setBuffer(buf);
      this.engine.setLoop(true);
      this.engine.setVolume(SFX_GAIN * 0.5);
      this.engine.play();
    } else {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sawtooth"; o.frequency.value = 70;
      g.gain.value = 0.05;
      o.connect(g); g.connect(this.ctx.destination);
      o.start();
      this.engineOsc = { o, g };
    }
  }

  setEngineRate(r) {
    if (this.engine) this.engine.setPlaybackRate(r);
    if (this.engineOsc) this.engineOsc.o.frequency.value = 70 * r;
  }

  stopEngine() {
    if (this.engine && this.engine.isPlaying) this.engine.stop();
    this.engine = null;
    if (this.engineOsc) { try { this.engineOsc.o.stop(); } catch {} this.engineOsc = null; }
  }

  // ---------- synthesized pack (sfx_synth_pack in the manifest) ----------
  env(duration, peak = 0.4) {
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    g.connect(this.ctx.destination);
    return g;
  }

  tone(freq, duration, type = "square", peak = 0.25, slideTo = null) {
    if (this.ctx.state !== "running") return;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, this.ctx.currentTime + duration);
    o.connect(this.env(duration, peak));
    o.start(); o.stop(this.ctx.currentTime + duration + 0.05);
  }

  noise(duration, peak = 0.25, low = 400, high = 6000) {
    if (this.ctx.state !== "running") return;
    const n = this.ctx.sampleRate * duration;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = (low + high) / 2;
    f.Q.value = 0.6;
    src.connect(f); f.connect(this.env(duration, peak));
    src.start();
  }

  blip() { this.tone(1100, 0.07, "square", 0.15); }
  select() { this.tone(660, 0.09, "square", 0.2); this.tone(1320, 0.12, "square", 0.15); }
  catchSnap() { this.tone(1500, 0.06, "triangle", 0.3, 500); }
  deflect() { this.noise(0.12, 0.3, 1500, 7000); this.tone(320, 0.15, "sawtooth", 0.2); }
  boost() { this.tone(140, 0.5, "sawtooth", 0.2, 480); }
  dash() { this.noise(0.15, 0.2, 300, 1800); }
  count() { this.tone(440, 0.12, "square", 0.25); }
  countGo() { this.tone(880, 0.3, "square", 0.3); }
  stingWin() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, "triangle", 0.3), i * 90)); }
  stingLose() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "sawtooth", 0.18), i * 110)); }
  hurt() { this.tone(180, 0.25, "sawtooth", 0.3, 60); }

  fallback(id, vol = 1) {
    switch (id) {
      case "sfx_disc_throw": this.noise(0.25, 0.3 * vol, 500, 4000); break;
      case "sfx_ricochet": this.tone(1800, 0.1, "square", 0.25 * vol, 700); break;
      case "sfx_shatter": this.noise(0.5, 0.35 * vol, 2000, 9000); break;
      case "sfx_crash": this.noise(0.6, 0.4 * vol, 100, 1500); break;
      default: this.blip();
    }
  }
}
