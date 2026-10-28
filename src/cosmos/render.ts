import { createNoise, mulberry } from "./noise";
import { type Body, type World, lorentzGamma, pnAccel } from "./physics";
import type { GLBackdrop } from "./gl-backdrop";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface FxSettings {
  aberration: boolean;
  flare: boolean;
  motionBlur: boolean;
  nebula: boolean;
  shadows: boolean;
  grid: boolean;
  trails: boolean;
}

export const defaultFx = (): FxSettings => ({
  aberration: true,
  flare: true,
  motionBlur: true,
  nebula: true,
  shadows: true,
  grid: true,
  trails: true,
});

export interface UiOverlay {
  selectedId: string | null;
  lockedId: string | null;
  hoverId: string | null;
  drag: { x0: number; y0: number; x1: number; y1: number; r: number; kind: Body["kind"] } | null;
}

type RGB = [number, number, number];
export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const NEBULA_COLORS: RGB[] = [
  [40, 220, 230], // cyan
  [255, 60, 160], // magenta-pink
  [255, 170, 60], // amber
  [60, 120, 255], // electric blue
  [120, 255, 190], // aqua-mint
];

interface Ripple { x: number; y: number; t: number; amp: number }

const NEB_N = 2600;
const GAS_N = 1400;
const DEB_N = 1600;

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W = 0;
  H = 0;
  dpr = 1;
  noise = createNoise(7);
  t = 0;

  // starfield layers
  private stars: { x: Float32Array; y: Float32Array; s: Float32Array; tw: Float32Array; depth: number }[] = [];
  // nebula particles
  private nx = new Float32Array(NEB_N);
  private ny = new Float32Array(NEB_N);
  private nvx = new Float32Array(NEB_N);
  private nvy = new Float32Array(NEB_N);
  private nc = new Uint8Array(NEB_N);
  private ns = new Float32Array(NEB_N);
  private sprites: HTMLCanvasElement[] = [];
  // MHD gas particles
  private gx = new Float32Array(GAS_N);
  private gy = new Float32Array(GAS_N);
  private gvx = new Float32Array(GAS_N);
  private gvy = new Float32Array(GAS_N);
  private glife = new Float32Array(GAS_N);
  private gq = new Float32Array(GAS_N);
  private gcol: RGB[] = new Array(GAS_N).fill([255, 255, 255]);
  private gHead = 0;
  // debris / hawking particles
  private dx = new Float32Array(DEB_N);
  private dy = new Float32Array(DEB_N);
  private dvx = new Float32Array(DEB_N);
  private dvy = new Float32Array(DEB_N);
  private dlife = new Float32Array(DEB_N);
  private dmax = new Float32Array(DEB_N);
  private dcol: RGB[] = new Array(DEB_N).fill([255, 255, 255]);
  private dHead = 0;

  ripples: Ripple[] = [];
  flashes: { x: number; y: number; t: number; r: number; c: RGB }[] = [];
  private textures = new Map<string, HTMLCanvasElement>();
  private rings = new Map<string, Float32Array>();
  private copy: HTMLCanvasElement;
  private tmp: HTMLCanvasElement;

  gl: GLBackdrop | null;
  /** 1 = full detail; 2-3 = draw every Nth nebula particle (adaptive quality). */
  nebulaStride = 1;
  maxDpr = 1.5;
  private pts = new Float32Array((NEB_N + 1200) * 7);

  constructor(canvas: HTMLCanvasElement, gl: GLBackdrop | null = null) {
    this.canvas = canvas;
    this.gl = gl;
    // with WebGL, the 2D layer is composited on the GPU and stays invisible itself
    if (gl) canvas.style.opacity = "0";
    const ctx = canvas.getContext("2d", { alpha: !!gl });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.copy = document.createElement("canvas");
    this.tmp = document.createElement("canvas");
    this.initStars();
    this.initNebula();
    this.sprites = NEBULA_COLORS.map((c) => {
      const s = document.createElement("canvas");
      s.width = s.height = 64;
      const g = s.getContext("2d")!;
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, rgba(c, 1));
      grd.addColorStop(0.35, rgba(c, 0.45));
      grd.addColorStop(1, rgba(c, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      return s;
    });
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.gl?.resize(w, h, this.dpr);
    this.W = w;
    this.H = h;
    for (const c of [this.canvas, this.copy, this.tmp]) {
      c.width = Math.floor(w * this.dpr);
      c.height = Math.floor(h * this.dpr);
    }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  private initStars() {
    const rnd = mulberry(42);
    const depths = [0.02, 0.06, 0.14];
    const counts = [520, 260, 110];
    this.stars = depths.map((depth, li) => {
      const n = counts[li];
      const x = new Float32Array(n), y = new Float32Array(n), s = new Float32Array(n), tw = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        x[i] = rnd() * 2048; y[i] = rnd() * 2048;
        s[i] = (0.4 + rnd() * (0.6 + li * 0.7)) * (rnd() < 0.03 ? 2.2 : 1);
        tw[i] = rnd() * Math.PI * 2;
      }
      return { x, y, s, tw, depth };
    });
  }

  private initNebula() {
    const rnd = mulberry(1337);
    const clouds = [
      { x: -700, y: -500, r: 900, c: [0, 1] },
      { x: 1300, y: 600, r: 1000, c: [1, 2] },
      { x: 300, y: -1500, r: 800, c: [3, 0] },
      { x: -1500, y: 1100, r: 900, c: [4, 3] },
      { x: 2400, y: -900, r: 700, c: [2, 1] },
    ];
    for (let i = 0; i < NEB_N; i++) {
      const cl = clouds[i % clouds.length];
      const a = rnd() * Math.PI * 2;
      const rr = Math.pow(rnd(), 0.6) * cl.r;
      this.nx[i] = cl.x + Math.cos(a) * rr * 1.3;
      this.ny[i] = cl.y + Math.sin(a) * rr * 0.8;
      this.nc[i] = cl.c[rnd() < 0.65 ? 0 : 1];
      this.ns[i] = 40 + rnd() * 110;
    }
  }

  // ---------- particle emitters ----------
  emitDebris(x: number, y: number, vx: number, vy: number, col: RGB, n: number, speed: number, life = 4) {
    const rnd = Math.random;
    for (let k = 0; k < n; k++) {
      const i = this.dHead = (this.dHead + 1) % DEB_N;
      const a = rnd() * Math.PI * 2;
      const s = speed * (0.2 + rnd() * rnd() * 1.4);
      this.dx[i] = x; this.dy[i] = y;
      this.dvx[i] = vx + Math.cos(a) * s; this.dvy[i] = vy + Math.sin(a) * s;
      this.dmax[i] = this.dlife[i] = life * (0.5 + rnd());
      this.dcol[i] = col;
    }
  }

  private emitGas(x: number, y: number, vx: number, vy: number, col: RGB, q: number) {
    const i = this.gHead = (this.gHead + 1) % GAS_N;
    this.gx[i] = x; this.gy[i] = y; this.gvx[i] = vx; this.gvy[i] = vy;
    this.glife[i] = 2.5 + Math.random() * 2; this.gq[i] = q; this.gcol[i] = col;
  }

  handleEvents(world: World, onSound: (kind: "chime" | "chirp", intensity: number, m: number) => void) {
    for (const e of world.events) {
      if (e.type === "bhmerge") {
        this.ripples.push({ x: e.x, y: e.y, t: 0, amp: Math.min(60, 10 + e.energy * 0.08) });
        this.flashes.push({ x: e.x, y: e.y, t: 0, r: 260, c: [190, 230, 255] });
        onSound("chirp", 1, e.m);
      } else if (e.type === "merge") {
        this.emitDebris(e.x, e.y, e.vx, e.vy, hexToRgb(e.color), 70, 6, 3);
        this.flashes.push({ x: e.x, y: e.y, t: 0, r: 80, c: [255, 220, 170] });
        onSound("chime", 0.8, e.m);
      } else if (e.type === "fragment") {
        this.emitDebris(e.x, e.y, e.vx, e.vy, hexToRgb(e.color), 260, Math.min(e.speed, 25) * 0.9, 6);
        this.emitDebris(e.x, e.y, e.vx, e.vy, [255, 190, 110], 120, Math.min(e.speed, 25) * 1.4, 2);
        this.flashes.push({ x: e.x, y: e.y, t: 0, r: 140, c: [255, 180, 120] });
        onSound("chime", 1.6, e.m);
      } else if (e.type === "evaporate") {
        this.emitDebris(e.x, e.y, 0, 0, [220, 240, 255], 200, 18, 2.5);
        this.flashes.push({ x: e.x, y: e.y, t: 0, r: 200, c: [230, 245, 255] });
        onSound("chime", 1.2, 1);
      }
    }
    world.events.length = 0;
  }

  private texture(b: Body) {
    const key = `${b.kind}|${b.seed}|${b.composition}|${b.color}`;
    let t = this.textures.get(key);
    if (t) return t;
    if (this.textures.size > 80) this.textures.clear();
    const S = 96;
    t = document.createElement("canvas");
    t.width = t.height = S;
    const g = t.getContext("2d")!;
    const img = g.createImageData(S, S);
    const nz = createNoise(b.seed);
    const base = hexToRgb(b.color);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        let c: RGB = base;
        if (b.kind === "star") {
          const n = nz.fbm(u * 9, v * 9, 0.5, 3);
          c = mix(base, [255, 255, 235], clamp01(0.4 + n * 0.8));
        } else if (b.composition === "gas") {
          const band = Math.sin(v * 22 + nz.fbm(u * 3, v * 6, 1, 4) * 4);
          c = mix(mix(base, [255, 250, 235], 0.25), mix(base, [60, 30, 20], 0.35), clamp01(band * 0.5 + 0.5));
        } else if (b.composition === "ice") {
          const n = nz.fbm(u * 6, v * 6, 2, 5);
          const crack = Math.abs(nz.noise3(u * 14, v * 14, 3)) < 0.06 ? 1 : 0;
          c = mix(mix(base, [255, 255, 255], 0.5 + n * 0.4), [40, 110, 160], crack * 0.7);
        } else if (b.composition === "lava") {
          const n = nz.fbm(u * 7, v * 7, 4, 5);
          const crack = clamp01(1 - Math.abs(nz.noise3(u * 9, v * 9, 5)) * 9);
          c = mix(mix([30, 18, 16], base, 0.3 + n * 0.3), [255, 150, 40], crack);
        } else if (b.composition === "iron") {
          const n = nz.fbm(u * 10, v * 10, 6, 5);
          c = mix([70, 74, 82], mix(base, [230, 236, 245], 0.35), clamp01(0.5 + n));
        } else {
          const n = nz.fbm(u * 5, v * 5, 7, 6);
          const land = n > 0.05;
          c = land ? mix(mix(base, [120, 95, 60], 0.65), [70, 120, 60], clamp01(n * 2)) : mix(base, [10, 30, 70], clamp01(-n * 2));
          const crater = nz.noise3(u * 20, v * 20, 8);
          if (crater > 0.6) c = mix(c, [40, 35, 30], 0.4);
        }
        const k = (y * S + x) * 4;
        img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.textures.set(key, t);
    return t;
  }

  // ---------- main frame ----------
  draw(world: World, dtReal: number, cam: Camera, fx: FxSettings, ui: UiOverlay) {
    const { ctx, W, H } = this;
    const dt = Math.min(dtReal, 0.05);
    const simDt = world.settings.paused ? 0 : dt * world.settings.timeScale;
    this.t += dt;
    const z = cam.zoom;
    const cx = W / 2, cy = H / 2;
    const sx = (x: number) => (x - cam.x) * z + cx;
    const sy = (y: number) => (y - cam.y) * z + cy;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (this.gl) {
      ctx.clearRect(0, 0, W, H);
      this.gl.begin();
    } else {
    // deep space void
    const bg = ctx.createRadialGradient(cx, cy * 0.8, 0, cx, cy, Math.max(W, H) * 0.85);
    bg.addColorStop(0, "#070a16");
    bg.addColorStop(0.6, "#03040b");
    bg.addColorStop(1, "#010103");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    }

    this.drawStars(cam);

    const stars = world.bodies.filter((b) => b.kind === "star");
    const locked = ui.lockedId ? world.bodies.find((b) => b.id === ui.lockedId) ?? null : null;

    if (fx.nebula) this.drawNebula(world, simDt, cam, fx, stars);
    if (fx.grid) this.drawGrid(world, cam, locked);
    this.updateRipples(dt);
    if (fx.shadows) this.drawShadowCones(world, cam, stars);
    if (fx.trails) this.drawTrails(world, cam);

    this.updateGas(world, simDt, cam, stars, fx);
    this.updateDebris(world, simDt, cam, fx);

    // bodies: stars first, then planets, then black holes (lensing on top)
    const order = [...world.bodies].sort((a, b) => (a.kind === "star" ? -1 : 0) - (b.kind === "star" ? -1 : 0));
    for (const b of order) {
      const px = sx(b.x), py = sy(b.y);
      const pr = Math.max(b.r * z, b.kind === "blackhole" ? 1.5 : 1.2);
      const margin = b.kind === "blackhole" ? pr * 14 : b.kind === "star" ? pr * 8 : pr * 4;
      if (px < -margin || py < -margin || px > W + margin || py > H + margin) continue;
      if (fx.motionBlur) this.drawSpeedGhost(b, px, py, pr, z, world.settings.c);
      if (b.kind === "star") this.drawStar(b, px, py, pr);
      else if (b.kind === "planet") this.drawPlanet(b, px, py, pr, world, simDt, stars);
      else this.drawBlackHole(b, px, py, pr, world);
    }

    this.drawFlashes(cam, dt);
    this.drawOverlay(world, cam, ui);
    if (fx.flare) this.drawFlares(stars, cam);
    this.vignette();
    if (this.gl) this.gl.composite(this.canvas, fx.aberration ? 0.004 : 0);
    else if (fx.aberration) this.chromatic();
  }

  private drawStars(cam: Camera) {
    const { ctx, W, H } = this;
    const pf = Math.pow(cam.zoom, 0.35);
    let np = 0;
    ctx.globalCompositeOperation = "lighter";
    for (const L of this.stars) {
      const ox = -cam.x * L.depth * pf * 3;
      const oy = -cam.y * L.depth * pf * 3;
      const size = 1 + (cam.zoom - 1) * L.depth * 0.6;
      for (let i = 0; i < L.x.length; i++) {
        let x = (L.x[i] + ox) % 2048; if (x < 0) x += 2048;
        let y = (L.y[i] + oy) % 2048; if (y < 0) y += 2048;
        for (let tx = x; tx < W; tx += 2048) {
          for (let ty = y; ty < H; ty += 2048) {
            const tw = 0.55 + 0.45 * Math.sin(this.t * 1.7 + L.tw[i]);
            const s = Math.max(0.4, L.s[i] * size);
            if (this.gl) {
              if (np < this.pts.length / 7) {
                const o = np++ * 7, p = this.pts;
                p[o] = tx; p[o + 1] = ty; p[o + 2] = Math.max(1.5, s * 1.6);
                p[o + 3] = (200 + (i % 3) * 20) / 255; p[o + 4] = (215 + (i % 2) * 25) / 255; p[o + 5] = 1; p[o + 6] = 0.35 + 0.5 * tw;
              }
              continue;
            }
            ctx.fillStyle = `rgba(${200 + (i % 3) * 20},${215 + (i % 2) * 25},255,${0.35 + 0.5 * tw})`;
            ctx.fillRect(tx, ty, s, s);
          }
        }
      }
    }
    if (this.gl) this.gl.points(this.pts, np, true);
    ctx.globalCompositeOperation = "source-over";
  }

  private drawNebula(world: World, simDt: number, cam: Camera, fx: FxSettings, stars: Body[]) {
    const { ctx, W, H } = this;
    const z = cam.zoom;
    const t = this.t * 0.04;
    const bodies = world.bodies;
    // occluders for shadow casting
    const occ: { sx: number; sy: number; px: number; py: number; ux: number; uy: number; D: number; rp: number; rs: number }[] = [];
    if (fx.shadows) {
      for (const s of stars) for (const p of bodies) {
        if (p.kind !== "planet") continue;
        const D = Math.hypot(p.x - s.x, p.y - s.y);
        if (D < 1 || D > 3000) continue;
        occ.push({ sx: s.x, sy: s.y, px: p.x, py: p.y, ux: (p.x - s.x) / D, uy: (p.y - s.y) / D, D, rp: p.r * 2.4, rs: s.r });
      }
    }
    const step = Math.min(simDt, 0.05);
    ctx.globalCompositeOperation = "screen";
    let np = 0;
    const stride = this.nebulaStride;
    for (let i = 0; i < NEB_N; i++) {
      let x = this.nx[i], y = this.ny[i];
      if (step > 0) {
        const [fx_, fy_] = this.noise.curl(x * 0.0012, y * 0.0012, t);
        let vx = this.nvx[i] + fx_ * 1.4 * step;
        let vy = this.nvy[i] + fy_ * 1.4 * step;
        // bodies stir the gas: drag along with motion + swirl (vortex) around mass
        for (let k = 0; k < bodies.length; k++) {
          const b = bodies[k];
          const ddx = x - b.x, ddy = y - b.y;
          const R = b.kind === "planet" ? b.r * 9 + 60 : b.r * 6 + 160;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 > R * R) continue;
          const d = Math.sqrt(d2) + 1;
          const fall = 1 - d / R;
          const push = fall * fall;
          vx += (b.vx * 0.9 - vx) * push * step * 3 + (ddx / d) * push * step * 25;
          vy += (b.vy * 0.9 - vy) * push * step * 3 + (ddy / d) * push * step * 25;
          const sw = push * step * (b.kind === "planet" ? 6 : 14) * (b.spin || 1);
          vx += (-ddy / d) * sw;
          vy += (ddx / d) * sw;
        }
        const damp = Math.exp(-0.35 * step);
        vx *= damp; vy *= damp;
        x += vx * step * 6; y += vy * step * 6;
        this.nvx[i] = vx; this.nvy[i] = vy;
        this.nx[i] = x; this.ny[i] = y;
      }
      if (stride > 1 && i % stride !== 0) continue;
      const size = this.ns[i] * z * (stride > 1 ? 1 + (stride - 1) * 0.35 : 1);
      const px = (x - cam.x) * z + W / 2;
      const py = (y - cam.y) * z + H / 2;
      if (px < -size || py < -size || px > W + size || py > H + size) continue;
      // illumination from stars and shadowing by planets (soft penumbra)
      let light = 0.35;
      for (const s of stars) {
        const d = Math.hypot(x - s.x, y - s.y);
        light += (s.r * 9) / (d + s.r * 5);
      }
      let shade = 1;
      for (const o of occ) {
        const qx = x - o.px, qy = y - o.py;
        const along = qx * o.ux + qy * o.uy;
        if (along <= 0 || along > 2500) continue;
        const perp = Math.abs(qx * -o.uy + qy * o.ux);
        const umbra = Math.max(o.rp * (1 - along / ((o.rp * o.D) / Math.max(o.rs - o.rp, 1))), 0);
        const pen = o.rp + (along * (o.rs + o.rp)) / o.D;
        if (perp > pen) continue;
        const f = perp <= umbra ? 0.12 : 0.12 + 0.88 * ((perp - umbra) / Math.max(pen - umbra, 1e-3));
        shade = Math.min(shade, f + (1 - f) * (along / 2500));
      }
      const a = Math.min(0.16, 0.085 * light) * shade;
      if (a < 0.004) continue;
      const aa = Math.min(1, a * Math.sqrt(stride));
      if (this.gl) {
        const o = np++ * 7, p = this.pts, c = NEBULA_COLORS[this.nc[i]];
        p[o] = px; p[o + 1] = py; p[o + 2] = size; p[o + 3] = c[0] / 255; p[o + 4] = c[1] / 255; p[o + 5] = c[2] / 255; p[o + 6] = aa * 1.6;
        continue;
      }
      ctx.globalAlpha = aa;
      ctx.drawImage(this.sprites[this.nc[i]], px - size / 2, py - size / 2, size, size);
    }
    if (this.gl) this.gl.points(this.pts, np, false);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private gridWarp(world: World, x: number, y: number, massive: Body[], locked: Body | null, gamma: number, ux: number, uy: number): [number, number] {
    let ox = 0, oy = 0;
    for (const b of massive) {
      const rx = b.x - x, ry = b.y - y;
      const r = Math.sqrt(rx * rx + ry * ry) + 1e-3;
      const pull = Math.min((b.m * 1.1) / (r + 140), r * 0.75);
      ox += (rx / r) * pull;
      oy += (ry / r) * pull;
    }
    for (const rp of this.ripples) {
      const rx = x - rp.x, ry = y - rp.y;
      const r = Math.sqrt(rx * rx + ry * ry) + 1e-3;
      const R = rp.t * 260;
      const dr = r - R;
      if (Math.abs(dr) > 500) continue;
      const amp = rp.amp * Math.exp(-(dr * dr) / (2 * 180 * 180)) * Math.sin(dr * 0.045) * Math.exp(-rp.t * 0.25);
      ox += (rx / r) * amp;
      oy += (ry / r) * amp;
    }
    let px = x + ox, py = y + oy;
    if (locked && gamma > 1.0005) {
      // Lorentz contraction of space along the tracked body's velocity vector
      const qx = px - locked.x, qy = py - locked.y;
      const par = qx * ux + qy * uy;
      const k = par * (1 - 1 / gamma);
      px -= k * ux;
      py -= k * uy;
    }
    return [px, py];
  }

  private drawGrid(world: World, cam: Camera, locked: Body | null) {
    const { ctx, W, H } = this;
    const z = cam.zoom;
    const raw = 80 / z;
    const p10 = Math.pow(10, Math.floor(Math.log10(raw)));
    const sp = [1, 2, 5, 10].map((m) => m * p10).find((v) => v >= raw) ?? raw;
    const halfW = W / 2 / z + sp * 2, halfH = H / 2 / z + sp * 2;
    const minX = Math.floor((cam.x - halfW) / sp) * sp, maxX = cam.x + halfW;
    const minY = Math.floor((cam.y - halfH) / sp) * sp, maxY = cam.y + halfH;
    const massive = world.bodies.filter((b) => b.m > 150);
    let gamma = 1, ux = 0, uy = 0;
    if (locked) {
      const v = Math.hypot(locked.vx, locked.vy);
      gamma = lorentzGamma(v, world.settings.c);
      if (v > 0) { ux = locked.vx / v; uy = locked.vy / v; }
    }
    const seg = sp / 3;
    const toS = (p: [number, number]) => [(p[0] - cam.x) * z + W / 2, (p[1] - cam.y) * z + H / 2];
    ctx.lineWidth = 1;
    const rippleBoost = this.ripples.length ? 0.12 : 0;
    ctx.strokeStyle = `rgba(80,200,255,${0.09 + rippleBoost})`;
    ctx.beginPath();
    for (let gx = minX; gx <= maxX; gx += sp) {
      let first = true;
      for (let gy = minY; gy <= maxY + seg; gy += seg) {
        const [x, y] = toS(this.gridWarp(world, gx, gy, massive, locked, gamma, ux, uy));
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
    }
    for (let gy = minY; gy <= maxY; gy += sp) {
      let first = true;
      for (let gx = minX; gx <= maxX + seg; gx += seg) {
        const [x, y] = toS(this.gridWarp(world, gx, gy, massive, locked, gamma, ux, uy));
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  private updateRipples(dt: number) {
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < 14);
  }

  private drawShadowCones(world: World, cam: Camera, stars: Body[]) {
    const { ctx, W, H } = this;
    const z = cam.zoom;
    const S = (x: number, y: number) => [(x - cam.x) * z + W / 2, (y - cam.y) * z + H / 2] as const;
    for (const s of stars) for (const p of world.bodies) {
      if (p.kind !== "planet") continue;
      const D = Math.hypot(p.x - s.x, p.y - s.y);
      if (D < 1) continue;
      const ux = (p.x - s.x) / D, uy = (p.y - s.y) / D, nx = -uy, ny = ux;
      const L = Math.min(2200, D * 3);
      const spread = p.r + (L * (s.r + p.r)) / D;
      const a0 = S(p.x + nx * p.r, p.y + ny * p.r);
      const a1 = S(p.x - nx * p.r, p.y - ny * p.r);
      const b0 = S(p.x + ux * L + nx * spread, p.y + uy * L + ny * spread);
      const b1 = S(p.x + ux * L - nx * spread, p.y + uy * L - ny * spread);
      const [psx, psy] = S(p.x, p.y);
      const [esx, esy] = S(p.x + ux * L, p.y + uy * L);
      const g = ctx.createLinearGradient(psx, psy, esx, esy);
      g.addColorStop(0, "rgba(0,0,6,0.55)");
      g.addColorStop(1, "rgba(0,0,6,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(a0[0], a0[1]); ctx.lineTo(b0[0], b0[1]); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(a1[0], a1[1]);
      ctx.closePath();
      ctx.fill();
      // umbra core converging to apex
      const apex = Math.min((p.r * D) / Math.max(s.r - p.r, 1), L);
      const [ax, ay] = S(p.x + ux * apex, p.y + uy * apex);
      ctx.fillStyle = "rgba(0,0,4,0.35)";
      ctx.beginPath();
      ctx.moveTo(a0[0], a0[1]); ctx.lineTo(ax, ay); ctx.lineTo(a1[0], a1[1]); ctx.closePath();
      ctx.fill();
      // faint ray-cast terminator lines
      const lg = ctx.createLinearGradient(psx, psy, esx, esy);
      const sc = hexToRgb(s.color);
      lg.addColorStop(0, rgba(sc, 0.22));
      lg.addColorStop(1, rgba(sc, 0));
      ctx.strokeStyle = lg;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(a0[0], a0[1]); ctx.lineTo(b0[0], b0[1]);
      ctx.moveTo(a1[0], a1[1]); ctx.lineTo(b1[0], b1[1]);
      ctx.stroke();
    }
  }

  private drawTrails(world: World, cam: Camera) {
    const { ctx, W, H } = this;
    const z = cam.zoom;
    ctx.lineWidth = 1.2;
    ctx.globalCompositeOperation = "lighter";
    for (const b of world.bodies) {
      const tr = b.trail;
      if (tr.length < 6) continue;
      const col = b.kind === "blackhole" ? ([255, 140, 80] as RGB) : b.kind === "star" ? hexToRgb(b.color) : hexToRgb(b.atmo);
      const n = tr.length / 2;
      const chunk = 12;
      for (let s = 0; s < n - 1; s += chunk) {
        const a = (s / n) * 0.45;
        ctx.strokeStyle = rgba(col, a);
        ctx.beginPath();
        for (let k = s; k <= Math.min(n - 1, s + chunk); k++) {
          const x = (tr[2 * k] - cam.x) * z + W / 2, y = (tr[2 * k + 1] - cam.y) * z + H / 2;
          if (k === s) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private updateGas(world: World, simDt: number, cam: Camera, stars: Body[], fx: FxSettings) {
    const { ctx, W, H } = this;
    const z = cam.zoom;
    const s = world.settings;
    // emit: planets near magnetically active stars shed charged atmospheric gas
    if (s.mhd && simDt > 0) {
      for (const st of stars) for (const p of world.bodies) {
        if (p.kind !== "planet" || p.atmoDensity < 0.06) continue;
        const dx = p.x - st.x, dy = p.y - st.y;
        const d = Math.hypot(dx, dy);
        if (d > 1100) continue;
        const rate = Math.min(6, (st.magnet * p.atmoDensity * 26000) / (d * d) * 40 + 0.5);
        const n = Math.random() < rate - Math.floor(rate) ? Math.ceil(rate) : Math.floor(rate);
        const col = hexToRgb(p.atmo);
        for (let k = 0; k < n; k++) {
          // emit from the night-side limb (pushed away by the wind)
          const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 2.4;
          const ex = p.x + Math.cos(a) * p.r * 1.25, ey = p.y + Math.sin(a) * p.r * 1.25;
          this.emitGas(ex, ey, p.vx, p.vy, col, (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random()));
        }
      }
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < GAS_N; i++) {
      if (this.glife[i] <= 0) continue;
      if (simDt > 0) {
        let ax = 0, ay = 0;
        for (const st of stars) {
          const dx = this.gx[i] - st.x, dy = this.gy[i] - st.y;
          const d2 = dx * dx + dy * dy + 100;
          const d = Math.sqrt(d2);
          // stellar wind ram pressure
          const wind = (st.magnet * 9000) / d2;
          ax += (dx / d) * wind;
          ay += (dy / d) * wind;
          // magnetic dipole field (out of plane): Bz ∝ μ/r³ ; Lorentz F = q v × B
          const Bz = (st.magnet * 120000) / (d2 * d);
          const rvx = this.gvx[i] - st.vx, rvy = this.gvy[i] - st.vy;
          ax += this.gq[i] * rvy * Bz;
          ay += -this.gq[i] * rvx * Bz;
        }
        this.gvx[i] += ax * simDt;
        this.gvy[i] += ay * simDt;
        this.gx[i] += this.gvx[i] * simDt;
        this.gy[i] += this.gvy[i] * simDt;
        this.glife[i] -= simDt;
      }
      const px = (this.gx[i] - cam.x) * z + W / 2, py = (this.gy[i] - cam.y) * z + H / 2;
      if (px < -20 || py < -20 || px > W + 20 || py > H + 20) continue;
      const a = Math.min(1, this.glife[i] / 2) * 0.55;
      ctx.strokeStyle = rgba(this.gcol[i], a);
      ctx.fillStyle = rgba(this.gcol[i], a);
      if (fx.motionBlur) {
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - this.gvx[i] * z * 0.25, py - this.gvy[i] * z * 0.25);
        ctx.stroke();
      } else ctx.fillRect(px - 0.8, py - 0.8, 1.6, 1.6);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private updateDebris(world: World, simDt: number, cam: Camera, fx: FxSettings) {
    const { ctx, W, H } = this;
    const z = cam.zoom;
    const heavy = world.bodies.filter((b) => b.kind !== "planet");
    // Hawking radiation sparks from isolated black holes
    if (world.settings.hawking && simDt > 0) {
      for (const b of world.bodies) {
        if (b.kind !== "blackhole" || !b.isolated) continue;
        const T = 2000 / b.m; // Hawking temperature ∝ 1/M
        const n = Math.min(8, T * 0.6 + (Math.random() < 0.3 ? 1 : 0));
        for (let k = 0; k < n; k++) this.emitDebris(b.x, b.y, b.vx, b.vy, [200, 230, 255], 1, world.settings.c * 0.6, 1.2);
      }
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < DEB_N; i++) {
      if (this.dlife[i] <= 0) continue;
      if (simDt > 0) {
        let ax = 0, ay = 0;
        for (const b of heavy) {
          const [gx, gy] = pnAccel(world.settings.G, b.m, b.x - this.dx[i], b.y - this.dy[i], 0, 0, world.settings.c, false, 25);
          ax += gx; ay += gy;
        }
        this.dvx[i] += ax * simDt; this.dvy[i] += ay * simDt;
        this.dx[i] += this.dvx[i] * simDt; this.dy[i] += this.dvy[i] * simDt;
        this.dlife[i] -= simDt;
      }
      const px = (this.dx[i] - cam.x) * z + W / 2, py = (this.dy[i] - cam.y) * z + H / 2;
      if (px < -40 || py < -40 || px > W + 40 || py > H + 40) continue;
      const a = clamp01(this.dlife[i] / this.dmax[i]);
      const c = this.dcol[i];
      if (fx.motionBlur) {
        const len = 0.12;
        const tx = px - this.dvx[i] * z * len * 4, ty = py - this.dvy[i] * z * len * 4;
        const g = ctx.createLinearGradient(px, py, tx, ty);
        g.addColorStop(0, rgba(mix(c, [255, 255, 255], 0.5), a));
        g.addColorStop(1, rgba(c, 0));
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
      } else {
        ctx.fillStyle = rgba(c, a);
        ctx.fillRect(px - 1, py - 1, 2, 2);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private drawSpeedGhost(b: Body, px: number, py: number, pr: number, z: number, c: number) {
    const v = Math.hypot(b.vx, b.vy);
    const beta = v / c;
    if (beta < 0.25 || b.kind === "blackhole") return;
    const { ctx } = this;
    const col = hexToRgb(b.kind === "star" ? b.color : b.atmo);
    const len = (beta - 0.2) * 18 * z;
    const g = ctx.createLinearGradient(px, py, px - b.vx * len / v * 10, py - b.vy * len / v * 10);
    g.addColorStop(0, rgba(col, 0.5));
    g.addColorStop(1, rgba(col, 0));
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = g;
    ctx.lineCap = "round";
    ctx.lineWidth = pr * 1.8;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - (b.vx / v) * len * 10, py - (b.vy / v) * len * 10);
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.globalCompositeOperation = "source-over";
  }

  private drawStar(b: Body, px: number, py: number, pr: number) {
    const { ctx } = this;
    const col = hexToRgb(b.color);
    ctx.globalCompositeOperation = "lighter";
    const corona = ctx.createRadialGradient(px, py, pr * 0.6, px, py, pr * 7);
    corona.addColorStop(0, rgba(col, 0.55));
    corona.addColorStop(0.25, rgba(col, 0.16));
    corona.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = corona;
    ctx.beginPath(); ctx.arc(px, py, pr * 7, 0, Math.PI * 2); ctx.fill();
    // flickering prominences
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.t * 0.1;
      const L = pr * (1.15 + 0.25 * (0.5 + 0.5 * this.noise.noise3(i, this.t * 0.4, b.seed % 100)));
      ctx.strokeStyle = rgba(mix(col, [255, 120, 60], 0.4), 0.1);
      ctx.lineWidth = Math.max(0.6, pr * 0.05);
      ctx.beginPath();
      ctx.arc(px + Math.cos(a) * pr * 0.95, py + Math.sin(a) * pr * 0.95, (L - pr) * 1.2, a - 1.5, a + 1.5);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.clip();
    const tex = this.texture(b);
    ctx.translate(px, py);
    ctx.rotate(this.t * 0.03);
    ctx.drawImage(tex, -pr * 1.5, -pr * 1.5, pr * 3, pr * 3);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const limb = ctx.createRadialGradient(px, py, 0, px, py, pr);
    limb.addColorStop(0, "rgba(255,255,245,0.55)");
    limb.addColorStop(0.7, rgba(col, 0));
    limb.addColorStop(1, rgba(mix(col, [120, 30, 0], 0.5), 0.75));
    ctx.fillStyle = limb;
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    ctx.restore();
  }

  private ringParticles(b: Body) {
    let r = this.rings.get(b.id);
    if (!r) {
      const rnd = mulberry(b.seed);
      const n = 360;
      r = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        r[3 * i] = rnd(); // normalized radius
        r[3 * i + 1] = rnd() * Math.PI * 2;
        r[3 * i + 2] = 0.4 + rnd() * 0.6; // brightness
      }
      this.rings.set(b.id, r);
    }
    return r;
  }

  private drawRingHalf(b: Body, px: number, py: number, pr: number, front: boolean, G: number, simDt: number, light: RGB) {
    const { ctx } = this;
    const rp = this.ringParticles(b);
    const n = rp.length / 3;
    const tilt = b.ringTilt;
    const ca = Math.cos(tilt), sa = Math.sin(tilt);
    const q = 0.32;
    const col = mix(hexToRgb(b.color), [235, 225, 210], 0.5);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const Rn = b.ringInner + rp[3 * i] * (b.ringOuter - b.ringInner);
      if (front && simDt > 0) {
        // Keplerian: ω = sqrt(GM / R³), in world units
        const Rw = Rn * b.r;
        rp[3 * i + 1] += Math.sqrt((G * b.m) / (Rw * Rw * Rw)) * simDt;
      }
      const ang = rp[3 * i + 1];
      const s = Math.sin(ang);
      if (front ? s < 0 : s >= 0) continue;
      const lx = Math.cos(ang) * Rn * pr, ly = s * Rn * pr * q;
      const x = px + lx * ca - ly * sa, y = py + lx * sa + ly * ca;
      const a = rp[3 * i + 2] * (front ? 0.85 : 0.5);
      ctx.fillStyle = rgba(mix(col, light, 0.3), a);
      const sz = Math.max(0.8, pr * 0.07);
      ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private drawPlanet(b: Body, px: number, py: number, pr: number, world: World, simDt: number, stars: Body[]) {
    const { ctx } = this;
    // light source = most luminous star by apparent flux
    let lx = -0.6, ly = -0.6, lightCol: RGB = [200, 210, 255], flux = 0.15;
    let best = 0;
    for (const s of stars) {
      const dx = s.x - b.x, dy = s.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (s.m * s.r) / (d * d);
      if (f > best) { best = f; lx = dx / d; ly = dy / d; lightCol = hexToRgb(s.color); flux = Math.min(1, 0.5 + f * 0.5); }
    }
    if (b.rings) this.drawRingHalf(b, px, py, pr, false, world.settings.G, simDt, lightCol);

    // atmosphere: layered Rayleigh rim (outer diffuse + inner sharp), brighter on the day side
    const atmo = hexToRgb(b.atmo);
    const dens = b.atmoDensity;
    if (dens > 0.02 && pr > 1.5) {
      ctx.globalCompositeOperation = "lighter";
      const outer = ctx.createRadialGradient(px + lx * pr * 0.25, py + ly * pr * 0.25, pr * 0.85, px, py, pr * (1.25 + dens * 0.6));
      outer.addColorStop(0, rgba(atmo, 0.55 * dens));
      outer.addColorStop(0.45, rgba(atmo, 0.18 * dens));
      outer.addColorStop(1, rgba(atmo, 0));
      ctx.fillStyle = outer;
      ctx.beginPath(); ctx.arc(px, py, pr * (1.3 + dens * 0.6), 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }

    // surface
    ctx.save();
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.clip();
    const tex = this.texture(b);
    const spinShift = ((this.t * (b.composition === "gas" ? 0.05 : 0.025) + (b.seed % 100) / 100) % 1) * pr * 2;
    ctx.drawImage(tex, px - pr - spinShift, py - pr, pr * 2, pr * 2);
    ctx.drawImage(tex, px + pr - spinShift, py - pr, pr * 2, pr * 2);
    // terminator shading
    const shade = ctx.createRadialGradient(px + lx * pr * 0.55, py + ly * pr * 0.55, pr * 0.1, px - lx * pr * 0.2, py - ly * pr * 0.2, pr * 1.45);
    shade.addColorStop(0, `rgba(0,0,0,0)`);
    shade.addColorStop(0.55, `rgba(0,0,8,${0.35 * (1.2 - flux)})`);
    shade.addColorStop(1, "rgba(0,0,8,0.96)");
    ctx.fillStyle = shade;
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    // core composition → specular reflectivity
    const refl = { iron: 0.6, ice: 0.75, rocky: 0.18, gas: 0.12, lava: 0.08 }[b.composition];
    ctx.globalCompositeOperation = "lighter";
    const spec = ctx.createRadialGradient(px + lx * pr * 0.45, py + ly * pr * 0.45, 0, px + lx * pr * 0.45, py + ly * pr * 0.45, pr * 0.7);
    spec.addColorStop(0, rgba(mix(lightCol, [255, 255, 255], 0.5), refl * flux));
    spec.addColorStop(1, rgba(lightCol, 0));
    ctx.fillStyle = spec;
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    if (b.composition === "lava") {
      ctx.fillStyle = "rgba(255,90,20,0.12)";
      ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
    ctx.restore();

    // inner high-scattering rim (limb glow on day side)
    if (dens > 0.02 && pr > 2) {
      ctx.globalCompositeOperation = "lighter";
      const a0 = Math.atan2(ly, lx);
      ctx.lineWidth = Math.max(1, pr * 0.14 * (0.5 + dens));
      ctx.strokeStyle = rgba(mix(atmo, [255, 255, 255], 0.3), 0.75 * dens * flux);
      ctx.beginPath(); ctx.arc(px, py, pr * 1.02, a0 - 1.7, a0 + 1.7); ctx.stroke();
      ctx.strokeStyle = rgba(atmo, 0.25 * dens);
      ctx.lineWidth = Math.max(1, pr * 0.06);
      ctx.beginPath(); ctx.arc(px, py, pr * 1.04, 0, Math.PI * 2); ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }

    // magnetosphere: bow shock compressed toward the star, tail stretched away
    if (world.settings.mhd && stars.length && pr > 2) {
      const near = stars[0];
      const d = Math.hypot(near.x - b.x, near.y - b.y);
      const press = Math.min(1, (near.magnet * 400) / d);
      if (press > 0.15) {
        const a0 = Math.atan2(ly, lx);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a0);
        ctx.strokeStyle = rgba(atmo, 0.22 * press);
        ctx.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
          const R = pr * (2.2 + k * 0.7) * (1 - press * 0.35);
          ctx.beginPath();
          ctx.ellipse(-R * press * 0.8, 0, R * (1 + press * 1.2), R * 0.9, 0, Math.PI * 0.55, Math.PI * 1.45, true);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    if (b.rings) this.drawRingHalf(b, px, py, pr, true, world.settings.G, simDt, lightCol);
  }

  private drawBlackHole(b: Body, px: number, py: number, rsS: number, world: World) {
    const { ctx } = this;
    const rs = Math.max(rsS, 1.5);
    const c = world.settings.c;
    const spin = b.spin >= 0 ? 1 : -1;
    const inc = 0.92; // sin(inclination): how much orbital velocity points along the line of sight
    const q = 0.26; // disk projection squash
    const rIn = 3 * rs, rOut = 9.5 * rs;
    const bands = 14;
    const segs = rs < 3 ? 36 : 84;
    const t = this.t;

    const diskColor = (R: number, theta: number): [RGB, number] => {
      // Keplerian β at radius R (R in units of rs): β = sqrt(1/(2R))
      const Rr = R / rs;
      const beta = Math.min(0.7, Math.sqrt(1 / (2 * Rr)));
      const gamma = 1 / Math.sqrt(1 - beta * beta);
      // line-of-sight component: approaching side is where cosθ·spin > 0
      const D = 1 / (gamma * (1 - beta * inc * Math.cos(theta) * spin));
      const beaming = Math.pow(D, 4); // relativistic beaming I ∝ D⁴
      const temp = clamp01(1.25 - (Rr - 3) / 6.5);
      let col: RGB = mix([255, 110, 40], [255, 236, 200], temp);
      if (D > 1) col = mix(col, [110, 170, 255], clamp01((D - 1) * 2.4)); // blueshift
      else col = mix(col, [200, 30, 20], clamp01((1 - D) * 1.8)); // redshift
      const omega = Math.pow(Rr, -1.5) * 3 * spin;
      const turb = 0.55 + 0.45 * this.noise.noise3(Math.cos(theta - omega * t) * 2 + Rr * 0.7, Math.sin(theta - omega * t) * 2, b.seed % 50);
      return [col, clamp01(beaming * 0.17 * turb * (0.6 + temp))];
    };

    const drawHalf = (front: boolean) => {
      ctx.globalCompositeOperation = "lighter";
      for (let bi = 0; bi < bands; bi++) {
        const R = rIn + ((rOut - rIn) * (bi + 0.5)) / bands;
        ctx.lineWidth = ((rOut - rIn) / bands) * q * 2.3 + 1.2;
        ctx.lineCap = "round";
        for (let si = 0; si < segs; si++) {
          const th0 = (si / segs) * Math.PI * 2, th1 = ((si + 1) / segs) * Math.PI * 2;
          const mid = (th0 + th1) / 2;
          const sFront = Math.sin(mid) > 0;
          if (sFront !== front) continue;
          const [col, a] = diskColor(R, mid);
          if (a < 0.01) continue;
          ctx.strokeStyle = rgba(col, a);
          ctx.beginPath();
          ctx.ellipse(px, py, R, R * q, 0, th0, th1 + 0.03);
          ctx.stroke();
        }
      }
      ctx.lineCap = "butt";
      ctx.globalCompositeOperation = "source-over";
    };

    // ambient glow
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(px, py, rs * 2, px, py, rOut * 1.8);
    glow.addColorStop(0, "rgba(255,150,80,0.22)");
    glow.addColorStop(1, "rgba(255,90,40,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(px, py, rOut * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    drawHalf(false);

    // lensed image of the far-side disk, bent over the top and under the shadow (pseudo ray-march)
    ctx.globalCompositeOperation = "lighter";
    const lensBands = 5;
    for (let bi = 0; bi < lensBands; bi++) {
      const R = rIn + ((rOut - rIn) * (bi + 0.5)) / lensBands;
      const rl = rs * 2.75 + (R - rIn) * 0.22;
      ctx.lineWidth = rs * 0.35 + 0.5;
      for (let si = 0; si < segs; si++) {
        const th0 = (si / segs) * Math.PI * 2, th1 = ((si + 1) / segs) * Math.PI * 2;
        const mid = (th0 + th1) / 2;
        const [col, a] = diskColor(R, mid);
        const vertical = Math.abs(Math.sin(mid));
        ctx.strokeStyle = rgba(col, Math.min(1, a * (0.4 + 0.9 * vertical) * 1.6));
        ctx.beginPath();
        ctx.ellipse(px, py, rl, rl * 0.96, 0, th0, th1 + 0.02);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";

    // event horizon shadow (≈2.6 rs critical impact parameter)
    const sh = ctx.createRadialGradient(px, py, rs * 2.2, px, py, rs * 2.75);
    sh.addColorStop(0, "#000");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.arc(px, py, rs * 2.75, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.arc(px, py, rs * 2.3, 0, Math.PI * 2); ctx.fill();
    // photon ring
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,225,190,0.8)";
    ctx.lineWidth = Math.max(0.8, rs * 0.12);
    ctx.beginPath(); ctx.arc(px, py, rs * 2.6, 0, Math.PI * 2); ctx.stroke();
    ctx.globalCompositeOperation = "source-over";

    drawHalf(true);

    // relativistic jets for heavy, fast-spinning holes
    if (b.m > 2000 && rs > 3) {
      ctx.globalCompositeOperation = "lighter";
      for (const dir of [-1, 1]) {
        const g = ctx.createLinearGradient(px, py, px, py + dir * rs * 26);
        g.addColorStop(0, "rgba(140,210,255,0.16)");
        g.addColorStop(1, "rgba(140,210,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(px - rs * 0.3, py);
        ctx.lineTo(px - rs * 0.9, py + dir * rs * 26);
        ctx.lineTo(px + rs * 0.9, py + dir * rs * 26);
        ctx.lineTo(px + rs * 0.3, py);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
    void c;
  }

  private drawFlashes(cam: Camera, dt: number) {
    const { ctx, W, H } = this;
    ctx.globalCompositeOperation = "lighter";
    for (const f of this.flashes) {
      f.t += dt;
      const px = (f.x - cam.x) * cam.zoom + W / 2, py = (f.y - cam.y) * cam.zoom + H / 2;
      const R = f.r * cam.zoom * (0.3 + f.t * 1.6);
      const a = Math.max(0, 1 - f.t / 1.6);
      const g = ctx.createRadialGradient(px, py, 0, px, py, Math.max(R, 1));
      g.addColorStop(0, rgba(f.c, 0.9 * a));
      g.addColorStop(0.3, rgba(f.c, 0.3 * a));
      g.addColorStop(1, rgba(f.c, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, Math.max(R, 1), 0, Math.PI * 2); ctx.fill();
    }
    this.flashes = this.flashes.filter((f) => f.t < 1.6);
    // gravitational-wave wavefront glow
    for (const r of this.ripples) {
      const px = (r.x - cam.x) * cam.zoom + W / 2, py = (r.y - cam.y) * cam.zoom + H / 2;
      const R = r.t * 260 * cam.zoom;
      const a = Math.max(0, 0.35 * Math.exp(-r.t * 0.3));
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = `rgba(120,220,255,${a / (k + 1)})`;
        ctx.lineWidth = 2 / (k + 1);
        ctx.beginPath(); ctx.arc(px, py, Math.max(1, R - k * 140 * cam.zoom), 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private drawOverlay(world: World, cam: Camera, ui: UiOverlay) {
    const { ctx, W, H } = this;
    const z = cam.zoom;
    const S = (x: number, y: number) => [(x - cam.x) * z + W / 2, (y - cam.y) * z + H / 2] as const;
    const mark = (id: string | null, style: string, dashed: boolean, brackets: boolean) => {
      if (!id) return;
      const b = world.bodies.find((q) => q.id === id);
      if (!b) return;
      const [px, py] = S(b.x, b.y);
      const vis = b.kind === "blackhole" ? b.r * 9.5 : b.r * (b.rings ? b.ringOuter : 1.3);
      const R = Math.max(vis * z + 8, 16);
      ctx.strokeStyle = style;
      ctx.lineWidth = 1.2;
      if (dashed) ctx.setLineDash([4, 6]);
      ctx.lineDashOffset = -this.t * 12;
      ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      if (brackets) {
        const k = R + 8, l = 10;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [sxn, syn] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.moveTo(px + sxn * k, py + syn * (k - l));
          ctx.lineTo(px + sxn * k, py + syn * k);
          ctx.lineTo(px + sxn * (k - l), py + syn * k);
        }
        ctx.stroke();
      }
      // velocity vector
      const v = Math.hypot(b.vx, b.vy);
      if (v > 0.01) {
        const L = Math.min(90, 14 + v * 5);
        const ex = px + (b.vx / v) * (R + L), ey = py + (b.vy / v) * (R + L);
        ctx.beginPath();
        ctx.moveTo(px + (b.vx / v) * R, py + (b.vy / v) * R);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, 2.5, 0, Math.PI * 2); ctx.fillStyle = style; ctx.fill();
      }
    };
    if (ui.hoverId && ui.hoverId !== ui.selectedId) mark(ui.hoverId, "rgba(255,255,255,0.25)", true, false);
    mark(ui.selectedId, "rgba(90,230,255,0.8)", true, ui.lockedId === ui.selectedId);
    if (ui.lockedId && ui.lockedId !== ui.selectedId) mark(ui.lockedId, "rgba(255,90,180,0.7)", false, true);

    // spawn slingshot preview with predicted trajectory
    const d = ui.drag;
    if (d) {
      const [ax, ay] = S(d.x0, d.y0);
      const [bx, by] = S(d.x1, d.y1);
      ctx.strokeStyle = "rgba(255,90,180,0.9)";
      ctx.fillStyle = "rgba(255,90,180,0.15)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ax, ay, Math.max(d.r * z, 4), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]);
      // predict
      let x = d.x0, y = d.y0;
      let vx = (d.x1 - d.x0) * 0.05, vy = (d.y1 - d.y0) * 0.05;
      const h = 0.05;
      ctx.strokeStyle = "rgba(90,230,255,0.55)";
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      for (let k = 0; k < 600; k++) {
        let gx = 0, gy = 0;
        let hit = false;
        for (const b of world.bodies) {
          const [ax2, ay2] = pnAccel(world.settings.G, b.m, b.x - x, b.y - y, vx - b.vx, vy - b.vy, world.settings.c, world.settings.pn);
          gx += ax2; gy += ay2;
          if (Math.hypot(b.x - x, b.y - y) < b.r) hit = true;
        }
        vx += gx * h; vy += gy * h; x += vx * h; y += vy * h;
        const [qx, qy] = S(x, y);
        ctx.lineTo(qx, qy);
        if (hit) break;
      }
      ctx.stroke();
    }
  }

  private drawFlares(stars: Body[], cam: Camera) {
    const { ctx, W, H } = this;
    const cx = W / 2, cy = H / 2;
    ctx.globalCompositeOperation = "lighter";
    for (const s of stars) {
      const px = (s.x - cam.x) * cam.zoom + cx, py = (s.y - cam.y) * cam.zoom + cy;
      if (px < -100 || py < -100 || px > W + 100 || py > H + 100) continue;
      const bright = Math.min(1, Math.sqrt(s.m / 5000)) * Math.min(1, 0.45 + cam.zoom * 0.5);
      const col = hexToRgb(s.color);
      const pr = Math.max(s.r * cam.zoom, 3);
      // anamorphic streak
      const L = Math.min(W * 0.6, pr * 22);
      const g = ctx.createLinearGradient(px - L, py, px + L, py);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.5, rgba(mix(col, [180, 220, 255], 0.5), 0.35 * bright));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(px - L, py - Math.max(1, pr * 0.06), L * 2, Math.max(2, pr * 0.12));
      // starburst spikes
      ctx.strokeStyle = rgba(mix(col, [255, 255, 255], 0.6), 0.22 * bright);
      ctx.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 4 + Math.PI / 8;
        const l = pr * 6;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(a) * l, py - Math.sin(a) * l);
        ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
        ctx.stroke();
      }
      // ghost array mirrored through the optical center
      const vx = cx - px, vy = cy - py;
      const ghosts: [number, number, RGB, number][] = [
        [0.35, 0.18, [90, 230, 255], 0.12],
        [0.7, 0.06, [255, 90, 180], 0.18],
        [1.15, 0.3, [255, 200, 110], 0.08],
        [1.5, 0.12, [120, 255, 200], 0.14],
        [1.85, 0.45, [90, 140, 255], 0.06],
      ];
      for (const [k, sz, gc, ga] of ghosts) {
        const gx = px + vx * k, gy = py + vy * k;
        const R = Math.max(8, Math.min(W, H) * sz * 0.25);
        const gg = ctx.createRadialGradient(gx, gy, R * 0.6, gx, gy, R);
        gg.addColorStop(0, rgba(gc, ga * bright * 0.4));
        gg.addColorStop(0.85, rgba(gc, ga * bright));
        gg.addColorStop(1, rgba(gc, 0));
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(gx, gy, R, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private vignette() {
    const { ctx, W, H } = this;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /** RGB channel split with radial scale offsets — real chromatic aberration. */
  private chromatic() {
    const { canvas, copy, tmp } = this;
    const cw = canvas.width, ch = canvas.height;
    const cctx = copy.getContext("2d")!;
    const tctx = tmp.getContext("2d")!;
    cctx.globalCompositeOperation = "copy";
    cctx.drawImage(canvas, 0, 0);
    const main = this.ctx;
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.globalCompositeOperation = "source-over";
    if (this.gl) main.clearRect(0, 0, cw, ch);
    else { main.fillStyle = "#000"; main.fillRect(0, 0, cw, ch); }
    const chans: [string, number][] = [["#ff0000", 1.0035], ["#00ff00", 1.0], ["#0000ff", 0.9965]];
    for (const [col, s] of chans) {
      tctx.globalCompositeOperation = "source-over";
      tctx.fillStyle = "#000";
      tctx.fillRect(0, 0, cw, ch); // opaque underlay so multiply can't tint transparent pixels
      tctx.drawImage(copy, 0, 0);
      tctx.globalCompositeOperation = "multiply";
      tctx.fillStyle = col;
      tctx.fillRect(0, 0, cw, ch);
      tctx.globalCompositeOperation = "destination-in";
      tctx.drawImage(copy, 0, 0);
      main.globalCompositeOperation = "lighter";
      const w = cw * s, h = ch * s;
      main.drawImage(tmp, (cw - w) / 2, (ch - h) / 2, w, h);
    }
    main.globalCompositeOperation = "source-over";
    main.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
}
