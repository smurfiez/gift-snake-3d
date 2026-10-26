// Eight-stage progression design: metadata plus the gift-charge meter.
// Pure data and arithmetic only. src/game.js owns every board effect.

export const STAGE_ORDER = ['beach', 'football', 'dungeon', 'garden', 'space', 'volcano', 'arctic', 'city'];

export const DIFFICULTY_LABELS = ['Calm', 'Brisk', 'Wild'];

const METER_GOAL = { 1: 90, 2: 100, 3: 110 };
const PASSIVE_SECONDS = { 1: 7, 2: 6, 3: 5 };
const GIFT_CHARGE = { apple: 10, bomb: 14, speed: 8, slow: 8, widen: 25, taller: 25 };

function stage(id, difficulty, tickMs, passive, event) {
  return {
    id,
    difficulty,
    tickMs,
    meterGoal: METER_GOAL[difficulty],
    passive: { id: passive[0], label: passive[1], text: passive[2], every: PASSIVE_SECONDS[difficulty] },
    event: { id: event[0], label: event[1], text: event[2] },
  };
}

export const STAGE_META = {
  beach: stage('beach', 1, 210,
    ['tide', 'Tide', 'The tide drags loose apples one cell toward the sea.'],
    ['surge', 'Tide Surge', 'A wave floods the board and sweeps every bomb one cell.']),
  football: stage('football', 1, 200,
    ['endzone', 'End Zone', 'Apples roll one cell downfield every few seconds.'],
    ['goal', 'Goal Rush', 'The end zone pays double apples for one batch.']),
  dungeon: stage('dungeon', 2, 200,
    ['torchlight', 'Torchlight', 'A torch relights and reveals the nearest hidden apple.'],
    ['vault', 'Vault Opens', 'The vault drops a ring of apples around the snake.']),
  garden: stage('garden', 1, 210,
    ['bloom', 'Bloom', 'Young apples sprout a second apple beside them.'],
    ['bloom', 'Full Bloom', 'Every apple on the board sprouts a neighbour.']),
  space: stage('space', 2, 200,
    ['gravity', 'Gravity Well', 'A well pulls apples one cell toward its centre.'],
    ['meteor', 'Meteor Shower', 'Meteors rain in and scatter the apples off their cells.']),
  volcano: stage('volcano', 3, 185,
    ['fissure', 'Fissure', 'A fissure opens and pushes the nearest bomb two cells.'],
    ['eruption', 'Eruption', 'Eruption drops three fresh bombs onto the board.']),
  arctic: stage('arctic', 2, 210,
    ['ice', 'Black Ice', 'Black ice makes loose apples slide one extra cell.'],
    ['blizzard', 'Blizzard', 'Blizzard freezes the snake short for a few seconds.']),
  city: stage('city', 3, 185,
    ['crosswalk', 'Crosswalk', 'Traffic shoves apples sideways one cell each pass.'],
    ['blackout', 'Blackout', 'Blackout kills the lights and shuffles every bomb.']),
};

const FALLBACK_ID = 'beach';

export function stageMeta(id) {
  return STAGE_META[id] || STAGE_META[FALLBACK_ID];
}

export function createStageRound(id) {
  const meta = stageMeta(id);
  return { id: meta.id, charge: 0, goal: meta.meterGoal, events: 0, passiveMs: 0 };
}

export function chargeStage(round, giftType) {
  const amount = GIFT_CHARGE[giftType] || 0;
  const before = round.charge;
  round.charge = Math.min(round.goal, before + amount);
  return { charged: round.charge > before, charge: round.charge, goal: round.goal, amount };
}

export function consumeStageEvent(round) {
  if (round.charge < round.goal) return null;
  round.charge = 0;
  round.events += 1;
  return stageMeta(round.id).event;
}

export function advancePassive(round, dtMs) {
  const everyMs = stageMeta(round.id).passive.every * 1000;
  round.passiveMs += dtMs;
  const due = round.passiveMs >= everyMs;
  if (due) round.passiveMs -= everyMs;
  return { due, everyMs, passive: stageMeta(round.id).passive };
}

export function setStageRound(round, id) {
  const meta = stageMeta(id);
  round.id = meta.id;
  round.goal = meta.meterGoal;
  round.passiveMs = 0;
  round.charge = Math.min(round.charge, round.goal);
  return round;
}
