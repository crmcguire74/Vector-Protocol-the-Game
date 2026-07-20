import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { COLORS, createDisc, createGlow } from './Visuals.js';

let sentinelAssetPromise = null;

export function preloadSentinelAsset() {
  if (!sentinelAssetPromise) {
    sentinelAssetPromise = new GLTFLoader()
      .loadAsync('/assets/models/sentinel-soldier.glb')
      .catch((error) => {
        sentinelAssetPromise = null;
        throw error;
      });
  }
  return sentinelAssetPromise;
}

export async function createAnimatedSentinel(color, role) {
  const asset = await preloadSentinelAsset();
  const model = SkeletonUtils.clone(asset.scene);
  const root = new THREE.Group();
  root.name = `skinned-digital-sentinel-${role.toLowerCase()}`;

  // A cloned skinned hierarchy needs a matrix update before its computed bounds
  // reflect the source rig's baked unit scale.
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = 2.32 / Math.max(0.01, size.y);
  model.scale.setScalar(scale);
  model.position.y = -bounds.min.y * scale;
  model.rotation.y = Math.PI;
  root.add(model);

  const meshes = [];
  const bones = {};
  model.traverse((object) => {
    if (object.isBone) bones[object.name] = object;
    if (!object.isMesh && !object.isSkinnedMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.sharedGeometry = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const cloned = materials.map((source) => {
      const material = source.clone();
      const isVisor = object.name.toLowerCase().includes('visor');
      if ('color' in material) {
        if (isVisor) material.color.set(0x122832);
        else material.color.multiply(new THREE.Color(role === 'PRIME' ? 0x665a43 : 0x404b50));
      }
      if ('metalness' in material) material.metalness = Math.max(0.62, material.metalness || 0);
      if ('roughness' in material) material.roughness = isVisor ? 0.08 : 0.25;
      if ('emissive' in material) {
        material.emissive = new THREE.Color(color);
        material.emissiveIntensity = isVisor ? 2.6 : 0.09;
      }
      if ('clearcoat' in material) material.clearcoat = isVisor ? 1 : 0.72;
      if ('clearcoatRoughness' in material) material.clearcoatRoughness = isVisor ? 0.04 : 0.16;
      material.envMapIntensity = isVisor ? 1.2 : 0.85;
      return material;
    });
    object.material = Array.isArray(object.material) ? cloned : cloned[0];
    meshes.push(object);
  });

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of asset.animations) {
    actions[clip.name] = mixer.clipAction(clip);
    actions[clip.name].setEffectiveWeight(1);
  }
  actions.Idle?.play();

  const chestLight = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.025, 7, 28),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }),
  );
  chestLight.rotation.x = Math.PI / 2;
  chestLight.position.set(0, 0.03, 0.1);
  const chestBone = bones['mixamorig:Spine2'] || model;
  chestBone.add(chestLight);

  const handDisc = createDisc(color, true);
  handDisc.position.set(0, 8, 3);
  handDisc.rotation.set(0.2, 0.9, 0);
  handDisc.visible = false;
  const handBone = bones['mixamorig:RightHand'] || model;
  handBone.add(handDisc);

  // The asset's skeleton carries a baked 0.01 scale. Counter the actual bone
  // world scale so attached props remain human-sized while following the rig.
  root.updateMatrixWorld(true);
  const handWorldScale = handBone.getWorldScale(new THREE.Vector3());
  const chestWorldScale = chestBone.getWorldScale(new THREE.Vector3());
  const handDiscBaseScale = 0.65 / Math.max(0.0001, handWorldScale.length() / Math.sqrt(3));
  const chestLightScale = 1.05 / Math.max(0.0001, chestWorldScale.length() / Math.sqrt(3));
  handDisc.scale.setScalar(handDiscBaseScale);
  chestLight.scale.setScalar(chestLightScale);

  const aura = createGlow(color, role === 'PRIME' ? 2.8 : 1.9, role === 'PRIME' ? 0.19 : 0.1);
  aura.position.set(0, 1.2, 0);
  root.add(aura);

  return {
    root,
    model,
    mixer,
    actions,
    bones,
    meshes,
    handDisc,
    chestLight,
    handDiscBaseScale,
    baseLightColor: new THREE.Color(color),
    attackClock: 0,
    attackWeight: 0,
    lastAttackProgress: 0,
    currentAction: 'Idle',
  };
}

export function setSentinelAction(rig, name, fade = 0.18) {
  if (!rig || rig.currentAction === name || !rig.actions[name]) return;
  const previous = rig.actions[rig.currentAction];
  const next = rig.actions[name];
  previous?.fadeOut(fade);
  next.reset().fadeIn(fade).play();
  rig.currentAction = name;
}

export function updateSentinelRig(
  rig,
  dt,
  { running = false, attacking = false, attackProgress = 0, hit = 0, speed = 1 } = {},
) {
  if (!rig) return;
  setSentinelAction(rig, running && !attacking ? 'Run' : 'Idle');
  rig.actions.Run && (rig.actions.Run.timeScale = THREE.MathUtils.clamp(speed / 2.5, 0.75, 1.5));
  rig.mixer.update(dt);
  rig.attackClock += dt;
  rig.attackWeight = THREE.MathUtils.damp(rig.attackWeight, attacking ? 1 : 0, attacking ? 16 : 11, dt);
  if (attacking) rig.lastAttackProgress = attackProgress;
  const poseProgress = attacking ? attackProgress : rig.lastAttackProgress;
  rig.handDisc.visible = rig.attackWeight > 0.05 && poseProgress < 0.88;
  if (rig.attackWeight > 0.001) {
    const pulse = 0.86 + Math.sin(rig.attackClock * 18) * 0.12;
    rig.handDisc.scale.setScalar(rig.handDiscBaseScale * pulse * (0.75 + rig.attackWeight * 0.25));
    const rightArm = rig.bones['mixamorig:RightArm'];
    const rightForeArm = rig.bones['mixamorig:RightForeArm'];
    const leftArm = rig.bones['mixamorig:LeftArm'];
    const spine = rig.bones['mixamorig:Spine2'];
    const windup = THREE.MathUtils.smoothstep(poseProgress, 0, 0.48) * rig.attackWeight;
    const release = THREE.MathUtils.smoothstep(poseProgress, 0.48, 0.94) * rig.attackWeight;
    if (rightArm) {
      rightArm.rotation.x += -0.35 - windup * 0.68 + release * 1.48;
      rightArm.rotation.z += -0.28 - windup * 0.82 + release * 0.54;
    }
    if (rightForeArm) {
      rightForeArm.rotation.y += -0.25 - windup * 1.2 + release * 1.1;
      rightForeArm.rotation.z += windup * 0.28;
    }
    if (leftArm) leftArm.rotation.x += windup * 0.32 - release * 0.2;
    if (spine) {
      spine.rotation.y += -windup * 0.34 + release * 0.58;
      spine.rotation.x += windup * 0.08;
    }
  }
  rig.chestLight.rotation.z += dt * (attacking ? 7 : 1.8);
  if (hit > 0) rig.chestLight.material.color.setHex(COLORS.ice);
  else rig.chestLight.material.color.copy(rig.baseLightColor);
  for (const mesh of rig.meshes) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if ('emissiveIntensity' in material && !mesh.name.toLowerCase().includes('visor')) {
        material.emissiveIntensity = THREE.MathUtils.damp(material.emissiveIntensity, hit > 0 ? 1.2 : 0.1, 8, dt);
      }
    });
  }
}
