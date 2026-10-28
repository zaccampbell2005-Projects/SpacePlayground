/**
 * WebGL layer for the heaviest drawing: thousands of nebula gas sprites
 * (screen-blended) and the parallax starfield. Simulation stays on the CPU;
 * this only uploads per-particle buffers each frame.
 */
const VS = `
attribute vec2 aPos; attribute float aSize; attribute vec4 aColor;
uniform vec2 uRes; varying vec4 vColor;
void main(){
  vec2 c = aPos / uRes * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  gl_PointSize = aSize;
  vColor = aColor;
}`;
const FS = `
precision mediump float; varying vec4 vColor; uniform float uHard;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float soft = exp(-d * 3.2) * (1.0 - d);
  float a = mix(soft, 1.0 - smoothstep(0.5, 1.0, d), uHard);
  gl_FragColor = vec4(vColor.rgb * vColor.a * a, 1.0);
}`;

const CVS = `attribute vec2 aP; varying vec2 vUv; void main(){ vUv = aP * 0.5 + 0.5; vUv.y = 1.0 - vUv.y; gl_Position = vec4(aP, 0.0, 1.0); }`;
const CFS = `
precision mediump float; varying vec2 vUv; uniform sampler2D uTex; uniform float uAb;
void main(){
  vec2 c = vUv - 0.5;
  vec4 r = texture2D(uTex, 0.5 + c * (1.0 - uAb));
  vec4 g = texture2D(uTex, vUv);
  vec4 b = texture2D(uTex, 0.5 + c * (1.0 + uAb));
  // premultiplied: each channel keeps its own coverage
  gl_FragColor = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`;

export class GLBackdrop {
  private cprog: WebGLProgram | null = null;
  private quad: WebGLBuffer | null = null;
  private tex: WebGLTexture | null = null;
  canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private buf: WebGLBuffer;
  private data = new Float32Array(0);
  private loc: { pos: number; size: number; color: number; res: WebGLUniformLocation | null; hard: WebGLUniformLocation | null };
  private dpr = 1;

  static create(canvas: HTMLCanvasElement) {
    try {
      const gl = canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false });
      if (!gl) return null;
      return new GLBackdrop(canvas, gl);
    } catch {
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link");
    this.prog = p;
    this.buf = gl.createBuffer()!;
    this.loc = {
      pos: gl.getAttribLocation(p, "aPos"),
      size: gl.getAttribLocation(p, "aSize"),
      color: gl.getAttribLocation(p, "aColor"),
      res: gl.getUniformLocation(p, "uRes"),
      hard: gl.getUniformLocation(p, "uHard"),
    };
  }

  /** Composite the 2D overlay canvas on top, with optional chromatic aberration (GPU). */
  composite(src: HTMLCanvasElement, aberration: number) {
    const gl = this.gl;
    if (!this.cprog) {
      const mk = (t: number, code: string) => { const sh = gl.createShader(t)!; gl.shaderSource(sh, code); gl.compileShader(sh); return sh; };
      const p = gl.createProgram()!;
      gl.attachShader(p, mk(gl.VERTEX_SHADER, CVS));
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, CFS));
      gl.linkProgram(p);
      this.cprog = p;
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const p = this.cprog;
    gl.useProgram(p);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    for (const l of [this.loc.size, this.loc.color]) gl.disableVertexAttribArray(l);
    const aP = gl.getAttribLocation(p, "aP");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(aP);
    gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(gl.getUniformLocation(p, "uAb"), aberration);
    gl.uniform1i(gl.getUniformLocation(p, "uTex"), 0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  begin() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.012, 0.016, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    // screen blend: 1 - (1-src)(1-dst)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
  }

  /** points: [x, y, sizePx, r, g, b, a] per point, CSS pixel coordinates. */
  points(arr: Float32Array, count: number, hard: boolean) {
    if (count === 0) return;
    const gl = this.gl;
    const d = this.dpr;
    gl.useProgram(this.prog);
    if (this.data.length < count * 7) this.data = new Float32Array(count * 7 * 2);
    for (let i = 0; i < count * 7; i += 7) {
      this.data[i] = arr[i] * d;
      this.data[i + 1] = arr[i + 1] * d;
      this.data[i + 2] = Math.min(arr[i + 2] * d, 256);
      this.data[i + 3] = arr[i + 3];
      this.data[i + 4] = arr[i + 4];
      this.data[i + 5] = arr[i + 5];
      this.data[i + 6] = arr[i + 6];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, count * 7), gl.DYNAMIC_DRAW);
    const st = 28;
    gl.enableVertexAttribArray(this.loc.pos);
    gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(this.loc.size);
    gl.vertexAttribPointer(this.loc.size, 1, gl.FLOAT, false, st, 8);
    gl.enableVertexAttribArray(this.loc.color);
    gl.vertexAttribPointer(this.loc.color, 4, gl.FLOAT, false, st, 12);
    gl.uniform2f(this.loc.res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.loc.hard, hard ? 1 : 0);
    gl.drawArrays(gl.POINTS, 0, count);
  }
}
