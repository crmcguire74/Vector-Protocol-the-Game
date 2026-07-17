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
  seededRandom,
  updateBursts,
  updateDiscTrail,
  updateEnvironment,
  updateRealityBreach,
  updateShockwaves,
} from './Visuals.js';
import { createAnimatedSentinel, updateSentinelRig } from './SentinelAsset.js';
import { Store, RNG, clamp } from './store.js';

const UP = new THREE.Vector3(0, 1, 0);
const DISC_FORWARD = new THREE.Vector3(0, 0, 1);
const DISC_RADIUS = 0.36;
const CUSTOM_ROOM_STORAGE_KEY = 'vector-protocol.custom-room';
const ROOM_TRACE_GRIP_HOLD_SECONDS = 2.2;

// ─── Campaign: an authored ladder of three programs, best-of-3 per program,
// arenas that shrink and reconfigure each round. Ported behaviour from the
// preferred build (design/thresholds.md v5/v6), retuned for the first-person
// digital-cathedral scale of this renderer.
const PROGRAMS = ['BIT-3', 'VANTA', 'SENTINEL-9'];
const ARENAS = ['PROVING RING', 'SHARD SPIRE', 'CORE VAULT'];
const PIPS = 3; // integrity per combatant per round
const RING_R = [4.4, 3.8, 3.2]; // PROVING RING facing-disc radius by round (gap stays uncrossable)
const PAD_MUL = [1, 0.86, 0.73]; // per-round pad shrink for multi-pad arenas
const DISC_SPEED = 18; // player throw speed (frisbee)
const ENEMY_DISC_SPEED = [12.5, 14.5, 16.5]; // by program tier
const RETURN_T = 2.4; // seconds before a player disc auto-returns
const PLAYER_MAX_BANKS = 3;
const ENEMY_MAX_BANKS = 3;
// Per-program AI archetype. One state machine, distinct readable behaviour.
const AI = {
  windup: [0.9, 0.62, 0.5], // telegraph length — BIT-3 is slow & honest
  feint: [0, 0.35, 0.5], // chance to abort a windup as a feint
  guard: [0.1, 0.36, 0.6], // chance to reactively guard/deflect
  dodge: [0.2, 0.4, 0.55], // chance to side/jump dodge an incoming disc
  aimErr: [0.5, 0.34, 0.22], // aim spread (radians-ish) — tightens by tier
  bankP: [0.14, 0.33, 0.55], // chance to bank a throw off a wall
  cadence: [3.05, 2.55, 2.15], // base seconds between throw attempts
};

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
    this.obstacles = [];
    this.enemies = [];
    this.projectiles = [];
    this.telegraphs = [];
    this.bursts = [];
    this.shockwaves = [];
    this.arPanels = [];
    this.breaches = [];
    this.floorShards = [];
    this.fractureLevel = 0;

    // Campaign / match / round state machine.
    this.tier = clamp(Store.get('discWins') || 0, 0, PROGRAMS.length - 1); // program index, resumes from progress
    this.round = 1; // 1..3 within the current best-of-3
    this.pWins = 0;
    this.eWins = 0;
    this.playerPips = PIPS;
    this.matchState = 'intro'; // intro → fight → roundOver → reboot → advance/done
    this.stateTimer = 0;
    this.rng = new RNG(0x51ede7 ^ (this.tier * 2654435761)); // per-match deterministic decisions

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
    this.handSamples = [];
    this.xrHandDisc = null;
    this.roomTrace = { active: false, points: [], markers: null };
    this.traceKeyLatch = false;
    this.gripHoldTimer = 0;

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
    this.world.setPlayerPosition(this.player.position);
    this.world.setYaw(0);
    this.startMatch();
  }

  buildWorld() {
    // AR, including its desktop spatial preview, uses the player's room as the
    // environment. The digital cathedral is revealed only inside impact breaches.
    this.environment = createEnvironment({ ar: this.isARPresentation });
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
      // Prefer a room the player already traced or a previously captured
      // bounded floor over the preset boundaries. Live WebXR bounds that
      // arrive during the session still override this.
      if (this.applySavedCustomRoom()) {
        this.player.position.set(
          this.arRoom.centerX,
          this.arRoom.floorY,
          this.arRoom.maxZ - Math.min(0.7, this.arRoom.depth * 0.18),
        );
      } else {
        this.world.announce('PRESET ROOM ACTIVE // HOLD GRIP OR PRESS R TO TRACE YOUR ROOM', 3);
      }
    } else {
      this.arenaBounds = {
        minX: -14.5,
        maxX: 14.5,
        minZ: -20,
        maxZ: 16,
        floorY: -7.72,
        ceilingY: 10.5,
      };
      // Platforms are built per round by buildLayout(); the void death plane
      // sits well below them so falling between pads costs an integrity pip.
      this.voidDeathY = -3.2;

      const voidGrid = new THREE.GridHelper(96, 64, COLORS.violet, 0x10233b);
      voidGrid.position.y = -8;
      voidGrid.material.transparent = true;
      voidGrid.material.opacity = 0.24;
      this.root.add(voidGrid);
      this.voidGrid = voidGrid;

      this.driftColumns = [];
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
        this.driftColumns.push({
          mesh: column,
          baseY: column.position.y,
          phase: this.random() * Math.PI * 2,
          bobRate: 0.2 + this.random() * 0.3,
          bobHeight: 0.25 + this.random() * 0.45,
          spin: (this.random() - 0.5) * 0.08,
          pulseRate: 0.6 + this.random() * 1.2,
        });
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

  setBoundedFloorFootprint(footprint, source = 'webxr-bounded-floor') {
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
      source,
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
    this.arPanels.length = 0;
    this.buildARRoomShell();

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const safe = this.pickARRoamTarget(enemy, true);
      enemy.mesh.position.copy(safe);
      enemy.origin.copy(safe);
      enemy.navTarget.copy(safe);
    }
    this.world.announce(
      source === 'saved-custom-room' ? 'SAVED ROOM RESTORED' : 'BOUNDED PLAY SPACE LOCKED',
      1.35,
    );
    if (source !== 'saved-custom-room') this.saveCustomRoom(footprint, source);
    return true;
  }

  saveCustomRoom(footprint, source) {
    try {
      window.localStorage.setItem(
        CUSTOM_ROOM_STORAGE_KEY,
        JSON.stringify({ ...footprint, source, savedAt: Date.now() }),
      );
    } catch {
      // Storage may be unavailable (private mode); the room still applies live.
    }
  }

  loadCustomRoom() {
    try {
      const raw = window.localStorage.getItem(CUSTOM_ROOM_STORAGE_KEY);
      if (!raw) return null;
      const room = JSON.parse(raw);
      if (!room?.vertices?.length || room.vertices.length < 3) return null;
      return room;
    } catch {
      return null;
    }
  }

  // Restore a previously saved custom room instead of the preset boundaries.
  // A live WebXR bounded-floor arriving later still overrides it.
  applySavedCustomRoom() {
    if (!this.isARPresentation) return false;
    const saved = this.loadCustomRoom();
    if (!saved) return false;
    return this.setBoundedFloorFootprint(saved, 'saved-custom-room');
  }

  startRoomTrace() {
    if (!this.isARPresentation || this.roomTrace.active) return;
    this.roomTrace.active = true;
    this.roomTrace.points = [];
    if (this.roomTrace.markers) disposeObject(this.roomTrace.markers);
    this.roomTrace.markers = new THREE.Group();
    this.roomTrace.markers.name = 'room-trace-markers';
    this.root.add(this.roomTrace.markers);
    this.world.announce('ROOM TRACE // AIM AT EACH FLOOR CORNER + TRIGGER · GRIP OR R TO FINISH', 3.2);
  }

  addRoomTraceCorner(ray) {
    const localRay = this.localizeRay(ray);
    const floorY = this.arRoom?.floorY ?? 0;
    if (localRay.direction.y > -0.05) {
      this.world.announce('AIM AT THE FLOOR TO MARK A CORNER', 1.1);
      return;
    }
    const distance = (floorY - localRay.origin.y) / localRay.direction.y;
    if (!Number.isFinite(distance) || distance <= 0 || distance > 12) return;
    const point = localRay.origin.clone().addScaledVector(localRay.direction, distance);
    this.roomTrace.points.push({ x: point.x, y: floorY, z: point.z });
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.09, 0.6, 10),
      new THREE.MeshBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    marker.position.set(point.x, floorY + 0.3, point.z);
    this.roomTrace.markers.add(marker);
    if (this.roomTrace.points.length > 1) {
      const previous = this.roomTrace.points[this.roomTrace.points.length - 2];
      const edge = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(previous.x, floorY + 0.03, previous.z),
          new THREE.Vector3(point.x, floorY + 0.03, point.z),
        ]),
        new THREE.LineBasicMaterial({ color: COLORS.ice, transparent: true, opacity: 0.8, toneMapped: false }),
      );
      this.roomTrace.markers.add(edge);
    }
    this.world.announce(`CORNER ${this.roomTrace.points.length} SET`, 0.8);
  }

  finishRoomTrace(commit = true) {
    if (!this.roomTrace.active) return;
    const points = this.roomTrace.points;
    this.roomTrace.active = false;
    if (this.roomTrace.markers) {
      disposeObject(this.roomTrace.markers);
      this.roomTrace.markers = null;
    }
    if (!commit || points.length < 3) {
      this.world.announce(points.length && commit ? 'ROOM TRACE NEEDS 3+ CORNERS // CANCELLED' : 'ROOM TRACE CANCELLED', 1.4);
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let signedArea = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      signedArea += current.x * next.z - next.x * current.z;
      minX = Math.min(minX, current.x);
      maxX = Math.max(maxX, current.x);
      minZ = Math.min(minZ, current.z);
      maxZ = Math.max(maxZ, current.z);
    }
    signedArea *= 0.5;
    const footprint = {
      vertices: points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
      signedArea,
      area: Math.abs(signedArea),
      width: maxX - minX,
      depth: maxZ - minZ,
      centerX: (minX + maxX) * 0.5,
      centerZ: (minZ + maxZ) * 0.5,
      floorY: points[0].y,
      minX,
      maxX,
      minZ,
      maxZ,
    };
    if (!this.setBoundedFloorFootprint(footprint, 'player-traced-room')) {
      this.world.announce('TRACED ROOM TOO SMALL // MIN 1.5m x 1.5m', 1.6);
      return;
    }
    this.saveCustomRoom(footprint, 'player-traced-room');
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
            opacity: this.isARPresentation ? 0.055 : 0.94,
            emissive: (row + column) % 3 === 0 ? COLORS.violet : COLORS.cyan,
            emissiveIntensity: this.isARPresentation ? 0.16 : 0.05,
            depthWrite: false,
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
      new THREE.LineBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: this.isARPresentation ? 0.24 : 0.65,
        depthWrite: false,
      }),
    );
    frame.position.set(room.centerX, room.floorY + room.wallHeight * 0.5, config.z + 0.03);
    shell.add(frame);
    this.root.add(shell);
    this.arShell = shell;
  }

  // ─── Campaign / match / round machine ─────────────────────────────────

  startMatch() {
    this.pWins = 0;
    this.eWins = 0;
    this.round = 1;
    this.startRound();
  }

  // Per-program, per-round arena geometry. PROVING RING is one shrinking pad;
  // SHARD SPIRE breaks it into three pads with floating shards; CORE VAULT is a
  // five-pad cross around a central pylon. Gaps between pads are real falls.
  layoutFor(tier, round) {
    const mul = PAD_MUL[round - 1];
    // Discs of Tron rule: the player and the program stand on SEPARATE platforms
    // across a void gap wide enough that neither can cross to the other. The duel
    // is fought by throwing and banking discs across the gap.
    if (tier === 0) {
      // PROVING RING: two facing discs that shrink each round.
      const r = RING_R[round - 1];
      const playerPad = { x: 0, y: 0, z: 6, radius: r, accent: COLORS.cyan };
      const enemyPad = { x: 0, y: 0, z: -9, radius: r, accent: COLORS.orange };
      return {
        pads: [playerPad, enemyPad],
        obstacles: [],
        playerSpawn: { x: 0, y: 0, z: 6 },
        enemySpawn: { x: 0, y: 0, z: -9 },
        enemyPad,
      };
    }
    if (tier === 1) {
      // SHARD SPIRE: a player cluster (main + two side pads for lateral dodging)
      // faces a single raised program pad, with floating shards in the gap to bank.
      const r = 2.8 * mul;
      const enemyPad = { x: 0, y: 0.9, z: -9.5, radius: r, accent: COLORS.orange };
      return {
        pads: [
          { x: 0, y: 0, z: 6.5, radius: r, accent: COLORS.cyan },
          { x: -5.6, y: 0.4, z: 6.5, radius: r * 0.78, accent: COLORS.violet },
          { x: 5.6, y: 0.4, z: 6.5, radius: r * 0.78, accent: COLORS.violet },
          enemyPad,
        ],
        obstacles: [
          { type: 'shard', x: -3, y: 2.4, z: -1.5, radius: 0.85 },
          { type: 'shard', x: 3, y: 3.0, z: -1.5, radius: 0.85 },
        ],
        playerSpawn: { x: 0, y: 0, z: 6.5 },
        enemySpawn: { x: 0, y: 0.9, z: -9.5 },
        enemyPad,
      };
    }
    // CORE VAULT: player cluster with two elevated flank pads faces the program's
    // raised pad across a gap guarded by a central pylon to bank around.
    const r = 2.6 * mul;
    const enemyPad = { x: 0, y: 1.0, z: -9.5, radius: r, accent: COLORS.orange };
    return {
      pads: [
        { x: 0, y: 0, z: 6.5, radius: r, accent: COLORS.cyan },
        { x: -6.6, y: 0.6, z: 4, radius: r * 0.8, accent: COLORS.violet },
        { x: 6.6, y: 0.6, z: 4, radius: r * 0.8, accent: COLORS.violet },
        enemyPad,
      ],
      obstacles: [{ type: 'pylon', x: 0, y: 0, z: -1.5, radius: 0.7, height: 4.6 }],
      playerSpawn: { x: 0, y: 0, z: 6.5 },
      enemySpawn: { x: 0, y: 1.0, z: -9.5 },
      enemyPad,
    };
  }

  clearLayout() {
    for (const platform of this.platforms) if (platform.mesh) disposeObject(platform.mesh);
    this.platforms.length = 0;
    for (const obstacle of this.obstacles) if (obstacle.mesh) disposeObject(obstacle.mesh);
    this.obstacles.length = 0;
  }

  buildLayout(tier, round) {
    if (this.isARPresentation) return null; // AR uses the room footprint as the floor
    this.clearLayout();
    const layout = this.layoutFor(tier, round);
    layout.pads.forEach((pad, index) => {
      const mesh = createPlatform(pad.radius, pad.y, pad.accent, index * 29);
      mesh.position.x = pad.x;
      mesh.position.z = pad.z;
      this.root.add(mesh);
      this.platforms.push({ x: pad.x, y: pad.y, z: pad.z, radius: pad.radius, mesh });
    });
    for (const spec of layout.obstacles) {
      const mesh = spec.type === 'pylon'
        ? new THREE.Mesh(
            new THREE.CylinderGeometry(spec.radius, spec.radius * 1.15, spec.height, 12),
            new THREE.MeshStandardMaterial({ color: 0x06111c, emissive: COLORS.cyan, emissiveIntensity: 0.4, metalness: 0.85, roughness: 0.24 }),
          )
        : new THREE.Mesh(
            new THREE.OctahedronGeometry(spec.radius, 0),
            new THREE.MeshStandardMaterial({ color: 0x07101b, emissive: COLORS.amber, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.26 }),
          );
      mesh.position.set(spec.x, spec.y + (spec.type === 'pylon' ? spec.height * 0.5 : 0), spec.z);
      this.root.add(mesh);
      this.obstacles.push({ ...spec, mesh });
    }
    return layout;
  }

  startRound() {
    // Clear any live discs / telegraphs from the previous round.
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) this.removeProjectile(i);
    for (const telegraph of this.telegraphs) disposeObject(telegraph.line);
    this.telegraphs.length = 0;
    this.enemies.forEach((enemy) => this.removeEnemy(enemy));
    this.enemies.length = 0;

    this.playerPips = PIPS;
    this.player.health = 100;
    this.player.discs = 2;
    this.player.velocity.set(0, 0, 0);
    this.player.grounded = true;
    this.matchState = 'intro';
    this.stateTimer = 2.4;

    const layout = this.buildLayout(this.tier, this.round);
    if (layout && !this.isARPresentation) {
      this.player.position.set(layout.playerSpawn.x, layout.playerSpawn.y, layout.playerSpawn.z);
      this.playerSpawnPad = { ...layout.playerSpawn };
      this.spawnProgram(this.tier, new THREE.Vector3(layout.enemySpawn.x, layout.enemySpawn.y, layout.enemySpawn.z), layout.enemyPad);
    } else {
      // AR: place the program across the mapped room (roams via pickARRoamTarget).
      const room = this.arRoom;
      const spawn = room
        ? this.clampPointToRoom(room.centerX, room.minZ + room.depth * 0.28, 0.62)
        : new THREE.Vector2(0, -2);
      const y = room ? room.floorY : 0;
      this.spawnProgram(this.tier, new THREE.Vector3(spawn.x, y, spawn.y), null);
    }
    this.world.setPlayerPosition(this.player.position);

    const program = PROGRAMS[this.tier];
    const arena = ARENAS[this.tier];
    this.world.announce(`USER VS ${program}  ·  ${arena}  ·  ROUND ${this.round}/3`, 2.4);
  }

  roundOver(playerWon) {
    if (this.matchState === 'roundOver' || this.matchState === 'done') return;
    this.matchState = 'roundOver';
    this.stateTimer = playerWon ? 2.0 : 3.1;
    if (playerWon) {
      this.pWins += 1;
      const alive = this.enemies.find((enemy) => !enemy.dead);
      if (alive) this.damageEnemy(alive, alive.maxPips, alive.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)), true);
      this.score += 750;
      this.world.announce(`ROUND WON  ·  ${this.pWins}–${this.eWins}`, 2.0);
    } else {
      this.eWins += 1;
      this.world.announce(`ROUND LOST  ·  ${this.pWins}–${this.eWins}`, 2.4);
      this.world.pulseVignette();
    }
  }

  advanceCampaign() {
    if (this.pWins >= 2) {
      // Program defeated → persist progress and move up the ladder.
      Store.set('discWins', Math.max(Store.get('discWins') || 0, this.tier + 1));
      if (this.tier >= PROGRAMS.length - 1) {
        this.matchState = 'done';
        this.world.endGame(true, {
          title: 'MATCH COMPLETE // THE GRID RELEASES YOU',
          detail: `All programs decompiled · Signal ${this.score.toLocaleString()}`,
        });
        return;
      }
      this.tier += 1;
      this.rng = new RNG(0x51ede7 ^ (this.tier * 2654435761));
      this.pWins = 0;
      this.eWins = 0;
      this.round = 1;
      this.startRound();
      return;
    }
    if (this.eWins >= 2) {
      this.matchState = 'done';
      this.world.endGame(false, {
        title: 'SIGNAL SEVERED',
        detail: `${PROGRAMS[this.tier]} held the ring · Signal ${this.score.toLocaleString()}`,
      });
      return;
    }
    this.round += 1;
    this.startRound();
  }

  removeEnemy(enemy) {
    if (enemy.rig) {
      enemy.rig.mixer.stopAllAction();
      enemy.rig.mixer.uncacheRoot(enemy.rig.model);
    }
    if (enemy.mesh) disposeObject(enemy.mesh);
  }

  spawnProgram(tier, position, pad) {
    const color = tier === 2 ? COLORS.orange : tier === 1 ? COLORS.coral : COLORS.amber;
    const role = tier === 2 ? 'PRIME' : 'PROGRAM';
    const mesh = createHumanoid(color, role);
    mesh.position.copy(position);
    const scale = tier === 2 ? 1.14 : tier === 1 ? 1.06 : 1;
    mesh.scale.setScalar(scale);
    this.root.add(mesh);

    const pipRoot = new THREE.Group();
    pipRoot.position.set(0, tier === 2 ? 2.85 : 2.7, 0);
    const pipBack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.055),
      new THREE.MeshBasicMaterial({ color: 0x2a1403, transparent: true, opacity: 0.8, depthTest: false }),
    );
    const pipFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.035),
      new THREE.MeshBasicMaterial({ color, depthTest: false, toneMapped: false }),
    );
    pipFill.position.z = 0.002;
    pipRoot.add(pipBack, pipFill);
    mesh.add(pipRoot);

    // Transient guard buckler — raised only during a reactive guard.
    const guardMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 1.0, 10),
      new THREE.MeshBasicMaterial({
        color: COLORS.ice,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    guardMesh.position.set(0, 1.3, 0.72);
    guardMesh.visible = false;
    mesh.add(guardMesh);

    const enemy = {
      id: ++this.enemySerial,
      mesh,
      position: mesh.position,
      origin: position.clone(),
      tier,
      program: PROGRAMS[tier],
      role, // retained for rig tinting + facing behaviour
      color,
      pips: PIPS,
      maxPips: PIPS,
      health: PIPS,
      maxHealth: PIPS,
      cooldown: 1.5 + this.rng.range(0, 1.2),
      phase: this.rng.range(0, Math.PI * 2),
      healthRoot: pipRoot,
      healthFill: pipFill,
      guardMesh,
      barrier: null,
      hitFlash: 0,
      navTarget: position.clone(),
      relocateTimer: 0.35 + this.rng.range(0, 0.6),
      moveSpeed: tier === 2 ? 3.95 : tier === 1 ? 3.7 : 3.5,
      running: false,
      rig: null,
      dead: false,
      openingCooldown: 0,
      pad: pad || null,
      roamRadius: pad ? pad.radius - 1.0 : 1.4,
      guardActive: 0,
      dodgeCooldown: 0,
      feinting: false,
    };
    this.enemies.push(enemy);
    this.upgradeEnemyVisual(enemy);
    return enemy;
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
      enemy.guardMesh?.removeFromParent();
      rig.root.position.copy(position);
      rig.root.quaternion.copy(quaternion);
      rig.root.visible = visible;
      if (enemy.role === 'PRIME') rig.root.scale.setScalar(1.12);
      enemy.healthRoot.position.set(0, enemy.role === 'PRIME' ? 2.82 : 2.58, 0);
      rig.root.add(enemy.healthRoot);
      if (enemy.guardMesh) rig.root.add(enemy.guardMesh);
      this.root.add(rig.root);
      disposeObject(fallback);
      enemy.mesh = rig.root;
      enemy.position = rig.root.position;
      enemy.rig = rig;
    } catch (error) {
      console.warn('[Vector Protocol] Procedural Sentinel retained:', error.message);
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

  primaryStart(ray) {
    if (this.roomTrace.active) {
      this.addRoomTraceCorner(ray || this.world.getAimRay());
      return;
    }
    if (this.player.discs <= 0 || this.charging) return;
    this.charging = true;
    this.charge = 0;
    this.handSamples = [];
    const controller = this.world.activeThrowController;
    if (controller && this.world.renderer.xr.isPresenting) {
      if (!this.xrHandDisc) {
        this.xrHandDisc = createDisc(COLORS.cyan, false);
        this.xrHandDisc.name = 'xr-held-frisbee-disc';
        this.xrHandDisc.scale.setScalar(0.24);
      }
      this.xrHandDisc.position.set(0, -0.015, -0.085);
      this.xrHandDisc.rotation.set(-0.35, 0, 0);
      controller.add(this.xrHandDisc);
      this.xrHandDisc.visible = true;
    }
  }

  releaseHeldDisc() {
    if (this.xrHandDisc) {
      this.xrHandDisc.visible = false;
      this.xrHandDisc.removeFromParent();
    }
    this.handSamples = [];
  }

  // Derive a frisbee release from the controller's recent world motion.
  // Returns { direction, speed, origin } in arena-local space, or null when
  // the hand was too slow for a deliberate throw (caller falls back to aim).
  computeHandThrow() {
    const samples = this.handSamples;
    if (!samples || samples.length < 2) return null;
    const latest = samples[samples.length - 1];
    let oldest = samples[0];
    for (const sample of samples) {
      if (latest.t - sample.t <= 0.13) {
        oldest = sample;
        break;
      }
    }
    const span = latest.t - oldest.t;
    if (span < 0.03) return null;
    this.root.updateWorldMatrix(true, false);
    const from = this.root.worldToLocal(oldest.position.clone());
    const to = this.root.worldToLocal(latest.position.clone());
    const velocity = to.clone().sub(from).divideScalar(span);
    const speed = velocity.length();
    if (speed < 1.3) return null;
    return { direction: velocity.normalize(), speed, origin: to };
  }

  primaryEnd(ray) {
    if (!this.charging) return;
    const handThrow = this.computeHandThrow();
    this.throwDisc(ray || this.world.getAimRay(), handThrow);
    this.charging = false;
    this.releaseHeldDisc();
  }

  localizeRay(ray) {
    this.root.updateWorldMatrix(true, false);
    const worldEnd = ray.origin.clone().add(ray.direction);
    const origin = this.root.worldToLocal(ray.origin.clone());
    const end = this.root.worldToLocal(worldEnd);
    return { origin, direction: end.sub(origin).normalize() };
  }

  setShield(active) {
    if (this.roomTrace.active && active) {
      this.finishRoomTrace(true);
      return;
    }
    this.shielding = active;
  }

  cancelInput() {
    this.charging = false;
    this.charge = 0;
    this.shielding = false;
    this.releaseHeldDisc();
  }

  throwDisc(ray, handThrow = null) {
    if (this.player.discs <= 0) return;
    const localRay = this.localizeRay(ray);
    let origin;
    let speed;
    if (handThrow) {
      // Frisbee release: the disc leaves the hand along the swing, gently
      // blended toward where the controller points and flattened so it
      // flies like a disc instead of a lob.
      const direction = handThrow.direction
        .clone()
        .multiplyScalar(0.72)
        .addScaledVector(localRay.direction, 0.28);
      direction.y = THREE.MathUtils.clamp(direction.y, -0.3, 0.35);
      direction.normalize();
      localRay.direction.copy(direction);
      origin = handThrow.origin.clone().addScaledVector(direction, 0.35);
      speed = THREE.MathUtils.clamp(handThrow.speed * 2.1, 13, 30);
      this.charge = THREE.MathUtils.clamp((speed - 13) / 17, 0, 1);
    } else {
      origin = localRay.origin.clone().addScaledVector(localRay.direction, 0.5);
      speed = DISC_SPEED - 3 + Math.min(1, this.charge) * 7;
    }
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
      maxBanks: PLAYER_MAX_BANKS,
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
    if (type === 'floor') this.spawnFloorShatter(position);
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
      this.damagePlayer(1);
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
    this.damageEnemy(enemy, 1, impact);
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
    // Higher-tier programs bank throws off the walls to beat a static guard.
    if (this.arenaBounds && this.rng.chance(AI.bankP[enemy.tier])) {
      const wallX = this.rng.chance(0.5) ? this.arenaBounds.minX : this.arenaBounds.maxX;
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
      velocity: direction.multiplyScalar(ENEMY_DISC_SPEED[enemy.tier]),
      age: 0,
      returning: false,
      damage: 1,
      hitIds: new Set(),
      returnToAmmo: false,
      trail,
      color: enemy.color,
      banks: 0,
      maxBanks: ENEMY_MAX_BANKS,
      bankCooldown: 0,
      wobble: 0,
      flightSpin: 25 + this.random() * 7,
    });
  }

  startTelegraph(enemy, targetOverride = null, feint = false) {
    const start = this.getEnemyThrowOrigin(enemy);
    const target = (targetOverride || this.getPlayerCenter()).clone();
    // Aim spread tightens up the ladder; BIT-3 is loose, SENTINEL-9 is precise.
    const err = AI.aimErr[enemy.tier];
    target.x += this.rng.spread(err);
    target.z += this.rng.spread(err * 0.6);
    const geometry = new THREE.BufferGeometry().setFromPoints([start, target]);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: feint ? COLORS.ice : enemy.color,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.root.add(line);
    const duration = AI.windup[enemy.tier] * this.rng.range(0.85, 1.2);
    this.telegraphs.push({ enemy, target, line, life: duration, maxLife: duration, feint });
    enemy.feinting = feint;
  }

  // Integrity is measured in pips, not a health bar: three hits ends a round.
  damageEnemy(enemy, pipCost = 1, impact, finisher = false) {
    if (enemy.dead) return;
    enemy.pips = Math.max(0, enemy.pips - pipCost);
    enemy.health = enemy.pips;
    enemy.hitFlash = 0.3;
    enemy.healthFill.scale.x = Math.max(0.001, enemy.pips / enemy.maxPips);
    enemy.healthFill.position.x = -0.43 * (1 - enemy.pips / enemy.maxPips);
    this.bursts.push(createParticleBurst(this.root, impact, enemy.color, finisher ? 40 : 14, finisher ? 0.16 : 0.09));
    this.shockwaves.push(createShockwave(this.root, impact, enemy.color));
    if (enemy.mesh.userData.torso) enemy.mesh.userData.torso.material.emissiveIntensity = 1.8;
    if (!finisher) {
      this.combo += 1;
      this.comboTimer = 3.2;
      this.score += 120 * Math.max(1, Math.round(this.combo * 0.4));
    }
    if (enemy.pips <= 0) {
      enemy.dead = true;
      enemy.mesh.visible = false;
      const center = enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      this.bursts.push(createParticleBurst(this.root, center, enemy.color, 46, 0.16));
      if (!finisher) {
        this.score += 500;
        this.world.announce(`${enemy.program} DECOMPILED`, 1.2);
        this.roundOver(true);
      }
    }
  }

  damagePlayer(pipCost = 1) {
    if (this.player.invulnerable > 0 || this.matchState !== 'fight') return;
    this.playerPips = Math.max(0, this.playerPips - pipCost);
    this.player.health = Math.round((this.playerPips / PIPS) * 100);
    this.player.invulnerable = 0.6;
    this.combo = 0;
    this.comboTimer = 0;
    this.world.damageFeedback(40);
    this.shockwaves.push(createShockwave(this.root, this.getPlayerCenter(), COLORS.coral));
    if (this.playerPips <= 0) this.roundOver(false);
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

    const fallLimit = this.isARPresentation ? -2.8 : (this.voidDeathY ?? -3.2);
    if (player.position.y < fallLimit) {
      const openingAlreadyCharged =
        this.isARPresentation && this.playerOpeningLatched && this.openingCooldown > 0;
      if (!openingAlreadyCharged) this.damagePlayer(1);
      if (this.isARPresentation && this.arRoom) {
        player.position.set(
          this.arRoom.centerX,
          this.arRoom.floorY,
          this.arRoom.maxZ - Math.min(0.7, this.arRoom.depth * 0.18),
        );
        this.playerOpeningLatched = true;
        this.openingCooldown = 1.2;
      } else {
        const pad = this.playerSpawnPad || { x: 0, y: 0, z: 6 };
        player.position.set(pad.x, pad.y, pad.z);
      }
      player.velocity.set(0, 0, 0);
      player.grounded = true;
      this.world.announce('VOID FALL // ONE LIFE LOST', 1.2);
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
      enemy.phase += dt * 1.25;
      enemy.guardActive = Math.max(0, enemy.guardActive - dt);
      enemy.dodgeCooldown = Math.max(0, enemy.dodgeCooldown - dt);
      this.reactToIncoming(enemy);
      if (enemy.guardMesh) {
        enemy.guardMesh.visible = enemy.guardActive > 0;
        enemy.guardMesh.material.opacity = Math.min(0.62, enemy.guardActive * 1.4);
        enemy.guardMesh.rotation.z += dt * 4;
      }
      const activeTelegraph = this.telegraphs.find((telegraph) => telegraph.enemy === enemy);
      const attacking = Boolean(activeTelegraph);
      enemy.relocateTimer -= dt;
      if (enemy.relocateTimer <= 0 && !attacking) {
        if (this.isARPresentation && this.arRoom) {
          enemy.navTarget.copy(this.pickARRoamTarget(enemy));
        } else {
          const pad = enemy.pad;
          const angle = this.random() * Math.PI * 2;
          const radius = enemy.roamRadius * (0.2 + this.random() * 0.7);
          const cx = pad ? pad.x : enemy.origin.x;
          const cz = pad ? pad.z : enemy.origin.z;
          enemy.navTarget.set(
            cx + Math.cos(angle) * radius,
            pad ? pad.y : enemy.origin.y,
            cz + Math.sin(angle) * radius,
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
        const margin = 0.62;
        const safe = this.clampPointToRoom(enemy.mesh.position.x, enemy.mesh.position.z, margin);
        enemy.mesh.position.x = safe.x;
        enemy.mesh.position.z = safe.y;
        this.handleEnemyOpening(enemy);
        if (enemy.dead) continue;
      } else if (enemy.pad) {
        // Keep the program on its pad so it never wanders into the void.
        const pad = enemy.pad;
        const dx = enemy.mesh.position.x - pad.x;
        const dz = enemy.mesh.position.z - pad.z;
        const dist = Math.hypot(dx, dz);
        const maxR = pad.radius - 0.6;
        if (dist > maxR) {
          enemy.mesh.position.x = pad.x + (dx / dist) * maxR;
          enemy.mesh.position.z = pad.z + (dz / dist) * maxR;
        }
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
      const canThrow = enemy.cooldown <= 0 && this.matchState === 'fight' && this.world.phase === 'running' && !attacking;
      if (canThrow) {
        const feint = this.rng.chance(AI.feint[enemy.tier]);
        this.startTelegraph(enemy, null, feint);
        // SENTINEL-9 chains a second real throw to punish a committed dodge.
        if (enemy.tier === 2 && !feint && this.rng.chance(0.45)) {
          const alternateTarget = this.getPlayerCenter().add(new THREE.Vector3(1.4, 0.35, 0));
          this.startTelegraph(enemy, alternateTarget, false);
        }
        enemy.cooldown = AI.cadence[enemy.tier] * this.rng.range(0.8, 1.3);
      }
    }
  }

  // Reactive read of the closest incoming player disc: dodge or raise a guard,
  // once per disc. Higher tiers read and counter more often.
  reactToIncoming(enemy) {
    if (this.matchState !== 'fight') return;
    const center = enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    let closest = null;
    let closestDist = Infinity;
    for (const projectile of this.projectiles) {
      if (projectile.owner !== 'player' || projectile.returning) continue;
      const distance = projectile.position.distanceTo(center);
      if (distance > 6.5) continue;
      const toEnemy = center.clone().sub(projectile.position);
      if (projectile.velocity.dot(toEnemy) <= 0) continue; // not closing
      if (distance < closestDist) {
        closestDist = distance;
        closest = projectile;
      }
    }
    if (!closest || enemy.reactedTo === closest.id) return;
    enemy.reactedTo = closest.id;
    if (enemy.dodgeCooldown <= 0 && this.rng.chance(AI.dodge[enemy.tier])) {
      const side = this.rng.chance(0.5) ? 1 : -1;
      const lateral = new THREE.Vector3(Math.cos(enemy.mesh.rotation.y), 0, -Math.sin(enemy.mesh.rotation.y))
        .multiplyScalar(side * 1.7);
      const target = enemy.origin.clone().add(lateral);
      if (this.isARPresentation && this.arRoom) {
        const safe = this.clampPointToRoom(target.x, target.z, 0.5);
        enemy.navTarget.set(safe.x, enemy.origin.y, safe.y);
      } else {
        enemy.navTarget.copy(target);
      }
      enemy.relocateTimer = 0.6;
      enemy.dodgeCooldown = 1.5;
    } else if (this.rng.chance(AI.guard[enemy.tier])) {
      enemy.guardActive = 0.6;
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
      // A feint aborts partway through to bait a premature guard, then follows up fast.
      if (telegraph.feint && telegraph.life <= telegraph.maxLife * 0.5) {
        telegraph.enemy.feinting = false;
        telegraph.enemy.cooldown = 0.35 + this.rng.range(0, 0.45);
        disposeObject(telegraph.line);
        this.telegraphs.splice(i, 1);
        continue;
      }
      if (telegraph.life <= 0) {
        this.spawnEnemyDisc(telegraph.enemy, telegraph.target);
        telegraph.enemy.feinting = false;
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
      // The headline AR beat: a disc striking a real wall also cracks the floor
      // beneath it, which breaks apart to reveal the digital world below.
      if (normal.y < 0.5 && this.arRoom) {
        // Offset inward from the wall so the floor crack lands inside the room.
        const floorPoint = new THREE.Vector3(impact.x, this.arRoom.floorY, impact.z).addScaledVector(normal, 0.5);
        floorPoint.y = this.arRoom.floorY;
        if (this.roomContainsPoint(floorPoint.x, floorPoint.z, 0.05)) {
          this.spawnPersistentBreach(floorPoint, UP.clone(), color);
        }
      }
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

  // Floor "breaks apart": dark shards with neon edges pop up, tumble, and fade,
  // exposing the neon tunnel of the digital world beneath the real floor.
  spawnFloorShatter(position) {
    const floorY = this.arRoom?.floorY ?? 0;
    for (let index = 0; index < 9; index += 1) {
      const size = 0.13 + this.random() * 0.16;
      const shard = new THREE.Mesh(
        new THREE.TetrahedronGeometry(size, 0),
        new THREE.MeshStandardMaterial({
          color: 0x04080d,
          emissive: COLORS.cyan,
          emissiveIntensity: 0.5,
          metalness: 0.7,
          roughness: 0.3,
          transparent: true,
          opacity: 1,
        }),
      );
      const angle = this.random() * Math.PI * 2;
      const distance = this.random() * 0.5;
      shard.position.set(
        position.x + Math.cos(angle) * distance,
        floorY + 0.02,
        position.z + Math.sin(angle) * distance,
      );
      this.root.add(shard);
      this.floorShards.push({
        mesh: shard,
        vx: Math.cos(angle) * (0.4 + this.random() * 0.7),
        vz: Math.sin(angle) * (0.4 + this.random() * 0.7),
        vy: 1.2 + this.random() * 1.8,
        spin: new THREE.Vector3((this.random() - 0.5) * 8, (this.random() - 0.5) * 8, (this.random() - 0.5) * 8),
        life: 1.6,
      });
    }
  }

  updateFloorShards(dt) {
    const floorY = this.arRoom?.floorY ?? 0;
    for (let index = this.floorShards.length - 1; index >= 0; index -= 1) {
      const shard = this.floorShards[index];
      shard.life -= dt;
      shard.vy -= 6 * dt;
      shard.mesh.position.x += shard.vx * dt;
      shard.mesh.position.z += shard.vz * dt;
      shard.mesh.position.y += shard.vy * dt;
      if (shard.mesh.position.y < floorY + 0.02) {
        shard.mesh.position.y = floorY + 0.02;
        shard.vy *= -0.3;
      }
      shard.mesh.rotation.x += shard.spin.x * dt;
      shard.mesh.rotation.y += shard.spin.y * dt;
      shard.mesh.rotation.z += shard.spin.z * dt;
      if (shard.life <= 0.5) shard.mesh.material.opacity = Math.max(0, shard.life / 0.5);
      if (shard.life <= 0) {
        disposeObject(shard.mesh);
        this.floorShards.splice(index, 1);
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

    // Bank off arena obstacles — floating shards (spheres) and the central
    // pylon (vertical cylinder). This is the banked-shot skill layer.
    if (!normal && this.obstacles.length) {
      for (const obstacle of this.obstacles) {
        if (obstacle.type === 'pylon') {
          const dx = position.x - obstacle.x;
          const dz = position.z - obstacle.z;
          const distanceSq = dx * dx + dz * dz;
          const reach = obstacle.radius + DISC_RADIUS;
          const withinHeight = position.y > obstacle.y - 0.2 && position.y < obstacle.y + obstacle.height + 0.2;
          if (withinHeight && distanceSq < reach * reach && distanceSq > 1e-4) {
            const inverse = 1 / Math.sqrt(distanceSq);
            const obstacleNormal = new THREE.Vector3(dx * inverse, 0, dz * inverse);
            if (velocity.dot(obstacleNormal) < 0) {
              position.x = obstacle.x + obstacleNormal.x * reach;
              position.z = obstacle.z + obstacleNormal.z * reach;
              normal = obstacleNormal;
              break;
            }
          }
        } else {
          const center = new THREE.Vector3(obstacle.x, obstacle.y, obstacle.z);
          const delta = position.clone().sub(center);
          const reach = obstacle.radius + DISC_RADIUS;
          if (delta.lengthSq() < reach * reach && delta.lengthSq() > 1e-4) {
            const obstacleNormal = delta.normalize();
            if (velocity.dot(obstacleNormal) < 0) {
              position.copy(center).addScaledVector(obstacleNormal, reach);
              normal = obstacleNormal;
              break;
            }
          }
        }
      }
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
      updateRealityBreach(breach.mesh, this.elapsed, dt, breach.type);
    }
  }

  updateProjectiles(dt) {
    const playerCenter = this.getPlayerCenter();
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];
      projectile.previous.copy(projectile.position);
      projectile.age += dt;
      if (projectile.owner === 'player' && (projectile.age > RETURN_T || projectile.returning)) {
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
          const hitR = enemy.tier === 2 ? 1.5 : 1.1;
          if (projectile.position.distanceToSquared(enemyCenter) < hitR * hitR) {
            projectile.hitIds.add(enemy.id);
            // Reactive guard beats a straight shot; bank around it instead.
            if (enemy.guardActive > 0 && !projectile.returning) {
              projectile.returning = true;
              enemy.guardActive = Math.max(enemy.guardActive, 0.2);
              this.bursts.push(createParticleBurst(this.root, projectile.position.clone(), COLORS.ice, 12, 0.09));
              this.shockwaves.push(createShockwave(this.root, projectile.position.clone(), COLORS.ice));
              this.world.announce(`${enemy.program} GUARD // BANK IT`, 0.8);
              break;
            }
            // A hit that also knocks a program through a floor breach costs two.
            const pipCost = this.isARPresentation && this.isFloorOpening(enemy.mesh.position.x, enemy.mesh.position.z) ? 2 : 1;
            this.damageEnemy(enemy, pipCost, projectile.position.clone());
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
        this.damagePlayer(this.isARPresentation && this.getOpeningAtPoint(playerCenter, true) ? 2 : 1);
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
    if (this.isARPresentation) {
      // R toggles room tracing (desktop AR preview); toggling off commits.
      const traceKey = this.world.input.isDown('KeyR');
      if (traceKey && !this.traceKeyLatch) {
        if (this.roomTrace.active) this.finishRoomTrace(true);
        else this.startRoomTrace();
      }
      this.traceKeyLatch = traceKey;
      // In-headset entry: hold grip while the preset room is active.
      const presetRoom = !this.arRoom?.vertices?.length;
      if (this.shielding && presetRoom && !this.roomTrace.active) {
        this.gripHoldTimer += dt;
        if (this.gripHoldTimer >= ROOM_TRACE_GRIP_HOLD_SECONDS) {
          this.gripHoldTimer = 0;
          this.shielding = false;
          this.startRoomTrace();
        }
      } else if (!this.shielding) {
        this.gripHoldTimer = 0;
      }
    }
    if (this.charging) this.charge = Math.min(1, this.charge + dt * 1.1);
    if (this.charging && this.world.activeThrowController && this.world.renderer.xr.isPresenting) {
      const position = new THREE.Vector3();
      this.world.activeThrowController.getWorldPosition(position);
      this.handSamples.push({ position, t: this.elapsed });
      while (this.handSamples.length > 12) this.handSamples.shift();
    }
    if (this.xrHandDisc?.visible) {
      this.xrHandDisc.rotation.z += dt * 6;
    }
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

    // Campaign state machine: brief intro before the fight, then a pause on the
    // round result before the next round / program / match resolution.
    if (this.matchState === 'intro') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.matchState = 'fight';
    } else if (this.matchState === 'roundOver') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.advanceCampaign();
    }

    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updateTelegraphs(dt);
    this.updateProjectiles(dt);
    this.updateBreaches(dt);
    this.updateFloorShards(dt);
    updateBursts(this.bursts, dt);
    updateShockwaves(this.shockwaves, dt, this.world.camera);
    updateEnvironment(this.environment, this.elapsed, dt);
    if (this.voidGrid) {
      this.voidGrid.material.opacity = 0.22 + Math.sin(this.elapsed * 0.7) * 0.05;
    }
    if (this.driftColumns) {
      for (const column of this.driftColumns) {
        column.mesh.position.y =
          column.baseY + Math.sin(this.elapsed * column.bobRate + column.phase) * column.bobHeight;
        column.mesh.rotation.y += column.spin * dt;
        column.mesh.material.emissiveIntensity =
          0.2 + Math.max(0, Math.sin(this.elapsed * column.pulseRate + column.phase)) * 0.16;
      }
    }
    this.platforms.forEach((platform, index) => {
      const rim = platform.mesh.userData.rim;
      const innerRim = platform.mesh.userData.innerRim;
      if (rim) rim.rotation.z += dt * (index % 2 ? -0.05 : 0.04);
      if (innerRim) {
        innerRim.rotation.z -= dt * 0.11;
        innerRim.material.opacity = 0.35 + Math.sin(this.elapsed * 1.8 + index) * 0.18;
      }
    });

    const program = PROGRAMS[this.tier];
    const arena = ARENAS[this.tier];
    const pips = '◆'.repeat(this.playerPips) + '◇'.repeat(PIPS - this.playerPips);
    const objective =
      this.matchState === 'intro'
        ? `ROUND ${this.round}/3 // READY`
        : this.matchState === 'roundOver'
          ? this.pWins > this.eWins ? 'ROUND WON' : 'ROUND LOST'
          : `ROUND ${this.round}/3 · ${pips} · MATCH ${this.pWins}–${this.eWins}`;
    this.world.updateHUD({
      mode: `${program} · ${arena}`,
      score: this.score,
      health: Math.round((this.playerPips / PIPS) * 100),
      resource: this.player.shield,
      resourceLabel: this.charging
        ? `CHARGE ${Math.round(this.charge * 100)}%`
        : `GUARD ${Math.round(this.player.shield)}% · ${this.player.discs}/2 DISCS`,
      objective,
      combo: this.combo > 1 ? `x${this.combo} CHAIN` : '',
      speed: '',
    });
  }

  getState() {
    this.root.updateWorldMatrix(true, false);
    const rootWorldUp = UP.clone()
      .applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const activeEnemyUprightDots = this.enemies
      .filter((enemy) => !enemy.dead)
      .map((enemy) => UP.clone()
        .applyQuaternion(enemy.mesh.getWorldQuaternion(new THREE.Quaternion()))
        .normalize()
        .dot(UP));
    return {
      mode: 'disc_arena',
      spatialEnvironment: this.isARPresentation
        ? (this.world.presentation === 'ar' ? 'live_room_passthrough' : 'room_scale_preview_no_imported_arena')
        : 'digital_cathedral_platform_arena',
      coordinateSystem: this.isARPresentation
        ? 'meters in the mapped room footprint; +x right, +y up, -z forward from placement pose'
        : 'meters; origin at first platform centerline, +x right, +y up, -z forward from initial view',
      actorOrientation: {
        frameWorldUp: {
          x: +rootWorldUp.x.toFixed(3),
          y: +rootWorldUp.y.toFixed(3),
          z: +rootWorldUp.z.toFixed(3),
        },
        frameUprightDot: +rootWorldUp.dot(UP).toFixed(3),
        enemyMinUprightDot: activeEnemyUprightDots.length
          ? +Math.min(...activeEnemyUprightDots).toFixed(3)
          : null,
      },
      campaign: {
        program: PROGRAMS[this.tier],
        arena: ARENAS[this.tier],
        tier: this.tier,
        round: this.round,
        state: this.matchState,
        pWins: this.pWins,
        eWins: this.eWins,
        playerPips: this.playerPips,
      },
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
          program: enemy.program,
          role: enemy.role,
          x: +enemy.mesh.position.x.toFixed(1),
          y: +enemy.mesh.position.y.toFixed(1),
          z: +enemy.mesh.position.z.toFixed(1),
          pips: enemy.pips,
          guarding: enemy.guardActive > 0,
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
        visual: 'opaque_edge_layered_3d_neon_tunnel',
        tunnelDepth: +breach.mesh.userData.tunnelDepth.toFixed(2),
        depthMotion: Boolean(breach.mesh.userData.depthMotion),
        motionPhase: +(breach.mesh.userData.motionPhase || 0).toFixed(3),
        movingRings: breach.mesh.userData.tunnelRings?.length || 0,
        latticeAxis: 'local-z',
      })),
      breachRendering: {
        opening: 'opaque_edge_layered_3d_neon_tunnel',
        movingDepthLayers: true,
        staticPlaneFallback: false,
        persistsAfterShellPanelBreak: true,
      },
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
    if (this.xrHandDisc) {
      this.xrHandDisc.removeFromParent();
      disposeObject(this.xrHandDisc);
    }
    if (this.roomTrace.markers) disposeObject(this.roomTrace.markers);
    disposeObject(this.root);
  }
}
