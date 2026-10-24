import test from 'node:test';
import assert from 'node:assert/strict';
import { APRON, apronPoint, walkStep, faceYaw, clearOf, sceneryLayout } from '../src/apron.js';

const W = 16;
const H = 17;
const KINDS = ['bush', 'rock', 'flower', 'crate'];

const insideApron = (p, w, h) => {
  const outX = Math.min(Math.abs(p.x), Math.abs(w - p.x));
  const outZ = Math.min(Math.abs(p.z), Math.abs(h - p.z));
  const outsideBoard = p.x < -0.01 || p.x > w + 0.01 || p.z < -0.01 || p.z > h + 0.01;
  // Distance to the nearest board edge, so side-band samples mid-edge still count.
  return outsideBoard && Math.min(outX, outZ) <= APRON.far + 0.001;
};

const insideBoard = (p, w, h) =>
  p.x >= -0.01 && p.x <= w + 0.01 && p.z >= -0.01 && p.z <= h + 0.01;

test('apronPoint keeps every sample in the apron ring', () => {
  for (let i = 0; i < 200; i++) {
    const p = apronPoint(W, H);
    assert.ok(insideApron(p, W, H), `sample ${i} escaped the apron: ${JSON.stringify(p)}`);
    assert.ok(!insideBoard(p, W, H), `sample ${i} landed on the board: ${JSON.stringify(p)}`);
  }
});

test('apronPoint stays off the board with rand pinned to either end', () => {
  for (const value of [0, 0.999]) {
    const p = apronPoint(W, H, () => value);
    assert.ok(!insideBoard(p, W, H), `rand ${value} landed on the board: ${JSON.stringify(p)}`);
    assert.ok(insideApron(p, W, H), `rand ${value} escaped the apron: ${JSON.stringify(p)}`);
  }
});

test('walkStep covers at most speed * dt', () => {
  const from = { x: 0, z: 0 };
  const to = { x: 10, z: 0 };
  const next = walkStep(from, to, 2, 1);
  assert.equal(Math.hypot(next.x - from.x, next.z - from.z).toFixed(6), '2.000000');
});

test('walkStep reports arrived when the target is within reach', () => {
  const from = { x: 0, z: 0 };
  const to = { x: 1, z: 0 };
  const next = walkStep(from, to, 2, 1);
  assert.equal(next.x, 1);
  assert.equal(next.z, 0);
  assert.equal(next.arrived, true);
});

test('walkStep leaves inputs untouched', () => {
  const from = { x: 0, z: 0 };
  const to = { x: 10, z: 0 };
  const fromCopy = { ...from };
  const toCopy = { ...to };
  walkStep(from, to, 2, 1);
  assert.deepEqual(from, fromCopy);
  assert.deepEqual(to, toCopy);
});

test('faceYaw points along +X and +Z', () => {
  assert.equal(faceYaw({ x: 0, z: 0 }, { x: 1, z: 0 }), Math.PI / 2);
  assert.equal(faceYaw({ x: 0, z: 0 }, { x: 0, z: 1 }), 0);
});

test('clearOf rejects points closer than spacing', () => {
  const others = [{ x: 0, z: 0 }];
  assert.equal(clearOf({ x: APRON.spacing / 2, z: 0 }, others, APRON.spacing), false);
  assert.equal(clearOf({ x: APRON.spacing * 2, z: 0 }, others, APRON.spacing), true);
});

test('sceneryLayout spreads props across the apron', () => {
  const items = sceneryLayout(W, H, Math.random, 14);
  assert.equal(items.length, 14);
  for (const item of items) {
    assert.ok(KINDS.includes(item.kind), `unknown kind: ${item.kind}`);
    assert.ok(insideApron(item, W, H), `prop escaped the apron: ${JSON.stringify(item)}`);
    assert.ok(!insideBoard(item, W, H), `prop landed on the board: ${JSON.stringify(item)}`);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const gap = Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z);
      assert.ok(gap >= APRON.spacing - 1e-9, `props ${i} and ${j} overlap at gap ${gap}`);
    }
  }
});
