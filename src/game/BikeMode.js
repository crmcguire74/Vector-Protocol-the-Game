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

const DIRECTIONS = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

const RIDER_COLORS = [COLORS.cyan, COLORS.coral, COLORS.amber, COLORS.violet];

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
    this.bounds = 18;
    this.originalBounds = this.bounds;
    this.occupancy = new Map();
    this.trails = [];
    this.trailSerial = 0;
    this.riders = [];
    this.bursts = [];
    this.shockwaves = [];
    this.elapsed = 0;
    this.score = 0;
    this.kills = 0;
    this.wave = 1;
    this.turnCooldown = 0;
    this.pulseCooldown = 0;
    this.borders = [];
    this.cockpit = null;
    this.buildWorld();
    if (this.isTabletopAR) this.root.scale.setScalar(0.08);
    this.spawnRiders();
    if (!this.isTabletopAR) this.buildCockpit();
    this.world.setEyeHeight(0.88);
    this.world.setYaw(0);
    this.world.announce('LIGHTLINE PURSUIT // OUTRUN THE GRID', 2.5);
  }

  buildWorld() {
    this.environment = createEnvironment({ ar: this.world.presentation === 'ar' });
    this.root.add(this.environment);
    const ambient = new THREE.HemisphereLight(0xb9fdff, 0x05020a, 1.2);
    const key = new THREE.DirectionalLight(0xe9ffff, 2.6);
    key.position.set(-8, 18, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const red = new THREE.PointLight(COLORS.coral, 40, 45, 2);
    red.position.set(-16, 7, -14);
    const blue = new THREE.PointLight(COLORS.cyan, 46, 45, 2);
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

    const borderMaterial = new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.78 });
    const borderLength = span;
    for (let i = 0; i < 4; i += 1) {
      const border = new THREE.Mesh(new THREE.BoxGeometry(borderLength, 0.08, 0.08), borderMaterial);
      border.position.y = 0.08;
      if (i < 2) {
        border.position.z = (i ? 1 : -1) * (this.bounds + 0.8) * this.cellSize;
      } else {
        border.rotation.y = Math.PI / 2;
        border.position.x = (i === 2 ? -1 : 1) * (this.bounds + 0.8) * this.cellSize;
      }
      this.root.add(border);
      this.borders.push(border);
    }

    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const radius = span * 0.76;
      const pylon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.65, 6 + (i % 3) * 2.5, 6),
        new THREE.MeshStandardMaterial({
          color: 0x07101a,
          metalness: 0.82,
          roughness: 0.28,
          emissive: i % 2 ? COLORS.violet : COLORS.cyan,
          emissiveIntensity: 0.2,
        }),
      );
      pylon.position.set(Math.sin(angle) * radius, pylon.geometry.parameters.height * 0.5 - 0.2, Math.cos(angle) * radius);
      pylon.rotation.z = (i % 2 ? -1 : 1) * 0.08;
      this.root.add(pylon);
    }

    for (const z of [-11, 0, 11]) {
      const gate = new THREE.Group();
      const left = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 3.2, 0.14),
        new THREE.MeshBasicMaterial({ color: z === 0 ? COLORS.violet : COLORS.cyan, toneMapped: false }),
      );
      left.position.set(-this.bounds * this.cellSize * 0.72, 1.6, z * this.cellSize);
      const right = left.clone();
      right.position.x *= -1;
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(this.bounds * this.cellSize * 1.44, 0.08, 0.08),
        left.material,
      );
      top.position.set(0, 3.18, z * this.cellSize);
      gate.add(left, right, top);
      this.root.add(gate);
    }
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
    instrumentRig.position.set(0, -0.29, -0.79);
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

    const linePositions = new Float32Array(72 * 6);
    const speedLineGeometry = new THREE.BufferGeometry();
    const speedLineAttribute = new THREE.BufferAttribute(linePositions, 3);
    speedLineAttribute.setUsage(THREE.DynamicDrawUsage);
    speedLineGeometry.setAttribute('position', speedLineAttribute);
    const speedLines = new THREE.LineSegments(
      speedLineGeometry,
      new THREE.LineBasicMaterial({
        color: COLORS.ice,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const speedLineData = [];
    for (let index = 0; index < 72; index += 1) {
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
    cockpit.userData.windscreen = windscreen;
    cockpit.userData.speedNeedle = speedNeedle;
    cockpit.userData.fluxNeedle = fluxNeedle;
    cockpit.userData.energyMaterial = energy;
    cockpit.userData.glow = glow;
    cockpit.userData.paintReadout = paintReadout;
    cockpit.userData.readout = { speed: -1, flux: -1, texture: displayTexture };
    cockpit.userData.basePosition = new THREE.Vector3();
    this.speedLines = speedLines;
    this.speedLineData = speedLineData;
    this.world.camera.add(cockpit);
    this.cockpit = cockpit;
  }

  spawnRiders() {
    this.riders.length = 0;
    this.spawnRider({ id: 0, x: 0, z: 13, direction: 0, role: 'PLAYER' });
    this.spawnRider({ id: 1, x: -12, z: -9, direction: 1, role: 'TRAPPER' });
    this.spawnRider({ id: 2, x: 6, z: 3, direction: 2, role: 'HUNTER' });
    this.spawnRider({ id: 3, x: -6, z: 8, direction: 1, role: 'ROGUE' });
  }

  spawnRider({ id, x, z, direction, role }) {
    const color = RIDER_COLORS[id];
    const mesh = createBike(color, id !== 0);
    mesh.position.set(x * this.cellSize, 0, z * this.cellSize);
    mesh.rotation.y = direction * -Math.PI / 2;
    if (id === 0) mesh.visible = this.isTabletopAR;
    if (id !== 0) {
      const riderMesh = createHumanoid(color, role);
      riderMesh.scale.setScalar(0.34);
      riderMesh.position.set(0, 0.43, 0.25);
      riderMesh.rotation.x = -0.46;
      riderMesh.userData.limbs[0].rotation.x = -0.72;
      riderMesh.userData.limbs[1].rotation.x = -0.72;
      mesh.add(riderMesh);
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
      speed: id === 0 ? 7.7 : 6.5 + this.random() * 1.4,
      mesh,
      alive: true,
      trailOn: true,
      energy: 100,
      health: id === 0 ? 100 : 1,
      steps: 0,
      respawnTimer: 0,
      crashOwner: null,
    };
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

  chooseAITurn(rider) {
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
      if (rider.role === 'HUNTER' && player?.alive) {
        const nextX = rider.x + vector.x * 3;
        const nextZ = rider.z + vector.z * 3;
        const before = Math.abs(rider.x - player.x) + Math.abs(rider.z - player.z);
        const after = Math.abs(nextX - player.x) + Math.abs(nextZ - player.z);
        score += (before - after) * 1.4;
      }
      if (rider.role === 'TRAPPER' && player?.alive) {
        if (Math.abs(rider.x - player.x) < 5 || Math.abs(rider.z - player.z) < 5) score += turn === 0 ? -2 : 6;
      }
      if (rider.role === 'ROGUE') score += this.random() * 10;
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
    this.trails.push({ id, owner: rider.id, key, mesh, age: 0, maxAge: 12 });
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
    this.bursts.push(createParticleBurst(this.root, impact, rider.color, rider.id === 0 ? 46 : 32, 0.16));
    this.shockwaves.push(createShockwave(this.root, impact, rider.color, true));
    if (rider.id === 0) {
      rider.health -= 50;
      this.world.damageFeedback(50);
      if (rider.health <= 0) {
        this.world.endGame(false, {
          title: 'LIGHTLINE COLLAPSE',
          detail: `${this.kills} eliminations · Signal ${Math.round(this.score).toLocaleString()}`,
        });
      } else {
        rider.respawnTimer = 1.25;
        this.world.announce('ARMOR SHATTERED // ONE LAYER REMAINS', 1.4);
      }
    } else {
      this.kills += 1;
      const bonus = collisionOwner === 0 ? 900 : 350;
      this.score += bonus;
      this.world.announce(`${rider.role} ERASED // +${bonus}`, 1.1);
      if (this.riders.slice(1).every((enemy) => !enemy.alive)) {
        this.world.endGame(true, {
          title: 'THE GRID IS YOURS',
          detail: `${this.kills} eliminations · Signal ${Math.round(this.score).toLocaleString()}`,
        });
      }
    }
  }

  respawnPlayer(rider) {
    const candidates = [
      { x: 0, z: 13, direction: 0 },
      { x: 13, z: 13, direction: 3 },
      { x: -13, z: 13, direction: 1 },
      { x: 0, z: -13, direction: 2 },
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
    rider.alive = true;
    rider.mesh.visible = this.isTabletopAR;
    rider.energy = Math.max(35, rider.energy);
    this.occupancy.set(this.cellKey(rider.x, rider.z), { id: ++this.trailSerial, owner: 0, live: true });
  }

  stepRider(rider) {
    if (!rider.alive) return;
    if (rider.id !== 0 && (rider.steps % 3 === 0 || this.random() < 0.07)) this.chooseAITurn(rider);
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
        trail.mesh.userData.wall.material.opacity = opacity * 0.48;
        trail.mesh.userData.edge.material.opacity = opacity * 0.86;
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

  updateRiderVisual(rider, dt = 1 / 60) {
    const direction = DIRECTIONS[rider.direction];
    const x = (rider.x + direction.x * rider.progress) * this.cellSize;
    const z = (rider.z + direction.z * rider.progress) * this.cellSize;
    const frameDt = Math.min(dt, 0.05);
    const visual = rider.mesh.userData;
    const speedRatio = THREE.MathUtils.clamp(rider.speed / 11.2, 0, 1);
    const targetYaw = -rider.direction * Math.PI / 2;
    if (!Number.isFinite(visual.visualYaw)) visual.visualYaw = targetYaw;

    if (visual.lastDirection === null || visual.lastDirection === undefined) {
      visual.lastDirection = rider.direction;
    } else if (visual.lastDirection !== rider.direction) {
      const directionDelta = (rider.direction - visual.lastDirection + 4) % 4;
      visual.turnImpulse = directionDelta === 1 ? 1 : directionDelta === 3 ? -1 : 0;
      visual.lastDirection = rider.direction;
    }
    const steerSignal = THREE.MathUtils.clamp(rider.queuedTurn || visual.turnImpulse || 0, -1, 1);
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
        const position = new THREE.Vector3(x, 0.08 + Math.sin(this.elapsed * 18) * 0.012, z);
        this.world.setPlayerPosition(position);
        this.world.setYaw(visual.visualYaw);
        if (this.cockpit) {
          const cockpitData = this.cockpit.userData;
          const roadPulse = Math.sin(suspensionPhase) * (0.002 + speedRatio * 0.006);
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
          Math.sin(this.elapsed * 8.5) * 0.012,
          Math.abs(Math.sin(this.elapsed * 17)) * 0.012,
          0,
        );
      }
    }
  }

  update(dt) {
    this.elapsed += dt;
    if (this.world.phase !== 'running') return;
    this.turnCooldown = Math.max(0, this.turnCooldown - dt);
    this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
    const player = this.riders[0];

    if (this.world.input.consumePress('KeyA') || this.world.input.consumePress('ArrowLeft')) this.queuePlayerTurn(-1);
    if (this.world.input.consumePress('KeyD') || this.world.input.consumePress('ArrowRight')) this.queuePlayerTurn(1);
    const xrTurn = this.world.consumeXRTurn();
    if (xrTurn) this.queuePlayerTurn(xrTurn);
    if (this.world.input.consumePress('KeyQ') || this.world.consumeXRSecondary()) {
      player.trailOn = !player.trailOn;
      this.world.announce(player.trailOn ? 'LIGHTLINE ENGAGED' : 'LIGHTLINE SILENT', 0.75);
    }
    if (
      this.world.input.consumePress('KeyE') ||
      this.world.input.consumePress('KeyB') ||
      this.world.consumeXRAction()
    ) this.clearWithPulse();

    const boosting =
      (this.world.input.isDown('Space') || this.world.xrPrimaryHeld || this.world.xrStickBoost) &&
      player.energy > 0 &&
      player.alive;
    const braking = this.world.input.isDown('ShiftLeft') || this.world.input.isDown('ShiftRight') || this.world.xrBrake;
    if (boosting) player.energy = Math.max(0, player.energy - dt * 27);
    else player.energy = Math.min(100, player.energy + dt * 13);
    player.speed = boosting ? 11.2 : braking ? 4.9 : 7.7;

    if (this.speedLines) {
      const attribute = this.speedLines.geometry.attributes.position;
      this.speedLineData.forEach((line, index) => {
        line.z += dt * player.speed * (boosting ? 2.8 : 1.65);
        if (line.z > -0.6) {
          line.z = -12 - this.random() * 10;
          line.x = (this.random() - 0.5) * 8;
          line.y = (this.random() - 0.45) * 4;
        }
        const length = line.length * (boosting ? 4.2 : 1.8);
        attribute.setXYZ(index * 2, line.x, line.y, line.z);
        attribute.setXYZ(index * 2 + 1, line.x, line.y, line.z - length);
      });
      attribute.needsUpdate = true;
      this.speedLines.material.opacity = THREE.MathUtils.damp(
        this.speedLines.material.opacity,
        boosting ? 0.62 : 0.17,
        5,
        dt,
      );
    }

    if (player.respawnTimer > 0) {
      player.respawnTimer -= dt;
      if (player.respawnTimer <= 0 && this.world.phase === 'running') this.respawnPlayer(player);
    }

    for (const rider of this.riders) {
      if (!rider.alive) continue;
      rider.progress += dt * rider.speed;
      let safety = 0;
      while (rider.progress >= 1 && rider.alive && safety < 4) {
        rider.progress -= 1;
        this.stepRider(rider);
        safety += 1;
      }
      this.updateRiderVisual(rider, dt);
    }

    this.updateTrails(dt);
    updateBursts(this.bursts, dt);
    updateShockwaves(this.shockwaves, dt, this.world.camera);
    updateEnvironment(this.environment, this.elapsed, dt);
    if (this.animatedLights) {
      this.animatedLights.blue.intensity = 38 + Math.sin(this.elapsed * 1.7) * 12;
      this.animatedLights.red.intensity = 34 + Math.sin(this.elapsed * 1.3 + 1.4) * 10;
    }
    if (this.elapsed > 55 && this.bounds > 14) {
      this.compressArena(14);
      this.world.announce('GRID COMPRESSION // BOUNDARY CLOSING', 1.8);
    }

    this.score += dt * (boosting ? 28 : 10);
    const activeEnemies = this.riders.slice(1).filter((rider) => rider.alive).length;
    this.world.updateHUD({
      mode: 'LIGHTLINE PURSUIT',
      score: Math.round(this.score),
      health: player.health,
      resource: player.energy,
      resourceLabel: `FLUX ${Math.round(player.energy)}% · PULSE ${this.pulseCooldown <= 0 ? 'READY' : this.pulseCooldown.toFixed(1) + 's'}`,
      objective: `${activeEnemies} RUNNERS ACTIVE · LIGHTLINE ${player.trailOn ? 'LIVE' : 'OFF'}`,
      combo: this.kills ? `${this.kills} ERASED` : '',
      speed: `${Math.round(player.speed * this.cellSize * 14)} KPH`,
    });
    this.world.updateMinimap({
      bounds: this.bounds,
      riders: this.riders.filter((rider) => rider.alive).map((rider) => ({ id: rider.id, x: rider.x, z: rider.z, color: rider.color })),
    });
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
      player: {
        cellX: player.x,
        cellZ: player.z,
        direction: ['north', 'east', 'south', 'west'][player.direction],
        speed: +player.speed.toFixed(1),
        health: player.health,
        flux: Math.round(player.energy),
        trailOn: player.trailOn,
        pulseCooldown: +this.pulseCooldown.toFixed(1),
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
      disposeObject(this.cockpit);
    }
    this.world.setEyeHeight(1.65);
    this.world.clearMinimap();
    disposeObject(this.root);
  }
}
