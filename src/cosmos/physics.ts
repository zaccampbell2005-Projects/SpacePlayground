/**
 * Unified-field physics core. Pure TypeScript — no React, no canvas.
 * Units: G = 1 (adjustable), c is the sim speed of light, M⊕ = EARTH_MASS units.
 */
export type Kind = "star" | "planet" | "blackhole";
export type Composition = "rocky" | "iron" | "ice" | "gas" | "lava";

export const EARTH_MASS = 2;
export const JUPITER_MASS = 318 * EARTH_MASS;

export interface Body {
  id: string;
  name: string;
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  m: number;
  r: number;
  color: string;
  atmo: string;
  atmoDensity: number; // Rayleigh scattering coefficient 0..1
  composition: Composition;
  elasticity: number;
  friction: number;
  rings: boolean;
  ringInner: number;
  ringOuter: number;
  ringTilt: number;
  magnet: number; // magnetic dipole moment (stars)
  spin: number; // ±1 accretion disk rotation
  seed: number;
  // runtime
  trail: number[];
  isolated?: boolean;
  gwPower?: number;
}

export interface SimSettings {
  G: number;
  c: number;
  timeScale: number;
  paused: boolean;
  pn: boolean;
  gwBoost: number;
  hawking: boolean;
  hawkingK: number;
  mhd: boolean;
  /** Real-world coupling: GW and Hawking effects at true (invisibly tiny) strength. */
  realistic: boolean;
}

export type SimEvent =
  | { type: "merge"; x: number; y: number; m: number; vx: number; vy: number; color: string }
  | { type: "bhmerge"; x: number; y: number; m: number; energy: number }
  | { type: "fragment"; x: number; y: number; vx: number; vy: number; m: number; color: string; speed: number }
  | { type: "evaporate"; x: number; y: number; m: number };

export const defaultSettings = (): SimSettings => ({
  G: 1,
  c: 30,
  timeScale: 1,
  paused: false,
  pn: true,
  gwBoost: 800,
  hawking: true,
  hawkingK: 700,
  mhd: true,
  realistic: false,
});

let idCounter = 0;
export const newId = () => `b${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function schwarzschild(m: number, s: SimSettings) {
  return (2 * s.G * m) / (s.c * s.c);
}

export function lorentzGamma(v: number, c: number) {
  const b = Math.min(v / c, 0.999);
  return 1 / Math.sqrt(1 - b * b);
}

/**
 * Gravitational acceleration on a test particle from mass M at separation (dx,dy)
 * with relative velocity (dvx,dvy), including the first-order post-Newtonian term
 *   a = -(GM/r²)(1 + 3L²/(r²c²)) r̂
 */
export function pnAccel(
  G: number,
  M: number,
  dx: number,
  dy: number,
  dvx: number,
  dvy: number,
  c: number,
  pn: boolean,
  soft = 4,
): [number, number] {
  const r2 = dx * dx + dy * dy + soft;
  const r = Math.sqrt(r2);
  let f = (G * M) / r2;
  if (pn) {
    const L = dx * dvy - dy * dvx; // specific angular momentum (sign irrelevant, squared)
    f *= 1 + Math.min((3 * L * L) / (r2 * c * c), 4);
  }
  // dx points from body toward attractor
  return [(f * dx) / r, (f * dy) / r];
}

/** Einstein quadrupole formula: dE/dt for a circular binary. */
export function quadrupolePower(G: number, c: number, m1: number, m2: number, r: number) {
  const M = m1 + m2;
  return ((32 / 5) * G ** 4 * (m1 * m2) ** 2 * M) / (c ** 5 * r ** 5);
}

export class World {
  bodies: Body[] = [];
  settings: SimSettings = defaultSettings();
  time = 0;
  events: SimEvent[] = [];
  private trailTick = 0;

  // scratch buffers
  private ax: Float64Array = new Float64Array(0);
  private ay: Float64Array = new Float64Array(0);

  computeAccel(X: Float64Array, V: Float64Array, outA: Float64Array) {
    const n = this.bodies.length;
    const { G, c, pn } = this.settings;
    const gwBoost = this.settings.realistic ? (this.settings.gwBoost > 0 ? 1 : 0) : this.settings.gwBoost;
    outA.fill(0);
    for (let i = 0; i < n; i++) {
      const bi = this.bodies[i];
      for (let j = i + 1; j < n; j++) {
        const bj = this.bodies[j];
        const dx = X[2 * j] - X[2 * i];
        const dy = X[2 * j + 1] - X[2 * i + 1];
        const dvx = V[2 * i] - V[2 * j];
        const dvy = V[2 * i + 1] - V[2 * j + 1];
        const [aix, aiy] = pnAccel(G, bj.m, dx, dy, dvx, dvy, c, pn);
        const [ajx, ajy] = pnAccel(G, bi.m, -dx, -dy, -dvx, -dvy, c, pn);
        outA[2 * i] += aix;
        outA[2 * i + 1] += aiy;
        outA[2 * j] += ajx;
        outA[2 * j + 1] += ajy;

        // Gravitational-wave radiation reaction between compact objects.
        if (bi.kind === "blackhole" && bj.kind === "blackhole" && gwBoost > 0) {
          const r = Math.max(Math.hypot(dx, dy), bi.r + bj.r);
          const P = gwBoost * quadrupolePower(G, c, bi.m, bj.m, r);
          const mu = (bi.m * bj.m) / (bi.m + bj.m);
          // Radiation reaction acts against the orbital (tangential) motion, so the
          // binary shrinks while staying near-circular, as GW emission does.
          const rr = Math.hypot(dx, dy) || 1;
          const tx = -dy / rr, ty = dx / rr;
          const vt = dvx * tx + dvy * ty;
          const k = Math.min(P / (mu * (vt * vt + 1e-6)), 0.6);
          const M = bi.m + bj.m;
          const ax_ = k * vt * tx, ay_ = k * vt * ty;
          outA[2 * i] -= ax_ * (bj.m / M);
          outA[2 * i + 1] -= ay_ * (bj.m / M);
          outA[2 * j] += ax_ * (bi.m / M);
          outA[2 * j + 1] += ay_ * (bi.m / M);
          bi.gwPower = P;
          bj.gwPower = P;
        }
      }
    }
  }

  /** Classic 4th-order Runge–Kutta over the full N-body state. */
  rk4(h: number) {
    const n = this.bodies.length;
    if (n === 0) return;
    const N = 2 * n;
    const X = new Float64Array(N), V = new Float64Array(N);
    this.bodies.forEach((b, i) => {
      X[2 * i] = b.x; X[2 * i + 1] = b.y; V[2 * i] = b.vx; V[2 * i + 1] = b.vy;
    });
    const k1a = new Float64Array(N), k2a = new Float64Array(N), k3a = new Float64Array(N), k4a = new Float64Array(N);
    const Xt = new Float64Array(N), Vt = new Float64Array(N);
    const k2v = new Float64Array(N), k3v = new Float64Array(N), k4v = new Float64Array(N);

    this.computeAccel(X, V, k1a);
    for (let q = 0; q < N; q++) { Xt[q] = X[q] + 0.5 * h * V[q]; Vt[q] = V[q] + 0.5 * h * k1a[q]; k2v[q] = Vt[q]; }
    this.computeAccel(Xt, Vt, k2a);
    for (let q = 0; q < N; q++) { Xt[q] = X[q] + 0.5 * h * k2v[q]; Vt[q] = V[q] + 0.5 * h * k2a[q]; k3v[q] = Vt[q]; }
    this.computeAccel(Xt, Vt, k3a);
    for (let q = 0; q < N; q++) { Xt[q] = X[q] + h * k3v[q]; Vt[q] = V[q] + h * k3a[q]; k4v[q] = Vt[q]; }
    this.computeAccel(Xt, Vt, k4a);

    const cMax = this.settings.c * 0.98;
    this.bodies.forEach((b, i) => {
      const ix = 2 * i, iy = ix + 1;
      b.x = X[ix] + (h / 6) * (V[ix] + 2 * k2v[ix] + 2 * k3v[ix] + k4v[ix]);
      b.y = X[iy] + (h / 6) * (V[iy] + 2 * k2v[iy] + 2 * k3v[iy] + k4v[iy]);
      b.vx = V[ix] + (h / 6) * (k1a[ix] + 2 * k2a[ix] + 2 * k3a[ix] + k4a[ix]);
      b.vy = V[iy] + (h / 6) * (k1a[iy] + 2 * k2a[iy] + 2 * k3a[iy] + k4a[iy]);
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > cMax) { b.vx *= cMax / sp; b.vy *= cMax / sp; }
    });
  }

  step(dtReal: number) {
    const s = this.settings;
    if (s.paused) return;
    const dt = Math.min(dtReal, 0.05) * s.timeScale;
    const sub = Math.min(48, Math.max(1, Math.ceil(dt / 0.004)));
    const h = dt / sub;
    for (const b of this.bodies) b.gwPower = 0;
    for (let k = 0; k < sub; k++) {
      this.rk4(h);
      this.collide();
      if (s.hawking) this.hawking(h);
      if (s.mhd) this.windStripping(h);
    }
    this.time += dt;
    if (++this.trailTick % 3 === 0) {
      for (const b of this.bodies) {
        b.trail.push(b.x, b.y);
        if (b.trail.length > 360) b.trail.splice(0, b.trail.length - 360);
      }
    }
  }

  private rank(k: Kind) {
    return k === "blackhole" ? 3 : k === "star" ? 2 : 1;
  }

  private collide() {
    const s = this.settings;
    const list = this.bodies;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const rr = a.kind === "blackhole" || b.kind === "blackhole" ? Math.max(a.r, b.r) * 1.5 + Math.min(a.r, b.r) * 0.5 : a.r + b.r;
        if (d >= rr) continue;

        if (a.kind === "planet" && b.kind === "planet") {
          const nx = dx / (d || 1), ny = dy / (d || 1);
          const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn > 0) continue; // separating
          const vesc = Math.sqrt((2 * s.G * (a.m + b.m)) / (a.r + b.r));
          const e = (a.elasticity + b.elasticity) / 2;
          const f = (a.friction + b.friction) / 2;
          const impact = Math.abs(vn);
          if (impact > vesc * 2.2) {
            this.fragment(i, j, impact);
            return;
          }
          if (impact < vesc * (0.25 + 0.6 * (1 - e))) {
            this.merge(i, j);
            return;
          }
          // Inelastic bounce with restitution + Coulomb-like tangential friction
          const im = 1 / a.m, jm = 1 / b.m;
          const J = (-(1 + e) * vn) / (im + jm);
          a.vx -= J * nx * im; a.vy -= J * ny * im;
          b.vx += J * nx * jm; b.vy += J * ny * jm;
          const tx = -ny, ty = nx;
          const vt = rvx * tx + rvy * ty;
          const Jt = (-vt * f * 0.5) / (im + jm);
          a.vx -= Jt * tx * im; a.vy -= Jt * ty * im;
          b.vx += Jt * tx * jm; b.vy += Jt * ty * jm;
          const overlap = rr - d;
          a.x -= nx * overlap * (b.m / (a.m + b.m)); a.y -= ny * overlap * (b.m / (a.m + b.m));
          b.x += nx * overlap * (a.m / (a.m + b.m)); b.y += ny * overlap * (a.m / (a.m + b.m));
          continue;
        }
        this.merge(i, j);
        return;
      }
    }
  }

  private merge(i: number, j: number) {
    const a = this.bodies[i], b = this.bodies[j];
    const big = this.rank(a.kind) > this.rank(b.kind) || (a.kind === b.kind && a.m >= b.m) ? a : b;
    const small = big === a ? b : a;
    const M = a.m + b.m;
    const bothBH = a.kind === "blackhole" && b.kind === "blackhole";
    const vx = (a.m * a.vx + b.m * b.vx) / M;
    const vy = (a.m * a.vy + b.m * b.vy) / M;
    const x = (a.m * a.x + b.m * b.x) / M;
    const y = (a.m * a.y + b.m * b.y) / M;
    // ~5% of rest mass radiated as gravitational waves in a BBH merger
    const mFinal = bothBH ? M * 0.95 : M;
    big.m = mFinal; big.vx = vx; big.vy = vy; big.x = x; big.y = y;
    if (big.kind === "blackhole") big.r = schwarzschild(big.m, this.settings);
    else if (small.kind === big.kind) big.r = Math.cbrt(big.r ** 3 + small.r ** 3);
    else if (big.kind === "star") big.r = big.r * Math.cbrt(M / (M - small.m));
    if (big.kind === "planet" && small.rings) big.rings = true;
    this.bodies = this.bodies.filter((q) => q !== small);
    if (bothBH) this.events.push({ type: "bhmerge", x, y, m: mFinal, energy: M * 0.05 });
    else this.events.push({ type: "merge", x, y, m: M, vx, vy, color: small.color });
  }

  private fragment(i: number, j: number, speed: number) {
    const a = this.bodies[i], b = this.bodies[j];
    const big = a.m >= b.m ? a : b;
    const small = big === a ? b : a;
    // Larger body keeps a portion of the impactor; the rest becomes debris.
    const keep = small.m * 0.3;
    big.vx = (big.m * big.vx + keep * small.vx) / (big.m + keep);
    big.vy = (big.m * big.vy + keep * small.vy) / (big.m + keep);
    big.m += keep;
    big.r = Math.cbrt(big.r ** 3 + 0.3 * small.r ** 3);
    this.bodies = this.bodies.filter((q) => q !== small);
    this.events.push({ type: "fragment", x: small.x, y: small.y, vx: small.vx, vy: small.vy, m: small.m, color: small.color, speed });
  }

  /** Hawking radiation: dM/dt = -K / M² for isolated singularities. */
  private hawking(h: number) {
    const s = this.settings;
    for (const b of this.bodies) {
      if (b.kind !== "blackhole") continue;
      let iso = true;
      for (const o of this.bodies) {
        if (o === b) continue;
        if (Math.hypot(o.x - b.x, o.y - b.y) < 700) { iso = false; break; }
      }
      b.isolated = iso;
      if (!iso) continue;
      // Real Hawking evaporation of stellar-mass holes takes ~10^67 years: effectively zero.
      const K = s.realistic ? s.hawkingK * 1e-12 : s.hawkingK;
      b.m -= (K / (b.m * b.m)) * h;
      b.r = schwarzschild(Math.max(b.m, 0), s);
    }
    const dead = this.bodies.filter((b) => b.kind === "blackhole" && b.m < 6);
    for (const d of dead) this.events.push({ type: "evaporate", x: d.x, y: d.y, m: d.m });
    if (dead.length) this.bodies = this.bodies.filter((b) => !dead.includes(b));
  }

  /** Stellar wind slowly strips atmospheres close to magnetically active stars. */
  private windStripping(h: number) {
    for (const st of this.bodies) {
      if (st.kind !== "star" || st.magnet <= 0) continue;
      for (const p of this.bodies) {
        if (p.kind !== "planet" || p.atmoDensity <= 0.05) continue;
        const d = Math.hypot(p.x - st.x, p.y - st.y);
        const exposure = (st.magnet * st.r * st.r) / (d * d * d);
        p.atmoDensity = Math.max(0.05, p.atmoDensity - exposure * 0.02 * h);
      }
    }
  }

  dominantNear(x: number, y: number) {
    let best: Body | null = null;
    let score = 0;
    for (const b of this.bodies) {
      if (b.kind === "planet") continue;
      const d = Math.hypot(b.x - x, b.y - y) + 50;
      const sc = b.m / (d * d);
      if (sc > score) { score = sc; best = b; }
    }
    return best;
  }

  totalEnergy() {
    let E = 0;
    const G = this.settings.G;
    for (let i = 0; i < this.bodies.length; i++) {
      const a = this.bodies[i];
      E += 0.5 * a.m * (a.vx * a.vx + a.vy * a.vy);
      for (let j = i + 1; j < this.bodies.length; j++) {
        const b = this.bodies[j];
        E -= (G * a.m * b.m) / Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + 4);
      }
    }
    return E;
  }
}

export function makeBody(p: Partial<Body> & Pick<Body, "kind" | "x" | "y">): Body {
  const kind = p.kind;
  const base: Body = {
    id: newId(),
    name: kind === "star" ? "Star" : kind === "blackhole" ? "Singularity" : "Planet",
    kind,
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    m: kind === "star" ? 5000 : kind === "blackhole" ? 4000 : 10 * EARTH_MASS,
    r: kind === "star" ? 34 : kind === "blackhole" ? 9 : 10,
    color: kind === "star" ? "#ffd27a" : kind === "blackhole" ? "#000000" : "#6fb3c9",
    atmo: "#5cc8ff",
    atmoDensity: kind === "planet" ? 0.5 : 0,
    composition: "rocky",
    elasticity: 0.4,
    friction: 0.3,
    rings: false,
    ringInner: 1.5,
    ringOuter: 2.4,
    ringTilt: 0.35,
    magnet: kind === "star" ? 1 : 0,
    spin: 1,
    seed: Math.floor(Math.random() * 1e9),
    trail: [],
  };
  return { ...base, ...p, trail: [] };
}

/** Circular-orbit velocity around `host` for a body at (x,y), including host velocity. */
export function circularVelocity(host: Body, x: number, y: number, G: number, dir = 1): [number, number] {
  const dx = x - host.x, dy = y - host.y;
  const r = Math.hypot(dx, dy) || 1;
  const v = Math.sqrt((G * host.m) / r);
  return [host.vx + dir * (-dy / r) * v, host.vy + dir * (dx / r) * v];
}
