// Seeded simulation of normal play (no gifts): the AI drives itself until it
// wins or dies. Run with `node scripts/sim.mjs [rounds]`.
import { CONFIG, createState, step, chooseMoveDetailed, spawnApple, updateWin } from '../src/logic.js';

export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function playRound(seed, maxTicks = 20000) {
  const rand = seeded(seed);
  const state = createState(rand);
  const appleTicks = Math.round(CONFIG.appleIntervalMs / CONFIG.tickMs);
  let ticks = 0;
  let clock = 0;
  let firstAppleTick = null;
  let selfDeaths = 0;
  let gateViolations = 0;
  let closeCalls = 0;
  let drama = 0;
  let slips = 0;
  const kinds = {};

  while (!state.won && !state.dead && !state.rescuing && ticks < maxTicks) {
    const info = chooseMoveDetailed(state, rand);
    if (info.closeCall) closeCalls++;
    if (info.kind === 'drama') drama++;
    if (info.kind === 'slip') slips++;
    kinds[info.kind] = (kinds[info.kind] || 0) + 1;
    // A slip deliberately drops the gate and a finish line is already proven
    // winning; every other kind must pass it.
    if (!info.gate && !['slip', 'finish', 'stuck'].includes(info.kind)) gateViolations++;
    state.dir = info.dir;
    const res = step(state);
    updateWin(state, CONFIG.tickMs);
    ticks++;
    if (res.ate && firstAppleTick === null) firstAppleTick = ticks;
    if (res.reason === 'self') selfDeaths++;
    clock++;
    if (clock >= appleTicks) {
      clock = 0;
      if (state.apples.length < CONFIG.maxApples) spawnApple(state);
    }
  }

  return { state, ticks, firstAppleTick, selfDeaths, gateViolations, closeCalls, drama, slips, kinds };
}

export function run(rounds = 500, maxTicks = 20000) {
  const stats = {
    rounds,
    wins: 0,
    wall: 0,
    self: 0,
    rescues: 0,
    stalled: 0,
    gateViolations: 0,
    closeCalls: 0,
    slips: 0,
    moves: 0,
    firstAppleTicks: [],
    ticks: [],
  };

  for (let seed = 1; seed <= rounds; seed++) {
    const r = playRound(seed, maxTicks);
    stats.moves += r.ticks;
    stats.gateViolations += r.gateViolations;
    stats.slips += r.slips;
    stats.closeCalls += r.closeCalls;
    stats.ticks.push(r.ticks);
    if (r.firstAppleTick !== null) stats.firstAppleTicks.push(r.firstAppleTick);
    if (r.state.won) stats.wins++;
    else if (r.state.rescuing) stats.rescues++;
    else if (r.state.dead) stats.wall++;
    else stats.stalled++;
    stats.self += r.selfDeaths;
  }

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  stats.winRate = stats.wins / rounds;
  stats.meanFirstAppleSec = (mean(stats.firstAppleTicks) * CONFIG.tickMs) / 1000;
  stats.meanRoundSec = (mean(stats.ticks) * CONFIG.tickMs) / 1000;
  stats.closeCallRate = stats.moves ? stats.closeCalls / stats.moves : 0;
  return stats;
}

if (process.argv[1] && process.argv[1].endsWith('sim.mjs')) {
  const rounds = Number(process.argv[2] || 500);
  const t0 = Date.now();
  const s = run(rounds);
  console.log(JSON.stringify({ ...s, wallSec: (Date.now() - t0) / 1000 }, null, 2));
}
