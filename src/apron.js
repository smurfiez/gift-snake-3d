export const APRON = Object.freeze({ near: 0.7, far: 1.0, frontBias: 0.8, spacing: 0.85 });

const SCENERY_KINDS = ['bush', 'rock', 'flower', 'crate'];

// Points ring the board: mostly in front of the camera, the rest along the sides.
export function apronPoint(w, h, rand = Math.random, bias = APRON.frontBias) {
  if (rand() < 1 - bias) {
    const z = h * 0.3 + rand() * (h * 0.7 + APRON.near);
    const out = APRON.near + rand() * (APRON.far - APRON.near);
    const x = rand() < 0.5 ? -out : w + out;
    return { x, z };
  }
  const x = 0.6 + rand() * (w - 1.2);
  const z = h + APRON.near + rand() * (APRON.far - APRON.near);
  return { x, z };
}

export function walkStep(pos, target, speed, dt) {
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const remaining = Math.hypot(dx, dz);
  if (remaining <= 0.05) return { x: pos.x, z: pos.z, arrived: true };
  const step = Math.min(speed * dt, remaining);
  const ratio = step / remaining;
  return {
    x: pos.x + dx * ratio,
    z: pos.z + dz * ratio,
    arrived: remaining - step <= 0.05,
  };
}

export function faceYaw(from, to) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function clearOf(point, others, minDist) {
  for (const other of others) {
    if (Math.hypot(point.x - other.x, point.z - other.z) < minDist) return false;
  }
  return true;
}

// True when the straight segment never enters the board rectangle grown by
// margin on each side. Slab test, so a segment that only grazes a corner still
// counts as blocked.
export function segmentClear(from, to, w, h, margin = 0.5) {
  let t0 = 0;
  let t1 = 1;
  const slab = (p, d, lo, hi) => {
    if (d === 0) return p > lo && p < hi;
    let a = (lo - p) / d;
    let b = (hi - p) / d;
    if (a > b) {
      const swap = a;
      a = b;
      b = swap;
    }
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  const x = slab(from.x, to.x - from.x, -margin, w + margin);
  const z = x && slab(from.z, to.z - from.z, -margin, h + margin);
  return !(x && z);
}

export function sceneryLayout(w, h, rand = Math.random, count = 14) {
  const items = [];
  for (let i = 0; i < count; i++) {
    let spot = null;
    for (let tries = 0; tries < 200 && !spot; tries++) {
      const candidate = apronPoint(w, h, rand);
      if (clearOf(candidate, items, APRON.spacing)) spot = candidate;
    }
    if (!spot) break;
    items.push({
      kind: SCENERY_KINDS[Math.floor(rand() * SCENERY_KINDS.length)],
      x: spot.x,
      z: spot.z,
      rot: rand() * Math.PI * 2,
      scale: 0.85 + rand() * 0.35,
    });
  }
  return items;
}
