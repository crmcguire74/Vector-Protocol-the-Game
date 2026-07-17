import * as THREE from 'three';
import {
  COLORS,
  createBike,
  createEnvironment,
  createGlow,
  createHumanoid,
  createParticleBurst,
  createShockwave,
  createTrailSegment,
  disposeObject,
  seededRandom,
  updateBursts,
  updateEnvironment,
  updateShockwaves,
} from './Visuals.js';
import { Store, clamp } from './store.js';

// Three speed tiers, best-of-3 per tier, cleared tiers persist to the Store.
const CYCLE_TIERS = 3;
const TIER_SPEED = [
  { cruise: 7.7, boost: 11.2, brake: 4.9, ai: 6.6 },
  { cruise: 9.0, boost: 12.8, brake: 5.6, ai: 7.9 },
  { cruise: 10.4, boost: 14.6, brake: 6.4, ai: 9.2 },
];
const TIER_AGGRESSION = [0.008, 0.02, 0.04]; // per-decision cut-off chance
const CYCLE_COUNTDOWN_SECONDS = 3;

const DIRECTIONS = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

const RIDER_COLORS = [COLORS.cyan, COLORS.coral, COLORS.amber, COLORS.violet];
const ANALOG_MAX_TURN_RATE = 2.6; // rad/s at full lean or stick deflection
const ARENA_HALF_METERS = 82;
const AGGRESSION_GRACE_SECONDS = 8;
const EMERGENCY_STOPS_PER_ROUND = 3;
const EMERGENCY_STOP_SECONDS = 1.05;
const DASHBOARD_STORAGE_KEY = 'vector-protocol:lightcar-dashboard-height';
const LEGACY_DASHBOARD_STORAGE_KEY = 'digi-world:lightline-dashboard-height';
const DASHBOARD_MIN = -0.28;
const DASHBOARD_MAX = 0.38;
const HEAD_LEAN_ENTER_METERS = 0.065;
const HEAD_LEAN_EXIT_METERS = 0.035;
const CONTROLLER_LEAN_ENTER_METERS = 0.055;
const CONTROLLER_LEAN_EXIT_METERS = 0.03;
const STEERING_INTENT_SECONDS = 0.1;
const ANALOG_REARM_SECONDS = 0.12;

function applyDeadzone(value, threshold = 0.16) {
  const magnitude = Math.abs(value || 0);
  if (magnitude <= threshold) return 0;
  return Math.sign(value) * ((magnitude - threshold) / (1 - threshold));
}

function loadDashboardHeight() {
  try {
    const stored = window.localStorage.getItem(DASHBOARD_STORAGE_KEY)
      ?? window.localStorage.getItem(LEGACY_DASHBOARD_STORAGE_KEY);
    const value = Number.parseFloat(stored);
    if (!Number.isFinite(value)) return 0;
    const height = THREE.MathUtils.clamp(value, DASHBOARD_MIN, DASHBOARD_MAX);
    window.localStorage.setItem(DASHBOARD_STORAGE_KEY, height.toFixed(4));
    return height;
  } catch {
    return 0;
  }
}

function createRivalMarker(role, color, registerTexture) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 112;
  const context = canvas.getContext('2d');
  const cssColor = `#${new THREE.Color(color).getHexString()}`;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = cssColor;
  context.lineWidth = 7;
  context.shadowColor = cssColor;
  context.shadowBlur = 12;
  context.beginPath();
  context.moveTo(14, 56);
  context.lineTo(48, 18);
  context.lineTo(88, 18);
  context.moveTo(14, 56);
  context.lineTo(48, 94);
  context.lineTo(88, 94);
  context.moveTo(370, 56);
  context.lineTo(336, 18);
  context.lineTo(296, 18);
  context.moveTo(370, 56);
  context.lineTo(336, 94);
  context.lineTo(296, 94);
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = '#eaffff';
  context.font = '700 28px monospace';
  context.textAlign = 'center';
  context.fillText(role, 192, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  registerTexture(texture);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.86,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sprite.name = `rival-marker-${role.toLowerCase()}`;
  sprite.position.set(0, 2.35, 0);
  sprite.scale.set(4.8, 1.4, 1);
  sprite.renderOrder = 40;
  return sprite;
}

function saveDashboardHeight(value) {
  try {
    window.localStorage.setItem(DASHBOARD_STORAGE_KEY, value.toFixed(4));
  } catch {
    // Persistence is an enhancement; restricted storage must not stop play.
  }
}

export class BikeMode {
  constructor(world) {
    this.world = world;
    this.name = 'bike';
    this.isTabletopAR = this.world.presentation === 'ar';
    this.root = new THREE.Group();
    this.root.name = 'lightline-pursuit-mode';
    this.world.scene.add(this.root);
    this.random = seededRandom(8484);
    this.cellSize = 1.22;
    this.bounds = Math.round(ARENA_HALF_METERS / this.cellSize);
    this.originalBounds = this.bounds;
    this.occupancy = new Map();
    this.trails = [];
    this.trailSerial = 0;
    this.debris = [];
    this.crashFlashes = [];
    this.riders = [];
    this.bursts = [];
    this.shockwaves = [];
    this.elapsed = 0;
    this.score = 0;
    this.kills = 0;

    // Campaign: tier (persisted), best-of-3 rounds, and a countdown/run/result
    // state machine mirroring the disc campaign.
    this.tier = clamp(Store.get('cycleTier') || 0, 0, CYCLE_TIERS - 1);
    this.round = 1;
    this.pWins = 0;
    this.eWins = 0;
    this.cycleState = 'intro';
    this.stateTimer = CYCLE_COUNTDOWN_SECONDS;
    this.tierSpeed = TIER_SPEED[this.tier];

    this.turnCooldown = 0;
    this.pulseCooldown = 0;
    this.roundElapsed = 0;
    this.aggressionGraceDuration = AGGRESSION_GRACE_SECONDS;
    this.aggressionGraceRemaining = AGGRESSION_GRACE_SECONDS;
    this.emergencyStopsRemaining = EMERGENCY_STOPS_PER_ROUND;
    this.emergencyStopTimer = 0;
    this.emergencyStopCooldown = 0;
    this.dashboardHeight = loadDashboardHeight();
    this.dashboardAdjustInput = 0;
    this.steeringInput = 0;
    this.steeringSource = 'neutral';
    this.steerCharge = 0;
    this.steerCooldown = 0;
    this.headLean = 0;
    this.controllerLean = 0;
    this.leanCenterX = null;
    this.controllerLeanCenter = null;
    this.leanCalibrated = false;
    this.headOffsetMeters = 0;
    this.controllerOffsetMeters = 0;
    this.smoothedHeadOffset = 0;
    this.smoothedControllerOffset = 0;
    this.headLeanActive = false;
    this.controllerLeanActive = false;
    this.steeringIntentDirection = 0;
    this.steeringIntentTime = 0;
    this.steeringNeutral = true;
    this.analogTurnArmed = true;
    this.neutralRearmTime = 0;
    this.standardPadEmergencyDown = false;
    this.standardPadSteer = 0;
    this.controllerTriggerBoost = false;
    this.braking = false;
    this.boosting = false;
    this.borders = [];
    this.boundaryArchitecture = null;
    this.markerTextures = [];
    this.cockpit = null;
    this.previousCameraFar = this.world.camera.far;
    this.world.camera.far = Math.max(this.world.camera.far, 260);
    this.world.camera.updateProjectionMatrix();
    this.previousFogDensity = this.world.scene.fog?.density ?? null;
    if (this.world.scene.fog) this.world.scene.fog.density = Math.min(this.world.scene.fog.density, 0.0095);
    this.buildWorld();
    if (this.isTabletopAR) this.root.scale.setScalar(0.024);
    this.spawnRiders();
    if (!this.isTabletopAR) this.buildCockpit();
    this.world.setEyeHeight(0.88);
    this.world.setYaw(0);
    this.announceRound();
  }

  announceRound() {
    this.world.announce(
      `LIGHTFIELD  ·  TIER ${this.tier + 1}  ·  ROUND ${this.round}/3  ·  ${CYCLE_COUNTDOWN_SECONDS}s TO LAUNCH`,
      2.4,
    );
  }

  buildWorld() {
    this.environment = createEnvironment({ ar: this.world.presentation === 'ar' });
    this.root.add(this.environment);
    if (this.environment.userData.panorama) this.environment.userData.panorama.material.opacity = 0.2;
    if (this.environment.userData.stars) this.environment.userData.stars.material.opacity = 0.32;
    const ambient = new THREE.HemisphereLight(0xb9fdff, 0x05020a, 1.2);
    const key = new THREE.DirectionalLight(0xe9ffff, 2.6);
    key.position.set(-8, 18, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const red = new THREE.PointLight(COLORS.coral, 18, 42, 2);
    red.position.set(-16, 7, -14);
    const blue = new THREE.PointLight(COLORS.cyan, 22, 42, 2);
    blue.position.set(15, 5, 14);
    this.root.add(ambient, key, red, blue);
    this.animatedLights = { red, blue };

    const span = (this.bounds * 2 + 3) * this.cellSize;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(span, span, 1, 1),
      new THREE.MeshPhysicalMaterial({
        color: 0x02060a,
        metalness: 0.88,
        roughness: 0.24,
        clearcoat: 0.55,
        emissive: 0x040b12,
        emissiveIntensity: 0.65,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.root.add(floor);

    const grid = new THREE.GridHelper(span, this.bounds * 2 + 2, COLORS.cyan, 0x0b2340);
    grid.position.y = 0.015;
    grid.material.transparent = true;
    grid.material.opacity = 0.34;
    this.root.add(grid);
    this.grid = grid;

    const outerGrid = new THREE.GridHelper(span * 3, 90, COLORS.violet, 0x100b2b);
    outerGrid.position.y = -0.18;
    outerGrid.material.transparent = true;
    outerGrid.material.opacity = 0.15;
    this.root.add(outerGrid);

    const boundary = new THREE.Group();
    boundary.name = 'readable-square-arena-boundary';
    const boundaryOffset = (this.bounds + 0.8) * this.cellSize;
    const wallHeight = 5.4;
    const wallMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x02070b,
      metalness: 0.72,
      roughness: 0.38,
      emissive: 0x05202a,
      emissiveIntensity: 0.42,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
    const lowerRailMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.cyan,
      transparent: true,
      opacity: 0.62,
      toneMapped: false,
    });
    const upperRailMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.ice,
      transparent: true,
      opacity: 0.52,
      toneMapped: false,
    });
    const seamMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.violet,
      transparent: true,
      opacity: 0.34,
      toneMapped: false,
    });
    for (let side = 0; side < 4; side += 1) {
      const alongZ = side >= 2;
      const sign = side === 0 || side === 2 ? -1 : 1;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(span, wallHeight, 0.12), wallMaterial);
      wall.position.y = wallHeight * 0.5;
      if (alongZ) {
        wall.rotation.y = Math.PI / 2;
        wall.position.x = sign * boundaryOffset;
      } else {
        wall.position.z = sign * boundaryOffset;
      }
      boundary.add(wall);

      for (const [height, material, thickness] of [
        [0.12, lowerRailMaterial, 0.1],
        [wallHeight * 0.53, seamMaterial, 0.045],
        [wallHeight - 0.08, upperRailMaterial, 0.075],
      ]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(span, thickness, 0.14), material);
        rail.position.copy(wall.position);
        rail.position.y = height;
        rail.rotation.y = wall.rotation.y;
        boundary.add(rail);
        if (height === 0.12) this.borders.push(rail);
      }
    }

    const supportGeometry = new THREE.BoxGeometry(0.11, wallHeight, 0.11);
    const supportMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.cyan,
      transparent: true,
      opacity: 0.36,
      toneMapped: false,
    });
    const supportsPerSide = 13;
    const supports = new THREE.InstancedMesh(supportGeometry, supportMaterial, supportsPerSide * 4);
    supports.name = 'boundary-distance-supports';
    const transform = new THREE.Matrix4();
    let supportIndex = 0;
    for (let side = 0; side < 4; side += 1) {
      for (let index = 0; index < supportsPerSide; index += 1) {
        const along = THREE.MathUtils.lerp(-boundaryOffset, boundaryOffset, index / (supportsPerSide - 1));
        const x = side < 2 ? along : (side === 2 ? -boundaryOffset : boundaryOffset);
        const z = side < 2 ? (side === 0 ? -boundaryOffset : boundaryOffset) : along;
        transform.makeTranslation(x, wallHeight * 0.5, z);
        supports.setMatrixAt(supportIndex++, transform);
      }
    }
    supports.instanceMatrix.needsUpdate = true;
    boundary.add(supports);

    this.arenaPulse = {
      grid: grid.material,
      outerGrid: outerGrid.material,
      floor: floor.material,
      lowerRail: lowerRailMaterial,
      seam: seamMaterial,
      upperRail: upperRailMaterial,
      supports: supportMaterial,
      wall: wallMaterial,
    };

    const towerGeometry = new THREE.CylinderGeometry(0.42, 0.68, wallHeight + 2.6, 8);
    for (const [x, z] of [
      [-boundaryOffset, -boundaryOffset],
      [boundaryOffset, -boundaryOffset],
      [boundaryOffset, boundaryOffset],
      [-boundaryOffset, boundaryOffset],
    ]) {
      const tower = new THREE.Mesh(towerGeometry, wallMaterial);
      tower.position.set(x, (wallHeight + 2.6) * 0.5, z);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), upperRailMaterial);
      cap.position.y = (wallHeight + 2.6) * 0.5;
      tower.add(cap);
      boundary.add(tower);
    }
    this.root.add(boundary);
    this.boundaryArchitecture = boundary;
  }

  buildCockpit() {
    const cockpit = new THREE.Group();
    cockpit.name = 'first-person-light-runner-cockpit';

    const shell = new THREE.MeshPhysicalMaterial({
      color: 0x0b1b21,
      metalness: 0.84,
      roughness: 0.2,
      clearcoat: 0.94,
      clearcoatRoughness: 0.1,
      emissive: COLORS.cyan,
      emissiveIntensity: 0.08,
    });
    const carbon = new THREE.MeshPhysicalMaterial({
      color: 0x05090c,
      metalness: 0.7,
      roughness: 0.3,
      clearcoat: 0.62,
      clearcoatRoughness: 0.2,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x314248,
      metalness: 0.92,
      roughness: 0.34,
    });
    const rubber = new THREE.MeshStandardMaterial({
      color: 0x020405,
      metalness: 0.08,
      roughness: 0.84,
    });
    const energy = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLORS.cyan).multiplyScalar(0.7),
      transparent: true,
      opacity: 0.86,
      toneMapped: false,
    });
    const ice = new THREE.MeshBasicMaterial({ color: COLORS.ice, toneMapped: false });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x164453,
      metalness: 0.08,
      roughness: 0.045,
      transmission: 0.84,
      thickness: 0.055,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const tube = (points, radius, material, segments = 32, radialSegments = 7) => {
      const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segments, radius, radialSegments, false),
        material,
      );
      mesh.castShadow = true;
      return mesh;
    };
    const link = (start, end, radius, material, radialSegments = 8) => {
      const delta = new THREE.Vector3().subVectors(end, start);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, delta.length(), radialSegments),
        material,
      );
      mesh.position.addVectors(start, end).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
      mesh.castShadow = true;
      return mesh;
    };

    const cockpitBody = new THREE.Group();
    cockpitBody.name = 'cockpit-suspension-rig';
    cockpitBody.position.y = -0.06;
    cockpit.add(cockpitBody);

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.48, 30, 18), shell);
      shoulder.name = side < 0 ? 'left-cockpit-fairing' : 'right-cockpit-fairing';
      shoulder.position.set(side * 0.48, -0.54, -0.78);
      shoulder.scale.set(0.72, 0.3, 1.35);
      shoulder.rotation.z = side * 0.08;
      cockpitBody.add(shoulder);

      const intake = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 7, 30, Math.PI * 1.25), carbon);
      intake.position.set(side * 0.57, -0.5, -0.7);
      intake.rotation.y = Math.PI / 2;
      intake.rotation.z = side < 0 ? Math.PI * 0.1 : Math.PI * 1.1;
      intake.scale.y = 0.55;
      cockpitBody.add(intake);

      const lightVein = tube(
        [
          new THREE.Vector3(side * 0.76, -0.53, -0.34),
          new THREE.Vector3(side * 0.62, -0.42, -0.72),
          new THREE.Vector3(side * 0.42, -0.39, -1.02),
          new THREE.Vector3(side * 0.2, -0.47, -1.18),
        ],
        0.018,
        energy,
        36,
        7,
      );
      lightVein.name = side < 0 ? 'left-cockpit-energy-vein' : 'right-cockpit-energy-vein';
      cockpitBody.add(lightVein);

      const sideFrame = tube(
        [
          new THREE.Vector3(side * 0.7, -0.62, -0.38),
          new THREE.Vector3(side * 0.55, -0.54, -0.72),
          new THREE.Vector3(side * 0.42, -0.48, -1.05),
        ],
        0.035,
        carbon,
        28,
        8,
      );
      cockpitBody.add(sideFrame);
    }

    const centerCowl = new THREE.Mesh(new THREE.SphereGeometry(0.56, 32, 18), shell);
    centerCowl.name = 'sculpted-instrument-cowl';
    centerCowl.position.set(0, -0.58, -0.8);
    centerCowl.scale.set(0.88, 0.28, 1.18);
    cockpitBody.add(centerCowl);

    const centerKeel = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.46, 7, 14), carbon);
    centerKeel.rotation.x = Math.PI / 2;
    centerKeel.position.set(0, -0.58, -0.69);
    centerKeel.scale.set(0.9, 0.56, 1.35);
    cockpitBody.add(centerKeel);

    const windscreen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.76, 0.88, 0.5, 40, 1, true, Math.PI - 0.62, 1.24),
      glass,
    );
    windscreen.name = 'laminated-curved-windscreen';
    windscreen.position.set(0, -0.18, -0.12);
    windscreen.rotation.x = -0.055;
    cockpitBody.add(windscreen);

    const screenTop = tube(
      [
        new THREE.Vector3(-0.48, 0.05, -0.74),
        new THREE.Vector3(-0.25, 0.12, -0.88),
        new THREE.Vector3(0, 0.145, -0.93),
        new THREE.Vector3(0.25, 0.12, -0.88),
        new THREE.Vector3(0.48, 0.05, -0.74),
      ],
      0.015,
      metal,
      40,
      6,
    );
    screenTop.name = 'windscreen-upper-frame';
    cockpitBody.add(screenTop);
    cockpitBody.add(
      link(new THREE.Vector3(-0.48, 0.05, -0.74), new THREE.Vector3(-0.53, -0.4, -0.68), 0.014, metal, 6),
      link(new THREE.Vector3(0.48, 0.05, -0.74), new THREE.Vector3(0.53, -0.4, -0.68), 0.014, metal, 6),
    );

    const handlebarRig = new THREE.Group();
    handlebarRig.name = 'articulated-handlebar-rig';
    const handlebar = tube(
      [
        new THREE.Vector3(-0.59, -0.34, -0.63),
        new THREE.Vector3(-0.35, -0.3, -0.72),
        new THREE.Vector3(0, -0.39, -0.8),
        new THREE.Vector3(0.35, -0.3, -0.72),
        new THREE.Vector3(0.59, -0.34, -0.63),
      ],
      0.024,
      metal,
      42,
      8,
    );
    handlebarRig.add(handlebar);
    for (const side of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.055, 0.25, 18), rubber);
      grip.name = side < 0 ? 'left-rider-grip' : 'right-rider-grip';
      grip.position.set(side * 0.63, -0.34, -0.63);
      grip.rotation.z = Math.PI / 2;
      handlebarRig.add(grip);

      for (let ringIndex = -2; ringIndex <= 2; ringIndex += 1) {
        const gripRing = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.006, 5, 16), carbon);
        gripRing.position.set(side * (0.63 + ringIndex * 0.037), -0.34, -0.63);
        gripRing.rotation.y = Math.PI / 2;
        handlebarRig.add(gripRing);
      }

      const controlHalo = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.011, 6, 24), energy);
      controlHalo.position.set(side * 0.48, -0.335, -0.665);
      controlHalo.rotation.y = Math.PI / 2;
      handlebarRig.add(controlHalo);

      const brakeLever = tube(
        [
          new THREE.Vector3(side * 0.54, -0.3, -0.64),
          new THREE.Vector3(side * 0.46, -0.37, -0.59),
          new THREE.Vector3(side * 0.39, -0.41, -0.61),
        ],
        0.009,
        metal,
        18,
        5,
      );
      handlebarRig.add(brakeLever);

      const forearm = tube(
        [
          new THREE.Vector3(side * 0.78, -0.72, -0.28),
          new THREE.Vector3(side * 0.72, -0.52, -0.45),
          new THREE.Vector3(side * 0.63, -0.36, -0.61),
        ],
        0.07,
        carbon,
        24,
        10,
      );
      forearm.name = side < 0 ? 'left-rider-forearm' : 'right-rider-forearm';
      handlebarRig.add(forearm);
      const glove = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.11, 6, 12), shell);
      glove.name = side < 0 ? 'left-rider-glove' : 'right-rider-glove';
      glove.position.set(side * 0.63, -0.345, -0.625);
      glove.rotation.z = Math.PI / 2;
      glove.scale.set(1, 0.9, 0.72);
      handlebarRig.add(glove);
      const gloveCircuit = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 5, 20, Math.PI * 1.2), energy);
      gloveCircuit.position.set(side * 0.63, -0.31, -0.67);
      gloveCircuit.rotation.y = Math.PI / 2;
      gloveCircuit.rotation.z = side < 0 ? -0.55 : Math.PI - 0.55;
      handlebarRig.add(gloveCircuit);
    }
    const steeringStem = link(
      new THREE.Vector3(0, -0.39, -0.8),
      new THREE.Vector3(0, -0.55, -0.98),
      0.035,
      carbon,
      10,
    );
    handlebarRig.add(steeringStem);
    cockpitBody.add(handlebarRig);

    const instrumentRig = new THREE.Group();
    instrumentRig.name = 'floating-instrument-cluster';
    instrumentRig.position.set(0, -0.29 + this.dashboardHeight, -0.79);
    instrumentRig.rotation.x = -0.12;

    const displayCanvas = document.createElement('canvas');
    displayCanvas.width = 512;
    displayCanvas.height = 192;
    const displayContext = displayCanvas.getContext('2d');
    const displayTexture = new THREE.CanvasTexture(displayCanvas);
    displayTexture.colorSpace = THREE.SRGBColorSpace;
    displayTexture.minFilter = THREE.LinearFilter;
    const paintReadout = (speed, flux) => {
      const width = displayCanvas.width;
      const height = displayCanvas.height;
      displayContext.clearRect(0, 0, width, height);
      const background = displayContext.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, '#02080b');
      background.addColorStop(0.52, '#071b20');
      background.addColorStop(1, '#020608');
      displayContext.fillStyle = background;
      displayContext.fillRect(0, 0, width, height);
      displayContext.strokeStyle = '#2cecf5';
      displayContext.lineWidth = 3;
      displayContext.strokeRect(5, 5, width - 10, height - 10);
      displayContext.fillStyle = '#5edce2';
      displayContext.font = '600 20px monospace';
      displayContext.letterSpacing = '3px';
      displayContext.fillText('D/W  //  VELOCITY', 24, 36);
      displayContext.fillStyle = '#e9ffff';
      displayContext.font = '700 84px sans-serif';
      displayContext.fillText(String(Math.round(speed)).padStart(3, '0'), 22, 128);
      displayContext.fillStyle = '#68aeb4';
      displayContext.font = '600 20px monospace';
      displayContext.fillText('KPH', 184, 126);
      displayContext.fillText(`FLUX ${Math.round(flux)}%`, 326, 42);
      displayContext.fillStyle = '#0d343a';
      displayContext.fillRect(326, 68, 150, 17);
      displayContext.fillStyle = '#58f2ff';
      displayContext.fillRect(326, 68, 150 * THREE.MathUtils.clamp(flux / 100, 0, 1), 17);
      displayContext.fillStyle = '#426f75';
      displayContext.font = '500 15px monospace';
      displayContext.fillText('LIGHTLINE / ARMED', 326, 119);
      displayContext.fillText('VECTOR / LOCKED', 326, 148);
      displayTexture.needsUpdate = true;
    };
    paintReadout(0, 100);

    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.18),
      new THREE.MeshBasicMaterial({ map: displayTexture, toneMapped: false }),
    );
    display.position.z = 0.018;
    instrumentRig.add(display);
    const displayBezel = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.012, 8, 40), metal);
    displayBezel.scale.y = 0.42;
    displayBezel.position.z = 0.023;
    instrumentRig.add(displayBezel);

    const speedNeedle = new THREE.Group();
    const speedNeedleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.009, 0.09, 6), ice);
    speedNeedleMesh.position.y = 0.039;
    speedNeedle.add(speedNeedleMesh);
    speedNeedle.position.set(-0.31, 0, 0.028);
    instrumentRig.add(speedNeedle);
    const fluxNeedle = speedNeedle.clone();
    fluxNeedle.children[0].material = new THREE.MeshBasicMaterial({ color: COLORS.violet, toneMapped: false });
    fluxNeedle.position.x = 0.31;
    instrumentRig.add(fluxNeedle);

    for (const side of [-1, 1]) {
      const gaugeFace = new THREE.Mesh(
        new THREE.CircleGeometry(0.095, 28),
        new THREE.MeshBasicMaterial({ color: 0x010405, transparent: true, opacity: 0.9 }),
      );
      gaugeFace.position.set(side * 0.31, 0, 0.008);
      instrumentRig.add(gaugeFace);
      const gaugeArc = new THREE.Mesh(
        new THREE.RingGeometry(0.077, 0.09, 30, 1, Math.PI * 0.16, Math.PI * 1.68),
        new THREE.MeshBasicMaterial({
          color: side < 0 ? COLORS.cyan : COLORS.violet,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      gaugeArc.position.set(side * 0.31, 0, 0.026);
      instrumentRig.add(gaugeArc);
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), metal);
      hub.position.set(side * 0.31, 0, 0.034);
      instrumentRig.add(hub);
    }
    cockpitBody.add(instrumentRig);

    let tacticalMap = null;
    if (this.world.presentation === 'vr' || this.world.requestedPresentation === 'vr') {
      const mapCanvas = document.createElement('canvas');
      mapCanvas.width = 256;
      mapCanvas.height = 256;
      const mapTexture = new THREE.CanvasTexture(mapCanvas);
      mapTexture.colorSpace = THREE.SRGBColorSpace;
      mapTexture.minFilter = THREE.LinearFilter;
      const mapGroup = new THREE.Group();
      mapGroup.name = 'vr-fixed-upper-right-tactical-map';
      mapGroup.position.set(0.69, 0.36, -0.92);
      const mapBack = new THREE.Mesh(
        new THREE.PlaneGeometry(0.245, 0.245),
        new THREE.MeshBasicMaterial({ color: 0x010609, transparent: true, opacity: 0.92 }),
      );
      const mapPanel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, 0.22),
        new THREE.MeshBasicMaterial({ map: mapTexture, transparent: true, toneMapped: false }),
      );
      mapPanel.position.z = 0.004;
      const mapFrame = new THREE.Mesh(
        new THREE.RingGeometry(0.119, 0.126, 4),
        new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.58, toneMapped: false }),
      );
      mapFrame.rotation.z = Math.PI / 4;
      mapFrame.position.z = 0.008;
      mapGroup.add(mapBack, mapPanel, mapFrame);
      // Keep navigation information head-locked instead of inheriting the
      // motorcycle's roll. This remains readable while the chassis leans.
      this.world.camera.add(mapGroup);
      tacticalMap = {
        canvas: mapCanvas,
        context: mapCanvas.getContext('2d'),
        texture: mapTexture,
        group: mapGroup,
        lastPaint: -Infinity,
      };
    }

    const centerLine = tube(
      [
        new THREE.Vector3(0, -0.5, -0.46),
        new THREE.Vector3(0, -0.46, -0.76),
        new THREE.Vector3(0, -0.48, -1.16),
      ],
      0.014,
      energy,
      26,
      6,
    );
    cockpitBody.add(centerLine);

    const glow = createGlow(COLORS.cyan, 0.9, 0.12);
    glow.position.set(0, -0.43, -0.92);
    cockpitBody.add(glow);

    const speedLineCount = 26;
    const linePositions = new Float32Array(speedLineCount * 6);
    const speedLineGeometry = new THREE.BufferGeometry();
    const speedLineAttribute = new THREE.BufferAttribute(linePositions, 3);
    speedLineAttribute.setUsage(THREE.DynamicDrawUsage);
    speedLineGeometry.setAttribute('position', speedLineAttribute);
    const speedLines = new THREE.LineSegments(
      speedLineGeometry,
      new THREE.LineBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: 0.025,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const speedLineData = [];
    for (let index = 0; index < speedLineCount; index += 1) {
      speedLineData.push({
        x: (this.random() - 0.5) * 8,
        y: (this.random() - 0.45) * 4,
        z: -2 - this.random() * 16,
        length: 0.18 + this.random() * 0.75,
      });
    }
    cockpit.add(speedLines);
    cockpit.userData.bodyRig = cockpitBody;
    cockpit.userData.handlebarRig = handlebarRig;
    cockpit.userData.instrumentRig = instrumentRig;
    cockpit.userData.instrumentBaseY = -0.29;
    cockpit.userData.windscreen = windscreen;
    cockpit.userData.speedNeedle = speedNeedle;
    cockpit.userData.fluxNeedle = fluxNeedle;
    cockpit.userData.energyMaterial = energy;
    cockpit.userData.glow = glow;
    cockpit.userData.paintReadout = paintReadout;
    cockpit.userData.readout = { speed: -1, flux: -1, texture: displayTexture };
    cockpit.userData.tacticalMap = tacticalMap;
    cockpit.userData.basePosition = new THREE.Vector3();
    this.speedLines = speedLines;
    this.speedLineData = speedLineData;
    this.world.camera.add(cockpit);
    this.cockpit = cockpit;
  }

  spawnRiders() {
    this.riders.length = 0;
    const b = this.bounds;
    const playerStart = Math.round(b * 0.84);
    this.spawnRider({ id: 0, x: 0, z: playerStart, direction: 0, role: 'PLAYER' });
    // Rivals start far ahead in a readable parallel formation; the pattern
    // alternates by round so each round opens differently.
    const formations = [
      [{ x: -Math.round(b * 0.5), z: -Math.round(b * 0.2) }, { x: 0, z: -Math.round(b * 0.35) }, { x: Math.round(b * 0.5), z: -Math.round(b * 0.2) }],
      [{ x: -Math.round(b * 0.3), z: -Math.round(b * 0.45) }, { x: Math.round(b * 0.15), z: -Math.round(b * 0.5) }, { x: Math.round(b * 0.45), z: -Math.round(b * 0.12) }],
    ];
    const pattern = formations[(this.round - 1) % formations.length];
    const roles = ['TRAPPER', 'HUNTER', 'ROGUE'];
    pattern.forEach((pos, index) => this.spawnRider({ id: index + 1, x: pos.x, z: pos.z, direction: 0, role: roles[index] }));
  }

  spawnRider({ id, x, z, direction, role }) {
    const color = RIDER_COLORS[id];
    const mesh = createBike(color, id !== 0);
    mesh.position.set(x * this.cellSize, 0, z * this.cellSize);
    mesh.rotation.y = direction * -Math.PI / 2;
    if (id === 0) mesh.visible = this.isTabletopAR;
    if (id !== 0) {
      mesh.scale.setScalar(1.18);
      const riderMesh = createHumanoid(color, role);
      riderMesh.scale.setScalar(0.34);
      riderMesh.position.set(0, 0.43, 0.25);
      riderMesh.rotation.x = -0.46;
      riderMesh.userData.limbs[0].rotation.x = -0.72;
      riderMesh.userData.limbs[1].rotation.x = -0.72;
      mesh.add(riderMesh);
      const marker = createRivalMarker(role, color, (texture) => this.markerTextures.push(texture));
      mesh.add(marker);
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.045, 1.4, 8),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.28,
          toneMapped: false,
        }),
      );
      beacon.position.set(0, 1.45, 0);
      mesh.add(beacon);
      mesh.userData.marker = marker;
      mesh.userData.beacon = beacon;
    }
    this.root.add(mesh);
    const rider = {
      id,
      role,
      color,
      x,
      z,
      direction,
      queuedTurn: 0,
      progress: 0,
      speed: id === 0 ? this.tierSpeed.cruise : this.tierSpeed.ai * (0.95 + this.random() * 0.12),
      mesh,
      alive: true,
      trailOn: true,
      energy: 100,
      health: id === 0 ? 100 : 1,
      steps: 0,
      respawnTimer: 0,
      crashOwner: null,
    };
    if (id === 0) {
      // The player rides in continuous space: analog heading with arc turns.
      // AI riders remain on the classic grid; both share cell occupancy.
      rider.analog = true;
      rider.fx = x;
      rider.fz = z;
      rider.heading = direction * Math.PI * 0.5;
      rider.turnBurst = 0;
    }
    this.riders.push(rider);
    this.occupancy.set(this.cellKey(x, z), { id: ++this.trailSerial, owner: id, live: true });
    return rider;
  }

  cellKey(x, z) {
    return `${x},${z}`;
  }

  cellWorld(x, z) {
    return new THREE.Vector3(x * this.cellSize, 0.05, z * this.cellSize);
  }

  isBlocked(x, z) {
    return Math.abs(x) > this.bounds || Math.abs(z) > this.bounds || this.occupancy.has(this.cellKey(x, z));
  }

  queuePlayerTurn(amount) {
    const player = this.riders[0];
    if (!player?.alive) return;
    player.queuedTurn = amount;
  }

  chooseAITurn(rider, aggressive = this.aggressionGraceRemaining <= 0) {
    const candidates = [-1, 0, 1];
    let bestTurn = 0;
    let bestScore = -Infinity;
    const player = this.riders[0];
    for (const turn of candidates) {
      const direction = (rider.direction + turn + 4) % 4;
      const vector = DIRECTIONS[direction];
      let clear = 0;
      for (let step = 1; step <= 7; step += 1) {
        if (this.isBlocked(rider.x + vector.x * step, rider.z + vector.z * step)) break;
        clear += 1;
      }
      if (clear === 0) continue;
      let score = clear * 5 + this.random() * 7;
      if (turn === 0) score += 3;
      // Higher tiers hunt harder and cut off more often.
      const aggr = 1 + this.tier * 0.7;
      if (aggressive && rider.role === 'HUNTER' && player?.alive) {
        const nextX = rider.x + vector.x * 3;
        const nextZ = rider.z + vector.z * 3;
        const before = Math.abs(rider.x - player.x) + Math.abs(rider.z - player.z);
        const after = Math.abs(nextX - player.x) + Math.abs(nextZ - player.z);
        score += (before - after) * 1.4 * aggr;
      }
      if (aggressive && rider.role === 'TRAPPER' && player?.alive) {
        if (Math.abs(rider.x - player.x) < 5 || Math.abs(rider.z - player.z) < 5) score += (turn === 0 ? -2 : 6) * aggr;
      }
      if (aggressive && rider.role === 'ROGUE') score += this.random() * 10 * aggr;
      // Deliberate cut-off: a tier-scaled chance to steer into the player's lane.
      if (aggressive && player?.alive && this.random() < TIER_AGGRESSION[this.tier]) {
        const nextX = rider.x + vector.x * 4;
        const nextZ = rider.z + vector.z * 4;
        const before = Math.abs(rider.x - player.x) + Math.abs(rider.z - player.z);
        const after = Math.abs(nextX - player.x) + Math.abs(nextZ - player.z);
        score += (before - after) * 6;
      }
      if (score > bestScore) {
        bestScore = score;
        bestTurn = turn;
      }
    }
    rider.queuedTurn = bestTurn;
  }

  addTrail(rider, oldX, oldZ, newX, newZ) {
    if (!rider.trailOn) return;
    const id = ++this.trailSerial;
    const a = this.cellWorld(oldX, oldZ);
    const b = this.cellWorld(newX, newZ);
    const mesh = createTrailSegment(a, b, rider.color, rider.id === 0 ? 1.42 : 1.25);
    this.root.add(mesh);
    const key = this.cellKey(oldX, oldZ);
    this.occupancy.set(key, { id, owner: rider.id });
    this.trails.push({
      id,
      owner: rider.id,
      key,
      mesh,
      age: 0,
      maxAge: 12,
      ax: oldX,
      az: oldZ,
      bx: newX,
      bz: newZ,
    });
  }

  // A cycle death is a full derezz event: voxel debris, a light flash,
  // stacked shockwaves, an energy column, and heavy particles.
  detonateCycle(impact, rider) {
    const isPlayer = rider.id === 0;
    this.bursts.push(createParticleBurst(this.root, impact, rider.color, isPlayer ? 70 : 52, 0.2));
    this.bursts.push(createParticleBurst(this.root, impact, COLORS.ice, isPlayer ? 34 : 24, 0.12));
    this.shockwaves.push(createShockwave(this.root, impact, rider.color, true));
    this.shockwaves.push(
      createShockwave(this.root, impact.clone().add(new THREE.Vector3(0, 0.6, 0)), COLORS.ice, true),
    );

    // Derezz voxels: the cycle shatters into glowing cubes that tumble out.
    const voxelCount = isPlayer ? 34 : 26;
    const voxelGeometry = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    for (let index = 0; index < voxelCount; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: index % 4 === 0 ? COLORS.ice : rider.color,
        transparent: true,
        opacity: 1,
        toneMapped: false,
      });
      const voxel = new THREE.Mesh(voxelGeometry, material);
      voxel.position.copy(impact).add(
        new THREE.Vector3(
          (this.random() - 0.5) * 0.8,
          this.random() * 0.9,
          (this.random() - 0.5) * 0.8,
        ),
      );
      const angle = this.random() * Math.PI * 2;
      const force = 2.4 + this.random() * 6.5;
      this.root.add(voxel);
      this.debris.push({
        mesh: voxel,
        velocity: new THREE.Vector3(
          Math.cos(angle) * force,
          2.2 + this.random() * 5.4,
          Math.sin(angle) * force,
        ),
        spin: new THREE.Vector3(this.random() * 9, this.random() * 9, this.random() * 9),
        life: 0,
        maxLife: 1.1 + this.random() * 0.9,
      });
    }

    // Vertical energy column that stretches up and dissolves.
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.5, 1, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: rider.color,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    column.position.copy(impact);
    this.root.add(column);

    const flash = new THREE.PointLight(rider.color, 90, 26, 2);
    flash.position.copy(impact).add(new THREE.Vector3(0, 1.1, 0));
    this.root.add(flash);
    this.crashFlashes.push({ light: flash, column, life: 0, maxLife: 0.85 });

    this.world.pulseHaptics(1, isPlayer ? 300 : 160);
    if (isPlayer) this.world.pulseVignette?.();
  }

  updateCrashEffects(dt) {
    for (let index = this.debris.length - 1; index >= 0; index -= 1) {
      const piece = this.debris[index];
      piece.life += dt;
      piece.velocity.y -= 12.5 * dt;
      piece.mesh.position.addScaledVector(piece.velocity, dt);
      if (piece.mesh.position.y < 0.08) {
        piece.mesh.position.y = 0.08;
        piece.velocity.y = Math.abs(piece.velocity.y) * 0.34;
        piece.velocity.x *= 0.72;
        piece.velocity.z *= 0.72;
      }
      piece.mesh.rotation.x += piece.spin.x * dt;
      piece.mesh.rotation.y += piece.spin.y * dt;
      piece.mesh.rotation.z += piece.spin.z * dt;
      const fade = 1 - piece.life / piece.maxLife;
      piece.mesh.material.opacity = Math.max(0, fade);
      if (piece.life >= piece.maxLife) {
        disposeObject(piece.mesh);
        this.debris.splice(index, 1);
      }
    }
    for (let index = this.crashFlashes.length - 1; index >= 0; index -= 1) {
      const flash = this.crashFlashes[index];
      flash.life += dt;
      const remaining = Math.max(0, 1 - flash.life / flash.maxLife);
      flash.light.intensity = 90 * remaining * remaining;
      flash.column.scale.set(1 + (1 - remaining) * 0.8, 1 + (1 - remaining) * 9, 1 + (1 - remaining) * 0.8);
      flash.column.material.opacity = 0.85 * remaining;
      if (flash.life >= flash.maxLife) {
        flash.light.removeFromParent();
        disposeObject(flash.column);
        this.crashFlashes.splice(index, 1);
      }
    }
  }

  crashRider(rider, collisionOwner = null) {
    if (!rider.alive) return;
    rider.alive = false;
    rider.crashOwner = collisionOwner;
    rider.mesh.visible = false;
    const currentKey = this.cellKey(rider.x, rider.z);
    const currentOccupancy = this.occupancy.get(currentKey);
    if (currentOccupancy?.live && currentOccupancy.owner === rider.id) this.occupancy.delete(currentKey);
    const impact = this.cellWorld(rider.x, rider.z).add(new THREE.Vector3(0, 0.5, 0));
    this.detonateCycle(impact, rider);
    if (rider.id === 0) {
      rider.health -= 50;
      this.world.damageFeedback(50);
      if (rider.health <= 0) {
        this.roundOver(false);
      } else {
        rider.respawnTimer = 1.25;
        this.world.announce('ARMOR SHATTERED // ONE LAYER REMAINS', 1.4);
      }
    } else {
      this.kills += 1;
      const bonus = collisionOwner === 0 ? 900 : 350;
      this.score += bonus;
      const remaining = this.riders.slice(1).filter((enemy) => enemy.alive).length;
      this.world.announce(remaining === 1 ? `${rider.role} ERASED // LAST CYCLE RUNNING` : `${rider.role} ERASED // +${bonus}`, 1.1);
      if (remaining === 0) this.roundOver(true);
    }
  }

  roundOver(playerWon) {
    if (this.cycleState === 'roundOver' || this.cycleState === 'done') return;
    this.cycleState = 'roundOver';
    this.stateTimer = playerWon ? 2.2 : 2.8;
    if (playerWon) {
      this.pWins += 1;
      this.score += 800;
      this.world.announce(`ROUND WON  ·  ${this.pWins}–${this.eWins}`, 2.0);
    } else {
      this.eWins += 1;
      this.world.announce(`ROUND LOST  ·  ${this.pWins}–${this.eWins}`, 2.4);
      this.world.pulseVignette?.();
    }
  }

  advanceCycleCampaign() {
    if (this.pWins >= 2) {
      Store.set('cycleTier', Math.max(Store.get('cycleTier') || 0, this.tier + 1));
      if (this.tier >= CYCLE_TIERS - 1) {
        this.cycleState = 'done';
        this.world.endGame(true, {
          title: 'LIGHTFIELD MASTERED // ALL TIERS CLEARED',
          detail: `${this.kills} eliminations · Signal ${Math.round(this.score).toLocaleString()}`,
        });
        return;
      }
      this.tier += 1;
      this.tierSpeed = TIER_SPEED[this.tier];
      this.pWins = 0;
      this.eWins = 0;
      this.round = 1;
      this.startCycleRound();
      return;
    }
    if (this.eWins >= 2) {
      this.cycleState = 'done';
      this.world.endGame(false, {
        title: 'LIGHTLINE COLLAPSE',
        detail: `Held at tier ${this.tier + 1} · Signal ${Math.round(this.score).toLocaleString()}`,
      });
      return;
    }
    this.round += 1;
    this.startCycleRound();
  }

  clearArenaState() {
    for (const trail of this.trails) if (trail.mesh) disposeObject(trail.mesh);
    this.trails.length = 0;
    this.occupancy.clear();
    for (const rider of this.riders) if (rider.mesh) disposeObject(rider.mesh);
    this.riders.length = 0;
  }

  startCycleRound() {
    this.clearArenaState();
    this.aggressionGraceRemaining = this.aggressionGraceDuration;
    this.emergencyStopsRemaining = EMERGENCY_STOPS_PER_ROUND;
    this.emergencyStopTimer = 0;
    this.emergencyStopCooldown = 0;
    this.roundElapsed = 0;
    this.spawnRiders();
    this.cycleState = 'intro';
    this.stateTimer = CYCLE_COUNTDOWN_SECONDS;
    this.world.setYaw(0);
    this.announceRound();
  }

  respawnPlayer(rider) {
    const edge = Math.round(this.bounds * 0.82);
    const candidates = [
      { x: 0, z: edge, direction: 0 },
      { x: edge, z: edge, direction: 3 },
      { x: -edge, z: edge, direction: 1 },
      { x: 0, z: -edge, direction: 2 },
    ];
    const forwardClearance = (item) => {
      const direction = DIRECTIONS[item.direction];
      let clear = 0;
      for (let step = 0; step <= 4; step += 1) {
        if (this.isBlocked(item.x + direction.x * step, item.z + direction.z * step)) break;
        clear += 1;
      }
      return clear;
    };
    let spawn = candidates
      .filter((item) => !this.isBlocked(item.x, item.z))
      .sort((a, b) => forwardClearance(b) - forwardClearance(a))[0];
    if (!spawn || forwardClearance(spawn) < 3) {
      let bestClearance = -1;
      for (let radius = 2; radius <= this.bounds; radius += 2) {
        for (let x = -radius; x <= radius; x += 2) {
          for (const z of [-radius, radius]) {
            for (let direction = 0; direction < 4; direction += 1) {
              const candidate = { x, z, direction };
              const clearance = forwardClearance(candidate);
              if (clearance > bestClearance) {
                spawn = candidate;
                bestClearance = clearance;
              }
            }
          }
        }
      }
    }
    if (!spawn) {
      spawn = candidates[0];
      this.occupancy.delete(this.cellKey(spawn.x, spawn.z));
    }
    rider.x = spawn.x;
    rider.z = spawn.z;
    rider.direction = spawn.direction;
    rider.progress = 0;
    rider.queuedTurn = 0;
    if (rider.analog) {
      rider.fx = spawn.x;
      rider.fz = spawn.z;
      rider.heading = spawn.direction * Math.PI * 0.5;
      rider.turnBurst = 0;
    }
    rider.alive = true;
    rider.mesh.visible = this.isTabletopAR;
    rider.energy = Math.max(35, rider.energy);
    this.occupancy.set(this.cellKey(rider.x, rider.z), { id: ++this.trailSerial, owner: 0, live: true });
  }

  stepRider(rider) {
    if (!rider.alive) return;
    if (rider.id !== 0) {
      const forward = DIRECTIONS[rider.direction];
      const forwardBlocked = this.isBlocked(rider.x + forward.x, rider.z + forward.z);
      if (this.aggressionGraceRemaining > 0) {
        // During the opening read, rivals only turn to avoid an imminent crash.
        if (forwardBlocked) this.chooseAITurn(rider, false);
      } else if (rider.steps % 3 === 0 || this.random() < 0.07) {
        this.chooseAITurn(rider, true);
      }
    }
    if (rider.queuedTurn !== 0) {
      rider.direction = (rider.direction + rider.queuedTurn + 4) % 4;
      rider.queuedTurn = 0;
    }
    const direction = DIRECTIONS[rider.direction];
    const newX = rider.x + direction.x;
    const newZ = rider.z + direction.z;
    if (this.isBlocked(newX, newZ)) {
      const collision = this.occupancy.get(this.cellKey(newX, newZ));
      this.crashRider(rider, collision?.owner ?? null);
      return;
    }
    const oldX = rider.x;
    const oldZ = rider.z;
    rider.x = newX;
    rider.z = newZ;
    rider.steps += 1;
    if (!rider.trailOn) {
      const oldKey = this.cellKey(oldX, oldZ);
      const oldOccupancy = this.occupancy.get(oldKey);
      if (oldOccupancy?.live && oldOccupancy.owner === rider.id) this.occupancy.delete(oldKey);
    }
    this.addTrail(rider, oldX, oldZ, newX, newZ);
    this.occupancy.set(this.cellKey(newX, newZ), { id: ++this.trailSerial, owner: rider.id, live: true });
  }

  // Continuous arc movement for the player. Lean or stick deflection turns
  // the cycle proportionally: farther lean, sharper arc. Tap/keyboard turns
  // still execute as fast 90-degree carves via a heading burst.
  advancePlayerAnalog(rider, dt) {
    if (!rider.alive) return;
    if (rider.queuedTurn !== 0) {
      rider.turnBurst += rider.queuedTurn * Math.PI * 0.5;
      rider.queuedTurn = 0;
    }
    if (rider.turnBurst !== 0) {
      const burstStep = Math.sign(rider.turnBurst) * Math.min(Math.abs(rider.turnBurst), 4.2 * dt);
      rider.heading += burstStep;
      rider.turnBurst -= burstStep;
      if (Math.abs(rider.turnBurst) < 1e-4) rider.turnBurst = 0;
    }
    const steer = this.steeringInput;
    if (steer !== 0) {
      // Quadratic response: slight lean carves gently, deep lean cuts hard.
      rider.heading += steer * Math.abs(steer) * ANALOG_MAX_TURN_RATE * dt;
    }
    const dirX = Math.sin(rider.heading);
    const dirZ = -Math.cos(rider.heading);
    rider.fx += dirX * rider.speed * dt;
    rider.fz += dirZ * rider.speed * dt;
    rider.direction = ((Math.round(rider.heading / (Math.PI * 0.5)) % 4) + 4) % 4;

    // Look slightly ahead of the nose so walls kill on contact, not overlap.
    const probeX = Math.round(rider.fx + dirX * 0.55);
    const probeZ = Math.round(rider.fz + dirZ * 0.55);
    const cellX = Math.round(rider.fx);
    const cellZ = Math.round(rider.fz);
    const probeIsNewCell = probeX !== rider.x || probeZ !== rider.z;
    if (probeIsNewCell && this.isBlocked(probeX, probeZ)) {
      const collision = this.occupancy.get(this.cellKey(probeX, probeZ));
      this.crashRider(rider, collision?.owner ?? null);
      return;
    }
    if (cellX === rider.x && cellZ === rider.z) return;
    if (this.isBlocked(cellX, cellZ)) {
      const collision = this.occupancy.get(this.cellKey(cellX, cellZ));
      this.crashRider(rider, collision?.owner ?? null);
      return;
    }
    const oldX = rider.x;
    const oldZ = rider.z;
    rider.x = cellX;
    rider.z = cellZ;
    rider.steps += 1;
    if (!rider.trailOn) {
      const oldKey = this.cellKey(oldX, oldZ);
      const oldOccupancy = this.occupancy.get(oldKey);
      if (oldOccupancy?.live && oldOccupancy.owner === rider.id) this.occupancy.delete(oldKey);
    }
    this.addTrail(rider, oldX, oldZ, cellX, cellZ);
    this.occupancy.set(this.cellKey(cellX, cellZ), { id: ++this.trailSerial, owner: rider.id, live: true });
  }

  clearWithPulse() {
    const player = this.riders[0];
    if (!player?.alive || player.energy < 35 || this.pulseCooldown > 0) return;
    player.energy -= 35;
    this.pulseCooldown = 2.8;
    const forward = DIRECTIONS[player.direction];
    const keys = new Set();
    for (let distance = 1; distance <= 4; distance += 1) {
      for (let side = -1; side <= 1; side += 1) {
        const x = player.x + forward.x * distance + forward.z * side;
        const z = player.z + forward.z * distance - forward.x * side;
        keys.add(this.cellKey(x, z));
      }
    }
    let cleared = 0;
    for (let i = this.trails.length - 1; i >= 0; i -= 1) {
      const trail = this.trails[i];
      if (!keys.has(trail.key)) continue;
      const occupied = this.occupancy.get(trail.key);
      if (occupied?.id === trail.id) this.occupancy.delete(trail.key);
      disposeObject(trail.mesh);
      this.trails.splice(i, 1);
      cleared += 1;
    }
    const impact = this.cellWorld(player.x + forward.x * 3, player.z + forward.z * 3).add(new THREE.Vector3(0, 0.65, 0));
    this.bursts.push(createParticleBurst(this.root, impact, COLORS.ice, 30, 0.12));
    this.shockwaves.push(createShockwave(this.root, impact, COLORS.ice, true));
    this.score += cleared * 35;
    this.world.announce(`DISRUPTION PULSE // ${cleared} CELLS CUT`, 0.9);
    this.world.pulseVignette();
  }

  updateTrails(dt) {
    for (let i = this.trails.length - 1; i >= 0; i -= 1) {
      const trail = this.trails[i];
      trail.age += dt;
      if (trail.age > 8) {
        const opacity = Math.max(0, (trail.maxAge - trail.age) / 4);
        trail.mesh.userData.wall.material.opacity = opacity * 0.3;
        trail.mesh.userData.edge.material.opacity = opacity * 0.62;
        trail.mesh.userData.edge.material.transparent = true;
      }
      if (trail.age >= trail.maxAge) {
        const occupied = this.occupancy.get(trail.key);
        if (occupied?.id === trail.id) this.occupancy.delete(trail.key);
        disposeObject(trail.mesh);
        this.trails.splice(i, 1);
      }
    }
  }

  compressArena(nextBounds) {
    this.bounds = nextBounds;
    const originalSpan = (this.originalBounds * 2 + 3) * this.cellSize;
    const nextSpan = (nextBounds * 2 + 3) * this.cellSize;
    const scale = nextSpan / originalSpan;
    disposeObject(this.grid);
    this.grid = new THREE.GridHelper(nextSpan, nextBounds * 2 + 2, COLORS.cyan, 0x0b2340);
    this.grid.position.y = 0.015;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.34;
    this.root.add(this.grid);
    this.borders.forEach((border, index) => {
      border.scale.x = scale;
      if (index < 2) border.position.z = (index ? 1 : -1) * (nextBounds + 0.8) * this.cellSize;
      else border.position.x = (index === 2 ? -1 : 1) * (nextBounds + 0.8) * this.cellSize;
    });
  }

  readStandardGamepad() {
    const snapshot = {
      steer: 0,
      boost: false,
      brake: false,
      dashboardAdjust: 0,
      emergencyPressed: false,
    };
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return snapshot;
    const xrGamepads = new Set(
      (this.world.controllers || [])
        .map((controller) => controller.userData.inputSource?.gamepad)
        .filter(Boolean),
    );
    const gamepad = [...navigator.getGamepads()].find((candidate) => candidate?.connected && !xrGamepads.has(candidate));
    if (!gamepad) {
      this.standardPadEmergencyDown = false;
      this.standardPadSteer = 0;
      return snapshot;
    }

    const buttonValue = (index) => gamepad.buttons[index]?.value || 0;
    const buttonPressed = (index) => Boolean(gamepad.buttons[index]?.pressed);
    const emergencyDown = buttonPressed(0) || buttonPressed(2);
    snapshot.emergencyPressed = emergencyDown && !this.standardPadEmergencyDown;
    this.standardPadEmergencyDown = emergencyDown;
    snapshot.boost = buttonValue(7) > 0.14;
    snapshot.brake = buttonValue(6) > 0.14 || (gamepad.axes[1] || 0) > 0.72;
    snapshot.steer = applyDeadzone(gamepad.axes[0] || 0, 0.18);
    snapshot.dashboardAdjust = applyDeadzone(-(gamepad.axes[3] || 0), 0.22);
    this.standardPadSteer = snapshot.steer;
    return snapshot;
  }

  readXRMechanics(dt = 1 / 60) {
    const snapshot = {
      active: false,
      triggerBoost: false,
      brake: false,
      stickSteer: 0,
      dashboardAdjust: 0,
      headLean: 0,
      controllerLean: 0,
    };
    const immersiveVR = this.world.presentation === 'vr' && this.world.renderer.xr.isPresenting;
    if (!immersiveVR) {
      this.leanCenterX = null;
      this.controllerLeanCenter = null;
      this.leanCalibrated = false;
      this.headLean = 0;
      this.controllerLean = 0;
      this.headOffsetMeters = 0;
      this.controllerOffsetMeters = 0;
      this.smoothedHeadOffset = 0;
      this.smoothedControllerOffset = 0;
      this.headLeanActive = false;
      this.controllerLeanActive = false;
      return snapshot;
    }
    snapshot.active = true;

    const handed = {};
    let unassigned = 0;
    for (const controller of this.world.controllers || []) {
      const source = controller.userData.inputSource;
      const gamepad = source?.gamepad;
      if (!source || !gamepad) continue;
      let hand = source.handedness;
      if (hand !== 'left' && hand !== 'right') hand = unassigned++ === 0 ? 'left' : 'right';
      handed[hand] = { controller, gamepad };
      snapshot.triggerBoost ||= (gamepad.buttons[0]?.value || 0) > 0.12;
      const axes = gamepad.axes || [];
      const x = axes.at(-2) || 0;
      const y = axes.at(-1) || 0;
      if (hand === 'left') {
        snapshot.stickSteer = applyDeadzone(x, 0.2);
        snapshot.brake ||= y > 0.58;
      } else {
        snapshot.dashboardAdjust = applyDeadzone(-y, 0.24);
      }
    }

    this.world.cameraRig.updateWorldMatrix(true, false);
    const xrCamera = this.world.renderer.xr.getCamera(this.world.camera);
    xrCamera.updateWorldMatrix(true, false);
    const headLocal = this.world.cameraRig.worldToLocal(xrCamera.getWorldPosition(new THREE.Vector3()));
    if (this.leanCenterX === null) this.leanCenterX = headLocal.x;
    const rawHeadOffset = headLocal.x - this.leanCenterX;
    this.smoothedHeadOffset = THREE.MathUtils.damp(this.smoothedHeadOffset, rawHeadOffset, 12, dt);
    this.headOffsetMeters = rawHeadOffset;
    if (this.headLeanActive) {
      if (Math.abs(this.smoothedHeadOffset) < HEAD_LEAN_EXIT_METERS) this.headLeanActive = false;
    } else if (Math.abs(this.smoothedHeadOffset) > HEAD_LEAN_ENTER_METERS) {
      this.headLeanActive = true;
    }
    if (!this.headLeanActive && Math.abs(rawHeadOffset) < HEAD_LEAN_EXIT_METERS) {
      // Track slow posture drift only while clearly neutral. Intentional leans
      // remain measured from the calibrated center instead of being cancelled.
      this.leanCenterX = THREE.MathUtils.damp(this.leanCenterX, headLocal.x, 0.7, dt);
    }
    snapshot.headLean = this.headLeanActive
      ? THREE.MathUtils.clamp(
          Math.sign(this.smoothedHeadOffset) *
            ((Math.abs(this.smoothedHeadOffset) - HEAD_LEAN_EXIT_METERS) / (0.22 - HEAD_LEAN_EXIT_METERS)),
          -1,
          1,
        )
      : 0;
    this.leanCalibrated = true;

    if (handed.left && handed.right) {
      const leftLocal = this.world.cameraRig.worldToLocal(
        handed.left.controller.getWorldPosition(new THREE.Vector3()),
      );
      const rightLocal = this.world.cameraRig.worldToLocal(
        handed.right.controller.getWorldPosition(new THREE.Vector3()),
      );
      const heightDifference = rightLocal.y - leftLocal.y;
      if (this.controllerLeanCenter === null) this.controllerLeanCenter = heightDifference;
      const rawControllerOffset = heightDifference - this.controllerLeanCenter;
      this.controllerOffsetMeters = rawControllerOffset;
      this.smoothedControllerOffset = THREE.MathUtils.damp(
        this.smoothedControllerOffset,
        rawControllerOffset,
        14,
        dt,
      );
      const bothGripsHeld =
        Boolean(handed.left.gamepad.buttons[1]?.pressed) &&
        Boolean(handed.right.gamepad.buttons[1]?.pressed);
      if (bothGripsHeld) {
        if (this.controllerLeanActive) {
          if (Math.abs(this.smoothedControllerOffset) < CONTROLLER_LEAN_EXIT_METERS) {
            this.controllerLeanActive = false;
          }
        } else if (Math.abs(this.smoothedControllerOffset) > CONTROLLER_LEAN_ENTER_METERS) {
          this.controllerLeanActive = true;
        }
        if (!this.controllerLeanActive && Math.abs(rawControllerOffset) < CONTROLLER_LEAN_EXIT_METERS) {
          this.controllerLeanCenter = THREE.MathUtils.damp(
            this.controllerLeanCenter,
            heightDifference,
            0.8,
            dt,
          );
        }
        snapshot.controllerLean = this.controllerLeanActive
          ? THREE.MathUtils.clamp(
              -Math.sign(this.smoothedControllerOffset) *
                ((Math.abs(this.smoothedControllerOffset) - CONTROLLER_LEAN_EXIT_METERS) /
                  (0.18 - CONTROLLER_LEAN_EXIT_METERS)) *
                0.72,
              -1,
              1,
            )
          : 0;
      } else {
        this.controllerLeanActive = false;
        this.smoothedControllerOffset = THREE.MathUtils.damp(this.smoothedControllerOffset, 0, 12, dt);
        this.controllerLeanCenter = THREE.MathUtils.damp(
          this.controllerLeanCenter,
          heightDifference,
          3,
          dt,
        );
      }
    } else {
      this.controllerOffsetMeters = 0;
      this.smoothedControllerOffset = 0;
      this.controllerLeanActive = false;
    }
    this.headLean = snapshot.headLean;
    this.controllerLean = snapshot.controllerLean;
    return snapshot;
  }

  updateSteeringControls(dt, { keyboardTurn = 0, xrTurn = 0, xr, gamepad }) {
    this.steerCooldown = Math.max(0, this.steerCooldown - dt);
    let digitalTurn = keyboardTurn || xrTurn;
    if (digitalTurn) {
      this.queuePlayerTurn(digitalTurn);
      this.steerCharge = 0;
      this.steerCooldown = 0.24;
      this.steeringSource = keyboardTurn ? 'keyboard' : 'xr_stick';
    }

    // Large stick deflections are handled by DigiWorld's snap-turn queue. Smaller
    // deflections blend with calibrated headset/handlebar lean and steer the
    // arc continuously: farther lean, sharper turn.
    const xrStick = Math.abs(xr.stickSteer) < 0.62 ? xr.stickSteer * 0.55 : 0;
    const components = [
      { source: 'head_lean', value: xr.headLean },
      { source: 'controller_lean', value: xr.controllerLean },
      { source: 'xr_stick', value: xrStick },
      { source: 'gamepad_stick', value: gamepad.steer },
    ];
    const analogSteer = THREE.MathUtils.clamp(
      components.reduce((sum, component) => sum + component.value, 0),
      -1,
      1,
    );
    const analogIntent = Math.abs(analogSteer) >= 0.08;
    if (analogIntent) {
      this.neutralRearmTime = 0;
    } else {
      this.neutralRearmTime = Math.min(ANALOG_REARM_SECONDS, this.neutralRearmTime + dt);
      if (this.neutralRearmTime >= ANALOG_REARM_SECONDS) this.analogTurnArmed = true;
    }
    if (!digitalTurn) {
      if (analogIntent) {
        const intentDirection = Math.sign(analogSteer);
        if (intentDirection !== this.steeringIntentDirection) {
          this.steeringIntentDirection = intentDirection;
          this.steeringIntentTime = 0;
        }
        this.steeringIntentTime += dt;
        const dominant = components.reduce(
          (best, component) => Math.abs(component.value) > Math.abs(best.value) ? component : best,
          { source: 'neutral', value: 0 },
        );
        this.steeringSource = this.steeringIntentTime >= STEERING_INTENT_SECONDS
          ? dominant.source
          : `arming_${dominant.source}`;
        // Continuous arc steering: sustained lean feeds the heading directly
        // (see advancePlayerAnalog); no snap-turn charge is accumulated.
        this.steerCharge = 0;
      } else {
        this.steeringIntentDirection = 0;
        this.steeringIntentTime = 0;
        this.steerCharge = 0;
        this.steeringSource = 'neutral';
      }
    } else {
      this.steeringIntentDirection = 0;
      this.steeringIntentTime = 0;
    }
    this.steeringNeutral = !digitalTurn && !analogIntent;
    const steeringTarget = digitalTurn || (this.steeringIntentTime >= STEERING_INTENT_SECONDS ? analogSteer : 0);
    this.steeringInput = THREE.MathUtils.damp(
      this.steeringInput,
      steeringTarget,
      Math.abs(steeringTarget) > 0.02 ? 11 : 12,
      dt,
    );
    if (this.steeringNeutral && Math.abs(this.steeringInput) < 0.008) this.steeringInput = 0;
  }

  updateDashboardHeight(dt, analogAdjust = 0) {
    const keyboardAdjust =
      (this.world.input.isDown('PageUp') || this.world.input.isDown('BracketRight') ? 1 : 0) -
      (this.world.input.isDown('PageDown') || this.world.input.isDown('BracketLeft') ? 1 : 0);
    this.dashboardAdjustInput = THREE.MathUtils.clamp(analogAdjust + keyboardAdjust, -1, 1);
    if (Math.abs(this.dashboardAdjustInput) > 0.01) {
      const previous = this.dashboardHeight;
      this.dashboardHeight = THREE.MathUtils.clamp(
        this.dashboardHeight + this.dashboardAdjustInput * dt * 0.32,
        DASHBOARD_MIN,
        DASHBOARD_MAX,
      );
      if (Math.abs(this.dashboardHeight - previous) > 0.0001) saveDashboardHeight(this.dashboardHeight);
    }
    const cockpitData = this.cockpit?.userData;
    if (cockpitData?.instrumentRig) {
      cockpitData.instrumentRig.position.y = THREE.MathUtils.damp(
        cockpitData.instrumentRig.position.y,
        cockpitData.instrumentBaseY + this.dashboardHeight,
        12,
        dt,
      );
    }
  }

  activateEmergencyStop() {
    const player = this.riders[0];
    if (
      !player?.alive ||
      this.emergencyStopsRemaining <= 0 ||
      this.emergencyStopCooldown > 0 ||
      this.emergencyStopTimer > 0
    ) return false;
    this.emergencyStopsRemaining -= 1;
    this.emergencyStopTimer = EMERGENCY_STOP_SECONDS;
    this.emergencyStopCooldown = 0.3;
    const impact = this.cellWorld(player.x, player.z).add(new THREE.Vector3(0, 0.25, 0));
    this.shockwaves.push(createShockwave(this.root, impact, COLORS.ice, true));
    this.world.announce(
      `EMERGENCY STOP // ${this.emergencyStopsRemaining} ${this.emergencyStopsRemaining === 1 ? 'CHARGE' : 'CHARGES'} LEFT`,
      1,
    );
    this.world.pulseHaptics(0.8, 100);
    return true;
  }

  updateCockpitTacticalMap(force = false) {
    const map = this.cockpit?.userData.tacticalMap;
    if (!map || (!force && this.elapsed - map.lastPaint < 0.12)) return;
    map.lastPaint = this.elapsed;

    const { canvas, context, texture } = map;
    const width = canvas.width;
    const height = canvas.height;
    const inset = 22;
    const usable = width - inset * 2;
    const toMap = (cellX, cellZ) => ({
      x: inset + ((cellX + this.bounds) / (this.bounds * 2)) * usable,
      y: inset + ((cellZ + this.bounds) / (this.bounds * 2)) * usable,
    });

    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(1, 7, 10, 0.98)';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(88, 242, 255, 0.16)';
    context.lineWidth = 1;
    for (let index = 0; index <= 8; index += 1) {
      const offset = inset + (usable * index) / 8;
      context.beginPath();
      context.moveTo(inset, offset);
      context.lineTo(width - inset, offset);
      context.moveTo(offset, inset);
      context.lineTo(offset, height - inset);
      context.stroke();
    }
    context.strokeStyle = '#58f2ff';
    context.lineWidth = 4;
    context.shadowColor = '#58f2ff';
    context.shadowBlur = 8;
    context.strokeRect(inset, inset, usable, usable);
    context.shadowBlur = 0;
    context.fillStyle = '#79bac0';
    context.font = '600 12px monospace';
    context.textAlign = 'left';
    context.fillText('TACTICAL / N', inset, 15);

    // Live light-wall paths, grouped by owner so each rider's circuit reads
    // as one continuous colored line. Older segments fade exactly like the
    // 3D walls do (solid until age 8, dissolving until maxAge).
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const rider of this.riders) {
      const cssColor = `#${new THREE.Color(rider.color).getHexString()}`;
      context.strokeStyle = cssColor;
      context.shadowColor = cssColor;
      for (const trail of this.trails) {
        if (trail.owner !== rider.id) continue;
        const fade = trail.age > 8
          ? Math.max(0, (trail.maxAge - trail.age) / (trail.maxAge - 8))
          : 1;
        if (fade <= 0) continue;
        const a = toMap(trail.ax, trail.az);
        const b = toMap(trail.bx, trail.bz);
        context.globalAlpha = 0.22 + fade * 0.68;
        context.lineWidth = rider.id === 0 ? 3 : 2.4;
        context.shadowBlur = fade * 4;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
    }
    context.globalAlpha = 1;
    context.shadowBlur = 0;

    for (const rider of this.riders) {
      if (!rider.alive) continue;
      const point = rider.analog ? toMap(rider.fx, rider.fz) : toMap(rider.x, rider.z);
      const vector = rider.analog
        ? { x: Math.sin(rider.heading), z: -Math.cos(rider.heading) }
        : DIRECTIONS[rider.direction];
      const cssColor = `#${new THREE.Color(rider.color).getHexString()}`;
      context.strokeStyle = cssColor;
      context.fillStyle = rider.id === 0 ? '#eaffff' : cssColor;
      context.lineWidth = rider.id === 0 ? 4 : 3;
      context.shadowColor = cssColor;
      context.shadowBlur = rider.id === 0 ? 8 : 5;
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(point.x + vector.x * 14, point.y + vector.z * 14);
      context.stroke();
      context.beginPath();
      context.arc(point.x, point.y, rider.id === 0 ? 6 : 5, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      if (rider.id !== 0) {
        context.font = '700 10px monospace';
        context.textAlign = 'center';
        context.fillText(rider.role.slice(0, 1), point.x, point.y - 9);
      }
    }
    texture.needsUpdate = true;
  }

  updateRiderVisual(rider, dt = 1 / 60) {
    const direction = DIRECTIONS[rider.direction];
    const x = rider.analog
      ? rider.fx * this.cellSize
      : (rider.x + direction.x * rider.progress) * this.cellSize;
    const z = rider.analog
      ? rider.fz * this.cellSize
      : (rider.z + direction.z * rider.progress) * this.cellSize;
    const frameDt = Math.min(dt, 0.05);
    const visual = rider.mesh.userData;
    const immersiveVR =
      rider.id === 0 &&
      this.world.presentation === 'vr' &&
      this.world.renderer.xr.isPresenting;
    const speedRatio = THREE.MathUtils.clamp(rider.speed / 11.2, 0, 1);
    const targetYaw = rider.analog ? -rider.heading : -rider.direction * Math.PI / 2;
    if (!Number.isFinite(visual.visualYaw)) visual.visualYaw = targetYaw;

    if (visual.lastDirection === null || visual.lastDirection === undefined) {
      visual.lastDirection = rider.direction;
    } else if (visual.lastDirection !== rider.direction) {
      const directionDelta = (rider.direction - visual.lastDirection + 4) % 4;
      visual.turnImpulse = directionDelta === 1 ? 1 : directionDelta === 3 ? -1 : 0;
      visual.lastDirection = rider.direction;
    }
    const stablePlayerSteer = Math.abs(this.steeringInput) >= 0.015 ? this.steeringInput : 0;
    const steerSignal = THREE.MathUtils.clamp(
      rider.id === 0
        ? stablePlayerSteer || rider.queuedTurn || visual.turnImpulse || 0
        : rider.queuedTurn || visual.turnImpulse || 0,
      -1,
      1,
    );
    visual.turnImpulse = THREE.MathUtils.damp(visual.turnImpulse || 0, 0, 5.5, frameDt);
    visual.lean = THREE.MathUtils.damp(
      visual.lean || 0,
      -steerSignal * (rider.id === 0 ? 0.12 : 0.2) * speedRatio,
      steerSignal ? 8 : 5,
      frameDt,
    );

    rider.mesh.position.set(x, 0, z);
    const yawDelta = Math.atan2(
      Math.sin(targetYaw - visual.visualYaw),
      Math.cos(targetYaw - visual.visualYaw),
    );
    visual.visualYaw += yawDelta * (1 - Math.exp(-11 * frameDt));
    rider.mesh.rotation.y = visual.visualYaw;
    rider.mesh.rotation.z = visual.lean;

    const wheelSpin = (rider.speed * this.cellSize * frameDt) / (visual.wheelRadius || 0.37);
    visual.wheels?.forEach((wheel) => {
      wheel.rotation.x -= wheelSpin;
    });
    if (visual.frontAssembly) {
      visual.frontAssembly.rotation.y = THREE.MathUtils.damp(
        visual.frontAssembly.rotation.y,
        steerSignal * 0.15,
        10,
        frameDt,
      );
    }

    const suspensionPhase =
      this.elapsed * (10.5 + rider.speed * 0.58) + rider.id * 1.9 + (visual.suspensionPhase || 0);
    const suspensionTravel = 0.006 + speedRatio * 0.014;
    const frontTravel = Math.sin(suspensionPhase) * suspensionTravel;
    const rearTravel = Math.sin(suspensionPhase + 1.45) * suspensionTravel * 0.82;
    if (visual.frontWheel) visual.frontWheel.position.y = visual.frontWheel.userData.baseY + frontTravel;
    if (visual.rearWheel) visual.rearWheel.position.y = visual.rearWheel.userData.baseY + rearTravel;
    if (visual.bodyRig) {
      visual.bodyRig.position.y = THREE.MathUtils.damp(
        visual.bodyRig.position.y,
        (frontTravel + rearTravel) * 0.22,
        12,
        frameDt,
      );
      visual.bodyRig.rotation.x = THREE.MathUtils.damp(
        visual.bodyRig.rotation.x,
        (rearTravel - frontTravel) * 0.3,
        10,
        frameDt,
      );
    }
    if (visual.energyMaterial) {
      visual.energyMaterial.opacity = 0.74 + Math.sin(this.elapsed * 8 + rider.id) * 0.08 + speedRatio * 0.1;
    }
    visual.energyGlows?.forEach((glow, index) => {
      const pulse = 0.92 + Math.sin(this.elapsed * 9 + index * 1.8 + rider.id) * 0.07;
      glow.scale.setScalar(pulse * (0.92 + speedRatio * 0.12));
    });

    if (rider.id === 0) {
      if (!this.isTabletopAR) {
        // Head tracking supplies all ride motion in VR. Adding a synthetic
        // suspension wave to the camera rig makes a straight run feel unstable.
        const rideHeight = immersiveVR ? 0.08 : 0.08 + Math.sin(this.elapsed * 18) * 0.012;
        const position = new THREE.Vector3(x, rideHeight, z);
        this.world.setPlayerPosition(position);
        this.world.setYaw(visual.visualYaw);
        if (this.cockpit) {
          const cockpitData = this.cockpit.userData;
          const roadPulse = immersiveVR ? 0 : Math.sin(suspensionPhase) * (0.002 + speedRatio * 0.006);
          this.cockpit.rotation.z = THREE.MathUtils.damp(
            this.cockpit.rotation.z,
            -steerSignal * 0.065,
            steerSignal ? 9 : 5,
            frameDt,
          );
          this.cockpit.rotation.y = THREE.MathUtils.damp(
            this.cockpit.rotation.y,
            steerSignal * 0.012,
            8,
            frameDt,
          );
          if (this.steeringNeutral) {
            if (Math.abs(this.cockpit.rotation.z) < 0.0005) this.cockpit.rotation.z = 0;
            if (Math.abs(this.cockpit.rotation.y) < 0.0005) this.cockpit.rotation.y = 0;
          }
          if (cockpitData.instrumentRig) {
            cockpitData.instrumentRig.rotation.z = THREE.MathUtils.damp(
              cockpitData.instrumentRig.rotation.z,
              -this.cockpit.rotation.z,
              14,
              frameDt,
            );
            cockpitData.instrumentRig.rotation.y = THREE.MathUtils.damp(
              cockpitData.instrumentRig.rotation.y,
              -this.cockpit.rotation.y,
              14,
              frameDt,
            );
          }
          this.cockpit.position.y = THREE.MathUtils.damp(this.cockpit.position.y, roadPulse, 13, frameDt);
          this.cockpit.position.z = THREE.MathUtils.damp(
            this.cockpit.position.z,
            rider.speed > 10 ? 0.025 : 0,
            6,
            frameDt,
          );
          if (cockpitData.bodyRig) {
            cockpitData.bodyRig.rotation.x = THREE.MathUtils.damp(
              cockpitData.bodyRig.rotation.x,
              -roadPulse * 0.65,
              12,
              frameDt,
            );
          }
          if (cockpitData.handlebarRig) {
            cockpitData.handlebarRig.rotation.y = THREE.MathUtils.damp(
              cockpitData.handlebarRig.rotation.y,
              steerSignal * 0.075,
              12,
              frameDt,
            );
            cockpitData.handlebarRig.rotation.z = THREE.MathUtils.damp(
              cockpitData.handlebarRig.rotation.z,
              -steerSignal * 0.028,
              10,
              frameDt,
            );
          }

          const speedKph = rider.speed * this.cellSize * 14;
          const speedGauge = THREE.MathUtils.clamp(speedKph / 210, 0, 1);
          if (cockpitData.speedNeedle) {
            cockpitData.speedNeedle.rotation.z = THREE.MathUtils.damp(
              cockpitData.speedNeedle.rotation.z,
              THREE.MathUtils.lerp(2.18, -2.18, speedGauge),
              7,
              frameDt,
            );
          }
          if (cockpitData.fluxNeedle) {
            cockpitData.fluxNeedle.rotation.z = THREE.MathUtils.damp(
              cockpitData.fluxNeedle.rotation.z,
              THREE.MathUtils.lerp(2.18, -2.18, rider.energy / 100),
              7,
              frameDt,
            );
          }
          const roundedSpeed = Math.round(speedKph);
          const roundedFlux = Math.round(rider.energy);
          if (
            cockpitData.paintReadout &&
            (cockpitData.readout.speed !== roundedSpeed || cockpitData.readout.flux !== roundedFlux)
          ) {
            cockpitData.paintReadout(roundedSpeed, roundedFlux);
            cockpitData.readout.speed = roundedSpeed;
            cockpitData.readout.flux = roundedFlux;
          }
          if (cockpitData.energyMaterial) {
            cockpitData.energyMaterial.opacity = 0.72 + speedRatio * 0.18 + Math.sin(this.elapsed * 8) * 0.04;
          }
          if (cockpitData.windscreen) {
            cockpitData.windscreen.material.opacity = THREE.MathUtils.damp(
              cockpitData.windscreen.material.opacity,
              rider.speed > 10 ? 0.4 : 0.34,
              4,
              frameDt,
            );
          }
          if (cockpitData.glow) {
            cockpitData.glow.scale.setScalar(0.88 + speedRatio * 0.15 + Math.sin(this.elapsed * 7) * 0.025);
          }
        }
        this.world.setCameraBob(
          0,
          Math.abs(Math.sin(this.elapsed * 17)) * 0.006,
          0,
        );
      }
    }
  }

  update(dt) {
    this.elapsed += dt;
    if (this.world.phase !== 'running') return;

    // Round machine: countdown intro → live run → result pause before advance.
    if (this.cycleState === 'intro') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.cycleState = 'run';
        this.world.announce('GO // 8 SECOND SAFE VECTOR', 1.3);
      }
    } else if (this.cycleState === 'roundOver') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.advanceCycleCampaign();
    }
    const simActive = this.cycleState === 'run';

    if (simActive) this.roundElapsed += dt;
    this.turnCooldown = Math.max(0, this.turnCooldown - dt);
    this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
    this.emergencyStopTimer = Math.max(0, this.emergencyStopTimer - dt);
    this.emergencyStopCooldown = Math.max(0, this.emergencyStopCooldown - dt);
    if (simActive) {
      const previousGrace = this.aggressionGraceRemaining;
      this.aggressionGraceRemaining = Math.max(0, this.aggressionGraceRemaining - dt);
      if (previousGrace > 0 && this.aggressionGraceRemaining === 0) {
        this.world.announce('SAFE VECTOR ENDED // RIVAL AGGRESSION UNLOCKED', 1.6);
      }
    }
    const player = this.riders[0];

    const gamepad = this.readStandardGamepad();
    const xr = this.readXRMechanics(dt);
    const leftPressed = this.world.input.consumePress('KeyA') || this.world.input.consumePress('ArrowLeft');
    const rightPressed = this.world.input.consumePress('KeyD') || this.world.input.consumePress('ArrowRight');
    const keyboardTurn = leftPressed === rightPressed ? 0 : leftPressed ? -1 : 1;
    const xrTurn = this.world.consumeXRTurn();
    this.updateSteeringControls(dt, { keyboardTurn, xrTurn, xr, gamepad });

    const keyboardEmergency = this.world.input.consumePress('KeyX');
    const xrEmergency = this.world.consumeXRAction();
    if (keyboardEmergency || xrEmergency || gamepad.emergencyPressed) this.activateEmergencyStop();

    this.updateDashboardHeight(dt, xr.dashboardAdjust + gamepad.dashboardAdjust);
    if (this.world.input.consumePress('KeyQ') || this.world.consumeXRSecondary()) {
      player.trailOn = !player.trailOn;
      this.world.announce(player.trailOn ? 'LIGHTLINE ENGAGED' : 'LIGHTLINE SILENT', 0.75);
    }
    if (
      this.world.input.consumePress('KeyE') ||
      this.world.input.consumePress('KeyB')
    ) this.clearWithPulse();

    const boostRequested =
      this.world.input.isDown('Space') ||
      this.world.input.isDown('KeyW') ||
      this.world.input.isDown('ArrowUp') ||
      this.world.xrPrimaryHeld ||
      this.world.xrStickBoost ||
      xr.triggerBoost ||
      gamepad.boost;
    const boosting =
      boostRequested &&
      this.emergencyStopTimer <= 0 &&
      player.energy > 0 &&
      player.alive;
    const braking =
      this.world.input.isDown('ShiftLeft') ||
      this.world.input.isDown('ShiftRight') ||
      this.world.input.isDown('KeyS') ||
      this.world.input.isDown('ArrowDown') ||
      this.world.xrBrake ||
      xr.brake ||
      gamepad.brake;
    this.controllerTriggerBoost = xr.triggerBoost || gamepad.boost;
    this.boosting = boosting;
    this.braking = braking && this.emergencyStopTimer <= 0;
    if (boosting) player.energy = Math.max(0, player.energy - dt * 27);
    else player.energy = Math.min(100, player.energy + dt * 13);
    player.speed = this.emergencyStopTimer > 0
      ? 0
      : boosting
        ? this.tierSpeed.boost
        : braking
          ? this.tierSpeed.brake
          : this.tierSpeed.cruise;

    if (this.speedLines) {
      const attribute = this.speedLines.geometry.attributes.position;
      this.speedLineData.forEach((line, index) => {
        line.z += dt * player.speed * (boosting ? 2 : 1.25);
        if (line.z > -0.6) {
          line.z = -12 - this.random() * 10;
          line.x = (this.random() - 0.5) * 8;
          line.y = (this.random() - 0.45) * 4;
        }
        const length = line.length * (boosting ? 2.5 : 0.65);
        attribute.setXYZ(index * 2, line.x, line.y, line.z);
        attribute.setXYZ(index * 2 + 1, line.x, line.y, line.z - length);
      });
      attribute.needsUpdate = true;
      this.speedLines.material.opacity = THREE.MathUtils.damp(
        this.speedLines.material.opacity,
        this.emergencyStopTimer > 0 ? 0.01 : boosting ? 0.22 : 0.025,
        5,
        dt,
      );
    }

    if (simActive && player.respawnTimer > 0) {
      player.respawnTimer -= dt;
      if (player.respawnTimer <= 0 && this.world.phase === 'running') this.respawnPlayer(player);
    }

    for (const rider of this.riders) {
      if (!rider.alive) continue;
      if (simActive) {
        if (rider.analog) {
          this.advancePlayerAnalog(rider, dt);
        } else {
          rider.progress += dt * rider.speed;
          let safety = 0;
          while (rider.progress >= 1 && rider.alive && safety < 4) {
            rider.progress -= 1;
            this.stepRider(rider);
            safety += 1;
          }
        }
      }
      if (rider.alive) this.updateRiderVisual(rider, dt);
    }

    this.updateTrails(dt);
    this.updateCrashEffects(dt);
    updateBursts(this.bursts, dt);
    updateShockwaves(this.shockwaves, dt, this.world.camera);
    updateEnvironment(this.environment, this.elapsed, dt);
    if (this.animatedLights) {
      this.animatedLights.blue.intensity = 20 + Math.sin(this.elapsed * 1.7) * 2;
      this.animatedLights.red.intensity = 16 + Math.sin(this.elapsed * 1.3 + 1.4) * 2;
    }
    if (this.arenaPulse) {
      const slow = Math.sin(this.elapsed * 0.9);
      const beat = Math.sin(this.elapsed * 2.2);
      this.arenaPulse.grid.opacity = 0.32 + slow * 0.05;
      this.arenaPulse.outerGrid.opacity = 0.13 + Math.sin(this.elapsed * 0.55 + 2) * 0.04;
      this.arenaPulse.floor.emissiveIntensity = 0.62 + slow * 0.1;
      this.arenaPulse.lowerRail.opacity = 0.58 + beat * 0.09;
      this.arenaPulse.seam.opacity = 0.3 + Math.sin(this.elapsed * 1.4 + 0.8) * 0.1;
      this.arenaPulse.upperRail.opacity = 0.5 + Math.sin(this.elapsed * 1.1 + 1.9) * 0.07;
      this.arenaPulse.supports.opacity = 0.33 + Math.sin(this.elapsed * 1.8 + 3.1) * 0.07;
      this.arenaPulse.wall.emissiveIntensity = 0.4 + slow * 0.08;
    }
    if (simActive) this.score += dt * (boosting ? 28 : 10);
    const activeEnemies = this.riders.slice(1).filter((rider) => rider.alive).length;
    const pulseState = this.pulseCooldown <= 0 ? 'READY' : `${this.pulseCooldown.toFixed(1)}s`;
    const wins = '◆'.repeat(this.pWins) + '◇'.repeat(Math.max(0, 2 - this.pWins));
    const aggressionState = this.cycleState === 'intro'
      ? `LAUNCH ${Math.max(0, this.stateTimer).toFixed(1)}s`
      : this.cycleState === 'roundOver'
        ? (this.pWins > this.eWins ? 'ROUND WON' : 'ROUND LOST')
        : this.aggressionGraceRemaining > 0
          ? `SAFE VECTOR ${this.aggressionGraceRemaining.toFixed(1)}s`
          : `LIGHTLINE ${player.trailOn ? 'LIVE' : 'OFF'}`;
    this.world.updateHUD({
      mode: `LIGHTFIELD · TIER ${this.tier + 1}`,
      score: Math.round(this.score),
      health: player.health,
      resource: player.energy,
      resourceLabel: `FLUX ${Math.round(player.energy)}% · STOPS ${this.emergencyStopsRemaining} · PULSE ${pulseState}`,
      objective: `ROUND ${this.round}/3 · ${wins} · ${activeEnemies} RUNNERS · ${aggressionState}`,
      combo: this.emergencyStopTimer > 0 ? 'EMERGENCY HOLD' : this.kills ? `${this.kills} ERASED` : '',
      speed: `${Math.round(player.speed * this.cellSize * 14)} KPH${this.emergencyStopTimer > 0 ? ' · STOP' : ''}`,
    });
    this.world.updateMinimap({
      bounds: this.bounds,
      riders: this.riders.filter((rider) => rider.alive).map((rider) => ({
        id: rider.id,
        x: rider.analog ? rider.fx : rider.x,
        z: rider.analog ? rider.fz : rider.z,
        color: rider.color,
      })),
      trails: this.trails.map((trail) => ({
        owner: trail.owner,
        color: RIDER_COLORS[trail.owner],
        age: trail.age,
        maxAge: trail.maxAge,
        ax: trail.ax,
        az: trail.az,
        bx: trail.bx,
        bz: trail.bz,
      })),
    });
    this.updateCockpitTacticalMap();
  }

  primaryStart() {
    this.world.xrPrimaryHeld = true;
  }

  primaryEnd() {
    this.world.xrPrimaryHeld = false;
  }

  setShield(active) {
    if (active) this.clearWithPulse();
  }

  cancelInput() {
    this.standardPadEmergencyDown = false;
    this.steeringInput = 0;
    this.steerCharge = 0;
    this.steeringIntentDirection = 0;
    this.steeringIntentTime = 0;
    this.steeringNeutral = true;
    this.analogTurnArmed = true;
    this.neutralRearmTime = 0;
    this.headLeanActive = false;
    this.controllerLeanActive = false;
    this.smoothedHeadOffset = 0;
    this.smoothedControllerOffset = 0;
    this.controllerTriggerBoost = false;
    this.boosting = false;
    this.braking = false;
  }

  getState() {
    const player = this.riders[0];
    const nearbyTrails = this.trails
      .map((trail) => {
        const [x, z] = trail.key.split(',').map(Number);
        return {
          x,
          z,
          owner: trail.owner,
          age: +trail.age.toFixed(1),
          distance: Math.abs(x - player.x) + Math.abs(z - player.z),
        };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 24)
      .map(({ distance, ...trail }) => trail);
    return {
      mode: 'lightline_pursuit',
      coordinateSystem: `integer grid cells within ±${this.bounds}; +x east/right, +z south/back, north is -z`,
      elapsed: +this.elapsed.toFixed(1),
      arenaBounds: this.bounds,
      arenaSizeMeters: +(this.bounds * this.cellSize * 2).toFixed(1),
      campaign: {
        tier: this.tier,
        round: this.round,
        state: this.cycleState,
        pWins: this.pWins,
        eWins: this.eWins,
        cruiseSpeed: this.tierSpeed.cruise,
      },
      aggressionGrace: {
        duration: this.aggressionGraceDuration,
        remaining: +this.aggressionGraceRemaining.toFixed(2),
        active: this.aggressionGraceRemaining > 0,
      },
      emergencyStops: {
        perRound: EMERGENCY_STOPS_PER_ROUND,
        remaining: this.emergencyStopsRemaining,
        active: this.emergencyStopTimer > 0,
        activeFor: +this.emergencyStopTimer.toFixed(2),
        cooldown: +this.emergencyStopCooldown.toFixed(2),
      },
      dashboard: {
        height: +this.dashboardHeight.toFixed(3),
        adjustment: +this.dashboardAdjustInput.toFixed(2),
        persistent: true,
        panelsStayLevel: true,
      },
      steering: {
        source: this.steeringSource,
        input: +this.steeringInput.toFixed(2),
        charge: +this.steerCharge.toFixed(2),
        neutral: this.steeringNeutral,
        intentSeconds: +this.steeringIntentTime.toFixed(2),
        turnArmed: this.analogTurnArmed,
        neutralRearmSeconds: +this.neutralRearmTime.toFixed(2),
        vrLeanCalibrated: this.leanCalibrated,
        headLean: +this.headLean.toFixed(2),
        controllerLean: +this.controllerLean.toFixed(2),
        headOffsetMeters: +this.headOffsetMeters.toFixed(3),
        controllerOffsetMeters: +this.controllerOffsetMeters.toFixed(3),
        headLeanActive: this.headLeanActive,
        controllerLeanActive: this.controllerLeanActive,
        cockpitRollDegrees: +THREE.MathUtils.radToDeg(this.cockpit?.rotation.z || 0).toFixed(2),
        syntheticLateralBobMeters: 0,
      },
      overheadMap: this.cockpit?.userData.tacticalMap
        ? 'head_locked_vr_upper_right'
        : 'screen_locked_upper_right',
      player: {
        cellX: player.x,
        cellZ: player.z,
        direction: ['north', 'east', 'south', 'west'][player.direction],
        speed: +player.speed.toFixed(1),
        health: player.health,
        flux: Math.round(player.energy),
        trailOn: player.trailOn,
        pulseCooldown: +this.pulseCooldown.toFixed(1),
        boosting: this.boosting,
        braking: this.braking,
        emergencyStopped: this.emergencyStopTimer > 0,
        alive: player.alive,
        respawnIn: +Math.max(0, player.respawnTimer).toFixed(1),
      },
      enemies: this.riders.slice(1).map((rider) => ({
        id: rider.id,
        role: rider.role,
        x: rider.x,
        z: rider.z,
        direction: ['north', 'east', 'south', 'west'][rider.direction],
        alive: rider.alive,
      })),
      activeTrailCells: this.occupancy.size,
      decayingTrailSegments: this.trails.length,
      nearbyTrailCells: nearbyTrails,
      score: Math.round(this.score),
      eliminations: this.kills,
    };
  }

  dispose() {
    if (this.cockpit) {
      this.cockpit.userData.readout?.texture?.dispose();
      const tacticalMap = this.cockpit.userData.tacticalMap;
      tacticalMap?.texture?.dispose();
      if (tacticalMap?.group) {
        tacticalMap.group.removeFromParent();
        disposeObject(tacticalMap.group);
      }
      disposeObject(this.cockpit);
    }
    this.markerTextures.forEach((texture) => texture.dispose());
    this.markerTextures.length = 0;
    this.debris.forEach((piece) => disposeObject(piece.mesh));
    this.debris.length = 0;
    this.crashFlashes.forEach((flash) => {
      flash.light.removeFromParent();
      disposeObject(flash.column);
    });
    this.crashFlashes.length = 0;
    this.world.camera.far = this.previousCameraFar;
    this.world.camera.updateProjectionMatrix();
    if (this.world.scene.fog && this.previousFogDensity !== null) {
      this.world.scene.fog.density = this.previousFogDensity;
    }
    this.world.setEyeHeight(1.65);
    this.world.clearMinimap();
    disposeObject(this.root);
  }
}
