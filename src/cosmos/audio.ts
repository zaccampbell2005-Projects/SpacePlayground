/** Procedural space drone + harmonic chimes via Web Audio. */
export class CosmicAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private chimeBus!: GainNode;
  private lfoTimer = 0;
  running = false;

  async start() {
    if (this.running) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = this.ctx ?? new Ctx();
    this.ctx = ctx;
    await ctx.resume();
    if (this.master) {
      this.master.gain.setTargetAtTime(0.55, ctx.currentTime, 1.2);
      this.running = true;
      return;
    }

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.master.gain.setTargetAtTime(0.55, ctx.currentTime, 2);

    // Reverb: synthetic exponentially-decaying noise impulse
    const reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 6;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    reverb.connect(wet).connect(this.master);

    // Long feedback delay
    const delay = ctx.createDelay(4);
    delay.delayTime.value = 1.35;
    const fb = ctx.createGain();
    fb.gain.value = 0.55;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = "lowpass";
    delayTone.frequency.value = 1800;
    delay.connect(delayTone).connect(fb).connect(delay);
    delay.connect(reverb);
    delay.connect(this.master);

    // Drone: detuned low oscillators -> resonant lowpass with LFO sweep
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    filter.Q.value = 6;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.16;
    filter.connect(droneGain);
    droneGain.connect(this.master);
    droneGain.connect(reverb);
    droneGain.connect(delay);

    const freqs = [55, 55.4, 82.4, 110.2, 164.8];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? "sawtooth" : "triangle";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i < 2 ? 0.5 : 0.18;
      // slow amplitude breathing per voice
      const amp = ctx.createOscillator();
      amp.frequency.value = 0.03 + i * 0.017;
      const ampDepth = ctx.createGain();
      ampDepth.gain.value = 0.12;
      amp.connect(ampDepth).connect(g.gain);
      o.connect(g).connect(filter);
      o.start();
      amp.start();
    });

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 260;
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start();

    this.chimeBus = ctx.createGain();
    this.chimeBus.gain.value = 0.5;
    this.chimeBus.connect(reverb);
    this.chimeBus.connect(delay);
    this.chimeBus.connect(this.master);
    this.running = true;
  }

  stop() {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    this.running = false;
  }

  /** Harmonic chime: pentatonic root chosen by mass, with inharmonic partials. */
  chime(intensity = 1, massHint = 100) {
    if (!this.running || !this.ctx) return;
    const now = performance.now();
    if (now - this.lfoTimer < 90) return;
    this.lfoTimer = now;
    const ctx = this.ctx;
    const scale = [0, 3, 5, 7, 10, 12, 15];
    const idx = Math.max(0, Math.min(scale.length - 1, Math.floor(6 - Math.log10(massHint + 1) * 1.6)));
    const root = 220 * Math.pow(2, scale[idx] / 12);
    const partials = [1, 2.01, 3.0, 4.17, 5.43];
    const t = ctx.currentTime;
    partials.forEach((p, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = root * p;
      const g = ctx.createGain();
      const peak = (0.22 * Math.min(intensity, 2)) / (i + 1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5 + 2 / (i + 1));
      o.connect(g).connect(this.chimeBus);
      o.start(t);
      o.stop(t + 5);
    });
  }

  /** Deep gravitational-wave chirp for black hole coalescence. */
  chirp() {
    if (!this.running || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(40, t);
    o.frequency.exponentialRampToValueAtTime(320, t + 0.9);
    o.frequency.exponentialRampToValueAtTime(30, t + 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    o.connect(g).connect(this.chimeBus);
    o.start(t);
    o.stop(t + 4);
    this.chime(1.6, 5);
  }
}
