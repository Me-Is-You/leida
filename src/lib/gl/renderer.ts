/**
 * Self-contained WebGL2 renderer for the 3-D map: round point sprites with
 * size attenuation, per-vertex-colour lines/triangles, and instanced lit
 * boxes. ~10 KB instead of three + fiber + drei (~950 KB).
 *
 * All draw calls are alpha-blended with depth *test* but no depth *write*, so
 * the scene order (grid → boxes → clouds → overlays) fully defines the look.
 */
import type { Mat4 } from "./mat4.ts";

export type RGBA = [number, number, number, number];

export function hex(c: string, a = 1): RGBA {
  const n = Number.parseInt(c.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

interface Gpu {
  vao: WebGLVertexArrayObject;
  buf: WebGLBuffer;
  cap: number;
  count: number;
}

/** CPU-side colored line / triangle list (7 floats per vertex: xyz rgba). */
export class Batch {
  lines = new Float32Array(7 * 2 * 256);
  tris = new Float32Array(7 * 3 * 64);
  nLineV = 0;
  nTriV = 0;
  dirty = true;
  gpuL: Gpu | null = null;
  gpuT: Gpu | null = null;

  clear() {
    this.nLineV = 0;
    this.nTriV = 0;
    this.dirty = true;
  }

  private vert(arr: Float32Array, n: number, x: number, y: number, z: number, c: RGBA) {
    const o = n * 7;
    arr[o] = x;
    arr[o + 1] = y;
    arr[o + 2] = z;
    arr[o + 3] = c[0];
    arr[o + 4] = c[1];
    arr[o + 5] = c[2];
    arr[o + 6] = c[3];
  }

  line(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: RGBA, c1: RGBA = c) {
    if ((this.nLineV + 2) * 7 > this.lines.length) {
      const g = new Float32Array(this.lines.length * 2);
      g.set(this.lines);
      this.lines = g;
    }
    this.vert(this.lines, this.nLineV++, x0, y0, z0, c);
    this.vert(this.lines, this.nLineV++, x1, y1, z1, c1);
    this.dirty = true;
  }

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: RGBA) {
    if ((this.nTriV + 3) * 7 > this.tris.length) {
      const g = new Float32Array(this.tris.length * 2);
      g.set(this.tris);
      this.tris = g;
    }
    this.vert(this.tris, this.nTriV++, ax, ay, az, c);
    this.vert(this.tris, this.nTriV++, bx, by, bz, c);
    this.vert(this.tris, this.nTriV++, cx, cy, cz, c);
    this.dirty = true;
  }

  quad(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, c: RGBA,
  ) {
    this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, c);
    this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, c);
  }

  /** Horizontal circle in the XZ plane at height y. */
  ring(cx: number, y: number, cz: number, r: number, c: RGBA, seg = 72) {
    let px = cx + r;
    let pz = cz;
    for (let i = 1; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      this.line(px, y, pz, x, y, z, c);
      px = x;
      pz = z;
    }
  }

  /** Wireframe of an axis-aligned box. */
  wireBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: RGBA) {
    const X = [x0, x1];
    const Y = [y0, y1];
    const Z = [z0, z1];
    for (const y of Y) {
      this.line(x0, y, z0, x1, y, z0, c);
      this.line(x1, y, z0, x1, y, z1, c);
      this.line(x1, y, z1, x0, y, z1, c);
      this.line(x0, y, z1, x0, y, z0, c);
    }
    for (const x of X) for (const z of Z) this.line(x, y0, z, x, y1, z, c);
  }
}

/** Instanced box list (10 floats per instance: offset3 scale3 rgba4). */
export class BoxBatch {
  data: Float32Array;
  count = 0;
  dirty = true;
  gpu: Gpu | null = null;
  readonly max: number;
  constructor(max: number) {
    this.max = max;
    this.data = new Float32Array(max * 10);
  }
  clear() {
    this.count = 0;
    this.dirty = true;
  }
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: RGBA) {
    if (this.count >= this.max) return;
    const o = this.count++ * 10;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = sx;
    d[o + 4] = sy;
    d[o + 5] = sz;
    d[o + 6] = c[0];
    d[o + 7] = c[1];
    d[o + 8] = c[2];
    d[o + 9] = c[3];
    this.dirty = true;
  }
}

/** A point cloud backed by an externally owned Float32Array (xyz triplets). */
export interface PointLayer {
  data: Float32Array;
  count: number;
  /** Bump to re-upload. */
  version: number;
  color: RGBA;
  /** World-space diameter in metres. */
  size: number;
  additive?: boolean;
  offset?: [number, number, number];
  scale?: [number, number, number];
  gpu?: Gpu | null;
  uploaded?: number;
}

const GEO_VS = `#version 300 es
uniform mat4 uVP; uniform vec3 uOff;
in vec3 aPos; in vec4 aCol;
out vec4 vCol; out float vD;
void main(){ gl_Position = uVP * vec4(aPos + uOff, 1.0); vCol = aCol; vD = gl_Position.w; }`;

const GEO_FS = `#version 300 es
precision mediump float;
uniform vec2 uFog; uniform float uAlpha;
in vec4 vCol; in float vD; out vec4 o;
void main(){ float f = clamp((vD - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0); o = vec4(vCol.rgb, vCol.a * uAlpha * (1.0 - f)); }`;

const PT_VS = `#version 300 es
uniform mat4 uVP; uniform vec3 uOff; uniform vec3 uScale; uniform float uSize; uniform float uPx;
in vec3 aPos; out float vD;
void main(){ gl_Position = uVP * vec4(aPos * uScale + uOff, 1.0); vD = gl_Position.w;
  gl_PointSize = clamp(uSize * uPx / max(vD, 0.1), 1.5, 30.0); }`;

const PT_FS = `#version 300 es
precision mediump float;
uniform vec4 uCol; uniform vec2 uFog;
in float vD; out vec4 o;
void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
  float f = clamp((vD - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  o = vec4(uCol.rgb, uCol.a * smoothstep(0.5, 0.25, d) * (1.0 - f)); }`;

const BOX_VS = `#version 300 es
uniform mat4 uVP;
in vec3 aPos; in vec3 aN; in vec3 iOff; in vec3 iScale; in vec4 iCol;
out vec4 vCol; out float vD;
void main(){ gl_Position = uVP * vec4(aPos * iScale + iOff, 1.0); vD = gl_Position.w;
  float l = 0.5 + 0.5 * max(dot(aN, normalize(vec3(0.4, 0.8, 0.5))), 0.0);
  vCol = vec4(iCol.rgb * l, iCol.a); }`;

export class GLRenderer {
  readonly gl: WebGL2RenderingContext;
  lost = false;
  private geo!: WebGLProgram;
  private pts!: WebGLProgram;
  private box!: WebGLProgram;
  private cube!: Gpu & { idx: WebGLBuffer; n: number };
  private u: Record<string, WebGLUniformLocation | null> = {};
  private fogRange: [number, number] = [22, 52];
  private pxPerUnit = 800;
  /** Called after the GPU context was restored — owners should mark their batches dirty. */
  onRestore: (() => void) | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };
  private readonly onRest = () => {
    this.init();
    this.lost = false;
    this.onRestore?.();
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 不可用");
    this.gl = gl;
    this.canvas = canvas;
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRest);
    this.init();
  }

  private compile(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram() as WebGLProgram;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
    return p;
  }

  private init() {
    const gl = this.gl;
    this.geo = this.compile(GEO_VS, GEO_FS);
    this.pts = this.compile(PT_VS, PT_FS);
    this.box = this.compile(BOX_VS, GEO_FS.replace("uniform float uAlpha;", "uniform float uAlpha;"));
    this.u = {};
    for (const [n, p] of [["geo", this.geo], ["pts", this.pts], ["box", this.box]] as const) {
      for (const name of ["uVP", "uOff", "uScale", "uSize", "uPx", "uCol", "uFog", "uAlpha"]) {
        this.u[`${n}.${name}`] = gl.getUniformLocation(p, name);
      }
    }
    // unit cube: 24 verts (per-face normals) + 36 indices
    const P: number[] = [];
    const I: number[] = [];
    const faces: [number[], number[], number[], number[], number[]][] = [
      [[1, 0, 0], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]],
      [[-1, 0, 0], [-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]],
      [[0, 1, 0], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]],
      [[0, -1, 0], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]],
      [[0, 0, 1], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
      [[0, 0, -1], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]],
    ];
    faces.forEach((f, fi) => {
      for (let v = 1; v <= 4; v++) P.push(...(f[v] as number[]), ...(f[0] as number[]));
      const b = fi * 4;
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const vao = gl.createVertexArray() as WebGLVertexArrayObject;
    const buf = gl.createBuffer() as WebGLBuffer;
    const idx = gl.createBuffer() as WebGLBuffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(I), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.box, "aPos");
    const aN = gl.getAttribLocation(this.box, "aN");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(aN);
    gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
    this.cube = { vao, buf, cap: 0, count: 0, idx, n: I.length };
  }

  setFog(near: number, far: number) {
    this.fogRange = [near, far];
  }

  resize(cssW: number, cssH: number, dpr: number, fovy: number) {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    this.pxPerUnit = h / (2 * Math.tan(fovy / 2));
  }

  begin(vp: Mat4, bg: RGBA) {
    const gl = this.gl;
    this.vp = vp;
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  private vp!: Mat4;

  private upload(g: Gpu | null, data: Float32Array, floats: number, make: () => Gpu): Gpu {
    const gl = this.gl;
    const gpu = g ?? make();
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buf);
    if (floats * 4 > gpu.cap) {
      gpu.cap = Math.max(floats * 4, gpu.cap * 2, 4096);
      gl.bufferData(gl.ARRAY_BUFFER, gpu.cap, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, floats);
    return gpu;
  }

  private makeGeoGpu(): Gpu {
    const gl = this.gl;
    const vao = gl.createVertexArray() as WebGLVertexArrayObject;
    const buf = gl.createBuffer() as WebGLBuffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const aPos = gl.getAttribLocation(this.geo, "aPos");
    const aCol = gl.getAttribLocation(this.geo, "aCol");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(aCol);
    gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, 28, 12);
    return { vao, buf, cap: 0, count: 0 };
  }

  /** Drop all cached GPU objects (after context restore). */
  forget(b: Batch | BoxBatch | PointLayer) {
    if (b instanceof Batch) {
      b.gpuL = null;
      b.gpuT = null;
      b.dirty = true;
    } else if (b instanceof BoxBatch) {
      b.gpu = null;
      b.dirty = true;
    } else {
      b.gpu = null;
      b.uploaded = -1;
    }
  }

  drawBatch(b: Batch, ox = 0, oy = 0, oz = 0, alpha = 1) {
    if (this.lost) return;
    const gl = this.gl;
    if (b.dirty) {
      if (b.nLineV) {
        b.gpuL = this.upload(b.gpuL, b.lines, b.nLineV * 7, () => this.makeGeoGpu());
        b.gpuL.count = b.nLineV;
      }
      if (b.nTriV) {
        b.gpuT = this.upload(b.gpuT, b.tris, b.nTriV * 7, () => this.makeGeoGpu());
        b.gpuT.count = b.nTriV;
      }
      b.dirty = false;
    }
    gl.useProgram(this.geo);
    gl.uniformMatrix4fv(this.u["geo.uVP"] as WebGLUniformLocation, false, this.vp);
    gl.uniform3f(this.u["geo.uOff"] as WebGLUniformLocation, ox, oy, oz);
    gl.uniform2f(this.u["geo.uFog"] as WebGLUniformLocation, this.fogRange[0], this.fogRange[1]);
    gl.uniform1f(this.u["geo.uAlpha"] as WebGLUniformLocation, alpha);
    if (b.nTriV && b.gpuT) {
      gl.bindVertexArray(b.gpuT.vao);
      gl.drawArrays(gl.TRIANGLES, 0, b.nTriV);
    }
    if (b.nLineV && b.gpuL) {
      gl.bindVertexArray(b.gpuL.vao);
      gl.drawArrays(gl.LINES, 0, b.nLineV);
    }
    gl.bindVertexArray(null);
  }

  drawPoints(l: PointLayer) {
    if (this.lost || l.count <= 0) return;
    const gl = this.gl;
    if (!l.gpu) {
      const vao = gl.createVertexArray() as WebGLVertexArrayObject;
      const buf = gl.createBuffer() as WebGLBuffer;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const aPos = gl.getAttribLocation(this.pts, "aPos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 12, 0);
      l.gpu = { vao, buf, cap: 0, count: 0 };
      l.uploaded = -1;
    }
    if (l.uploaded !== l.version) {
      l.gpu = this.upload(l.gpu, l.data, l.count * 3, () => l.gpu as Gpu);
      l.uploaded = l.version;
    }
    gl.useProgram(this.pts);
    gl.uniformMatrix4fv(this.u["pts.uVP"] as WebGLUniformLocation, false, this.vp);
    const o = l.offset ?? [0, 0, 0];
    const s = l.scale ?? [1, 1, 1];
    gl.uniform3f(this.u["pts.uOff"] as WebGLUniformLocation, o[0], o[1], o[2]);
    gl.uniform3f(this.u["pts.uScale"] as WebGLUniformLocation, s[0], s[1], s[2]);
    gl.uniform1f(this.u["pts.uSize"] as WebGLUniformLocation, l.size);
    gl.uniform1f(this.u["pts.uPx"] as WebGLUniformLocation, this.pxPerUnit);
    gl.uniform4f(this.u["pts.uCol"] as WebGLUniformLocation, l.color[0], l.color[1], l.color[2], l.color[3]);
    gl.uniform2f(this.u["pts.uFog"] as WebGLUniformLocation, this.fogRange[0], this.fogRange[1]);
    gl.blendFunc(gl.SRC_ALPHA, l.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(l.gpu.vao);
    gl.drawArrays(gl.POINTS, 0, l.count);
    gl.bindVertexArray(null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  drawBoxes(b: BoxBatch) {
    if (this.lost || b.count <= 0) return;
    const gl = this.gl;
    if (!b.gpu) {
      const buf = gl.createBuffer() as WebGLBuffer;
      // reuse the cube VAO layout: instance attributes are appended in a per-batch VAO
      const vao = gl.createVertexArray() as WebGLVertexArrayObject;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cube.buf);
      const aPos = gl.getAttribLocation(this.box, "aPos");
      const aN = gl.getAttribLocation(this.box, "aN");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(aN);
      gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 24, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cube.idx);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const iOff = gl.getAttribLocation(this.box, "iOff");
      const iScale = gl.getAttribLocation(this.box, "iScale");
      const iCol = gl.getAttribLocation(this.box, "iCol");
      for (const [loc, size, off] of [[iOff, 3, 0], [iScale, 3, 12], [iCol, 4, 24]] as const) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, off);
        gl.vertexAttribDivisor(loc, 1);
      }
      b.gpu = { vao, buf, cap: 0, count: 0 };
    }
    if (b.dirty) {
      b.gpu = this.upload(b.gpu, b.data, b.count * 10, () => b.gpu as Gpu);
      b.dirty = false;
    }
    gl.useProgram(this.box);
    gl.uniformMatrix4fv(this.u["box.uVP"] as WebGLUniformLocation, false, this.vp);
    gl.uniform2f(this.u["box.uFog"] as WebGLUniformLocation, this.fogRange[0], this.fogRange[1]);
    gl.uniform1f(this.u["box.uAlpha"] as WebGLUniformLocation, 1);
    gl.bindVertexArray(b.gpu.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.cube.n, gl.UNSIGNED_SHORT, 0, b.count);
    gl.bindVertexArray(null);
  }

  dispose() {
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRest);
    // Do NOT lose the context: React StrictMode re-mounts on the same canvas and would get a dead one.
    const gl = this.gl;
    gl.deleteProgram(this.geo);
    gl.deleteProgram(this.pts);
    gl.deleteProgram(this.box);
  }
}
