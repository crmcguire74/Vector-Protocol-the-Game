import * as THREE from 'three';
import {
  COLORS,
  createDisc,
  createDiscTrail,
  createEnvironment,
  createGlow,
  createHumanoid,
  createParticleBurst,
  createPlatform,
  createShockwave,
  disposeObject,
  getCathedralTexture,
  seededRandom,
  updateBursts,
  updateDiscTrail,
  updateEnvironment,
  updateShockwaves,
} from './Visuals.js';
import { createAnimatedSentinel, updateSentinelRig } from './SentinelAsset.js';

const UP = new THREE.Vector3(0, 1, 0);

export class ArenaMode {
  constructor(world, { roomPreset = 'portal' } = {}) {
    this.world = world;
    this.name = 'arena';
    this.roomPreset = roomPreset;
    this.root = new THREE.Group();
    this.root.name = 'shard-arena-mode';
    this.world.scene.add(this.root);
    this.random = seededRandom(2471);
    this.platforms = [];
    this.enemies = [];
    this.projectiles = [];
    this.telegraphs = [];
    this.bursts = [];
    this.shockwaves = [];
    this.arPanels = [];
    this.fractureLevel = 0;
    this.wave = 1;
    this.waveDelay = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.elapsed = 0;
    this.charging = false;
    this.charge = 0;
    this.shielding = false;
    this.discSerial = 0;
    this.enemySerial = 0;
    this.disposed = false;
    this.isARPresentation = this.world.requestedPresentation === 'ar';

    this.player = {
      position: new THREE.Vector3(0, 0, this.isARPresentation ? 1.5 : 11.5),
      velocity: new THREE.Vector3(),
      health: 100,
      shield: 100,
      discs: 2,
      grounded: true,
      dashCooldown: 0,
      invulnerable: 0,
    };

    this.buildWorld();
    if (this.world.presentation === 'desktop') {
      this.handDisc = createDisc(COLORS.cyan, false);
      this.handDisc.name = 'held-player-arc-disc';
      this.handDisc.position.set(0.48, -0.37, -1.08);
      this.handDisc.scale.setScalar(0.23);
      this.handDisc.rotation.set(-0.12, -0.2, 0.16);
      this.world.camera.add(this.handDisc);
    }
    this.spawnWave(1);
    this.world.setPlayerPosition(this.player.position);
    this.world.setYaw(0);
    this.world.announce('SYNC ONE // BREAK THE WARDENS', 2.5);
  }

  buildWorld() {
    this.environment = createEnvironment({ ar: this.world.presentation === 'ar' });
    this.root.add(this.environment);
    const ambient = new THREE.HemisphereLight(COLORS.ice, 0x02040a, 1.45);
    const key = new THREE.DirectionalLight(0xd7ffff, 3.2);
    key.position.set(7, 16, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -24;
    key.shadow.camera.right = 24;
    key.shadow.camera.top = 24;
    key.shadow.camera.bottom = -24;
    const rim = new THREE.PointLight(COLORS.coral, 34, 34, 2);
    rim.position.set(-9, 7, -12);
    const fill = new THREE.PointLight(COLORS.cyan, 28, 30, 2);
    fill.position.set(10, 4, 7);
    this.root.add(ambient, key, rim, fill);

    const layout = this.isARPresentation
      ? [
          [0, 0, 1.5, 3.7],
          [0, 0.35, -6.8, 3.6],
          [-5.4, 0.8, -11.5, 3.2],
          [5.4, 0.8, -11.5, 3.2],
        ]
      : [
          [0, 0, 10, 4.9],
          [0, 1, 0.2, 4.2],
          [-8.6, 2, -8.7, 4.25],
          [8.6, 2, -8.7, 4.25],
          [0, 3.2, -18, 5.4],
        ];

    layout.forEach(([x, y, z, radius], index) => {
      const accent = index === 0 ? COLORS.cyan : index % 2 ? COLORS.violet : COLORS.coral;
      const mesh = createPlatform(radius, y, accent, index * 29);
      mesh.position.x = x;
      mesh.position.z = z;
      this.root.add(mesh);
      this.platforms.push({ x, y, z, radius, mesh });
    });

    if (!this.isARPresentation) {
      const voidGrid = new THREE.GridHelper(96, 64, COLORS.violet, 0x10233b);
      voidGrid.position.y = -8;
      voidGrid.material.transparent = true;
      voidGrid.material.opacity = 0.24;
      this.root.add(voidGrid);

      for (let i = 0; i < 22; i += 1) {
        const column = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.28 + this.random() * 0.9, 0),
          new THREE.MeshStandardMaterial({
            color: 0x07101b,
            emissive: i % 3 === 0 ? COLORS.violet : COLORS.cyan,
            emissiveIntensity: 0.22,
            metalness: 0.8,
            roughness: 0.28,
          }),
        );
        const angle = this.random() * Math.PI * 2;
        const radius = 22 + this.random() * 22;
        column.position.set(Math.cos(angle) * radius, -2 + this.random() * 13, Math.sin(angle) * radius);
        column.scale.y = 2 + this.random() * 7;
        column.rotation.set(this.random(), this.random(), this.random());
        this.root.add(column);
      }
    } else {
      this.buildARRoomShell();
    }
  }

  buildARRoomShell() {
    const presetConfig = {
      portal: { columns: 7, rows: 5, width: 1.05, height: 0.78, z: -4.45 },
      arena: { columns: 9, rows: 4, width: 1.05, height: 0.88, z: -4.75 },
      tabletop: { columns: 6, rows: 4, width: 0.72, height: 0.58, z: -3.65 },
    };
    const config = presetConfig[this.roomPreset] || presetConfig.portal;
    this.arShellZ = config.z;
    const shell = new THREE.Group();
    shell.name = `ar-${this.roomPreset}-break-shell`;
    const totalWidth = config.columns * config.width;
    const totalHeight = config.rows * config.height;

    const portalCanvas = document.createElement('canvas');
    portalCanvas.width = 512;
    portalCanvas.height = 512;
    const context = portalCanvas.getContext('2d');
    const gradient = context.createRadialGradient(256, 256, 12, 256, 256, 360);
    gradient.addColorStop(0, '#4af9ff');
    gradient.addColorStop(0.22, '#123e66');
    gradient.addColorStop(0.68, '#090d29');
    gradient.addColorStop(1, '#02040a');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 512);
    context.strokeStyle = '#45efff88';
    context.lineWidth = 2;
    for (let i = 0; i <= 16; i += 1) {
      const v = (i / 16) * 512;
      context.beginPath();
      context.moveTo(v, 0);
      context.lineTo(256 + (v - 256) * 0.15, 256);
      context.stroke();
      context.beginPath();
      context.moveTo(0, v);
      context.lineTo(512, v);
      context.stroke();
    }
    const portalTexture = new THREE.CanvasTexture(portalCanvas);
    portalTexture.colorSpace = THREE.SRGBColorSpace;
    this.portalTexture = portalTexture;
    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(totalWidth * 1.04, totalHeight * 1.06),
      new THREE.MeshBasicMaterial({
        map: portalTexture,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    portal.position.set(0, 1.65, config.z - 0.13);
    portal.userData.baseOpacity = 0.2;
    shell.add(portal);
    this.arPortal = portal;

    const cathedralPortal = new THREE.Mesh(
      new THREE.PlaneGeometry(totalWidth * 1.03, totalHeight * 1.05),
      new THREE.MeshBasicMaterial({
        map: getCathedralTexture(),
        color: 0xa8d9ef,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
    );
    cathedralPortal.position.set(0, 1.65, config.z - 0.2);
    shell.add(cathedralPortal);
    this.arCathedralPortal = cathedralPortal;

    const panelGeometry = new THREE.BoxGeometry(config.width * 0.94, config.height * 0.92, 0.075);
    for (let row = 0; row < config.rows; row += 1) {
      for (let column = 0; column < config.columns; column += 1) {
        const fromCenter = Math.hypot(column - (config.columns - 1) / 2, row - (config.rows - 1) / 2);
        const panel = new THREE.Mesh(
          panelGeometry,
          new THREE.MeshPhysicalMaterial({
            color: 0x05090f,
            metalness: 0.74,
            roughness: 0.25,
            transparent: true,
            opacity: this.world.presentation === 'ar' ? 0.72 : 0.94,
            emissive: (row + column) % 3 === 0 ? COLORS.violet : COLORS.cyan,
            emissiveIntensity: 0.05,
          }),
        );
        panel.position.set(
          (column - (config.columns - 1) / 2) * config.width,
          0.5 + row * config.height,
          config.z,
        );
        panel.rotation.z = (this.random() - 0.5) * 0.025;
        panel.userData.breakOrder = fromCenter + this.random() * 0.35;
        shell.add(panel);
        this.arPanels.push(panel);
      }
    }
    this.arPanels.sort((a, b) => a.userData.breakOrder - b.userData.breakOrder);

    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(totalWidth + 0.25, totalHeight + 0.25, 0.18)),
      new THREE.LineBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.65 }),
    );
    frame.position.set(0, 1.65, config.z + 0.03);
    shell.add(frame);
    this.root.add(shell);
    this.arShell = shell;
  }

  spawnWave(wave) {
    const ar = this.isARPresentation;
    const positions = ar
      ? [
          [0, 0.35, -6.7],
          [-4.9, 0.8, -11.5],
          [4.9, 0.8, -11.5],
        ]
      : [
          [0, 1, 0.2],
          [-8.6, 2, -8.7],
          [8.6, 2, -8.7],
          [0, 3.2, -18],
        ];
    const roles = ['STRIKER', 'WARDEN', 'LEAPER', 'PRIME'];
    const count = Math.min(wave + 1, wave === 3 ? 1 : 3);
    for (let i = 0; i < count; i += 1) {
      const index = wave === 3 ? 3 : (wave - 1 + i) % 3;
      const [x, y, z] = positions[index];
      this.spawnEnemy(new THREE.Vector3(x, y, z), roles[index], index === 3 ? COLORS.amber : COLORS.coral);
    }
  }

  spawnEnemy(position, role, color) {
    const mesh = createHumanoid(color, role);
    mesh.position.copy(position);
    mesh.scale.setScalar(role === 'PRIME' ? 1.24 : 1);
    this.root.add(mesh);

    const healthRoot = new THREE.Group();
    healthRoot.position.set(0, role === 'PRIME' ? 2.85 : 2.7, 0);
    const healthBack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.055),
      new THREE.MeshBasicMaterial({ color: 0x14070b, transparent: true, opacity: 0.8, depthTest: false }),
    );
    const healthFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.035),
      new THREE.MeshBasicMaterial({ color, depthTest: false, toneMapped: false }),
    );
    healthFill.position.z = 0.002;
    healthRoot.add(healthBack, healthFill);
    mesh.add(healthRoot);
    let barrier = null;
    if (role === 'WARDEN') {
      barrier = new THREE.Mesh(
        new THREE.RingGeometry(0.52, 0.98, 8),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.48,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      barrier.position.set(0, 1.28, 0.76);
      mesh.add(barrier);
    }
    const health = role === 'PRIME' ? 220 : role === 'WARDEN' ? 130 : 100;
    const enemy = {
      id: ++this.enemySerial,
      mesh,
      position: mesh.position,
      origin: position.clone(),
      health,
      maxHealth: health,
      role,
      color,
      cooldown: 1.5 + this.random() * 1.4,
      phase: this.random() * Math.PI * 2,
      healthRoot,
      healthFill,
      barrier,
      hitFlash: 0,
      navTarget: position.clone(),
      relocateTimer: 0.35 + this.random() * 0.6,
      moveSpeed: role === 'LEAPER' ? 4.35 : role === 'PRIME' ? 3.4 : 3.72,
      running: false,
      rig: null,
      dead: false,
    };
    this.enemies.push(enemy);
    this.upgradeEnemyVisual(enemy);
  }

  async upgradeEnemyVisual(enemy) {
    try {
      const rig = await createAnimatedSentinel(enemy.color, enemy.role);
      if (this.disposed || enemy.dead || !enemy.mesh.parent) {
        rig.mixer.stopAllAction();
        disposeObject(rig.root);
        return;
      }
      const fallback = enemy.mesh;
      const position = fallback.position.clone();
      const quaternion = fallback.quaternion.clone();
      const visible = fallback.visible;
      enemy.healthRoot.removeFromParent();
      enemy.barrier?.removeFromParent();
      rig.root.position.copy(position);
      rig.root.quaternion.copy(quaternion);
      rig.root.visible = visible;
      if (enemy.role === 'PRIME') rig.root.scale.setScalar(1.12);
      enemy.healthRoot.position.set(0, enemy.role === 'PRIME' ? 2.82 : 2.58, 0);
      rig.root.add(enemy.healthRoot);
      if (enemy.barrier) rig.root.add(enemy.barrier);
      this.root.add(rig.root);
      disposeObject(fallback);
      enemy.mesh = rig.root;
      enemy.position = rig.root.position;
      enemy.rig = rig;
    } catch (error) {
      console.warn('[Digi World] Procedural Sentinel retained:', error.message);
    }
  }

  getPlatformBelow(position) {
    let result = null;
    for (const platform of this.platforms) {
      const dx = position.x - platform.x;
      const dz = position.z - platform.z;
      if (dx * dx + dz * dz <= (platform.radius - 0.38) ** 2) {
        if (!result || platform.y > result.y) result = platform;
      }
    }
    return result;
  }

  getPlayerCenter() {
    if (this.world.renderer.xr.isPresenting) {
      this.root.updateWorldMatrix(true, false);
      const cameraPosition = new THREE.Vector3();
      this.world.camera.getWorldPosition(cameraPosition);
      return this.root.worldToLocal(cameraPosition);
    }
    return this.player.position.clone().add(new THREE.Vector3(0, 1.15, 0));
  }

  primaryStart() {
    if (this.player.discs <= 0 || this.charging) return;
    this.charging = true;
    this.charge = 0;
  }

  primaryEnd(ray) {
    if (!this.charging) return;
    this.throwDisc(ray || this.world.getAimRay());
    this.charging = false;
  }

  localizeRay(ray) {
    this.root.updateWorldMatrix(true, false);
    const worldEnd = ray.origin.clone().add(ray.direction);
    const origin = this.root.worldToLocal(ray.origin.clone());
    const end = this.root.worldToLocal(worldEnd);
    return { origin, direction: end.sub(origin).normalize() };
  }

  setShield(active) {
    this.shielding = active;
  }

  cancelInput() {
    this.charging = false;
    this.charge = 0;
    this.shielding = false;
  }

  throwDisc(ray) {
    if (this.player.discs <= 0) return;
    const localRay = this.localizeRay(ray);
    const origin = localRay.origin.clone().addScaledVector(localRay.direction, 0.5);
    const speed = 14 + Math.min(1, this.charge) * 8;
    const mesh = createDisc(COLORS.cyan, false);
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localRay.direction);
    this.root.add(mesh);
    const trail = createDiscTrail(COLORS.cyan, 32);
    trail.position.set(0, 0, 0);
    this.root.add(trail);
    this.projectiles.push({
      id: ++this.discSerial,
      owner: 'player',
      mesh,
      position: mesh.position,
      previous: mesh.position.clone(),
      velocity: localRay.direction.multiplyScalar(speed),
      age: 0,
      returning: false,
      damage: 42 + Math.min(1, this.charge) * 30,
      hitIds: new Set(),
      crossedShell: false,
      returnToAmmo: true,
      trail,
    });
    this.player.discs -= 1;
    this.world.pulseCrosshair();
  }

  recallDiscs() {
    for (const projectile of this.projectiles) {
      if (projectile.owner === 'player') projectile.returning = true;
    }
  }

  fractureReality(impact) {
    if (!this.arPanels.length) return;
    const amount = Math.min(3, 1 + Math.floor(this.fractureLevel / 3));
    const nearbyPanels = this.arPanels
      .filter((panel) => panel.visible)
      .sort((a, b) => {
        const aDistance = (a.position.x - impact.x) ** 2 + (a.position.y - impact.y) ** 2;
        const bDistance = (b.position.x - impact.x) ** 2 + (b.position.y - impact.y) ** 2;
        return aDistance - bDistance;
      });
    for (let i = 0; i < amount; i += 1) {
      const panel = nearbyPanels[i];
      if (!panel) break;
      panel.visible = false;
      const worldPosition = new THREE.Vector3();
      panel.getWorldPosition(worldPosition);
      const localPosition = this.root.worldToLocal(worldPosition);
      this.bursts.push(createParticleBurst(this.root, localPosition, COLORS.cyan, 14, 0.13));
      this.shockwaves.push(createShockwave(this.root, localPosition, COLORS.cyan));
    }
    this.fractureLevel += 1;
    if (this.arPortal) this.arPortal.material.opacity = Math.min(0.94, 0.2 + this.fractureLevel * 0.1);
    this.world.announce(this.fractureLevel >= 5 ? 'THE ROOM IS OPEN' : `REALITY FRACTURE ${this.fractureLevel}`, 1.2);
    this.score += 50;
  }

  getEnemyThrowOrigin(enemy) {
    const origin = enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.62, 0));
    const throwHand = enemy.rig?.bones['mixamorig:RightHand'];
    if (!throwHand) return origin;
    this.root.updateWorldMatrix(true, true);
    throwHand.getWorldPosition(origin);
    return this.root.worldToLocal(origin);
  }

  spawnEnemyDisc(enemy, target) {
    if (enemy.dead) return;
    const origin = this.getEnemyThrowOrigin(enemy);
    if (enemy.rig) enemy.rig.handDisc.visible = false;
    const direction = target.clone().sub(origin).normalize();
    origin.addScaledVector(direction, 0.16);
    const mesh = createDisc(enemy.color, true);
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    this.root.add(mesh);
    const trail = createDiscTrail(enemy.color, 26);
    this.root.add(trail);
    this.projectiles.push({
      id: ++this.discSerial,
      owner: 'enemy',
      mesh,
      position: mesh.position,
      previous: mesh.position.clone(),
      velocity: direction.multiplyScalar(8.5 + this.wave * 0.8),
      age: 0,
      returning: false,
      damage: enemy.role === 'PRIME' ? 28 : 18,
      hitIds: new Set(),
      returnToAmmo: false,
      trail,
    });
  }

  startTelegraph(enemy, targetOverride = null) {
    const start = this.getEnemyThrowOrigin(enemy);
    const target = targetOverride || this.getPlayerCenter();
    const geometry = new THREE.BufferGeometry().setFromPoints([start, target]);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: enemy.color,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.root.add(line);
    const duration = enemy.role === 'PRIME' ? 0.52 : 0.72;
    this.telegraphs.push({ enemy, target, line, life: duration, maxLife: duration });
  }

  damageEnemy(enemy, amount, impact) {
    if (enemy.dead) return;
    enemy.health -= amount;
    enemy.hitFlash = 0.28;
    enemy.healthFill.scale.x = Math.max(0.001, enemy.health / enemy.maxHealth);
    enemy.healthFill.position.x = -0.43 * (1 - enemy.health / enemy.maxHealth);
    this.bursts.push(createParticleBurst(this.root, impact, enemy.color, 12, 0.09));
    this.shockwaves.push(createShockwave(this.root, impact, enemy.color));
    this.combo += 1;
    this.comboTimer = 3.2;
    this.score += Math.round(amount * 3 * Math.max(1, this.combo * 0.2));
    if (enemy.mesh.userData.torso) enemy.mesh.userData.torso.material.emissiveIntensity = 1.8;
    if (enemy.health <= 0) {
      enemy.dead = true;
      this.score += enemy.role === 'PRIME' ? 2000 : 500;
      this.combo += 2;
      const center = enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      this.bursts.push(createParticleBurst(this.root, center, enemy.color, enemy.role === 'PRIME' ? 46 : 28, 0.16));
      enemy.mesh.visible = false;
      this.world.announce(`${enemy.role} DEREZZED // +${enemy.role === 'PRIME' ? 2000 : 500}`, 1.35);
      if (this.enemies.every((item) => item.dead)) {
        if (this.wave >= 3) {
          this.waveDelay = -1;
          this.world.endGame(true, {
            title: 'THE SHATTERGRID YIELDS',
            detail: `Signal ${this.score.toLocaleString()} · ${this.combo} chain peak`,
          });
        } else {
          this.waveDelay = 2.1;
        }
      }
    }
  }

  damagePlayer(amount) {
    if (this.player.invulnerable > 0) return;
    this.player.health = Math.max(0, this.player.health - amount);
    this.player.invulnerable = 0.45;
    this.combo = 0;
    this.comboTimer = 0;
    this.world.damageFeedback(amount);
    this.shockwaves.push(createShockwave(this.root, this.getPlayerCenter(), COLORS.coral));
    if (this.player.health <= 0) {
      this.world.endGame(false, {
        title: 'SIGNAL SEVERED',
        detail: `Signal ${this.score.toLocaleString()} · reached sync ${this.wave}`,
      });
    }
  }

  removeProjectile(index) {
    const [projectile] = this.projectiles.splice(index, 1);
    if (!projectile) return;
    if (projectile.returnToAmmo) this.player.discs = Math.min(2, this.player.discs + 1);
    if (projectile.trail) disposeObject(projectile.trail);
    disposeObject(projectile.mesh);
  }

  updatePlayer(dt) {
    const player = this.player;
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    player.invulnerable = Math.max(0, player.invulnerable - dt);

    if (this.world.presentation === 'ar') {
      this.root.updateWorldMatrix(true, false);
      const cameraPosition = new THREE.Vector3();
      this.world.camera.getWorldPosition(cameraPosition);
      const localCamera = this.root.worldToLocal(cameraPosition);
      player.position.set(localCamera.x, Math.max(0, localCamera.y - this.world.eyeHeight), localCamera.z);
      player.velocity.set(0, 0, 0);
      player.grounded = true;
      this.world.consumeXRJump();
      this.world.consumeXRDash();
      return;
    }

    const forward = new THREE.Vector3(-Math.sin(this.world.yaw), 0, -Math.cos(this.world.yaw));
    const right = new THREE.Vector3(Math.cos(this.world.yaw), 0, -Math.sin(this.world.yaw));
    const move = new THREE.Vector3();
    if (this.world.input.isDown('KeyW') || this.world.input.isDown('ArrowUp')) move.add(forward);
    if (this.world.input.isDown('KeyS') || this.world.input.isDown('ArrowDown')) move.sub(forward);
    if (this.world.input.isDown('KeyD') || this.world.input.isDown('ArrowRight')) move.add(right);
    if (this.world.input.isDown('KeyA') || this.world.input.isDown('ArrowLeft')) move.sub(right);
    if (this.world.xrMove.lengthSq() > 0) {
      move.addScaledVector(forward, -this.world.xrMove.y);
      move.addScaledVector(right, this.world.xrMove.x);
    }
    if (move.lengthSq() > 0) move.normalize();

    const accel = player.grounded ? 12 : 3.8;
    const speed = 5.8;
    player.velocity.x = THREE.MathUtils.damp(player.velocity.x, move.x * speed, accel, dt);
    player.velocity.z = THREE.MathUtils.damp(player.velocity.z, move.z * speed, accel, dt);

    if ((this.world.input.consumePress('Space') || this.world.consumeXRJump()) && player.grounded) {
      player.velocity.y = 7.4;
      player.velocity.addScaledVector(forward, 3.9);
      player.grounded = false;
      this.world.announce('AIR STEP', 0.65);
    }
    if (
      (this.world.input.consumePress('ShiftLeft') ||
        this.world.input.consumePress('ShiftRight') ||
        this.world.consumeXRDash()) &&
      player.dashCooldown <= 0
    ) {
      const dashDirection = move.lengthSq() ? move : forward;
      player.velocity.addScaledVector(dashDirection, 9.2);
      player.dashCooldown = 1.4;
      player.invulnerable = Math.max(player.invulnerable, 0.18);
      this.world.pulseVignette();
    }

    const previousY = player.position.y;
    player.position.x += player.velocity.x * dt;
    player.position.z += player.velocity.z * dt;
    const under = this.getPlatformBelow(player.position);
    if (player.grounded && under && Math.abs(player.position.y - under.y) < 0.28) {
      player.position.y = under.y;
      player.velocity.y = 0;
    } else {
      player.grounded = false;
      player.velocity.y -= 14.5 * dt;
      player.position.y += player.velocity.y * dt;
      if (under && player.velocity.y <= 0 && previousY >= under.y - 0.12 && player.position.y <= under.y + 0.05) {
        player.position.y = under.y;
        player.velocity.y = 0;
        player.grounded = true;
      }
    }

    if (player.position.y < -10) {
      this.damagePlayer(16);
      player.position.set(0, 0, this.isARPresentation ? 1.5 : 11.5);
      player.velocity.set(0, 0, 0);
      player.grounded = true;
      this.world.announce('VOID RETURN // SIGNAL -16', 1.2);
    }
    this.world.setPlayerPosition(player.position);
    const planarSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    const bobStrength = player.grounded ? Math.min(1, planarSpeed / 5.8) : 0;
    this.world.setCameraBob(
      Math.sin(this.elapsed * 10.5) * 0.018 * bobStrength,
      Math.abs(Math.cos(this.elapsed * 10.5)) * 0.026 * bobStrength,
      0,
    );
  }

  updateEnemies(dt) {
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      enemy.phase += dt * (enemy.role === 'LEAPER' ? 2.2 : 1.25);
      const activeTelegraph = this.telegraphs.find((telegraph) => telegraph.enemy === enemy);
      const attacking = Boolean(activeTelegraph);
      enemy.relocateTimer -= dt;
      if (enemy.relocateTimer <= 0 && !attacking) {
        const angle = this.random() * Math.PI * 2;
        const radius = (enemy.role === 'PRIME' ? 3.35 : enemy.role === 'LEAPER' ? 3.5 : 3.2) * (0.64 + this.random() * 0.36);
        enemy.navTarget.set(
          enemy.origin.x + Math.cos(angle) * radius,
          enemy.origin.y,
          enemy.origin.z + Math.sin(angle) * radius,
        );
        enemy.relocateTimer = 1.05 + this.random() * 1.15;
      }
      const toTarget = enemy.navTarget.clone().sub(enemy.mesh.position);
      toTarget.y = 0;
      const remaining = toTarget.length();
      enemy.running = !attacking && remaining > 0.12;
      if (enemy.running) {
        const distance = Math.min(remaining, enemy.moveSpeed * dt);
        enemy.mesh.position.addScaledVector(toTarget.normalize(), distance);
        const strideLift = enemy.role === 'LEAPER' ? Math.max(0, Math.sin(enemy.phase * 5.5)) * 0.28 : 0;
        enemy.mesh.position.y = THREE.MathUtils.damp(enemy.mesh.position.y, enemy.origin.y + strideLift, 14, dt);
      } else {
        enemy.mesh.position.y = THREE.MathUtils.damp(enemy.mesh.position.y, enemy.origin.y, 12, dt);
      }
      const facingTarget = enemy.running ? enemy.navTarget.clone() : this.getPlayerCenter();
      facingTarget.y = enemy.mesh.position.y;
      const targetYaw = Math.atan2(
        facingTarget.x - enemy.mesh.position.x,
        facingTarget.z - enemy.mesh.position.z,
      );
      const yawDelta = Math.atan2(
        Math.sin(targetYaw - enemy.mesh.rotation.y),
        Math.cos(targetYaw - enemy.mesh.rotation.y),
      );
      enemy.mesh.rotation.y += yawDelta * (1 - Math.exp(-(attacking ? 12 : 8) * dt));
      const stride = Math.sin(enemy.phase * 4.2);
      if (enemy.rig) {
        updateSentinelRig(enemy.rig, dt, {
          running: enemy.running,
          attacking,
          attackProgress: activeTelegraph
            ? THREE.MathUtils.clamp(1 - activeTelegraph.life / activeTelegraph.maxLife, 0, 1)
            : 0,
          hit: enemy.hitFlash,
          speed: enemy.moveSpeed,
        });
      } else {
        enemy.mesh.userData.arms.forEach((arm, index) => {
          const targetRotation = attacking ? -1.05 + index * 0.12 : stride * (index ? -0.42 : 0.42);
          arm.rotation.x = THREE.MathUtils.damp(arm.rotation.x, targetRotation, attacking ? 12 : 8, dt);
          arm.rotation.z = THREE.MathUtils.damp(arm.rotation.z, attacking ? (index ? -0.22 : 0.22) : 0, 8, dt);
        });
        enemy.mesh.userData.legs.forEach((leg, index) => {
          leg.rotation.x = stride * (index ? -0.38 : 0.38);
        });
        enemy.mesh.userData.torso.scale.y = 1 + Math.sin(enemy.phase * 2.2) * 0.018;
        enemy.mesh.userData.head.rotation.y = Math.sin(enemy.phase * 0.9) * 0.12;
      }
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.mesh.rotation.z = THREE.MathUtils.damp(
        enemy.mesh.rotation.z,
        enemy.hitFlash > 0 ? Math.sin(enemy.hitFlash * 55) * 0.08 : 0,
        12,
        dt,
      );
      if (enemy.mesh.userData.torso) {
        enemy.mesh.userData.torso.material.emissiveIntensity = THREE.MathUtils.damp(
          enemy.mesh.userData.torso.material.emissiveIntensity,
          0.15,
          7,
          dt,
        );
      }
      if (enemy.barrier) {
        enemy.barrier.visible = Math.sin(enemy.phase * 1.7) > -0.2;
        enemy.barrier.rotation.z += dt * 0.85;
        enemy.barrier.material.opacity = 0.35 + Math.max(0, Math.sin(enemy.phase * 2.1)) * 0.28;
      }
      const enemyWorldQuaternion = enemy.mesh.getWorldQuaternion(new THREE.Quaternion());
      const cameraWorldQuaternion = this.world.camera.getWorldQuaternion(new THREE.Quaternion());
      enemy.healthRoot.quaternion.copy(enemyWorldQuaternion.invert().multiply(cameraWorldQuaternion));
      enemy.cooldown -= dt;
      if (enemy.cooldown <= 0 && this.world.phase === 'running') {
        this.startTelegraph(enemy);
        if (enemy.role === 'PRIME') {
          const alternateTarget = this.getPlayerCenter().add(new THREE.Vector3(1.2, 0.35, 0));
          this.startTelegraph(enemy, alternateTarget);
        }
        enemy.cooldown = Math.max(1.35, 3.25 - this.wave * 0.28) + this.random() * 1.8;
      }
    }
  }

  updateTelegraphs(dt) {
    for (let i = this.telegraphs.length - 1; i >= 0; i -= 1) {
      const telegraph = this.telegraphs[i];
      telegraph.life -= dt;
      const start = this.getEnemyThrowOrigin(telegraph.enemy);
      const positions = telegraph.line.geometry.attributes.position;
      positions.setXYZ(0, start.x, start.y, start.z);
      positions.setXYZ(1, telegraph.target.x, telegraph.target.y, telegraph.target.z);
      positions.needsUpdate = true;
      telegraph.line.material.opacity = 0.16 + Math.abs(Math.sin(telegraph.life * 34)) * 0.72;
      if (telegraph.life <= 0) {
        this.spawnEnemyDisc(telegraph.enemy, telegraph.target);
        disposeObject(telegraph.line);
        this.telegraphs.splice(i, 1);
      }
    }
  }

  updateProjectiles(dt) {
    const playerCenter = this.getPlayerCenter();
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];
      projectile.previous.copy(projectile.position);
      projectile.age += dt;
      if (projectile.owner === 'player' && (projectile.age > 1.2 || projectile.returning)) {
        projectile.returning = true;
        const direction = playerCenter.clone().sub(projectile.position).normalize();
        projectile.velocity.lerp(direction.multiplyScalar(19), Math.min(1, dt * 7));
      }
      projectile.position.addScaledVector(projectile.velocity, dt);
      updateDiscTrail(projectile.trail, projectile.position);
      projectile.mesh.rotation.z += dt * 22;
      projectile.mesh.rotation.y += dt * 4;

      if (
        this.arShellZ !== undefined &&
        projectile.owner === 'player' &&
        !projectile.crossedShell &&
        projectile.previous.z > this.arShellZ &&
        projectile.position.z <= this.arShellZ
      ) {
        projectile.crossedShell = true;
        this.fractureReality(projectile.position.clone());
      }

      if (projectile.owner === 'player') {
        for (const enemy of this.enemies) {
          if (enemy.dead || projectile.hitIds.has(enemy.id)) continue;
          const enemyCenter = enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0));
          if (projectile.position.distanceToSquared(enemyCenter) < (enemy.role === 'PRIME' ? 1.6 : 1.05)) {
            projectile.hitIds.add(enemy.id);
            if (enemy.barrier?.visible && !projectile.returning) {
              projectile.returning = true;
              this.score += 75;
              this.bursts.push(createParticleBurst(this.root, projectile.position.clone(), enemy.color, 14, 0.1));
              this.shockwaves.push(createShockwave(this.root, projectile.position.clone(), enemy.color));
              this.world.announce('WARDEN DEFLECT // ATTACK BETWEEN PULSES', 0.9);
              break;
            }
            this.damageEnemy(enemy, projectile.damage * (projectile.returning ? 1.25 : 1), projectile.position.clone());
            projectile.returning = true;
            break;
          }
        }
        if (projectile.returning && projectile.age > 0.45 && projectile.position.distanceToSquared(playerCenter) < 0.78) {
          this.removeProjectile(i);
          this.score += 35;
          continue;
        }
      } else if (projectile.position.distanceToSquared(playerCenter) < 0.72) {
        if (this.shielding && this.player.shield > 0) {
          const target = this.enemies.find((enemy) => !enemy.dead);
          if (target) {
            projectile.owner = 'player';
            projectile.returning = false;
            projectile.age = 0;
            projectile.damage = 62;
            projectile.hitIds.clear();
            projectile.velocity.copy(target.mesh.position).add(new THREE.Vector3(0, 1.2, 0)).sub(projectile.position).normalize().multiplyScalar(17);
            this.score += 150;
            this.combo += 1;
            this.world.announce('PERFECT PARRY // +150', 0.9);
            this.world.pulseVignette();
            continue;
          }
        }
        this.damagePlayer(projectile.damage);
        this.removeProjectile(i);
        continue;
      }
      if (projectile.age > 6 || projectile.position.lengthSq() > 15000) {
        this.removeProjectile(i);
      }
    }
  }

  update(dt) {
    this.elapsed += dt;
    if (this.world.phase !== 'running') return;
    if (this.charging) this.charge = Math.min(1, this.charge + dt * 1.1);
    if (this.handDisc) {
      this.handDisc.visible = this.player.discs > 0;
      const heldScale = 0.23 + (this.charging ? this.charge * 0.055 : Math.sin(this.elapsed * 3.2) * 0.006);
      this.handDisc.scale.setScalar(heldScale);
      this.handDisc.rotation.z += dt * (this.charging ? 8 : 1.4);
    }
    this.shielding = this.shielding || this.world.input.isDown('Mouse2');
    if (this.shielding) {
      this.player.shield = Math.max(0, this.player.shield - dt * 24);
    } else {
      this.player.shield = Math.min(100, this.player.shield + dt * 14);
    }
    if (!this.world.input.isDown('Mouse2') && !this.world.xrShielding) this.shielding = false;
    if (
      this.world.input.consumePress('KeyQ') ||
      this.world.input.consumePress('KeyE') ||
      this.world.consumeXRSecondary()
    ) this.recallDiscs();

    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updateTelegraphs(dt);
    this.updateProjectiles(dt);
    updateBursts(this.bursts, dt);
    updateShockwaves(this.shockwaves, dt, this.world.camera);
    updateEnvironment(this.environment, this.elapsed, dt);
    this.platforms.forEach((platform, index) => {
      const rim = platform.mesh.userData.rim;
      const innerRim = platform.mesh.userData.innerRim;
      if (rim) rim.rotation.z += dt * (index % 2 ? -0.05 : 0.04);
      if (innerRim) {
        innerRim.rotation.z -= dt * 0.11;
        innerRim.material.opacity = 0.35 + Math.sin(this.elapsed * 1.8 + index) * 0.18;
      }
    });

    if (this.waveDelay > 0) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) {
        this.wave += 1;
        this.spawnWave(this.wave);
        this.world.announce(this.wave === 3 ? 'PRIME SENTINEL // FINAL SYNC' : `SYNC ${this.wave} // SIGNAL RISING`, 2);
      }
    }

    this.world.updateHUD({
      mode: 'SHARD ARENA',
      score: this.score,
      health: this.player.health,
      resource: this.player.shield,
      resourceLabel: this.charging ? `CHARGE ${Math.round(this.charge * 100)}%` : `GUARD ${Math.round(this.player.shield)}% · ${this.player.discs}/2 SHARDS`,
      objective: this.enemies.some((enemy) => !enemy.dead)
        ? `SYNC ${this.wave} · ${this.enemies.filter((enemy) => !enemy.dead).length} SENTINELS ACTIVE`
        : 'RECALIBRATING THE GRID',
      combo: this.combo > 1 ? `x${this.combo} CHAIN` : '',
      speed: '',
    });
  }

  getState() {
    return {
      mode: 'disc_arena',
      coordinateSystem: 'meters; origin at first platform centerline, +x right, +y up, -z forward from initial view',
      wave: this.wave,
      player: {
        x: +this.player.position.x.toFixed(2),
        y: +this.player.position.y.toFixed(2),
        z: +this.player.position.z.toFixed(2),
        vx: +this.player.velocity.x.toFixed(2),
        vy: +this.player.velocity.y.toFixed(2),
        vz: +this.player.velocity.z.toFixed(2),
        health: Math.round(this.player.health),
        guard: Math.round(this.player.shield),
        discs: this.player.discs,
        grounded: this.player.grounded,
        dashCooldown: +this.player.dashCooldown.toFixed(2),
      },
      enemies: this.enemies
        .filter((enemy) => !enemy.dead)
        .map((enemy) => ({
          id: enemy.id,
          role: enemy.role,
          x: +enemy.mesh.position.x.toFixed(1),
          y: +enemy.mesh.position.y.toFixed(1),
          z: +enemy.mesh.position.z.toFixed(1),
          health: Math.max(0, Math.round(enemy.health)),
          attackIn: +Math.max(0, enemy.cooldown).toFixed(1),
          visual: enemy.rig ? 'skinned_digital_human' : 'loading_fallback',
          motion: this.telegraphs.some((telegraph) => telegraph.enemy === enemy)
            ? 'throwing'
            : enemy.running
              ? 'sprinting'
              : 'idle',
        })),
      projectiles: this.projectiles.map((disc) => ({
        owner: disc.owner,
        x: +disc.position.x.toFixed(1),
        y: +disc.position.y.toFixed(1),
        z: +disc.position.z.toFixed(1),
        returning: disc.returning,
      })),
      platforms: this.platforms.map((platform) => ({
        x: platform.x,
        y: platform.y,
        z: platform.z,
        radius: platform.radius,
      })),
      telegraphs: this.telegraphs.map((telegraph) => ({
        enemyId: telegraph.enemy.id,
        role: telegraph.enemy.role,
        firesIn: +Math.max(0, telegraph.life).toFixed(2),
      })),
      score: this.score,
      combo: this.combo,
      charging: this.charging,
      realityFractures: this.fractureLevel,
      roomPreset: this.roomPreset,
    };
  }

  dispose() {
    this.disposed = true;
    this.enemies.forEach((enemy) => {
      if (enemy.rig) {
        enemy.rig.mixer.stopAllAction();
        enemy.rig.mixer.uncacheRoot(enemy.rig.model);
      }
    });
    if (this.handDisc) disposeObject(this.handDisc);
    this.portalTexture?.dispose();
    disposeObject(this.root);
  }
}
