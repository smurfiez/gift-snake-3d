// Procedural stage ambience. No assets, no own AudioContext: the caller hands
// over the shared context after a user gesture. Each stage is 2-4 synthesized
// sources behind a bus gain. Switching stages crossfades the outgoing bus over
// ~0.45s, then schedules its sources to stop, so node count stays flat.

const FADE = 0.45;
const MASTER = 0.32;

const STAGE_IDS = [
  'beach',
  'football',
  'dungeon',
  'garden',
  'space',
  'volcano',
  'arctic',
  'city',
];

const STAGE_LEVEL = 1;

export function createStageAudio() {
  let ctx = null;
  let master = null;
  let masterCtx = null;
  let noiseCache = null;
  let stageId = 'beach';
  let on = true;
  let current = null;

  const api = { setContext, setStage, setEnabled, stop, stage, enabled };

  function usable() {
    return !!ctx && ctx.state !== 'closed';
  }

  function now() {
    return usable() && Number.isFinite(ctx.currentTime) ? ctx.currentTime : 0;
  }

  function gain(v) {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  }

  function filter(type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  function noiseBuffer() {
    if (noiseCache && noiseCache.ctx === ctx) return noiseCache.buffer;
    const length = Math.max(1, Math.floor(ctx.sampleRate * 2));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      data[i] = white * 0.6 + last * 0.4;
    }
    noiseCache = { ctx, buffer };
    return buffer;
  }

  function track(group, node) {
    group.sources.push(node);
    return node;
  }

  function noiseSource(group) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer();
    s.loop = true;
    s.start();
    return track(group, s);
  }

  function osc(group, type, freq) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    return track(group, o);
  }

  // Slow modulation: oscillator -> gain(amount) -> target AudioParam.
  function lfo(group, type, rate, amount, param) {
    const o = osc(group, type, rate);
    const g = gain(amount);
    o.connect(g);
    g.connect(param);
    return g;
  }

  function buildBeach(group) {
    const n = noiseSource(group);
    const lp = filter('lowpass', 680, 0.7);
    const swell = gain(0.7);
    n.connect(lp);
    lp.connect(swell);
    swell.connect(group.bus);
    lfo(group, 'sine', 0.08, 0.26, swell.gain);
  }

  function buildFootball(group) {
    const hum = noiseSource(group);
    const lp = filter('lowpass', 320, 0.7);
    const hg = gain(0.55);
    hum.connect(lp);
    lp.connect(hg);
    hg.connect(group.bus);

    const o = osc(group, 'triangle', 82);
    const olp = filter('lowpass', 190, 0.8);
    const og = gain(0.07);
    o.connect(olp);
    olp.connect(og);
    og.connect(group.bus);

    const swell = noiseSource(group);
    const bp = filter('bandpass', 900, 1.4);
    const sg = gain(0.05);
    swell.connect(bp);
    bp.connect(sg);
    sg.connect(group.bus);
    lfo(group, 'sine', 0.055, 0.045, sg.gain);
  }

  function buildDungeon(group) {
    const o1 = osc(group, 'sine', 55);
    const o2 = osc(group, 'sine', 55.8);
    const lp = filter('lowpass', 420, 0.6);
    const dg = gain(0.11);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(dg);
    dg.connect(group.bus);

    const drip = noiseSource(group);
    const bp = filter('bandpass', 2400, 14);
    const pg = gain(0.012);
    drip.connect(bp);
    bp.connect(pg);
    pg.connect(group.bus);

    const l = lfo(group, 'triangle', 0.32, 0.05, pg.gain);
    const sweep = gain(700);
    l.connect(sweep);
    sweep.connect(bp.frequency);
  }

  function buildGarden(group) {
    const p1 = osc(group, 'triangle', 196);
    const p2 = osc(group, 'triangle', 294);
    const lp = filter('lowpass', 1200, 0.7);
    const pg = gain(0.045);
    p1.connect(lp);
    p2.connect(lp);
    lp.connect(pg);
    pg.connect(group.bus);

    const birds = noiseSource(group);
    const bp = filter('bandpass', 2600, 9);
    const bg = gain(0.018);
    birds.connect(bp);
    bp.connect(bg);
    bg.connect(group.bus);

    const l = lfo(group, 'sine', 0.85, 0.02, bg.gain);
    const sweep = gain(600);
    l.connect(sweep);
    sweep.connect(bp.frequency);
  }

  function buildSpace(group) {
    const o1 = osc(group, 'sine', 41.2);
    const o2 = osc(group, 'sine', 41.7);
    const lp = filter('lowpass', 240, 0.6);
    const dg = gain(0.13);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(dg);
    dg.connect(group.bus);

    const shimmer = osc(group, 'sine', 659);
    const sg = gain(0.012);
    shimmer.connect(sg);
    sg.connect(group.bus);
    lfo(group, 'sine', 0.07, 0.011, sg.gain);
  }

  function buildVolcano(group) {
    const rumble = noiseSource(group);
    const lp = filter('lowpass', 110, 0.8);
    const rg = gain(0.38);
    rumble.connect(lp);
    lp.connect(rg);
    rg.connect(group.bus);

    const o = osc(group, 'sine', 31);
    const og = gain(0.1);
    o.connect(og);
    og.connect(group.bus);

    const crackle = noiseSource(group);
    const hp = filter('highpass', 2200, 0.9);
    const cg = gain(0.008);
    crackle.connect(hp);
    hp.connect(cg);
    cg.connect(group.bus);
    lfo(group, 'square', 0.11, 0.009, cg.gain);
  }

  function buildArctic(group) {
    const wind = noiseSource(group);
    const bp = filter('bandpass', 520, 1.3);
    const wg = gain(0.28);
    wind.connect(bp);
    bp.connect(wg);
    wg.connect(group.bus);

    const l = lfo(group, 'sine', 0.05, 0.14, wg.gain);
    const sweep = gain(300);
    l.connect(sweep);
    sweep.connect(bp.frequency);

    const o = osc(group, 'sine', 58);
    const lp = filter('lowpass', 150, 0.7);
    const og = gain(0.05);
    o.connect(lp);
    lp.connect(og);
    og.connect(group.bus);
  }

  function buildCity(group) {
    const traffic = noiseSource(group);
    const lp = filter('lowpass', 240, 0.7);
    const tg = gain(0.32);
    traffic.connect(lp);
    lp.connect(tg);
    tg.connect(group.bus);

    const o = osc(group, 'sawtooth', 62);
    const olp = filter('lowpass', 300, 0.7);
    const og = gain(0.05);
    o.connect(olp);
    olp.connect(og);
    og.connect(group.bus);

    const horn = osc(group, 'triangle', 392);
    const hg = gain(0.01);
    horn.connect(hg);
    hg.connect(group.bus);
    lfo(group, 'sine', 0.045, 0.009, hg.gain);
  }

  const BUILDERS = {
    beach: buildBeach,
    football: buildFootball,
    dungeon: buildDungeon,
    garden: buildGarden,
    space: buildSpace,
    volcano: buildVolcano,
    arctic: buildArctic,
    city: buildCity,
  };

  function retire(group) {
    if (!group) return;
    const t = now();
    const level = group.bus.gain;
    try {
      if (typeof level.cancelAndHoldAtTime === 'function') {
        level.cancelAndHoldAtTime(t);
      } else {
        level.cancelScheduledValues(t);
        level.setValueAtTime(level.value, t);
      }
      level.linearRampToValueAtTime(0.0001, t + FADE);
    } catch (err) {
      // A closed or half-built context can reject automation; sources still stop.
    }

    const stopAt = t + FADE + 0.05;
    let left = group.sources.length;
    if (left === 0) {
      try {
        group.bus.disconnect();
      } catch (err) {
        // already detached
      }
      return;
    }
    for (const source of group.sources) {
      source.onended = () => {
        left -= 1;
        if (left === 0) {
          try {
            group.bus.disconnect();
          } catch (err) {
            // already detached
          }
        }
      };
      try {
        source.stop(stopAt);
      } catch (err) {
        source.onended = null;
        left -= 1;
      }
    }
    if (left === 0) {
      try {
        group.bus.disconnect();
      } catch (err) {
        // already detached
      }
    }
  }

  function start(id) {
    if (!usable() || !master) return;
    if (current) {
      retire(current);
      current = null;
    }
    const t = now();
    if (on) {
      // A prior stop() left master near zero; restore it when a stage asks for sound.
      try {
        const level = master.gain;
        if (typeof level.cancelAndHoldAtTime === 'function') level.cancelAndHoldAtTime(t);
        else {
          level.cancelScheduledValues(t);
          level.setValueAtTime(level.value, t);
        }
        level.linearRampToValueAtTime(MASTER, t + 0.3);
      } catch (err) {
        // automation rejected; keep current level
      }
    }
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.connect(master);
    const group = { id, bus, sources: [] };
    const build = BUILDERS[id] || BUILDERS.beach;
    try {
      build(group);
    } catch (err) {
      retire(group);
      return;
    }
    bus.gain.linearRampToValueAtTime(STAGE_LEVEL, t + FADE);
    current = group;
  }

  function ensureMaster() {
    if (master && masterCtx === ctx) return master;
    master = ctx.createGain();
    masterCtx = ctx;
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    return master;
  }

  function setContext(next) {
    if (!next || next.state === 'closed') return api;
    if (next === ctx) {
      ensureMaster();
      if (on && !current) start(stageId);
      return api;
    }
    if (current) {
      retire(current);
      current = null;
    }
    ctx = next;
    master = null;
    masterCtx = null;
    noiseCache = null;
    ensureMaster();
    const t = now();
    master.gain.setValueAtTime(on ? MASTER : 0.0001, t);
    if (on) start(stageId);
    return api;
  }

  function setStage(envId) {
    stageId = STAGE_IDS.indexOf(envId) === -1 ? 'beach' : envId;
    if (!usable() || !master || !on) {
      // Muted: drop the wrong stage without building, so enabling starts this one.
      if (current && current.id !== stageId) {
        retire(current);
        current = null;
      }
      return api;
    }
    if (current && current.id === stageId) return api;
    start(stageId);
    return api;
  }

  function setEnabled(next) {
    on = !!next;
    if (!usable() || !master) return api;
    const t = now();
    const target = on ? MASTER : 0.0001;
    try {
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(target, t + 0.3);
    } catch (err) {
      // automation rejected; keep the current level
    }
    if (on) {
      if (current && current.id !== stageId) {
        retire(current);
        current = null;
      }
      if (!current) start(stageId);
    }
    return api;
  }

  function stop() {
    if (current) {
      retire(current);
      current = null;
    }
    if (!usable() || !master) return api;
    const t = now();
    try {
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0.0001, t + 0.3);
    } catch (err) {
      // automation rejected; silent stage already torn down
    }
    return api;
  }

  function stage() {
    return stageId;
  }

  function enabled() {
    return on;
  }

  return api;
}
