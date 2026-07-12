import * as THREE from "../vendor/three.module.js";
import { STR } from "./strings.js";
import { COL } from "./world.js";
import { Store } from "./util.js";

const _m = new THREE.Vector3();

export class HubMode {
  constructor() {
    this.name = "hub";
    this.group = null;
    this.hotspots = [];
    this.time = 0;
    this.hovered = null;
  }

  build(g) {
    const kit = g.kit;
    this.group = new THREE.Group();

    // staging platform
    const topTex = kit.gridTex.clone(); topTex.needsUpdate = true; topTex.repeat.set(5, 5);
    const top = new THREE.Mesh(new THREE.CircleGeometry(5, 48),
      new THREE.MeshBasicMaterial({ map: topTex }));
    top.rotation.x = -Math.PI / 2; top.position.y = 0.001;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5, 0.07, 8, 64), kit.basic(COL.cyan));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.05;
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(5, 3.4, 40, 32, 1, true), kit.matGraphite);
    pedestal.position.y = -20;
    this.group.add(top, rim, pedestal);

    // floating title
    this.title = kit.textPanel(5, 1.4);
    this.title.set([STR.title, STR.hubSelect]);
    this.title.mesh.position.set(0, 3.1, -6.5);
    this.group.add(this.title.mesh);

    // portals
    this.portals = [];
    const mkPortal = (x, label, action, iconBuilder) => {
      const p = new THREE.Group();
      p.position.set(x, 0, -3.9);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 10, 40), kit.basic(COL.cyan));
      arch.position.y = 1.45;
      const film = new THREE.Mesh(new THREE.CircleGeometry(1.08, 36),
        new THREE.MeshBasicMaterial({ map: kit.wallTex, color: COL.cyan, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      film.position.y = 1.45;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 0.12, 24), kit.matGraphite);
      base.position.y = 0.06;
      const glow = kit.glow(COL.cyan, 2.6, 0.35); glow.position.y = 1.45;
      const label3d = kit.textPanel(2.0, 0.5);
      label3d.set([label]);
      label3d.mesh.position.y = 2.85;
      const icon = iconBuilder();
      icon.position.y = 1.45;
      p.add(arch, film, base, glow, label3d.mesh, icon);
      // generous invisible hit volume
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3.2, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.position.y = 1.6;
      hit.userData.action = action;
      p.add(hit);
      this.hotspots.push(hit);
      this.group.add(p);
      const rec = { group: p, glow, icon, film, action };
      this.portals.push(rec);
      return rec;
    };

    mkPortal(-2.15, STR.hubDisc, "disc", () => {
      const d = g.kit.makeDisc(COL.cyan, COL.cyanHi);
      d.scale.setScalar(2.2);
      return d;
    });
    mkPortal(2.15, STR.hubCycle, "cycle", () => {
      const c = g.kit.makeCycle(COL.cyan);
      c.scale.setScalar(0.55);
      c.position.y = -0.45;
      const w = new THREE.Group(); w.add(c);
      return w;
    });

    // settings panel
    this.setPanel = kit.textPanel(1.9, 1.5);
    this.setPanel.mesh.position.set(3.6, 1.7, -1.4);
    this.setPanel.mesh.rotation.y = -0.6;
    this.group.add(this.setPanel.mesh);
    const mkRowHit = (idx, action) => {
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.3, 0.1),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.position.set(3.6, 2.24 - idx * 0.36, -1.4);
      hit.rotation.y = -0.6;
      // move slightly along panel normal so ray hits it first
      hit.userData.action = action;
      this.group.add(hit);
      this.hotspots.push(hit);
    };
    mkRowHit(0, "set:music");
    mkRowHit(1, "set:vignette");
    mkRowHit(2, "set:smoothTurn");
    mkRowHit(3, "set:reset");

    // record panel
    this.recPanel = kit.textPanel(1.9, 1.2);
    this.recPanel.mesh.position.set(-3.6, 1.7, -1.4);
    this.recPanel.mesh.rotation.y = 0.6;
    this.group.add(this.recPanel.mesh);

    this.refreshPanels();
  }

  refreshPanels() {
    const s = Store.load();
    const onoff = (v) => (v ? STR.on : STR.off);
    this.setPanel.set([
      STR.hubSettings,
      `${STR.setMusic}: ${onoff(s.music)}`,
      `${STR.setVignette}: ${onoff(s.vignette)}`,
      `${STR.setSmoothTurn}: ${onoff(s.smoothTurn)}`,
      STR.setReset,
    ], { bg: "rgba(2,8,14,0.85)", size: 0.2 });
    const badges = [STR.hubProgress];
    if (s.discWins === 0 && s.cycleTier === 0) badges.push(STR.hubBadgeNone);
    if (s.discWins > 0) badges.push(`${STR.hubBadgeDisc} ${STR.enemies.slice(0, s.discWins).join(", ")}`);
    if (s.cycleTier > 0) badges.push(`${STR.hubBadgeCycle} ${s.cycleTier}/3`);
    this.recPanel.set(badges, { bg: "rgba(2,8,14,0.85)", size: 0.22 });
  }

  enter(g) {
    if (!this.group) this.build(g);
    g.scene.add(this.group);
    g.rig.position.set(0, 0, 1.2);
    g.rig.rotation.set(0, 0, 0);
    g.setDesktopEye();
    g.audio.playMusic("mus_hub");
    g.hud.showGameplay(false);
    g.hud.hint(g.inXR ? "" : STR.menuControlsHint);
    this.refreshPanels();
    g.unlockPointer();
  }

  exit(g) {
    g.scene.remove(this.group);
  }

  onAction(g, action) {
    g.audio.select();
    if (action === "disc") { g.setMode("disc"); return; }
    if (action === "cycle") {
      if (g.isAR) { g.banner([STR.arCyclesOff], 2.2); return; }
      g.setMode("cycle");
      return;
    }
    const s = Store.load();
    if (action === "set:music") { Store.set("music", !s.music); g.audio.setMusicOn(Store.get("music")); g.updateMusicButton?.(); }
    if (action === "set:vignette") Store.set("vignette", !s.vignette);
    if (action === "set:smoothTurn") Store.set("smoothTurn", !s.smoothTurn);
    if (action === "set:reset") { Store.reset(); }
    this.refreshPanels();
  }

  update(g, dt, events) {
    this.time += dt;
    for (const e of events) {
      if (e.type === "primary") {
        const hit = g.raycastHotspots(e, this.hotspots);
        if (hit) this.onAction(g, hit.userData.action);
      }
    }
  }

  frame(g, rdt) {
    // idle motion + hover feedback
    for (const p of this.portals) {
      p.icon.rotation.y += rdt * 0.9;
      const s = 1 + 0.04 * Math.sin(this.time * 2 + p.group.position.x);
      p.icon.scale.setScalar(p.icon.userData.baseScale || (p.icon.userData.baseScale = 1) * s);
      p.icon.scale.setScalar(s);
    }
    const hov = g.hoverHotspot(this.hotspots);
    for (const p of this.portals) {
      if (g.isAR && p.action === "cycle") {
        p.glow.material.opacity = 0.1;
        p.film.material.opacity = 0.04;
        continue;
      }
      const isHov = hov && hov.userData.action === p.action;
      p.glow.material.opacity = isHov ? 0.7 : 0.35;
      p.film.material.opacity = isHov ? 0.3 : 0.16;
    }
    if (this.title) this.title.mesh.position.y = 3.1 + Math.sin(this.time * 0.8) * 0.08;
  }
}
