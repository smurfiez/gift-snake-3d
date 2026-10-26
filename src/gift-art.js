import * as THREE from 'three';

// Stage-specific gift silhouettes. Each stage gets one readable apple and one
// readable bomb, built from the same unit geometries and a per-stage material
// set created once at module load. Callers get a fresh Group every time but
// never dispose it: geometry and materials are shared for the life of the page.
//
// Items are authored around a 0.3 radius body sitting at y = 0.3 so they drop
// into the same cell space the plain apple and bomb used. The build boundary
// grounds every group to y = 0, which also swallows the outline shell's slight
// overhang.

const TAU = Math.PI * 2;
// 1.17 puts the shell about one CSS pixel thick at the game camera distance,
// which survives the toon shading without reading as a second silhouette.
const OUTLINE_SCALE = 1.17;

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

const toon = (color, extra) => new THREE.MeshToonMaterial({ color, gradientMap: toonRamp, ...extra });
const flat = (color, extra) => new THREE.MeshBasicMaterial({ color, ...extra });

// Unit geometries shared by all sixteen factories.
const GEO = {
  sphere: new THREE.SphereGeometry(1, 16, 12),
  sphereLo: new THREE.SphereGeometry(1, 10, 8),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  cone: new THREE.ConeGeometry(1, 1, 10),
  box: new THREE.BoxGeometry(1, 1, 1),
  octa: new THREE.OctahedronGeometry(1, 0),
  torus: new THREE.TorusGeometry(1, 0.09, 6, 16),
  disc: new THREE.CircleGeometry(1, 5),
  tri: new THREE.CircleGeometry(1, 3),
};

// Two shells: near-black on the pale aprons, pale on the near-black ones. One
// material each, shared for the life of the page like every other material.
const OUTLINE_MATS = {
  dark: flat(0x14101a, { side: THREE.BackSide }),
  pale: flat(0xf3ecfa, { side: THREE.BackSide }),
};
const FUSE_MAT = toon(0x7d6047);

// ---------------------------------------------------------------- palettes

// apple/bomb entries feed the HUD; bodyEm is the emissive tint. Detail is always
// a flat tone-mapped-off colour so cracks, panels and neon strips stay hot.
const APPLE_PALETTES = {
  beach: { body: 0x6b4a2e, bodyEm: 0x2a1a0c, trim: 0x3f9a4a, trimEm: 0x14581f, detail: 0x4a3220, spark: 0x9dff6a },
  football: { body: 0xf4f7f2, bodyEm: 0x2c3540, trim: 0xc8d2d8, trimEm: 0x40474f, detail: 0x23282f, spark: 0xffffff },
  dungeon: { body: 0xffc94a, bodyEm: 0x8a5a00, trim: 0xffe9a0, trimEm: 0xa07818, detail: 0x8a5f12, spark: 0xffe9a0 },
  garden: { body: 0xff8f9c, bodyEm: 0xb03246, trim: 0x4b9a44, trimEm: 0x174d16, detail: 0xc85a70, spark: 0xffd0d8 },
  space: { body: 0x7cf2ff, bodyEm: 0x1aa6c8, trim: 0xff6ad5, trimEm: 0xb02a8a, detail: 0xe8fbff, spark: 0xd8fbff },
  volcano: { body: 0x6b3a30, bodyEm: 0x2a1208, trim: 0x8a4a34, trimEm: 0x301408, detail: 0xff7a1f, spark: 0xffc247 },
  arctic: { body: 0xdff8ff, bodyEm: 0x4a9fc4, trim: 0xffffff, trimEm: 0x6ab8d8, detail: 0x9fd8ee, spark: 0xffffff },
  city: { body: 0x34405a, bodyEm: 0x141b28, trim: 0xff45c8, trimEm: 0x8a1f6a, detail: 0x2ff0ff, spark: 0x9ff6ff },
};

const BOMB_PALETTES = {
  beach: { body: 0x2f7f8c, bodyEm: 0x0d3a44, trim: 0xd0a468, trimEm: 0x4a3010, detail: 0x9ff0ff, spark: 0x9ff6ff },
  football: { body: 0x2b3038, bodyEm: 0x12151a, trim: 0xeef2ee, trimEm: 0x5a6470, detail: 0xeef2ee, spark: 0xffe9a0 },
  dungeon: { body: 0x8a5a2e, bodyEm: 0x2a1608, trim: 0x241f2c, trimEm: 0x0a0810, detail: 0x6b4520, spark: 0xffb15c },
  garden: { body: 0x4f8f3a, bodyEm: 0x1d4416, trim: 0xd8e8a8, trimEm: 0x5a7a2a, detail: 0x2f6b26, spark: 0xd8ffa0 },
  space: { body: 0x2a2438, bodyEm: 0x120f1e, trim: 0x7cf2ff, trimEm: 0x1aa6c8, detail: 0xb06aff, spark: 0xd8fbff },
  volcano: { body: 0x38222a, bodyEm: 0x1a0b0e, trim: 0x6b3a2a, trimEm: 0x2a1208, detail: 0xff6a1f, spark: 0xffc247 },
  arctic: { body: 0x1f5a7a, bodyEm: 0x0a2636, trim: 0xe8f8ff, trimEm: 0x6ab8d8, detail: 0x9fd8ee, spark: 0xffffff },
  city: { body: 0x1e2430, bodyEm: 0x0a0d14, trim: 0xff45c8, trimEm: 0x8a1f6a, detail: 0x2ff0ff, spark: 0x9ff6ff },
};

function makeMats(p, outline) {
  return {
    body: toon(p.body, { emissive: p.bodyEm, emissiveIntensity: 0.4 }),
    trim: toon(p.trim, { emissive: p.trimEm, emissiveIntensity: 0.35 }),
    detail: flat(p.detail, { toneMapped: false, side: THREE.DoubleSide }),
    spark: flat(p.spark, { toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }),
    outline,
  };
}

export const STAGE_ITEM_IDS = ['beach', 'football', 'dungeon', 'garden', 'space', 'volcano', 'arctic', 'city'];

// Stages whose apron is dark enough that a dark shell disappears into it.
const DARK_BOARDS = new Set(['football', 'dungeon', 'space', 'volcano', 'city']);

const MATS = {};
for (const id of STAGE_ITEM_IDS) {
  const outline = DARK_BOARDS.has(id) ? OUTLINE_MATS.pale : OUTLINE_MATS.dark;
  MATS[id] = { apple: makeMats(APPLE_PALETTES[id], outline), bomb: makeMats(BOMB_PALETTES[id], outline) };
}

// ---------------------------------------------------------------- builders

function part(group, geo, mat, pos, scale, rot) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  if (Array.isArray(scale)) mesh.scale.set(scale[0], scale[1], scale[2]);
  else if (scale !== undefined) mesh.scale.setScalar(scale);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  group.add(mesh);
  return mesh;
}

// Body plus its stage-appropriate shell. Only the main mass gets an outline;
// small trims would turn into mud at this scale.
function body(group, geo, m, pos, scale) {
  const shellScale = Array.isArray(scale) ? scale.map((v) => v * OUTLINE_SCALE) : scale * OUTLINE_SCALE;
  part(group, geo, m.outline, pos, shellScale);
  return part(group, geo, m.body, pos, scale);
}

// Flat detail lying on a curved surface: place on the sphere and face the centre.
function sticker(group, geo, mat, dir, radius, size, centreY) {
  const v = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const mesh = part(group, geo, mat, [v.x * radius, v.y * radius + centreY, v.z * radius], size);
  mesh.lookAt(0, centreY, 0);
  return mesh;
}

function addSpark(group, m, pos, size) {
  const spark = part(group, GEO.sphereLo, m.spark, pos, size);
  // game.js pulses the glow; it needs the authored size to scale, not an absolute.
  spark.userData.base = size;
  group.userData.spark = spark;
  return spark;
}

function addFuse(group, m, baseY, tilt) {
  part(group, GEO.cyl, FUSE_MAT, [0.06, baseY + 0.075, 0], [0.025, 0.17, 0.025], [0, 0, tilt]);
  return addSpark(group, m, [0.11, baseY + 0.165, 0], 0.08);
}

// ---------------------------------------------------------------- apples

function appleBeach(m) {
  const g = new THREE.Group();
  body(g, GEO.sphere, m, [0, 0.3, 0], [0.3, 0.28, 0.3]);
  for (let i = 0; i < 3; i++) {
    part(g, GEO.torus, m.detail, [0, 0.3, 0], 0.3, [0, (i * Math.PI) / 3, 0]);
  }
  part(g, GEO.cone, m.trim, [0.1, 0.56, 0], [0.1, 0.22, 0.045], [0, 0, -0.75]);
  part(g, GEO.cone, m.trim, [-0.09, 0.57, 0.02], [0.09, 0.2, 0.04], [0, 0, 0.7]);
  return g;
}

function appleFootball(m) {
  const g = new THREE.Group();
  body(g, GEO.sphere, m, [0, 0.3, 0], 0.3);
  const patches = [
    [0, 1, 0.25],
    [0.72, -0.3, 0.55],
    [-0.62, -0.36, -0.6],
  ];
  for (const dir of patches) sticker(g, GEO.disc, m.detail, dir, 0.294, 0.105, 0.3);
  return g;
}

function appleDungeon(m) {
  const g = new THREE.Group();
  body(g, GEO.sphere, m, [0, 0.3, 0], 0.3);
  part(g, GEO.torus, m.trim, [0, 0.3, 0], [0.3, 0.3, 0.3], [Math.PI / 2, 0, 0]);
  part(g, GEO.cyl, m.trim, [0, 0.545, 0], [0.15, 0.05, 0.15]);
  for (let i = 0; i < 5; i++) {
    const a = (i * TAU) / 5;
    part(g, GEO.cone, m.trim, [Math.cos(a) * 0.13, 0.62, Math.sin(a) * 0.13], [0.05, 0.13, 0.05]);
  }
  return g;
}

function appleGarden(m) {
  const g = new THREE.Group();
  body(g, GEO.sphere, m, [0, 0.3, 0], 0.3);
  // Vertical ring reads as the peach cleft from the game camera.
  part(g, GEO.torus, m.detail, [0, 0.3, 0], 0.3, [0, 0.35, 0]);
  part(g, GEO.box, m.trim, [0.07, 0.57, 0.05], [0.22, 0.035, 0.09], [0.2, 0.5, -0.4]);
  part(g, GEO.box, m.trim, [-0.05, 0.6, -0.02], [0.16, 0.03, 0.08], [0, -0.4, 0.3]);
  return g;
}

function appleSpace(m) {
  const g = new THREE.Group();
  body(g, GEO.octa, m, [0, 0.3, 0], 0.3);
  part(g, GEO.octa, m.trim, [0.21, 0.45, 0.11], 0.12, [0.2, 0.5, 0.1]);
  part(g, GEO.octa, m.trim, [-0.19, 0.48, -0.1], 0.1, [0, -0.4, 0.3]);
  part(g, GEO.sphereLo, m.spark, [0, 0.6, 0.05], 0.07);
  return g;
}

function appleVolcano(m) {
  const g = new THREE.Group();
  body(g, GEO.sphere, m, [0, 0.3, 0], 0.3);
  part(g, GEO.box, m.detail, [0.02, 0.42, 0.27], [0.22, 0.035, 0.03], [0.3, 0.2, 0.25]);
  part(g, GEO.box, m.detail, [-0.14, 0.26, 0.26], [0.17, 0.03, 0.03], [0, 0.6, 0.5]);
  part(g, GEO.box, m.detail, [0.15, 0.2, 0.23], [0.14, 0.03, 0.03], [0, -0.5, -0.4]);
  return g;
}

function appleArctic(m) {
  const g = new THREE.Group();
  body(g, GEO.sphere, m, [0, 0.3, 0], 0.3);
  body(g, GEO.cone, m, [0, 0.56, 0], [0.17, 0.3, 0.17]);
  part(g, GEO.sphereLo, m.trim, [0.1, 0.45, 0.24], 0.075);
  return g;
}

function appleCity(m) {
  const g = new THREE.Group();
  body(g, GEO.box, m, [0, 0.3, 0], [0.62, 0.6, 0.62]);
  part(g, GEO.box, m.body, [0, 0.585, 0], [0.5, 0.06, 0.5]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      part(g, GEO.box, m.trim, [sx * 0.29, 0.3, sz * 0.29], [0.07, 0.52, 0.07]);
    }
  }
  part(g, GEO.box, m.detail, [0, 0.617, 0], [0.34, 0.035, 0.34]);
  part(g, GEO.box, m.detail, [0, 0.38, 0.315], [0.24, 0.2, 0.02]);
  return g;
}

// ---------------------------------------------------------------- bombs

function bombBeach(m) {
  const g = new THREE.Group();
  body(g, GEO.cyl, m, [0, 0.22, 0], [0.26, 0.44, 0.26]);
  body(g, GEO.sphere, m, [0, 0.44, 0], [0.22, 0.19, 0.22]);
  part(g, GEO.cyl, m.body, [0, 0.55, 0], [0.075, 0.16, 0.075]);
  part(g, GEO.cyl, m.trim, [0, 0.645, 0], [0.075, 0.08, 0.075]);
  part(g, GEO.torus, m.detail, [0, 0.14, 0], [0.263, 0.263, 0.263], [Math.PI / 2, 0, 0]);
  addSpark(g, m, [0, 0.715, 0], 0.07);
  return g;
}

function bombFootball(m) {
  const g = new THREE.Group();
  body(g, GEO.sphere, m, [0, 0.3, 0], 0.3);
  const panels = [
    [0, 1, 0.2],
    [0.75, -0.25, 0.5],
    [-0.6, -0.4, -0.55],
    [0.15, -0.3, -0.9],
  ];
  for (const dir of panels) sticker(g, GEO.disc, m.detail, dir, 0.294, 0.1, 0.3);
  addFuse(g, m, 0.54, -0.55);
  return g;
}

function bombDungeon(m) {
  const g = new THREE.Group();
  body(g, GEO.cyl, m, [0, 0.28, 0], [0.29, 0.56, 0.29]);
  for (const y of [0.12, 0.44]) {
    part(g, GEO.torus, m.trim, [0, y, 0], [0.295, 0.295, 0.295], [Math.PI / 2, 0, 0]);
  }
  part(g, GEO.cyl, m.trim, [0, 0.58, 0], [0.27, 0.05, 0.27]);
  addFuse(g, m, 0.6, -0.5);
  return g;
}

function bombGarden(m) {
  const g = new THREE.Group();
  body(g, GEO.sphere, m, [0, 0.315, 0], [0.28, 0.315, 0.28]);
  part(g, GEO.torus, m.detail, [0, 0.315, 0], [0.285, 0.315, 0.285], [0, 0.4, 0]);
  part(g, GEO.cyl, m.trim, [0, 0.68, 0], [0.022, 0.16, 0.022]);
  part(g, GEO.box, m.trim, [0.07, 0.74, 0], [0.14, 0.03, 0.06], [0, 0, -0.5]);
  addSpark(g, m, [0, 0.79, 0], 0.06);
  return g;
}

function bombSpace(m) {
  const g = new THREE.Group();
  body(g, GEO.sphere, m, [0, 0.28, 0], 0.28);
  part(g, GEO.cone, m.trim, [-0.24, 0.28, 0], [0.15, 0.28, 0.15], [0, 0, Math.PI / 2]);
  addSpark(g, m, [0, 0.57, 0.09], 0.075);
  return g;
}

function bombVolcano(m) {
  const g = new THREE.Group();
  body(g, GEO.sphereLo, m, [0, 0.3, 0], 0.3);
  part(g, GEO.box, m.detail, [0.03, 0.44, 0.26], [0.26, 0.04, 0.03], [0.25, 0.2, 0.2]);
  part(g, GEO.box, m.detail, [-0.15, 0.25, 0.26], [0.18, 0.035, 0.03], [0, 0.7, 0.55]);
  part(g, GEO.box, m.detail, [0.17, 0.19, 0.22], [0.15, 0.035, 0.03], [0, -0.6, -0.45]);
  addSpark(g, m, [0, 0.56, 0.03], 0.09);
  return g;
}

function bombArctic(m) {
  const g = new THREE.Group();
  body(g, GEO.sphere, m, [0, 0.3, 0], 0.3);
  const facets = [
    [0.45, 0.75, 0.5],
    [-0.6, 0.35, 0.6],
    [0.1, -0.45, 0.88],
  ];
  for (const dir of facets) sticker(g, GEO.tri, m.detail, dir, 0.296, 0.13, 0.3);
  addFuse(g, m, 0.55, 0.5);
  return g;
}

function bombCity(m) {
  const g = new THREE.Group();
  body(g, GEO.cyl, m, [0, 0.3, 0], [0.28, 0.6, 0.28]);
  part(g, GEO.torus, m.trim, [0, 0.37, 0], [0.285, 0.285, 0.285], [Math.PI / 2, 0, 0]);
  part(g, GEO.cyl, m.detail, [0, 0.66, 0], [0.16, 0.09, 0.16]);
  addSpark(g, m, [0, 0.74, 0], 0.07);
  return g;
}

// ---------------------------------------------------------------- registry

const APPLE_BUILDERS = {
  beach: appleBeach,
  football: appleFootball,
  dungeon: appleDungeon,
  garden: appleGarden,
  space: appleSpace,
  volcano: appleVolcano,
  arctic: appleArctic,
  city: appleCity,
};

const BOMB_BUILDERS = {
  beach: bombBeach,
  football: bombFootball,
  dungeon: bombDungeon,
  garden: bombGarden,
  space: bombSpace,
  volcano: bombVolcano,
  arctic: bombArctic,
  city: bombCity,
};

function envIdOf(envId) {
  return Object.prototype.hasOwnProperty.call(APPLE_BUILDERS, envId) ? envId : 'beach';
}

// Ground at the factory boundary so no individual builder has to hand-tune the
// outline overhang. Offset goes on children because placement code owns
// group.position.
function ground(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (Number.isFinite(box.min.y)) {
    for (const child of group.children) child.position.y -= box.min.y;
  }
  return group;
}

export function createStageApple(envId) {
  const id = envIdOf(envId);
  return ground(APPLE_BUILDERS[id](MATS[id].apple));
}

export function createStageBomb(envId) {
  const id = envIdOf(envId);
  return ground(BOMB_BUILDERS[id](MATS[id].bomb));
}

export function stageItemColors(envId) {
  const id = envIdOf(envId);
  const a = APPLE_PALETTES[id];
  const b = BOMB_PALETTES[id];
  return { apple: a.body, appleEm: a.bodyEm, bomb: b.body, bombEm: b.bodyEm, spark: b.spark };
}
