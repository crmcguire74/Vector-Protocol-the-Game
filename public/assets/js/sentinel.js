import * as THREE from "../vendor/three.module.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import * as SkeletonUtils from "../vendor/SkeletonUtils.js";

// Skinned, animated Sentinel (adapted from the three.js Soldier example rig):
// real Idle/Run gait clips from the GLB, with windup / throw / guard / stagger
// layered procedurally onto the mixamo bones after each mixer update.

let assetPromise = null;

export function preloadSentinel() {
  if (!assetPromise) {
    assetPromise = new GLTFLoader()
      .loadAsync("./assets/models/sentinel-soldier.glb")
      .catch((err) => { assetPromise = null; throw err; });
  }
  return assetPromise;
}

export async function createSentinelRig(kit, color, hiColor) {
  const asset = await preloadSentinel();
  const model = SkeletonUtils.clone(asset.scene);
  const root = new THREE.Group();

  // normalize the rig to program height before any props attach
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = 2.1 / Math.max(0.01, size.y);
  model.scale.setScalar(scale);
  model.position.y = -bounds.min.y * scale;
  model.rotation.y = Math.PI;
  root.add(model);

  const meshes = [];
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.frustumCulled = false; // skinned bounds lag the animated pose
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = mats.map((src) => {
      const m = src.clone();
      const isVisor = o.name.toLowerCase().includes("visor");
      if ("color" in m) m.color.multiply(new THREE.Color(isVisor ? 0x223c48 : 0x3b464c));
      if ("metalness" in m) m.metalness = Math.max(0.62, m.metalness || 0);
      if ("roughness" in m) m.roughness = isVisor ? 0.08 : 0.25;
      if ("emissive" in m) {
        m.emissive = new THREE.Color(color);
        m.emissiveIntensity = isVisor ? 2.6 : 0.09;
      }
      m.envMapIntensity = isVisor ? 1.2 : 0.85;
      return m;
    });
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
    meshes.push(o);
  });

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of asset.animations) actions[clip.name] = mixer.clipAction(clip);
  actions.Idle?.play();

  // glowing identity ring on the chest (doubles as the flash material contract)
  const chestLight = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.025, 7, 28),
    new THREE.MeshBasicMaterial({ color, toneMapped: false })
  );
  chestLight.rotation.x = Math.PI / 2;
  chestLight.position.set(0, 0.03, 0.1);
  const chestBone = bones["mixamorig:Spine2"] || model;
  chestBone.add(chestLight);

  // throwing disc rides the right hand; guard buckler rides the left
  const handDisc = kit.makeDisc(color, hiColor, false, false);
  handDisc.position.set(0, 8, 3);
  handDisc.rotation.set(0.2, 0.9, 0);
  const handBone = bones["mixamorig:RightHand"] || model;
  handBone.add(handDisc);
  const shieldBone = bones["mixamorig:LeftHand"] || model;
  const buckler = kit.makeBuckler(color);
  buckler.visible = false;
  shieldBone.add(buckler);

  // the rig skeleton carries a baked centimetre scale: counter it on props
  root.updateMatrixWorld(true);
  const boneScale = (bone) => {
    const s = bone.getWorldScale(new THREE.Vector3());
    return Math.max(0.0001, s.length() / Math.sqrt(3));
  };
  const discScale = 0.9 / boneScale(handBone);
  handDisc.scale.setScalar(discScale);
  buckler.scale.setScalar(1.0 / boneScale(shieldBone));
  buckler.position.set(0, 12, 4);
  chestLight.scale.setScalar(1.05 / boneScale(chestBone));

  const aura = kit.glow(color, 1.9, 0.1);
  aura.position.set(0, 1.2, 0);
  root.add(aura);

  return {
    root, model, mixer, actions, bones, meshes,
    handDisc, buckler, chestLight, discScale,
    baseLightColor: new THREE.Color(color),
    attackClock: 0, attackWeight: 0, guardWeight: 0,
    lastAttackProgress: 0, currentAction: "Idle",
  };
}

function setAction(rig, name, fade = 0.18) {
  if (rig.currentAction === name || !rig.actions[name]) return;
  rig.actions[rig.currentAction]?.fadeOut(fade);
  rig.actions[name].reset().fadeIn(fade).play();
  rig.currentAction = name;
}

export function updateSentinelRig(rig, dt, { running = false, attacking = false, attackProgress = 0, guarding = false, hit = 0, speed = 1 } = {}) {
  if (!rig) return;
  setAction(rig, running && !attacking ? "Run" : "Idle");
  if (rig.actions.Run) rig.actions.Run.timeScale = THREE.MathUtils.clamp(speed / 2.5, 0.75, 1.5);
  rig.mixer.update(dt);
  rig.attackClock += dt;
  rig.attackWeight = THREE.MathUtils.damp(rig.attackWeight, attacking ? 1 : 0, attacking ? 16 : 11, dt);
  rig.guardWeight = THREE.MathUtils.damp(rig.guardWeight, guarding ? 1 : 0, 14, dt);
  if (attacking) rig.lastAttackProgress = attackProgress;
  const p = attacking ? attackProgress : rig.lastAttackProgress;

  // throw: wind the right arm back over the shoulder, then whip it forward
  if (rig.attackWeight > 0.001) {
    const pulse = 0.86 + Math.sin(rig.attackClock * 18) * 0.12;
    rig.handDisc.scale.setScalar(rig.discScale * pulse * (0.75 + rig.attackWeight * 0.25));
    const windup = THREE.MathUtils.smoothstep(p, 0, 0.48) * rig.attackWeight;
    const release = THREE.MathUtils.smoothstep(p, 0.48, 0.94) * rig.attackWeight;
    const rArm = rig.bones["mixamorig:RightArm"];
    const rFore = rig.bones["mixamorig:RightForeArm"];
    const lArm = rig.bones["mixamorig:LeftArm"];
    const spine = rig.bones["mixamorig:Spine2"];
    if (rArm) {
      rArm.rotation.x += -0.35 - windup * 0.68 + release * 1.48;
      rArm.rotation.z += -0.28 - windup * 0.82 + release * 0.54;
    }
    if (rFore) {
      rFore.rotation.y += -0.25 - windup * 1.2 + release * 1.1;
      rFore.rotation.z += windup * 0.28;
    }
    if (lArm) lArm.rotation.x += windup * 0.32 - release * 0.2;
    if (spine) {
      spine.rotation.y += -windup * 0.34 + release * 0.58;
      spine.rotation.x += windup * 0.08;
    }
  }

  // guard: left arm sweeps up across the chest behind the buckler
  if (rig.guardWeight > 0.001) {
    const w = rig.guardWeight;
    const lArm = rig.bones["mixamorig:LeftArm"];
    const lFore = rig.bones["mixamorig:LeftForeArm"];
    if (lArm) { lArm.rotation.x += -1.15 * w; lArm.rotation.z += 0.55 * w; }
    if (lFore) { lFore.rotation.y += 0.8 * w; lFore.rotation.x += -0.35 * w; }
  }
  rig.buckler.visible = rig.guardWeight > 0.25;

  rig.chestLight.rotation.z += dt * (attacking ? 7 : 1.8);
  const flash = hit > 0;
  for (const mesh of rig.meshes) {
    if (mesh.name.toLowerCase().includes("visor")) continue; // visor stays hot
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if ("emissiveIntensity" in m) {
        m.emissiveIntensity = THREE.MathUtils.damp(m.emissiveIntensity, flash ? 1.2 : 0.09, 8, dt);
      }
    }
  }
}
