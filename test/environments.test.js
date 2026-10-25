import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENT_IDS,
  GROUND_KINDS,
  AMBIENT_KINDS,
  PROP_KINDS,
  APPLE_RULES,
  BOMB_RULES,
  DROP_KINDS,
  ENVIRONMENTS,
  environmentAt,
} from '../src/environments.js';

const HEX = /^#[0-9a-f]{6}$/;
const CSS_KEYS = ['cyan', 'magenta', 'lime', 'orange', 'blue', 'violet', 'amber'];
const COLOR_KEYS = [
  'sceneTop', 'sceneBottom',
  'base', 'baseEm', 'grid', 'wall', 'wallEm', 'post', 'postEm',
  'head', 'accent', 'rim', 'keyLight', 'ambientLight',
];
const ITEM_COLORS = ['apple', 'appleEm', 'bomb', 'bombEm', 'spark'];
const STAGE_RULES = {
  beach: { appleRule: 'pair', bombRule: 'tide', drops: { apple: 'bird', bomb: 'thrower' } },
  football: { appleRule: 'pass', bombRule: 'kick', drops: { apple: 'meteor', bomb: 'meteor' } },
  dungeon: { appleRule: 'fade', bombRule: 'barrel', drops: { apple: 'parachute', bomb: 'thrower' } },
  garden: { appleRule: 'vine', bombRule: 'compost', drops: { apple: 'thrower', bomb: 'thrower' } },
  space: { appleRule: 'twin', bombRule: 'gravity', drops: { apple: 'ufo', bomb: 'meteor' } },
  volcano: { appleRule: 'drift', bombRule: 'erupt', drops: { apple: 'meteor', bomb: 'meteor' } },
  arctic: { appleRule: 'slide', bombRule: 'freeze', drops: { apple: 'parachute', bomb: 'thrower' } },
  city: { appleRule: 'blink', bombRule: 'emp', drops: { apple: 'thrower', bomb: 'thrower' } },
};

test('eight environments in contract order', () => {
  assert.equal(ENVIRONMENTS.length, 8);
  assert.deepEqual(ENVIRONMENTS.map((env) => env.id), ENVIRONMENT_IDS);
});

test('ids and names are unique', () => {
  const ids = ENVIRONMENTS.map((env) => env.id);
  assert.deepEqual(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ENVIRONMENT_IDS);
  const names = ENVIRONMENTS.map((env) => env.name);
  assert.equal(new Set(names).size, names.length);
});

test('every environment carries a complete #rrggbb palette', () => {
  for (const env of ENVIRONMENTS) {
    assert.deepEqual(Object.keys(env.css).sort(), [...CSS_KEYS].sort(), `${env.id} css keys`);
    for (const key of CSS_KEYS) {
      assert.match(env.css[key], HEX, `${env.id} css.${key} is not #rrggbb`);
    }
    for (const key of COLOR_KEYS) {
      assert.equal(typeof env[key], 'string', `${env.id}.${key} missing`);
      assert.match(env[key], HEX, `${env.id}.${key} is not #rrggbb`);
    }
  }
});

test('ground, ambient and props come from their kind lists', () => {
  for (const env of ENVIRONMENTS) {
    assert.ok(GROUND_KINDS.includes(env.ground), `${env.id} unknown ground ${env.ground}`);
    assert.ok(AMBIENT_KINDS.includes(env.ambient), `${env.id} unknown ambient ${env.ambient}`);
    assert.ok(Array.isArray(env.props), `${env.id} props not an array`);
    assert.equal(env.props.length, 4, `${env.id} needs 4 props`);
    for (const prop of env.props) {
      assert.ok(PROP_KINDS.includes(prop), `${env.id} unknown prop ${prop}`);
    }
  }
});

test('every environment carries a known apple and bomb rule', () => {
  for (const env of ENVIRONMENTS) {
    assert.ok(APPLE_RULES.includes(env.appleRule), `${env.id} unknown appleRule ${env.appleRule}`);
    assert.ok(BOMB_RULES.includes(env.bombRule), `${env.id} unknown bombRule ${env.bombRule}`);
    assert.equal(typeof env.appleLabel, 'string', `${env.id} appleLabel missing`);
    assert.equal(typeof env.bombLabel, 'string', `${env.id} bombLabel missing`);
    assert.ok(env.appleLabel.trim().length > 0, `${env.id} appleLabel empty`);
    assert.ok(env.bombLabel.trim().length > 0, `${env.id} bombLabel empty`);
  }
});

test('every environment drops a known apple and bomb kind', () => {
  for (const env of ENVIRONMENTS) {
    assert.ok(env.drops && typeof env.drops === 'object', `${env.id} drops missing`);
    assert.ok(DROP_KINDS.includes(env.drops.apple), `${env.id} unknown drop ${env.drops.apple}`);
    assert.ok(DROP_KINDS.includes(env.drops.bomb), `${env.id} unknown drop ${env.drops.bomb}`);
  }
});

test('every environment carries the item palette as #rrggbb', () => {
  for (const env of ENVIRONMENTS) {
    for (const key of ITEM_COLORS) {
      assert.equal(typeof env[key], 'string', `${env.id}.${key} missing`);
      assert.match(env[key], HEX, `${env.id}.${key} is not #rrggbb`);
    }
  }
});

test('stage map pairs each environment with its rules', () => {
  assert.deepEqual(ENVIRONMENTS.map((env) => env.id), Object.keys(STAGE_RULES));
  for (const env of ENVIRONMENTS) {
    const want = STAGE_RULES[env.id];
    assert.equal(env.appleRule, want.appleRule, `${env.id} appleRule`);
    assert.equal(env.bombRule, want.bombRule, `${env.id} bombRule`);
    assert.deepEqual(env.drops, want.drops, `${env.id} drops`);
  }
});

test('dark flag covers the night and under-stage looks', () => {
  const dark = ['football', 'dungeon', 'space', 'volcano', 'city'];
  for (const env of ENVIRONMENTS) {
    const expected = dark.includes(env.id);
    assert.equal(env.dark, expected, `${env.id} dark should be ${expected}`);
  }
});

test('fog stays in the readable 0.006-0.014 band', () => {
  for (const env of ENVIRONMENTS) {
    assert.equal(typeof env.fog, 'number', `${env.id} fog not a number`);
    assert.ok(env.fog >= 0.006 && env.fog <= 0.014, `${env.id} fog ${env.fog} out of range`);
  }
});

test('environmentAt wraps negative and large indexes', () => {
  assert.equal(environmentAt(0), ENVIRONMENTS[0]);
  assert.equal(environmentAt(7), ENVIRONMENTS[7]);
  assert.equal(environmentAt(8), ENVIRONMENTS[0]);
  assert.equal(environmentAt(-1), ENVIRONMENTS[7]);
  assert.equal(environmentAt(-7), ENVIRONMENTS[1]);
  assert.equal(environmentAt(1234), ENVIRONMENTS[1234 % 8]);
  assert.equal(environmentAt(-1234), ENVIRONMENTS[((-1234 % 8) + 8) % 8]);
});
