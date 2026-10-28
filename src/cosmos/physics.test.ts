import { describe, expect, it } from "vitest";
import { World, makeBody, circularVelocity, schwarzschild, quadrupolePower } from "./physics";

describe("physics engine", () => {
  it("RK4 keeps a circular Newtonian orbit's energy stable", () => {
    const w = new World();
    w.settings.pn = false;
    const sun = makeBody({ kind: "star", x: 0, y: 0, m: 5000, r: 30 });
    const p = makeBody({ kind: "planet", x: 300, y: 0, m: 1, r: 5 });
    [p.vx, p.vy] = circularVelocity(sun, p.x, p.y, 1);
    w.bodies.push(sun, p);
    const e0 = w.totalEnergy();
    for (let i = 0; i < 600; i++) w.step(1 / 60);
    expect(Math.abs((w.totalEnergy() - e0) / e0)).toBeLessThan(1e-4);
    expect(Math.hypot(p.x - sun.x, p.y - sun.y)).toBeCloseTo(300, -1);
  });

  it("binary black holes inspiral via GW emission and coalesce with a ripple event", () => {
    const w = new World();
    w.settings.gwBoost = 3000;
    w.settings.hawking = false;
    const m = 4000, sep = 120;
    const a = makeBody({ kind: "blackhole", x: -sep / 2, y: 0, m });
    const b = makeBody({ kind: "blackhole", x: sep / 2, y: 0, m });
    a.r = b.r = schwarzschild(m, w.settings);
    const v = Math.sqrt((2 * m) / sep) / 2;
    a.vy = -v; b.vy = v;
    w.bodies.push(a, b);
    for (let i = 0; i < 60 * 120 && w.bodies.length > 1; i++) w.step(1 / 60);
    expect(w.bodies.length).toBe(1);
    expect(w.events.some((e) => e.type === "bhmerge")).toBe(true);
    expect(w.bodies[0].m).toBeCloseTo(2 * m * 0.95);
  });

  it("quadrupole power scales as r^-5", () => {
    expect(quadrupolePower(1, 30, 10, 10, 10) / quadrupolePower(1, 30, 10, 10, 20)).toBeCloseTo(32);
  });

  it("isolated black holes evaporate via Hawking radiation", () => {
    const w = new World();
    const bh = makeBody({ kind: "blackhole", x: 0, y: 0, m: 30 });
    w.bodies.push(bh);
    for (let i = 0; i < 60 * 30 && w.bodies.length; i++) w.step(1 / 60);
    expect(w.bodies.length).toBe(0);
    expect(w.events.some((e) => e.type === "evaporate")).toBe(true);
  });
});

describe("real-world strength switch", () => {
  it("keeps a black-hole binary from visibly inspiralling and stops evaporation", () => {
    const w = new World();
    w.settings.realistic = true;
    const m = 4000, sep = 260;
    const a = makeBody({ kind: "blackhole", x: -sep / 2, y: 0, m });
    const b = makeBody({ kind: "blackhole", x: sep / 2, y: 0, m });
    a.r = b.r = schwarzschild(m, w.settings);
    const v = Math.sqrt((2 * m) / sep) / 2;
    a.vy = -v; b.vy = v;
    const lone = makeBody({ kind: "blackhole", x: 50000, y: 0, m: 30 });
    w.bodies.push(a, b, lone);
    for (let i = 0; i < 60 * 90; i++) w.step(1 / 60);
    expect(w.bodies.length).toBe(3);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(200);
    expect(lone.m).toBeCloseTo(30, 3);
  });
});
