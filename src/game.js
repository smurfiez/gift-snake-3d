import * as THREE from 'three';
import { CONFIG, createState, step, spawnApple, applyGift, chooseMove, updateRescue } from './logic.js';

const $ = (s) => document.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const TAU = Math.PI * 2;

const MAX_SEG = CONFIG.boardW * CONFIG.boardH;
const VIEWERS = ['nova', 'kito', 'mira', 'zed', 'luna', 'pixel', 'rush', 'koda', 'yuki', 'orin', 'bex', 'tama'];

const GIFTS = {
  apple: { icon: '🍎', name: 'Apple', color: '#9dff3d', sound: 'apple' },
  bomb: { icon: '💣', name: 'Bomb', color: '#ff8a3d', sound: 'bomb' },
  speed: { icon: '⚡', name: 'Speed up', color: '#39f6ff', sound: 'speed' },
  slow: { icon: '🐌', name: 'Slow down', color: '#ffc14d', sound: 'slow' },
};

const hud = {
  len: $('#hud-len'),
  fill: $('#len-fill'),
  speed: $('#hud-speed'),
  map: $('#hud-map'),
  toasts: $('#toasts'),
  log: $('#log'),
  banner: $('#banner'),
  bannerTitle: $('#banner-title'),
  bannerSub: $('#banner-sub'),
  flash: $('#flash'),
  theme: $('#theme'),
};

// ---------- audio (synthesized, no asset files) ----------
// shortcut: synth-only SFX, swap in samples if the stream needs richer clicks.
let ac = null;
let noiseBuf = null;
let audioUnlocked = false;
let audioFailed = false;

// Browsers only allow AudioContext creation/resume inside a gesture. Callers
// unlock on pointerdown/keydown, so no context exists before the first input.
function unlockAudio() {
  audioUnlocked = true;
  if (audioFailed) return;
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  } catch {
    audioFailed = true;
    ac = null;
  }
}

function audio() {
  if (!audioUnlocked || audioFailed) return null;
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
    }
    click();
  },
  error() {
    tone(150, 0.16, 'square', 0.07);
  },
  crash() {
    tone(220, 0.5, 'sawtooth', 0.12, 0, 40);
  },
  win() {
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
scene.background = new THREE.Color(0xf7dfe9);
scene.fog = new THREE.FogExp2(0xf7dfe9, 0.008);

const CAM_FOV = 48;
const camera = new THREE.PerspectiveCamera(CAM_FOV, bootSize.w / bootSize.h, 0.1, 240);
camera.up.set(0, 0, -1);

scene.add(new THREE.AmbientLight(0xfff2df, 1.1));
const keyLight = new THREE.DirectionalLight(0xfff0e0, 1.5);
keyLight.position.set(9, 16, 7);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xffb3c9, 0.6);
rimLight.position.set(-10, 7, -9);
scene.add(rimLight);
const headLight = new THREE.PointLight(0x9be7cf, 6, 10, 2);
scene.add(headLight);

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
  snapBoard();
  paintChecker();
}

// snake: one continuous tube swept along the eased visual path
const RING_PER_CELL = 3.5;
const RING_RADIAL = 9;
const R_HEAD = 0.45;
const R_TAIL = 0.26;
const MAX_RINGS = Math.ceil((MAX_SEG - 1) * RING_PER_CELL) + 1;

const snakeMesh = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshStandardMaterial({
    roughness: 0.5,
    metalness: 0.05,
    emissive: 0x7d5573,
    emissiveIntensity: 0.2,
    vertexColors: true,
  })
);
snakeMesh.frustumCulled = false;
scene.add(snakeMesh);

const curvePts = [];
const snakeCurve = new THREE.CatmullRomCurve3(curvePts, false, 'centripetal');
const ringPos = Array.from({ length: MAX_RINGS + 4 }, () => new THREE.Vector3());
const ringTan = Array.from({ length: MAX_RINGS + 4 }, () => new THREE.Vector3());
const ringNrm = Array.from({ length: MAX_RINGS + 4 }, () => new THREE.Vector3());
const ringBin = new THREE.Vector3();
const tubeColor = new THREE.Color();
const snakeHeadColor = new THREE.Color(0xa8f0d8);
const snakeTailColor = new THREE.Color(0xffc2d6);
const TUBE_UP = new THREE.Vector3(0, 1, 0);
const tubeAlt = new THREE.Vector3();

// Two cap sections per end, sampled off a hemisphere, so caps read as domes.
const CAP_D = [0.4, 0.78];
const CAP_R = [0.916, 0.626];

function ringRadius(t) {
  return R_HEAD + (R_TAIL - R_HEAD) * Math.pow(t, 0.9);
}

// Rings first, then two pole vertices; quads between rings plus triangle-fan caps.
function rebuildTube(n) {
  curvePts.length = 0;
  for (let i = 0; i < n; i++) curvePts.push(visual[i]);

  const body = Math.min(MAX_RINGS, Math.max(4, Math.round((n - 1) * RING_PER_CELL) + 1));
  const S = RING_RADIAL;
  const bodyStart = CAP_D.length;
  const sections = body + CAP_D.length * 2;
  const lastBody = bodyStart + body - 1;
  const last = sections - 1;

  for (let i = 0; i < body; i++) snakeCurve.getPoint(i / (body - 1), ringPos[bodyStart + i]);

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
  const col = new Float32Array((tailPole + 1) * 3);
  const idx = new Uint16Array(S * 6 * sections);

  let o = 0;
  for (let i = 0; i < sections; i++) {
    const t = i / last;
    let r;
    if (i < bodyStart) r = rHead * CAP_R[bodyStart - 1 - i];
    else if (i > lastBody) r = rTail * CAP_R[i - lastBody - 1];
    else r = ringRadius((i - bodyStart) / (body - 1));
    const nrm = ringNrm[i];
    ringBin.crossVectors(ringTan[i], nrm);
    tubeColor.copy(snakeHeadColor).lerp(snakeTailColor, t);
    for (let s = 0; s < S; s++) {
      const ang = (s / S) * TAU;
      const ca = Math.cos(ang) * r;
      const sa = Math.sin(ang) * r;
      pos[o] = ringPos[i].x + nrm.x * ca + ringBin.x * sa;
      pos[o + 1] = ringPos[i].y + nrm.y * ca + ringBin.y * sa;
      pos[o + 2] = ringPos[i].z + nrm.z * ca + ringBin.z * sa;
      col[o] = tubeColor.r;
      col[o + 1] = tubeColor.g;
      col[o + 2] = tubeColor.b;
      o += 3;
    }
  }

  pos[o] = ringPos[bodyStart].x - headTan.x * rHead;
  pos[o + 1] = ringPos[bodyStart].y - headTan.y * rHead;
  pos[o + 2] = ringPos[bodyStart].z - headTan.z * rHead;
  tubeColor.copy(snakeHeadColor);
  col[o] = tubeColor.r;
  col[o + 1] = tubeColor.g;
  col[o + 2] = tubeColor.b;
  o += 3;
  pos[o] = ringPos[lastBody].x + tailTan.x * rTail;
  pos[o + 1] = ringPos[lastBody].y + tailTan.y * rTail;
  pos[o + 2] = ringPos[lastBody].z + tailTan.z * rTail;
  tubeColor.copy(snakeTailColor);
  col[o] = tubeColor.r;
  col[o + 1] = tubeColor.g;
  col[o + 2] = tubeColor.b;

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
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  snakeMesh.geometry.dispose();
  snakeMesh.geometry = geo;
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
    head: '#a8f0d8', tail: '#ffc2d6', accent: '#9be7cf', rim: '#ffb3c9',
  },
  {
    name: 'Matcha',
    css: {
      cyan: '#8fbf6a', magenta: '#f2a08a', lime: '#a8d98a', orange: '#f0b26a',
      blue: '#9fc9a0', violet: '#c3b8e8', amber: '#f5d27a',
    },
    scene: '#eef4e4', base: '#4a5a3c', baseEm: '#5a6c48', grid: '#dcefc6',
    wall: '#b8e39a', wallEm: '#8ac96a', post: '#fbf7e6', postEm: '#d9ecc0',
    head: '#fff0c9', tail: '#99c97e', accent: '#b8e39a', rim: '#a8d98a',
  },
  {
    name: 'Blueberry',
    css: {
      cyan: '#8fa8ff', magenta: '#c39cff', lime: '#a8d9c0', orange: '#ffad8a',
      blue: '#8fb4ff', violet: '#b99cff', amber: '#f5d27a',
    },
    scene: '#e8edfa', base: '#424a6b', baseEm: '#525b80', grid: '#d6e0ff',
    wall: '#b7c5ff', wallEm: '#8ea4ff', post: '#f8f4ff', postEm: '#d9defc',
    head: '#fff2a8', tail: '#a9b8ff', accent: '#b7c5ff', rim: '#c39cff',
  },
  {
    name: 'Mocha',
    css: {
      cyan: '#b98a6a', magenta: '#e8a08a', lime: '#b8c98a', orange: '#e0a878',
      blue: '#b8b0c8', violet: '#c9a7c9', amber: '#f0c888',
    },
    scene: '#f5e9dd', base: '#5a4034', baseEm: '#6b4c3d', grid: '#ffe1c2',
    wall: '#e3bd9a', wallEm: '#c99568', post: '#fff6ea', postEm: '#ecd3b8',
    head: '#ffe8cf', tail: '#d99a6a', accent: '#e3bd9a', rim: '#e8a08a',
  },
];

let themeIndex = 0;
const themeRootStyle = document.documentElement.style;

function applyTheme(index) {
  themeIndex = ((index % THEMES.length) + THEMES.length) % THEMES.length;
  const th = THEMES[themeIndex];

  for (const key of Object.keys(th.css)) themeRootStyle.setProperty(`--${key}`, th.css[key]);

  scene.background.set(th.scene);
  scene.fog.color.set(th.scene);

  baseMat.color.set(th.base);
  baseMat.emissive.set(th.baseEm);
  gridMat.color.set(th.grid);

  wallMat.color.set(th.wall);
  wallMat.emissive.set(th.wallEm);
  postMat.color.set(th.post);
  postMat.emissive.set(th.postEm);

  snakeHeadColor.set(th.head);
  snakeTailColor.set(th.tail);
  snakeMesh.material.emissive.set(th.baseEm);
  headLight.color.set(th.accent);
  rimLight.color.set(th.rim);

  paintChecker();
  bodyCells.material.color.set(th.accent);
  headCell.material.color.set(th.accent);

  if (hud.theme) hud.theme.textContent = `THEME · ${th.name.toUpperCase()}`;
}

// apples
const appleGeo = new THREE.SphereGeometry(0.3, 16, 12);
const appleMat = new THREE.MeshStandardMaterial({
  color: 0xff2d55,
  emissive: 0xff1744,
  emissiveIntensity: 1.1,
  roughness: 0.32,
});
const stemGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.18, 6);
const stemMat = new THREE.MeshStandardMaterial({ color: 0x6b3f1d, roughness: 0.9 });

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

// ---------- apple drop actors ----------
// One actor per apple batch: bird fly-by, parachute, UFO beam, meteor shower.
const dropActors = [];
const appleBatches = new Map();
const APPLE_BATCH_MS = 450;
const DROP_VARIANTS = ['bird', 'parachute', 'ufo', 'meteor'];
let lastViewer = null;
let lastVariant = '';

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

function landApple(a, delay = 0) {
  a.dropAt = clock + delay;
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
        landApple(apples[i], 0.01);
        dropA.set(apples[i].x + 0.5, 0.5, apples[i].y + 0.5);
        burst(dropA, BURST.apple, { count: 6, power: 1.1 });
      }
      if (t > 1) g.position.y = end.y + (t - 1) * 5;
      return t > 1.25;
    },
  };
}

function parachuteDrop(apples) {
  const g = new THREE.Group();
  scene.add(g);
  const items = apples.map((a, i) => {
    const m = makeParachute();
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
      for (const it of items) {
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
          landApple(it.a, 0.01);
          dropA.set(it.a.x + 0.5, 0.5, it.a.y + 0.5);
          burst(dropA, BURST.apple, { count: 8, power: 1.3 });
        } else {
          all = false;
        }
      }
      return all && elapsed > 0;
    },
  };
}

function ufoDrop(apples) {
  const g = makeUfo();
  scene.add(g);
  const n = apples.length;
  let cx = 0;
  let cz = 0;
  for (const a of apples) { cx += a.x + 0.5; cz += a.y + 0.5; }
  cx /= n;
  cz /= n;
  g.position.set(cx, 4.1, cz);
  const orbs = apples.map((a, i) => {
    const orb = new THREE.Mesh(meteorGeo, ufoDomeMat);
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
        it.orb.scale.setScalar(1 - p * 0.55);
        if (p >= 1) {
          it.landed = true;
          g.remove(it.orb);
          landApple(it.a, 0.01);
          dropA.set(it.a.x + 0.5, 0.4, it.a.y + 0.5);
          burst(dropA, BURST.apple, { count: 7, power: 1 });
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

function meteorDrop(apples) {
  const g = new THREE.Group();
  scene.add(g);
  const items = apples.map((a, i) => {
    const m = new THREE.Group();
    const rock = new THREE.Mesh(meteorGeo, meteorMat);
    m.add(rock);
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
      for (const it of items) {
        if (it.landed) continue;
        it.t += dt;
        if (it.t < 0) { all = false; continue; }
        const p = Math.min(1, it.t / 0.55);
        it.m.position.lerpVectors(it.start, it.target, p * p);
        if (p >= 1) {
          it.landed = true;
          g.remove(it.m);
          landApple(it.a, 0.01);
          dropA.set(it.a.x + 0.5, 0.4, it.a.y + 0.5);
          burst(dropA, BURST.bomb, { count: 10, power: 2.2, size: 0.9 });
          burst(dropA, BURST.apple, { count: 8, power: 2.4 });
        } else {
          all = false;
        }
      }
      return all && elapsed > 0;
    },
  };
}

function startDrop(apples, variant) {
  const act =
    variant === 'parachute' ? parachuteDrop(apples) :
    variant === 'ufo' ? ufoDrop(apples) :
    variant === 'meteor' ? meteorDrop(apples) :
    birdDrop(apples);
  dropActors.push(act);
}

function nextDropVariant() {
  let v = pick(DROP_VARIANTS);
  if (v === lastVariant) {
    const i = (DROP_VARIANTS.indexOf(v) + 1 + ((Math.random() * (DROP_VARIANTS.length - 1)) | 0)) % DROP_VARIANTS.length;
    v = DROP_VARIANTS[i];
  }
  lastVariant = v;
  return v;
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

  const apples = [];
  for (let i = 0; i < b.count; i++) {
    const a = spawnApple(state);
    if (!a) break;
    a.dropAt = Number.POSITIVE_INFINITY;
    apples.push(a);
  }
  if (!apples.length) {
    sfx.error();
    toast('🍎 No empty cells for more apples', 'bad');
    return;
  }

  startDrop(apples, nextDropVariant());
  sfx.gift('apple');
  camPunch += 0.5;
  flash('#9dff3d');
  const label = apples.length > 1 ? `${apples.length} apples` : '1 apple';
  toast(`🍎 <b>@${viewer}</b> dropped ${label}`, 'good');
  logGift('apple', viewer, apples.length);
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
let state = createState();
const visual = Array.from({ length: MAX_SEG }, () => new THREE.Vector3());
let visualCount = 0;
let headYaw = 0;
let yawReady = false;
const appleMeshes = [];
let appleClock = 0;
let deadAt = 0;
let clock = 0;
let shakeMag = 0;

const winFx = Array.from({ length: 8 }, () => ({ at: 0, x: 0, y: 0, z: 0, color: 0x9dff3d, active: false }));
const WIN_COLORS = [0x9dff3d, 0x39f6ff, 0xff3ea5, 0xffc14d];

const CAM_DIR = new THREE.Vector3(0, 1, 0);
const camBase = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const camDesired = new THREE.Vector3();
let camDist = 0;
let camPunch = 0;
let fovKick = 0;

// Top-down framing: fit the whole board inside the stage on the tight axis.
// +1.5 cells margin absorbs wall height and the transient speed FOV punch.
function fitDistance() {
  const span = Math.max(state.w, state.h) + 1.5;
  const halfFov = THREE.MathUtils.degToRad(CAM_FOV) / 2;
  const dV = (span / 2) / Math.tan(halfFov);
  const dH = (span / 2) / (Math.tan(halfFov) * Math.max(0.35, camera.aspect));
  return Math.max(dV, dH);
}

const SNAKE_Y = 0.45;
function setWorld(p, out) {
  return out.set(p.x + 0.5, SNAKE_Y, p.y + 0.5);
}

function syncSnake(dt) {
  const snake = state.snake;
  const n = Math.min(snake.length, MAX_SEG);
  // A regrown segment should pop into place, not crawl from its pre-bomb cell.
  if (n < visualCount) visualCount = n;
  const ease = 1 - Math.exp(-dt * 16);
  const yawEase = 1 - Math.exp(-dt * 15);

  let cells = 0;
  for (let i = 0; i < n; i++) {
    const cell = snake[i];
    if (!cell) continue;
    setWorld(cell, tmpVec);
    const v = visual[i];
    if (i >= visualCount) {
      v.copy(tmpVec);
      visualCount = i + 1;
    } else {
      const dx = tmpVec.x - v.x;
      const dy = tmpVec.y - v.y;
      const dz = tmpVec.z - v.z;
      // A long jump (restart, first frame) must snap; easing across the board reads as a bug.
      if (dx * dx + dy * dy + dz * dz > 9) v.copy(tmpVec);
      else v.lerp(tmpVec, ease);
    }

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
    headLight.position.set(head.x, head.y + 1.15, head.z);
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
  camera.position.set(camBase.x + sx, camBase.y + sy, camBase.z + sx * 0.6);
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
  const total = state.w * state.h;
  hud.len.textContent = `${state.snake.length} / ${total}`;
  hud.fill.style.width = `${Math.min(100, (state.snake.length / total) * 100)}%`;
  hud.speed.textContent = `${(1000 / state.tickMs).toFixed(1)} c/s`;
  hud.map.textContent = `${state.w} × ${state.h}`;
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

const GIFT_POINTS = { apple: 10, bomb: 25, speed: 15, slow: 10 };
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
    hud.log.innerHTML = '<li>No gifts yet — keys 1–4</li>';
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

function flash(color) {
  hud.flash.style.background = `radial-gradient(circle at 50% 45%, ${color}66, transparent 66%)`;
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
    toast('💣 Rescue window — bombs only', 'bad');
    return;
  }
  const gift = GIFTS[type];
  if (!gift) return;

  if (type === 'apple') {
    click();
    queueAppleGift();
    return;
  }

  const viewer = lastViewer && Math.random() < 0.68 ? lastViewer : pick(VIEWERS);
  lastViewer = viewer;
  const wasRescuing = state.rescuing;
  const ev = applyGift(state, type);

  if (type === 'bomb') {
    if (!ev.ok) {
      sfx.error();
      toast('💣 Bomb fizzled — snake at minimum length', 'bad');
      return;
    }
    sfx.gift(type);
    for (const s of ev.removed) {
      setWorld(s, tmpVec);
      tmpVec.y = 0.5;
      burst(tmpVec, BURST.bomb, { count: 8, power: 0.8 });
    }
    bombDebris(ev.removed);
    shakeMag = Math.max(shakeMag, 0.6);
    fovPunch(3);
    flash('#ff5a2d');
    if (wasRescuing) {
      acc = 0;
      hideBanner();
      flash('#9dff3d');
      toast(`💣 <b>@${viewer} freed the snake</b>`, 'good');
    } else {
      toast(`💣 <b>@${viewer} −${ev.removed.length} segments</b>`, 'bad');
    }
    logGift(type, viewer, ev.removed.length);
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
  showBanner('TAIL HIT', `bombs cut the tail · ${Math.ceil(state.rescueMs / 1000)}s`, 'bad');
}

function onDeath() {
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
  showBanner('SNAKE CRASHED', `restarting in ${Math.ceil(CONFIG.restartMs / 1000)}s · R`, 'bad');
}

function onWin() {
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
  showBanner('STREAMER WINS', 'board filled · press R', 'good');
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

function reset() {
  state = createState();
  visualCount = 0;
  yawReady = false;
  appleClock = 0;
  deadAt = 0;
  acc = 0;
  camPunch = 0;
  fovKick = 0;
  shakeMag = 0;
  lastViewer = null;
  lastVariant = '';
  for (const b of appleBatches.values()) clearTimeout(b.timer);
  appleBatches.clear();
  for (const act of dropActors) scene.remove(act.group);
  dropActors.length = 0;
  for (const f of winFx) f.active = false;
  for (const mesh of appleMeshes) scene.remove(mesh);
  appleMeshes.length = 0;
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
  // groups are created and detached, so there is nothing else to dispose here.
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
      hud.bannerSub.textContent = `bombs cut the tail · ${Math.ceil(state.rescueMs / 1000)}s`;
    }
    if (r.died) onDeath();
  }

  const live = !state.dead && !state.won && !state.rescuing;

  if (live) {
    acc += dt * 1000;
    let guard = 0;
    while (acc >= state.tickMs && guard++ < 8) {
      acc -= state.tickMs;

      state.dir = chooseMove(state);

      const res = step(state);
      if (res.ate) {
        removeAppleMesh(res.ate);
        setWorld(res.ate, tmpVec);
        tmpVec.y = 0.62;
        burst(tmpVec, BURST.eat);
      }
      if (res.moved) refreshHud();
      if (res.died) {
        if (res.rescue) onRescue();
        else onDeath();
      }
      if (res.won) onWin();
      if (state.dead || state.won || state.rescuing) {
        acc = 0;
        break;
      }
    }

    appleClock += dt * 1000;
    if (appleClock >= CONFIG.appleIntervalMs) {
      appleClock = 0;
      if (state.apples.length < CONFIG.maxApples) spawnApple(state);
    }
  } else if (state.dead) {
    const left = Math.max(0, Math.ceil(CONFIG.restartMs / 1000 - (clock - deadAt)));
    if (hud.banner.classList.contains('show')) {
      hud.bannerSub.textContent = `restarting in ${left}s · R`;
    }
    if (clock - deadAt > CONFIG.restartMs / 1000) reset();
  }

  updateWinFx();
  updateDropActors(dt);
  syncSnake(dt);
  syncApples(dt);
  updateCamera(dt);
  updateParticles(dt);
  renderer.render(scene, camera);
}

// ---------- input ----------
const KEYS = { 1: 'apple', 2: 'bomb', 3: 'speed', 4: 'slow' };

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
  }
});

window.addEventListener('pointerdown', unlockAudio, { once: true });

$('#restart').addEventListener('click', () => {
  unlockAudio();
  click();
  reset();
});

if (hud.theme) {
  hud.theme.addEventListener('click', () => {
    unlockAudio();
    click();
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
hideParticles();
syncSnake(0);
syncApples(0);

camDist = fitDistance();
camTarget.set(state.w / 2, 0, state.h / 2);
camBase.copy(CAM_DIR).multiplyScalar(camDist).add(camTarget);
camLook.copy(camTarget);
camera.position.copy(camBase);
camera.lookAt(camLook);

window.__snake = { scene, camera, renderer, sendGift, reset, state: () => state };
requestAnimationFrame(frame);
