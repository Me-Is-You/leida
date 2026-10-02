import { sauvola } from "./imageops.ts";
import { decodeQrMatrix, alignmentPositions, type QrDecoded } from "./qr-decode.ts";

/**
 * Camera image → QR symbol. Pipeline:
 *   Sauvola binarisation → 1:1:3:1:1 finder scan (rows, cross-checked on
 *   columns) → cluster → pick the right-isoceles triple → estimate version
 *   from the module size → refine the 4th corner with the alignment pattern
 *   → homography → sample the module grid (5 taps per module, majority) → decode.
 * Handles rotation and perspective; mirrored symbols are decoded by transposition.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface QrHit extends QrDecoded {
  /** Symbol outline in image pixels: TL, TR, BR, BL. */
  corners: [Pt, Pt, Pt, Pt];
}

interface Finder {
  x: number;
  y: number;
  ms: number;
  n: number;
}

/** Checks five run lengths against 1:1:3:1:1 and returns the unit size (or 0). No allocation: runs once per dark run of every image row. */
function ratioOk(a: number, b: number, c: number, d: number, e: number): number {
  const total = a + b + c + d + e;
  if (total < 7) return 0;
  const u = total / 7;
  const tol = u * 0.75;
  if (Math.abs(a - u) < tol && Math.abs(b - u) < tol && Math.abs(c - 3 * u) < 3 * tol && Math.abs(d - u) < tol && Math.abs(e - u) < tol) return u;
  return 0;
}

/**
 * Walks from a dark centre pixel in ±(dx,dy) counting dark/light/dark runs and
 * tests them against 1:1:3:1:1. Returns the refined centre offset along the
 * direction and the unit size, or null.
 */
function crossCheck(bin: Uint8Array, w: number, h: number, x: number, y: number, dx: number, dy: number, maxLen: number): { c: number; u: number } | null {
  const at = (t: number) => {
    const px = Math.round(x + dx * t);
    const py = Math.round(y + dy * t);
    return px < 0 || py < 0 || px >= w || py >= h ? -1 : (bin[py * w + px] as number);
  };
  if (at(0) !== 1) return null;
  const walk = (dir: 1 | -1) => {
    const cnt = [0, 0, 0];
    let t = 0;
    for (let k = 0; k < 3; k++) {
      const want = k % 2 === 0 ? 1 : 0;
      while (Math.abs(t) <= maxLen && at(t) === want) {
        cnt[k]!++;
        t += dir;
      }
      if (cnt[k] === 0 && k > 0) return null;
      if (Math.abs(t) > maxLen) return null;
      if (at(t) < 0 && k < 2) return null;
    }
    return cnt;
  };
  const up = walk(-1);
  const down = walk(1);
  if (!up || !down) return null;
  const u = ratioOk(up[2]!, up[1]!, up[0]! + down[0]! - 1, down[1]!, down[2]!);
  if (!u) return null;
  // centre of the middle run along the line
  const centre = (down[0]! - up[0]!) / 2;
  return { c: centre, u };
}

export function findFinders(bin: Uint8Array, w: number, h: number): Finder[] {
  const cands: Finder[] = [];
  const starts: number[] = [];
  const lens: number[] = [];
  const vals: number[] = [];
  for (let y = 0; y < h; y++) {
    starts.length = 0;
    lens.length = 0;
    vals.length = 0;
    let x = 0;
    while (x < w) {
      const v = bin[y * w + x] as number;
      let x2 = x + 1;
      while (x2 < w && bin[y * w + x2] === v) x2++;
      starts.push(x);
      lens.push(x2 - x);
      vals.push(v);
      x = x2;
    }
    for (let i = 0; i + 4 < lens.length; i++) {
      if (vals[i] !== 1) continue;
      const u = ratioOk(lens[i]!, lens[i + 1]!, lens[i + 2]!, lens[i + 3]!, lens[i + 4]!);
      if (!u) continue;
      const cx = starts[i + 2]! + lens[i + 2]! / 2; // continuous centre of the middle run
      const px = Math.floor(cx);
      const v = crossCheck(bin, w, h, px, y, 0, 1, Math.ceil(u * 10));
      if (!v) continue;
      const cy = y + v.c + 0.5;
      const hz = crossCheck(bin, w, h, px, Math.round(cy - 0.5), 1, 0, Math.ceil(u * 10));
      if (!hz) continue;
      if (Math.abs(v.u - u) > Math.max(1.5, u * 0.5)) continue;
      cands.push({ x: cx, y: cy, ms: (u + v.u + hz.u) / 3, n: 1 });
    }
  }
  return cluster(cands);
}

function cluster(c: Finder[]): Finder[] {
  const out: Finder[] = [];
  for (const f of c) {
    const hit = out.find((o) => Math.hypot(o.x - f.x, o.y - f.y) < Math.max(o.ms, f.ms) * 4 && Math.abs(o.ms - f.ms) < Math.max(o.ms, f.ms) * 0.6);
    if (hit) {
      const n = hit.n + 1;
      hit.x = (hit.x * hit.n + f.x) / n;
      hit.y = (hit.y * hit.n + f.y) / n;
      hit.ms = (hit.ms * hit.n + f.ms) / n;
      hit.n = n;
    } else out.push({ ...f });
  }
  return out.filter((f) => f.n >= 2).sort((a, b) => b.n - a.n).slice(0, 12);
}

// ───────────────────────────────── geometry ─────────────────────────────────

/** Solves A·x = b (n×n) by Gaussian elimination with partial pivoting; returns null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let i = 0; i < n; i++) (A[i] as number[]).push(b[i] as number);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs((A[r] as number[])[c] as number) > Math.abs((A[piv] as number[])[c] as number)) piv = r;
    if (Math.abs((A[piv] as number[])[c] as number) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv] as number[], A[c] as number[]];
    const rc = A[c] as number[];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const rr = A[r] as number[];
      const f = (rr[c] as number) / (rc[c] as number);
      if (f === 0) continue;
      for (let k = c; k <= n; k++) rr[k] = (rr[k] as number) - f * (rc[k] as number);
    }
  }
  return A.map((row, i) => (row[n] as number) / (row[i] as number));
}

export type Homography = [number, number, number, number, number, number, number, number];

/** Projective map from 4 source points to 4 destination points: x' = (h0x+h1y+h2)/(h6x+h7y+1), … */
export function homography(src: Pt[], dst: Pt[]): Homography | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i] as Pt;
    const { x: X, y: Y } = dst[i] as Pt;
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  const r = solve(A, b);
  return r ? (r as Homography) : null;
}

export function applyH(H: Homography, x: number, y: number): Pt {
  const d = H[6] * x + H[7] * y + 1;
  return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d };
}

function orderTriple(a: Finder, b: Finder, c: Finder): { tl: Finder; tr: Finder; bl: Finder } | null {
  const d = (p: Finder, q: Finder) => Math.hypot(p.x - q.x, p.y - q.y);
  const dab = d(a, b);
  const dac = d(a, c);
  const dbc = d(b, c);
  // the corner opposite the longest side is TL
  let tl: Finder, p: Finder, q: Finder, dp: number, dq: number, dh: number;
  if (dbc >= dab && dbc >= dac) [tl, p, q, dp, dq, dh] = [a, b, c, dab, dac, dbc];
  else if (dac >= dab && dac >= dbc) [tl, p, q, dp, dq, dh] = [b, a, c, dab, dbc, dac];
  else [tl, p, q, dp, dq, dh] = [c, a, b, dac, dbc, dab];
  if (dp / dq > 1.6 || dq / dp > 1.6) return null;
  if (Math.abs(dp * dp + dq * dq - dh * dh) > 0.35 * dh * dh) return null;
  const cross = (p.x - tl.x) * (q.y - tl.y) - (p.y - tl.y) * (q.x - tl.x);
  // image y points down: TR = (+x), BL = (+y) → cross(TR−TL, BL−TL) > 0
  return cross > 0 ? { tl, tr: p, bl: q } : { tl, tr: q, bl: p };
}

/** Samples the module grid with a homography; each module = majority of 5 taps. */
function sampleGrid(bin: Uint8Array, w: number, h: number, H: Homography, n: number): Uint8Array {
  const out = new Uint8Array(n * n);
  const taps: [number, number][] = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]];
  for (let v = 0; v < n; v++)
    for (let u = 0; u < n; u++) {
      let dark = 0;
      for (const [du, dv] of taps) {
        const p = applyH(H, u + du, v + dv);
        const px = Math.round(p.x - 0.5);
        const py = Math.round(p.y - 0.5);
        if (px >= 0 && py >= 0 && px < w && py < h) dark += bin[py * w + px] as number;
      }
      out[v * n + u] = dark >= 3 ? 1 : 0;
    }
  return out;
}

/** Finds the alignment-pattern centre near `guess` by scoring the 5×5 ring pattern on a coarse grid. */
function findAlignment(bin: Uint8Array, w: number, h: number, guess: Pt, ex: Pt, ey: Pt): Pt | null {
  // ex, ey = image-space vectors for one module along the symbol's x and y axes
  let best: Pt | null = null;
  let bestScore = -1;
  const pat = (i: number, j: number) => (Math.max(Math.abs(i), Math.abs(j)) === 1 ? 0 : 1); // centre dark, ring light, border dark
  for (let sy = -4; sy <= 4; sy += 0.5)
    for (let sx = -4; sx <= 4; sx += 0.5) {
      const cx = guess.x + ex.x * sx + ey.x * sy;
      const cy = guess.y + ex.y * sx + ey.y * sy;
      let ok = 0;
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) {
          const px = Math.round(cx + ex.x * i + ey.x * j);
          const py = Math.round(cy + ex.y * i + ey.y * j);
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          if (bin[py * w + px] === pat(i, j)) ok++;
        }
      if (ok > bestScore) {
        bestScore = ok;
        best = { x: cx, y: cy };
      }
    }
  return bestScore >= 21 ? best : null;
}

function tryTriple(bin: Uint8Array, w: number, h: number, t: { tl: Finder; tr: Finder; bl: Finder }): QrHit | null {
  const { tl, tr, bl } = t;
  const ms = (tl.ms + tr.ms + bl.ms) / 3;
  const dTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const dLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const nEst = (dTop + dLeft) / (2 * ms) + 7;
  const v0 = Math.round((nEst - 17) / 4);
  const order = [v0, v0 - 1, v0 + 1, v0 - 2, v0 + 2].filter((v) => v >= 1 && v <= 40);
  for (const v of order) {
    const n = 17 + 4 * v;
    // affine guess from the three finder centres (module coords 3.5 / n−3.5)
    const span = n - 7;
    const ux = { x: (tr.x - tl.x) / span, y: (tr.y - tl.y) / span };
    const uy = { x: (bl.x - tl.x) / span, y: (bl.y - tl.y) / span };
    const at = (mx: number, my: number): Pt => ({ x: tl.x + ux.x * (mx - 3.5) + uy.x * (my - 3.5), y: tl.y + ux.y * (mx - 3.5) + uy.y * (my - 3.5) });
    let brModule: Pt = { x: n - 3.5, y: n - 3.5 };
    let brImage: Pt = at(brModule.x, brModule.y);
    if (v >= 2) {
      const ap = alignmentPositions(v);
      const last = (ap[ap.length - 1] as number) + 0.5;
      const a = findAlignment(bin, w, h, at(last, last), ux, uy);
      if (a) {
        brModule = { x: last, y: last };
        brImage = a;
      }
    }
    const H = homography(
      [{ x: 3.5, y: 3.5 }, { x: n - 3.5, y: 3.5 }, brModule, { x: 3.5, y: n - 3.5 }],
      [tl, tr, brImage, bl],
    );
    if (!H) continue;
    const m = sampleGrid(bin, w, h, H, n);
    const r = decodeQrMatrix(m, n);
    if (r) {
      const c = (x: number, y: number) => applyH(H, x, y);
      return { ...r, corners: [c(0, 0), c(n, 0), c(n, n), c(0, n)] };
    }
  }
  return null;
}

/**
 * Decode the first QR code in an 8-bit gray image. `maxTriples` bounds the work
 * on cluttered scenes. Returns null when nothing decodes (never a guess).
 */
export function decodeQrImage(gray: Uint8Array, w: number, h: number, maxTriples = 12): QrHit | null {
  const win = Math.max(25, Math.round(Math.min(w, h) / 8) | 1);
  const bin = sauvola(gray, w, h, win, 0.3);
  const fs = findFinders(bin, w, h);
  if (fs.length < 3) return null;
  const triples: { t: { tl: Finder; tr: Finder; bl: Finder }; score: number }[] = [];
  for (let i = 0; i < fs.length; i++)
    for (let j = i + 1; j < fs.length; j++)
      for (let k = j + 1; k < fs.length; k++) {
        const a = fs[i] as Finder, b = fs[j] as Finder, c = fs[k] as Finder;
        const mx = Math.max(a.ms, b.ms, c.ms);
        const mn = Math.min(a.ms, b.ms, c.ms);
        if (mx / mn > 1.6) continue;
        const o = orderTriple(a, b, c);
        if (!o) continue;
        const dp = Math.hypot(o.tr.x - o.tl.x, o.tr.y - o.tl.y);
        const dq = Math.hypot(o.bl.x - o.tl.x, o.bl.y - o.tl.y);
        // module count along the side must be an integer-ish 14+4k and plausibly sized
        const nUnits = dp / ((a.ms + b.ms + c.ms) / 3);
        if (nUnits < 12 || nUnits > 150) continue;
        triples.push({ t: o, score: a.n + b.n + c.n - Math.abs(dp - dq) / Math.max(dp, dq) * 10 });
      }
  triples.sort((p, q) => q.score - p.score);
  for (const { t } of triples.slice(0, maxTriples)) {
    const r = tryTriple(bin, w, h, t);
    if (r) return r;
  }
  return null;
}
