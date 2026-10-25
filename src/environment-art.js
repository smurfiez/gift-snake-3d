import * as THREE from 'three';

// Art for the eight staged environments: apron props, tiling ground textures and
// one cheap ambient motion layer each. Geometry and materials are built once at
// module level and shared by every instance of the same prop, because the
// caller rebuilds the scenery ring on every board resize and never disposes it.
//
// The camera looks 25 degrees off straight down, so vertical height only shows
// at about 42% on screen: props lean on wide, thick, high-contrast silhouettes
// (big canopies, broad fronds, chunky frames) plus a visible vertical stem.

const TAU = Math.PI * 2;
const TILE = 512;

// Same three-stop toon ramp the rest of the scene uses.
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

// Seeded PRNG so a texture tile looks the same on every rebuild.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTile(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d') };
}

function finishTile(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- props
// Every factory returns a Group whose lowest point sits at y = 0. Sizes are
// authored here; the caller scales the whole prop by 1.25.

// ---------- beach ----------
// Dark trunk and a wide frond rosette so the palm reads as a palm from above,
// not a green star: the crown is offset sideways so the trunk stays visible.

const palmTrunkGeos = [
  new THREE.CylinderGeometry(0.18, 0.25, 0.72, 8),
  new THREE.CylinderGeometry(0.14, 0.18, 0.68, 8),
  new THREE.CylinderGeometry(0.11, 0.14, 0.6, 8),
];
const palmTrunkMat = toon(0x5c3b24);
const palmFrondGeo = new THREE.BoxGeometry(0.88, 0.09, 0.38);
const palmFrondMat = toon(0x2f7d46);
const palmFrondLightGeo = new THREE.BoxGeometry(0.8, 0.075, 0.34);
const palmFrondLightMat = toon(0x49a05a);
const palmNutGeo = new THREE.IcosahedronGeometry(0.1, 0);
const palmNutMat = toon(0x6e4a22);
const palmCoreGeo = new THREE.SphereGeometry(0.3, 8, 6);
const palmCoreMat = toon(0x1f5730);

const PALM_SEGMENTS = [
  { y: 0.39, x: 0, rz: 0.1 },
  { y: 1.0, x: 0.13, rz: 0.2 },
  { y: 1.56, x: 0.33, rz: 0.3 },
];

function makePalm() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Mesh(palmTrunkGeos[i], palmTrunkMat);
    seg.position.set(PALM_SEGMENTS[i].x, PALM_SEGMENTS[i].y, 0);
    seg.rotation.z = -PALM_SEGMENTS[i].rz;
    g.add(seg);
  }
  const crown = new THREE.Group();
  crown.position.set(0.46, 1.92, 0);
  g.add(crown);
  const core = new THREE.Mesh(palmCoreGeo, palmCoreMat);
  core.scale.set(1, 0.7, 1);
  crown.add(core);
  for (let i = 0; i < 7; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i * TAU) / 7;
    const frond = new THREE.Mesh(i % 2 ? palmFrondGeo : palmFrondLightGeo, i % 2 ? palmFrondMat : palmFrondLightMat);
    frond.position.x = 0.4;
    frond.rotation.z = i % 3 === 0 ? -0.3 : -0.55;
    pivot.add(frond);
    crown.add(pivot);
  }
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(palmNutGeo, palmNutMat);
    nut.position.set(Math.cos((i * TAU) / 3) * 0.13, -0.04, Math.sin((i * TAU) / 3) * 0.13);
    crown.add(nut);
  }
  return g;
}

const parasolPoleGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.5, 6);
const parasolPoleMat = toon(0x6b563c);
const parasolWedgeGeos = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
  (i) => new THREE.ConeGeometry(0.8, 0.46, 2, 1, true, (i * TAU) / 10, TAU / 10)
);
const parasolWedgeMats = [toon(0xef4b3f), toon(0xfff2e0)];
const parasolRimGeo = new THREE.TorusGeometry(0.77, 0.05, 5, 14);
const parasolRimMat = toon(0xc3352c);
const parasolTopGeo = new THREE.SphereGeometry(0.1, 6, 5);
const parasolTopMat = toon(0xfff2e0);
const parasolBaseGeo = new THREE.CylinderGeometry(0.19, 0.22, 0.1, 10);
const parasolBaseMat = toon(0xa88f6a);

function makeParasol() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(parasolPoleGeo, parasolPoleMat);
  pole.position.y = 0.8;
  g.add(pole);
  const base = new THREE.Mesh(parasolBaseGeo, parasolBaseMat);
  base.position.y = 0.05;
  g.add(base);
  for (let i = 0; i < 10; i++) {
    const wedge = new THREE.Mesh(parasolWedgeGeos[i], parasolWedgeMats[i % 2]);
    wedge.position.y = 1.48;
    g.add(wedge);
  }
  const rim = new THREE.Mesh(parasolRimGeo, parasolRimMat);
  rim.position.y = 1.27;
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const top = new THREE.Mesh(parasolTopGeo, parasolTopMat);
  top.position.y = 1.73;
  g.add(top);
  return g;
}

const castleLowerGeo = new THREE.CylinderGeometry(0.46, 0.52, 0.46, 9);
const castleUpperGeo = new THREE.CylinderGeometry(0.3, 0.36, 0.4, 9);
const castleMat = toon(0xb98f55);
const castleMerlonGeo = new THREE.BoxGeometry(0.17, 0.16, 0.17);
const castleMerlonMat = toon(0xffedc9);
const castlePoleGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.46, 5);
const castleFlagGeo = new THREE.BoxGeometry(0.36, 0.2, 0.025);
const castleFlagMat = toon(0xff3b21);

function makeSandcastle() {
  const g = new THREE.Group();
  const lower = new THREE.Mesh(castleLowerGeo, castleMat);
  lower.position.y = 0.23;
  g.add(lower);
  const upper = new THREE.Mesh(castleUpperGeo, castleMat);
  upper.position.y = 0.64;
  g.add(upper);
  for (let i = 0; i < 6; i++) {
    const merlon = new THREE.Mesh(castleMerlonGeo, castleMerlonMat);
    const a = (i * TAU) / 6;
    merlon.position.set(Math.cos(a) * 0.33, 0.9, Math.sin(a) * 0.33);
    merlon.rotation.y = -a;
    g.add(merlon);
  }
  const pole = new THREE.Mesh(castlePoleGeo, castleMerlonMat);
  pole.position.y = 1.14;
  g.add(pole);
  const flag = new THREE.Mesh(castleFlagGeo, castleFlagMat);
  flag.position.set(0.19, 1.32, 0);
  g.add(flag);
  return g;
}

// Deep rose shell: the beach sand and castle are both pale, so this is the one
// saturated prop on that apron.
const shellBodyGeo = new THREE.SphereGeometry(0.58, 9, 6);
const shellBodyMat = toon(0xc9776a);
const shellRidgeGeo = new THREE.BoxGeometry(0.42, 0.05, 0.13);
const shellRidgeMat = toon(0xffe3d6);

function makeShell() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(shellBodyGeo, shellBodyMat);
  body.position.y = 0.17;
  body.scale.set(1, 0.32, 0.88);
  g.add(body);
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + i * 0.45;
    const ridge = new THREE.Mesh(shellRidgeGeo, shellRidgeMat);
    ridge.position.set(Math.sin(a) * 0.24, 0.26, Math.cos(a) * 0.24 - 0.16);
    ridge.rotation.y = a;
    ridge.scale.z = 1 - Math.abs(a) * 0.18;
    g.add(ridge);
  }
  return g;
}

// ---------- football ----------
// Small, deep goal box: thick white frame with a dark slate net so it reads as
// a goal from above instead of a pale slab, plus a dark bench with pale plank
// tops. Both stay narrow so they tuck into the apron ring.

const goalPostGeo = new THREE.CylinderGeometry(0.075, 0.075, 1.8, 8);
const goalPostMat = toon(0xf8fbff);
const goalRailGeo = new THREE.BoxGeometry(1.55, 0.06, 0.06);
const goalBackPostGeo = new THREE.BoxGeometry(0.06, 1.05, 0.06);
const goalSideRailGeo = new THREE.BoxGeometry(0.06, 0.06, 0.9);
const goalNetGeo = new THREE.BoxGeometry(1.49, 1.0, 0.03);
const goalNetMat = toon(0x33513f, { transparent: true, opacity: 0.85, side: THREE.DoubleSide });
const goalNetRoofGeo = new THREE.BoxGeometry(1.49, 0.03, 0.42);

function makeGoalpost() {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(goalPostGeo, goalPostMat);
    post.position.set(sx * 0.775, 0.9, 0);
    g.add(post);
  }
  const bar = new THREE.Mesh(goalPostGeo, goalPostMat);
  bar.position.y = 1.8;
  bar.rotation.z = Math.PI / 2;
  bar.scale.y = 0.86;
  g.add(bar);
  // Back frame: four rails frame the net panel so the box reads as a goal.
  for (const sx of [-1, 1]) {
    const backPost = new THREE.Mesh(goalBackPostGeo, goalPostMat);
    backPost.position.set(sx * 0.775, 0.55, -0.9);
    g.add(backPost);
  }
  for (const y of [0.05, 1.08]) {
    const rail = new THREE.Mesh(goalRailGeo, goalPostMat);
    rail.position.set(0, y, -0.9);
    g.add(rail);
  }
  const rearRail = new THREE.Mesh(goalRailGeo, goalPostMat);
  rearRail.position.set(0, 1.77, -0.9);
  g.add(rearRail);
  for (const sx of [-1, 1]) {
    const sideRail = new THREE.Mesh(goalSideRailGeo, goalPostMat);
    sideRail.position.set(sx * 0.775, 1.77, -0.45);
    g.add(sideRail);
  }
  const back = new THREE.Mesh(goalNetGeo, goalNetMat);
  back.position.set(0, 0.57, -0.88);
  g.add(back);
  const roof = new THREE.Mesh(goalNetRoofGeo, goalNetMat);
  roof.position.set(0, 1.74, -0.21);
  g.add(roof);
  return g;
}

const coneBodyGeo = new THREE.ConeGeometry(0.32, 0.62, 10);
const coneBodyMat = toon(0xff4a12);
const coneBandGeo = new THREE.CylinderGeometry(0.19, 0.24, 0.13, 10);
const coneBandMat = toon(0xfff6ea);
const coneBaseGeo = new THREE.BoxGeometry(0.72, 0.06, 0.72);
const coneBaseMat = toon(0xd63c0c);

function makeCone() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(coneBaseGeo, coneBaseMat);
  base.position.y = 0.03;
  g.add(base);
  const body = new THREE.Mesh(coneBodyGeo, coneBodyMat);
  body.position.y = 0.4;
  g.add(body);
  const band = new THREE.Mesh(coneBandGeo, coneBandMat);
  band.position.y = 0.36;
  g.add(band);
  return g;
}

const ballGeo = new THREE.IcosahedronGeometry(0.3, 1);
const ballMat = toon(0xffffff);
const patchGeo = new THREE.CircleGeometry(0.11, 5);
const patchMat = flat(0x24282e, { side: THREE.DoubleSide });
const BALL_PATCHES = [
  [0, 1, 0.15],
  [0.68, -0.4, 0.6],
  [-0.55, -0.45, -0.7],
];

function makeBall() {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(ballGeo, ballMat);
  ball.position.y = 0.3;
  g.add(ball);
  for (const [x, y, z] of BALL_PATCHES) {
    const patch = new THREE.Mesh(patchGeo, patchMat);
    patch.position.set(x, y, z).normalize().multiplyScalar(0.294);
    patch.position.y += 0.3;
    patch.lookAt(0, 0.3, 0);
    g.add(patch);
  }
  return g;
}

const benchSeatGeo = new THREE.BoxGeometry(0.9, 0.1, 0.4);
const benchPlankGeo = new THREE.BoxGeometry(0.4, 0.045, 0.34);
const benchPlankMat = toon(0xeaf0c6);
const benchBackGeo = new THREE.BoxGeometry(0.9, 0.1, 0.05);
const benchLegGeo = new THREE.BoxGeometry(0.08, 0.5, 0.08);
const benchFrameMat = toon(0x123a24);

function makeBench() {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(benchSeatGeo, benchFrameMat);
  seat.position.y = 0.5;
  g.add(seat);
  for (const sx of [-1, 1]) {
    const plank = new THREE.Mesh(benchPlankGeo, benchPlankMat);
    plank.position.set(sx * 0.22, 0.57, 0);
    g.add(plank);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(benchLegGeo, benchFrameMat);
      leg.position.set(sx * 0.38, 0.25, sz * 0.14);
      g.add(leg);
    }
  }
  for (const sx of [-1, 1]) {
    const upright = new THREE.Mesh(benchLegGeo, benchFrameMat);
    upright.position.set(sx * 0.38, 0.72, -0.17);
    upright.scale.y = 0.85;
    g.add(upright);
  }
  const backTop = new THREE.Mesh(benchBackGeo, benchPlankMat);
  backTop.position.set(0, 0.88, -0.17);
  g.add(backTop);
  const backRail = new THREE.Mesh(benchBackGeo, benchFrameMat);
  backRail.position.set(0, 0.77, -0.17);
  g.add(backRail);
  return g;
}

// ---------- dungeon ----------
// Dungeon lighting is deliberately low, so stone props sit two shades lighter
// than the board and every torch carries its own ember halo and point light.

const torchPostGeo = new THREE.CylinderGeometry(0.075, 0.1, 1.15, 7);
const torchPostMat = toon(0x7b7089);
const torchFootGeo = new THREE.CylinderGeometry(0.19, 0.23, 0.12, 8);
const torchFootMat = toon(0x6a6078);
const torchCupGeo = new THREE.CylinderGeometry(0.16, 0.1, 0.16, 8);
const torchCupMat = toon(0x3e3849);
const torchEmberGeo = new THREE.ConeGeometry(0.11, 0.4, 6);
const torchEmberMat = flat(0xffb15c, { toneMapped: false });
const torchHaloGeo = new THREE.SphereGeometry(0.3, 8, 6);
const torchHaloMat = flat(0xff8a3d, { transparent: true, opacity: 0.22, depthWrite: false });

function makeTorch() {
  const g = new THREE.Group();
  const foot = new THREE.Mesh(torchFootGeo, torchFootMat);
  foot.position.y = 0.06;
  g.add(foot);
  const post = new THREE.Mesh(torchPostGeo, torchPostMat);
  post.position.y = 0.64;
  g.add(post);
  const cup = new THREE.Mesh(torchCupGeo, torchCupMat);
  cup.position.y = 1.29;
  g.add(cup);
  const ember = new THREE.Mesh(torchEmberGeo, torchEmberMat);
  ember.position.y = 1.42;
  g.add(ember);
  const halo = new THREE.Mesh(torchHaloGeo, torchHaloMat);
  halo.position.y = 1.36;
  g.add(halo);
  const light = new THREE.PointLight(0xff9a4d, 24, 8, 2);
  light.position.y = 1.32;
  g.add(light);
  return g;
}

const boneShaftGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.74, 5);
const boneEndGeo = new THREE.SphereGeometry(0.085, 6, 5);
const boneMat = toon(0xf6f0dd);
const boneMoundGeo = new THREE.SphereGeometry(0.33, 8, 5);
const boneMoundMat = toon(0x7d7389);

function makeBones() {
  const g = new THREE.Group();
  const mound = new THREE.Mesh(boneMoundGeo, boneMoundMat);
  mound.position.y = 0.13;
  mound.scale.set(1.2, 0.38, 1);
  g.add(mound);
  for (const side of [-1, 1]) {
    const bone = new THREE.Group();
    bone.position.y = 0.22;
    bone.rotation.y = side * 0.65;
    const shaft = new THREE.Mesh(boneShaftGeo, boneMat);
    shaft.rotation.z = Math.PI / 2;
    bone.add(shaft);
    for (const sx of [-1, 1]) {
      const end = new THREE.Mesh(boneEndGeo, boneMat);
      end.position.x = sx * 0.36;
      bone.add(end);
    }
    g.add(bone);
  }
  return g;
}

const barrelBodyGeo = new THREE.CylinderGeometry(0.33, 0.29, 0.72, 10);
const barrelBodyMat = toon(0xb98a52);
const barrelHoopGeo = new THREE.TorusGeometry(0.335, 0.05, 5, 10);
const barrelHoopMat = toon(0x241f2c);
const barrelLidGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.06, 10);
const barrelLidMat = toon(0xd0a468);

function makeBarrel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(barrelBodyGeo, barrelBodyMat);
  body.position.y = 0.36;
  g.add(body);
  for (let i = 0; i < 2; i++) {
    const hoop = new THREE.Mesh(barrelHoopGeo, barrelHoopMat);
    hoop.position.y = 0.16 + i * 0.4;
    hoop.rotation.x = Math.PI / 2;
    g.add(hoop);
  }
  const lid = new THREE.Mesh(barrelLidGeo, barrelLidMat);
  lid.position.y = 0.74;
  g.add(lid);
  return g;
}

const stalagmiteGeos = [
  new THREE.ConeGeometry(0.34, 0.66, 7),
  new THREE.ConeGeometry(0.26, 0.56, 7),
  new THREE.ConeGeometry(0.17, 0.46, 7),
];
const stalagmiteMats = [toon(0x9a8fb2), toon(0xaba1c2), toon(0xbdb4cf)];

function makeStalagmite() {
  const g = new THREE.Group();
  const heights = [0.33, 0.66, 1.02];
  for (let i = 0; i < 3; i++) {
    const spike = new THREE.Mesh(stalagmiteGeos[i], stalagmiteMats[i]);
    spike.position.y = heights[i];
    spike.rotation.set(0.04 * i, i * 0.55, -0.03 * i);
    g.add(spike);
  }
  return g;
}

// ---------- garden ----------
// Deep greens for mass, one saturated flower head. The birdbath is pale stone
// so it separates from the lawn instead of blending into it.

const bushGeo = new THREE.IcosahedronGeometry(0.42, 0);
const bushMat = toon(0x276b33);
const bushLightGeo = new THREE.IcosahedronGeometry(0.32, 0);
const bushLightMat = toon(0x35873d);

function makeBush() {
  const g = new THREE.Group();
  const lobes = [
    [0, 0.32, 0, 1],
    [-0.28, 0.24, 0.14, 0.78],
    [0.26, 0.26, -0.12, 0.7],
  ];
  for (let i = 0; i < lobes.length; i++) {
    const [x, y, z, s] = lobes[i];
    const lobe = new THREE.Mesh(i === 1 ? bushLightGeo : bushGeo, i === 1 ? bushLightMat : bushMat);
    lobe.position.set(x, y, z);
    lobe.scale.set(s, s * 0.88, s);
    g.add(lobe);
  }
  return g;
}

const flowerStemGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.52, 5);
const flowerStemMat = toon(0x357a35);
const flowerHeadGeo = new THREE.SphereGeometry(0.28, 9, 7);
const flowerHeadMat = toon(0xff2f78);
const flowerLeafGeo = new THREE.BoxGeometry(0.32, 0.035, 0.13);
const flowerLeafMat = toon(0x4c9a45);

function makeFlower() {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(flowerStemGeo, flowerStemMat);
  stem.position.y = 0.26;
  g.add(stem);
  const head = new THREE.Mesh(flowerHeadGeo, flowerHeadMat);
  head.position.y = 0.62;
  g.add(head);
  for (const side of [-1, 1]) {
    const leaf = new THREE.Mesh(flowerLeafGeo, flowerLeafMat);
    leaf.position.set(side * 0.14, 0.28, 0);
    leaf.rotation.z = side * 0.4;
    g.add(leaf);
  }
  return g;
}

const treeTrunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 1.02, 7);
const treeTrunkMat = toon(0x5a3f28);
const treeCrownGeo = new THREE.IcosahedronGeometry(0.58, 0);
const treeCrownMat = toon(0x235f2d);
const treeCrownLightGeo = new THREE.IcosahedronGeometry(0.5, 0);
const treeCrownLightMat = toon(0x3f8f46);

function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(treeTrunkGeo, treeTrunkMat);
  trunk.position.y = 0.51;
  g.add(trunk);
  const crown = [
    [0, 1.5, 0, 1],
    [-0.38, 1.28, 0.12, 0.8],
    [0.36, 1.34, -0.12, 0.72],
    [0.04, 1.74, 0.04, 0.86],
  ];
  for (let i = 0; i < crown.length; i++) {
    const [x, y, z, s] = crown[i];
    const lobe = new THREE.Mesh(i === 3 ? treeCrownLightGeo : treeCrownGeo, i === 3 ? treeCrownLightMat : treeCrownMat);
    lobe.position.set(x, y, z);
    lobe.scale.setScalar(s);
    g.add(lobe);
  }
  return g;
}

const bathBaseGeo = new THREE.CylinderGeometry(0.26, 0.3, 0.1, 10);
const bathPedestalGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.72, 8);
const bathDishGeo = new THREE.CylinderGeometry(0.34, 0.26, 0.14, 12);
const bathMat = toon(0xe4ebec);
const bathRimGeo = new THREE.TorusGeometry(0.32, 0.045, 5, 14);
const bathRimMat = toon(0xf4f9fa);
const bathWaterGeo = new THREE.CircleGeometry(0.28, 12);
const bathWaterMat = flat(0x1f7f8f);

function makeBirdbath() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(bathBaseGeo, bathMat);
  base.position.y = 0.05;
  g.add(base);
  const pedestal = new THREE.Mesh(bathPedestalGeo, bathMat);
  pedestal.position.y = 0.44;
  g.add(pedestal);
  const dish = new THREE.Mesh(bathDishGeo, bathMat);
  dish.position.y = 0.86;
  g.add(dish);
  const rim = new THREE.Mesh(bathRimGeo, bathRimMat);
  rim.position.y = 0.93;
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const water = new THREE.Mesh(bathWaterGeo, bathWaterMat);
  water.position.y = 0.945;
  water.rotation.x = -Math.PI / 2;
  g.add(water);
  return g;
}

// ---------- space ----------
// Everything that should read against the violet void is either emissive or
// pale: light rubble rims around a dark crater, glowing crystal and panels.

const craterDiscGeo = new THREE.CircleGeometry(0.44, 16);
const craterDiscMat = flat(0x171226);
const craterRockGeo = new THREE.DodecahedronGeometry(0.24, 0);
const craterRockMat = toon(0xa89ec6);

function makeCrater() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(craterDiscGeo, craterDiscMat);
  disc.position.y = 0.015;
  disc.rotation.x = -Math.PI / 2;
  g.add(disc);
  for (let i = 0; i < 6; i++) {
    const a = (i * TAU) / 6;
    const rock = new THREE.Mesh(craterRockGeo, craterRockMat);
    rock.position.set(Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5);
    rock.scale.set(0.9, 0.7, 0.9);
    rock.rotation.y = a;
    g.add(rock);
  }
  return g;
}

const spacePoleGeo = new THREE.CylinderGeometry(0.055, 0.07, 1.6, 6);
const spacePoleMat = toon(0xe8edf7);
const spaceClothGeo = new THREE.BoxGeometry(0.95, 0.62, 0.07);
const spaceClothMat = toon(0x5a74ff, { emissive: 0x27379e, emissiveIntensity: 0.7 });
const spaceStarGeo = new THREE.CircleGeometry(0.24, 5);
const spaceStarMat = flat(0xa8f4ff, { toneMapped: false, side: THREE.DoubleSide });

function makeSpaceflag() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(spacePoleGeo, spacePoleMat);
  pole.position.y = 0.8;
  g.add(pole);
  const cloth = new THREE.Mesh(spaceClothGeo, spaceClothMat);
  cloth.position.set(0.5, 1.24, 0);
  g.add(cloth);
  const star = new THREE.Mesh(spaceStarGeo, spaceStarMat);
  star.position.set(0.5, 1.24, 0.05);
  g.add(star);
  return g;
}

const crystalGeo = new THREE.OctahedronGeometry(0.4, 0);
const crystalMats = [
  toon(0xa878ff, { emissive: 0x7f3dff, emissiveIntensity: 1.2 }),
  toon(0x7cf2ff, { emissive: 0x2ac6ec, emissiveIntensity: 1.2 }),
  toon(0xdc86ff, { emissive: 0x9c3df5, emissiveIntensity: 1.2 }),
];
// y value keeps each tilted shard's lowest vertex at the ground plane.
const CRYSTALS = [
  [0, 1.06, 0, 1.0, 0.1, 0.16],
  [0.34, 0.74, 0.26, 0.7, -0.28, 0.5],
  [-0.3, 0.65, -0.2, 0.6, 0.32, -0.42],
];

function makeCrystal() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const [x, y, z, s, rx, rz] = CRYSTALS[i];
    const shard = new THREE.Mesh(crystalGeo, crystalMats[i]);
    shard.position.set(x, y, z);
    shard.scale.set(s * 1.2, s * 2.2, s * 1.2);
    shard.rotation.set(rx, i * 0.7, rz);
    g.add(shard);
  }
  return g;
}

const satBodyGeo = new THREE.BoxGeometry(0.6, 0.5, 0.6);
const satBodyMat = toon(0xd6dee9);
const satPanelGeo = new THREE.BoxGeometry(0.85, 0.08, 0.5);
const satPanelMat = toon(0x2f55c8, { emissive: 0x1d3a99, emissiveIntensity: 0.8 });
const satMastGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.5, 6);
const satDishGeo = new THREE.SphereGeometry(0.3, 10, 6, 0, TAU, 0, Math.PI / 2);
const satDishMat = toon(0xe6ecf5, { side: THREE.DoubleSide });

function makeSatellite() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(satBodyGeo, satBodyMat);
  body.position.y = 0.25;
  g.add(body);
  for (const sx of [-1, 1]) {
    const panel = new THREE.Mesh(satPanelGeo, satPanelMat);
    panel.position.set(sx * 0.73, 0.26, 0);
    g.add(panel);
  }
  const mast = new THREE.Mesh(satMastGeo, satBodyMat);
  mast.position.y = 0.75;
  g.add(mast);
  const dish = new THREE.Mesh(satDishGeo, satDishMat);
  dish.position.y = 0.98;
  dish.rotation.z = 0.4;
  g.add(dish);
  return g;
}

// ---------- lava ----------
// The lava apron is nearly black, so every prop here carries one saturated
// orange or violet accent: the pool disc, the shard glints, the ember tip.

const lavaRingGeo = new THREE.TorusGeometry(0.52, 0.16, 5, 12);
const lavaRingMat = toon(0x2a1418);
const lavaPoolGeo = new THREE.CircleGeometry(0.46, 14);
const lavaPoolMat = flat(0xff6a1f, { toneMapped: false });
const lavaBubbleGeo = new THREE.SphereGeometry(0.11, 7, 5);
const lavaBubbleMat = flat(0xffc247, { toneMapped: false });

function makeLavapool() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(lavaRingGeo, lavaRingMat);
  ring.position.y = 0.16;
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const pool = new THREE.Mesh(lavaPoolGeo, lavaPoolMat);
  pool.position.y = 0.08;
  pool.rotation.x = -Math.PI / 2;
  g.add(pool);
  for (let i = 0; i < 3; i++) {
    const a = (i * TAU) / 3 + 0.4;
    const bubble = new THREE.Mesh(lavaBubbleGeo, lavaBubbleMat);
    bubble.position.set(Math.cos(a) * 0.2, 0.1, Math.sin(a) * 0.2);
    bubble.scale.set(1, 0.7, 1);
    g.add(bubble);
  }
  return g;
}

const obsidianConeGeo = new THREE.ConeGeometry(0.2, 0.92, 5);
const obsidianConeSmallGeo = new THREE.ConeGeometry(0.15, 0.72, 5);
const obsidianShardGeo = new THREE.OctahedronGeometry(0.26, 0);
const obsidianMats = [toon(0x241a33), toon(0x342246), toon(0x1b1626)];
// y value keeps each tilted shard's lowest vertex at the ground plane.
const OBSIDIAN_SHARDS = [
  [0, 0.5, 0, 0, 0.06, 0.2],
  [0.34, 0.39, 0.2, 1, -0.22, 0.3],
  [-0.28, 0.55, -0.16, 2, 0.24, -0.28],
];

function makeObsidian() {
  const g = new THREE.Group();
  const geos = [obsidianConeGeo, obsidianConeSmallGeo, obsidianShardGeo];
  for (let i = 0; i < 3; i++) {
    const [x, y, z, geo, rx, rz] = OBSIDIAN_SHARDS[i];
    const shard = new THREE.Mesh(geos[geo], obsidianMats[i]);
    shard.position.set(x, y, z);
    if (geo === 2) shard.scale.set(0.9, 1.9, 0.9);
    shard.rotation.set(rx, i * 0.8, rz);
    g.add(shard);
  }
  return g;
}

const geyserRockGeo = new THREE.CylinderGeometry(0.36, 0.54, 0.42, 8);
const geyserRockMat = toon(0x40242a);
const geyserRimGeo = new THREE.CylinderGeometry(0.26, 0.32, 0.14, 8);
const geyserRimMat = toon(0x5b3138);
const geyserSteamGeo = new THREE.CylinderGeometry(0.15, 0.27, 1.2, 8, 1, true);
const geyserSteamMat = flat(0xe4f6ff, {
  transparent: true,
  opacity: 0.26,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const geyserTipGeo = new THREE.SphereGeometry(0.14, 7, 5);
const geyserTipMat = flat(0xffa33c, { toneMapped: false });

function makeGeyser() {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(geyserRockGeo, geyserRockMat);
  rock.position.y = 0.21;
  g.add(rock);
  const rim = new THREE.Mesh(geyserRimGeo, geyserRimMat);
  rim.position.y = 0.48;
  g.add(rim);
  const steam = new THREE.Mesh(geyserSteamGeo, geyserSteamMat);
  steam.position.y = 1.08;
  g.add(steam);
  const tip = new THREE.Mesh(geyserTipGeo, geyserTipMat);
  tip.position.y = 1.72;
  g.add(tip);
  return g;
}

const ashRockGeo = new THREE.DodecahedronGeometry(0.34, 0);
const ashRockMats = [toon(0x353039), toon(0x43404b)];
const ashCrackGeo = new THREE.BoxGeometry(0.3, 0.04, 0.05);
const ashCrackMat = flat(0xff7a24, { toneMapped: false });
// 0.45 clears the dodecahedron's real circumradius at every scale.
const ASH_ROCKS = [
  [-0.24, 0.06, 0.2, 0.7, 0.4],
  [0.26, -0.1, 0.15, 0.5, 1.1],
  [0.04, 0.26, 0.25, 0.85, 2.0],
];

function makeAshrock() {
  const g = new THREE.Group();
  for (let i = 0; i < ASH_ROCKS.length; i++) {
    const [x, z, sway, s, spin] = ASH_ROCKS[i];
    const rock = new THREE.Mesh(ashRockGeo, ashRockMats[i % 2]);
    rock.position.set(x, 0.45 * s, z);
    rock.scale.setScalar(s);
    rock.rotation.set(sway, spin, sway * 0.6);
    g.add(rock);
    const crack = new THREE.Mesh(ashCrackGeo, ashCrackMat);
    crack.position.set(x, 0.324 * s, z);
    crack.rotation.y = spin + 0.5;
    crack.scale.setScalar(0.8 + s * 0.4);
    g.add(crack);
  }
  return g;
}

// ---------- arctic ----------
// Snow and ice are pale on pale, so the igloo and snowman lean on shadowed
// undersides, while the crystals and sled carry the only warm/cool contrast.

const iglooDomeGeo = new THREE.SphereGeometry(0.64, 16, 8, 0, TAU, 0, Math.PI / 2);
const iglooSnowMat = toon(0xf3f8ff);
const iglooEntranceGeo = new THREE.BoxGeometry(0.36, 0.34, 0.32);
const iglooArchGeo = new THREE.SphereGeometry(0.19, 10, 6, 0, TAU, 0, Math.PI / 2);
const iglooDoorGeo = new THREE.CircleGeometry(0.13, 10);
const iglooDoorMat = flat(0x2a3a4a);
const iglooSeamGeo = new THREE.TorusGeometry(1, 0.012, 4, 20);
const iglooSeamMat = toon(0xd3e4f2);
// Two seam rings at the radii the dome actually has at those heights.
const IGLOO_SEAMS = [
  [0.22, 0.601],
  [0.44, 0.465],
];

function makeIgloo() {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(iglooDomeGeo, iglooSnowMat);
  g.add(dome);
  for (let i = 0; i < 2; i++) {
    const [y, r] = IGLOO_SEAMS[i];
    const seam = new THREE.Mesh(iglooSeamGeo, iglooSeamMat);
    seam.position.y = y;
    seam.scale.set(r, r, 1);
    seam.rotation.x = Math.PI / 2;
    g.add(seam);
  }
  const entrance = new THREE.Mesh(iglooEntranceGeo, iglooSnowMat);
  entrance.position.set(0, 0.17, 0.62);
  g.add(entrance);
  const arch = new THREE.Mesh(iglooArchGeo, iglooSnowMat);
  arch.position.set(0, 0.34, 0.62);
  g.add(arch);
  const door = new THREE.Mesh(iglooDoorGeo, iglooDoorMat);
  door.position.set(0, 0.16, 0.782);
  g.add(door);
  return g;
}

const iceCrystalGeo = new THREE.OctahedronGeometry(0.3, 0);
const iceCrystalMats = [
  toon(0x8ff4ff, { emissive: 0x28c8ea, emissiveIntensity: 1.0 }),
  toon(0xbdf8ff, { emissive: 0x39d8f2, emissiveIntensity: 0.9 }),
  toon(0x74e4ff, { emissive: 0x18a8cf, emissiveIntensity: 1.2 }),
];
// y keeps each tilted shard's lowest vertex at the ground plane.
const ICE_CRYSTALS = [
  [0, 0.68, 0, 1.0, 0.08, 0.14],
  [0.34, 0.52, 0.22, 0.66, -0.26, 0.42],
  [-0.3, 0.65, -0.18, 0.82, 0.3, -0.36],
];

function makeIcecrystal() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const [x, y, z, s, rx, rz] = ICE_CRYSTALS[i];
    const shard = new THREE.Mesh(iceCrystalGeo, iceCrystalMats[i]);
    shard.position.set(x, y, z);
    shard.scale.set(s * 1.1, s * 2.0, s * 1.1);
    shard.rotation.set(rx, i * 0.8, rz);
    g.add(shard);
  }
  return g;
}

const snowmanBaseGeo = new THREE.SphereGeometry(0.4, 10, 8);
const snowmanMidGeo = new THREE.SphereGeometry(0.3, 10, 8);
const snowmanHeadGeo = new THREE.SphereGeometry(0.22, 9, 7);
const snowmanMat = toon(0xf7fbff);
const snowmanCoalGeo = new THREE.SphereGeometry(0.035, 5, 4);
const snowmanCoalMat = toon(0x1c1c24);
const snowmanNoseGeo = new THREE.ConeGeometry(0.05, 0.2, 6);
const snowmanNoseMat = toon(0xff7a1f);
const snowmanArmGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.44, 4);
const snowmanArmMat = toon(0x5a3b26);

function makeSnowman() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(snowmanBaseGeo, snowmanMat);
  base.position.y = 0.4;
  g.add(base);
  const mid = new THREE.Mesh(snowmanMidGeo, snowmanMat);
  mid.position.y = 0.66;
  g.add(mid);
  const head = new THREE.Mesh(snowmanHeadGeo, snowmanMat);
  head.position.y = 0.94;
  g.add(head);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(snowmanCoalGeo, snowmanCoalMat);
    eye.position.set(sx * 0.07, 0.99, 0.19);
    g.add(eye);
    const arm = new THREE.Mesh(snowmanArmGeo, snowmanArmMat);
    arm.position.set(sx * 0.32, 0.74, 0);
    arm.rotation.z = sx * 1.1;
    g.add(arm);
  }
  const nose = new THREE.Mesh(snowmanNoseGeo, snowmanNoseMat);
  nose.position.set(0, 0.93, 0.27);
  nose.rotation.x = Math.PI / 2;
  g.add(nose);
  return g;
}

const sledRunnerGeo = new THREE.BoxGeometry(0.86, 0.06, 0.06);
const sledEndGeo = new THREE.BoxGeometry(0.2, 0.06, 0.06);
const sledRunnerMat = toon(0xc8302c);
const sledSlatGeo = new THREE.BoxGeometry(0.76, 0.05, 0.16);
const sledSlatMat = toon(0xf0e2c4);
const sledRopeGeo = new THREE.TorusGeometry(0.1, 0.018, 4, 10);
const sledRopeMat = toon(0x4a3a2a);

function makeSled() {
  const g = new THREE.Group();
  for (const sz of [-1, 1]) {
    const runner = new THREE.Mesh(sledRunnerGeo, sledRunnerMat);
    runner.position.set(0, 0.03, sz * 0.22);
    g.add(runner);
    for (const sx of [-1, 1]) {
      const tip = new THREE.Mesh(sledEndGeo, sledRunnerMat);
      tip.position.set(sx * 0.45, 0.1, sz * 0.22);
      tip.rotation.z = sx * 0.9;
      g.add(tip);
    }
  }
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(sledSlatGeo, sledSlatMat);
    slat.position.set(-0.26 + i * 0.26, 0.09, 0);
    g.add(slat);
  }
  const rope = new THREE.Mesh(sledRopeGeo, sledRopeMat);
  rope.position.set(0.48, 0.16, 0);
  g.add(rope);
  return g;
}

// ---------- city ----------
// Night city: dark hardware with a single hot lamp, neon or paper accent per
// prop, so each silhouette still reads as its own object from above.

const lampBaseGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.14, 8);
const lampPoleGeo = new THREE.CylinderGeometry(0.05, 0.07, 2.0, 7);
const lampPoleMat = toon(0x2f3444);
const lampArmGeo = new THREE.BoxGeometry(0.34, 0.06, 0.06);
const lampHeadGeo = new THREE.BoxGeometry(0.26, 0.12, 0.18);
const lampHeadMat = flat(0xd6fbff, { toneMapped: false });
const lampCapGeo = new THREE.BoxGeometry(0.3, 0.05, 0.22);
const lampCapMat = toon(0x1f2430);
const lampGlowGeo = new THREE.SphereGeometry(0.22, 8, 6);
const lampGlowMat = flat(0x9ff4ff, { transparent: true, opacity: 0.16, depthWrite: false });

function makeStreetlamp() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(lampBaseGeo, lampCapMat);
  base.position.y = 0.07;
  g.add(base);
  const pole = new THREE.Mesh(lampPoleGeo, lampPoleMat);
  pole.position.y = 1.0;
  g.add(pole);
  const arm = new THREE.Mesh(lampArmGeo, lampPoleMat);
  arm.position.set(0.15, 1.97, 0);
  g.add(arm);
  const head = new THREE.Mesh(lampHeadGeo, lampHeadMat);
  head.position.set(0.3, 1.9, 0);
  g.add(head);
  const cap = new THREE.Mesh(lampCapGeo, lampCapMat);
  cap.position.set(0.3, 1.98, 0);
  g.add(cap);
  const glow = new THREE.Mesh(lampGlowGeo, lampGlowMat);
  glow.position.set(0.3, 1.84, 0);
  g.add(glow);
  return g;
}

const hydrantBaseGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.08, 10);
const hydrantBodyGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.42, 10);
const hydrantDomeGeo = new THREE.SphereGeometry(0.16, 10, 6, 0, TAU, 0, Math.PI / 2);
const hydrantCapGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.12, 8);
const hydrantMat = toon(0xd8322c);
const hydrantDarkMat = toon(0x8f1f1c);
const hydrantBoltGeo = new THREE.SphereGeometry(0.05, 6, 5);

function makeHydrant() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(hydrantBaseGeo, hydrantDarkMat);
  base.position.y = 0.04;
  g.add(base);
  const body = new THREE.Mesh(hydrantBodyGeo, hydrantMat);
  body.position.y = 0.29;
  g.add(body);
  const dome = new THREE.Mesh(hydrantDomeGeo, hydrantMat);
  dome.position.y = 0.5;
  g.add(dome);
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(hydrantCapGeo, hydrantDarkMat);
    cap.position.set(sx * 0.2, 0.34, 0);
    cap.rotation.z = Math.PI / 2;
    g.add(cap);
  }
  const bolt = new THREE.Mesh(hydrantBoltGeo, hydrantDarkMat);
  bolt.position.y = 0.51;
  g.add(bolt);
  return g;
}

const billboardLegGeo = new THREE.BoxGeometry(0.08, 1.15, 0.08);
const billboardLegMat = toon(0x272c3a);
const billboardPanelGeo = new THREE.BoxGeometry(1.5, 0.72, 0.08);
const billboardPanelMat = toon(0x151a26);
const billboardBarGeo = new THREE.BoxGeometry(1.56, 0.06, 0.1);
const billboardSideGeo = new THREE.BoxGeometry(0.06, 0.78, 0.1);
const billboardBarMat = flat(0xff45c8, { toneMapped: false });
const billboardAdMat = flat(0x2ff0ff, { toneMapped: false });
const billboardAdWarmMat = flat(0xffd447, { toneMapped: false });
const billboardAdHotMat = flat(0xff5c7a, { toneMapped: false });
const billboardAdGeo = new THREE.BoxGeometry(0.4, 0.28, 0.02);

function makeBillboard() {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(billboardLegGeo, billboardLegMat);
    leg.position.set(sx * 0.5, 0.575, 0);
    g.add(leg);
  }
  const panel = new THREE.Mesh(billboardPanelGeo, billboardPanelMat);
  panel.position.y = 1.15;
  g.add(panel);
  for (const y of [0.79, 1.51]) {
    const bar = new THREE.Mesh(billboardBarGeo, billboardBarMat);
    bar.position.set(0, y, 0);
    g.add(bar);
  }
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(billboardSideGeo, billboardBarMat);
    side.position.set(sx * 0.75, 1.15, 0);
    g.add(side);
  }
  const ads = [billboardAdMat, billboardAdWarmMat, billboardAdHotMat];
  for (let i = 0; i < 3; i++) {
    const ad = new THREE.Mesh(billboardAdGeo, ads[i]);
    ad.position.set(-0.48 + i * 0.48, 1.15, 0.05);
    ad.scale.set(0.85 - i * 0.08, 1, 1);
    g.add(ad);
  }
  return g;
}

const newsboxBodyGeo = new THREE.BoxGeometry(0.42, 0.5, 0.32);
const newsboxBodyMat = toon(0x1f4a68);
const newsboxLidGeo = new THREE.BoxGeometry(0.46, 0.07, 0.36);
const newsboxLidMat = toon(0x2c6a8c);
const newsboxPaperGeo = new THREE.BoxGeometry(0.3, 0.26, 0.02);
const newsboxPaperMat = toon(0xeef2f6);
const newsboxSlotGeo = new THREE.BoxGeometry(0.14, 0.03, 0.02);
const newsboxSlotMat = flat(0xffd447, { toneMapped: false });
const newsboxLegGeo = new THREE.BoxGeometry(0.06, 0.08, 0.06);

function makeNewsbox() {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(newsboxLegGeo, newsboxLidMat);
      leg.position.set(sx * 0.16, 0.04, sz * 0.12);
      g.add(leg);
    }
  }
  const body = new THREE.Mesh(newsboxBodyGeo, newsboxBodyMat);
  body.position.y = 0.33;
  g.add(body);
  const lid = new THREE.Mesh(newsboxLidGeo, newsboxLidMat);
  lid.position.set(0, 0.6, 0);
  lid.rotation.x = -0.12;
  g.add(lid);
  const paper = new THREE.Mesh(newsboxPaperGeo, newsboxPaperMat);
  paper.position.set(0, 0.26, 0.17);
  g.add(paper);
  const slot = new THREE.Mesh(newsboxSlotGeo, newsboxSlotMat);
  slot.position.set(0, 0.5, 0.17);
  g.add(slot);
  return g;
}

const PROP_FACTORIES = {
  palm: makePalm,
  parasol: makeParasol,
  sandcastle: makeSandcastle,
  shell: makeShell,
  goalpost: makeGoalpost,
  cone: makeCone,
  ball: makeBall,
  bench: makeBench,
  torch: makeTorch,
  bones: makeBones,
  barrel: makeBarrel,
  stalagmite: makeStalagmite,
  bush: makeBush,
  flower: makeFlower,
  tree: makeTree,
  birdbath: makeBirdbath,
  crater: makeCrater,
  spaceflag: makeSpaceflag,
  crystal: makeCrystal,
  satellite: makeSatellite,
  lavapool: makeLavapool,
  obsidian: makeObsidian,
  geyser: makeGeyser,
  ashrock: makeAshrock,
  igloo: makeIgloo,
  icecrystal: makeIcecrystal,
  snowman: makeSnowman,
  sled: makeSled,
  streetlamp: makeStreetlamp,
  hydrant: makeHydrant,
  billboard: makeBillboard,
  newsbox: makeNewsbox,
};

export function createProp(kind) {
  const make = PROP_FACTORIES[kind];
  if (!make) throw new Error(`unknown prop: ${kind}`);
  const group = make();
  // Ground every prop at the factory boundary so no individual builder has to
  // hand-tune its lowest point. The offset goes on the children, not on
  // group.position, because placement code does position.set(x, 0, z) and would
  // wipe a y offset. Box3 stays build-time only.
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (Number.isFinite(box.min.y)) {
    for (const child of group.children) child.position.y -= box.min.y;
  }
  return group;
}

// ---------------------------------------------------------------- ground

function sandTile() {
  const { canvas, ctx } = canvasTile(TILE);
  const rand = rng(11);
  ctx.fillStyle = '#e7d3a6';
  ctx.fillRect(0, 0, TILE, TILE);
  for (let row = 0; row < 8; row++) {
    const baseY = row * 64 + 26;
    ctx.lineWidth = 3;
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? 'rgba(168,136,94,0.20)' : 'rgba(255,252,240,0.34)';
      ctx.beginPath();
      // Integer wave count keeps the ripple seamless across the tile edge.
      for (let x = 0; x <= TILE; x += 8) {
        const y = baseY + pass * 5 + Math.sin((x / TILE) * TAU * 2 + row) * 4;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  for (let i = 0; i < 700; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,250,235,0.32)' : 'rgba(150,120,82,0.22)';
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
  return finishTile(canvas);
}

function pitchTile() {
  const { canvas, ctx } = canvasTile(TILE);
  const rand = rng(23);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#2a6d3e' : '#317a48';
    ctx.fillRect(i * 64, 0, 64, TILE);
  }
  // Faint touchline paint, broken by the tile edge on purpose.
  ctx.fillStyle = 'rgba(240,250,240,0.30)';
  ctx.fillRect(0, 430, TILE, 6);
  for (let i = 0; i < 900; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(x, y, 2, 1 + rand() * 2);
  }
  return finishTile(canvas);
}

function stoneTile() {
  const { canvas, ctx } = canvasTile(TILE);
  const rand = rng(37);
  ctx.fillStyle = '#2b2632';
  ctx.fillRect(0, 0, TILE, TILE);
  const rowH = 128;
  const blockW = 128;
  for (let row = 0; row < 4; row++) {
    const offset = row % 2 ? blockW / 2 : 0;
    for (let col = -1; col < 5; col++) {
      const x = col * blockW + offset;
      const y = row * rowH;
      const shade = 0.62 + rand() * 0.22;
      ctx.fillStyle = `rgb(${Math.round(96 * shade + 40)},${Math.round(88 * shade + 34)},${Math.round(104 * shade + 40)})`;
      ctx.fillRect(x + 5, y + 5, blockW - 10, rowH - 10);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x + 5, y + 5, blockW - 10, 6);
    }
  }
  for (let i = 0; i < 260; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(x, y, 1 + rand() * 3, 1 + rand() * 3);
  }
  return finishTile(canvas);
}

function grassTile() {
  const { canvas, ctx } = canvasTile(TILE);
  const rand = rng(53);
  ctx.fillStyle = '#4f9a4a';
  ctx.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 1400; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    ctx.fillStyle = rand() < 0.45 ? 'rgba(126,196,104,0.45)' : 'rgba(54,116,54,0.4)';
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 260; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(148,214,120,0.5)' : 'rgba(48,104,50,0.42)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rand() * 4 - 2, y - 4 - rand() * 6);
    ctx.stroke();
  }
  return finishTile(canvas);
}

function starTile() {
  const { canvas, ctx } = canvasTile(TILE);
  const rand = rng(71);
  ctx.fillStyle = '#0b0a1e';
  ctx.fillRect(0, 0, TILE, TILE);
  const smudges = [
    [130, 150, 190, 'rgba(160,59,214,0.30)'],
    [370, 340, 210, 'rgba(43,127,214,0.24)'],
    [300, 90, 140, 'rgba(214,88,170,0.20)'],
  ];
  for (const [x, y, r, color] of smudges) {
    const grad = ctx.createRadialGradient(x, y, 4, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(11,10,30,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TILE, TILE);
  }
  for (let i = 0; i < 520; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const r = rand() < 0.9 ? 0.6 + rand() * 1.2 : 1.6 + rand() * 1.6;
    ctx.fillStyle = `rgba(255,255,255,${0.35 + rand() * 0.6})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  return finishTile(canvas);
}

// Basalt with molten veins. Each vein is stamped in all nine tile offsets so
// the pattern still lines up when the texture repeats across the board.
function lavaTile() {
  const { canvas, ctx } = canvasTile(TILE);
  const rand = rng(89);
  ctx.fillStyle = '#1c0f12';
  ctx.fillRect(0, 0, TILE, TILE);
  ctx.lineCap = 'round';
  for (let i = 0; i < 24; i++) {
    const pts = [];
    let x = rand() * TILE;
    let y = rand() * TILE;
    for (let p = 0; p < 7; p++) {
      pts.push([x, y]);
      x += (rand() - 0.5) * 110;
      y += (rand() - 0.5) * 110;
    }
    const hot = 0.9 + rand() * 1.8;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        ctx.beginPath();
        for (let p = 0; p < pts.length; p++) {
          const px = pts[p][0] + ox * TILE;
          const py = pts[p][1] + oy * TILE;
          if (p === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(255,132,26,0.22)';
        ctx.lineWidth = hot * 4;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,196,82,0.85)';
        ctx.lineWidth = hot;
        ctx.stroke();
      }
    }
  }
  for (let i = 0; i < 110; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const r = 2 + rand() * 7;
    const shade = 0.7 + rand() * 0.5;
    ctx.fillStyle = `rgb(${Math.round(42 * shade)},${Math.round(26 * shade)},${Math.round(30 * shade)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  for (let i = 0; i < 130; i++) {
    ctx.fillStyle = `rgba(255,${170 + Math.round(rand() * 60)},90,${0.4 + rand() * 0.5})`;
    ctx.fillRect(rand() * TILE, rand() * TILE, 1 + rand() * 2, 1 + rand() * 2);
  }
  return finishTile(canvas);
}

// Faceted ice: flat polygons in three close tones, wrapped like the lava veins.
function iceTile() {
  const { canvas, ctx } = canvasTile(TILE);
  const rand = rng(101);
  ctx.fillStyle = '#cfdfec';
  ctx.fillRect(0, 0, TILE, TILE);
  const tones = ['#d9e8f4', '#c3d6e6', '#e8f3fb'];
  for (let i = 0; i < 44; i++) {
    const cx = rand() * TILE;
    const cy = rand() * TILE;
    const r = 40 + rand() * 80;
    const sides = 3 + Math.floor(rand() * 3);
    const pts = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * TAU + rand() * 0.5;
      const rr = r * (0.55 + rand() * 0.45);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        ctx.beginPath();
        for (let p = 0; p < pts.length; p++) {
          const px = pts[p][0] + ox * TILE;
          const py = pts[p][1] + oy * TILE;
          if (p === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = tones[i % 3];
        ctx.fill();
        ctx.strokeStyle = 'rgba(122,166,196,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.6})`;
    ctx.fillRect(rand() * TILE, rand() * TILE, 1 + rand() * 2, 1 + rand() * 2);
  }
  return finishTile(canvas);
}

// Night pavement: a thin magenta/cyan grid over near-black violet, plus a few
// soft glow pools so the apron does not read as flat black between props.
function neonTile() {
  const { canvas, ctx } = canvasTile(TILE);
  const rand = rng(113);
  ctx.fillStyle = '#0b0714';
  ctx.fillRect(0, 0, TILE, TILE);
  const glows = [
    [96, 96, 'rgba(255,64,196,0.20)'],
    [336, 208, 'rgba(64,232,255,0.18)'],
    [192, 400, 'rgba(140,80,255,0.16)'],
  ];
  for (const [x, y, color] of glows) {
    const grad = ctx.createRadialGradient(x, y, 4, x, y, 120);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(11,7,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 120, y - 120, 240, 240);
  }
  ctx.lineWidth = 2;
  for (let g = 0; g <= TILE; g += 64) {
    ctx.strokeStyle = g % 128 === 0 ? 'rgba(255,64,196,0.34)' : 'rgba(64,232,255,0.28)';
    ctx.beginPath();
    ctx.moveTo(g, 0);
    ctx.lineTo(g, TILE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(TILE, g);
    ctx.stroke();
  }
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,120,220,0.9)' : 'rgba(130,246,255,0.9)';
    ctx.fillRect(rand() * TILE, rand() * TILE, 1 + rand() * 2, 1 + rand() * 2);
  }
  return finishTile(canvas);
}

const GROUND_TILES = {
  sand: sandTile,
  pitch: pitchTile,
  stone: stoneTile,
  grass: grassTile,
  star: starTile,
  lava: lavaTile,
  ice: iceTile,
  neon: neonTile,
};

export function groundTexture(kind) {
  const paint = GROUND_TILES[kind];
  if (!paint) throw new Error(`unknown ground: ${kind}`);
  return paint();
}

// ---------------------------------------------------------------- ambient

// One low-contrast scrolling stripe tile for the water plane.
function waveTile() {
  const { canvas, ctx } = canvasTile(128);
  const rand = rng(97);
  ctx.fillStyle = '#1f6f8f';
  ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 8; row++) {
    const y = row * 16 + 6;
    ctx.lineWidth = 3;
    ctx.strokeStyle = row % 2 ? 'rgba(160,232,240,0.42)' : 'rgba(22,84,110,0.42)';
    ctx.beginPath();
    for (let x = 0; x <= 128; x += 8) {
      const py = y + Math.sin((x / 128) * TAU + row) * 3;
      if (x === 0) ctx.moveTo(x, py);
      else ctx.lineTo(x, py);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = 'rgba(220,252,255,0.28)';
    ctx.fillRect(rand() * 128, rand() * 128, 1 + rand() * 3, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(8, 4);
  return tex;
}

function buildWaves({ group, w, textures }) {
  const tex = waveTile();
  textures.push(tex);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w + 16, 8), flat(0xffffff, { map: tex }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(w / 2, 0.04, -4.1);
  group.add(plane);
  // A paler sand bar between water and board so the seam reads as shoreline.
  const shore = new THREE.Mesh(new THREE.PlaneGeometry(w + 16, 0.5), flat(0xf1e2bd));
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(w / 2, 0.03, -0.35);
  group.add(shore);
  return (t) => {
    tex.offset.y = (t * 0.04) % 1;
    tex.offset.x = Math.sin(t * 0.12) * 0.03;
  };
}

function buildFlag({ group, w, h }) {
  const cloths = [];
  const phases = [];
  const poleGeo = new THREE.CylinderGeometry(0.055, 0.07, 1.5, 6);
  const poleMat = toon(0xf2f5fa);
  const clothGeo = new THREE.BoxGeometry(0.8, 0.5, 0.03);
  // Two cloth colours so the four corner flags read as a matched set, not four blobs.
  const clothMats = [
    toon(0xffcf4d, { emissive: 0x7a5300, emissiveIntensity: 0.35 }),
    toon(0xf2f5fa, { emissive: 0x3c4247, emissiveIntensity: 0.3 }),
  ];
  const offset = 0.95;
  const corners = [
    [-offset, -offset],
    [w + offset, -offset],
    [-offset, h + offset],
    [w + offset, h + offset],
  ];
  for (let i = 0; i < corners.length; i++) {
    const post = new THREE.Group();
    post.position.set(corners[i][0], 0, corners[i][1]);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 0.8;
    post.add(pole);
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.4, 0);
    const cloth = new THREE.Mesh(clothGeo, clothMats[i % 2]);
    // Anchor the cloth at the pole, not its centre, so sway rotates around it.
    cloth.position.x = 0.4;
    pivot.add(cloth);
    post.add(pivot);
    group.add(post);
    cloths.push(cloth);
    phases.push(i * 1.7);
  }
  return (t) => {
    for (let i = 0; i < cloths.length; i++) {
      cloths[i].rotation.y = Math.sin(t * 2.4 + phases[i]) * 0.42;
      cloths[i].scale.x = 0.88 + Math.sin(t * 3.7 + phases[i]) * 0.14;
    }
  };
}

function buildTorches({ group, w, h }) {
  const flames = [];
  const lights = [];
  const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.85, 7);
  const postMat = toon(0x7b7089);
  const cupGeo = new THREE.CylinderGeometry(0.17, 0.11, 0.18, 8);
  const cupMat = toon(0x3e3849);
  const flameGeo = new THREE.ConeGeometry(0.18, 0.62, 6);
  const flameMat = flat(0xffb15c, { toneMapped: false });
  const haloGeo = new THREE.SphereGeometry(0.44, 8, 6);
  const haloMat = flat(0xff8a3d, { transparent: true, opacity: 0.28, depthWrite: false });
  const spots = [
    [-1.15, h + 1.15],
    [w + 1.15, h + 1.15],
  ];
  for (const [x, z] of spots) {
    const stand = new THREE.Group();
    stand.position.set(x, 0, z);
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.y = 0.92;
    stand.add(post);
    const cup = new THREE.Mesh(cupGeo, cupMat);
    cup.position.y = 1.9;
    stand.add(cup);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = 2.2;
    stand.add(flame);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.y = 2.12;
    stand.add(halo);
    const light = new THREE.PointLight(0xff9a4d, 46, 13, 2);
    light.position.y = 2.1;
    stand.add(light);
    group.add(stand);
    flames.push(flame);
    lights.push(light);
  }
  return (t) => {
    for (let i = 0; i < flames.length; i++) {
      const flicker = 1 + Math.sin(t * 11 + i * 2.1) * 0.16 + Math.sin(t * 17.7 + i * 0.7) * 0.07;
      flames[i].scale.set(flicker, flicker * 1.12, flicker);
      lights[i].intensity = 40 + Math.sin(t * 13 + i * 1.4) * 8;
    }
  };
}

function buildFireflies({ group, w, h }) {
  const geo = new THREE.SphereGeometry(0.16, 7, 6);
  const mat = flat(0xe4ff9a, { toneMapped: false });
  const haloGeo = new THREE.SphereGeometry(0.4, 7, 6);
  const haloMat = flat(0xc8ff7a, { transparent: true, opacity: 0.16, depthWrite: false });
  const count = 10;
  const meshes = [];
  const halos = [];
  const bx = [];
  const by = [];
  const bz = [];
  const phase = [];
  const speed = [];
  for (let i = 0; i < count; i++) {
    const dot = new THREE.Mesh(geo, mat);
    // Alternating side bands and the near band: all outside the 0.7-cell ring.
    const band = 1.05 + (i % 3) * 0.3;
    let x;
    let z;
    if (i % 4 === 0) {
      x = 0.4 + (i / count) * (w - 0.8);
      z = h + band;
    } else if (i % 2 === 0) {
      x = w + band;
      z = h * 0.25 + (i / count) * h * 0.75;
    } else {
      x = -band;
      z = h * 0.25 + (i / count) * h * 0.75;
    }
    dot.position.set(x, 1.15 + (i % 3) * 0.35, z);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(dot.position);
    group.add(dot);
    group.add(halo);
    meshes.push(dot);
    halos.push(halo);
    bx.push(x);
    by.push(dot.position.y);
    bz.push(z);
    phase.push(i * 0.9);
    speed.push(0.5 + (i % 5) * 0.12);
  }
  return (t) => {
    for (let i = 0; i < meshes.length; i++) {
      const s = speed[i];
      const p = phase[i];
      const x = bx[i] + Math.sin(t * s + p) * 0.24;
      const y = by[i] + Math.sin(t * s * 1.3 + p * 1.7) * 0.16;
      const z = bz[i] + Math.cos(t * s * 0.9 + p) * 0.24;
      meshes[i].position.set(x, y, z);
      halos[i].position.set(x, y, z);
    }
  };
}

function buildPlanet({ group, w, h }) {
  const orbit = new THREE.Group();
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(1.85, 24, 16),
    toon(0xb46bff, { emissive: 0x7a2bd6, emissiveIntensity: 0.85 })
  );
  orbit.add(planet);
  const ringPivot = new THREE.Group();
  ringPivot.rotation.z = -0.42;
  ringPivot.rotation.x = 0.24;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.5, 3.4, 40),
    flat(0xe2c8ff, { transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false })
  );
  ringPivot.add(ring);
  orbit.add(ringPivot);
  // Two equatorial bands give the sphere a readable axis from above.
  const bandGeo = new THREE.TorusGeometry(1.84, 0.16, 5, 24);
  const bandMats = [flat(0x8a3fd6), flat(0xd9a8ff)];
  const bands = [-0.42, 0.34];
  for (let i = 0; i < 2; i++) {
    const band = new THREE.Mesh(bandGeo, bandMats[i]);
    band.rotation.x = Math.PI / 2;
    band.position.y = bands[i];
    planet.add(band);
  }
  // Kept low and close: the camera is near top-down, so a distant, high planet
  // falls outside the top of the frame.
  orbit.position.set(w * 0.64, 3.0, -5.2);
  group.add(orbit);
  return (t) => {
    planet.rotation.y = t * 0.07;
    ring.rotation.z = t * 0.05;
  };
}

function buildEmbers({ group, w, h }) {
  const geo = new THREE.BoxGeometry(0.13, 0.13, 0.13);
  const mat = flat(0xff8a2b, { toneMapped: false });
  const paleGeo = new THREE.SphereGeometry(0.075, 6, 5);
  const paleMat = flat(0xffc247, { toneMapped: false });
  const count = 12;
  const span = 2.6;
  const dots = [];
  const bx = [];
  const bz = [];
  const phase = [];
  for (let i = 0; i < count; i++) {
    const dot = new THREE.Mesh(i % 3 === 0 ? paleGeo : geo, i % 3 === 0 ? paleMat : mat);
    // Same side/near bands as the fireflies, so nothing lands on the board.
    const band = 0.95 + (i % 3) * 0.45;
    let x;
    let z;
    if (i % 4 === 0) {
      x = 0.4 + (i / count) * (w - 0.8);
      z = h + band;
    } else if (i % 2 === 0) {
      x = w + band;
      z = h * 0.2 + (i / count) * h * 0.8;
    } else {
      x = -band;
      z = h * 0.2 + (i / count) * h * 0.8;
    }
    dot.position.set(x, 0.2, z);
    group.add(dot);
    dots.push(dot);
    bx.push(x);
    bz.push(z);
    phase.push(i * 0.62);
  }
  return (t) => {
    for (let i = 0; i < dots.length; i++) {
      const p = phase[i];
      const speed = 0.5 + (i % 4) * 0.13;
      const y = 0.15 + ((p + t * speed) % span);
      dots[i].position.set(bx[i] + Math.sin(t * 0.9 + p) * 0.22, y, bz[i] + Math.cos(t * 0.7 + p) * 0.18);
      dots[i].scale.setScalar(0.65 + Math.abs(Math.sin(t * 2.3 + p)) * 0.7);
    }
  };
}

function buildSnow({ group, w, h }) {
  const geo = new THREE.SphereGeometry(0.07, 6, 5);
  const mat = flat(0xffffff, { toneMapped: false });
  const count = 18;
  const span = 6.5;
  const flakes = [];
  const bx = [];
  const bz = [];
  const phase = [];
  for (let i = 0; i < count; i++) {
    const flake = new THREE.Mesh(geo, mat);
    const band = 1.0 + (i % 3) * 0.5;
    let x;
    let z;
    if (i % 4 === 0) {
      x = 0.3 + (i / count) * (w - 0.6);
      z = h + band;
    } else if (i % 2 === 0) {
      x = w + band;
      z = (i / count) * h;
    } else {
      x = -band;
      z = (i / count) * h;
    }
    // Flattened spheres read as soft flakes from the top-down camera.
    flake.scale.set(0.7 + (i % 5) * 0.14, 0.3, 0.7 + (i % 5) * 0.14);
    group.add(flake);
    flakes.push(flake);
    bx.push(x);
    bz.push(z);
    phase.push(i * 0.71);
  }
  return (t) => {
    for (let i = 0; i < flakes.length; i++) {
      const p = phase[i];
      const y = span - ((p + t * (0.5 + (i % 4) * 0.16)) % span);
      flakes[i].position.set(bx[i] + Math.sin(t * 0.8 + p) * 0.32, y, bz[i]);
    }
  };
}

function buildTraffic({ group, w, h }) {
  const bodyGeo = new THREE.BoxGeometry(0.72, 0.24, 0.36);
  const cabinGeo = new THREE.BoxGeometry(0.34, 0.2, 0.3);
  const bodyMats = [toon(0x2a2f5e), toon(0x3b2050), toon(0x173a4a)];
  const cabinMat = flat(0x9ff4ff, { toneMapped: false });
  const lightGeo = new THREE.BoxGeometry(0.06, 0.1, 0.24);
  const headMat = flat(0xd8fbff, { toneMapped: false });
  const tailMat = flat(0xff3f8a, { toneMapped: false });
  const count = 7;
  const cars = [];
  const lanes = [];
  for (let i = 0; i < count; i++) {
    const car = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, bodyMats[i % 3]);
    body.position.y = 0.16;
    car.add(body);
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(-0.06, 0.33, 0);
    car.add(cabin);
    const head = new THREE.Mesh(lightGeo, headMat);
    head.position.set(0.38, 0.16, 0);
    car.add(head);
    const tail = new THREE.Mesh(lightGeo, tailMat);
    tail.position.set(-0.38, 0.16, 0);
    car.add(tail);
    group.add(car);
    cars.push(car);
    // Far band only, plus two side bands: always clear of the board cells.
    const band = 1.1 + (i % 3) * 0.5;
    const vertical = i % 3 === 0;
    const span = vertical ? h + 4 : w + 4;
    lanes.push({
      vertical,
      cross: vertical ? (i % 2 ? w + band : -band) : h + band,
      span,
      speed: 1.0 + (i % 4) * 0.32,
      offset: (i / count) * span,
    });
  }
  return (t) => {
    for (let i = 0; i < cars.length; i++) {
      const lane = lanes[i];
      const d = ((lane.offset + t * lane.speed) % lane.span) - 2;
      if (lane.vertical) {
        cars[i].position.set(lane.cross, 0, d);
        cars[i].rotation.y = -Math.PI / 2;
      } else {
        cars[i].position.set(d, 0, lane.cross);
        cars[i].rotation.y = 0;
      }
    }
  };
}

const AMBIENT_BUILDERS = {
  waves: buildWaves,
  flag: buildFlag,
  torches: buildTorches,
  fireflies: buildFireflies,
  planet: buildPlanet,
  embers: buildEmbers,
  snow: buildSnow,
  traffic: buildTraffic,
};

// Geometry and materials belong to this ambient alone, so the caller can swap
// environments without leaking anything. Materials dispose their own GPU state;
// textures are tracked separately because the wave map is ours.
function disposeGroup(group) {
  const geos = new Set();
  const mats = new Set();
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    geos.add(obj.geometry);
    mats.add(obj.material);
  });
  for (const geo of geos) geo.dispose();
  for (const mat of mats) mat.dispose();
}

export function createAmbient(kind, w, h) {
  const build = AMBIENT_BUILDERS[kind];
  if (!build) throw new Error(`unknown ambient: ${kind}`);
  const group = new THREE.Group();
  const textures = [];
  const update = build({ group, w, h, textures }) ?? (() => {});
  return {
    group,
    update,
    dispose() {
      disposeGroup(group);
      for (const tex of textures) tex.dispose();
    },
  };
}
