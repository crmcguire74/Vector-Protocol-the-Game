import * as THREE from 'three';

const glowTextures = new Map();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
let cathedralTexture = null;
let armorTexture = null;
let skyGradientTexture = null;
let cityWindowTexture = null;
let cloudTexture = null;

// Night-sky gradient for the grid-city horizon: near-black zenith falling
// into a teal storm glow at the horizon line.
export function getSkyGradientTexture() {
  if (skyGradientTexture) return skyGradientTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#010208');
  gradient.addColorStop(0.42, '#02060f');
  gradient.addColorStop(0.66, '#04141d');
  gradient.addColorStop(0.82, '#073039');
  gradient.addColorStop(1, '#0a3f47');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 256);
  skyGradientTexture = new THREE.CanvasTexture(canvas);
  skyGradientTexture.colorSpace = THREE.SRGBColorSpace;
  return skyGradientTexture;
}

// Shared lit-window texture for the distant city skyline.
export function getCityWindowTexture() {
  if (cityWindowTexture) return cityWindowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#02070c';
  context.fillRect(0, 0, 64, 128);
  const random = seededRandom(4127);
  const palette = ['#39f6ff', '#bffcff', '#7ecfe0', '#885cff'];
  for (let row = 4; row < 124; row += 6) {
    for (let column = 4; column < 60; column += 6) {
      if (random() > 0.36) continue;
      context.fillStyle = palette[Math.floor(random() * palette.length)];
      context.globalAlpha = 0.35 + random() * 0.65;
      context.fillRect(column, row, 3, 2);
    }
  }
  context.globalAlpha = 1;
  cityWindowTexture = new THREE.CanvasTexture(canvas);
  cityWindowTexture.colorSpace = THREE.SRGBColorSpace;
  return cityWindowTexture;
}

// Soft storm-cloud alpha blobs for the slow ceiling drift.
export function getCloudTexture() {
  if (cloudTexture) return cloudTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const random = seededRandom(7351);
  for (let index = 0; index < 46; index += 1) {
    const x = random() * 256;
    const y = random() * 256;
    const radius = 18 + random() * 44;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,0.34)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }
  cloudTexture = new THREE.CanvasTexture(canvas);
  cloudTexture.wrapS = THREE.RepeatWrapping;
  cloudTexture.wrapT = THREE.RepeatWrapping;
  return cloudTexture;
}

export function getCathedralTexture() {
  if (cathedralTexture) return cathedralTexture;
  cathedralTexture = new THREE.TextureLoader().load('/assets/digital-cathedral.png');
  cathedralTexture.colorSpace = THREE.SRGBColorSpace;
  cathedralTexture.mapping = THREE.EquirectangularReflectionMapping;
  cathedralTexture.anisotropy = 8;
  return cathedralTexture;
}

export function getArmorTexture() {
  if (armorTexture) return armorTexture;
  armorTexture = new THREE.TextureLoader().load('/assets/obsidian-armor-panels.png');
  armorTexture.colorSpace = THREE.SRGBColorSpace;
  armorTexture.wrapS = THREE.RepeatWrapping;
  armorTexture.wrapT = THREE.RepeatWrapping;
  armorTexture.repeat.set(2, 2);
  armorTexture.anisotropy = 8;
  return armorTexture;
}

export const COLORS = {
  void: 0x02050b,
  ink: 0x07111a,
  cyan: 0x39f6ff,
  ice: 0xc9ffff,
  coral: 0xff4d65,
  amber: 0xffc857,
  violet: 0x885cff,
  lime: 0x7dffb2,
};

export function seededRandom(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function glowTexture(color = '#ffffff') {
  if (glowTextures.has(color)) return glowTextures.get(color);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.1, color);
  gradient.addColorStop(0.35, `${color}aa`);
  gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  glowTextures.set(color, texture);
  return texture;
}

export function createGlow(color, scale = 1, opacity = 0.9) {
  const hex = `#${new THREE.Color(color).getHexString()}`;
  const material = new THREE.SpriteMaterial({
    map: glowTexture(hex),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(scale);
  return sprite;
}

export function createEnvironment({ ar = false } = {}) {
  const root = new THREE.Group();
  root.name = 'digital-cathedral';

  if (!ar) {
    // Night-storm sky behind everything else.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(84, 32, 24),
      new THREE.MeshBasicMaterial({
        map: getSkyGradientTexture(),
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    sky.scale.y = 0.6;
    sky.renderOrder = -3;
    root.add(sky);

    const panorama = new THREE.Mesh(
      new THREE.SphereGeometry(69, 64, 32),
      new THREE.MeshBasicMaterial({
        map: getCathedralTexture(),
        color: 0x607988,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        fog: false,
      }),
    );
    panorama.scale.y = 0.64;
    panorama.rotation.y = Math.PI;
    panorama.renderOrder = -2;
    panorama.name = 'photoreal-digital-cathedral';
    root.add(panorama);

    // Distant grid-city skyline: one instanced draw call of lit towers.
    const cityRandom = seededRandom(6203);
    const buildingCount = 150;
    const city = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ map: getCityWindowTexture(), fog: false }),
      buildingCount,
    );
    city.name = 'grid-city-skyline';
    const cityTransform = new THREE.Matrix4();
    const cityQuaternion = new THREE.Quaternion();
    const cityScale = new THREE.Vector3();
    const cityPosition = new THREE.Vector3();
    for (let index = 0; index < buildingCount; index += 1) {
      const angle = (index / buildingCount) * Math.PI * 2 + cityRandom() * 0.09;
      const radius = 47 + cityRandom() * 15;
      const height = 3.5 + cityRandom() ** 2 * 23;
      cityScale.set(1.6 + cityRandom() * 3.4, height, 1.6 + cityRandom() * 3.4);
      cityPosition.set(Math.cos(angle) * radius, -9 + height * 0.5, Math.sin(angle) * radius);
      cityQuaternion.setFromAxisAngle(UP_AXIS, cityRandom() * Math.PI);
      cityTransform.compose(cityPosition, cityQuaternion, cityScale);
      city.setMatrixAt(index, cityTransform);
    }
    city.instanceMatrix.needsUpdate = true;
    root.add(city);

    // Horizon energy glow rising behind the skyline.
    const horizonGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(66, 66, 9, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x0f6a78,
        transparent: true,
        opacity: 0.34,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    horizonGlow.position.y = -6;
    horizonGlow.renderOrder = -1;
    root.add(horizonGlow);

    // Slow-drifting storm-cloud deck overhead.
    const clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      new THREE.MeshBasicMaterial({
        color: 0x123037,
        alphaMap: getCloudTexture(),
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
    clouds.rotation.x = Math.PI / 2;
    clouds.position.y = 36;
    root.add(clouds);
    root.userData.sky = sky;
    root.userData.city = city;
    root.userData.horizonGlow = horizonGlow;
    root.userData.clouds = clouds;

    const dome = new THREE.Mesh(
      new THREE.IcosahedronGeometry(72, 2),
      new THREE.MeshBasicMaterial({
        color: 0x030812,
        side: THREE.BackSide,
        wireframe: true,
        transparent: true,
        opacity: 0.13,
      }),
    );
    dome.scale.set(1, 0.58, 1);
    root.add(dome);

    const random = seededRandom(913);
    const points = [];
    const colors = [];
    const cyan = new THREE.Color(COLORS.cyan);
    const violet = new THREE.Color(COLORS.violet);
    for (let i = 0; i < 650; i += 1) {
      const radius = 24 + random() * 52;
      const angle = random() * Math.PI * 2;
      points.push(
        Math.cos(angle) * radius,
        -10 + random() * 38,
        Math.sin(angle) * radius,
      );
      const color = cyan.clone().lerp(violet, random());
      colors.push(color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.11,
        vertexColors: true,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    stars.name = 'data-stars';
    root.add(stars);

    for (let i = 0; i < 7; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(10 + i * 4.7, 0.025 + i * 0.009, 5, 96),
        new THREE.MeshBasicMaterial({
          color: i % 2 ? COLORS.violet : COLORS.cyan,
          transparent: true,
          opacity: 0.09 + i * 0.012,
          blending: THREE.AdditiveBlending,
        }),
      );
      ring.rotation.x = Math.PI / 2 + (i - 3) * 0.035;
      ring.position.y = -6 + i * 2.2;
      ring.userData.baseY = ring.position.y;
      root.add(ring);
      if (!root.userData.rings) root.userData.rings = [];
      root.userData.rings.push(ring);
    }

    // Energy pulses that circulate the circuit rings like packets on a bus.
    const pulseArcs = [];
    for (let i = 0; i < 4; i += 1) {
      const ringIndex = 1 + i * 2;
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(10 + ringIndex * 4.7, 0.05, 5, 24, 0.42),
        new THREE.MeshBasicMaterial({
          color: i % 2 ? COLORS.violet : COLORS.cyan,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      arc.rotation.x = Math.PI / 2 + (ringIndex - 3) * 0.035;
      arc.position.y = -6 + ringIndex * 2.2;
      arc.userData.speed = (i % 2 ? -1 : 1) * (0.24 + i * 0.09);
      root.add(arc);
      pulseArcs.push(arc);
    }

    // Rising data streams: thin vertical streaks climbing out of the depths,
    // wrapping back down once they pass the upper haze.
    const rainCount = 120;
    const rainPositions = new Float32Array(rainCount * 6);
    const rainColors = new Float32Array(rainCount * 6);
    const rainData = [];
    const ice = new THREE.Color(0xbdfdff);
    for (let i = 0; i < rainCount; i += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 21 + random() * 38;
      const drop = {
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        y: -12 + random() * 46,
        speed: 1.4 + random() * 3.6,
        length: 0.5 + random() * 1.7,
      };
      rainData.push(drop);
      const color = (i % 5 === 0 ? ice : cyan).clone().lerp(violet, random() * 0.75);
      for (const end of [0, 1]) {
        rainColors[i * 6 + end * 3] = color.r;
        rainColors[i * 6 + end * 3 + 1] = color.g;
        rainColors[i * 6 + end * 3 + 2] = color.b;
      }
    }
    const rainGeometry = new THREE.BufferGeometry();
    const rainAttribute = new THREE.BufferAttribute(rainPositions, 3);
    rainAttribute.setUsage(THREE.DynamicDrawUsage);
    rainGeometry.setAttribute('position', rainAttribute);
    rainGeometry.setAttribute('color', new THREE.BufferAttribute(rainColors, 3));
    const dataRain = new THREE.LineSegments(
      rainGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    dataRain.name = 'rising-data-streams';
    root.add(dataRain);

    // Distant data spires along the horizon with individual flicker phases.
    const beams = [];
    const beamGroup = new THREE.Group();
    beamGroup.name = 'horizon-data-spires';
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2 + random() * 0.3;
      const radius = 52 + random() * 9;
      const height = 9 + random() * 21;
      const beam = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34 + random() * 0.7, height),
        new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? COLORS.violet : COLORS.cyan,
          transparent: true,
          opacity: 0.14,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      );
      beam.position.set(Math.cos(angle) * radius, -9 + height * 0.5, Math.sin(angle) * radius);
      beam.rotation.y = -angle + Math.PI / 2;
      beam.userData.phase = random() * Math.PI * 2;
      beam.userData.rate = 0.5 + random() * 1.4;
      beam.userData.baseOpacity = 0.09 + random() * 0.1;
      beamGroup.add(beam);
      beams.push(beam);
    }
    root.add(beamGroup);

    root.userData.panorama = panorama;
    root.userData.stars = stars;
    root.userData.dome = dome;
    root.userData.pulseArcs = pulseArcs;
    root.userData.dataRain = { mesh: dataRain, data: rainData, attribute: rainAttribute };
    root.userData.beams = beams;
  }

  return root;
}

export function updateEnvironment(root, time, dt) {
  if (!root) return;
  root.userData.panorama && (root.userData.panorama.rotation.y += dt * 0.0025);
  if (root.userData.stars) {
    root.userData.stars.rotation.y -= dt * 0.008;
    root.userData.stars.material.opacity = 0.55 + Math.sin(time * 0.35) * 0.13;
  }
  root.userData.rings?.forEach((ring, index) => {
    ring.rotation.z += dt * (index % 2 ? -0.008 : 0.006);
    ring.material.opacity = 0.08 + index * 0.012 + Math.sin(time * 0.5 + index) * 0.025;
    ring.position.y = ring.userData.baseY + Math.sin(time * 0.32 + index * 1.7) * 0.09;
  });
  if (root.userData.dome) root.userData.dome.rotation.y += dt * 0.004;
  root.userData.pulseArcs?.forEach((arc, index) => {
    arc.rotation.z += dt * arc.userData.speed;
    arc.material.opacity = 0.34 + Math.sin(time * 2.1 + index * 1.9) * 0.18;
  });
  if (root.userData.dataRain) {
    const { data, attribute } = root.userData.dataRain;
    const positions = attribute.array;
    for (let i = 0; i < data.length; i += 1) {
      const drop = data[i];
      drop.y += drop.speed * dt;
      if (drop.y > 36) drop.y = -13 - ((i * 29) % 40) * 0.1;
      const base = i * 6;
      positions[base] = drop.x;
      positions[base + 1] = drop.y;
      positions[base + 2] = drop.z;
      positions[base + 3] = drop.x;
      positions[base + 4] = drop.y + drop.length;
      positions[base + 5] = drop.z;
    }
    attribute.needsUpdate = true;
  }
  root.userData.beams?.forEach((beam) => {
    const flicker = Math.sin(time * beam.userData.rate + beam.userData.phase);
    beam.material.opacity = beam.userData.baseOpacity + Math.max(0, flicker) * 0.1;
  });
  if (root.userData.clouds) {
    root.userData.clouds.rotation.z += dt * 0.006;
  }
  if (root.userData.horizonGlow) {
    root.userData.horizonGlow.material.opacity = 0.3 + Math.sin(time * 0.4) * 0.07;
  }
}

export function createPlatform(radius, height = 0, accent = COLORS.cyan, seed = 0) {
  const root = new THREE.Group();
  root.position.y = height;
  root.userData.radius = radius;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.86, 0.52, 64, 1, false),
    new THREE.MeshStandardMaterial({
      color: 0x59656c,
      map: getArmorTexture(),
      metalness: 0.84,
      roughness: 0.25,
      emissive: new THREE.Color(accent).multiplyScalar(0.08),
    }),
  );
  body.position.y = -0.26;
  body.receiveShadow = true;
  root.add(body);

  const top = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.97, 64),
    new THREE.MeshStandardMaterial({
      color: 0x485158,
      map: getArmorTexture(),
      metalness: 0.78,
      roughness: 0.32,
      emissive: 0x06131a,
      emissiveIntensity: 0.7,
    }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.008;
  top.receiveShadow = true;
  root.add(top);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.985, 0.055, 8, 96),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(0.62) }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.025;
  root.add(rim);

  const innerRim = rim.clone();
  innerRim.geometry = new THREE.TorusGeometry(radius * 0.65, 0.014, 5, 72);
  innerRim.material = rim.material.clone();
  innerRim.material.transparent = true;
  innerRim.material.opacity = 0.5;
  innerRim.position.y = 0.035;
  root.add(innerRim);

  const random = seededRandom(seed + 42);
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + random() * 0.12;
    const length = radius * (0.2 + random() * 0.38);
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(Math.cos(angle) * radius * 0.15, 0.038, Math.sin(angle) * radius * 0.15),
      new THREE.Vector3(Math.cos(angle) * length, 0.038, Math.sin(angle) * length),
    ]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.28 }),
    );
    root.add(line);
  }

  const underGlow = createGlow(accent, radius * 2.45, 0.14);
  underGlow.position.y = -0.48;
  underGlow.material.depthWrite = false;
  root.add(underGlow);
  root.userData.rim = rim;
  root.userData.innerRim = innerRim;
  root.userData.underGlow = underGlow;
  root.userData.top = top;
  return root;
}

export function createRoomFootprint({
  width = 6,
  depth = 7,
  floorY = 0,
  centerX = 0,
  centerZ = -1.2,
  color = COLORS.cyan,
} = {}) {
  const root = new THREE.Group();
  root.name = 'ar-room-footprint';
  root.position.set(centerX, floorY, centerZ);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth, Math.max(1, Math.round(width)), Math.max(1, Math.round(depth))),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(0.3),
      transparent: true,
      opacity: 0.055,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  floor.name = 'room-footprint-floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.004;
  root.add(floor);

  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const outlinePoints = [
    new THREE.Vector3(-halfWidth, 0.025, -halfDepth),
    new THREE.Vector3(halfWidth, 0.025, -halfDepth),
    new THREE.Vector3(halfWidth, 0.025, halfDepth),
    new THREE.Vector3(-halfWidth, 0.025, halfDepth),
  ];
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(outlinePoints),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.68,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  outline.name = 'room-footprint-boundary';
  root.add(outline);

  const guidePoints = [];
  const columns = Math.max(2, Math.round(width));
  const rows = Math.max(2, Math.round(depth));
  for (let column = 1; column < columns; column += 1) {
    const x = -halfWidth + (column / columns) * width;
    guidePoints.push(x, 0.012, -halfDepth, x, 0.012, halfDepth);
  }
  for (let row = 1; row < rows; row += 1) {
    const z = -halfDepth + (row / rows) * depth;
    guidePoints.push(-halfWidth, 0.012, z, halfWidth, 0.012, z);
  }
  const guidesGeometry = new THREE.BufferGeometry();
  guidesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(guidePoints, 3));
  const guides = new THREE.LineSegments(
    guidesGeometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  guides.name = 'room-footprint-grid';
  root.add(guides);

  const cornerMaterial = new THREE.LineBasicMaterial({
    color: COLORS.ice,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (const [x, z] of [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]) {
    const post = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.02, z),
        new THREE.Vector3(x, 0.62, z),
      ]),
      cornerMaterial,
    );
    root.add(post);
  }

  root.userData.floor = floor;
  root.userData.outline = outline;
  root.userData.guides = guides;
  root.userData.width = width;
  root.userData.depth = depth;
  return root;
}

export function createRealityBreach(color = COLORS.cyan, radius = 0.68) {
  const root = new THREE.Group();
  root.name = 'persistent-reality-breach';
  const tunnelDepth = radius * 4.6;

  const back = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.3, 48),
    new THREE.MeshBasicMaterial({ color: 0x000107, side: THREE.DoubleSide, depthWrite: true }),
  );
  back.position.z = -tunnelDepth;
  root.add(back);

  const tunnel = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.84, radius * 0.3, tunnelDepth, 48, 12, true),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(0.09),
      side: THREE.BackSide,
      transparent: false,
      depthWrite: true,
    }),
  );
  tunnel.rotation.x = Math.PI / 2;
  tunnel.position.z = -tunnelDepth * 0.5;
  root.add(tunnel);

  const lattice = new THREE.Mesh(
    tunnel.geometry.clone(),
    new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.19,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  lattice.rotation.copy(tunnel.rotation);
  lattice.position.copy(tunnel.position);
  lattice.scale.setScalar(0.985);
  root.add(lattice);

  const tunnelRings = [];
  for (let index = 0; index < 9; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.77, radius * 0.018, 6, 56),
      new THREE.MeshBasicMaterial({
        color: index % 3 === 0 ? COLORS.violet : color,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.position.z = -0.15 - (index / 9) * tunnelDepth;
    root.add(ring);
    tunnelRings.push(ring);
  }

  const helix = new THREE.Group();
  for (let lane = 0; lane < 3; lane += 1) {
    const points = [];
    for (let index = 0; index < 88; index += 1) {
      const progress = index / 87;
      const angle = progress * Math.PI * 7 + lane * (Math.PI * 2 / 3);
      const laneRadius = THREE.MathUtils.lerp(radius * 0.68, radius * 0.18, progress);
      points.push(new THREE.Vector3(
        Math.cos(angle) * laneRadius,
        Math.sin(angle) * laneRadius,
        -0.12 - progress * tunnelDepth,
      ));
    }
    helix.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: lane === 1 ? COLORS.violet : lane === 2 ? COLORS.ice : color,
        transparent: true,
        opacity: 0.52,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    ));
  }
  root.add(helix);

  const starPositions = [];
  for (let index = 0; index < 110; index += 1) {
    const progress = ((index * 37) % 109) / 109;
    const angle = index * 2.39996;
    const spread = radius * THREE.MathUtils.lerp(0.72, 0.16, progress) * (0.25 + ((index * 17) % 73) / 73 * 0.75);
    starPositions.push(
      Math.cos(angle) * spread,
      Math.sin(angle) * spread,
      -0.14 - progress * tunnelDepth,
    );
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      color: COLORS.ice,
      size: radius * 0.045,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  root.add(stars);

  const opaqueEdge = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.79, radius * 1.18, 64),
    new THREE.MeshStandardMaterial({
      color: 0x010306,
      metalness: 0.72,
      roughness: 0.38,
      side: THREE.DoubleSide,
      depthWrite: true,
    }),
  );
  opaqueEdge.position.z = 0.006;
  opaqueEdge.renderOrder = 8;
  root.add(opaqueEdge);

  const shards = [];
  const shardMaterial = new THREE.MeshStandardMaterial({
    color: 0x071019,
    metalness: 0.84,
    roughness: 0.3,
    emissive: color,
    emissiveIntensity: 0.08,
  });
  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2;
    const shard = new THREE.Mesh(
      new THREE.ConeGeometry(radius * (0.045 + (index % 3) * 0.012), radius * (0.18 + (index % 4) * 0.045), 3),
      shardMaterial,
    );
    shard.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.035);
    shard.rotation.z = angle - Math.PI / 2;
    shard.rotation.x = (index % 2 ? 0.2 : -0.16);
    shard.renderOrder = 9;
    root.add(shard);
    shards.push(shard);
  }

  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2.75, radius * 2.75),
    new THREE.MeshBasicMaterial({
      map: glowTexture(`#${new THREE.Color(color).getHexString()}`),
      color,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  halo.position.z = 0.006;
  halo.renderOrder = 5;
  root.add(halo);

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.78, radius * 0.85, 64),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  rim.position.z = 0.045;
  rim.renderOrder = 10;
  root.add(rim);

  const edgePoints = [];
  for (let index = 0; index < 32; index += 1) {
    const angle = (index / 32) * Math.PI * 2;
    const jag = radius * (0.98 + Math.sin(index * 7.13) * 0.055 + Math.sin(index * 2.31) * 0.035);
    edgePoints.push(new THREE.Vector3(Math.cos(angle) * jag, Math.sin(angle) * jag, 0.02));
  }
  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(edgePoints),
    new THREE.LineBasicMaterial({
      color: COLORS.ice,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  edge.renderOrder = 11;
  root.add(edge);

  root.userData.radius = radius;
  root.userData.aperture = tunnel;
  root.userData.rim = rim;
  root.userData.halo = halo;
  root.userData.tunnel = tunnel;
  root.userData.lattice = lattice;
  root.userData.tunnelRings = tunnelRings;
  root.userData.helix = helix;
  root.userData.stars = stars;
  root.userData.shards = shards;
  root.userData.tunnelDepth = tunnelDepth;
  root.userData.phase = radius * 13.7;
  return root;
}

export function updateRealityBreach(root, time, dt, type = 'wall') {
  if (!root?.userData?.tunnelRings) return;
  const data = root.userData;
  const depth = data.tunnelDepth;
  const phase = time * (type === 'floor' ? 0.72 : 0.94) + data.phase;
  data.tunnelRings.forEach((ring, index) => {
    const travel = (phase * 0.38 + index / data.tunnelRings.length) % 1;
    const scale = THREE.MathUtils.lerp(0.34, 1, 1 - travel);
    ring.position.z = -0.1 - travel * depth;
    ring.scale.setScalar(scale);
    ring.rotation.z += dt * (index % 2 ? -0.72 : 0.54);
    ring.material.opacity = 0.18 + (1 - travel) * 0.68;
  });
  data.lattice.rotation.z += dt * 0.12;
  data.helix.rotation.z += dt * (type === 'floor' ? 0.36 : -0.28);
  data.stars.rotation.z -= dt * 0.18;
  data.stars.position.z = Math.sin(phase * 1.7) * 0.06;
  data.rim.rotation.z += dt * 0.5;
  data.rim.material.opacity = 0.72 + Math.sin(phase * 4.2) * 0.18;
  data.halo.material.opacity = 0.28 + Math.sin(phase * 2.7) * 0.08;
  data.shards.forEach((shard, index) => {
    shard.position.z = 0.03 + Math.sin(phase * 2.1 + index) * 0.012;
  });
  data.motionPhase = ((phase % 1) + 1) % 1;
  data.depthMotion = true;
}

function armorMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color: 0x59636a,
    map: getArmorTexture(),
    metalness: 0.72,
    roughness: 0.27,
    clearcoat: 0.52,
    emissive: color,
    emissiveIntensity: 0.15,
  });
}

export function createHumanoid(color = COLORS.coral, role = 'STRIKER') {
  const root = new THREE.Group();
  root.name = `null-sentinel-${role.toLowerCase()}`;
  const dark = armorMaterial(color);
  const light = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const skin = new THREE.MeshStandardMaterial({ color: 0x795c55, roughness: 0.72 });
  const carbon = new THREE.MeshPhysicalMaterial({
    color: 0x4a5359,
    map: getArmorTexture(),
    metalness: 0.88,
    roughness: 0.2,
    clearcoat: 0.85,
    clearcoatRoughness: 0.16,
    emissive: color,
    emissiveIntensity: 0.08,
  });

  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.22, 4, 8), dark);
  hips.position.y = 0.92;
  hips.rotation.z = Math.PI / 2;
  root.add(hips);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 6, 10), dark);
  torso.position.y = 1.52;
  torso.scale.set(1.08, 1, 0.72);
  torso.castShadow = true;
  root.add(torso);

  const chestArmor = new THREE.Mesh(new THREE.OctahedronGeometry(0.48, 0), carbon);
  chestArmor.position.set(0, 1.58, 0.27);
  chestArmor.scale.set(1.05, 0.72, 0.26);
  chestArmor.castShadow = true;
  root.add(chestArmor);

  const abdomen = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.24, 4, 8), carbon);
  abdomen.position.set(0, 1.16, 0.02);
  abdomen.scale.set(1.05, 1, 0.7);
  root.add(abdomen);

  const chestLine = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.035, 0.035), light);
  chestLine.position.set(0, 1.63, 0.35);
  chestLine.rotation.z = -0.18;
  root.add(chestLine);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.19, 12), skin);
  neck.position.y = 2.03;
  root.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 14), skin);
  head.scale.set(0.86, 1.08, 0.9);
  head.position.y = 2.27;
  head.castShadow = true;
  root.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.285, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52),
    carbon,
  );
  hair.position.set(0, 2.35, -0.015);
  hair.scale.set(0.88, 0.76, 0.94);
  root.add(hair);

  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.2), skin);
  jaw.position.set(0, 2.12, 0.07);
  jaw.scale.x = 0.86;
  root.add(jaw);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.055, 0.035), light);
  visor.position.set(0, 2.31, 0.245);
  root.add(visor);
  for (const x of [-0.085, 0.085]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 8, 6),
      new THREE.MeshBasicMaterial({ color: COLORS.ice, toneMapped: false }),
    );
    eye.position.set(x, 2.31, 0.276);
    root.add(eye);
  }
  const faceGlow = createGlow(color, 0.65, 0.35);
  faceGlow.position.set(0, 2.3, 0.3);
  root.add(faceGlow);

  const limbs = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.5, 1.8, 0);
    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.43, 4, 8), dark);
    upperArm.position.y = -0.28;
    upperArm.castShadow = true;
    const foreArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.4, 4, 8), dark);
    foreArm.position.y = -0.77;
    foreArm.castShadow = true;
    const armLine = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.34, 0.03), light);
    armLine.position.set(0, -0.72, 0.115);
    shoulder.add(upperArm, foreArm, armLine);
    const shoulderPlate = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), carbon);
    shoulderPlate.position.set(0, 0.02, 0.015);
    shoulderPlate.scale.set(1.35, 0.7, 1);
    shoulder.add(shoulderPlate);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), skin);
    hand.position.set(0, -1.03, 0.01);
    shoulder.add(hand);
    root.add(shoulder);
    limbs.push(shoulder);

    const hip = new THREE.Group();
    hip.position.set(side * 0.23, 0.83, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.46, 4, 8), dark);
    thigh.position.y = -0.33;
    thigh.castShadow = true;
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.42, 4, 8), dark);
    shin.position.y = -0.85;
    shin.castShadow = true;
    const legLine = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.42, 0.03), light);
    legLine.position.set(0, -0.82, 0.125);
    hip.add(thigh, shin, legLine);
    const knee = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), carbon);
    knee.position.set(0, -0.58, 0.12);
    knee.scale.set(1.15, 0.8, 0.6);
    hip.add(knee);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.38), carbon);
    boot.position.set(0, -1.15, 0.09);
    hip.add(boot);
    root.add(hip);
    limbs.push(hip);
  }

  const rolePlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.12, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x0a1017 }),
  );
  rolePlate.position.set(0, 1.34, 0.36);
  root.add(rolePlate);

  root.userData = {
    torso,
    head,
    limbs,
    chestLine,
    chestArmor,
    color,
    role,
    arms: [limbs[0], limbs[2]],
    legs: [limbs[1], limbs[3]],
    baseTorsoScale: torso.scale.clone(),
  };
  return root;
}

export function createDisc(color = COLORS.cyan, hostile = false) {
  const root = new THREE.Group();
  root.name = hostile ? 'hostile-arc-disc' : 'player-arc-disc';
  const rotor = new THREE.Group();
  rotor.name = 'horizontal-frisbee-rotor';
  root.add(rotor);
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.075, 12, 1, false),
    new THREE.MeshStandardMaterial({
      color: hostile ? 0x6a3034 : 0x4d6268,
      map: getArmorTexture(),
      metalness: 0.9,
      roughness: 0.16,
      emissive: color,
      emissiveIntensity: 0.5,
    }),
  );
  shell.castShadow = true;
  rotor.add(shell);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.055, 7, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.72) }),
  );
  rim.rotation.x = Math.PI / 2;
  rotor.add(rim);
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(0.11, 12),
    new THREE.MeshBasicMaterial({
      color: 0xb8e6ea,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.041;
  rotor.add(core);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.08, 1.08),
    new THREE.MeshBasicMaterial({
      map: glowTexture(`#${new THREE.Color(color).getHexString()}`),
      color,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.006;
  rotor.add(glow);
  root.userData.rotor = rotor;
  root.userData.flightNormal = new THREE.Vector3(0, 1, 0);
  return root;
}

export function createDiscTrail(color = COLORS.cyan, length = 28) {
  const positions = new Float32Array(length * 3);
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  const colors = new Float32Array(length * 3);
  const baseColor = new THREE.Color(color);
  for (let index = 0; index < length; index += 1) {
    const brightness = Math.max(0.035, 1 - index / Math.max(1, length - 1));
    colors[index * 3] = baseColor.r * brightness;
    colors[index * 3 + 1] = baseColor.g * brightness;
    colors[index * 3 + 2] = baseColor.b * brightness;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  line.frustumCulled = false;
  line.userData.history = [];
  line.userData.length = length;
  const sparks = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xffffff,
      vertexColors: true,
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sparks.userData.sharedGeometry = true;
  line.add(sparks);
  line.userData.sparks = sparks;
  return line;
}

export function updateDiscTrail(line, position) {
  const history = line.userData.history;
  history.unshift(position.clone());
  if (history.length > line.userData.length) history.pop();
  const attribute = line.geometry.attributes.position;
  const fallback = history.at(-1) || position;
  for (let index = 0; index < line.userData.length; index += 1) {
    const point = history[index] || fallback;
    attribute.setXYZ(index, point.x, point.y, point.z);
  }
  attribute.needsUpdate = true;
}

export function createShockwave(parent, position, color, horizontal = false, normal = null) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.86,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.24, 48), material);
  mesh.position.copy(position);
  const oriented = Boolean(normal?.lengthSq?.());
  if (oriented) {
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
  } else if (horizontal) mesh.rotation.x = -Math.PI / 2;
  parent.add(mesh);
  return { mesh, life: 0.7, maxLife: 0.7, horizontal, oriented };
}

export function updateShockwaves(shockwaves, dt, camera = null) {
  for (let index = shockwaves.length - 1; index >= 0; index -= 1) {
    const shockwave = shockwaves[index];
    shockwave.life -= dt;
    const progress = 1 - shockwave.life / shockwave.maxLife;
    shockwave.mesh.scale.setScalar(1 + progress * 8);
    shockwave.mesh.material.opacity = Math.max(0, (1 - progress) * 0.78);
    if (!shockwave.horizontal && !shockwave.oriented && camera) {
      const cameraQuaternion = camera.getWorldQuaternion(new THREE.Quaternion());
      const parentQuaternion = shockwave.mesh.parent.getWorldQuaternion(new THREE.Quaternion());
      shockwave.mesh.quaternion.copy(parentQuaternion.invert().multiply(cameraQuaternion));
    }
    if (shockwave.life <= 0) {
      disposeObject(shockwave.mesh);
      shockwaves.splice(index, 1);
    }
  }
}

function createTubePath(points, radius, material, tubularSegments = 28, radialSegments = 7) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false),
    material,
  );
  tube.castShadow = true;
  return tube;
}

function createLink(start, end, radius, material, radialSegments = 8) {
  const delta = new THREE.Vector3().subVectors(end, start);
  const link = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, delta.length(), radialSegments, 1, false),
    material,
  );
  link.position.addVectors(start, end).multiplyScalar(0.5);
  link.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  link.castShadow = true;
  return link;
}

export function createBike(color = COLORS.cyan, enemy = false) {
  const root = new THREE.Group();
  root.name = enemy ? 'enemy-light-runner' : 'player-light-runner';

  const accent = new THREE.Color(color);
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: enemy ? 0x5f292f : 0x425860,
    map: getArmorTexture(),
    metalness: 0.84,
    roughness: 0.2,
    clearcoat: 0.92,
    clearcoatRoughness: 0.12,
    emissive: color,
    emissiveIntensity: enemy ? 0.16 : 0.12,
  });
  const carbon = new THREE.MeshPhysicalMaterial({
    color: enemy ? 0x211116 : 0x141c21,
    map: getArmorTexture(),
    metalness: 0.78,
    roughness: 0.28,
    clearcoat: 0.72,
    clearcoatRoughness: 0.18,
    emissive: accent.clone().multiplyScalar(0.08),
  });
  const brushedMetal = new THREE.MeshStandardMaterial({
    color: 0x82939a,
    metalness: 0.96,
    roughness: 0.24,
  });
  const tireMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x030506,
    metalness: 0.12,
    roughness: 0.76,
    clearcoat: 0.16,
    clearcoatRoughness: 0.7,
  });
  const brakeMaterial = new THREE.MeshStandardMaterial({
    color: 0x566269,
    metalness: 0.94,
    roughness: 0.34,
    transparent: true,
    opacity: 0.86,
  });
  const energyMat = new THREE.MeshBasicMaterial({
    color: accent.clone().multiplyScalar(0.72),
    transparent: true,
    opacity: 0.88,
    toneMapped: false,
  });
  const iceMat = new THREE.MeshBasicMaterial({ color: COLORS.ice, toneMapped: false });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: accent.clone().lerp(new THREE.Color(0x06131e), 0.68),
    metalness: 0.08,
    roughness: 0.06,
    transmission: 0.76,
    thickness: 0.055,
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const bodyRig = new THREE.Group();
  bodyRig.name = 'sculpted-monocoque';
  root.add(bodyRig);

  const bodyProfile = [
    new THREE.Vector2(0.018, -1.46),
    new THREE.Vector2(0.2, -1.36),
    new THREE.Vector2(0.36, -1.05),
    new THREE.Vector2(0.44, -0.56),
    new THREE.Vector2(0.45, 0.08),
    new THREE.Vector2(0.4, 0.55),
    new THREE.Vector2(0.27, 0.94),
    new THREE.Vector2(0.07, 1.15),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(bodyProfile, 40), shellMat);
  body.name = 'aerodynamic-monocoque';
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.51;
  body.scale.set(0.95, 0.62, 1);
  body.castShadow = true;
  bodyRig.add(body);

  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.92, 8, 16), carbon);
  belly.name = 'carbon-keel';
  belly.rotation.x = Math.PI / 2;
  belly.position.set(0, 0.36, 0.08);
  belly.scale.set(1.05, 0.54, 1);
  belly.castShadow = true;
  bodyRig.add(belly);

  for (const side of [-1, 1]) {
    const fairing = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.78, 7, 14), carbon);
    fairing.name = side < 0 ? 'left-swept-fairing' : 'right-swept-fairing';
    fairing.rotation.x = Math.PI / 2;
    fairing.rotation.z = side * 0.11;
    fairing.position.set(side * 0.34, 0.5, 0.02);
    fairing.scale.set(0.82, 1, 1.15);
    fairing.castShadow = true;
    bodyRig.add(fairing);

    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 14), shellMat);
    shoulder.position.set(side * 0.3, 0.61, -0.45);
    shoulder.scale.set(0.7, 0.52, 1.36);
    shoulder.rotation.z = side * 0.13;
    shoulder.castShadow = true;
    bodyRig.add(shoulder);

    const sideRail = createTubePath(
      [
        new THREE.Vector3(side * 0.39, 0.42, -1.12),
        new THREE.Vector3(side * 0.46, 0.47, -0.46),
        new THREE.Vector3(side * 0.43, 0.5, 0.35),
        new THREE.Vector3(side * 0.31, 0.55, 0.96),
      ],
      0.024,
      energyMat,
      36,
      7,
    );
    sideRail.name = side < 0 ? 'left-energy-vein' : 'right-energy-vein';
    bodyRig.add(sideRail);

    const lowerRunner = createTubePath(
      [
        new THREE.Vector3(side * 0.31, 0.22, -0.92),
        new THREE.Vector3(side * 0.39, 0.2, -0.1),
        new THREE.Vector3(side * 0.31, 0.23, 0.82),
      ],
      0.029,
      energyMat,
      28,
      7,
    );
    lowerRunner.name = side < 0 ? 'left-light-runner' : 'right-light-runner';
    bodyRig.add(lowerRunner);

    for (const z of [-0.36, 0.02, 0.4]) {
      const vent = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.009, 5, 18, Math.PI * 1.25), energyMat);
      vent.position.set(side * 0.48, 0.5, z);
      vent.rotation.y = Math.PI / 2;
      vent.rotation.z = side * Math.PI / 2;
      vent.scale.y = 0.52;
      bodyRig.add(vent);
    }
  }

  const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.38, 7, 16), carbon);
  seat.name = 'contoured-rider-saddle';
  seat.rotation.x = Math.PI / 2;
  seat.position.set(0, 0.75, 0.48);
  seat.scale.set(1.08, 0.34, 1.08);
  seat.castShadow = true;
  bodyRig.add(seat);

  const tailCowl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 14), shellMat);
  tailCowl.position.set(0, 0.69, 0.86);
  tailCowl.scale.set(0.9, 0.5, 1.2);
  bodyRig.add(tailCowl);

  const windscreen = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.55, 0.38, 32, 1, true, Math.PI - 0.66, 1.32),
    glassMat,
  );
  windscreen.name = 'curved-windscreen';
  windscreen.position.set(0, 0.86, -0.22);
  windscreen.rotation.x = -0.12;
  windscreen.scale.x = 0.9;
  bodyRig.add(windscreen);

  const screenFrame = createTubePath(
    [
      new THREE.Vector3(-0.36, 0.72, -0.5),
      new THREE.Vector3(-0.31, 1.02, -0.56),
      new THREE.Vector3(0, 1.08, -0.61),
      new THREE.Vector3(0.31, 1.02, -0.56),
      new THREE.Vector3(0.36, 0.72, -0.5),
    ],
    0.018,
    brushedMetal,
    36,
    6,
  );
  screenFrame.name = 'windscreen-frame';
  bodyRig.add(screenFrame);

  const wheelRadius = 0.37;
  const createWheel = (name) => {
    const wheel = new THREE.Group();
    wheel.name = name;
    wheel.userData.baseY = wheelRadius;

    const tire = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius, 0.064, 14, 48), tireMaterial);
    tire.rotation.y = Math.PI / 2;
    tire.castShadow = true;
    wheel.add(tire);

    for (const x of [-0.072, 0.072]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius * 0.79, 0.017, 7, 40), brushedMetal);
      rim.position.x = x;
      rim.rotation.y = Math.PI / 2;
      wheel.add(rim);
      const lightRing = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius * 0.93, 0.014, 6, 44), energyMat);
      lightRing.position.x = x * 1.06;
      lightRing.rotation.y = Math.PI / 2;
      wheel.add(lightRing);
    }

    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.022, 28), brakeMaterial);
    brake.rotation.z = Math.PI / 2;
    wheel.add(brake);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.26, 16), brushedMetal);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);

    for (let index = 0; index < 7; index += 1) {
      const angle = (index / 7) * Math.PI * 2;
      const start = new THREE.Vector3(0, Math.cos(angle) * 0.075, Math.sin(angle) * 0.075);
      const end = new THREE.Vector3(0, Math.cos(angle) * 0.27, Math.sin(angle) * 0.27);
      wheel.add(createLink(start, end, 0.009, brushedMetal, 5));
    }

    const hubLight = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), iceMat);
    hubLight.scale.x = 1.45;
    wheel.add(hubLight);
    return wheel;
  };

  const frontAssembly = new THREE.Group();
  frontAssembly.name = 'steering-and-front-suspension';
  frontAssembly.position.z = -0.94;
  const frontWheel = createWheel('front-wheel');
  frontWheel.position.y = wheelRadius;
  frontAssembly.add(frontWheel);
  for (const side of [-1, 1]) {
    frontAssembly.add(
      createLink(
        new THREE.Vector3(side * 0.17, wheelRadius, 0),
        new THREE.Vector3(side * 0.22, 0.77, 0.31),
        0.025,
        brushedMetal,
        9,
      ),
    );
  }
  root.add(frontAssembly);

  const rearWheel = createWheel('rear-wheel');
  rearWheel.position.set(0, wheelRadius, 0.82);
  root.add(rearWheel);
  for (const side of [-1, 1]) {
    root.add(
      createLink(
        new THREE.Vector3(side * 0.12, wheelRadius, 0.82),
        new THREE.Vector3(side * 0.3, 0.51, 0.18),
        0.027,
        carbon,
        9,
      ),
    );
  }

  const headlight = new THREE.Mesh(new THREE.CircleGeometry(0.105, 28), iceMat);
  headlight.name = 'projector-headlight';
  headlight.position.set(0, 0.52, -1.47);
  headlight.rotation.y = Math.PI;
  bodyRig.add(headlight);
  const headlightBezel = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.014, 7, 28), carbon);
  headlightBezel.position.copy(headlight.position);
  headlightBezel.rotation.y = Math.PI;
  bodyRig.add(headlightBezel);

  const tailLight = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 7, 26), energyMat);
  tailLight.position.set(0, 0.62, 1.15);
  bodyRig.add(tailLight);

  const spine = createTubePath(
    [
      new THREE.Vector3(0, 0.7, -1.25),
      new THREE.Vector3(0, 0.82, -0.52),
      new THREE.Vector3(0, 0.81, 0.35),
      new THREE.Vector3(0, 0.66, 1.07),
    ],
    0.019,
    energyMat,
    34,
    7,
  );
  spine.name = 'dorsal-energy-spine';
  bodyRig.add(spine);

  const contactShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.78, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.scale.y = 2.15;
  contactShadow.position.y = 0.012;
  root.add(contactShadow);

  const wheelGlowFront = createGlow(color, 0.92, 0.4);
  wheelGlowFront.position.set(0, wheelRadius, -0.94);
  const wheelGlowBack = wheelGlowFront.clone();
  wheelGlowBack.material = wheelGlowFront.material.clone();
  wheelGlowBack.position.z = 0.82;
  root.add(wheelGlowFront, wheelGlowBack);

  root.userData.wheels = [frontWheel, rearWheel];
  root.userData.frontWheel = frontWheel;
  root.userData.rearWheel = rearWheel;
  root.userData.frontAssembly = frontAssembly;
  root.userData.bodyRig = bodyRig;
  root.userData.suspension = { front: frontWheel, rear: rearWheel, body: bodyRig };
  root.userData.energyMaterial = energyMat;
  root.userData.energyGlows = [wheelGlowFront, wheelGlowBack];
  root.userData.wheelRadius = wheelRadius;
  root.userData.lean = 0;
  root.userData.turnImpulse = 0;
  root.userData.lastDirection = null;
  root.userData.suspensionPhase = enemy ? 1.7 : 0;
  return root;
}

export function createTrailSegment(a, b, color = COLORS.cyan, height = 1.25) {
  const delta = new THREE.Vector3().subVectors(b, a);
  const length = delta.length();
  const midpoint = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(0.32),
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(length, height), material);
  wall.position.copy(midpoint);
  wall.position.y = height * 0.5;
  wall.rotation.y = Math.atan2(delta.x, delta.z) + Math.PI / 2;
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.035, 0.035),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(0.7),
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  edge.position.copy(midpoint);
  edge.position.y = height;
  edge.rotation.y = wall.rotation.y;
  const root = new THREE.Group();
  root.add(wall, edge);
  root.userData = { wall, edge };
  return root;
}

export function createParticleBurst(parent, position, color, count = 18, scale = 0.1) {
  const random = seededRandom(Math.floor((position.x + 70) * 31 + (position.z + 70) * 47 + count));
  const group = new THREE.Group();
  group.position.copy(position);
  const particles = [];
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, toneMapped: false });
  for (let i = 0; i < count; i += 1) {
    const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(scale * (0.45 + random()), 0), material.clone());
    mesh.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    const velocity = new THREE.Vector3(random() - 0.5, random() * 0.9 + 0.25, random() - 0.5)
      .normalize()
      .multiplyScalar(2 + random() * 4);
    group.add(mesh);
    particles.push({ mesh, velocity, spin: (random() - 0.5) * 8 });
  }
  parent.add(group);
  return { group, particles, life: 1, maxLife: 1 };
}

export function updateBursts(bursts, dt) {
  for (let i = bursts.length - 1; i >= 0; i -= 1) {
    const burst = bursts[i];
    burst.life -= dt;
    for (const particle of burst.particles) {
      particle.velocity.y -= 3.5 * dt;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.rotation.x += particle.spin * dt;
      particle.mesh.rotation.z -= particle.spin * 0.7 * dt;
      particle.mesh.material.opacity = Math.max(0, burst.life / burst.maxLife);
      particle.mesh.scale.setScalar(Math.max(0.01, burst.life / burst.maxLife));
    }
    if (burst.life <= 0) {
      disposeObject(burst.group);
      bursts.splice(i, 1);
    }
  }
}

export function disposeObject(root) {
  root.traverse((object) => {
    if (object.isLight) {
      object.shadow?.dispose?.();
      object.dispose?.();
    }
    if (object.isSkinnedMesh && object.skeleton) object.skeleton.dispose();
    if (object.geometry && !object.userData.sharedGeometry) object.geometry.dispose();
    if (object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
  });
  root.removeFromParent();
}
