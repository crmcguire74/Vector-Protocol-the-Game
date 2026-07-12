import { DigiWorld } from './game/DigiWorld.js';

const byId = (id) => document.getElementById(id);

const ui = {
  canvas: byId('game-canvas'),
  loading: byId('loading-screen'),
  menu: byId('menu'),
  launchButton: byId('launch-button'),
  musicToggle: byId('music-toggle'),
  musicToggleLabel: byId('music-toggle-label'),
  presetPicker: byId('preset-picker'),
  selectedRealityLabel: byId('selected-reality-label'),
  selectedGameLabel: byId('selected-game-label'),
  hud: byId('hud'),
  hudMode: byId('hud-mode'),
  hudScore: byId('hud-score'),
  hudHealth: byId('hud-health'),
  healthFill: byId('health-fill'),
  hudResource: byId('hud-resource'),
  resourceFill: byId('resource-fill'),
  objective: byId('objective'),
  crosshair: byId('crosshair'),
  combo: byId('combo'),
  speedReadout: byId('speed-readout'),
  minimap: byId('minimap'),
  announcement: byId('announcement'),
  damageFlash: byId('damage-flash'),
  comfortVignette: byId('comfort-vignette'),
  toast: byId('toast'),
  pauseMenu: byId('pause-menu'),
  resumeButton: byId('resume-button'),
  restartButton: byId('restart-button'),
  exitButton: byId('exit-button'),
  resultScreen: byId('result-screen'),
  resultTitle: byId('result-title'),
  resultDetail: byId('result-detail'),
  againButton: byId('again-button'),
  menuButton: byId('menu-button'),
  xrExit: byId('xr-exit'),
  touchControls: byId('touch-controls'),
  touchLeft: byId('touch-left'),
  touchRight: byId('touch-right'),
  touchPrimary: byId('touch-primary'),
  touchSecondary: byId('touch-secondary'),
};

const selection = {
  presentation: 'desktop',
  game: 'arena',
  preset: 'portal',
};

const presentationLabels = { desktop: 'Normal', vr: 'VR', ar: 'AR' };
const gameLabels = { arena: 'Shard Arena', bike: 'Lightline Pursuit' };
let detectedCapabilities = { vr: false, ar: false };

function updateMenuReadout() {
  const supported = selection.presentation === 'desktop' || detectedCapabilities[selection.presentation];
  ui.selectedRealityLabel.textContent = supported
    ? presentationLabels[selection.presentation]
    : `${presentationLabels[selection.presentation]} Preview`;
  ui.selectedGameLabel.textContent = gameLabels[selection.game];
  ui.presetPicker.classList.toggle('hidden', selection.presentation !== 'ar' || selection.game !== 'arena');
  const launchStatus = ui.launchButton.querySelector('small');
  if (launchStatus) launchStatus.textContent = supported ? 'System armed' : 'Spatial preview armed';

  const label = document.querySelector('.controls-strip__label');
  const items = [...document.querySelectorAll('.controls-strip li')];
  const controlSets = selection.presentation === 'desktop'
    ? selection.game === 'bike'
      ? [['A / D', 'Steer'], ['Mouse', 'Look'], ['Click', 'Boost'], ['Space', 'Boost'], ['Shift', 'Brake'], ['Esc', 'Pause']]
      : [['WASD', 'Move'], ['Mouse', 'Aim'], ['Click', 'Throw'], ['Space', 'Jump'], ['Shift', 'Dash'], ['Esc', 'Pause']]
    : selection.game === 'bike'
      ? [['Stick', 'Steer'], ['Head', 'Look'], ['Trigger', 'Boost'], ['A / X', 'Pulse'], ['B / Y', 'Trail'], ['Grip', 'Pulse']]
      : [['Stick', 'Move'], ['Hand', 'Aim'], ['Trigger', 'Throw'], ['A / X', 'Jump'], ['B / Y', 'Recall'], ['Grip', 'Guard']];
  if (label) label.innerHTML = `<span>Control matrix</span> / ${presentationLabels[selection.presentation]}`;
  items.forEach((item, index) => {
    const [key, action] = controlSets[index];
    item.innerHTML = `<kbd>${key}</kbd><span>${action}</span>`;
  });
}

function selectButton(buttons, selected, value) {
  buttons.forEach((button) => {
    const active = button.dataset[selected] === value;
    button.classList.toggle('is-selected', active);
    button.setAttribute('aria-pressed', String(active));
    const status = button.querySelector('.game-option__status');
    if (status) status.textContent = active ? 'Selected' : 'Available';
  });
}

const presentationButtons = [...document.querySelectorAll('[data-presentation]')];
const gameButtons = [...document.querySelectorAll('[data-game]')];
const presetButtons = [...document.querySelectorAll('[data-preset]')];
const instructionTabs = [...document.querySelectorAll('[data-instruction]')];
const instructionPanels = [...document.querySelectorAll('[data-instruction-panel]')];

function selectInstruction(value, focus = false) {
  instructionTabs.forEach((tab) => {
    const active = tab.dataset.instruction === value;
    tab.classList.toggle('is-selected', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  instructionPanels.forEach((panel) => {
    const active = panel.dataset.instructionPanel === value;
    panel.classList.toggle('hidden', !active);
    panel.setAttribute('aria-hidden', String(!active));
  });
}

instructionTabs.forEach((tab, tabIndex) => {
  tab.addEventListener('click', () => selectInstruction(tab.dataset.instruction));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.code)) return;
    event.preventDefault();
    const nextIndex = event.code === 'Home'
      ? 0
      : event.code === 'End'
        ? instructionTabs.length - 1
        : (tabIndex + (event.code === 'ArrowRight' ? 1 : -1) + instructionTabs.length) % instructionTabs.length;
    selectInstruction(instructionTabs[nextIndex].dataset.instruction, true);
  });
});

selectInstruction('desktop');

presentationButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selection.presentation = button.dataset.presentation;
    selectButton(presentationButtons, 'presentation', selection.presentation);
    updateMenuReadout();
  });
});

gameButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selection.game = button.dataset.game;
    selectButton(gameButtons, 'game', selection.game);
    updateMenuReadout();
  });
});

presetButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selection.preset = button.dataset.preset;
    selectButton(presetButtons, 'preset', selection.preset);
  });
});

let world;
try {
  world = new DigiWorld(ui.canvas, ui);
  window.vectorProtocol = world;
  window.render_game_to_text = () => JSON.stringify(world.getState());
  window.advanceTime = (ms) => world.advanceTime(ms);

  const unlockMenuAudio = () => world.unlockAudio();
  document.addEventListener('pointerdown', unlockMenuAudio, { capture: true, once: true });
  document.addEventListener('keydown', unlockMenuAudio, { capture: true, once: true });

  ui.launchButton.addEventListener('click', () => world.startGame(selection.game, selection.presentation, selection.preset));
  ui.musicToggle.addEventListener('click', () => world.toggleMusic());
  ui.resumeButton.addEventListener('click', () => world.resume());
  ui.restartButton.addEventListener('click', () => world.restart());
  ui.exitButton.addEventListener('click', () => world.goToMenu());
  ui.againButton.addEventListener('click', () => world.restart());
  ui.menuButton.addEventListener('click', () => world.goToMenu());
  ui.xrExit.addEventListener('click', () => world.xrSession?.end());
  document.addEventListener('visibilitychange', () => world.handleVisibility(document.hidden));

  world.checkXRCapabilities().then((capabilities) => {
    detectedCapabilities = capabilities;
    for (const button of presentationButtons) {
      const type = button.dataset.presentation;
      if (type === 'desktop') continue;
      const supported = capabilities[type];
      button.classList.toggle('is-unavailable', !supported);
      const detail = button.querySelector('small');
      if (detail && !supported) detail.textContent = 'Desktop preview';
      button.title = supported
        ? `${type.toUpperCase()} session available on this device`
        : `${type.toUpperCase()} hardware not detected; launches a desktop spatial preview`;
    }
    updateMenuReadout();
  });

  window.setTimeout(() => {
    ui.loading.classList.add('is-complete');
    window.setTimeout(() => ui.loading.classList.add('hidden'), 420);
  }, 650);
} catch (error) {
  console.error('[Vector Protocol] Boot failure', error);
  ui.loading.querySelector('.boot-title').textContent = 'SYSTEM FAULT';
  ui.loading.querySelector('.boot-status').textContent = error.message;
}
