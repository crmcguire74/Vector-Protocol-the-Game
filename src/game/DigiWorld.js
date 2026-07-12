import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ArenaMode } from './ArenaMode.js';
import { BikeMode } from './BikeMode.js';
import { COLORS, createEnvironment, createGlow, disposeObject, getCathedralTexture } from './Visuals.js';
import { preloadSentinelAsset } from './SentinelAsset.js';

class InputState {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
  }

  press(code) {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  }

  release(code) {
    this.down.delete(code);
  }

  isDown(code) {
    return this.down.has(code);
  }

  consumePress(code) {
    const pressed = this.pressed.has(code);
    this.pressed.delete(code);
    return pressed;
  }

  clearTransient() {
    this.pressed.clear();
  }

  clear() {
    this.down.clear();
    this.pressed.clear();
  }
}

class ProceduralAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.drone = null;
    this.musicTrack = 'hub';
    this.musicUnlocked = false;
    this.musicUnavailable = new Set();
    try {
      this.musicEnabled = window.localStorage.getItem('vector-protocol.music') !== 'off';
    } catch {
      this.musicEnabled = true;
    }
    this.music = typeof Audio === 'undefined'
      ? {}
      : {
          hub: this.createMusicTrack('hub', '/assets/audio/mus_hub.m4a', 0.18),
          combat: this.createMusicTrack('combat', '/assets/audio/mus_combat.m4a', 0.2),
        };
  }

  createMusicTrack(id, source, volume) {
    const track = new Audio();
    track.src = source;
    track.loop = true;
    track.preload = 'auto';
    track.volume = volume;
    track.addEventListener('error', () => {
      this.musicUnavailable.add(id);
      track.pause();
    }, { once: true });
    return track;
  }

  unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.musicUnlocked = true;
    if (!AudioContext) {
      this.syncMusic();
      return;
    }
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.14;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.resume();
    this.syncMusic();
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = Boolean(enabled);
    try {
      window.localStorage.setItem('vector-protocol.music', this.musicEnabled ? 'on' : 'off');
    } catch {
      // Persistence is optional in private/embedded browsing contexts.
    }
    if (this.musicEnabled) this.syncMusic();
    else {
      this.pauseMusic();
      this.stopDrone();
    }
    return this.musicEnabled;
  }

  setMusicTrack(id) {
    if (!this.music[id]) return;
    if (this.musicTrack !== id) {
      this.pauseMusic();
      this.musicTrack = id;
      try {
        this.music[id].currentTime = 0;
      } catch {
        // Some browsers disallow seeking until media metadata is available.
      }
    }
    this.syncMusic();
  }

  syncMusic() {
    this.pauseMusic(this.musicTrack);
    if (!this.musicEnabled || !this.musicUnlocked || this.musicUnavailable.has(this.musicTrack)) return;
    const active = this.music[this.musicTrack];
    if (!active || !active.paused) return;
    active.play()?.catch?.(() => {});
  }

  pauseMusic(except = null) {
    Object.entries(this.music).forEach(([id, track]) => {
      if (id !== except && !track.paused) track.pause();
    });
  }

  tone({ frequency = 220, endFrequency = frequency, duration = 0.12, gain = 0.06, type = 'sine' } = {}) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + Math.min(0.025, duration * 0.2));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  startDrone() {
    if (!this.musicEnabled || !this.context || !this.master || this.drone) return;
    const bus = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    bus.gain.value = 0.025;
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    bus.connect(filter);
    filter.connect(this.master);
    const oscillators = [46.25, 69.3].map((frequency, index) => {
      const oscillator = this.context.createOscillator();
      oscillator.type = index ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(bus);
      oscillator.start();
      return oscillator;
    });
    this.drone = { bus, oscillators };
  }

  stopDrone() {
    if (!this.drone) return;
    for (const oscillator of this.drone.oscillators) oscillator.stop();
    this.drone = null;
  }
}

export class DigiWorld {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.input = new InputState();
    this.audio = new ProceduralAudio();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.void);
    this.scene.environment = getCathedralTexture();
    this.scene.environmentIntensity = 0.36;
    this.scene.fog = new THREE.FogExp2(COLORS.void, 0.022);
    this.cameraRig = new THREE.Group();
    this.cameraRig.name = 'player-rig';
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.04, 160);
    this.camera.position.set(0, 1.65, 0);
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);
    this.eyeHeight = 1.65;
    this.yaw = 0;
    this.pitch = 0;
    this.phase = 'menu';
    this.presentation = 'desktop';
    this.requestedPresentation = 'desktop';
    this.gameMode = 'arena';
    this.roomPreset = 'portal';
    this.currentMode = null;
    this.menuRoot = null;
    this.menuTime = 0;
    this.lastFrame = performance.now();
    this.manualTime = 0;
    this.manualControl = false;
    this.xrSession = null;
    this.xrPrimaryHeld = false;
    this.xrShielding = false;
    this.xrMove = new THREE.Vector2();
    this.xrBrake = false;
    this.xrStickBoost = false;
    this.xrTurnQueued = 0;
    this.xrJumpQueued = false;
    this.xrDashQueued = false;
    this.xrActionQueued = false;
    this.xrSecondaryQueued = false;
    this.xrHitTestSource = null;
    this.xrAnchor = null;
    this.xrBoundedReferenceSpace = null;
    this.arBoundedFloor = null;
    this.arBoundedFloorSignature = '';
    this.arBoundedFloorMode = null;
    this.arReticle = null;
    this.arPlaced = false;
    this.arLastPoseMatrix = null;
    this.xrHudPanel = null;
    this.xrHudTexture = null;
    this.xrMessagePanel = null;
    this.xrMessageTexture = null;
    this.lastXRHUDUpdate = 0;
    this.xrCapabilities = { vr: false, ar: false, webxr: Boolean(navigator.xr), activeFeatures: [] };
    this.autoPausedByVisibility = false;
    this.announcementTimer = 0;
    this.toastTimer = 0;
    this.damageTimer = 0;
    this.vignetteTimer = 0;
    this.crosshairTimer = 0;
    this.lastHUD = {};
    this.minimapDots = new Map();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      stencil: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.52,
      0.22,
      0.88,
    );
    this.composer.addPass(this.bloomPass);
    this.afterimagePass = new AfterimagePass(0.74);
    this.afterimagePass.enabled = false;
    this.composer.addPass(this.afterimagePass);
    this.composer.addPass(new OutputPass());
    this.setupControllers();
    this.setupInput();
    this.setupTouchInput();
    this.resize();
    this.buildMenuBackdrop();
    this.audio.setMusicTrack('hub');
    this.updateMusicUI();
    preloadSentinelAsset().catch((error) => console.warn('[Vector Protocol] Skinned sentinel fallback active:', error));
    this.renderer.setAnimationLoop((time, frame) => this.frame(time, frame));
  }

  setupControllers() {
    this.controllers = [0, 1].map((index) => {
      const controller = this.renderer.xr.getController(index);
      controller.name = `xr-target-ray-${index}`;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1),
      ]);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.68 }),
      );
      line.scale.z = 4;
      line.visible = false;
      controller.add(line);
      controller.addEventListener('connected', (event) => {
        controller.userData.inputSource = event.data;
        controller.userData.axisLatch = 0;
        controller.userData.buttonStates = [];
        line.visible = true;
      });
      controller.addEventListener('disconnected', () => {
        controller.userData.inputSource = null;
        line.visible = false;
        this.resetHeldActions();
      });
      controller.addEventListener('selectstart', () => {
        if (this.phase === 'paused') {
          this.resume();
          return;
        }
        if (this.phase === 'result') {
          this.restart();
          return;
        }
        if (
          this.phase === 'running' &&
          this.currentMode?.name === 'bike' &&
          controller.userData.inputSource?.targetRayMode === 'screen'
        ) {
          const ray = this.getAimRay(controller);
          const cameraQuaternion = this.camera.getWorldQuaternion(new THREE.Quaternion()).invert();
          const localDirection = ray.direction.applyQuaternion(cameraQuaternion);
          if (localDirection.x < -0.14) {
            this.currentMode.queuePlayerTurn(-1);
            controller.userData.screenSteer = true;
          } else if (localDirection.x > 0.14) {
            this.currentMode.queuePlayerTurn(1);
            controller.userData.screenSteer = true;
          } else {
            controller.userData.screenSteer = false;
            this.xrPrimaryHeld = true;
            this.currentMode.primaryStart(ray);
          }
          return;
        }
        this.xrPrimaryHeld = true;
        if (this.phase === 'running') this.currentMode?.primaryStart(this.getAimRay(controller));
      });
      controller.addEventListener('selectend', () => {
        if (controller.userData.screenSteer) {
          controller.userData.screenSteer = false;
          return;
        }
        this.xrPrimaryHeld = false;
        if (this.phase === 'running') this.currentMode?.primaryEnd(this.getAimRay(controller));
      });
      controller.addEventListener('squeezestart', () => {
        if (this.phase === 'paused' || this.phase === 'result') {
          this.goToMenu();
          return;
        }
        this.xrShielding = true;
        if (this.phase === 'running') this.currentMode?.setShield(true);
      });
      controller.addEventListener('squeezeend', () => {
        this.xrShielding = false;
        if (this.phase === 'running') this.currentMode?.setShield(false);
      });
      this.cameraRig.add(controller);
      return controller;
    });
  }

  updateXRControls() {
    this.xrMove.set(0, 0);
    this.xrBrake = false;
    this.xrStickBoost = false;
    if (!this.renderer.xr.isPresenting || !this.currentMode) return;

    let fallbackAssigned = false;
    for (const controller of this.controllers) {
      const source = controller.userData.inputSource;
      const gamepad = source?.gamepad;
      if (!gamepad) continue;
      const handedness = source.handedness || (fallbackAssigned ? 'right' : 'left');
      const axes = gamepad.axes || [];
      const x = Math.abs(axes.at(-2) || 0) > 0.16 ? axes.at(-2) : 0;
      const y = Math.abs(axes.at(-1) || 0) > 0.16 ? axes.at(-1) : 0;

      if (handedness === 'left' || (!fallbackAssigned && handedness === 'none')) {
        fallbackAssigned = true;
        if (this.currentMode.name === 'bike') {
          if (Math.abs(x) > 0.68 && !controller.userData.axisLatch) {
            this.xrTurnQueued = x > 0 ? 1 : -1;
            controller.userData.axisLatch = Math.sign(x);
            this.pulseVignette();
          } else if (Math.abs(x) < 0.28) {
            controller.userData.axisLatch = 0;
          }
          this.xrBrake ||= y > 0.55;
          this.xrStickBoost ||= y < -0.72;
        } else {
          this.xrMove.set(x, y);
        }
      } else if (this.currentMode.name === 'arena' && this.presentation === 'vr') {
        if (Math.abs(x) > 0.72 && !controller.userData.axisLatch) {
          this.yaw -= Math.sign(x) * Math.PI / 6;
          controller.userData.axisLatch = Math.sign(x);
          this.applyCameraRotation();
          this.pulseVignette();
        } else if (Math.abs(x) < 0.28) {
          controller.userData.axisLatch = 0;
        }
      }

      const previous = controller.userData.buttonStates || [];
      const buttonPressed = (index) => Boolean(gamepad.buttons[index]?.pressed);
      const rising = (index) => buttonPressed(index) && !previous[index];
      if (rising(4)) {
        if (this.currentMode.name === 'bike') this.xrActionQueued = true;
        else this.xrJumpQueued = true;
      }
      if (rising(5)) this.xrSecondaryQueued = true;
      if (rising(3)) {
        if (this.currentMode.name === 'bike') this.xrSecondaryQueued = true;
        else this.xrDashQueued = true;
      }
      controller.userData.buttonStates = gamepad.buttons.map((button) => Boolean(button.pressed));
    }
  }

  consumeXRTurn() {
    const turn = this.xrTurnQueued;
    this.xrTurnQueued = 0;
    return turn;
  }

  consumeXRJump() {
    const queued = this.xrJumpQueued;
    this.xrJumpQueued = false;
    return queued;
  }

  consumeXRDash() {
    const queued = this.xrDashQueued;
    this.xrDashQueued = false;
    return queued;
  }

  consumeXRAction() {
    const queued = this.xrActionQueued;
    this.xrActionQueued = false;
    return queued;
  }

  consumeXRSecondary() {
    const queued = this.xrSecondaryQueued;
    this.xrSecondaryQueued = false;
    return queued;
  }

  setupInput() {
    window.addEventListener('keydown', (event) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (event.code === 'KeyM') {
        event.preventDefault();
        if (!event.repeat) this.toggleMusic();
        return;
      }
      if (event.code === 'KeyF') {
        this.toggleFullscreen();
        return;
      }
      if (event.code === 'KeyP' || event.code === 'Escape' || event.code === 'Enter') {
        if (event.code === 'Escape' && document.pointerLockElement) return;
        if (this.phase === 'running') this.pause();
        else if (this.phase === 'paused') this.resume();
        return;
      }
      this.input.press(event.code);
    });
    window.addEventListener('keyup', (event) => this.input.release(event.code));
    window.addEventListener('blur', () => {
      this.input.clear();
      this.resetHeldActions();
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('fullscreenchange', () => this.resize());
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.phase === 'running' && this.presentation === 'desktop') {
        window.setTimeout(() => {
          if (this.phase === 'running' && !document.pointerLockElement) this.pause();
        }, 60);
      }
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('mousedown', (event) => {
      if (this.phase !== 'running') return;
      const code = `Mouse${event.button}`;
      this.input.press(code);
      if (event.button === 0) {
        this.currentMode?.primaryStart(this.getAimRay());
        if (this.presentation === 'desktop' && !document.pointerLockElement) {
          this.canvas.requestPointerLock?.().catch?.(() => {});
        }
      } else if (event.button === 2) {
        this.currentMode?.setShield(true);
      }
    });
    window.addEventListener('mouseup', (event) => {
      const code = `Mouse${event.button}`;
      this.input.release(code);
      if (this.phase !== 'running') return;
      if (event.button === 0) this.currentMode?.primaryEnd(this.getAimRay());
      else if (event.button === 2) this.currentMode?.setShield(false);
    });
    window.addEventListener('mousemove', (event) => {
      if (this.phase !== 'running' || this.presentation !== 'desktop' || this.currentMode?.name === 'bike') return;
      if (!document.pointerLockElement && event.buttons === 0) return;
      this.yaw -= event.movementX * 0.0018;
      this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0016, -1.1, 1.1);
      this.applyCameraRotation();
    });
  }

  unlockAudio() {
    this.audio.unlock();
    this.audio.setMusicTrack(this.phase === 'menu' ? 'hub' : 'combat');
  }

  toggleMusic() {
    this.audio.unlock();
    const enabled = this.audio.setMusicEnabled(!this.audio.musicEnabled);
    this.audio.setMusicTrack(this.phase === 'menu' ? 'hub' : 'combat');
    if (enabled && this.phase !== 'menu') this.audio.startDrone();
    this.updateMusicUI();
    if (this.phase !== 'menu') this.toast(`MUSIC ${enabled ? 'ON' : 'OFF'}`, 1.2);
    return enabled;
  }

  updateMusicUI() {
    const enabled = this.audio.musicEnabled;
    if (this.ui.musicToggle) {
      this.ui.musicToggle.setAttribute('aria-pressed', String(enabled));
      this.ui.musicToggle.setAttribute('aria-label', enabled ? 'Turn music off' : 'Turn music on');
      this.ui.musicToggle.title = `Toggle music (M) · currently ${enabled ? 'on' : 'off'}`;
    }
    if (this.ui.musicToggleLabel) this.ui.musicToggleLabel.textContent = enabled ? 'Music on' : 'Music off';
  }

  setupTouchInput() {
    const bind = (button, onStart, onEnd = () => {}) => {
      if (!button) return;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.setPointerCapture?.(event.pointerId);
        onStart();
      });
      const finish = (event) => {
        event.preventDefault();
        event.stopPropagation();
        onEnd();
      };
      button.addEventListener('pointerup', finish);
      button.addEventListener('pointercancel', finish);
    };

    bind(this.ui.touchLeft, () => {
      if (this.currentMode?.name === 'bike') this.currentMode.queuePlayerTurn(-1);
      else this.input.press('KeyA');
    }, () => this.input.release('KeyA'));
    bind(this.ui.touchRight, () => {
      if (this.currentMode?.name === 'bike') this.currentMode.queuePlayerTurn(1);
      else this.input.press('KeyD');
    }, () => this.input.release('KeyD'));
    bind(this.ui.touchPrimary, () => {
      if (this.phase !== 'running') return;
      this.currentMode?.primaryStart(this.getAimRay());
    }, () => {
      if (this.phase === 'running') this.currentMode?.primaryEnd(this.getAimRay());
    });
    bind(this.ui.touchSecondary, () => {
      if (this.phase !== 'running') return;
      if (this.currentMode?.name === 'bike') this.currentMode.setShield(true);
      else this.input.press('Space');
    }, () => this.input.release('Space'));
  }

  resetHeldActions() {
    this.xrPrimaryHeld = false;
    this.xrShielding = false;
    this.xrBrake = false;
    this.xrStickBoost = false;
    this.currentMode?.setShield?.(false);
    this.currentMode?.cancelInput?.();
  }

  configureTouchControls() {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
    const visible = this.phase === 'running' && (coarsePointer || this.presentation === 'ar');
    this.ui.touchControls?.classList.toggle('hidden', !visible);
    if (!visible) return;
    const bike = this.currentMode?.name === 'bike';
    this.ui.touchPrimary.textContent = bike ? 'Boost' : 'Throw';
    this.ui.touchSecondary.textContent = bike ? 'Pulse' : 'Jump';
  }

  async checkXRCapabilities() {
    if (!navigator.xr) return this.xrCapabilities;
    const [vr, ar] = await Promise.all([
      navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
      navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
    ]);
    this.xrCapabilities = { ...this.xrCapabilities, webxr: true, vr, ar };
    return this.xrCapabilities;
  }

  buildMenuBackdrop() {
    if (this.menuRoot) disposeObject(this.menuRoot);
    this.menuRoot = new THREE.Group();
    this.menuRoot.name = 'menu-backdrop';
    this.menuRoot.add(createEnvironment());
    const ambient = new THREE.HemisphereLight(COLORS.ice, 0x010208, 0.9);
    const light = new THREE.PointLight(COLORS.cyan, 32, 30, 2);
    light.position.set(2, 4, 4);
    const coral = new THREE.PointLight(COLORS.coral, 22, 24, 2);
    coral.position.set(-6, 0, -5);
    this.menuRoot.add(ambient, light, coral);
    const core = new THREE.Group();
    core.position.set(0, 2.5, -5);
    for (let i = 0; i < 6; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.7 + i * 0.42, 0.022 + i * 0.009, 6, 72),
        new THREE.MeshBasicMaterial({
          color: i % 2 ? COLORS.violet : COLORS.cyan,
          transparent: true,
          opacity: 0.32 - i * 0.025,
          blending: THREE.AdditiveBlending,
        }),
      );
      ring.rotation.set(i * 0.22, i * 0.34, i * 0.11);
      core.add(ring);
    }
    const crystal = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.25, 1),
      new THREE.MeshPhysicalMaterial({
        color: 0x06131c,
        metalness: 0.92,
        roughness: 0.12,
        clearcoat: 0.8,
        emissive: COLORS.cyan,
        emissiveIntensity: 0.38,
        transparent: true,
        opacity: 0.92,
      }),
    );
    const glow = createGlow(COLORS.cyan, 5.8, 0.22);
    core.add(crystal, glow);
    this.menuRoot.add(core);
    this.menuCore = core;
    this.scene.add(this.menuRoot);
    this.cameraRig.position.set(0, 0, 8.5);
    this.camera.position.set(0, 2, 0);
    this.camera.rotation.set(-0.02, 0, 0);
    this.cameraRig.rotation.set(0, 0, 0);
    this.scene.background = new THREE.Color(COLORS.void);
    this.scene.fog = new THREE.FogExp2(COLORS.void, 0.02);
    this.renderer.setClearColor(COLORS.void, 1);
  }

  clearMenuBackdrop() {
    if (!this.menuRoot) return;
    disposeObject(this.menuRoot);
    this.menuRoot = null;
    this.menuCore = null;
  }

  createARReticle() {
    if (this.arReticle) disposeObject(this.arReticle);
    const reticle = new THREE.Group();
    reticle.name = 'ar-floor-placement-reticle';
    reticle.matrixAutoUpdate = false;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.11, 0.14, 36),
      new THREE.MeshBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: 0.86,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    const crossGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.2, 0.002, 0),
      new THREE.Vector3(0.2, 0.002, 0),
      new THREE.Vector3(0, 0.002, -0.2),
      new THREE.Vector3(0, 0.002, 0.2),
    ]);
    const cross = new THREE.LineSegments(
      crossGeometry,
      new THREE.LineBasicMaterial({ color: COLORS.ice, transparent: true, opacity: 0.7 }),
    );
    reticle.add(ring, cross);
    reticle.visible = false;
    this.scene.add(reticle);
    this.arReticle = reticle;
  }

  async setupARPlacement(session) {
    this.arPlaced = false;
    this.createARReticle();
    if (!session.requestHitTestSource) return;
    try {
      const viewerSpace = await session.requestReferenceSpace('viewer');
      if (session !== this.xrSession) return;
      this.xrHitTestSource = await session.requestHitTestSource({ space: viewerSpace });
    } catch (error) {
      console.info('[Vector Protocol] AR hit-test fallback:', error.message);
    }
  }

  applyARPose(transform) {
    const root = this.currentMode?.root;
    if (!root || !transform?.matrix) return;
    const matrix = new THREE.Matrix4().fromArray(transform.matrix);
    this.arLastPoseMatrix = matrix.clone();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const ignoredScale = new THREE.Vector3();
    matrix.decompose(position, quaternion, ignoredScale);
    root.position.copy(position);
    root.quaternion.copy(quaternion);
    root.updateMatrixWorld(true);
  }

  updateARBoundedFloor(frame, referenceSpace) {
    const boundedSpace = this.xrBoundedReferenceSpace;
    const mode = this.currentMode;
    if (
      !frame ||
      !referenceSpace ||
      !boundedSpace?.boundsGeometry?.length ||
      !mode?.setBoundedFloorFootprint ||
      (this.xrHitTestSource && !this.arPlaced)
    ) return;
    if (this.arBoundedFloorMode === mode && this.arBoundedFloor) return;
    const pose = frame.getPose(boundedSpace, referenceSpace);
    if (!pose) return;
    mode.root.updateWorldMatrix(true, false);
    const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const vertices = Array.from(boundedSpace.boundsGeometry).map((vertex) => {
      const point = new THREE.Vector3(vertex.x, vertex.y || 0, vertex.z).applyMatrix4(matrix);
      mode.root.worldToLocal(point);
      return { x: point.x, y: point.y, z: point.z };
    });
    if (vertices.length < 3) return;
    const minX = Math.min(...vertices.map((vertex) => vertex.x));
    const maxX = Math.max(...vertices.map((vertex) => vertex.x));
    const minZ = Math.min(...vertices.map((vertex) => vertex.z));
    const maxZ = Math.max(...vertices.map((vertex) => vertex.z));
    const floorY = vertices.reduce((sum, vertex) => sum + vertex.y, 0) / vertices.length;
    let signedArea = 0;
    for (let index = 0; index < vertices.length; index += 1) {
      const current = vertices[index];
      const next = vertices[(index + 1) % vertices.length];
      signedArea += current.x * next.z - next.x * current.z;
    }
    const footprint = {
      source: 'webxr-bounded-floor',
      vertices,
      minX,
      maxX,
      minZ,
      maxZ,
      width: maxX - minX,
      depth: maxZ - minZ,
      centerX: (minX + maxX) * 0.5,
      centerZ: (minZ + maxZ) * 0.5,
      floorY,
      area: Math.abs(signedArea) * 0.5,
      signedArea: signedArea * 0.5,
    };
    const signature = vertices
      .map((vertex) => `${vertex.x.toFixed(2)},${vertex.y.toFixed(2)},${vertex.z.toFixed(2)}`)
      .join('|');
    if (signature === this.arBoundedFloorSignature && mode === this.arBoundedFloorMode) return;
    if (!mode.setBoundedFloorFootprint(footprint)) return;
    this.arBoundedFloorSignature = signature;
    this.arBoundedFloorMode = mode;
    this.arBoundedFloor = footprint;
  }

  updateARPlacement(frame) {
    if (this.presentation !== 'ar' || !frame || !this.currentMode) return;
    const referenceSpace = this.renderer.xr.getReferenceSpace();
    if (!referenceSpace) return;

    if (this.xrAnchor?.anchorSpace) {
      const anchorPose = frame.getPose(this.xrAnchor.anchorSpace, referenceSpace);
      if (anchorPose) this.applyARPose(anchorPose.transform);
      this.updateARBoundedFloor(frame, referenceSpace);
      return;
    }
    if (!this.xrHitTestSource || this.arPlaced) {
      this.updateARBoundedFloor(frame, referenceSpace);
      return;
    }
    const hit = frame.getHitTestResults(this.xrHitTestSource)[0];
    if (!hit) return;
    const pose = hit.getPose(referenceSpace);
    if (!pose) return;
    if (this.arReticle) {
      this.arReticle.visible = true;
      this.arReticle.matrix.fromArray(pose.transform.matrix);
    }
    this.applyARPose(pose.transform);
    this.arPlaced = true;
    this.updateARBoundedFloor(frame, referenceSpace);
    if (this.arReticle) this.arReticle.visible = false;
    this.announce(this.currentMode.name === 'bike' ? 'TABLETOP GRID ANCHORED' : 'ROOM BREACH ANCHORED', 1.5);
    if (typeof hit.createAnchor === 'function') {
      hit.createAnchor().then((anchor) => {
        if (this.xrSession) this.xrAnchor = anchor;
        else anchor.delete?.();
      }).catch(() => {});
    }
  }

  clearARPlacement() {
    this.xrHitTestSource?.cancel?.();
    this.xrHitTestSource = null;
    this.xrAnchor?.delete?.();
    this.xrAnchor = null;
    this.xrBoundedReferenceSpace = null;
    this.arBoundedFloor = null;
    this.arBoundedFloorSignature = '';
    this.arBoundedFloorMode = null;
    this.arPlaced = false;
    this.arLastPoseMatrix = null;
    if (this.arReticle) {
      disposeObject(this.arReticle);
      this.arReticle = null;
    }
  }

  ensureXRHUD() {
    if (this.presentation !== 'vr' || !this.renderer.xr.isPresenting || this.xrHudPanel) return;
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 224;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.25), material);
    panel.name = 'vr-spatial-status-panel';
    panel.renderOrder = 1000;
    panel.userData.canvas = canvas;
    this.scene.add(panel);
    this.xrHudPanel = panel;
    this.xrHudTexture = texture;
  }

  drawXRHUD(state) {
    this.ensureXRHUD();
    if (!this.xrHudPanel) return;
    const now = performance.now();
    if (now - this.lastXRHUDUpdate < 100) return;
    this.lastXRHUDUpdate = now;
    const canvas = this.xrHudPanel.userData.canvas;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(2, 9, 15, 0.86)';
    context.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
    context.strokeStyle = '#58f2ff';
    context.lineWidth = 4;
    context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
    context.fillStyle = '#c8fbff';
    context.font = '700 34px sans-serif';
    context.fillText(state.mode || 'VECTOR PROTOCOL', 34, 57);
    context.fillStyle = '#8ba2aa';
    context.font = '600 24px monospace';
    context.fillText(`SIGNAL ${String(Math.round(state.score || 0)).padStart(6, '0')}`, 510, 55);
    context.fillText(`INTEGRITY ${Math.round(state.health || 0)}%`, 34, 105);
    context.fillText(state.resourceLabel || `ENERGY ${Math.round(state.resource || 0)}%`, 34, 180);
    context.fillStyle = 'rgba(88, 242, 255, 0.18)';
    context.fillRect(34, 121, 360, 14);
    context.fillStyle = state.health < 30 ? '#ff4f63' : '#c8fbff';
    context.fillRect(34, 121, 360 * Math.max(0, Math.min(1, state.health / 100)), 14);
    context.fillStyle = '#885cff';
    context.fillRect(34, 194, 360 * Math.max(0, Math.min(1, state.resource / 100)), 10);
    this.xrHudTexture.needsUpdate = true;
  }

  showXRMessage(title, detail, actions) {
    if (this.presentation !== 'vr' || !this.renderer.xr.isPresenting) return;
    this.clearXRMessage();
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(2, 8, 14, 0.94)';
    context.fillRect(10, 10, 1004, 492);
    context.strokeStyle = '#58f2ff';
    context.lineWidth = 6;
    context.strokeRect(10, 10, 1004, 492);
    context.fillStyle = '#58f2ff';
    context.font = '600 28px monospace';
    context.fillText('V/P SPATIAL PROMPT', 62, 78);
    context.fillStyle = '#eefcff';
    context.font = '700 64px sans-serif';
    context.fillText(title, 62, 180);
    context.fillStyle = '#9eb5bb';
    context.font = '500 31px sans-serif';
    context.fillText(detail, 62, 252);
    context.fillStyle = '#c8fbff';
    context.font = '600 29px monospace';
    context.fillText(actions, 62, 420);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 1.17),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    panel.name = 'vr-spatial-message-panel';
    panel.renderOrder = 1001;
    this.scene.add(panel);
    this.xrMessagePanel = panel;
    this.xrMessageTexture = texture;
    this.updateXRPanelTransforms();
  }

  clearXRMessage() {
    if (this.xrMessagePanel) disposeObject(this.xrMessagePanel);
    this.xrMessageTexture?.dispose();
    this.xrMessagePanel = null;
    this.xrMessageTexture = null;
  }

  clearXRHUD() {
    if (this.xrHudPanel) disposeObject(this.xrHudPanel);
    this.xrHudTexture?.dispose();
    this.xrHudPanel = null;
    this.xrHudTexture = null;
  }

  updateXRPanelTransforms() {
    if (!this.renderer.xr.isPresenting) return;
    const cameraPosition = this.camera.getWorldPosition(new THREE.Vector3());
    const cameraQuaternion = this.camera.getWorldQuaternion(new THREE.Quaternion());
    if (this.xrHudPanel) {
      const offset = new THREE.Vector3(-0.42, -0.26, -0.92).applyQuaternion(cameraQuaternion);
      this.xrHudPanel.position.copy(cameraPosition).add(offset);
      this.xrHudPanel.quaternion.copy(cameraQuaternion);
    }
    if (this.xrMessagePanel) {
      const offset = new THREE.Vector3(0, 0, -2).applyQuaternion(cameraQuaternion);
      this.xrMessagePanel.position.copy(cameraPosition).add(offset);
      this.xrMessagePanel.quaternion.copy(cameraQuaternion);
    }
  }

  async enterXR(type) {
    if (!navigator.xr) throw new Error('WebXR is not available in this browser');
    const sessionType = type === 'ar' ? 'immersive-ar' : 'immersive-vr';
    const supported = await navigator.xr.isSessionSupported(sessionType);
    if (!supported) throw new Error(`${type.toUpperCase()} sessions are not supported on this device`);
    const isAR = type === 'ar';
    const init = isAR
      ? {
          optionalFeatures: [
            'local-floor',
            'bounded-floor',
            'hit-test',
            'anchors',
            'plane-detection',
            'depth-sensing',
            'light-estimation',
            'dom-overlay',
          ],
          domOverlay: { root: document.body },
          depthSensing: {
            usagePreference: ['gpu-optimized', 'cpu-optimized'],
            dataFormatPreference: ['luminance-alpha', 'float32'],
          },
        }
      : { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor', 'hand-tracking'] };
    this.renderer.xr.setReferenceSpaceType(isAR ? 'local' : 'local-floor');
    const session = await navigator.xr.requestSession(sessionType, init);
    this.xrSession = session;
    session.addEventListener('end', () => this.handleXREnd(), { once: true });
    session.addEventListener('visibilitychange', () => this.handleVisibility(session.visibilityState === 'hidden'));
    await this.renderer.xr.setSession(session);
    this.presentation = type;
    this.xrCapabilities.activeFeatures = Array.from(session.enabledFeatures || []);
    this.renderer.xr.setFoveation?.(0.85);
    this.ui.xrExit.classList.remove('hidden');
    if (isAR) {
      try {
        const boundedSpace = await session.requestReferenceSpace('bounded-floor');
        if (session === this.xrSession && boundedSpace?.boundsGeometry?.length >= 3) {
          this.xrBoundedReferenceSpace = boundedSpace;
        }
      } catch (error) {
        console.info('[Vector Protocol] Bounded-floor fallback:', error.message);
      }
      this.setupARPlacement(session);
    }
    return true;
  }

  handleXREnd() {
    this.clearARPlacement();
    this.clearXRMessage();
    this.clearXRHUD();
    this.xrSession = null;
    this.presentation = 'desktop';
    this.xrCapabilities.activeFeatures = [];
    this.ui.xrExit.classList.add('hidden');
    if (this.phase === 'paused' && this.autoPausedByVisibility) {
      this.autoPausedByVisibility = false;
      this.ui.pauseMenu.classList.remove('hidden');
    }
    if (this.phase !== 'menu') {
      this.scene.background = new THREE.Color(COLORS.void);
      this.scene.fog = new THREE.FogExp2(COLORS.void, 0.022);
      this.renderer.setClearColor(COLORS.void, 1);
      this.toast('XR SESSION ENDED // DESKTOP CONTROL RESTORED', 2.8);
    }
  }

  async startGame(gameMode, requestedPresentation = 'desktop', roomPreset = 'portal') {
    this.audio.unlock();
    this.audio.setMusicTrack('combat');
    this.audio.startDrone();
    this.requestedPresentation = requestedPresentation;
    this.gameMode = gameMode;
    this.roomPreset = roomPreset;
    this.phase = 'launching';
    this.ui.launchButton.disabled = true;
    this.ui.menu.classList.add('hidden');

    if (requestedPresentation !== 'desktop' && !this.xrSession) {
      try {
        await this.enterXR(requestedPresentation);
      } catch (error) {
        this.presentation = 'desktop';
        this.toast(`${requestedPresentation.toUpperCase()} UNAVAILABLE // RUNNING IMMERSIVE PREVIEW`, 4);
        console.info('[Vector Protocol] XR fallback:', error.message);
      }
    } else if (!this.xrSession) {
      this.presentation = 'desktop';
    }

    this.loadMode(gameMode);
    this.ui.launchButton.disabled = false;
  }

  loadMode(gameMode = this.gameMode) {
    this.clearXRMessage();
    if (this.currentMode) {
      this.currentMode.dispose();
      this.currentMode = null;
    }
    this.clearMenuBackdrop();
    this.gameMode = gameMode;
    this.phase = 'running';
    this.input.clear();
    this.xrPrimaryHeld = false;
    this.xrShielding = false;
    this.yaw = 0;
    this.pitch = 0;
    this.eyeHeight = 1.65;
    this.cameraRig.position.set(0, 0, 0);
    this.cameraRig.rotation.set(0, 0, 0);
    this.camera.position.set(0, this.eyeHeight, 0);
    this.applyCameraRotation();
    const arLive = this.presentation === 'ar';
    this.scene.background = arLive ? null : new THREE.Color(COLORS.void);
    this.scene.fog = arLive ? null : new THREE.FogExp2(COLORS.void, gameMode === 'bike' ? 0.018 : 0.022);
    this.renderer.setClearColor(COLORS.void, arLive ? 0 : 1);
    this.currentMode = gameMode === 'bike'
      ? new BikeMode(this)
      : new ArenaMode(this, { roomPreset: this.roomPreset });
    // Persistent light walls provide the motion history. A full-frame afterimage
    // obscures rivals and arena boundaries and is especially uncomfortable in XR.
    this.afterimagePass.enabled = false;
    if (this.presentation === 'ar' && this.arLastPoseMatrix) {
      this.applyARPose({ matrix: this.arLastPoseMatrix.elements });
    }
    this.ui.menu.classList.add('hidden');
    this.ui.pauseMenu.classList.add('hidden');
    this.ui.resultScreen.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    const usesHeadLockedBikeMap = gameMode === 'bike' && (
      this.presentation === 'vr' || this.requestedPresentation === 'vr'
    );
    this.ui.minimap.classList.toggle('hidden', gameMode !== 'bike' || usesHeadLockedBikeMap);
    this.ui.speedReadout.classList.toggle('hidden', gameMode !== 'bike');
    document.body.classList.add('is-playing');
    this.configureTouchControls();
    if (this.presentation === 'desktop') this.canvas.requestPointerLock?.().catch?.(() => {});
  }

  pause(showMenu = true) {
    if (this.phase !== 'running') return;
    this.phase = 'paused';
    document.exitPointerLock?.();
    this.ui.touchControls?.classList.add('hidden');
    if (showMenu) {
      this.ui.pauseMenu.classList.remove('hidden');
      this.ui.pauseMenu.querySelector('button')?.focus();
    }
    this.showXRMessage('THREAD PAUSED', 'The grid is holding your position.', 'TRIGGER: RESUME   ·   GRIP: EXIT');
    this.announce('THREAD SUSPENDED', 0.8);
  }

  handleVisibility(hidden) {
    if (hidden && this.phase === 'running') {
      this.autoPausedByVisibility = true;
      this.pause(false);
      return;
    }
    if (!hidden && this.autoPausedByVisibility && this.phase === 'paused') {
      this.autoPausedByVisibility = false;
      if (this.renderer.xr.isPresenting) this.resume();
      else this.ui.pauseMenu.classList.remove('hidden');
    }
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = 'running';
    this.ui.pauseMenu.classList.add('hidden');
    this.clearXRMessage();
    this.configureTouchControls();
    this.lastFrame = performance.now();
    if (this.presentation === 'desktop') this.canvas.requestPointerLock?.().catch?.(() => {});
  }

  restart() {
    this.ui.pauseMenu.classList.add('hidden');
    this.ui.resultScreen.classList.add('hidden');
    this.loadMode(this.gameMode);
  }

  async goToMenu() {
    this.phase = 'menu';
    this.audio.stopDrone();
    this.audio.setMusicTrack('hub');
    document.exitPointerLock?.();
    if (this.currentMode) {
      this.currentMode.dispose();
      this.currentMode = null;
    }
    if (this.xrSession) {
      const session = this.xrSession;
      this.xrSession = null;
      await session.end().catch(() => {});
    }
    this.clearARPlacement();
    this.clearXRMessage();
    this.clearXRHUD();
    this.presentation = 'desktop';
    this.requestedPresentation = 'desktop';
    this.ui.hud.classList.add('hidden');
    this.ui.pauseMenu.classList.add('hidden');
    this.ui.resultScreen.classList.add('hidden');
    this.ui.xrExit.classList.add('hidden');
    this.ui.touchControls?.classList.add('hidden');
    this.ui.menu.classList.remove('hidden');
    document.body.classList.remove('is-playing');
    this.afterimagePass.enabled = false;
    this.clearMinimap();
    this.buildMenuBackdrop();
  }

  endGame(won, { title, detail }) {
    if (this.phase !== 'running') return;
    this.phase = 'result';
    document.exitPointerLock?.();
    this.ui.resultTitle.textContent = title || (won ? 'BREACH COMPLETE' : 'SIGNAL SEVERED');
    this.ui.resultDetail.textContent = detail || 'The lattice has recorded your run.';
    this.ui.resultScreen.dataset.outcome = won ? 'victory' : 'defeat';
    this.ui.resultScreen.classList.remove('hidden');
    this.ui.touchControls?.classList.add('hidden');
    this.ui.againButton.focus();
    this.showXRMessage(
      this.ui.resultTitle.textContent,
      this.ui.resultDetail.textContent,
      'TRIGGER: RUN AGAIN   ·   GRIP: EXIT',
    );
    this.audio.tone({ frequency: won ? 240 : 110, endFrequency: won ? 720 : 42, duration: 0.8, gain: 0.12, type: 'sawtooth' });
  }

  setPlayerPosition(position) {
    if (this.presentation === 'ar') return;
    this.cameraRig.position.copy(position);
    if (!this.renderer.xr.isPresenting) this.camera.position.set(0, this.eyeHeight, 0);
  }

  setEyeHeight(height) {
    this.eyeHeight = height;
    if (!this.renderer.xr.isPresenting) this.camera.position.y = height;
  }

  setCameraBob(x = 0, y = 0, z = 0) {
    if (this.renderer.xr.isPresenting || this.presentation !== 'desktop') return;
    this.camera.position.set(x, this.eyeHeight + y, z);
  }

  setYaw(yaw) {
    this.yaw = yaw;
    if (this.presentation !== 'ar') this.applyCameraRotation();
  }

  applyCameraRotation() {
    if (this.presentation === 'ar') return;
    this.cameraRig.rotation.y = this.yaw;
    if (!this.renderer.xr.isPresenting) this.camera.rotation.x = this.pitch;
  }

  getAimRay(source = this.camera) {
    source.updateWorldMatrix(true, false);
    const origin = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    source.getWorldPosition(origin);
    source.getWorldQuaternion(quaternion);
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
    return { origin, direction };
  }

  updateHUD({ mode, score, health, resource, resourceLabel, objective, combo, speed }) {
    const roundedHealth = Math.max(0, Math.round(health));
    const roundedResource = Math.max(0, Math.round(resource));
    this.ui.hudMode.textContent = mode;
    this.ui.hudScore.textContent = String(Math.round(score)).padStart(6, '0');
    this.ui.hudHealth.textContent = roundedHealth;
    this.ui.healthFill.style.width = `${roundedHealth}%`;
    this.ui.healthFill.style.background = roundedHealth < 30 ? '#ff4f63' : '';
    this.ui.hudResource.textContent = resourceLabel || roundedResource;
    this.ui.resourceFill.style.width = `${roundedResource}%`;
    if (this.ui.objective.textContent !== objective) this.ui.objective.textContent = objective;
    this.ui.combo.textContent = combo;
    this.ui.combo.classList.toggle('hidden', !combo);
    if (speed) {
      const parts = speed.split(' ');
      this.ui.speedReadout.querySelector('strong').textContent = parts[0];
      this.ui.speedReadout.querySelector('span').textContent = parts.slice(1).join(' ');
    }
    this.lastHUD = { mode, score, health: roundedHealth, resource: roundedResource, objective, combo, speed };
    this.drawXRHUD({ mode, score, health: roundedHealth, resource: roundedResource, resourceLabel });
  }

  updateMinimap({ bounds, riders }) {
    const activeIds = new Set();
    for (const rider of riders) {
      activeIds.add(rider.id);
      let dot = this.minimapDots.get(rider.id);
      if (!dot) {
        dot = document.createElement('i');
        dot.className = `minimap__rider minimap__rider--${rider.id === 0 ? 'player' : 'enemy'}`;
        this.ui.minimap.appendChild(dot);
        this.minimapDots.set(rider.id, dot);
      }
      dot.style.left = `${50 + (rider.x / bounds) * 43}%`;
      dot.style.top = `${50 + (rider.z / bounds) * 43}%`;
      dot.style.background = `#${new THREE.Color(rider.color).getHexString()}`;
      dot.style.boxShadow = `0 0 .55rem #${new THREE.Color(rider.color).getHexString()}`;
    }
    for (const [id, dot] of this.minimapDots) {
      if (!activeIds.has(id)) {
        dot.remove();
        this.minimapDots.delete(id);
      }
    }
  }

  clearMinimap() {
    for (const dot of this.minimapDots.values()) dot.remove();
    this.minimapDots.clear();
  }

  announce(message, duration = 1.5) {
    this.ui.announcement.textContent = message;
    this.ui.announcement.classList.remove('hidden');
    this.announcementTimer = duration;
    this.audio.tone({ frequency: 150, endFrequency: 330, duration: 0.11, gain: 0.04, type: 'square' });
  }

  toast(message, duration = 2.5) {
    this.ui.toast.textContent = message;
    this.ui.toast.classList.remove('hidden');
    this.toastTimer = duration;
  }

  damageFeedback(amount = 10) {
    this.ui.damageFlash.classList.remove('hidden');
    this.damageTimer = 0.24;
    this.audio.tone({ frequency: 105, endFrequency: 34, duration: 0.28, gain: Math.min(0.12, amount / 500), type: 'sawtooth' });
    this.pulseHaptics(0.7, 90);
  }

  pulseVignette() {
    this.ui.comfortVignette.classList.remove('hidden');
    this.vignetteTimer = 0.22;
    this.pulseHaptics(0.38, 45);
  }

  pulseCrosshair() {
    this.ui.crosshair.classList.add('is-firing');
    this.crosshairTimer = 0.14;
    this.audio.tone({ frequency: 620, endFrequency: 180, duration: 0.16, gain: 0.07, type: 'triangle' });
    this.pulseHaptics(0.3, 35);
  }

  pulseHaptics(intensity, duration) {
    for (const controller of this.controllers) {
      const gamepad = controller.userData.inputSource?.gamepad;
      const actuator = gamepad?.hapticActuators?.[0] || gamepad?.vibrationActuator;
      actuator?.pulse?.(intensity, duration).catch?.(() => {});
    }
  }

  updateOverlayTimers(dt) {
    if (this.announcementTimer > 0) {
      this.announcementTimer -= dt;
      if (this.announcementTimer <= 0) this.ui.announcement.classList.add('hidden');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.ui.toast.classList.add('hidden');
    }
    if (this.damageTimer > 0) {
      this.damageTimer -= dt;
      if (this.damageTimer <= 0) this.ui.damageFlash.classList.add('hidden');
    }
    if (this.vignetteTimer > 0) {
      this.vignetteTimer -= dt;
      if (this.vignetteTimer <= 0) this.ui.comfortVignette.classList.add('hidden');
    }
    if (this.crosshairTimer > 0) {
      this.crosshairTimer -= dt;
      if (this.crosshairTimer <= 0) this.ui.crosshair.classList.remove('is-firing');
    }
  }

  update(dt) {
    if (this.phase === 'menu' && this.menuCore) {
      this.menuTime += dt;
      this.menuCore.rotation.y += dt * 0.13;
      this.menuCore.rotation.x = Math.sin(this.menuTime * 0.23) * 0.12;
      this.menuCore.children.forEach((child, index) => {
        if (child.isMesh && child.geometry?.type === 'TorusGeometry') child.rotation.z += dt * (index % 2 ? -0.18 : 0.12);
      });
    }
    if (this.phase === 'running') {
      this.updateXRControls();
      this.currentMode?.update(dt);
    }
    this.updateOverlayTimers(dt);
  }

  frame(time, xrFrame = null) {
    const dt = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000 || 1 / 60));
    this.lastFrame = time;
    this.updateARPlacement(xrFrame);
    if (!this.manualControl) {
      this.update(dt);
      this.input.clearTransient();
    }
    this.updateXRPanelTransforms();
    this.render();
  }

  advanceTime(ms) {
    this.manualControl = true;
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) this.update(1 / 60);
    this.render();
    this.input.clearTransient();
  }

  render() {
    if (this.renderer.xr.isPresenting) this.renderer.render(this.scene, this.camera);
    else this.composer.render();
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }

  getState() {
    return {
      title: 'VECTOR PROTOCOL',
      phase: this.phase,
      presentation: this.presentation,
      requestedPresentation: this.requestedPresentation,
      gameMode: this.gameMode,
      roomPreset: this.roomPreset,
      xr: {
        ...this.xrCapabilities,
        boundedFloor: this.arBoundedFloor
          ? {
              source: this.arBoundedFloor.source,
              width: +this.arBoundedFloor.width.toFixed(2),
              depth: +this.arBoundedFloor.depth.toFixed(2),
              area: +this.arBoundedFloor.area.toFixed(2),
              vertices: this.arBoundedFloor.vertices.map((vertex) => ({
                x: +vertex.x.toFixed(2),
                y: +vertex.y.toFixed(2),
                z: +vertex.z.toFixed(2),
              })),
            }
          : null,
      },
      audio: {
        music: this.audio.musicEnabled ? 'on' : 'off',
        track: this.audio.musicTrack,
      },
      hud: this.lastHUD,
      gameplay: this.currentMode?.getState() || null,
      controls: this.currentMode?.name === 'bike'
        ? 'A/D turn, Space/trigger boost, Shift brake, X emergency stop (3), Q toggle lightline, E disruption pulse, PageUp/PageDown or [/] dashboard height, M music, P/Escape pause, F fullscreen'
        : 'WASD move, mouse aim, hold/release LMB throw, RMB guard/parry, Space jump, Shift dash, Q/E recall, M music, P/Escape pause, F fullscreen',
    };
  }
}
