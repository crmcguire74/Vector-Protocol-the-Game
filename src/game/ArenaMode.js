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
  createRealityBreach,
  createRoomFootprint,
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
const DISC_FORWARD = new THREE.Vector3(0, 0, 1);
const DISC_RADIUS = 0.36;

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
    this.breaches = [];
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
    this.playerOpeningLatched = false;
    this.openingCooldown = 0;
    this.ricochetCount = 0;
    this.arRoom = null;
    this.arFootprint = null;

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

    if (this.isARPresentation) {
      this.arRoom = this.getARRoomConfig();
      this.arenaBounds = {
        minX: this.arRoom.minX,
        maxX: this.arRoom.maxX,
        minZ: this.arRoom.minZ,
        maxZ: this.arRoom.maxZ,
        floorY: this.arRoom.floorY,
        ceilingY: this.arRoom.ceilingY,
      };
      this.arFootprint = createRoomFootprint({
        width: this.arRoom.width,
        depth: this.arRoom.depth,
        floorY: this.arRoom.floorY,
        centerX: this.arRoom.centerX,
        centerZ: this.arRoom.centerZ,
        color: COLORS.cyan,
      });
      this.root.add(this.arFootprint);
      this.player.position.set(
        this.arRoom.centerX,
        this.arRoom.floorY,
        this.arRoom.maxZ - Math.min(0.7, this.arRoom.depth * 0.18),
      );
      this.buildARRoomShell();
    } else {
      this.arenaBounds = {
        minX: -17,
        maxX: 17,
        minZ: -26,
        maxZ: 17,
        floorY: -7.72,
        ceilingY: 10.5,
      };
      const layout = [
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
    }
  }

  getARRoomConfig() {
    const presets = {
      portal: { width: 5.6, depth: 6.45, centerZ: -1.225, columns: 7, rows: 5, wallHeight: 3.9 },
      arena: { width: 8, depth: 7.8, centerZ: -0.85, columns: 9, rows: 4, wallHeight: 3.55 },
      tabletop: { width: 4.4, depth: 4.8, centerZ: -1.25, columns: 6, rows: 4, wallHeight: 2.8 },
    };
    const preset = presets[this.roomPreset] || presets.portal;
    const centerX = 0;
    const floorY = 0;
    const minX = centerX - preset.width * 0.5;
    const maxX = centerX + preset.width * 0.5;
    const minZ = preset.centerZ - preset.depth * 0.5;
    const maxZ = preset.centerZ + preset.depth * 0.5;
    return {
      ...preset,
      centerX,
      floorY,
      ceilingY: preset.wallHeight,
      minX,
      maxX,
      minZ,
      maxZ,
      area: preset.width * preset.depth,
      signedArea: preset.width * preset.depth,
      vertices: [
        { x: minX, y: floorY, z: minZ },
        { x: maxX, y: floorY, z: minZ },
        { x: maxX, y: floorY, z: maxZ },
        { x: minX, y: floorY, z: maxZ },
      ],
      source: 'preset-room-footprint',
    };
  }

  setBoundedFloorFootprint(footprint) {
    if (
      !this.isARPresentation ||
      !footprint?.vertices?.length ||
      footprint.vertices.length < 3 ||
      footprint.width < 1.5 ||
      footprint.depth < 1.5 ||
      footprint.area < 2
    ) return false;
    const fallback = this.arRoom || this.getARRoomConfig();
    this.arRoom = {
      ...fallback,
      source: 'webxr-bounded-floor',
      vertices: footprint.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y, z: vertex.z })),
      signedArea: footprint.signedArea,
      area: footprint.area,
      width: footprint.width,
      depth: footprint.depth,
      centerX: footprint.centerX,
      centerZ: footprint.centerZ,
      floorY: footprint.floorY,
      minX: footprint.minX,
      maxX: footprint.maxX,
      minZ: footprint.minZ,
      maxZ: footprint.maxZ,
      ceilingY: footprint.floorY + fallback.wallHeight,
    };
    this.arenaBounds = {
      minX: this.arRoom.minX,
      maxX: this.arRoom.maxX,
      minZ: this.arRoom.minZ,
      maxZ: this.arRoom.maxZ,
      floorY: this.arRoom.floorY,
      ceilingY: this.arRoom.ceilingY,
    };

    if (this.arFootprint) disposeObject(this.arFootprint);
    this.arFootprint = createRoomFootprint({
      width: this.arRoom.width,
      depth: this.arRoom.depth,
      floorY: this.arRoom.floorY,
      centerX: this.arRoom.centerX,
      centerZ: this.arRoom.centerZ,
      color: COLORS.cyan,
    });
    this.arFootprint.userData.outline.visible = false;
    this.arFootprint.userData.guides.visible = false;
    const polygon = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(this.arRoom.vertices.map((vertex) => new THREE.Vector3(
        vertex.x - this.arRoom.centerX,
        0.035,
        vertex.z - this.arRoom.centerZ,
      ))),
      new THREE.LineBasicMaterial({
        color: COLORS.ice,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    polygon.name = 'webxr-bounded-floor-outline';
    this.arFootprint.add(polygon);
    this.root.add(this.arFootprint);

    if (this.arShell) disposeObject(this.arShell);
    this.portalTexture?.dispose();
    this.portalTexture = null;
    this.arPanels.length = 0;
    this.buildARRoomShell();

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const safe = this.pickARRoamTarget(enemy, true);
      enemy.mesh.position.copy(safe);
      enemy.origin.copy(safe);
      enemy.navTarget.copy(safe);
    }
    this.world.announce('BOUNDED PLAY SPACE LOCKED', 1.35);
    return true;
  }

  roomContainsPoint(x, z, margin = 0) {
    const room = this.arRoom;
    if (!room) return false;
    if (!room.vertices?.length) {
      return x >= room.minX + margin && x <= room.maxX - margin &&
        z >= room.minZ + margin && z <= room.maxZ - margin;
    }
    let inside = false;
    let edgeDistanceSq = Infinity;
    for (let index = 0, previousIndex = room.vertices.length - 1; index < room.vertices.length; previousIndex = index, index += 1) {
      const current = room.vertices[index];
      const previous = room.vertices[previousIndex];
      const crosses = (current.z > z) !== (previous.z > z) &&
        x < ((previous.x - current.x) * (z - current.z)) / (previous.z - current.z || 1e-6) + current.x;
      if (crosses) inside = !inside;
      const edgeX = previous.x - current.x;
      const edgeZ = previous.z - current.z;
      const edgeLengthSq = edgeX * edgeX + edgeZ * edgeZ;
      const t = THREE.MathUtils.clamp(((x - current.x) * edgeX + (z - current.z) * edgeZ) / Math.max(1e-6, edgeLengthSq), 0, 1);
      const nearX = current.x + edgeX * t;
      const nearZ = current.z + edgeZ * t;
      edgeDistanceSq = Math.min(edgeDistanceSq, (x - nearX) ** 2 + (z - nearZ) ** 2);
    }
    return inside && edgeDistanceSq >= margin * margin;
  }

  clampPointToRoom(x, z, margin = 0.18) {
    const room = this.arRoom;
    if (!room || this.roomContainsPoint(x, z, margin)) return new THREE.Vector2(x, z);
    if (!room.vertices?.length) {
      return new THREE.Vector2(
        THREE.MathUtils.clamp(x, room.minX + margin, room.maxX - margin),
        THREE.MathUtils.clamp(z, room.minZ + margin, room.maxZ - margin),
      );
    }
    let closest = new THREE.Vector2(room.centerX, room.centerZ);
    let closestDistanceSq = Infinity;
    for (let index = 0; index < room.vertices.length; index += 1) {
      const current = room.vertices[index];
      const next = room.vertices[(index + 1) % room.vertices.length];
      const edgeX = next.x - current.x;
      const edgeZ = next.z - current.z;
      const lengthSq = edgeX * edgeX + edgeZ * edgeZ;
      const t = THREE.MathUtils.clamp(((x - current.x) * edgeX + (z - current.z) * edgeZ) / Math.max(1e-6, lengthSq), 0, 1);
      const candidate = new THREE.Vector2(current.x + edgeX * t, current.z + edgeZ * t);
      const distanceSq = (x - candidate.x) ** 2 + (z - candidate.y) ** 2;
      if (distanceSq < closestDistanceSq) {
        closestDistanceSq = distanceSq;
        closest.copy(candidate);
      }
    }
    const inward = new THREE.Vector2(room.centerX - closest.x, room.centerZ - closest.y).normalize();
    return closest.addScaledVector(inward, margin);
  }

  getPolygonBoundaryCollision(position, velocity, radius) {
    const room = this.arRoom;
    if (!room?.vertices?.length) return null;
    const ccw = room.signedArea >= 0;
    let collision = null;
    for (let index = 0; index < room.vertices.length; index += 1) {
      const current = room.vertices[index];
      const next = room.vertices[(index + 1) % room.vertices.length];
      const edgeX = next.x - current.x;
      const edgeZ = next.z - current.z;
      const length = Math.max(1e-6, Math.hypot(edgeX, edgeZ));
      const normal = ccw
        ? new THREE.Vector3(-edgeZ / length, 0, edgeX / length)
        : new THREE.Vector3(edgeZ / length, 0, -edgeX / length);
      const distance = (position.x - current.x) * normal.x + (position.z - current.z) * normal.z;
      if (distance < radius && velocity.dot(normal) < 0 && (!collision || distance < collision.distance)) {
        collision = { normal, distance };
      }
    }
    if (!collision) return null;
    return {
      normal: collision.normal,
      correction: radius - collision.distance,
    };
  }

  buildARRoomShell() {
    const room = this.arRoom || this.getARRoomConfig();
    const config = {
      columns: room.columns,
      rows: room.rows,
      width: room.width / room.columns,
      height: room.wallHeight / room.rows,
      z: room.minZ,
    };
    this.arShellZ = room.minZ;
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
    portal.position.set(room.centerX, room.floorY + room.wallHeight * 0.5, config.z - 0.13);
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
    cathedralPortal.position.set(room.centerX, room.floorY + room.wallHeight * 0.5, config.z - 0.2);
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
          room.floorY + config.height * 0.5 + row * config.height,
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
    frame.position.set(room.centerX, room.floorY + room.wallHeight * 0.5, config.z + 0.03);
    shell.add(frame);
    this.root.add(shell);
    this.arShell = shell;
  }

  spawnWave(wave) {
    const ar = this.isARPresentation;
    const room = this.arRoom;
    const positions = ar && room
      ? [
          [room.centerX, room.floorY, room.minZ + Math.min(1.2, room.depth * 0.22)],
          [room.centerX - room.width * 0.27, room.floorY, room.minZ + room.depth * 0.34],
          [room.centerX + room.width * 0.27, room.floorY, room.minZ + room.depth * 0.34],
          [room.centerX, room.floorY, room.minZ + Math.min(0.95, room.depth * 0.2)],
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
      const spawn = new THREE.Vector3(x, y, z);
      if (ar && !this.roomContainsPoint(spawn.x, spawn.z, 0.42)) {
        const safe = this.clampPointToRoom(spawn.x, spawn.z, 0.48);
        spawn.set(safe.x, room.floorY, safe.y);
      }
      this.spawnEnemy(spawn, roles[index], index === 3 ? COLORS.amber : COLORS.coral);
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
      openingCooldown: 0,
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
    if (this.isARPresentation && this.arRoom) {
      const inside = this.roomContainsPoint(position.x, position.z, 0.04);
      if (inside && !this.isFloorOpening(position.x, position.z)) {
        return {
          x: this.arRoom.centerX,
          y: this.arRoom.floorY,
          z: this.arRoom.centerZ,
          radius: Math.max(this.arRoom.width, this.arRoom.depth),
          roomFootprint: true,
        };
      }
      return null;
    }
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
    this.root.add(mesh);
    const trail = createDiscTrail(COLORS.cyan, 14);
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
      color: COLORS.cyan,
      banks: 0,
      maxBanks: 5,
      bankCooldown: 0,
      wobble: 0,
      flightSpin: 28 + this.random() * 8,
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

  spawnPersistentBreach(impact, normal, color = COLORS.cyan) {
    if (!this.isARPresentation || !this.arRoom || !normal?.lengthSq()) return null;
    const breachNormal = normal.clone().normalize();
    const type = breachNormal.y > 0.55 ? 'floor' : 'wall';
    const radius = type === 'floor' ? 0.58 + this.random() * 0.12 : 0.64 + this.random() * 0.12;
    const position = impact.clone();
    if (type === 'floor') {
      position.y = this.arRoom.floorY + 0.018;
      breachNormal.copy(UP);
    } else {
      position.y = THREE.MathUtils.clamp(position.y, this.arRoom.floorY + 0.42, this.arRoom.ceilingY - 0.32);
    }

    const nearby = this.breaches.find((breach) => (
      breach.type === type &&
      breach.normal.dot(breachNormal) > 0.82 &&
      breach.position.distanceToSquared(position) < (breach.radius * 0.72) ** 2
    ));
    if (nearby) {
      nearby.targetScale = Math.min(1.24, (nearby.targetScale || 1) + 0.08);
      nearby.mesh.userData.halo.material.opacity = 0.68;
      return nearby;
    }
    if (this.breaches.length >= 18) return null;

    const mesh = createRealityBreach(color, radius);
    mesh.position.copy(position).addScaledVector(breachNormal, 0.018);
    mesh.quaternion.setFromUnitVectors(DISC_FORWARD, breachNormal);
    mesh.scale.setScalar(0.04);
    this.root.add(mesh);
    const breach = {
      mesh,
      position: position.clone(),
      normal: breachNormal,
      radius,
      type,
      growth: 0,
      targetScale: 1,
    };
    this.breaches.push(breach);
    this.fractureLevel += 1;
    this.world.announce(type === 'floor' ? 'FLOOR BREACH // MIND THE VOID' : 'ROOM BREACH // SPACE UNSEALED', 1.05);
    return breach;
  }

  getOpeningAtPoint(point, includeWalls = true) {
    for (const breach of this.breaches) {
      const activeRadius = breach.radius * Math.min(1, Math.max(0.2, breach.growth)) * 0.78;
      if (breach.type === 'floor') {
        const dx = point.x - breach.position.x;
        const dz = point.z - breach.position.z;
        if (dx * dx + dz * dz < activeRadius * activeRadius) return breach;
      } else if (includeWalls) {
        const delta = point.clone().sub(breach.position);
        const planeDistance = Math.abs(delta.dot(breach.normal));
        const tangentDistanceSq = Math.max(0, delta.lengthSq() - planeDistance * planeDistance);
        if (planeDistance < 0.42 && tangentDistanceSq < activeRadius * activeRadius) return breach;
      }
    }
    return null;
  }

  isFloorOpening(x, z) {
    const probe = new THREE.Vector3(x, this.arRoom?.floorY || 0, z);
    return this.getOpeningAtPoint(probe, false);
  }

  handlePlayerOpening(point) {
    if (!this.isARPresentation) return;
    const opening = this.getOpeningAtPoint(point, true);
    if (
      opening &&
      !this.playerOpeningLatched &&
      this.openingCooldown <= 0 &&
      this.player.invulnerable <= 0
    ) {
      this.playerOpeningLatched = true;
      this.openingCooldown = 1.65;
      this.damagePlayer(34);
      this.world.announce(
        opening.type === 'floor' ? 'VOID FALL // ONE LIFE LOST' : 'BREACH ENTRY // ONE LIFE LOST',
        1.25,
      );
    } else if (!opening) {
      this.playerOpeningLatched = false;
    }
  }

  handleEnemyOpening(enemy) {
    if (!this.isARPresentation || enemy.dead || enemy.openingCooldown > 0) return;
    const opening = this.isFloorOpening(enemy.mesh.position.x, enemy.mesh.position.z);
    if (!opening) return;
    enemy.openingCooldown = 1.8;
    const impact = enemy.mesh.position.clone().add(new THREE.Vector3(0, 0.45, 0));
    this.damageEnemy(enemy, Math.ceil(enemy.maxHealth * 0.5), impact);
    if (enemy.dead) return;
    const safe = this.pickARRoamTarget(enemy, true);
    enemy.mesh.position.copy(safe);
    enemy.origin.copy(safe);
    enemy.navTarget.copy(safe);
    this.world.announce(`${enemy.role} LOST TO THE BREACH`, 1.05);
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
    const aim = target.clone();
    if (this.arenaBounds && this.random() < Math.min(0.48, 0.18 + this.wave * 0.08)) {
      const wallX = this.random() < 0.5 ? this.arenaBounds.minX : this.arenaBounds.maxX;
      aim.x = wallX * 2 - target.x;
    }
    const direction = aim.sub(origin).normalize();
    origin.addScaledVector(direction, 0.16);
    const mesh = createDisc(enemy.color, true);
    mesh.position.copy(origin);
    this.root.add(mesh);
    const trail = createDiscTrail(enemy.color, 12);
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
      color: enemy.color,
      banks: 0,
      maxBanks: 4,
      bankCooldown: 0,
      wobble: 0,
      flightSpin: 25 + this.random() * 7,
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
    this.openingCooldown = Math.max(0, this.openingCooldown - dt);

    const physicalAR =
      this.isARPresentation &&
      this.world.presentation === 'ar' &&
      this.world.renderer.xr.isPresenting;
    if (physicalAR) {
      this.root.updateWorldMatrix(true, false);
      const cameraPosition = new THREE.Vector3();
      this.world.camera.getWorldPosition(cameraPosition);
      const localCamera = this.root.worldToLocal(cameraPosition);
      player.position.set(localCamera.x, Math.max(0, localCamera.y - this.world.eyeHeight), localCamera.z);
      player.velocity.set(0, 0, 0);
      player.grounded = true;
      this.handlePlayerOpening(localCamera);
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

    const jumpPressed = this.world.input.consumePress('Space') || this.world.consumeXRJump();
    if (jumpPressed && player.grounded && !this.isARPresentation) {
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
    if (this.isARPresentation && this.arRoom) {
      const headProbe = player.position.clone().add(new THREE.Vector3(0, this.world.eyeHeight, 0));
      this.handlePlayerOpening(headProbe);
      const safe = this.clampPointToRoom(player.position.x, player.position.z, 0.18);
      player.position.x = safe.x;
      player.position.z = safe.y;
    }
    if (this.world.renderer.xr.isPresenting) this.world.setPlayerPosition(player.position);
    const supportProbe = this.world.renderer.xr.isPresenting ? this.getPlayerCenter() : player.position.clone();
    supportProbe.y = player.position.y;
    const under = this.getPlatformBelow(supportProbe);
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

    const fallLimit = this.isARPresentation ? -2.8 : -10;
    if (player.position.y < fallLimit) {
      const openingAlreadyCharged =
        this.isARPresentation && this.playerOpeningLatched && this.openingCooldown > 0;
      if (!openingAlreadyCharged) this.damagePlayer(this.isARPresentation ? 34 : 16);
      if (this.isARPresentation && this.arRoom) {
        player.position.set(
          this.arRoom.centerX,
          this.arRoom.floorY,
          this.arRoom.maxZ - Math.min(0.7, this.arRoom.depth * 0.18),
        );
        this.playerOpeningLatched = true;
        this.openingCooldown = 1.2;
      } else {
        player.position.set(0, 0, 11.5);
      }
      player.velocity.set(0, 0, 0);
      player.grounded = true;
      this.world.announce(
        this.isARPresentation ? 'VOID RETURN // ONE LIFE LOST' : 'VOID RETURN // SIGNAL -16',
        1.2,
      );
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

  pickARRoamTarget(enemy, force = false) {
    if (!this.arRoom) return enemy.origin.clone();
    const margin = Math.min(0.62, this.arRoom.width * 0.13, this.arRoom.depth * 0.13);
    let candidate = enemy.origin.clone();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      candidate.set(
        THREE.MathUtils.lerp(this.arRoom.minX + margin, this.arRoom.maxX - margin, this.random()),
        this.arRoom.floorY,
        THREE.MathUtils.lerp(this.arRoom.minZ + margin, this.arRoom.maxZ - margin, this.random()),
      );
      if (this.roomContainsPoint(candidate.x, candidate.z, margin) && !this.isFloorOpening(candidate.x, candidate.z)) return candidate;
    }
    if (force) {
      candidate.set(
        this.arRoom.centerX,
        this.arRoom.floorY,
        this.arRoom.minZ + this.arRoom.depth * 0.3,
      );
      const safe = this.clampPointToRoom(candidate.x, candidate.z, margin);
      candidate.set(safe.x, this.arRoom.floorY, safe.y);
    }
    return candidate;
  }

  updateEnemies(dt) {
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      enemy.openingCooldown = Math.max(0, enemy.openingCooldown - dt);
      enemy.phase += dt * (enemy.role === 'LEAPER' ? 2.2 : 1.25);
      const activeTelegraph = this.telegraphs.find((telegraph) => telegraph.enemy === enemy);
      const attacking = Boolean(activeTelegraph);
      enemy.relocateTimer -= dt;
      if (enemy.relocateTimer <= 0 && !attacking) {
        if (this.isARPresentation && this.arRoom) {
          enemy.navTarget.copy(this.pickARRoamTarget(enemy));
        } else {
          const angle = this.random() * Math.PI * 2;
          const radius = (enemy.role === 'PRIME' ? 3.35 : enemy.role === 'LEAPER' ? 3.5 : 3.2) * (0.64 + this.random() * 0.36);
          enemy.navTarget.set(
            enemy.origin.x + Math.cos(angle) * radius,
            enemy.origin.y,
            enemy.origin.z + Math.sin(angle) * radius,
          );
        }
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
      if (this.isARPresentation && this.arRoom) {
        const margin = 0.32;
        const safe = this.clampPointToRoom(enemy.mesh.position.x, enemy.mesh.position.z, margin);
        enemy.mesh.position.x = safe.x;
        enemy.mesh.position.z = safe.y;
        this.handleEnemyOpening(enemy);
        if (enemy.dead) continue;
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

  getProjectileFloorHeight(projectile) {
    if (this.isARPresentation && this.arRoom) return this.arRoom.floorY;
    let floor = this.arenaBounds.floorY;
    for (const platform of this.platforms) {
      const dx = projectile.position.x - platform.x;
      const dz = projectile.position.z - platform.z;
      const top = platform.y + 0.055;
      const crossedTop = projectile.previous.y >= top && projectile.position.y <= top + 0.08;
      if (crossedTop && dx * dx + dz * dz <= (platform.radius - 0.08) ** 2) {
        floor = Math.max(floor, top);
      }
    }
    return floor;
  }

  recordRicochet(projectile, impact, normal) {
    projectile.banks += 1;
    projectile.bankCooldown = 0.055;
    projectile.wobble = 1;
    this.ricochetCount += 1;
    const color = projectile.color || (projectile.owner === 'player' ? COLORS.cyan : COLORS.coral);
    this.bursts.push(createParticleBurst(this.root, impact, color, 10, 0.065));
    this.shockwaves.push(createShockwave(this.root, impact, color, normal.y > 0.55, normal));
    this.world.audio?.tone({
      frequency: 380,
      endFrequency: 145,
      duration: 0.075,
      gain: 0.035,
      type: 'triangle',
    });
    if (projectile.owner === 'player') this.score += 12;
    if (this.isARPresentation) {
      this.spawnPersistentBreach(impact, normal, color);
      if (
        normal.z > 0.55 &&
        impact.z <= this.arRoom.minZ + 0.45 &&
        !projectile.crossedShell
      ) {
        projectile.crossedShell = true;
        this.fractureReality(impact);
      }
    }
  }

  applyProjectileRicochet(projectile, dt) {
    projectile.bankCooldown = Math.max(0, projectile.bankCooldown - dt);
    if (projectile.returning || projectile.bankCooldown > 0) return false;
    const bounds = this.arenaBounds;
    const position = projectile.position;
    const velocity = projectile.velocity;
    let normal = null;

    const floor = this.getProjectileFloorHeight(projectile) + 0.055;
    if (position.y < floor && velocity.y < 0) {
      position.y = floor;
      normal = new THREE.Vector3(0, 1, 0);
    } else if (position.y > bounds.ceilingY - 0.055 && velocity.y > 0) {
      position.y = bounds.ceilingY - 0.055;
      normal = new THREE.Vector3(0, -1, 0);
    } else if (this.isARPresentation && this.arRoom?.vertices?.length) {
      const collision = this.getPolygonBoundaryCollision(position, velocity, DISC_RADIUS);
      if (collision) {
        position.addScaledVector(collision.normal, collision.correction);
        normal = collision.normal;
      }
    } else if (position.x < bounds.minX + DISC_RADIUS && velocity.x < 0) {
      position.x = bounds.minX + DISC_RADIUS;
      normal = new THREE.Vector3(1, 0, 0);
    } else if (position.x > bounds.maxX - DISC_RADIUS && velocity.x > 0) {
      position.x = bounds.maxX - DISC_RADIUS;
      normal = new THREE.Vector3(-1, 0, 0);
    } else if (position.z < bounds.minZ + DISC_RADIUS && velocity.z < 0) {
      position.z = bounds.minZ + DISC_RADIUS;
      normal = new THREE.Vector3(0, 0, 1);
    } else if (position.z > bounds.maxZ - DISC_RADIUS && velocity.z > 0) {
      position.z = bounds.maxZ - DISC_RADIUS;
      normal = new THREE.Vector3(0, 0, -1);
    }
    if (!normal) return false;

    const approach = velocity.dot(normal);
    if (approach < 0) velocity.addScaledVector(normal, -2 * approach).multiplyScalar(0.94);
    this.recordRicochet(projectile, position.clone(), normal);
    if (projectile.banks > projectile.maxBanks) {
      if (projectile.owner === 'player') projectile.returning = true;
      else return true;
    }
    return false;
  }

  updateDiscAttitude(projectile, dt) {
    const horizontal = new THREE.Vector3(projectile.velocity.x, 0, projectile.velocity.z);
    const horizontalSpeed = Math.max(0.001, horizontal.length());
    horizontal.multiplyScalar(1 / horizontalSpeed);
    const normal = UP.clone().addScaledVector(
      horizontal,
      THREE.MathUtils.clamp(-projectile.velocity.y / horizontalSpeed, -0.24, 0.24),
    );
    const right = new THREE.Vector3(-horizontal.z, 0, horizontal.x);
    normal.addScaledVector(right, Math.sin(projectile.age * 38) * projectile.wobble * 0.11).normalize();
    const target = new THREE.Quaternion().setFromUnitVectors(UP, normal);
    projectile.mesh.quaternion.slerp(target, 1 - Math.exp(-18 * dt));
    if (projectile.mesh.userData.rotor) {
      projectile.mesh.userData.rotor.rotation.y += projectile.flightSpin * dt;
    }
    projectile.wobble = THREE.MathUtils.damp(projectile.wobble, 0, 7, dt);
  }

  updateBreaches(dt) {
    for (const breach of this.breaches) {
      breach.growth = Math.min(1, breach.growth + dt * 3.8);
      const eased = THREE.MathUtils.smoothstep(breach.growth, 0, 1) * (breach.targetScale || 1);
      breach.mesh.scale.setScalar(Math.max(0.04, eased));
      breach.mesh.userData.rim.rotation.z += dt * (breach.type === 'floor' ? 0.42 : -0.35);
      breach.mesh.userData.halo.material.opacity = THREE.MathUtils.damp(
        breach.mesh.userData.halo.material.opacity,
        0.34 + Math.sin(this.elapsed * 2.1 + breach.position.x) * 0.07,
        4,
        dt,
      );
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
      this.updateDiscAttitude(projectile, dt);
      if (this.applyProjectileRicochet(projectile, dt)) {
        this.removeProjectile(i);
        continue;
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
    this.updateBreaches(dt);
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
        banks: disc.banks,
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
      ricochets: this.ricochetCount,
      roomFootprint: this.arRoom
        ? {
            source: this.arRoom.source,
            presetFallback: this.roomPreset,
            width: +this.arRoom.width.toFixed(2),
            depth: +this.arRoom.depth.toFixed(2),
            area: +this.arRoom.area.toFixed(2),
            minX: +this.arRoom.minX.toFixed(2),
            maxX: +this.arRoom.maxX.toFixed(2),
            minZ: +this.arRoom.minZ.toFixed(2),
            maxZ: +this.arRoom.maxZ.toFixed(2),
            vertices: this.arRoom.vertices.map((vertex) => ({
              x: +vertex.x.toFixed(2),
              y: +vertex.y.toFixed(2),
              z: +vertex.z.toFixed(2),
            })),
          }
        : null,
      breaches: this.breaches.map((breach) => ({
        type: breach.type,
        x: +breach.position.x.toFixed(2),
        y: +breach.position.y.toFixed(2),
        z: +breach.position.z.toFixed(2),
        radius: +breach.radius.toFixed(2),
      })),
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
