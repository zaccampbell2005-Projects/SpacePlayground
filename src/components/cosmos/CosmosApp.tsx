import { useCallback, useEffect, useRef, useState } from "react";
import {
  Atom,
  Circle,
  Crosshair,
  Disc3,
  Hammer,
  Images,
  Link2,
  Lock,
  MousePointer2,
  Pause,
  Play,
  Save,
  Sparkles,
  Sun,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  Orbit,
  Copy,
  UserRound,
  Pencil,
  Check,
  Gauge,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { GLBackdrop } from "@/cosmos/gl-backdrop";
import { useSessionUser } from "@/hooks/use-session";
import { AccountPanel } from "./AccountPanel";
import { toast } from "sonner";
import {
  type Body,
  type Composition,
  type Kind,
  World,
  circularVelocity,
  lorentzGamma,
  makeBody,
  schwarzschild,
  EARTH_MASS,
  JUPITER_MASS,
} from "@/cosmos/physics";
import { Renderer, defaultFx, type Camera, type FxSettings, type UiOverlay } from "@/cosmos/render";
import { CosmicAudio } from "@/cosmos/audio";
import { SCENARIOS, type ScenarioId, hydrate, loadScenario, serialize } from "@/cosmos/scenarios";
import { deleteUniverse, getUniverse, listUniverses, saveUniverse, updateUniverse, type UniverseRow } from "@/cosmos/universes";
import { ColorField, Panel, Slider, Stat, Toggle, fmt } from "./controls";

type Tool = "select" | Kind;
type PanelId = "forge" | "physics" | "fx" | "save" | "gallery" | "account" | null;
type Current = { id: string; name: string; ownerId: string | null } | null;

const COMPOSITIONS: { id: Composition; label: string }[] = [
  { id: "rocky", label: "Silicate" },
  { id: "iron", label: "Iron core" },
  { id: "ice", label: "Cryo-ice" },
  { id: "gas", label: "Gas giant" },
  { id: "lava", label: "Magma" },
];

const draftDefaults = (): Partial<Body> => ({
  name: "Nova Terra",
  m: 4 * EARTH_MASS,
  r: 11,
  composition: "rocky",
  color: "#3f9fc4",
  atmo: "#5cc8ff",
  atmoDensity: 0.6,
  elasticity: 0.4,
  friction: 0.3,
  rings: false,
  ringInner: 1.5,
  ringOuter: 2.4,
  ringTilt: 0.35,
});

export default function CosmosApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const user = useSessionUser();
  const [current, setCurrent] = useState<Current>(null);
  const [quality, setQuality] = useState<"full" | "reduced" | "low">("full");
  const [engine, setEngine] = useState<"webgl" | "canvas">("canvas");
  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World>(new World());
  const rendererRef = useRef<Renderer | null>(null);
  const camRef = useRef<Camera>({ x: 0, y: 0, zoom: 0.55 });
  const fxRef = useRef<FxSettings>(defaultFx());
  const uiRef = useRef<UiOverlay>({ selectedId: null, lockedId: null, hoverId: null, drag: null });
  const audioRef = useRef<CosmicAudio | null>(null);
  const toolRef = useRef<Tool>("select");
  const draftRef = useRef<Partial<Body>>(draftDefaults());

  const [, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lockedId, setLockedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [panel, setPanel] = useState<PanelId>(null);
  const [forgeMode, setForgeMode] = useState<"edit" | "draft">("draft");
  const [fx, setFx] = useState<FxSettings>(defaultFx());
  const [audioOn, setAudioOn] = useState(false);
  const [massUnit, setMassUnit] = useState<"earth" | "jupiter">("earth");
  const [orbitRadius, setOrbitRadius] = useState(380);
  const [ready, setReady] = useState(false);

  const rerender = useCallback(() => setTick((t) => t + 1), []);
  const world = worldRef.current;
  const S = world.settings;

  useEffect(() => { uiRef.current.selectedId = selectedId; }, [selectedId]);
  useEffect(() => { uiRef.current.lockedId = lockedId; }, [lockedId]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { fxRef.current = fx; }, [fx]);

  // ---------- boot: scenario or shared universe from ?u= ----------
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const id = new URLSearchParams(window.location.search).get("u");
    loadScenario(worldRef.current, "helios");
    if (id) {
      getUniverse(id)
        .then((row) => {
          if (!row) { toast.error("That shared universe could not be found"); return; }
          applyUniverse(row);
          toast.success(`Loaded “${row.name}”`);
        })
        .catch(() => toast.error("Couldn't load the shared universe"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- render loop ----------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = glRef.current ? GLBackdrop.create(glRef.current) : null;
    setEngine(gl ? "webgl" : "canvas");
    const renderer = new Renderer(canvas, gl);
    if (window.matchMedia("(pointer: coarse)").matches) renderer.maxDpr = 1.25;
    rendererRef.current = renderer;
    if (import.meta.env.DEV) (window as unknown as { __cosmos: unknown }).__cosmos = { world: worldRef, renderer, cam: camRef };
    const resize = () => renderer.resize(window.innerWidth, window.innerHeight);
    resize();
    window.addEventListener("resize", resize);
    let raf = 0;
    let last = performance.now();
    let first = true;
    // adaptive quality: watch a smoothed frame rate and shed detail when it stays low
    let fpsAvg = 60, slowFor = 0, fastFor = 0, level = 0;
    const applyLevel = (l: number) => {
      level = l;
      renderer.nebulaStride = [1, 2, 4][l];
      renderer.maxDpr = l === 0 ? (window.matchMedia("(pointer: coarse)").matches ? 1.25 : 1.5) : 1;
      resize();
      setQuality((["full", "reduced", "low"] as const)[l]);
    };
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!document.hidden && dt > 0) {
        fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
        if (fpsAvg < 32) { slowFor += dt; fastFor = 0; } else if (fpsAvg > 55) { fastFor += dt; slowFor = 0; } else { slowFor = 0; fastFor = 0; }
        if (slowFor > 2.5 && level < 2) { applyLevel(level + 1); slowFor = 0; }
        if (fastFor > 8 && level > 0) { applyLevel(level - 1); fastFor = 0; }
      }
      const w = worldRef.current;
      w.step(dt);
      const ui = uiRef.current;
      if (ui.lockedId) {
        const b = w.bodies.find((q) => q.id === ui.lockedId);
        if (b) { camRef.current.x = b.x; camRef.current.y = b.y; }
        else { ui.lockedId = null; setLockedId(null); }
      }
      if (ui.selectedId && !w.bodies.some((q) => q.id === ui.selectedId)) { ui.selectedId = null; setSelectedId(null); }
      renderer.handleEvents(w, (kind, intensity, m) => {
        const a = audioRef.current;
        if (!a) return;
        if (kind === "chirp") a.chirp(); else a.chime(intensity, m);
      });
      renderer.draw(w, dt, camRef.current, fxRef.current, ui);
      if (first) { first = false; setReady(true); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const hud = window.setInterval(() => setTick((t) => t + 1), 200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(hud);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ---------- camera helpers ----------
  const toWorld = (sx: number, sy: number) => {
    const c = camRef.current;
    return [c.x + (sx - window.innerWidth / 2) / c.zoom, c.y + (sy - window.innerHeight / 2) / c.zoom] as const;
  };
  const pick = (sx: number, sy: number) => {
    const c = camRef.current;
    const [wx, wy] = toWorld(sx, sy);
    let best: Body | null = null;
    let bd = Infinity;
    for (const b of worldRef.current.bodies) {
      const vis = b.kind === "blackhole" ? b.r * 8 : b.r * (b.rings ? b.ringOuter : 1.2);
      const d = Math.hypot(b.x - wx, b.y - wy) * c.zoom;
      const lim = Math.max(vis * c.zoom, 6) + 10;
      if (d < lim && d < bd) { bd = d; best = b; }
    }
    return best;
  };
  const zoomBy = (factor: number, sx?: number, sy?: number) => {
    const c = camRef.current;
    const next = Math.min(12, Math.max(0.04, c.zoom * factor));
    if (uiRef.current.lockedId || sx === undefined || sy === undefined) { c.zoom = next; return; }
    const [wx, wy] = toWorld(sx, sy);
    c.zoom = next;
    c.x = wx - (sx - window.innerWidth / 2) / next;
    c.y = wy - (sy - window.innerHeight / 2) / next;
  };

  // wheel (non-passive so the page never scrolls/zooms)
  useEffect(() => {
    const el = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      zoomBy(Math.exp(-dy * 0.0015), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- pointer interactions ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ sx: number; sy: number; moved: boolean; pinch?: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer may already be released */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { sx: e.clientX, sy: e.clientY, moved: true, pinch: Math.hypot(a.x - b.x, a.y - b.y) };
      uiRef.current.drag = null;
      return;
    }
    gesture.current = { sx: e.clientX, sy: e.clientY, moved: false };
    const t = toolRef.current;
    if (t !== "select") {
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      const r = t === "star" ? 30 : t === "blackhole" ? schwarzschild(3000, worldRef.current.settings) : draftRef.current.r ?? 10;
      uiRef.current.drag = { x0: wx, y0: wy, x1: wx, y1: wy, r, kind: t };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (prev) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g?.pinch && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomBy(d / g.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      g.pinch = d;
      return;
    }
    if (!g || !prev) {
      const h = pick(e.clientX, e.clientY);
      uiRef.current.hoverId = h?.id ?? null;
      if (canvasRef.current) canvasRef.current.style.cursor = toolRef.current !== "select" ? "crosshair" : h ? "pointer" : "grab";
      return;
    }
    if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 4) g.moved = true;
    const d = uiRef.current.drag;
    if (d) {
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      // slingshot: drag backwards to launch forwards
      d.x1 = d.x0 - (wx - d.x0);
      d.y1 = d.y0 - (wy - d.y0);
      return;
    }
    if (g.moved && !uiRef.current.lockedId) {
      const c = camRef.current;
      c.x -= (e.clientX - prev.x) / c.zoom;
      c.y -= (e.clientY - prev.y) / c.zoom;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) return;
    gesture.current = null;
    const d = uiRef.current.drag;
    if (d) {
      uiRef.current.drag = null;
      spawnAt(d.kind, d.x0, d.y0, g?.moved ? [(d.x1 - d.x0) * 0.05, (d.y1 - d.y0) * 0.05] : null);
      return;
    }
    if (g && !g.moved) {
      const b = pick(e.clientX, e.clientY);
      setSelectedId(b?.id ?? null);
      if (b && panel === "forge") setForgeMode("edit");
    }
  };

  // ---------- actions ----------
  const spawnAt = (kind: Kind, x: number, y: number, vel: [number, number] | null) => {
    const w = worldRef.current;
    let b: Body;
    if (kind === "planet") b = makeBody({ ...draftRef.current, kind, x, y });
    else if (kind === "star") b = makeBody({ kind, x, y, name: `Star ${w.bodies.length + 1}`, m: 2500, r: 26, color: ["#ffcf6e", "#8fd3ff", "#ff9a6b"][Math.floor(Math.random() * 3)] });
    else { b = makeBody({ kind, x, y, name: `Singularity ${w.bodies.length + 1}`, m: 3000 }); b.r = schwarzschild(b.m, w.settings); }
    if (vel) { [b.vx, b.vy] = vel; }
    else {
      const host = w.dominantNear(x, y);
      if (host) [b.vx, b.vy] = circularVelocity(host, x, y, w.settings.G);
    }
    w.bodies.push(b);
    setSelectedId(b.id);
    audioRef.current?.chime(0.5, b.m);
  };

  const launchDraft = () => {
    const w = worldRef.current;
    const c = camRef.current;
    const host = w.dominantNear(c.x, c.y);
    const a = Math.random() * Math.PI * 2;
    const hx = host?.x ?? c.x, hy = host?.y ?? c.y;
    const x = hx + Math.cos(a) * orbitRadius, y = hy + Math.sin(a) * orbitRadius;
    const b = makeBody({ ...draftRef.current, kind: "planet", x, y });
    if (host) [b.vx, b.vy] = circularVelocity(host, x, y, w.settings.G);
    w.bodies.push(b);
    setSelectedId(b.id);
    setForgeMode("edit");
    audioRef.current?.chime(0.7, b.m);
    toast.success(`${b.name} launched into a ${orbitRadius}-unit orbit${host ? ` around ${host.name}` : ""}`);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    const w = worldRef.current;
    w.bodies = w.bodies.filter((b) => b.id !== selectedId);
    if (lockedId === selectedId) setLockedId(null);
    setSelectedId(null);
  };

  const toggleLock = () => {
    if (!selectedId) return;
    setLockedId((l) => (l === selectedId ? null : selectedId));
  };

  const toggleAudio = async () => {
    if (!audioRef.current) audioRef.current = new CosmicAudio();
    if (audioOn) { audioRef.current.stop(); setAudioOn(false); }
    else { await audioRef.current.start(); setAudioOn(true); }
  };

  const loadPreset = (id: ScenarioId) => {
    loadScenario(worldRef.current, id);
    setSelectedId(null);
    setLockedId(null);
    camRef.current = { x: 0, y: 0, zoom: id === "binary" ? 0.9 : 0.55 };
    window.history.replaceState(null, "", window.location.pathname);
    setCurrent(null);
    rerender();
  };

  const applyUniverse = (row: UniverseRow) => {
    hydrate(worldRef.current, row.universe_state);
    setCurrent({ id: row.id, name: row.name, ownerId: row.owner_id });
    if (row.universe_state.camera) camRef.current = { ...row.universe_state.camera };
    setSelectedId(null);
    setLockedId(null);
    const url = new URL(window.location.href);
    url.searchParams.set("u", row.id);
    window.history.replaceState(null, "", url.toString());
    rerender();
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); worldRef.current.settings.paused = !worldRef.current.settings.paused; rerender(); }
      else if (e.key === "Escape") { setSelectedId(null); setTool("select"); setPanel(null); }
      else if (e.key === "l" || e.key === "L") toggleLock();
      else if (e.key === "1") setTool("select");
      else if (e.key === "2") setTool("planet");
      else if (e.key === "3") setTool("star");
      else if (e.key === "4") setTool("blackhole");
      else if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      else if (e.key === "+" || e.key === "=") zoomBy(1.2);
      else if (e.key === "-") zoomBy(1 / 1.2);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selected = world.bodies.find((b) => b.id === selectedId) ?? null;

  return (
    <div ref={wrapRef} className="fixed inset-0 overflow-clip bg-void select-none" data-scene-ready={ready ? "true" : undefined}>
      <canvas ref={glRef} className="pointer-events-none absolute inset-0" aria-hidden />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { uiRef.current.hoverId = null; }}
        aria-label="Cosmos simulation canvas"
      />

      {/* brand + live metrics */}
      <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-2 sm:left-4 sm:top-4">
        <div className="glass pointer-events-auto px-4 py-3">
          <h1 className="font-display text-[15px] font-extrabold leading-none tracking-tight">
            <span className="neon-text">Quantum·Relativity</span> Cosmos
          </h1>
          <p className="label-mono mt-1.5">Astrophysics sandbox · RK4 · 1PN</p>
        </div>
        <div className="glass pointer-events-auto grid grid-cols-3 gap-x-4 px-4 py-2.5">
          <div><div className="label-mono">t</div><div className="readout">{fmt(world.time, 1)}s</div></div>
          <div><div className="label-mono">bodies</div><div className="readout">{world.bodies.length}</div></div>
          <div><div className="label-mono">zoom</div><div className="readout">{camRef.current.zoom.toFixed(2)}×</div></div>
        </div>
      </div>

      {/* tracking HUD */}
      {selected && <TrackingHud body={selected} world={world} locked={lockedId === selected.id} onLock={toggleLock} onDelete={removeSelected} onForge={() => { setPanel("forge"); setForgeMode("edit"); }} onClose={() => setSelectedId(null)} />}

      {/* right side panels */}
      <div className="pointer-events-none absolute right-2 top-2 bottom-20 flex w-[320px] max-w-[calc(100vw-1rem)] flex-col sm:right-4 sm:top-4 sm:bottom-24">
        {panel === "forge" && (
          <ForgePanel
            mode={selected && forgeMode === "edit" ? "edit" : "draft"}
            body={selected}
            draft={draftRef.current}
            massUnit={massUnit}
            setMassUnit={setMassUnit}
            orbitRadius={orbitRadius}
            setOrbitRadius={setOrbitRadius}
            onChange={rerender}
            onNewDraft={() => setForgeMode("draft")}
            onLaunch={launchDraft}
            onPlace={() => { setTool("planet"); toast("Drag on the canvas to slingshot your planet into place"); }}
            onClose={() => setPanel(null)}
            settings={S}
          />
        )}
        {panel === "physics" && (
          <Panel title="Unified Field Engine" icon={<Atom size={15} />} onClose={() => setPanel(null)} className="max-h-full">
            <div className="label-mono mb-1 mt-1">Scenarios</div>
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {SCENARIOS.map((s) => (
                <button key={s.id} onClick={() => loadPreset(s.id)} className="btn-ghost h-auto flex-col items-start py-2 text-left">
                  <span>{s.label}</span>
                  <span className="text-[10px] font-normal text-muted-foreground">{s.blurb}</span>
                </button>
              ))}
            </div>
            <Slider label="Time dilation (sim speed)" value={S.timeScale} min={0.1} max={8} step={0.1} display={`${S.timeScale.toFixed(1)}×`} onChange={(v) => { S.timeScale = v; rerender(); }} />
            <Slider label="Speed of light c" value={S.c} min={12} max={90} step={1} display={`${S.c} u/s`} onChange={(v) => { S.c = v; for (const b of world.bodies) if (b.kind === "blackhole") b.r = schwarzschild(b.m, S); rerender(); }} />
            <Toggle label="Post-Newtonian precession" hint="a = −GM/r² (1 + 3L²/r²c²) r̂" on={S.pn} onChange={(v) => { S.pn = v; rerender(); }} />
            <Toggle label="Gravitational wave emission" hint="Quadrupole dE/dt inspiral for black-hole pairs" on={S.gwBoost > 0} onChange={(v) => { S.gwBoost = v ? 800 : 0; rerender(); }} />
            {S.gwBoost > 0 && !S.realistic && <Slider label="GW coupling" value={S.gwBoost} min={10} max={3000} step={10} display={`${S.gwBoost}×`} onChange={(v) => { S.gwBoost = v; rerender(); }} />}
            <Toggle label="Hawking radiation" hint="dM/dt = −K/M² for isolated singularities" on={S.hawking} onChange={(v) => { S.hawking = v; rerender(); }} />
            {S.hawking && !S.realistic && <Slider label="Evaporation K" value={S.hawkingK} min={50} max={20000} step={50} display={fmt(S.hawkingK, 0)} onChange={(v) => { S.hawkingK = v; rerender(); }} />}
            <Toggle label="Real-world strength" hint="GW and Hawking at true strength — far too weak to see anything happen" on={S.realistic} onChange={(v) => { S.realistic = v; rerender(); }} />
            <Toggle label="Magnetohydrodynamics" hint="Stellar dipoles, Lorentz force, wind stripping" on={S.mhd} onChange={(v) => { S.mhd = v; rerender(); }} />
            <div className="mt-3 border-t border-border pt-2">
              <Stat label="Total energy" value={fmt(world.totalEnergy(), 0)} tone="cyan" />
              <Stat label="Integrator" value="RK4 · adaptive substeps" />
              <Stat label="Renderer" value={engine === "webgl" ? "WebGL + Canvas 2D" : "Canvas 2D"} />
              <Stat label="Detail" value={quality} tone={quality === "full" ? undefined : "amber"} />
            </div>
          </Panel>
        )}
        {panel === "fx" && (
          <Panel title="Cinematic Deck" icon={<Sparkles size={15} />} onClose={() => setPanel(null)}>
            {(
              [
                ["aberration", "Chromatic aberration", "RGB channel split toward the lens edge"],
                ["flare", "Lens flare arrays", "Anamorphic streaks + ghosts on bright stars"],
                ["motionBlur", "Velocity motion blur", "Streaks for debris, gas and fast bodies"],
                ["nebula", "Fluid nebulae", "Curl-noise gas displaced by moving bodies"],
                ["shadows", "Shadows & eclipses", "Ray-cast penumbra cones into the gas"],
                ["grid", "Spacetime mesh", "Gravity wells, GW ripples, Lorentz contraction"],
                ["trails", "Orbital trails", "Recent path history"],
              ] as const
            ).map(([k, label, hint]) => (
              <Toggle key={k} label={label} hint={hint} on={fx[k]} onChange={(v) => setFx((f) => ({ ...f, [k]: v }))} />
            ))}
          </Panel>
        )}
        {panel === "save" && <SavePanel user={user} current={current} setCurrent={setCurrent} onSignIn={() => setPanel("account")} onClose={() => setPanel(null)} getState={() => serialize(world, { ...camRef.current })} />}
        {panel === "gallery" && <GalleryPanel user={user} current={current} setCurrent={setCurrent} onClose={() => setPanel(null)} onLoad={(row) => { applyUniverse(row); toast.success(`Loaded “${row.name}”`); }} />}
        {panel === "account" && <AccountPanel user={user} onClose={() => setPanel(null)} />}
      </div>

      {/* bottom dock */}
      <nav className="glass panel-scroll absolute bottom-3 left-1/2 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto p-1.5 sm:bottom-4" aria-label="Tools">
        <button className="dock-btn" onClick={() => { S.paused = !S.paused; rerender(); }} aria-label={S.paused ? "Play" : "Pause"}>
          {S.paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <span className="mx-1 h-6 w-px bg-border" />
        <button className="dock-btn" data-active={tool === "select"} onClick={() => setTool("select")} title="Select (1)"><MousePointer2 size={16} /></button>
        <button className="dock-btn" data-active={tool === "planet"} onClick={() => setTool("planet")} title="Place planet (2)"><Circle size={16} /><span className="hidden sm:inline">Planet</span></button>
        <button className="dock-btn" data-active={tool === "star"} onClick={() => setTool("star")} title="Place star (3)"><Sun size={16} /><span className="hidden sm:inline">Star</span></button>
        <button className="dock-btn" data-active={tool === "blackhole"} onClick={() => setTool("blackhole")} title="Place black hole (4)"><Disc3 size={16} /><span className="hidden sm:inline">Singularity</span></button>
        <span className="mx-1 h-6 w-px bg-border" />
        <button className="dock-btn" data-tone="pink" data-active={panel === "forge"} onClick={() => { setPanel(panel === "forge" ? null : "forge"); setForgeMode(selected?.kind ? "edit" : "draft"); }} title="Celestial Forge"><Hammer size={16} /><span className="hidden whitespace-nowrap md:inline">Design Planet</span></button>
        <button className="dock-btn" data-active={panel === "physics"} onClick={() => setPanel(panel === "physics" ? null : "physics")} title="Physics"><Atom size={16} /></button>
        <button className="dock-btn" data-active={panel === "fx"} onClick={() => setPanel(panel === "fx" ? null : "fx")} title="Post-processing"><Sparkles size={16} /></button>
        <button className="dock-btn" data-active={audioOn} onClick={toggleAudio} title="Cosmic audio">{audioOn ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
        <span className="mx-1 h-6 w-px bg-border" />
        <button className="dock-btn" data-active={panel === "save"} onClick={() => setPanel(panel === "save" ? null : "save")} title="Save universe"><Save size={16} /></button>
        <button className="dock-btn" data-active={panel === "gallery"} onClick={() => setPanel(panel === "gallery" ? null : "gallery")} title="Saved universes"><Images size={16} /></button>
        <button className="dock-btn" data-tone="pink" data-active={panel === "account" || !!user} onClick={() => setPanel(panel === "account" ? null : "account")} title={user ? "Account" : "Sign in"}><UserRound size={16} /></button>
      </nav>

      {tool !== "select" && (
        <div className="glass pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 px-3 py-1.5 text-[11px] text-muted-foreground animate-float-in">
          Click to drop into orbit · drag back to slingshot · <span className="text-neon-cyan">Esc</span> to exit
        </div>
      )}
      {quality !== "full" && <div className="glass pointer-events-none absolute right-4 bottom-4 hidden items-center gap-1.5 px-2.5 py-1.5 label-mono text-neon-amber sm:flex"><Gauge size={12} /> Detail {quality}</div>}
      {S.paused && <div className="glass pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 px-3 py-1.5 label-mono text-neon-amber">Time frozen</div>}
    </div>
  );
}

// ================= Tracking HUD =================
function TrackingHud({ body: b, world, locked, onLock, onDelete, onForge, onClose }: {
  body: Body; world: World; locked: boolean; onLock: () => void; onDelete: () => void; onForge: () => void; onClose: () => void;
}) {
  const S = world.settings;
  const v = Math.hypot(b.vx, b.vy);
  const beta = v / S.c;
  const gamma = lorentzGamma(v, S.c);
  const host = world.dominantNear(b.x, b.y);
  const dist = host && host !== b ? Math.hypot(host.x - b.x, host.y - b.y) : null;
  const massLabel = b.kind === "planet" ? (b.m >= JUPITER_MASS * 0.1 ? `${fmt(b.m / JUPITER_MASS)} M♃` : `${fmt(b.m / EARTH_MASS)} M⊕`) : `${fmt(b.m, 0)} u`;
  return (
    <Panel
      title={b.name}
      icon={b.kind === "blackhole" ? <Disc3 size={15} /> : b.kind === "star" ? <Sun size={15} /> : <Orbit size={15} />}
      onClose={onClose}
      className="absolute bottom-20 left-2 max-h-[55vh] w-[290px] max-w-[calc(100vw-1rem)] sm:bottom-24 sm:left-4"
    >
      <div className="label-mono -mt-1 mb-2 text-neon-pink">{b.kind === "blackhole" ? "Schwarzschild singularity" : b.kind === "star" ? "Main-sequence star" : `${b.composition} world`}</div>
      <Stat label="Mass" value={massLabel} />
      <Stat label={b.kind === "blackhole" ? "Event horizon rₛ" : "Mean radius"} value={`${fmt(b.r)} u`} />
      <Stat label="Speed |v|" value={`${fmt(v)} u/s`} />
      <Stat label="β = v/c" value={fmt(beta, 3)} tone={beta > 0.3 ? "pink" : "cyan"} />
      <Stat label="Lorentz γ" value={fmt(gamma, 4)} tone={gamma > 1.05 ? "pink" : undefined} />
      {dist !== null && host && <Stat label={`r → ${host.name}`} value={`${fmt(dist, 0)} u`} />}
      {b.kind === "blackhole" && (
        <>
          <Stat label="Hawking T ∝ 1/M" value={fmt(1000 / b.m, 3)} tone="amber" />
          <Stat label="GW dE/dt" value={b.gwPower ? fmt(b.gwPower, 3) : "—"} tone="cyan" />
          <Stat label="State" value={b.isolated ? "Isolated · evaporating" : "Accreting"} />
        </>
      )}
      {b.kind === "star" && <Stat label="Magnetic dipole μ" value={fmt(b.magnet)} tone="amber" />}
      {b.kind === "planet" && <Stat label="Atmosphere τ" value={fmt(b.atmoDensity)} />}
      <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-1.5">
        <button className="btn-ghost" data-active={locked} onClick={onLock}>
          {locked ? <Lock size={14} /> : <Crosshair size={14} />} {locked ? "Camera locked" : "Lock camera"}
        </button>
        <button className="btn-ghost" onClick={onForge} aria-label="Edit in forge"><Hammer size={14} /></button>
        <button className="btn-ghost" onClick={onDelete} aria-label="Delete body"><Trash2 size={14} /></button>
      </div>
      {locked && <p className="mt-2 flex items-center gap-1 text-[10.5px] text-muted-foreground"><Unlock size={11} /> Press L to release · scroll to orbit-zoom</p>}
    </Panel>
  );
}

// ================= Celestial Forge =================
function ForgePanel({ mode, body, draft, massUnit, setMassUnit, orbitRadius, setOrbitRadius, onChange, onNewDraft, onLaunch, onPlace, onClose, settings }: {
  mode: "edit" | "draft";
  body: Body | null;
  draft: Partial<Body>;
  massUnit: "earth" | "jupiter";
  setMassUnit: (u: "earth" | "jupiter") => void;
  orbitRadius: number;
  setOrbitRadius: (n: number) => void;
  onChange: () => void;
  onNewDraft: () => void;
  onLaunch: () => void;
  onPlace: () => void;
  onClose: () => void;
  settings: World["settings"];
}) {
  const t: Partial<Body> = mode === "edit" && body ? body : draft;
  const kind = mode === "edit" && body ? body.kind : "planet";
  const set = <K extends keyof Body>(k: K, v: Body[K]) => {
    (t as Body)[k] = v;
    if (kind === "blackhole" && k === "m" && body) body.r = schwarzschild(body.m, settings);
    onChange();
  };
  const unit = massUnit === "earth" ? EARTH_MASS : JUPITER_MASS;
  const m = t.m ?? EARTH_MASS;

  return (
    <Panel title="Celestial Forge" icon={<Hammer size={15} />} onClose={onClose} className="max-h-full">
      <div className="mb-2 flex items-center justify-between">
        <span className="label-mono text-neon-pink">{mode === "edit" ? `Editing · ${kind}` : "New planet blueprint"}</span>
        {mode === "edit" && <button className="chip" onClick={onNewDraft}>+ New design</button>}
      </div>
      <label className="block py-1.5">
        <span className="label-mono">Designation</span>
        <input className="field-input mt-1.5" value={t.name ?? ""} maxLength={32} onChange={(e) => set("name", e.target.value)} />
      </label>

      {kind === "planet" && (
        <>
          <div className="mt-1 flex items-center justify-between">
            <span className="label-mono">Baryonic mass scale</span>
            <div className="flex gap-1">
              <button className="chip" data-active={massUnit === "earth"} onClick={() => setMassUnit("earth")}>M⊕</button>
              <button className="chip" data-active={massUnit === "jupiter"} onClick={() => setMassUnit("jupiter")}>M♃</button>
            </div>
          </div>
          <Slider
            label="Baryonic mass"
            value={Math.log10(m / unit)}
            min={massUnit === "earth" ? -1.3 : -2}
            max={massUnit === "earth" ? 2.5 : 0.5}
            step={0.01}
            display={`${fmt(m / unit)} ${massUnit === "earth" ? "M⊕" : "M♃"}`}
            onChange={(v) => set("m", Math.pow(10, v) * unit)}
          />
          <Slider label="Mean radius" value={t.r ?? 10} min={3} max={60} step={0.5} display={`${fmt(t.r ?? 10, 1)} u`} onChange={(v) => set("r", v)} />
          <Slider label="Surface elasticity" value={t.elasticity ?? 0.4} min={0} max={1} onChange={(v) => set("elasticity", v)} />
          <Slider label="Surface friction" value={t.friction ?? 0.3} min={0} max={1} onChange={(v) => set("friction", v)} />

          <div className="label-mono mt-2 mb-1.5">Core composition</div>
          <div className="flex flex-wrap gap-1.5">
            {COMPOSITIONS.map((c) => (
              <button key={c.id} className="chip" data-active={t.composition === c.id} onClick={() => set("composition", c.id)}>{c.label}</button>
            ))}
          </div>
          <ColorField label="Surface albedo tint" value={t.color ?? "#3f9fc4"} onChange={(v) => set("color", v)} />

          <div className="mt-2 border-t border-border pt-2">
            <ColorField label="Rayleigh rim color" value={t.atmo ?? "#5cc8ff"} onChange={(v) => set("atmo", v)} />
            <Slider label="Scattering coefficient β_R" value={t.atmoDensity ?? 0.5} min={0} max={1} onChange={(v) => set("atmoDensity", v)} />
          </div>

          <div className="mt-2 border-t border-border pt-2">
            <Toggle label="Aerosol / ring system" hint="Particles on local Keplerian orbits" on={!!t.rings} onChange={(v) => set("rings", v)} />
            {t.rings && (
              <>
                <Slider label="Inner radius" value={t.ringInner ?? 1.5} min={1.1} max={3} display={`${fmt(t.ringInner ?? 1.5)} R`} onChange={(v) => set("ringInner", Math.min(v, (t.ringOuter ?? 2.4) - 0.1))} />
                <Slider label="Outer radius" value={t.ringOuter ?? 2.4} min={1.3} max={4.5} display={`${fmt(t.ringOuter ?? 2.4)} R`} onChange={(v) => set("ringOuter", Math.max(v, (t.ringInner ?? 1.5) + 0.1))} />
                <Slider label="Ring plane tilt" value={t.ringTilt ?? 0.35} min={-1.2} max={1.2} display={`${fmt(((t.ringTilt ?? 0) * 180) / Math.PI, 0)}°`} onChange={(v) => set("ringTilt", v)} />
              </>
            )}
          </div>
        </>
      )}

      {kind === "star" && (
        <>
          <Slider label="Stellar mass" value={m} min={200} max={12000} step={50} display={`${fmt(m, 0)} u`} onChange={(v) => set("m", v)} />
          <Slider label="Photosphere radius" value={t.r ?? 30} min={10} max={80} step={1} onChange={(v) => set("r", v)} display={`${fmt(t.r ?? 30, 0)} u`} />
          <Slider label="Magnetic dipole μ" value={t.magnet ?? 1} min={0} max={3} onChange={(v) => set("magnet", v)} />
          <ColorField label="Spectral color" value={t.color ?? "#ffcf6e"} onChange={(v) => set("color", v)} />
        </>
      )}

      {kind === "blackhole" && (
        <>
          <Slider label="Singularity mass" value={m} min={20} max={15000} step={10} display={`${fmt(m, 0)} u`} onChange={(v) => set("m", v)} />
          <Toggle label="Prograde disk spin" hint="Flips which side is Doppler-boosted" on={(t.spin ?? 1) > 0} onChange={(v) => set("spin", v ? 1 : -1)} />
        </>
      )}

      {mode === "draft" && (
        <div className="mt-3 border-t border-border pt-3">
          <Slider label="Launch orbit radius" value={orbitRadius} min={80} max={1400} step={10} display={`${orbitRadius} u`} onChange={setOrbitRadius} />
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button className="btn-neon" onClick={onLaunch}><Orbit size={14} /> Launch</button>
            <button className="btn-ghost" onClick={onPlace}><Crosshair size={14} /> Place by hand</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ================= Save / Gallery =================
type SaveProps = {
  user: User | null;
  current: Current;
  setCurrent: (c: Current) => void;
  onSignIn: () => void;
  onClose: () => void;
  getState: () => ReturnType<typeof serialize>;
};
function SavePanel({ user, current, setCurrent, onSignIn, onClose, getState }: SaveProps) {
  const own = !!user && current?.ownerId === user.id;
  const [name, setName] = useState(own ? current!.name : "");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const share = (id: string) => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("u", id);
    window.history.replaceState(null, "", url.toString());
    setLink(url.toString());
  };
  const saveNew = async () => {
    setBusy(true);
    try {
      const id = await saveUniverse(name || "Untitled universe", getState(), user?.id ?? null);
      setCurrent({ id, name: name || "Untitled universe", ownerId: user?.id ?? null });
      share(id);
      toast.success("Universe archived to the cloud");
    } catch {
      toast.error("Couldn't save this universe — please try again");
    } finally { setBusy(false); }
  };
  const overwrite = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await updateUniverse(current.id, { name: name || current.name, state: getState() });
      setCurrent({ ...current, name: name || current.name });
      share(current.id);
      toast.success("Snapshot updated — the share link now shows this state");
    } catch {
      toast.error("Couldn't update this universe");
    } finally { setBusy(false); }
  };
  return (
    <Panel title="Archive Universe" icon={<Save size={15} />} onClose={onClose}>
      <p className="mb-2 text-[12px] text-muted-foreground">Freeze every body, orbit and physical constant into a shareable snapshot.</p>
      <input className="field-input" placeholder="e.g. Kepler's fever dream" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && (own ? overwrite() : saveNew())} />
      {own ? (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button className="btn-neon" disabled={busy} onClick={overwrite}>{busy ? "Saving…" : "Update snapshot"}</button>
          <button className="btn-ghost" disabled={busy} onClick={saveNew}>Save as new</button>
        </div>
      ) : (
        <button className="btn-neon mt-2 w-full" disabled={busy} onClick={saveNew}>{busy ? "Saving…" : "Save snapshot"}</button>
      )}
      {!user && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Saving as a guest — you won't be able to edit or delete it later.{" "}
          <button className="text-neon-cyan underline-offset-2 hover:underline" onClick={onSignIn}>Sign in</button> to own your universes.
        </p>
      )}
      {link && (
        <div className="mt-3 rounded-lg border border-border p-2.5">
          <div className="label-mono mb-1 flex items-center gap-1"><Link2 size={11} /> Share link</div>
          <div className="readout truncate text-[11px] text-neon-cyan">{link}</div>
          <button className="btn-ghost mt-2 w-full" onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copied"); }}><Copy size={13} /> Copy link</button>
        </div>
      )}
    </Panel>
  );
}

function GalleryPanel({ user, current, setCurrent, onClose, onLoad }: { user: User | null; current: Current; setCurrent: (c: Current) => void; onClose: () => void; onLoad: (r: UniverseRow) => void }) {
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [rows, setRows] = useState<UniverseRow[] | null>(null);
  const [err, setErr] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const load = useCallback(() => {
    setRows(null);
    setErr(false);
    listUniverses(tab === "mine" && user ? user.id : undefined).then(setRows).catch(() => setErr(true));
  }, [tab, user]);
  useEffect(load, [load]);
  const rename = async (r: UniverseRow) => {
    try {
      await updateUniverse(r.id, { name: draftName });
      setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, name: draftName.trim() || x.name } : x)) ?? null);
      if (current?.id === r.id) setCurrent({ ...current, name: draftName });
      setEditing(null);
    } catch { toast.error("Couldn't rename"); }
  };
  const remove = async (r: UniverseRow) => {
    if (!window.confirm(`Delete “${r.name}”? Its share link will stop working.`)) return;
    try {
      await deleteUniverse(r.id);
      setRows((rs) => rs?.filter((x) => x.id !== r.id) ?? null);
      if (current?.id === r.id) setCurrent(null);
      toast.success("Universe deleted");
    } catch { toast.error("Couldn't delete"); }
  };
  return (
    <Panel title="Universe Gallery" icon={<Images size={15} />} onClose={onClose} className="max-h-full">
      {user && (
        <div className="mb-2 flex gap-1">
          <button className="chip" data-active={tab === "all"} onClick={() => setTab("all")}>Everyone</button>
          <button className="chip" data-active={tab === "mine"} onClick={() => setTab("mine")}>Mine</button>
        </div>
      )}
      {err && <p className="text-[12px] text-destructive">Couldn't reach the archive.</p>}
      {!rows && !err && <p className="label-mono">Scanning the multiverse…</p>}
      {rows?.length === 0 && <p className="text-[12px] text-muted-foreground">{tab === "mine" ? "You haven't saved any universes yet." : "No saved universes yet. Be the first."}</p>}
      <div className="flex flex-col gap-1.5">
        {rows?.map((r) => {
          const counts = { star: 0, planet: 0, blackhole: 0 };
          (r.universe_state?.bodies ?? []).forEach((b) => { counts[b.kind]++; });
          const mine = !!user && r.owner_id === user.id;
          return (
            <div key={r.id} className="group rounded-lg border border-border p-2.5 transition hover:border-neon-cyan">
              {editing === r.id ? (
                <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); rename(r); }}>
                  <input className="field-input h-8" autoFocus value={draftName} maxLength={80} onChange={(e) => setDraftName(e.target.value)} />
                  <button className="btn-ghost h-8" aria-label="Save name"><Check size={13} /></button>
                </form>
              ) : (
                <button onClick={() => onLoad(r)} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold group-hover:text-neon-cyan">{r.name}</span>
                    <span className="label-mono shrink-0">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="mt-1 flex gap-3 readout text-[10.5px] text-muted-foreground">
                    <span>☉ {counts.star}</span><span>◍ {counts.planet}</span><span>● {counts.blackhole}</span>
                    {mine && <span className="text-neon-pink">yours</span>}
                  </div>
                </button>
              )}
              {mine && editing !== r.id && (
                <div className="mt-2 flex gap-1">
                  <button className="chip flex items-center gap-1" onClick={() => { setEditing(r.id); setDraftName(r.name); }}><Pencil size={11} /> Rename</button>
                  <button className="chip flex items-center gap-1" onClick={() => remove(r)}><Trash2 size={11} /> Delete</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
