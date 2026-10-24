import * as THREE from 'three';
import { CONFIG, createState, step, spawnApple, spawnGiftApple, spawnBombAt, eatBomb, applyGift, chooseMoveDetailed, updateRescue, updateWin, freeCellFor } from './logic.js';
import { APRON, apronPoint, walkStep, faceYaw, clearOf, sceneryLayout } from './apron.js';

const $ = (s) => document.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const TAU = Math.PI * 2;

const MAX_SEG = CONFIG.maxBoardW * CONFIG.maxBoardH;
const VIEWERS = ['nova', 'kito', 'mira', 'zed', 'luna', 'pixel', 'rush', 'koda', 'yuki', 'orin', 'bex', 'tama'];

const GIFTS = {
  apple: { icon: '🍎', name: 'Apple', color: '#9dff3d', sound: 'apple' },
  bomb: { icon: '💣', name: 'Bomb', color: '#ff8a3d', sound: 'bomb' },
  speed: { icon: '⚡', name: 'Speed up', color: '#39f6ff', sound: 'speed' },
  slow: { icon: '🐌', name: 'Slow down', color: '#ffc14d', sound: 'slow' },
  widen: { icon: '↔️', name: 'Widen', color: '#8fb4ff', sound: 'grow' },
  taller: { icon: '↕️', name: 'Taller', color: '#b99cff', sound: 'grow' },
};

const hud = {
  apples: $('#hud-apples'),
  bombs: $('#hud-bombs'),
  wins: $('#hud-wins'),
  losses: $('#hud-losses'),
  toasts: $('#toasts'),
  log: $('#log'),
  banner: $('#banner'),
  bannerTitle: $('#banner-title'),
  bannerSub: $('#banner-sub'),
  flash: $('#flash'),
  theme: $('#theme'),
  winSummary: $('#win-summary'),
  cd: $('#countdown'),
  cdNum: $('#countdown-num'),
  cdLabel: $('#countdown-label'),
  debug: $('#debug'),
  winLap: $('#dbg-winlap'),
  dbgSound: $('#dbg-sound'),
  dbgGifts: $('#dbg-gifts'),
  dbgSpeed: $('#dbg-speed'),
};

// ---------- audio (synthesized, no asset files) ----------
// shortcut: synth-only SFX, swap in samples if the stream needs richer clicks.
let ac = null;
let noiseBuf = null;
let audioUnlocked = false;
let audioFailed = false;

// Sound is a stream setting, so it survives a reload.
const SOUND_KEY = 'giftsnake.sound';
let soundOn = (() => {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0';
  } catch (e) {
    return true;
  }
})();

function saveSound() {
  try {
    localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0');
  } catch (e) {
    // Storage unavailable; the setting lasts for this session only.
  }
}

// Browsers only allow AudioContext creation/resume inside a gesture. Callers
// unlock on pointerdown/keydown, so no context exists before the first input.
function unlockAudio() {
  audioUnlocked = true;
  if (!soundOn || audioFailed) return;
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    loadSamples();
  } catch {
    audioFailed = true;
    ac = null;
  }
}

// ---------- sampled SFX ----------
// Free sample previews (see CREDITS.md), trimmed by playback window; the synth
// below stays as the fallback whenever a file is missing or cannot be decoded.
const SAMPLES = {
  eat: { src: 'assets/sfx/eat.mp3', gain: 0.55, max: 0.9 },
  click: { src: 'assets/sfx/click.mp3', gain: 0.5 },
  bomb: { src: 'assets/sfx/bomb.mp3', gain: 0.62, max: 0.6 },
  crash: { src: 'assets/sfx/crash.mp3', gain: 0.55, max: 1.1 },
  win: { src: 'assets/sfx/win.mp3', gain: 0.5, max: 3.2 },
};
const sampleBuf = new Map();
let samplesLoading = false;

async function loadSamples() {
  if (samplesLoading) return;
  samplesLoading = true;
  const c = audio();
  if (!c) {
    samplesLoading = false;
    return;
  }
  for (const [name, s] of Object.entries(SAMPLES)) {
    if (sampleBuf.has(name)) continue;
    try {
      const res = await fetch(s.src);
      if (!res.ok) continue;
      sampleBuf.set(name, await c.decodeAudioData(await res.arrayBuffer()));
    } catch (e) {
      // Keep the synth for this sound.
    }
  }
}

function playSample(name, rate = 1) {
  const s = SAMPLES[name];
  const buf = sampleBuf.get(name);
  const c = audio();
  if (!buf || !c || !s) return false;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const gain = c.createGain();
  gain.gain.value = s.gain;
  src.connect(gain).connect(c.destination);
  src.start();
  if (s.max) src.stop(c.currentTime + s.max / rate);
  return true;
}

function audio() {
  if (!soundOn || !audioUnlocked || audioFailed) return null;
  if (!ac) {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      audioFailed = true;
      return null;
    }
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}

function noise(c) {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(c.sampleRate * 0.12);
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function keyDown(delay = 0) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const detune = rnd(0.92, 1.08);

  const n = c.createBufferSource();
  n.buffer = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2300 * detune;
  bp.Q.value = 1.1;
  const g1 = c.createGain();
  g1.gain.setValueAtTime(0.3, t0);
  g1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.02);
  n.connect(bp).connect(g1).connect(c.destination);
  n.start(t0);
  n.stop(t0 + 0.03);

  const thock = c.createOscillator();
  thock.type = 'triangle';
  thock.frequency.setValueAtTime(176 * detune, t0);
  thock.frequency.exponentialRampToValueAtTime(74 * detune, t0 + 0.06);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.18, t0);
  g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.075);
  thock.connect(g2).connect(c.destination);
  thock.start(t0);
  thock.stop(t0 + 0.09);

  const ping = c.createOscillator();
  ping.type = 'sine';
  ping.frequency.value = 560 * detune;
  const g3 = c.createGain();
  g3.gain.setValueAtTime(0.045, t0);
  g3.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
  ping.connect(g3).connect(c.destination);
  ping.start(t0);
  ping.stop(t0 + 0.05);
}

function keyUp(delay = 0) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const detune = rnd(0.92, 1.08);

  const n = c.createBufferSource();
  n.buffer = noise(c);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3600 * detune;
  const g1 = c.createGain();
  g1.gain.setValueAtTime(0.14, t0);
  g1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.018);
  n.connect(hp).connect(g1).connect(c.destination);
  n.start(t0);
  n.stop(t0 + 0.025);

  const tick = c.createOscillator();
  tick.type = 'square';
  tick.frequency.value = 1250 * detune;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.025, t0);
  g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.02);
  tick.connect(g2).connect(c.destination);
  tick.start(t0);
  tick.stop(t0 + 0.03);
}

function click() {
  // Mechanical switch: sampled press + release, pitch-varied per press so a
  // run of turns never sounds like one looped click.
  if (playSample('click', rnd(0.94, 1.06))) return;
  keyDown(0);
  keyUp(0.05);
}

function tone(freq, dur, type = 'sine', gain = 0.1, delay = 0, slideTo = null) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const sfx = {
  gift(type) {
    if (type === 'apple') {
      tone(660, 0.1, 'sine', 0.09);
      tone(880, 0.1, 'sine', 0.08, 0.06);
      tone(1320, 0.14, 'sine', 0.06, 0.12);
    } else if (type === 'bomb') {
      tone(140, 0.32, 'sawtooth', 0.14, 0, 38);
      tone(70, 0.3, 'square', 0.06, 0.02, 30);
    } else if (type === 'speed') {
      [0, 1, 2, 3].forEach((i) => tone(420 + i * 180, 0.07, 'square', 0.05, i * 0.05));
    } else if (type === 'slow') {
      [0, 1, 2].forEach((i) => tone(800 - i * 180, 0.12, 'sine', 0.06, i * 0.07));
    } else if (type === 'widen' || type === 'taller') {
      [0, 1, 2].forEach((i) => tone(330 + i * 220, 0.14, 'triangle', 0.06, i * 0.07));
    }
  },
  error() {
    tone(150, 0.16, 'square', 0.07);
  },
  eat() {
    if (playSample('eat', rnd(0.95, 1.05))) return;
    tone(880, 0.09, 'sine', 0.08);
    tone(1320, 0.1, 'sine', 0.05, 0.05);
  },
  explode() {
    if (playSample('bomb')) return;
    tone(140, 0.32, 'sawtooth', 0.14, 0, 38);
    tone(70, 0.3, 'square', 0.06, 0.02, 30);
  },
  crash() {
    if (playSample('crash')) return;
    tone(220, 0.5, 'sawtooth', 0.12, 0, 40);
  },
  win() {
    if (playSample('win')) return;
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.09, i * 0.11));
  },
};

// ---------- three setup ----------
const stageEl = $('#app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

function stageSize() {
  const box = stageEl.getBoundingClientRect();
  return { w: Math.max(1, Math.round(box.width)), h: Math.max(1, Math.round(box.height)) };
}
const bootSize = stageSize();
renderer.setSize(bootSize.w, bootSize.h);
stageEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Two-stop vertical wash instead of a flat fill: the tilted view leaves a lot
// of open background, and a gradient gives it depth without stealing focus.
const bgCanvas = document.createElement('canvas');
bgCanvas.width = 4;
bgCanvas.height = 256;
const bgTex = new THREE.CanvasTexture(bgCanvas);
bgTex.colorSpace = THREE.SRGBColorSpace;
scene.background = bgTex;
const bgCtx = bgCanvas.getContext('2d');
const bgTop = new THREE.Color();
const bgBottom = new THREE.Color();

function paintBackdrop(hex) {
  bgTop.set(hex);
  bgBottom.copy(bgTop).offsetHSL(0, 0, -0.07);
  const grad = bgCtx.createLinearGradient(0, 0, 0, bgCanvas.height);
  grad.addColorStop(0, `#${bgTop.getHexString()}`);
  grad.addColorStop(1, `#${bgBottom.getHexString()}`);
  bgCtx.fillStyle = grad;
  bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
  bgTex.needsUpdate = true;
}
paintBackdrop(0xf7dfe9);
scene.fog = new THREE.FogExp2(0xf7dfe9, 0.008);

const CAM_FOV = 48;
// Slight isometric: the camera sits 25° off straight down, on the +Z side, so
// the board reads as a shallow diamond while rows still run top to bottom.
const CAM_TILT = THREE.MathUtils.degToRad(25);
// The stage rectangle is the board plus this ring: the framing margin that
// keeps the apron (and most of the crowd standing on it) inside the frustum.
const RIM_FRAME = 0.9;
const CAM_DIR = new THREE.Vector3(0, Math.cos(CAM_TILT), Math.sin(CAM_TILT));
const CAM_RIGHT = new THREE.Vector3(1, 0, 0);
const CAM_UP = new THREE.Vector3(0, Math.sin(CAM_TILT), -Math.cos(CAM_TILT));
const camera = new THREE.PerspectiveCamera(CAM_FOV, bootSize.w / bootSize.h, 0.1, 240);
camera.up.set(0, 1, 0);

scene.add(new THREE.AmbientLight(0xfff2df, 0.55));
const keyLight = new THREE.DirectionalLight(0xfff0e0, 2.4);
keyLight.position.set(9, 16, 7);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xffb3c9, 0.9);
rimLight.position.set(-10, 7, -9);
scene.add(rimLight);

// ---------- backdrop ----------
// The tilted view exposes the floor around the board, so the scene rests on a
// soft dot field plus a contact shadow instead of an empty colour wash.
function dotFieldTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  for (let y = size / 192; y < size; y += size / 96) {
    for (let x = size / 192; x < size; x += size / 96) {
      g.beginPath();
      g.arc(x, y, 1.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Fade the field out at the edges so the plane never shows a hard border.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
  fade.addColorStop(0, 'rgba(255,255,255,1)');
  fade.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

const groundMat = new THREE.MeshBasicMaterial({
  color: 0xffc9db,
  map: dotFieldTexture(),
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(110, 110), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(12, -0.3, 12.5);
scene.add(ground);

function softShadowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, 'rgba(0,0,0,0.6)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.32)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const boardShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: softShadowTexture(), transparent: true, depthWrite: false })
);
boardShadow.rotation.x = -Math.PI / 2;
scene.add(boardShadow);

// board
const boardGroup = new THREE.Group();
scene.add(boardGroup);

const baseMat = new THREE.MeshStandardMaterial({
  color: 0x6b4a63,
  emissive: 0x7d5573,
  emissiveIntensity: 0.25,
  roughness: 0.62,
  metalness: 0.05,
});
const base = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), baseMat);
base.rotation.x = -Math.PI / 2;
boardGroup.add(base);

function gridTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

const gridTex = gridTexture();
const gridMat = new THREE.MeshBasicMaterial({
  map: gridTex,
  color: 0xffc9db,
  transparent: true,
  opacity: 0.32,
  blending: THREE.NormalBlending,
  depthWrite: false,
});
const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), gridMat);
grid.rotation.x = -Math.PI / 2;
grid.renderOrder = 2;
boardGroup.add(grid);

// Checkerboard tiles carry the cell grid on their own; the line texture stays
// faint on top so corners are still readable on both tile colours.
const checker = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.96, 0.96),
  new THREE.MeshBasicMaterial({ toneMapped: false }),
  MAX_SEG
);
checker.frustumCulled = false;
checker.renderOrder = 1;
boardGroup.add(checker);

// Shade the cells the snake occupies; the tube hides the middle, so the soft
// square edge is what tells viewers which cell the head is actually on.
const bodyCells = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.9, 0.9),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false }),
  MAX_SEG
);
bodyCells.frustumCulled = false;
bodyCells.renderOrder = 3;
boardGroup.add(bodyCells);
const headCell = new THREE.Mesh(
  new THREE.PlaneGeometry(0.98, 0.98),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false })
);
headCell.rotation.x = -Math.PI / 2;
headCell.renderOrder = 4;
boardGroup.add(headCell);

const cellDummy = new THREE.Object3D();
const tileA = new THREE.Color();
const tileB = new THREE.Color();

function paintChecker() {
  const { w, h } = state;
  tileA.copy(baseMat.color);
  tileB.copy(tileA).offsetHSL(0, 0.02, 0.115);
  let k = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cellDummy.position.set(x + 0.5, 0.002, y + 0.5);
      cellDummy.rotation.set(-Math.PI / 2, 0, 0);
      cellDummy.updateMatrix();
      checker.setMatrixAt(k, cellDummy.matrix);
      checker.setColorAt(k, (x + y) % 2 === 0 ? tileA : tileB);
      k++;
    }
  }
  checker.count = k;
  checker.instanceMatrix.needsUpdate = true;
  if (checker.instanceColor) checker.instanceColor.needsUpdate = true;
}

const wallMat = new THREE.MeshStandardMaterial({
  color: 0xffb3c7,
  emissive: 0xff7fa4,
  emissiveIntensity: 0.18,
  metalness: 0.05,
  roughness: 0.6,
});
const postMat = wallMat.clone();
postMat.emissiveIntensity = 0.22;
const walls = [];
for (let i = 0; i < 4; i++) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), wallMat);
  boardGroup.add(wall);
  walls.push(wall);
}
const postGeo = new THREE.BoxGeometry(1, 1, 1);
const posts = [];
for (let i = 0; i < 4; i++) {
  const post = new THREE.Mesh(postGeo, postMat);
  boardGroup.add(post);
  posts.push(post);
}

// Board geometry is fixed; layout is applied straight away, no growth tween.
const boardTarget = {
  basePos: new THREE.Vector3(),
  baseScale: new THREE.Vector3(),
  gridPos: new THREE.Vector3(),
  gridScale: new THREE.Vector3(),
  repeat: new THREE.Vector2(),
};
const wallTargets = Array.from({ length: 4 }, () => ({ pos: new THREE.Vector3(), scale: new THREE.Vector3() }));
const postTargets = Array.from({ length: 4 }, () => ({ pos: new THREE.Vector3(), scale: new THREE.Vector3() }));

function snapBoard() {
  base.position.copy(boardTarget.basePos);
  base.scale.copy(boardTarget.baseScale);
  grid.position.copy(boardTarget.gridPos);
  grid.scale.copy(boardTarget.gridScale);
  gridTex.repeat.copy(boardTarget.repeat);
  for (let i = 0; i < 4; i++) {
    walls[i].position.copy(wallTargets[i].pos);
    walls[i].scale.copy(wallTargets[i].scale);
    posts[i].position.copy(postTargets[i].pos);
    posts[i].scale.copy(postTargets[i].scale);
  }
}

function layoutBoard() {
  const { w, h } = state;
  boardTarget.basePos.set(w / 2, 0, h / 2);
  boardTarget.baseScale.set(w, h, 1);
  boardTarget.gridPos.set(w / 2, 0.006, h / 2);
  boardTarget.gridScale.set(w, h, 1);
  boardTarget.repeat.set(w, h);

  const t = 0.34;
  const ht = 1.2;
  const specs = [
    { x: w / 2, z: -t / 2, sx: w + t * 2, sz: t },
    { x: w / 2, z: h + t / 2, sx: w + t * 2, sz: t },
    { x: -t / 2, z: h / 2, sx: t, sz: h + t * 2 },
    { x: w + t / 2, z: h / 2, sx: t, sz: h + t * 2 },
  ];
  for (let i = 0; i < 4; i++) {
    wallTargets[i].pos.set(specs[i].x, ht / 2, specs[i].z);
    wallTargets[i].scale.set(specs[i].sx, ht, specs[i].sz);
  }

  const pw = t * 1.7;
  const ph = ht * 1.35;
  const corners = [
    { x: -t / 2, z: -t / 2 },
    { x: w + t / 2, z: -t / 2 },
    { x: w + t / 2, z: h + t / 2 },
    { x: -t / 2, z: h + t / 2 },
  ];
  for (let i = 0; i < 4; i++) {
    postTargets[i].pos.set(corners[i].x, ph / 2, corners[i].z);
    postTargets[i].scale.set(pw, ph, pw);
  }
  boardShadow.position.set(w / 2, -0.04, h / 2);
  boardShadow.scale.set(w + 4, h + 4, 1);
  snapBoard();
  paintChecker();
  layoutSpectators();
  layoutScenery();
}

// snake: one continuous tube swept along the eased visual path
const RING_PER_CELL = 3.5;
// Old tail cells kept so corner bevels can be paid back as tail lag instead
// of shortening the visible body.
const TRAIL_EXTRA = 8;
const RING_RADIAL = 9;
const R_HEAD = 0.45;
const R_TAIL = 0.26;
const MAX_RINGS = Math.ceil(MAX_SEG * (RING_PER_CELL + 1)) + 4;

// Three flat tones keep the snake cel-shaded instead of glossy.
const toonRamp = new THREE.DataTexture(
  new Uint8Array([82, 82, 82, 255, 158, 158, 158, 255, 255, 255, 255, 255]),
  3,
  1,
  THREE.RGBAFormat
);
toonRamp.minFilter = THREE.NearestFilter;
toonRamp.magFilter = THREE.NearestFilter;
toonRamp.generateMipmaps = false;
toonRamp.needsUpdate = true;

const snakeMesh = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshToonMaterial({
    color: 0x5ecfae,
    gradientMap: toonRamp,
  })
);
snakeMesh.frustumCulled = false;
scene.add(snakeMesh);

// Inverted hull outline: the same tube pushed out along its normals, drawn
// back-faces only. Gives the flat toon fill a drawn edge.
const snakeOutline = new THREE.Mesh(
  snakeMesh.geometry,
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `
      void main() {
        vec3 p = position + normalize(normal) * 0.055;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      void main() { gl_FragColor = vec4(0.27, 0.15, 0.24, 1.0); }
    `,
  })
);
snakeOutline.frustumCulled = false;
snakeMesh.add(snakeOutline);

const ringPos = Array.from({ length: MAX_RINGS + 4 }, () => new THREE.Vector3());
const ringTan = Array.from({ length: MAX_RINGS + 4 }, () => new THREE.Vector3());
const ringNrm = Array.from({ length: MAX_RINGS + 4 }, () => new THREE.Vector3());
const ringBin = new THREE.Vector3();
const TUBE_UP = new THREE.Vector3(0, 1, 0);
const tubeAlt = new THREE.Vector3();

// Two Chaikin passes round each cell corner into a short arc. The trail keeps
// extra tail cells so the lost arc length is paid back as tail lag, not shrink.
const SMOOTH_CAP = (MAX_SEG + TRAIL_EXTRA) * 4 + 8;
const smoothA = Array.from({ length: SMOOTH_CAP }, () => new THREE.Vector3());
const smoothB = Array.from({ length: SMOOTH_CAP }, () => new THREE.Vector3());
const smoothD = new Float32Array(SMOOTH_CAP);
const smoothTail = new THREE.Vector3();

// Two cap sections per end, sampled off a hemisphere, so caps read as domes.
const CAP_D = [0.4, 0.78];
const CAP_R = [0.916, 0.626];

function ringRadius(t) {
  return R_HEAD + (R_TAIL - R_HEAD) * Math.pow(t, 0.9);
}

// Rings first, then two pole vertices; quads between rings plus triangle-fan caps.
function rebuildTube(n) {
  const body = Math.min(MAX_RINGS, Math.max(4, Math.round((n - 1) * RING_PER_CELL) + 1));
  const S = RING_RADIAL;
  const bodyStart = CAP_D.length;
  const sections = body + CAP_D.length * 2;
  const lastBody = bodyStart + body - 1;
  const last = sections - 1;

  // Build the cell path with exact corner knots, then bevel those knots.
  // The path runs past the tail so the bevel can be paid back as tail lag;
  // sampling stops at the logical length, so the body neither shrinks nor pulses.
  const span = n - 1;
  const back = 1 - visualP;
  const rawEnd = Math.min(trail.length - 1, back + span + TRAIL_EXTRA);
  let count = 0;
  sampleTrail(back, smoothA[count++]);
  for (let k = Math.floor(back) + 1; k < rawEnd; k++) sampleTrail(k, smoothA[count++]);
  sampleTrail(rawEnd, smoothA[count++]);

  const w = 0.25;
  let src = smoothA;
  let dst = smoothB;
  for (let pass = 0; pass < 2; pass++) {
    dst[0].copy(src[0]);
    let m = 1;
    for (let i = 0; i < count - 1; i++) {
      dst[m++].lerpVectors(src[i], src[i + 1], w);
      dst[m++].lerpVectors(src[i], src[i + 1], 1 - w);
    }
    dst[m++].copy(src[count - 1]);
    src = dst;
    count = m;
    dst = pass === 0 ? smoothA : smoothB;
  }

  smoothD[0] = 0;
  for (let i = 1; i < count; i++) {
    smoothD[i] = smoothD[i - 1] + src[i].distanceTo(src[i - 1]);
  }
  let pathLen = smoothD[count - 1];
  // Early in a round there may not be enough old tail to pay for the bevels.
  // Extend the tail straight by the shortfall so the body still cannot shrink.
  if (pathLen < span) {
    smoothTail.subVectors(src[count - 1], src[count - 2]);
    if (smoothTail.lengthSq() < 1e-8) smoothTail.set(0, 0, 1);
    else smoothTail.normalize();
    smoothD[count] = span;
    src[count].copy(src[count - 1]).addScaledVector(smoothTail, span - pathLen);
    clampToBoard(src[count]);
    count++;
    pathLen = span;
  }
  const visible = Math.min(span, pathLen);

  let j = 0;
  for (let i = 0; i < body; i++) {
    const d = (visible * i) / (body - 1);
    while (j < count - 2 && smoothD[j + 1] < d) j++;
    const seg = smoothD[j + 1] - smoothD[j] || 1;
    const f = Math.min(1, Math.max(0, (d - smoothD[j]) / seg));
    ringPos[bodyStart + i].lerpVectors(src[j], src[j + 1], f);
  }

  for (let i = 0; i < body; i++) {
    const c = bodyStart + i;
    const a = ringPos[bodyStart + Math.max(0, i - 1)];
    const b = ringPos[bodyStart + Math.min(body - 1, i + 1)];
    ringTan[c].subVectors(b, a);
    if (ringTan[c].lengthSq() < 1e-8) ringTan[c].set(0, 0, 1);
    else ringTan[c].normalize();
  }

  // Parallel transport the frame: no twist, no flipping at sharp corners.
  ringNrm[bodyStart].crossVectors(TUBE_UP, ringTan[bodyStart]);
  if (ringNrm[bodyStart].lengthSq() < 1e-6) ringNrm[bodyStart].set(1, 0, 0);
  ringNrm[bodyStart].normalize();
  for (let i = 1; i < body; i++) {
    const tan = ringTan[bodyStart + i];
    const nrm = ringNrm[bodyStart + i - 1];
    nrm.addScaledVector(tan, -nrm.dot(tan));
    if (nrm.lengthSq() < 1e-8) {
      tubeAlt.crossVectors(TUBE_UP, tan);
      if (tubeAlt.lengthSq() < 1e-6) tubeAlt.set(1, 0, 0);
      nrm.copy(tubeAlt);
    }
    nrm.normalize();
    ringNrm[bodyStart + i].copy(nrm);
  }

  const rHead = ringRadius(0);
  const rTail = ringRadius(1);
  const headTan = ringTan[bodyStart];
  const tailTan = ringTan[lastBody];
  for (let c = 1; c <= CAP_D.length; c++) {
    const s = bodyStart - c;
    ringPos[s].copy(ringPos[bodyStart]).addScaledVector(headTan, -CAP_D[c - 1] * rHead);
    ringTan[s].copy(headTan);
    ringNrm[s].copy(ringNrm[bodyStart]);
  }
  for (let c = 0; c < CAP_D.length; c++) {
    const s = lastBody + 1 + c;
    ringPos[s].copy(ringPos[lastBody]).addScaledVector(tailTan, CAP_D[c] * rTail);
    ringTan[s].copy(tailTan);
    ringNrm[s].copy(ringNrm[lastBody]);
  }

  const headPole = sections * S;
  const tailPole = headPole + 1;
  const pos = new Float32Array((tailPole + 1) * 3);
  const idx = new Uint16Array(S * 6 * sections);

  let o = 0;
  for (let i = 0; i < sections; i++) {
    let r;
    if (i < bodyStart) r = rHead * CAP_R[bodyStart - 1 - i];
    else if (i > lastBody) r = rTail * CAP_R[i - lastBody - 1];
    else r = ringRadius((i - bodyStart) / (body - 1));
    const nrm = ringNrm[i];
    ringBin.crossVectors(ringTan[i], nrm);
    for (let s = 0; s < S; s++) {
      const ang = (s / S) * TAU;
      const ca = Math.cos(ang) * r;
      const sa = Math.sin(ang) * r;
      pos[o] = ringPos[i].x + nrm.x * ca + ringBin.x * sa;
      pos[o + 1] = ringPos[i].y + nrm.y * ca + ringBin.y * sa;
      pos[o + 2] = ringPos[i].z + nrm.z * ca + ringBin.z * sa;
      o += 3;
    }
  }

  pos[o] = ringPos[bodyStart].x - headTan.x * rHead;
  pos[o + 1] = ringPos[bodyStart].y - headTan.y * rHead;
  pos[o + 2] = ringPos[bodyStart].z - headTan.z * rHead;
  o += 3;
  pos[o] = ringPos[lastBody].x + tailTan.x * rTail;
  pos[o + 1] = ringPos[lastBody].y + tailTan.y * rTail;
  pos[o + 2] = ringPos[lastBody].z + tailTan.z * rTail;

  let k = 0;
  for (let i = 0; i < last; i++) {
    for (let s = 0; s < S; s++) {
      const s2 = (s + 1) % S;
      const a = i * S + s;
      const b = i * S + s2;
      const c = (i + 1) * S + s2;
      const d = (i + 1) * S + s;
      idx[k++] = a;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = a;
      idx[k++] = c;
      idx[k++] = d;
    }
  }
  for (let s = 0; s < S; s++) {
    const s2 = (s + 1) % S;
    idx[k++] = headPole;
    idx[k++] = s2;
    idx[k++] = s;
    idx[k++] = tailPole;
    idx[k++] = last * S + s;
    idx[k++] = last * S + s2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  snakeMesh.geometry.dispose();
  snakeMesh.geometry = geo;
  snakeOutline.geometry = geo;
}

const eyes = new THREE.Group();
const eyeGeo = new THREE.SphereGeometry(0.13, 10, 8);
const pupilGeo = new THREE.SphereGeometry(0.07, 8, 6);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x3a2436 });
const blushGeo = new THREE.SphereGeometry(0.07, 10, 8);
const blushMat = new THREE.MeshBasicMaterial({ color: 0xff9fbb });
// Eyes sit proud of the rounded head dome so they stay readable from the top-down camera.
for (const sx of [-0.2, 0.2]) {
  const eye = new THREE.Mesh(eyeGeo, eyeMat);
  eye.position.set(sx, 0.24, 0.38);
  const pupil = new THREE.Mesh(pupilGeo, pupilMat);
  pupil.position.set(0, 0, 0.09);
  eye.add(pupil);
  eyes.add(eye);
}
// Cheeks live inside the eye group so they turn with the head yaw.
for (const sx of [-0.28, 0.28]) {
  const cheek = new THREE.Mesh(blushGeo, blushMat);
  cheek.position.set(sx, 0.14, 0.3);
  eyes.add(cheek);
}
scene.add(eyes);

// ---------- themes ----------
// Fixed palettes: the HUD vars and the 3D colours move together so a theme swap
// never leaves neon CSS next to pastel toys.
const THEMES = [
  {
    name: 'Strawberry',
    css: {
      cyan: '#5fc9b8', magenta: '#ff8fae', lime: '#8fd06a', orange: '#ff9f6e',
      blue: '#8fb4ff', violet: '#b99cff', amber: '#f5c25c',
    },
    scene: '#f7dfe9', base: '#6b4a63', baseEm: '#7d5573', grid: '#ffc9db',
    wall: '#ffb3c7', wallEm: '#ff7fa4', post: '#fff4ea', postEm: '#ffc7d8',
    head: '#5ecfae', accent: '#9be7cf', rim: '#ffb3c9',
  },
  {
    name: 'Matcha',
    css: {
      cyan: '#8fbf6a', magenta: '#f2a08a', lime: '#a8d98a', orange: '#f0b26a',
      blue: '#9fc9a0', violet: '#c3b8e8', amber: '#f5d27a',
    },
    scene: '#eef4e4', base: '#4a5a3c', baseEm: '#5a6c48', grid: '#dcefc6',
    wall: '#b8e39a', wallEm: '#8ac96a', post: '#fbf7e6', postEm: '#d9ecc0',
    head: '#9ccc6e', accent: '#b8e39a', rim: '#a8d98a',
  },
  {
    name: 'Blueberry',
    css: {
      cyan: '#8fa8ff', magenta: '#c39cff', lime: '#a8d9c0', orange: '#ffad8a',
      blue: '#8fb4ff', violet: '#b99cff', amber: '#f5d27a',
    },
    scene: '#e8edfa', base: '#424a6b', baseEm: '#525b80', grid: '#d6e0ff',
    wall: '#b7c5ff', wallEm: '#8ea4ff', post: '#f8f4ff', postEm: '#d9defc',
    head: '#8fa8ff', accent: '#b7c5ff', rim: '#c39cff',
  },
  {
    name: 'Mocha',
    css: {
      cyan: '#b98a6a', magenta: '#e8a08a', lime: '#b8c98a', orange: '#e0a878',
      blue: '#b8b0c8', violet: '#c9a7c9', amber: '#f0c888',
    },
    scene: '#f5e9dd', base: '#5a4034', baseEm: '#6b4c3d', grid: '#ffe1c2',
    wall: '#e3bd9a', wallEm: '#c99568', post: '#fff6ea', postEm: '#ecd3b8',
    head: '#c99062', accent: '#e3bd9a', rim: '#e8a08a',
  },
  {
    name: 'Lavender',
    css: {
      cyan: '#9fb4e8', magenta: '#d9a7ff', lime: '#b7d8a8', orange: '#ffb08a',
      blue: '#9fb4ff', violet: '#c9a7ff', amber: '#f7d08a',
    },
    scene: '#efeafb', base: '#4e4266', baseEm: '#5f517a', grid: '#e2d8ff',
    wall: '#cfc0f5', wallEm: '#a98cf0', post: '#f8f4ff', postEm: '#ded2f8',
    head: '#a98cf0', accent: '#cfc0f5', rim: '#d9a7ff',
  },
  {
    name: 'Peach',
    css: {
      cyan: '#f2b59c', magenta: '#ff9fa8', lime: '#c8d98a', orange: '#ffa070',
      blue: '#a8bfe8', violet: '#d0a8e0', amber: '#ffc978',
    },
    scene: '#fdeee4', base: '#6b4a44', baseEm: '#7d5a52', grid: '#ffd9c4',
    wall: '#ffbf9f', wallEm: '#ff8f5f', post: '#fff8f0', postEm: '#ffd9bf',
    head: '#ff9a6a', accent: '#ffd0b8', rim: '#ffb08a',
  },
  {
    name: 'Ocean',
    css: {
      cyan: '#5ecbe0', magenta: '#ff9fc4', lime: '#8fd8a8', orange: '#ffb07a',
      blue: '#6fa8ff', violet: '#a8b8ff', amber: '#ffd27a',
    },
    scene: '#e4f3f7', base: '#33505f', baseEm: '#40606f', grid: '#c4eaf2',
    wall: '#9fdce8', wallEm: '#5fb8d0', post: '#f4fdff', postEm: '#c8eaf2',
    head: '#3fbfd0', accent: '#9fdce8', rim: '#7fd8e8',
  },
  {
    name: 'Lemon',
    css: {
      cyan: '#8fcfa0', magenta: '#ffb0a0', lime: '#ccd95e', orange: '#ffc06a',
      blue: '#a8c8e8', violet: '#c8b8e0', amber: '#ffd65a',
    },
    scene: '#faf7dd', base: '#5f5a34', baseEm: '#6f6a40', grid: '#f0eaa8',
    wall: '#e8e08a', wallEm: '#c8c05a', post: '#fffdf0', postEm: '#f0eac0',
    head: '#b8c94a', accent: '#e8e08a', rim: '#d8d070',
  },
  {
    // Dark stream mode: the only palette that also repaints the deck surfaces.
    name: 'Midnight',
    dark: true,
    css: {
      cyan: '#5ee0d0', magenta: '#ff7fb2', lime: '#a8e07a', orange: '#ffab72',
      blue: '#8fa8ff', violet: '#c79cff', amber: '#ffd27a',
    },
    scene: '#120d16', base: '#2a2233', baseEm: '#332a3e', grid: '#4a3a58',
    wall: '#3b2f49', wallEm: '#6b4f86', post: '#221a2b', postEm: '#3a2c4a',
    head: '#6ef0c8', accent: '#35605a', rim: '#b06bff',
    dots: 0.07,
  },
];

let themeIndex = 0;
const themeRootStyle = document.documentElement.style;

function applyTheme(index) {
  themeIndex = ((index % THEMES.length) + THEMES.length) % THEMES.length;
  const th = THEMES[themeIndex];

  for (const key of Object.keys(th.css)) themeRootStyle.setProperty(`--${key}`, th.css[key]);
  // Surface overrides live in index.html so the stylesheet stays the source of
  // truth; the attribute swaps them all at once and light themes drop it.
  if (th.dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');

  paintBackdrop(th.scene);
  scene.fog.color.set(th.scene);

  baseMat.color.set(th.base);
  baseMat.emissive.set(th.baseEm);
  gridMat.color.set(th.grid);
  groundMat.color.set(th.wallEm);
  groundMat.opacity = th.dots ?? 0.16;

  wallMat.color.set(th.wall);
  wallMat.emissive.set(th.wallEm);
  postMat.color.set(th.post);
  postMat.emissive.set(th.postEm);

  snakeMesh.material.color.set(th.head);
  rimLight.color.set(th.rim);

  paintChecker();
  bodyCells.material.color.set(th.accent);
  headCell.material.color.set(th.accent);

  if (hud.theme) hud.theme.textContent = `THEME · ${th.name.toUpperCase()}`;
}

// apples
const appleGeo = new THREE.SphereGeometry(0.3, 16, 12);
const appleMat = new THREE.MeshToonMaterial({
  color: 0xff2d55,
  emissive: 0xff1744,
  emissiveIntensity: 0.35,
  gradientMap: toonRamp,
});
const stemGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.18, 6);
const stemMat = new THREE.MeshToonMaterial({ color: 0x6b3f1d, gradientMap: toonRamp });

function makeAppleMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(appleGeo, appleMat);
  body.position.y = 0.3;
  group.add(body);
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = 0.52;
  group.add(stem);
  return group;
}

// bombs: dark body, short fuse, warm spark — hazards that stay in the toy palette
const bombGeo = new THREE.SphereGeometry(0.28, 16, 12);
const bombMat = new THREE.MeshToonMaterial({
  color: 0x3a2436,
  emissive: 0x1c0f1a,
  emissiveIntensity: 0.25,
  gradientMap: toonRamp,
});
const fuseGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.2, 6);
const fuseMat = new THREE.MeshToonMaterial({ color: 0x8a6a4a, gradientMap: toonRamp });
const sparkGeo = new THREE.SphereGeometry(0.085, 10, 8);
const sparkMat = new THREE.MeshBasicMaterial({
  color: 0xffc14d, blending: THREE.AdditiveBlending, depthWrite: false,
});

function makeBombMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(bombGeo, bombMat);
  body.position.y = 0.3;
  group.add(body);
  const fuse = new THREE.Mesh(fuseGeo, fuseMat);
  fuse.position.set(0, 0.55, 0);
  fuse.rotation.z = 0.5;
  group.add(fuse);
  const spark = new THREE.Mesh(sparkGeo, sparkMat);
  spark.position.set(-0.06, 0.66, 0);
  group.add(spark);
  group.userData.spark = spark;
  return group;
}

// ---------- apple drop actors ----------
// One actor per apple batch: bird fly-by, parachute, UFO beam, meteor shower.
const dropActors = [];
const appleBatches = new Map();
const APPLE_BATCH_MS = 450;
let lastViewer = null;

const birdBodyMat = new THREE.MeshStandardMaterial({
  color: 0x8ff4ff, emissive: 0x1e9dff, emissiveIntensity: 1.1, roughness: 0.35, metalness: 0.3,
});
const birdWingMat = new THREE.MeshStandardMaterial({
  color: 0xff3ea5, emissive: 0xff1d7a, emissiveIntensity: 0.9,
  roughness: 0.4, side: THREE.DoubleSide,
});
const canopyMat = new THREE.MeshStandardMaterial({
  color: 0x39f6ff, emissive: 0x0a6d8a, emissiveIntensity: 0.8,
  roughness: 0.5, side: THREE.DoubleSide,
});
const ufoBodyMat = new THREE.MeshStandardMaterial({
  color: 0xcfd8ff, emissive: 0x3b4a8a, emissiveIntensity: 0.7, roughness: 0.22, metalness: 0.85,
});
const ufoDomeMat = new THREE.MeshStandardMaterial({
  color: 0x9dff3d, emissive: 0x64c414, emissiveIntensity: 1.4, roughness: 0.2,
});
const beamMat = new THREE.MeshBasicMaterial({
  color: 0x9dff3d, transparent: true, opacity: 0.2,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});
const meteorMat = new THREE.MeshStandardMaterial({
  color: 0xffb04a, emissive: 0xff5a1d, emissiveIntensity: 2.2, roughness: 0.4,
});
const meteorTrailMat = new THREE.MeshBasicMaterial({
  color: 0xff7a2d, transparent: true, opacity: 0.55,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const meteorGeo = new THREE.SphereGeometry(0.17, 10, 8);
const meteorTrailGeo = new THREE.ConeGeometry(0.15, 0.95, 6);
const birdBodyGeo = new THREE.ConeGeometry(0.2, 0.82, 7);
const birdWingGeo = new THREE.PlaneGeometry(0.54, 0.3);
const chuteGeo = new THREE.SphereGeometry(0.46, 12, 6, 0, TAU, 0, Math.PI / 2);
const chuteLineGeo = new THREE.BoxGeometry(0.012, 0.42, 0.012);
const chuteLineMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.45 });
const saucerGeo = new THREE.CylinderGeometry(0.5, 0.72, 0.16, 18);
const domeGeo = new THREE.SphereGeometry(0.3, 12, 8, 0, TAU, 0, Math.PI / 2);
const beamGeo = new THREE.ConeGeometry(1.35, 3.4, 18, 1, true);

function makeBird() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(birdBodyGeo, birdBodyMat);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.14, 0.02, 0);
    const wing = new THREE.Mesh(birdWingGeo, birdWingMat);
    wing.rotation.x = -Math.PI / 2;
    wing.position.x = s * 0.27;
    pivot.add(wing);
    g.add(pivot);
    wings.push(pivot);
  }
  g.userData.wings = wings;
  return g;
}

function makeParachute() {
  const g = new THREE.Group();
  const canopy = new THREE.Mesh(chuteGeo, canopyMat);
  canopy.position.y = 0.42;
  g.add(canopy);
  for (let i = 0; i < 4; i++) {
    const line = new THREE.Mesh(chuteLineGeo, chuteLineMat);
    const a = (i / 4) * TAU + Math.PI / 4;
    line.position.set(Math.cos(a) * 0.3, 0.2, Math.sin(a) * 0.3);
    g.add(line);
  }
  return g;
}

function makeUfo() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(saucerGeo, ufoBodyMat));
  const dome = new THREE.Mesh(domeGeo, ufoDomeMat);
  dome.position.y = 0.08;
  g.add(dome);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = -1.75;
  g.add(beam);
  g.userData.beam = beam;
  return g;
}

function landItem(item, delay = 0) {
  item.dropAt = clock + delay;
}

function updateDropActors(dt) {
  for (let i = dropActors.length - 1; i >= 0; i--) {
    const act = dropActors[i];
    if (act.update(dt) === true) {
      scene.remove(act.group);
      dropActors.splice(i, 1);
    }
  }
}

const dropA = new THREE.Vector3();
const dropB = new THREE.Vector3();

// The body that falls inside a drop actor: a glowing orb for fruit, the real
// bomb (body, fuse, spark) for bombs.
function makeDropBody(kind) {
  if (kind !== 'bomb') return new THREE.Mesh(meteorGeo, ufoDomeMat);
  const bomb = makeBombMesh();
  bomb.scale.setScalar(0.85);
  return bomb;
}

function dropBurst(kind) {
  return kind === 'bomb' ? BURST.bomb : BURST.apple;
}

// Apples become board objects when their drop lands. Bombs do the same, except
// that a cell the snake already occupies sends the bomb to the mouth instead.
function landDrop(kind, item) {
  if (kind === 'bomb') landBomb(item);
  else landItem(item, 0.01);
}

// A bomb that lands where the snake already is cannot sit on the board, so it
// flies into the mouth and detonates there.
function flyBombToMouth(cell) {
  const mesh = makeBombMesh();
  const from = new THREE.Vector3(cell.x + 0.5, 0.5, cell.y + 0.5);
  const to = new THREE.Vector3();
  mesh.position.copy(from);
  scene.add(mesh);
  let t = 0;

  dropActors.push({
    group: mesh,
    update(dt) {
      t += dt / 0.45;
      const head = state.snake[0];
      to.set(head.x + 0.5, 0.55, head.y + 0.5);
      const p = Math.min(1, t);
      mesh.position.lerpVectors(from, to, p);
      mesh.position.y += Math.sin(p * Math.PI) * 1.6;
      mesh.rotation.z += dt * 11;
      mesh.scale.setScalar(1 - p * 0.3);
      if (p < 1) return false;
      const cut = eatBomb(state, { x: head.x, y: head.y });
      sfx.explode();
      burst(to, BURST.bomb, { count: 22, power: 1.5 });
      bombDebris(cut);
      shakeMag = Math.max(shakeMag, 0.45);
      flash('#ff8a3d', '55');
      refreshHud();
      return true;
    },
  });
}

function landBomb(cell) {
  if (state.dead || state.won) return;
  // Prefer the board over the snake: a bomb aimed at a body cell moves to a free
  // cell while one exists. Only a board with nowhere left sends it into the mouth.
  const onSnake = state.snake.some((s) => s.x === cell.x && s.y === cell.y);
  const spot = onSnake ? freeCellFor(state) : cell;
  if (spot && spawnBombAt(state, spot)) {
    refreshHud();
    camPunch += 0.15;
    return;
  }
  flyBombToMouth(spot || cell);
}

function birdDrop(apples) {
  const g = makeBird();
  scene.add(g);
  const n = apples.length;
  if (!n) return { group: g, update: () => true };
  const pts = apples.map((a) => new THREE.Vector3(a.x + 0.5, 1.9, a.y + 0.5));
  const start = new THREE.Vector3(-3.4, 3.3, pts[0].z - 1.4);
  const end = new THREE.Vector3(state.w + 3.4, 3.5, pts[n - 1].z + 1.4);
  const curve = new THREE.CatmullRomCurve3([start, ...pts, end], false, 'catmullrom', 0.2);
  const speed = 0.55 + 0.16 * (n + 1);
  const dropped = new Array(n).fill(false);
  let t = 0;

  return {
    group: g,
    update(dt) {
      t += dt / speed;
      const u = Math.min(1, t);
      curve.getPoint(u, dropA);
      curve.getPoint(Math.min(1, u + 0.02), dropB);
      g.position.copy(dropA);
      g.lookAt(dropB);
      const flap = Math.sin(clock * 17) * 0.75;
      g.userData.wings[0].rotation.z = flap;
      g.userData.wings[1].rotation.z = -flap;

      for (let i = 0; i < n; i++) {
        if (dropped[i] || u < (i + 1) / (n + 1) - 0.015) continue;
        dropped[i] = true;
        landDrop('apple', apples[i]);
        dropA.set(apples[i].x + 0.5, 0.5, apples[i].y + 0.5);
        burst(dropA, BURST.apple, { count: 6, power: 1.1 });
      }
      if (t > 1) g.position.y = end.y + (t - 1) * 5;
      return t > 1.25;
    },
  };
}

function parachuteDrop(items, kind) {
  const g = new THREE.Group();
  scene.add(g);
  const drops = items.map((a, i) => {
    const m = makeParachute();
    if (kind === 'bomb') {
      const body = makeDropBody(kind);
      body.position.set(0, 0.0, 0);
      m.add(body);
    }
    m.position.set(a.x + 0.5, 8.6 + i * 0.3, a.y + 0.5);
    m.userData.seed = Math.random() * TAU;
    g.add(m);
    return { m, a, t: -i * 0.12, landed: false };
  });
  let elapsed = -1;

  return {
    group: g,
    update(dt) {
      elapsed += dt;
      let all = true;
      for (const it of drops) {
        if (it.landed) continue;
        it.t += dt;
        if (it.t < 0) { all = false; continue; }
        const p = Math.min(1, it.t / 1.5);
        it.m.position.y = 8.6 - p * 7.7;
        it.m.position.x = it.a.x + 0.5 + Math.sin(it.t * 2.4 + it.m.userData.seed) * 0.26 * (1 - p);
        it.m.rotation.z = Math.sin(it.t * 2.1) * 0.14;
        if (p >= 1) {
          it.landed = true;
          g.remove(it.m);
          landDrop(kind, it.a);
          dropA.set(it.a.x + 0.5, 0.5, it.a.y + 0.5);
          burst(dropA, dropBurst(kind), { count: 8, power: 1.3 });
        } else {
          all = false;
        }
      }
      return all && elapsed > 0;
    },
  };
}

function ufoDrop(items, kind) {
  const g = makeUfo();
  scene.add(g);
  const n = items.length;
  let cx = 0;
  let cz = 0;
  for (const a of items) { cx += a.x + 0.5; cz += a.y + 0.5; }
  cx /= n;
  cz /= n;
  g.position.set(cx, 4.1, cz);
  const base = kind === 'bomb' ? 0.85 : 1;
  const orbs = items.map((a, i) => {
    const orb = makeDropBody(kind);
    orb.position.set(a.x + 0.5, 2.4, a.y + 0.5);
    orb.visible = false;
    g.add(orb);
    return { orb, a, t: -0.25 - i * 0.16, landed: false };
  });
  let elapsed = 0;
  let allAt = 0;
  let leaveY = 0;

  return {
    group: g,
    update(dt) {
      elapsed += dt;

      let all = true;
      for (const it of orbs) {
        if (it.landed) continue;
        it.t += dt;
        if (it.t < 0) { it.orb.visible = false; all = false; continue; }
        it.orb.visible = true;
        const p = Math.min(1, it.t / 0.7);
        it.orb.position.y = 2.4 - p * 2.05;
        it.orb.position.x = it.a.x + 0.5;
        it.orb.position.z = it.a.y + 0.5;
        it.orb.scale.setScalar(base * (1 - p * 0.55));
        if (p >= 1) {
          it.landed = true;
          g.remove(it.orb);
          landDrop(kind, it.a);
          dropA.set(it.a.x + 0.5, 0.4, it.a.y + 0.5);
          burst(dropA, dropBurst(kind), { count: 7, power: 1 });
        } else {
          all = false;
        }
      }
      if (all && !allAt) allAt = elapsed;

      if (all && elapsed > allAt + 0.35) {
        g.userData.beam.visible = false;
        if (!leaveY) leaveY = g.position.y;
        leaveY += dt * 7;
        g.position.y = leaveY;
        g.rotation.y += dt * 2;
        return leaveY > 11;
      }

      g.position.y = 4.1 + Math.sin(clock * 2.2) * 0.08;
      g.rotation.y += dt * 1.3;
      g.userData.beam.visible = elapsed > 0.25;
      return false;
    },
  };
}

function meteorDrop(items, kind) {
  const g = new THREE.Group();
  scene.add(g);
  const drops = items.map((a, i) => {
    const m = new THREE.Group();
    if (kind === 'bomb') {
      m.add(makeDropBody(kind));
    } else {
      m.add(new THREE.Mesh(meteorGeo, meteorMat));
    }
    const trail = new THREE.Mesh(meteorTrailGeo, meteorTrailMat);
    trail.rotation.x = Math.PI / 2;
    trail.position.z = -0.48;
    m.add(trail);
    const target = new THREE.Vector3(a.x + 0.5, 0.4, a.y + 0.5);
    const start = new THREE.Vector3(
      target.x + rnd(-2.2, 2.2), 9.5 + i * 0.35, target.z + rnd(-2.2, 2.2)
    );
    m.position.copy(start);
    m.lookAt(target);
    g.add(m);
    return { m, a, target, start, t: -i * 0.09, landed: false };
  });
  let elapsed = -1;

  return {
    group: g,
    update(dt) {
      elapsed += dt;
      let all = true;
      for (const it of drops) {
        if (it.landed) continue;
        it.t += dt;
        if (it.t < 0) { all = false; continue; }
        const p = Math.min(1, it.t / 0.55);
        it.m.position.lerpVectors(it.start, it.target, p * p);
        if (p >= 1) {
          it.landed = true;
          g.remove(it.m);
          landDrop(kind, it.a);
          dropA.set(it.a.x + 0.5, 0.4, it.a.y + 0.5);
          burst(dropA, dropBurst(kind), { count: 10, power: 2.2, size: 0.9 });
          if (kind !== 'bomb') burst(dropA, BURST.apple, { count: 8, power: 2.4 });
        } else {
          all = false;
        }
      }
      return all && elapsed > 0;
    },
  };
}

// ---------- thrower figures ----------
// Spectators stand outside the wall and lob the gift in: pop in, wind up,
// release, arc, landing. One figure per item, so a spam batch reads as a crowd.
const FIG_COLORS = [0xffd166, 0x9dff3d, 0x8ff4ff, 0xff9ec7, 0xc7a6ff, 0xffb37a];
const figBodyGeo = new THREE.CapsuleGeometry(0.18, 0.3, 5, 10);
const figHeadGeo = new THREE.SphereGeometry(0.17, 12, 10);
const figLimbGeo = new THREE.CapsuleGeometry(0.055, 0.2, 4, 8);
const figEyeGeo = new THREE.SphereGeometry(0.032, 6, 5);
const figEyeMat = new THREE.MeshBasicMaterial({ color: 0x2a1f2c });const figHeadMat = new THREE.MeshToonMaterial({ color: 0xffe8d6, gradientMap: toonRamp });

function makeThrower() {
  const g = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: pick(FIG_COLORS), gradientMap: toonRamp });
  const body = new THREE.Mesh(figBodyGeo, mat);
  body.position.y = 0.62;
  g.add(body);
  const head = new THREE.Mesh(figHeadGeo, figHeadMat);
  head.position.y = 1.08;
  g.add(head);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(figEyeGeo, figEyeMat);
    eye.position.set(s * 0.065, 1.11, 0.15);
    g.add(eye);
    const leg = new THREE.Mesh(figLimbGeo, mat);
    leg.position.set(s * 0.09, 0.2, 0);
    g.add(leg);
  }
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.2, 0.8, 0);
    const limb = new THREE.Mesh(figLimbGeo, mat);
    limb.position.y = -0.16;
    pivot.add(limb);
    g.add(pivot);
    return pivot;
  });
  g.userData.arm = arms[1];
  g.userData.body = body;
  return g;
}

// ---------- spectator crowd ----------
// The crowd lives on the apron outside the wall: figures walk between spots,
// turn to watch the snake, and chat with their neighbour. Each gift goes to the
// nearest free spectator, who shows the gifter's avatar and lobs the item in.
const spectators = [];
const avatarCache = new Map();
const bubbleCache = new Map();
const CHATTER = [
  'nice!', 'go go go', 'apple!!', 'bomb?', 'ooh', 'lol', 'watch tail',
  'hot!', 'again', 'wow', 'my apple', 'come on', 'look up', 'gg',
];

function bubbleTexture(text) {
  let tex = bubbleCache.get(text);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const r = 26;
  g.fillStyle = 'rgba(255, 252, 250, 0.97)';
  g.strokeStyle = 'rgba(94, 56, 80, 0.2)';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(8 + r, 6);
  g.arcTo(248, 6, 248, 96, r);
  g.arcTo(248, 96, 8, 96, r);
  g.arcTo(8, 96, 8, 6, r);
  g.arcTo(8, 6, 248, 6, r);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(112, 94);
  g.lineTo(146, 94);
  g.lineTo(128, 124);
  g.closePath();
  g.fill();
  g.fillStyle = '#5e3850';
  g.font = 'bold 36px "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 52, 212);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  bubbleCache.set(text, tex);
  return tex;
}

function avatarTexture(name) {
  let tex = avatarCache.get(name);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  let hue = 0;
  for (let i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
  g.fillStyle = `hsl(${hue} 76% 68%)`;
  g.beginPath();
  g.arc(64, 64, 58, 0, TAU);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 62px "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name[0].toUpperCase(), 64, 68);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  avatarCache.set(name, tex);
  return tex;
}

function makeSpectator() {
  const fig = makeThrower();
  const pic = new THREE.Sprite(new THREE.SpriteMaterial({
    transparent: true, depthWrite: false,
  }));
  pic.scale.set(0.66, 0.66, 1);
  pic.position.y = 1.78;
  pic.visible = false;
  fig.add(pic);
  const bubble = new THREE.Sprite(new THREE.SpriteMaterial({
    transparent: true, depthWrite: false,
  }));
  bubble.scale.set(1.5, 0.75, 1);
  bubble.position.y = 2.34;
  bubble.visible = false;
  fig.add(bubble);
  fig.userData.isSpectator = true;
  scene.add(fig);
  return {
    fig, pic, bubble, arm: fig.userData.arm,
    baseYaw: 0, seed: rnd(0, TAU),
    job: null, avatarT: 0, bubbleT: 0, chatT: rnd(4, 9),
    turn: 0, reply: null,
    dest: null, restT: rnd(0.4, 1.8), walkT: 0,
  };
}

// Anyone may wander the whole apron; the front bias keeps most of them visible.
function layoutSpectators() {
  if (!spectators.length) for (let i = 0; i < 5; i++) spectators.push(makeSpectator());
  const { w, h } = state;
  for (const s of spectators) {
    const spot = apronPoint(w, h);
    s.fig.position.set(spot.x, 0, spot.z);
    s.fig.lookAt(w / 2, 0, h / 2);
    s.baseYaw = s.fig.rotation.y;
  }
  for (const s of spectators) clearSpectator(s);
}

function clearSpectator(s) {
  if (s.job && s.job.proj) scene.remove(s.job.proj);
  s.job = null;
  s.dest = null;
  s.restT = rnd(0.6, 2);
  s.arm.rotation.x = 0;
  s.fig.rotation.x = 0;
  s.pic.visible = false;
  s.avatarT = 0;
  s.bubble.visible = false;
  s.bubbleT = 0;
  s.turn = 0;
  s.reply = null;
  s.chatT = rnd(3, 8);
}

function nearestFreeSpectator(cell) {
  let best = null;
  let bd = Infinity;
  for (const s of spectators) {
    if (s.job) continue;
    const d = Math.hypot(s.fig.position.x - (cell.x + 0.5), s.fig.position.z - (cell.y + 0.5));
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// A walk target nobody is standing on and no scenery occupies. Candidates are
// retried a few times; if the apron is crowded the last one is good enough.
function walkTarget(s) {
  const others = spectators
    .filter((o) => o !== s)
    .map((o) => ({ x: o.fig.position.x, z: o.fig.position.z }));
  const props = sceneryGroup.children.map((c) => ({ x: c.position.x, z: c.position.z }));
  let dest = apronPoint(state.w, state.h);
  for (let i = 0; i < 8; i++) {
    if (clearOf(dest, others, APRON.spacing) && clearOf(dest, props, 0.6)) break;
    dest = apronPoint(state.w, state.h);
  }
  return dest;
}

// Turn on the spot back to the playfield, along the short arc.
function easeYawToBoard(s, dt) {
  const want = faceYaw(s.fig.position, { x: state.w / 2, z: state.h / 2 });
  let delta = ((want - s.baseYaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
  s.baseYaw += delta * Math.min(1, dt * 2.2);
}

function showAvatar(s, viewer) {
  if (!viewer) return;
  s.pic.material.map = avatarTexture(viewer);
  s.pic.material.opacity = 1;
  s.pic.material.needsUpdate = true;
  s.pic.visible = true;
  s.avatarT = 2.3;
}

function say(s, text, turn = 0) {
  s.bubble.material.map = bubbleTexture(text);
  s.bubble.material.opacity = 1;
  s.bubble.material.needsUpdate = true;
  s.bubble.visible = true;
  s.bubbleT = 1.9;
  s.turn = turn;
}

function neighbourOf(s) {
  let best = null;
  let bd = Infinity;
  for (const o of spectators) {
    if (o === s) continue;
    const d = Math.abs(o.fig.position.x - s.fig.position.x);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// One throw job per gifted item. Items from the same gift arrive in a stagger so
// a batch reads as the crowd taking turns rather than one figure doing double
// duty.
function throwWithSpectators(items, kind, viewer) {
  items.forEach((cell, i) => {
    const s = nearestFreeSpectator(cell);
    if (!s) {
      // Every spectator is mid-throw: the item still lands, just without a hand.
      landDrop(kind, cell);
      return;
    }
    s.job = {
      cell, kind, delay: i * 0.24, t: 0, threw: false, projT: 0, restT: 0,
      start: new THREE.Vector3(),
      target: new THREE.Vector3(cell.x + 0.5, 0.4, cell.y + 0.5),
    };
    // Face the landing cell: the hand origin is read off the figure, so a
    // walked position throws from where the figure actually stands.
    s.baseYaw = faceYaw(s.fig.position, { x: cell.x + 0.5, z: cell.y + 0.5 });
    showAvatar(s, viewer);
    s.bubble.visible = false;
    s.bubbleT = 0;
    s.turn = 0;
    s.reply = null;
  });
}

const throwFwd = new THREE.Vector3();

function updateSpectators(dt) {
  for (const s of spectators) {
    const walking = !s.job && s.dest !== null && s.bubbleT <= 0;
    s.walkT += dt;
    s.fig.position.y = Math.sin(s.walkT * (walking ? 8.5 : 2.1) + s.seed) * (walking ? 0.07 : 0.035);
    s.fig.rotation.y = s.baseYaw + Math.sin(clock * 0.9 + s.seed) * 0.07 + s.turn;

    if (s.avatarT > 0) {
      s.avatarT -= dt;
      s.pic.material.opacity = Math.min(1, s.avatarT / 0.35);
      if (s.avatarT <= 0) s.pic.visible = false;
    }

    const j = s.job;
    if (!j) {
      // A bubble holds the figure still: walkers stop to talk, then move on.
      const paused = s.bubbleT > 0;
      if (s.dest === null) {
        s.restT -= dt;
        if (s.restT <= 0) s.dest = walkTarget(s);
      } else if (!paused) {
        const step = walkStep(s.fig.position, s.dest, 0.45, dt);
        if (!step.arrived) s.baseYaw = faceYaw(s.fig.position, s.dest);
        s.fig.position.x = step.x;
        s.fig.position.z = step.z;
        if (step.arrived) {
          s.dest = null;
          s.restT = rnd(1.2, 3.6);
        }
      }
      // Standing or talking, a figure turns back to watch the playfield.
      if (s.dest === null || paused) easeYawToBoard(s, dt);

      if (s.bubbleT > 0) {
        s.bubbleT -= dt;
        s.bubble.material.opacity = Math.min(1, s.bubbleT / 0.4);
        if (s.bubbleT <= 0) {
          s.bubble.visible = false;
          s.turn = 0;
        }
      }

      // Talking figures wave; idle ones just sway.
      s.arm.rotation.x = s.bubbleT > 0
        ? -2.25 + Math.sin(clock * 9 + s.seed) * 0.3
        : Math.sin(clock * 1.6 + s.seed) * 0.05;

      if (s.reply) {
        s.reply.t -= dt;
        if (s.reply.t <= 0) {
          say(s, s.reply.text, s.reply.turn);
          s.reply = null;
          s.chatT = Math.max(s.chatT, 3);
        }
      } else if (s.chatT > 0) {
        s.chatT -= dt;
      } else if (s.dest === null) {
        const mate = neighbourOf(s);
        const turn = mate ? Math.sign(mate.fig.position.x - s.fig.position.x) * 0.45 : 0;
        say(s, pick(CHATTER), turn);
        s.chatT = rnd(5, 11);
        // Half the time the neighbour answers, which is what makes the row alive.
        if (mate && Math.random() < 0.55 && !mate.job && mate.bubbleT <= 0) {
          mate.reply = { text: pick(CHATTER), t: rnd(0.55, 1.3), turn: -turn };
        }
      }
      continue;
    }

    j.t += dt;
    if (j.t < j.delay) continue;
    const t = j.t - j.delay;

    // Wind up: the throwing arm swings back while the figure leans.
    if (!j.threw && t < 0.34) {
      const w = t / 0.34;
      s.arm.rotation.x = w * w * 1.9;
      s.fig.rotation.x = -0.1 * w;
      continue;
    }

    // Release: hand forward, projectile leaves the hand on an arc.
    if (!j.threw) {
      j.threw = true;
      s.arm.rotation.x = -0.9;
      s.fig.rotation.x = 0.08;
      s.fig.updateMatrixWorld();
      throwFwd.set(0, 0, 1).applyQuaternion(s.fig.quaternion);
      j.start.copy(s.fig.position).addScaledVector(throwFwd, 0.42);
      j.start.y += 1.02;
      const m = j.kind === 'bomb' ? makeBombMesh() : makeAppleMesh();
      m.scale.setScalar(0.9);
      m.position.copy(j.start);
      scene.add(m);
      j.proj = m;
    }

    if (j.proj) {
      j.projT += dt;
      const p = Math.min(1, j.projT / 0.5);
      j.proj.position.lerpVectors(j.start, j.target, p);
      j.proj.position.y += Math.sin(p * Math.PI) * 1.5;
      j.proj.rotation.z += dt * 9;
      if (p >= 1) {
        scene.remove(j.proj);
        j.proj = null;
        landDrop(j.kind, j.cell);
        burst(j.target, dropBurst(j.kind), { count: 8, power: 1.3 });
      }
      continue;
    }

    // Settle: the arm drops back to the loiter pose before the next gift.
    j.restT += dt;
    s.arm.rotation.x *= Math.max(0, 1 - dt * 8);
    s.fig.rotation.x *= Math.max(0, 1 - dt * 8);
    if (j.restT > 0.55) s.job = null;
  }
}

// ---------- scenery props ----------
// Static dressing on the apron: bushes, rocks, flowers and crates so the rim
// reads as a place instead of empty stage. The layout is pure (see apron.js) and
// stays outside the wall, so every board resize simply rebuilds the ring.
const sceneryGroup = new THREE.Group();
scene.add(sceneryGroup);

const bushGeo = new THREE.IcosahedronGeometry(0.29, 0);
const bushMat = new THREE.MeshToonMaterial({ color: 0x9ed07a, gradientMap: toonRamp });
const rockGeo = new THREE.DodecahedronGeometry(0.3, 0);
const rockMat = new THREE.MeshToonMaterial({ color: 0xbfb3cc, gradientMap: toonRamp });
const flowerStemGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.42, 5);
const flowerStemMat = new THREE.MeshToonMaterial({ color: 0x8fc98a, gradientMap: toonRamp });
const flowerHeadGeo = new THREE.SphereGeometry(0.12, 10, 8);
const flowerHeadMat = new THREE.MeshToonMaterial({ color: 0xff9fc0, gradientMap: toonRamp });
const crateGeo = new THREE.BoxGeometry(0.46, 0.4, 0.46);
const cratePostGeo = new THREE.BoxGeometry(0.075, 0.44, 0.075);
const crateMat = new THREE.MeshToonMaterial({ color: 0xd9a56d, gradientMap: toonRamp });
const cratePostMat = new THREE.MeshToonMaterial({ color: 0xc28a52, gradientMap: toonRamp });

// Three overlapping lobes: cheaper than a sculpt and reads as a bush from above.
function makeBush() {
  const g = new THREE.Group();
  const lobes = [[0, 0.22, 0, 1], [-0.17, 0.16, 0.09, 0.72], [0.15, 0.18, -0.08, 0.64]];
  for (const [x, y, z, s] of lobes) {
    const lobe = new THREE.Mesh(bushGeo, bushMat);
    lobe.position.set(x, y, z);
    lobe.scale.set(s, s * 0.84, s);
    g.add(lobe);
  }
  return g;
}

function makeRock() {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(rockGeo, rockMat);
  rock.position.y = 0.17;
  rock.scale.set(1, 0.72, 0.9);
  rock.rotation.y = 0.6;
  g.add(rock);
  return g;
}

function makeFlower() {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(flowerStemGeo, flowerStemMat);
  stem.position.y = 0.21;
  g.add(stem);
  const head = new THREE.Mesh(flowerHeadGeo, flowerHeadMat);
  head.position.y = 0.46;
  g.add(head);
  return g;
}

// Corner posts soften the box silhouette into something closer to a rounded crate.
function makeCrate() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(crateGeo, crateMat);
  box.position.y = 0.2;
  g.add(box);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(cratePostGeo, cratePostMat);
      post.position.set(sx * 0.2, 0.22, sz * 0.2);
      g.add(post);
    }
  }
  return g;
}

const PROP_FACTORIES = { bush: makeBush, rock: makeRock, flower: makeFlower, crate: makeCrate };

function layoutScenery() {
  // Geometry and materials are shared by every prop, so a rebuild drops the
  // groups only and never disposes them.
  sceneryGroup.clear();
  for (const item of sceneryLayout(state.w, state.h)) {
    const prop = PROP_FACTORIES[item.kind]();
    prop.position.set(item.x, 0, item.z);
    prop.rotation.y = item.rot;
    prop.scale.setScalar(item.scale);
    prop.userData.kind = item.kind;
    sceneryGroup.add(prop);
  }
}

// Every apple and bomb gift is now a crowd throw; the older flying deliveries
// stay in the file as spares and can be requested by name from `startDrop`.
function startDrop(items, variant, kind = 'apple', viewer = null) {
  if (variant === 'thrower') {
    throwWithSpectators(items, kind, viewer);
    return;
  }
  const act =
    variant === 'parachute' ? parachuteDrop(items, kind) :
    variant === 'ufo' ? ufoDrop(items, kind) :
    variant === 'meteor' ? meteorDrop(items, kind) :
    birdDrop(items);
  dropActors.push(act);
}

// Every apple and bomb gift is now a crowd throw; the older flying deliveries
// stay in the file as spares and can be re-enabled from here.
function nextDropVariant() {
  return 'thrower';
}

function queueAppleGift() {
  // Treat rapid taps as one viewer spamming the same gift.
  const viewer = lastViewer && Math.random() < 0.68 ? lastViewer : pick(VIEWERS);
  lastViewer = viewer;
  let b = appleBatches.get(viewer);
  if (!b) {
    b = { count: 0, timer: 0 };
    appleBatches.set(viewer, b);
    b.timer = setTimeout(() => flushAppleBatch(viewer), APPLE_BATCH_MS);
  }
  b.count++;
}

function flushAppleBatch(viewer) {
  const b = appleBatches.get(viewer);
  if (!b) return;
  appleBatches.delete(viewer);
  if (state.dead || state.won) return;

  // Gift apples may take the tail cell when the board is full; procedural
  // apples never do.
  const apples = [];
  for (let i = 0; i < b.count; i++) {
    const a = spawnGiftApple(state);
    if (!a) break;
    a.dropAt = Number.POSITIVE_INFINITY;
    apples.push(a);
  }
  if (!apples.length) {
    sfx.error();
    toast('🍎 No empty cells for more apples', 'bad');
    return;
  }

  startDrop(apples, nextDropVariant(), 'apple', viewer);
  sfx.gift('apple');
  camPunch += 0.5;
  flash('#9dff3d');
  const label = apples.length > 1 ? `${apples.length} apples` : '1 apple';
  toast(`🍎 <b>@${viewer}</b> dropped ${label}`, 'good');
  logGift('apple', viewer, apples.length);
  countGift(viewer, 'apple', apples.length);
  refreshHud();
}

// particles
// shortcut: one shared instanced particle pool; upgrade to GPU points if bursts ever get dense.
const P_MAX = 320;
const particleMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.09, 0.09, 0.09),
  new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
  P_MAX
);
particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
particleMesh.frustumCulled = false;
scene.add(particleMesh);
for (let i = 0; i < P_MAX; i++) particleMesh.setColorAt(i, new THREE.Color(0xffffff));
particleMesh.instanceColor.needsUpdate = true;

const particles = Array.from({ length: P_MAX }, () => ({
  life: 0,
  max: 1,
  grav: 8,
  size: 1,
  spin: 0,
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
}));
let particleCursor = 0;

// Burst presets give each gift its own readable signature: colour, count, weight.
const BURST = {
  apple: { color: 0x9dff3d, count: 18, power: 3.2, spread: 1, up: 0.9, gravity: 7, size: 1.1 },
  bomb: { color: 0xff8a3d, count: 20, power: 4.6, spread: 1.1, up: 0.8, gravity: 9, size: 1.2 },
  speed: { color: 0x39f6ff, count: 22, power: 4, spread: 0.5, up: 0.5, gravity: 1.5, size: 0.85 },
  slow: { color: 0xffc14d, count: 20, power: 1.5, spread: 1.1, up: 1.3, gravity: 0.8, size: 1.4 },
  eat: { color: 0xff2d55, count: 14, power: 2.8, spread: 1, up: 0.8, gravity: 8, size: 0.9 },
  crash: { color: 0xff2d55, count: 54, power: 6.5, spread: 1.4, up: 1, gravity: 8, size: 1.3 },
  win: { color: 0x9dff3d, count: 26, power: 6, spread: 1.5, up: 1.2, gravity: 4, size: 1.2 },
};

const dummy = new THREE.Object3D();
const tempColor = new THREE.Color();
const tmpVec = new THREE.Vector3();

// tmpVec is shared; emit copies every scalar immediately, so callers can reuse it.
function emit(x, y, z, vx, vy, vz, gravity, life, size) {
  const i = particleCursor;
  particleCursor = (particleCursor + 1) % P_MAX;
  const p = particles[i];
  p.life = p.max = life;
  p.pos.set(x, y, z);
  p.vel.set(vx, vy, vz);
  p.grav = gravity;
  p.size = size;
  p.spin = rnd(-1, 1) * 7;
  particleMesh.setColorAt(i, tempColor);
}

function burst(pos, preset, opts = null) {
  const count = Math.max(1, (opts && opts.count) || preset.count);
  const spread = opts && opts.spread != null ? opts.spread : preset.spread;
  const up = opts && opts.up != null ? opts.up : preset.up;
  const size = opts && opts.size != null ? opts.size : preset.size;
  const gravity = opts && opts.gravity != null ? opts.gravity : preset.gravity;
  const power = preset.power * (opts && opts.power != null ? opts.power : 1);
  const life = opts && opts.life != null ? opts.life : 1;
  const ring = !!(opts && opts.ring);
  const dirMix = opts && opts.dirMix != null ? opts.dirMix : 0;
  const dx = (opts && opts.dx) || 0;
  const dy = (opts && opts.dy) || 0;
  const dz = (opts && opts.dz) || 0;

  tempColor.set((opts && opts.color) || preset.color);
  for (let k = 0; k < count; k++) {
    let vx;
    let vy;
    let vz;
    if (ring) {
      const a = (k / count) * TAU + rnd(-0.12, 0.12);
      vx = Math.cos(a);
      vz = Math.sin(a);
      vy = rnd(0.15, 0.6) * up;
    } else {
      vx = rnd(-1, 1) * spread;
      vy = rnd(0.15, 1.15) * up;
      vz = rnd(-1, 1) * spread;
    }
    vx += dx * dirMix;
    vy += dy * dirMix;
    vz += dz * dirMix;
    const inv = 1 / (Math.hypot(vx, vy, vz) || 1);
    const speed = power * rnd(0.45, 1);
    emit(
      pos.x,
      pos.y,
      pos.z,
      vx * inv * speed,
      vy * inv * speed,
      vz * inv * speed,
      gravity,
      rnd(0.35, 0.85) * life,
      size * rnd(0.7, 1.3)
    );
  }
  particleMesh.instanceColor.needsUpdate = true;
}

// Bomb debris: chunks fly outward from the removed tail, not up from the floor.
function bombDebris(segments) {
  if (!segments.length) return;
  let cx = 0;
  let cz = 0;
  for (const s of segments) {
    cx += s.x;
    cz += s.y;
  }
  cx = cx / segments.length + 0.5;
  cz = cz / segments.length + 0.5;

  tempColor.set(BURST.bomb.color);
  for (const s of segments) {
    const px = s.x + 0.5;
    const pz = s.y + 0.5;
    let dx = px - cx;
    let dz = pz - cz;
    if (Math.hypot(dx, dz) < 0.01) {
      const a = rnd(0, TAU);
      dx = Math.cos(a);
      dz = Math.sin(a);
    }
    const inv = 1 / (Math.hypot(dx, dz) || 1);
    for (let k = 0; k < 9; k++) {
      const ang = rnd(-0.9, 0.9);
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const sp = rnd(2, 4.5);
      emit(
        px,
        0.45,
        pz,
        (dx * ca - dz * sa) * inv * sp,
        rnd(1.5, 4),
        (dx * sa + dz * ca) * inv * sp,
        9,
        rnd(0.4, 0.9),
        rnd(0.7, 1.4)
      );
    }
  }
  particleMesh.instanceColor.needsUpdate = true;
}

function hideParticles() {
  for (let i = 0; i < P_MAX; i++) {
    const p = particles[i];
    p.life = 0;
    dummy.position.set(0, -60, 0);
    dummy.scale.setScalar(0.0001);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    particleMesh.setMatrixAt(i, dummy.matrix);
  }
  particleMesh.instanceMatrix.needsUpdate = true;
}

function updateParticles(dt) {
  for (let i = 0; i < P_MAX; i++) {
    const p = particles[i];
    if (p.life > 0) {
      p.life -= dt;
    }
    if (p.life > 0) {
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(1 - Math.min(0.9, 2.5 * dt));
      p.pos.addScaledVector(p.vel, dt);
      const fade = p.life / p.max;
      const scale = p.size * Math.min(1, fade * 2);
      dummy.position.copy(p.pos);
      dummy.scale.setScalar(scale);
      dummy.rotation.set(clock * p.spin, clock * p.spin * 0.7, 0);
    } else {
      dummy.position.set(0, -60, 0);
      dummy.scale.setScalar(0.0001);
      dummy.rotation.set(0, 0, 0);
    }
    dummy.updateMatrix();
    particleMesh.setMatrixAt(i, dummy.matrix);
  }
  particleMesh.instanceMatrix.needsUpdate = true;
}

// ---------- state ----------
// Board size is a session setting: a gifted growth restarts the round at the
// new size instead of reshaping the body mid-round.
const boardSize = { w: CONFIG.boardW, h: CONFIG.boardH };
let state = createState(undefined, boardSize);
const visual = Array.from({ length: MAX_SEG }, () => new THREE.Vector3());
const trail = [];
let visualP = 1;
let headYaw = 0;
let yawReady = false;
const appleMeshes = [];
const bombMeshes = [];
let appleClock = 0;
let deadAt = 0;
let wonAt = 0;
let roundCounted = false;
let victoryLap = true;
let debugSpeed = 1;
let simGifts = false;

// Debug toggles survive a reload; sound already persists on its own key.
const DEBUG_KEY = 'giftsnake.debug';
const debugPrefs = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(DEBUG_KEY) || 'null') || {};
    return {
      winLap: raw.winLap !== false,
      gifts: !!raw.gifts,
      speed: Number(raw.speed) || 1,
    };
  } catch (e) {
    return { winLap: true, gifts: false, speed: 1 };
  }
})();
victoryLap = debugPrefs.winLap;
simGifts = debugPrefs.gifts;
debugSpeed = Math.max(1, debugPrefs.speed);

function saveDebug() {
  try {
    localStorage.setItem(
      DEBUG_KEY,
      JSON.stringify({ winLap: victoryLap, gifts: simGifts, speed: debugSpeed })
    );
  } catch (e) {
    // Private-mode storage failures must not break the stream.
  }
}
let giftClock = 0;
let cdKey = '';
let clock = 0;
let shakeMag = 0;

const winFx = Array.from({ length: 8 }, () => ({ at: 0, x: 0, y: 0, z: 0, color: 0x9dff3d, active: false }));
const WIN_COLORS = [0x9dff3d, 0x39f6ff, 0xff3ea5, 0xffc14d];

const camBase = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const camDesired = new THREE.Vector3();
let camDist = 0;
let camPunch = 0;
let fovKick = 0;
let nearMissAt = -9;

// Framing fits the whole stage: board plus the rim ring the crowd stands on,
// on both axes, so the apron stays in frame in a vertical stream layout.
function fitDistance() {
  const halfV = THREE.MathUtils.degToRad(CAM_FOV) / 2;
  const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
  const tanV = Math.tan(halfV);
  const tanH = Math.tan(halfH);
  const cx = state.w / 2;
  const cz = state.h / 2;
  let d = 0;
  for (const x of [-RIM_FRAME, state.w + RIM_FRAME]) {
    for (const z of [-RIM_FRAME, state.h + RIM_FRAME]) {
      for (const y of [0, 1.8]) {
        const rx = x - cx;
        const rz = z - cz;
        const along = rx * CAM_DIR.x + y * CAM_DIR.y + rz * CAM_DIR.z;
        const right = Math.abs(rx * CAM_RIGHT.x + rz * CAM_RIGHT.z);
        const up = Math.abs(rx * CAM_UP.x + y * CAM_UP.y + rz * CAM_UP.z);
        d = Math.max(d, right / tanH + along, up / tanV + along);
      }
    }
  }
  return d * 1.005 + 0.08;
}

const SNAKE_Y = 0.45;
function setWorld(p, out) {
  return out.set(p.x + 0.5, SNAKE_Y, p.y + 0.5);
}

// Rendering-only clamp: the trail can carry an extrapolated tail cell, and the
// tube payback can extend a tail past a wall. Keeping the centreline at least
// half a cell inside keeps the 0.45 radius tube off the wall.
function clampToBoard(p) {
  p.x = Math.min(state.w - 0.5, Math.max(0.5, p.x));
  p.z = Math.min(state.h - 0.5, Math.max(0.5, p.z));
  return p;
}

function resetTrail() {
  trail.length = 0;
  const snake = state.snake;
  const n = Math.min(snake.length, MAX_SEG);
  for (let i = 0; i < n; i++) trail.push({ x: snake[i].x, y: snake[i].y });
  if (n) {
    const tail = trail[n - 1];
    const prev = trail[n - 2] || tail;
    trail.push({ x: tail.x + tail.x - prev.x, y: tail.y + tail.y - prev.y });
  }
  visualP = 1;
}

// Follow the head trail at a fixed one-cell spacing. Easing each body point
// independently shortened the snake on every turn; arclength sampling cannot.
function pushTrail() {
  const snake = state.snake;
  if (!snake.length) {
    trail.length = 0;
    return;
  }
  const head = snake[0];
  if (!trail.length || trail[0].x !== head.x || trail[0].y !== head.y) {
    trail.unshift({ x: head.x, y: head.y });
    visualP = 0;
  }
  const want = Math.min(MAX_SEG + 1 + TRAIL_EXTRA, snake.length + 1 + TRAIL_EXTRA);
  while (trail.length > want) trail.pop();
  if (trail.length <= snake.length) resetTrail();
}

function sampleTrail(d, out) {
  const max = trail.length - 1;
  if (max <= 0) {
    const c = trail[0] || state.snake[0];
    out.set(c.x + 0.5, SNAKE_Y, c.y + 0.5);
    return clampToBoard(out);
  }
  const at = Math.max(0, Math.min(max, d));
  if (at === max) {
    const c = trail[max];
    out.set(c.x + 0.5, SNAKE_Y, c.y + 0.5);
    return clampToBoard(out);
  }
  const i = Math.floor(at);
  const f = at - i;
  const a = trail[i];
  const b = trail[i + 1];
  out.set(a.x + (b.x - a.x) * f + 0.5, SNAKE_Y, a.y + (b.y - a.y) * f + 0.5);
  return clampToBoard(out);
}

function syncSnake(dt) {
  const snake = state.snake;
  const n = Math.min(snake.length, MAX_SEG);
  if (!trail.length) resetTrail();
  else if (snake.length && (trail[0].x !== snake[0].x || trail[0].y !== snake[0].y)) pushTrail();
  const want = Math.min(MAX_SEG + 1 + TRAIL_EXTRA, snake.length + 1 + TRAIL_EXTRA);
  while (trail.length > want) trail.pop();
  if (trail.length <= snake.length) resetTrail();

  // Logical ticks jump one cell; visualP slides the body along the trail
  // between them so spacing stays exactly one cell through corners.
  if (!state.dead && !state.won && !state.rescuing) {
    // Track the tick accumulator instead of adding a per-frame fraction: with
    // several logic ticks in one frame (debug 5×+) the fraction capped at 1 and
    // the visual trail fell further and further behind the body.
    visualP = Math.min(1, acc / state.tickMs);
  }
  const back = 1 - visualP;
  for (let i = 0; i < n; i++) sampleTrail(back + i, visual[i]);

  const yawEase = 1 - Math.exp(-dt * 15);
  let cells = 0;
  for (let i = 0; i < n; i++) {
    const cell = snake[i];
    if (!cell) continue;
    cellDummy.position.set(cell.x + 0.5, 0.0035, cell.y + 0.5);
    cellDummy.rotation.set(-Math.PI / 2, 0, 0);
    cellDummy.updateMatrix();
    bodyCells.setMatrixAt(cells++, cellDummy.matrix);
  }
  bodyCells.count = cells;
  bodyCells.instanceMatrix.needsUpdate = true;
  headCell.visible = n > 0;
  if (n) headCell.position.set(snake[0].x + 0.5, 0.008, snake[0].y + 0.5);

  // Head heading drives the eyes; the tube itself takes its direction from the
  // sampled path, so no per-segment yaw is needed.
  const targetYaw = Math.atan2(state.dir.x, state.dir.y);
  if (!yawReady) {
    headYaw = targetYaw;
    if (n > 0) yawReady = true;
  } else {
    headYaw += Math.atan2(Math.sin(targetYaw - headYaw), Math.cos(targetYaw - headYaw)) * yawEase;
  }

  const show = n > 1;
  snakeMesh.visible = show;
  if (show) rebuildTube(n);

  eyes.visible = n > 0;
  if (n) {
    const head = visual[0];
    eyes.position.set(head.x, head.y + 0.16, head.z);
    eyes.rotation.y = headYaw;
  }
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

// Apples leave state only by being eaten or by reset; add a removal call here
// if logic.js ever grows another way to drop apples.
function removeAppleMesh(a) {
  if (!a.mesh) return;
  scene.remove(a.mesh);
  const idx = appleMeshes.indexOf(a.mesh);
  if (idx !== -1) appleMeshes.splice(idx, 1);
  a.mesh = null;
}

function syncApples(dt) {
  for (const a of state.apples) {
    let mesh = a.mesh;
    if (!mesh) {
      mesh = makeAppleMesh();
      mesh.userData.born = clock;
      mesh.userData.seed = Math.random() * TAU;
      mesh.scale.setScalar(0.01);
      a.mesh = mesh;
      appleMeshes.push(mesh);
      scene.add(mesh);
    }
    setWorld(a, tmpVec);
    mesh.position.set(tmpVec.x, 0.06 + Math.sin(clock * 3 + mesh.userData.seed) * 0.07, tmpVec.z);
    mesh.rotation.y = (mesh.rotation.y + dt * 1.7) % TAU;

    // Drop actors own the apple until it lands; the real mesh pops in after.
    if (a.dropAt != null) {
      if (clock < a.dropAt) {
        mesh.visible = false;
        continue;
      }
      a.dropAt = null;
      mesh.visible = true;
      mesh.userData.born = clock;
    }
    const age = clock - mesh.userData.born;
    const pop = age < 0.32 ? Math.max(0.01, easeOutBack(age / 0.32)) : 1;
    mesh.scale.setScalar(pop);
  }
}

// Bombs leave state only by being eaten or by reset, same as apples.
function removeBombMesh(b) {
  if (!b.mesh) return;
  scene.remove(b.mesh);
  const idx = bombMeshes.indexOf(b.mesh);
  if (idx !== -1) bombMeshes.splice(idx, 1);
  b.mesh = null;
}

function syncBombs(dt) {
  for (const b of state.bombs || []) {
    let mesh = b.mesh;
    if (!mesh) {
      mesh = makeBombMesh();
      mesh.userData.born = clock;
      mesh.userData.seed = Math.random() * TAU;
      mesh.scale.setScalar(0.01);
      b.mesh = mesh;
      bombMeshes.push(mesh);
      scene.add(mesh);
    }
    setWorld(b, tmpVec);
    const bob = 0.06 + Math.sin(clock * 3 + mesh.userData.seed) * 0.07;
    mesh.position.set(tmpVec.x, bob, tmpVec.z);
    mesh.rotation.y = (mesh.rotation.y + dt * 0.9) % TAU;
    mesh.rotation.z = Math.sin(clock * 1.7 + mesh.userData.seed) * 0.07;
    mesh.userData.spark.scale.setScalar(0.8 + Math.sin(clock * 22 + mesh.userData.seed) * 0.3);

    const age = clock - mesh.userData.born;
    const pop = age < 0.32 ? Math.max(0.01, easeOutBack(age / 0.32)) : 1;
    mesh.scale.setScalar(pop);
  }
}

function updateCamera(dt) {
  const { w, h } = state;
  camTarget.set(w / 2, 0, h / 2);

  const targetDist = fitDistance();
  camDist += (targetDist - camDist) * (1 - Math.exp(-dt * 2.4));
  camPunch = Math.max(-6, Math.min(9, camPunch)) * Math.exp(-dt * 3.2);
  const dist = Math.max(4, camDist + camPunch);

  camDesired.copy(CAM_DIR).multiplyScalar(dist).add(camTarget);
  const k = 1 - Math.exp(-dt * 3.2);
  camBase.lerp(camDesired, k);
  camLook.lerp(camTarget, k);

  // One NaN in either vector used to freeze the camera for the rest of the run.
  if (!Number.isFinite(camBase.x + camBase.y + camBase.z + camLook.x + camLook.y + camLook.z)) {
    camBase.copy(camDesired);
    camLook.copy(camTarget);
  }

  shakeMag *= Math.exp(-dt * 6);
  const sx = (Math.random() - 0.5) * shakeMag;
  const sy = (Math.random() - 0.5) * shakeMag;
  // Offset along the screen basis; world-axis shake reads as a diagonal wobble
  // once the camera is tilted.
  camera.position.copy(camBase).addScaledVector(CAM_RIGHT, sx).addScaledVector(CAM_UP, sy);
  camera.lookAt(camLook);

  fovKick *= Math.exp(-dt * 6);
  if (Math.abs(fovKick) < 0.01) fovKick = 0;
  const fov = fovKick === 0 ? CAM_FOV : CAM_FOV + fovKick;
  if (Math.abs(camera.fov - fov) > 0.01 || (fovKick === 0 && camera.fov !== CAM_FOV)) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

// ---------- hud ----------
function refreshHud() {
  hud.apples.textContent = state.eaten || 0;
  hud.bombs.textContent = state.bombsEaten || 0;
}

function toast(html, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  hud.toasts.appendChild(el);
  while (hud.toasts.children.length > 5) hud.toasts.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 280);
  }, 2200);
}

const GIFT_POINTS = { apple: 10, bomb: 25, speed: 15, slow: 10, widen: 30, taller: 30 };
const scores = new Map();
const combos = new Map();

function comboFor(viewer) {
  const c = combos.get(viewer) || { n: 0, at: -99 };
  c.n = clock - c.at < 4 ? Math.min(9, c.n + 1) : 1;
  c.at = clock;
  combos.set(viewer, c);
  return Math.min(5, c.n);
}

function renderLeaderboard() {
  const top = [...scores].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!top.length) {
    hud.log.innerHTML = '<li>No gifts yet — keys 1–6</li>';
    return;
  }
  hud.log.innerHTML = top
    .map(([name, pts], i) => {
      const medal = ['🥇', '🥈', '🥉'][i];
      return `<li><b>${medal} @${name}</b><span>${pts.toLocaleString()}</span></li>`;
    })
    .join('');
}

// Viewer rivalry is the reason to come back: points persist across rounds and
// gifts from the same viewer within 4s stack a multiplier (capped at 5x).
function logGift(type, viewer, units = 1) {
  const mult = comboFor(viewer);
  const points = GIFT_POINTS[type] * units * mult;
  scores.set(viewer, (scores.get(viewer) || 0) + points);
  if (mult > 1) toast(`🔥 <b>@${viewer}</b> ${mult}× combo +${points}`, 'good');
  renderLeaderboard();
}

function flash(color, alpha = '66') {
  hud.flash.style.background = `radial-gradient(circle at 50% 45%, ${color}${alpha}, transparent 66%)`;
  hud.flash.classList.remove('on');
  void hud.flash.offsetWidth;
  hud.flash.classList.add('on');
}

function showBanner(title, sub, kind = '') {
  hud.bannerTitle.textContent = title;
  hud.bannerSub.textContent = sub;
  hud.banner.className = `banner show ${kind}`;
}

function hideBanner() {
  hud.banner.className = 'banner';
}

// ---------- debug menu ----------
// Temporary knobs for tuning the stream. D opens it; nothing here changes the
// rules, only pacing.
function applyDebug() {
  state.winDelayMs = victoryLap ? CONFIG.winDelayMs : 0;
}

// Debug gift feed: drops gifts at a viewer-ish rate so a round can be watched
// end to end without tapping. Bombs go out during a rescue so that escape gets
// exercised too.
const SIM_GIFTS = ['apple', 'apple', 'apple', 'bomb', 'bomb', 'speed', 'slow'];
const SIM_GIFT_EVERY = 1.6;

function simGiftTick(dt) {
  if (!simGifts || state.dead || state.won) return;
  giftClock += dt;
  if (giftClock < SIM_GIFT_EVERY) return;
  giftClock = 0;
  sendGift(state.rescuing ? 'bomb' : pick(SIM_GIFTS));
}

function toggleDebug(force) {
  const open = force != null ? force : !hud.debug.classList.contains('show');
  hud.debug.classList.toggle('show', open);
  hud.debug.setAttribute('aria-hidden', open ? 'false' : 'true');
}

// ---------- win / loss record ----------
// Per-round gift counts, for the win summary.
const roundGifts = new Map();

function countGift(viewer, type, n = 1) {
  const r = roundGifts.get(viewer) || { apple: 0, bomb: 0 };
  r[type] += n;
  roundGifts.set(viewer, r);
}

function renderGiftSummary() {
  const top = (type) =>
    [...roundGifts.entries()]
      .map(([v, c]) => ({ v, n: c[type] }))
      .filter((e) => e.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3);
  const list = (rows) =>
    rows.length
      ? `<ol>${rows
          .map((r) => `<li><span>@${r.v}</span><span>×${r.n}</span></li>`)
          .join('')}</ol>`
      : '<div class="empty">no gifts</div>';
  hud.winSummary.innerHTML =
    `<h3>TOP APPLE GIFTERS</h3>${list(top('apple'))}` +
    `<h3>TOP BOMB GIFTERS</h3>${list(top('bomb'))}`;
  hud.winSummary.classList.add('show');
  hud.winSummary.setAttribute('aria-hidden', 'false');
}

const RECORD_KEY = 'giftsnake.record';
const record = (() => {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (v && Number.isFinite(v.wins) && Number.isFinite(v.losses)) {
      return { wins: v.wins, losses: v.losses };
    }
  } catch (e) {
    // Private mode or blocked storage: the record still works for this session.
  }
  return { wins: 0, losses: 0 };
})();

function saveRecord() {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(record));
  } catch (e) {
    // Storage unavailable; nothing to do.
  }
}

function refreshRecord() {
  hud.wins.textContent = record.wins;
  hud.losses.textContent = record.losses;
}

// One result per round: a rescue that is bombed free is not a loss, and a
// manual restart counts as neither.
function bumpRecord(field) {
  if (roundCounted) return;
  roundCounted = true;
  record[field]++;
  saveRecord();
  refreshRecord();
}

// One big overlay for both end-of-round clocks: the victory lap and the
// restart. `low` drops it under the STREAMER WINS banner.
function showCountdown(n, label, low = false) {
  const k = `${n}|${label}|${low ? 1 : 0}`;
  if (cdKey !== k) {
    cdKey = k;
    hud.cdNum.textContent = n;
    hud.cdLabel.textContent = label;
    hud.cd.classList.toggle('low', low);
  }
  hud.cd.classList.add('show');
  hud.cd.setAttribute('aria-hidden', 'false');
}

function hideCountdown() {
  cdKey = '';
  hud.cd.classList.remove('show');
  hud.cd.setAttribute('aria-hidden', 'true');
}

// ---------- gifts ----------
function fovPunch(v) {
  fovKick = Math.max(-6, Math.min(6, fovKick + v));
}

function sendGift(type) {
  if (state.dead || state.won) {
    sfx.error();
    toast('Round over — press <b>R</b> to restart', 'bad');
    return;
  }
  if (state.rescuing && type !== 'bomb') {
    sfx.error();
    toast('💣 Rescue: send a bomb to free the snake', 'bad');
    return;
  }
  const gift = GIFTS[type];
  if (!gift) return;

  if (type === 'apple') {
    queueAppleGift();
    return;
  }

  const viewer = lastViewer && Math.random() < 0.68 ? lastViewer : pick(VIEWERS);
  lastViewer = viewer;

  // Growth reshapes the whole board, so it cannot happen under a running body:
  // take the new size, then restart the round on it, exactly like R.
  if (type === 'widen' || type === 'taller') {
    const ev = applyGift(state, type);
    if (!ev.ok) {
      sfx.error();
      toast(`${gift.icon} Board is already at its maximum size`, 'bad');
      return;
    }
    boardSize.w = ev.w;
    boardSize.h = ev.h;
    sfx.gift(type);
    reset(true);
    logGift(type, viewer);
    toast(`${gift.icon} <b>@${viewer}</b> grew the map to ${ev.w} × ${ev.h}`, 'good');
    return;
  }

  const ev = applyGift(state, type);

  if (type === 'bomb') {
    if (!ev.ok) {
      sfx.error();
      toast('💣 Bomb had no effect', 'bad');
      return;
    }
    sfx.gift(type);
    if (ev.freed) {
      // Rescue path: the bomb detonates on drop so the snake gets its tail back.
      for (const s of ev.removed) {
        setWorld(s, tmpVec);
        tmpVec.y = 0.5;
        burst(tmpVec, BURST.bomb, { count: 8, power: 0.8 });
      }
      bombDebris(ev.removed);
      shakeMag = Math.max(shakeMag, 0.6);
      fovPunch(3);
      flash('#ff5a2d');
      acc = 0;
      hideBanner();
      flash('#9dff3d');
      toast(`💣 <b>@${viewer} freed the snake</b>`, 'good');
      logGift(type, viewer, ev.removed.length);
    } else {
      startDrop([ev.cell], nextDropVariant(), 'bomb', viewer);
      camPunch += 0.5;
      shakeMag = Math.max(shakeMag, 0.25);
      flash('#ff8a3d', '33');
      toast(`💣 <b>@${viewer}</b> dropped a bomb`, 'bad');
      logGift(type, viewer);
      countGift(viewer, 'bomb');
      refreshHud();
    }
  } else if (type === 'speed' || type === 'slow') {
    sfx.gift(type);
    setWorld(state.snake[0], tmpVec);
    tmpVec.y = 0.6;
    if (type === 'speed') {
      burst(tmpVec, BURST.speed, {
        count: 24,
        spread: 0.45,
        dirMix: 1.4,
        dx: -state.dir.x,
        dy: 0.2,
        dz: -state.dir.y,
      });
      camPunch -= 0.8;
      fovPunch(-2.5);
      shakeMag = Math.max(shakeMag, 0.1);
      flash('#39f6ff');
    } else {
      burst(tmpVec, BURST.slow, { count: 22, up: 1.4, power: 0.9 });
      camPunch += 0.6;
      fovPunch(2.2);
      flash('#ffc14d');
    }
    toast(`${gift.icon} <b>${gift.name}</b> → ${(1000 / state.tickMs).toFixed(1)} cells/s`, 'good');
    logGift(type, viewer);
  }

  refreshHud();
}

// ---------- lifecycle ----------
function onRescue() {
  shakeMag = Math.max(shakeMag, 0.45);
  fovPunch(2.5);
  sfx.crash();
  if (state.snake[0]) {
    setWorld(state.snake[0], tmpVec);
    tmpVec.y = 0.6;
    burst(tmpVec, BURST.crash);
  }
  flash('#ffc14d');
  showBanner('TAIL HIT', rescueText(), 'bad');
}

// Rescue banner text, rewritten every frame so the seconds count down.
function rescueText() {
  const left = Math.ceil(state.rescueMs / 1000);
  return `💣 send a bomb to free the snake · ${left}s left`;
}

function onDeath() {
  bumpRecord('losses');
  deadAt = clock;
  shakeMag = Math.max(shakeMag, 0.75);
  fovPunch(4);
  sfx.crash();
  if (state.snake[0]) {
    setWorld(state.snake[0], tmpVec);
    tmpVec.y = 0.6;
    burst(tmpVec, BURST.crash);
  }
  flash('#ff2d55');
  showBanner(
    'SNAKE CRASHED',
    `${record.wins}W ${record.losses}L`,
    'bad',
  );
  renderGiftSummary();
}

function onWin() {
  bumpRecord('wins');
  sfx.win();
  flash('#9dff3d');
  camPunch += 3;
  for (let i = 0; i < winFx.length; i++) {
    const f = winFx[i];
    f.at = clock + i * 0.13;
    f.x = rnd(0.6, Math.max(0.7, state.w - 0.6));
    f.y = rnd(0.8, 2.6);
    f.z = rnd(0.6, Math.max(0.7, state.h - 0.6));
    f.color = pick(WIN_COLORS);
    f.active = true;
  }
  renderGiftSummary();
  showBanner('STREAMER WINS', `board filled · ${record.wins}W ${record.losses}L`, 'good');
}

// Win bursts run on the frame clock, not timers, so a reset can never inherit
// fireworks from the previous round.
function updateWinFx() {
  for (const f of winFx) {
    if (f.active && clock >= f.at) {
      f.active = false;
      tmpVec.set(f.x, f.y, f.z);
      burst(tmpVec, BURST.win, { color: f.color });
    }
  }
}

function reset(keepGrowth = false) {
  // Widen / taller only lasts for the round they were gifted in; the next round
  // returns to the configured board.
  if (!keepGrowth) {
    boardSize.w = CONFIG.boardW;
    boardSize.h = CONFIG.boardH;
  }
  state = createState(undefined, boardSize);
  trail.length = 0;
  resetTrail();
  yawReady = false;
  appleClock = 0;
  deadAt = 0;
  wonAt = 0;
  roundCounted = false;
  roundGifts.clear();
  hud.winSummary.classList.remove('show');
  hud.winSummary.setAttribute('aria-hidden', 'true');
  giftClock = 0;
  applyDebug();
  hideCountdown();
  acc = 0;
  camPunch = 0;
  fovKick = 0;
  shakeMag = 0;
  lastViewer = null;
  for (const b of appleBatches.values()) clearTimeout(b.timer);
  appleBatches.clear();
  for (const act of dropActors) scene.remove(act.group);
  dropActors.length = 0;
  for (const f of winFx) f.active = false;
  for (const mesh of appleMeshes) scene.remove(mesh);
  appleMeshes.length = 0;
  for (const mesh of bombMeshes) scene.remove(mesh);
  bombMeshes.length = 0;
  hud.toasts.replaceChildren();
  hud.log.replaceChildren();
  combos.clear();
  renderLeaderboard();
  hideParticles();
  particleCursor = 0;
  hideBanner();
  hud.flash.classList.remove('on');
  layoutBoard();
  refreshHud();
  camDist = fitDistance();
  camTarget.set(state.w / 2, 0, state.h / 2);
  camBase.copy(CAM_DIR).multiplyScalar(camDist).add(camTarget);
  camLook.copy(camTarget);
  // Shared geometry/materials stay alive across resets on purpose; only per-apple
  // and per-bomb groups are created and detached, so there is nothing else to dispose here.
}

// ---------- loop ----------
let last = performance.now();
let acc = 0;
let hidden = document.hidden;

document.addEventListener('visibilitychange', () => {
  hidden = document.hidden;
  if (hidden) {
    if (ac && ac.state === 'running') ac.suspend().catch(() => {});
  } else {
    last = performance.now();
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  }
});

function frame(ms) {
  requestAnimationFrame(frame);
  if (hidden) {
    last = ms;
    return;
  }
  const raw = (ms - last) / 1000;
  last = ms;
  const dt = raw > 0 ? Math.min(0.05, raw) : 0;
  clock += dt;

  if (state.rescuing) {
    const r = updateRescue(state, dt * 1000);
    if (hud.banner.classList.contains('show')) {
      hud.bannerSub.textContent = rescueText();
    }
    if (r.died) onDeath();
  }

  const win = updateWin(state, dt * 1000);
  if (win.won) {
    wonAt = clock;
    onWin();
  }
  if (state.filled && !state.won) {
    showCountdown(Math.max(1, Math.ceil(state.winMs / 1000)), 'VICTORY LAP');
  }
  if (state.won) {
    const left = Math.max(1, Math.ceil(CONFIG.restartMs / 1000 - (clock - wonAt)));
    showCountdown(left, 'NEXT ROUND', true);
    if (clock - wonAt > CONFIG.restartMs / 1000) reset();
  }

  simGiftTick(dt);
  const live = !state.dead && !state.won && !state.rescuing;

  if (live) {
    acc += dt * 1000 * debugSpeed;
    let guard = 0;
    while (acc >= state.tickMs && guard++ < 8) {
      acc -= state.tickMs;

      const info = chooseMoveDetailed(state);
      // A mechanical key click on every real turn, silent while going straight.
      if (info.dir.x !== state.dir.x || info.dir.y !== state.dir.y) click();
      state.dir = info.dir;
      // Near-miss is presentation only: a small punch and a dim flash, rate-limited
      // so a tight corridor does not strobe.
      if (info.closeCall && clock - nearMissAt > 2.5) {
        nearMissAt = clock;
        camPunch += 0.5;
        flash('#ffc14d', '22');
      }

      const res = step(state);
      if (res.moved) pushTrail();
      if (res.ate) {
        sfx.eat();
        removeAppleMesh(res.ate);
        setWorld(res.ate, tmpVec);
        tmpVec.y = 0.62;
        burst(tmpVec, BURST.eat);
      }
      if (res.bomb) {
        sfx.explode();
        removeBombMesh(res.bomb);
        setWorld(res.bomb, tmpVec);
        tmpVec.y = 0.62;
        burst(tmpVec, BURST.bomb, { count: 30, power: 1.4 });
        // The bitten-off tail blows apart where it was.
        bombDebris(res.removed || []);
        shakeMag = Math.max(shakeMag, 0.4);
        flash('#ff8a3d', '55');
        refreshHud();
      }
      if (res.moved) refreshHud();
      if (res.died) {
        if (res.rescue) onRescue();
        else onDeath();
      }
      if (state.dead || state.won || state.rescuing) {
        acc = 0;
        break;
      }
    }

    appleClock += dt * 1000 * debugSpeed;
    if (appleClock >= CONFIG.appleIntervalMs) {
      appleClock = 0;
      if (state.apples.length < CONFIG.maxApples) spawnApple(state);
    }
  } else if (state.dead) {
    const left = Math.max(1, Math.ceil(CONFIG.restartMs / 1000 - (clock - deadAt)));
    showCountdown(left, 'NEXT ROUND', true);
    if (clock - deadAt > CONFIG.restartMs / 1000) reset();
  }

  updateWinFx();
  updateDropActors(dt);
  updateSpectators(dt);
  syncSnake(dt);
  syncApples(dt);
  syncBombs(dt);
  updateCamera(dt);
  updateParticles(dt);
  renderer.render(scene, camera);
}

// ---------- input ----------
const KEYS = { 1: 'apple', 2: 'bomb', 3: 'speed', 4: 'slow', 5: 'widen', 6: 'taller' };

document.querySelectorAll('[data-gift]').forEach((btn) => {
  btn.addEventListener('click', () => {
    unlockAudio();
    sendGift(btn.dataset.gift);
  });
});

window.addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.repeat) return;
  if (KEYS[e.key]) {
    e.preventDefault();
    sendGift(KEYS[e.key]);
  } else if (e.key === 'r' || e.key === 'R') {
    reset();
  } else if (e.key === 't' || e.key === 'T') {
    applyTheme(themeIndex + 1);
  } else if (e.key === 'd' || e.key === 'D') {
    toggleDebug();
  }
});

window.addEventListener('pointerdown', unlockAudio, { once: true });

hud.winLap.addEventListener('change', () => {
  victoryLap = hud.winLap.checked;
  applyDebug();
  saveDebug();
});

hud.dbgSound.addEventListener('change', () => {
  soundOn = hud.dbgSound.checked;
  saveSound();
  if (ac) {
    if (soundOn) ac.resume().catch(() => {});
    else ac.suspend().catch(() => {});
  }
});

hud.dbgGifts.addEventListener('change', () => {
  simGifts = hud.dbgGifts.checked;
  giftClock = 0;
  saveDebug();
});

hud.dbgSpeed.addEventListener('change', () => {
  debugSpeed = Math.max(1, Number(hud.dbgSpeed.value) || 1);
  saveDebug();
});

$('#restart').addEventListener('click', () => {
  unlockAudio();
  reset();
});

if (hud.theme) {
  hud.theme.addEventListener('click', () => {
    unlockAudio();
    applyTheme(themeIndex + 1);
  });
}

function resize() {
  const s = stageSize();
  camera.aspect = s.w / s.h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(s.w, s.h);
  camDist = fitDistance();
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(stageEl);

// ---------- boot ----------
applyTheme(0);
layoutBoard();
refreshHud();
renderLeaderboard();
refreshRecord();
hud.dbgSound.checked = soundOn;
hud.winLap.checked = victoryLap;
hud.dbgGifts.checked = simGifts;
hud.dbgSpeed.value = String(debugSpeed);
applyDebug();
hideParticles();
syncSnake(0);
syncApples(0);
syncBombs(0);

camDist = fitDistance();
camTarget.set(state.w / 2, 0, state.h / 2);
camBase.copy(CAM_DIR).multiplyScalar(camDist).add(camTarget);
camLook.copy(camTarget);
camera.position.copy(camBase);
camera.lookAt(camLook);

window.__snake = { scene, camera, renderer, sendGift, reset, state: () => state };
requestAnimationFrame(frame);
