import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE_ORDER,
  DIFFICULTY_LABELS,
  STAGE_META,
  stageMeta,
  createStageRound,
  chargeStage,
  consumeStageEvent,
  advancePassive,
  setStageRound,
} from '../src/stage-rules.js';

const TICK = { beach: 210, football: 200, dungeon: 200, garden: 210, space: 200, volcano: 185, arctic: 210, city: 185 };
const PASSIVE = {
  beach: ['tide', 'Tide'], football: ['endzone', 'End Zone'], dungeon: ['torchlight', 'Torchlight'],
  garden: ['bloom', 'Bloom'], space: ['gravity', 'Gravity Well'], volcano: ['fissure', 'Fissure'],
  arctic: ['ice', 'Black Ice'], city: ['crosswalk', 'Crosswalk'],
};
const EVENT = {
  beach: ['surge', 'Tide Surge'], football: ['goal', 'Goal Rush'], dungeon: ['vault', 'Vault Opens'],
  garden: ['bloom', 'Full Bloom'], space: ['meteor', 'Meteor Shower'], volcano: ['eruption', 'Eruption'],
  arctic: ['blizzard', 'Blizzard'], city: ['blackout', 'Blackout'],
};

test('eight stage ids in cycle order', () => {
  assert.deepEqual(STAGE_ORDER, ['beach', 'football', 'dungeon', 'garden', 'space', 'volcano', 'arctic', 'city']);
  assert.deepEqual(Object.keys(STAGE_META), STAGE_ORDER);
});

test('difficulty labels', () => {
  assert.deepEqual(DIFFICULTY_LABELS, ['Calm', 'Brisk', 'Wild']);
});

test('every stage carries complete meta', () => {
  for (const id of STAGE_ORDER) {
    const meta = STAGE_META[id];
    assert.equal(meta.id, id);
    assert.ok(meta.difficulty >= 1 && meta.difficulty <= 3, `${id} difficulty out of range`);
    assert.equal(meta.tickMs, TICK[id], `${id} tick`);
    assert.equal(meta.meterGoal, { 1: 90, 2: 100, 3: 110 }[meta.difficulty], `${id} meter goal`);
    assert.equal(meta.passive.every, { 1: 7, 2: 6, 3: 5 }[meta.difficulty], `${id} passive interval`);
    assert.deepEqual([meta.passive.id, meta.passive.label], PASSIVE[id], `${id} passive`);
    assert.deepEqual([meta.event.id, meta.event.label], EVENT[id], `${id} event`);
    assert.ok(meta.passive.text.length > 0, `${id} passive text`);
    assert.ok(meta.event.text.length > 0, `${id} event text`);
  }
});

test('difficulty per stage', () => {
  const expected = { beach: 1, football: 1, dungeon: 2, garden: 1, space: 2, volcano: 3, arctic: 2, city: 3 };
  for (const id of STAGE_ORDER) assert.equal(STAGE_META[id].difficulty, expected[id], id);
});

test('createStageRound starts empty at the stage goal', () => {
  const round = createStageRound('volcano');
  assert.deepEqual(round, { id: 'volcano', charge: 0, goal: 110, events: 0, passiveMs: 0 });
  assert.equal(createStageRound('beach').goal, 90);
});

test('chargeStage adds per gift and caps at the goal', () => {
  const round = createStageRound('beach');
  assert.deepEqual(chargeStage(round, 'apple'), { charged: true, charge: 10, goal: 90, amount: 10 });
  assert.equal(chargeStage(round, 'bomb').charge, 24);
  assert.equal(chargeStage(round, 'speed').charge, 32);
  assert.equal(chargeStage(round, 'slow').charge, 40);
  assert.equal(chargeStage(round, 'widen').charge, 65);
  assert.equal(chargeStage(round, 'taller').charge, 90);
  assert.deepEqual(chargeStage(round, 'taller'), { charged: false, charge: 90, goal: 90, amount: 25 });
});

test('unknown gift adds nothing', () => {
  const round = createStageRound('beach');
  assert.deepEqual(chargeStage(round, 'rose'), { charged: false, charge: 0, goal: 90, amount: 0 });
  assert.equal(round.charge, 0);
});

test('consumeStageEvent needs a full meter then resets and counts', () => {
  const round = createStageRound('beach');
  assert.equal(consumeStageEvent(round), null);
  round.charge = 89;
  assert.equal(consumeStageEvent(round), null);
  chargeStage(round, 'apple');
  const event = consumeStageEvent(round);
  assert.deepEqual(event, STAGE_META.beach.event);
  assert.equal(round.charge, 0);
  assert.equal(round.events, 1);
  assert.equal(consumeStageEvent(round), null);
});

test('consumeStageEvent returns the current stage event', () => {
  const round = createStageRound('city');
  round.charge = round.goal;
  assert.equal(consumeStageEvent(round).id, 'blackout');
  assert.equal(round.events, 1);
});

test('advancePassive fires once when the interval is crossed', () => {
  const round = createStageRound('beach');
  let out = advancePassive(round, 6000);
  assert.equal(out.due, false);
  assert.equal(out.everyMs, 7000);
  assert.equal(out.passive.id, 'tide');
  assert.equal(round.passiveMs, 6000);
  out = advancePassive(round, 1000);
  assert.equal(out.due, true);
  assert.equal(round.passiveMs, 0);
});

test('advancePassive fires at most once per call on a large dt', () => {
  const round = createStageRound('volcano');
  assert.equal(advancePassive(round, 12000).due, true);
  assert.equal(round.passiveMs, 7000, 'large dt consumed more than one interval');
  assert.equal(advancePassive(round, 0).due, true);
  assert.equal(round.passiveMs, 2000);
  assert.equal(advancePassive(round, 0).due, false);
});

test('setStageRound switches goal, keeps charge under the cap and resets the clock', () => {
  const round = createStageRound('beach');
  round.charge = 90;
  round.passiveMs = 4000;
  const same = setStageRound(round, 'volcano');
  assert.equal(same, round);
  assert.equal(round.id, 'volcano');
  assert.equal(round.goal, 110);
  assert.equal(round.charge, 90);
  assert.equal(round.passiveMs, 0);

  round.charge = 110;
  setStageRound(round, 'beach');
  assert.equal(round.charge, 90, 'charge exceeded the new goal');
  assert.equal(round.events, 0);
});

test('unknown stage falls back to beach', () => {
  assert.equal(stageMeta('moon'), STAGE_META.beach);
  assert.equal(createStageRound('moon').id, 'beach');
  const round = createStageRound('volcano');
  setStageRound(round, 'moon');
  assert.equal(round.id, 'beach');
  assert.equal(round.goal, 90);
});
