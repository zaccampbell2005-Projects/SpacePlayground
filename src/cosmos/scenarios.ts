import {
  type Body,
  type SimSettings,
  World,
  circularVelocity,
  defaultSettings,
  makeBody,
  schwarzschild,
  EARTH_MASS,
  JUPITER_MASS,
} from "./physics";

export type ScenarioId = "helios" | "binary" | "twins" | "void";

export const SCENARIOS: { id: ScenarioId; label: string; blurb: string }[] = [
  { id: "helios", label: "Helios System", blurb: "A star, six worlds, a distant singularity" },
  { id: "binary", label: "Binary Inspiral", blurb: "Two black holes radiating gravitational waves" },
  { id: "twins", label: "Twin Suns", blurb: "Circumbinary planets around a stellar pair" },
  { id: "void", label: "Empty Void", blurb: "A blank canvas of spacetime" },
];

function orbit(world: World, host: Body, r: number, angle: number, p: Partial<Body>) {
  const x = host.x + Math.cos(angle) * r;
  const y = host.y + Math.sin(angle) * r;
  const b = makeBody({ kind: "planet", x, y, ...p });
  [b.vx, b.vy] = circularVelocity(host, x, y, world.settings.G);
  return b;
}

export function loadScenario(world: World, id: ScenarioId) {
  world.bodies = [];
  world.events = [];
  world.time = 0;
  const s = world.settings;

  if (id === "helios") {
    const sun = makeBody({ kind: "star", x: 0, y: 0, name: "Helios", m: 6000, r: 36, color: "#ffcf6e", magnet: 1.2 });
    world.bodies.push(sun);
    world.bodies.push(
      orbit(world, sun, 110, 0.4, { name: "Ember", m: 0.6 * EARTH_MASS, r: 5, composition: "lava", color: "#d9542b", atmo: "#ff9a5c", atmoDensity: 0.3 }),
      orbit(world, sun, 190, 2.1, { name: "Thalassa", m: 1 * EARTH_MASS, r: 8, composition: "rocky", color: "#3a8fb7", atmo: "#5cc8ff", atmoDensity: 0.7 }),
      orbit(world, sun, 290, 4.2, { name: "Ferros", m: 0.8 * EARTH_MASS, r: 7, composition: "iron", color: "#9aa3ad", atmo: "#ffb36b", atmoDensity: 0.25 }),
      orbit(world, sun, 460, 1.0, { name: "Jovara", m: 0.9 * JUPITER_MASS * 0.1, r: 22, composition: "gas", color: "#d9a066", atmo: "#ffd59a", atmoDensity: 0.6 }),
      orbit(world, sun, 640, 3.4, { name: "Annulus", m: 40 * EARTH_MASS, r: 17, composition: "gas", color: "#c9b48a", atmo: "#ffe7b0", atmoDensity: 0.5, rings: true, ringInner: 1.4, ringOuter: 2.5, ringTilt: 0.4 }),
      orbit(world, sun, 820, 5.5, { name: "Glacius", m: 12 * EARTH_MASS, r: 12, composition: "ice", color: "#a7e3f2", atmo: "#7ef0ff", atmoDensity: 0.8 }),
    );
    const bh = makeBody({ kind: "blackhole", x: 2300, y: -900, name: "Erebus", m: 3500, spin: 1 });
    bh.r = schwarzschild(bh.m, s);
    world.bodies.push(bh);
  }

  if (id === "binary") {
    const m = 4000;
    const sep = 260;
    const a = makeBody({ kind: "blackhole", x: -sep / 2, y: 0, name: "Gemini A", m, spin: 1 });
    const b = makeBody({ kind: "blackhole", x: sep / 2, y: 0, name: "Gemini B", m, spin: -1 });
    const v = Math.sqrt((s.G * 2 * m) / sep) / 2;
    a.vy = -v; b.vy = v;
    a.r = schwarzschild(m, s); b.r = schwarzschild(m, s);
    world.bodies.push(a, b);
    // a far tracer star for scale
    const star = makeBody({ kind: "star", x: 0, y: 1400, name: "Witness", m: 300, r: 18, color: "#9fd8ff", magnet: 0.6 });
    star.vx = Math.sqrt((s.G * 2 * m) / 1400);
    world.bodies.push(star);
  }

  if (id === "twins") {
    const m = 3200;
    const sep = 160;
    const a = makeBody({ kind: "star", x: -sep / 2, y: 0, name: "Castor", m, r: 26, color: "#ffb35c", magnet: 1 });
    const b = makeBody({ kind: "star", x: sep / 2, y: 0, name: "Pollux", m, r: 24, color: "#8fd3ff", magnet: 0.8 });
    const v = Math.sqrt((s.G * 2 * m) / sep) / 2;
    a.vy = -v; b.vy = v;
    world.bodies.push(a, b);
    const bary = makeBody({ kind: "star", x: 0, y: 0, m: 2 * m });
    world.bodies.push(
      orbit(world, bary, 520, 0.3, { name: "Tatooine", m: 2 * EARTH_MASS, r: 10, composition: "rocky", color: "#c99a5b", atmo: "#ffc58a", atmoDensity: 0.4 }),
      orbit(world, bary, 780, 2.6, { name: "Mirage", m: 30 * EARTH_MASS, r: 16, composition: "gas", color: "#5fc4b0", atmo: "#7fffd4", atmoDensity: 0.7, rings: true }),
    );
  }
}

export interface UniverseState {
  version: 1;
  bodies: Omit<Body, "trail" | "isolated" | "gwPower">[];
  settings: SimSettings;
  time: number;
  camera?: { x: number; y: number; zoom: number };
}

export function serialize(world: World, camera?: { x: number; y: number; zoom: number }): UniverseState {
  return {
    version: 1,
    bodies: world.bodies.map(({ trail: _t, isolated: _i, gwPower: _g, ...rest }) => rest),
    settings: { ...world.settings },
    time: world.time,
    camera,
  };
}

export function hydrate(world: World, state: UniverseState) {
  world.settings = { ...defaultSettings(), ...state.settings };
  world.bodies = state.bodies.map((b) => ({ ...makeBody(b), ...b, trail: [] }));
  world.time = state.time ?? 0;
  world.events = [];
}
