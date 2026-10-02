/**
 * QR Code symbol decoder (ISO/IEC 18004, models 2, versions 1‥40, all EC
 * levels, numeric / alphanumeric / byte / kanji / ECI segments).
 * Works on a module matrix; `qr-locate.ts` turns a camera image into one.
 * Reed–Solomon over GF(256) with Berlekamp–Massey + Chien + Forney.
 */

// ───────────────────────────── GF(256), poly x⁸+x⁴+x³+x²+1 ─────────────────────────────

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] as number;
}
const gmul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : (EXP[(LOG[a] as number) + (LOG[b] as number)] as number));
const gdiv = (a: number, b: number) => (a === 0 ? 0 : (EXP[(LOG[a] as number) + 255 - (LOG[b] as number)] as number));

/**
 * In-place Reed–Solomon correction of `cw` (data followed by `nsym` parity bytes,
 * generator roots α⁰…α^{nsym−1}). Returns the number of corrected bytes or −1.
 */
export function rsCorrect(cw: Uint8Array, nsym: number): number {
  const n = cw.length;
  const S = new Uint8Array(nsym);
  let clean = true;
  for (let i = 0; i < nsym; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s = gmul(s, EXP[i] as number) ^ (cw[j] as number);
    S[i] = s;
    if (s) clean = false;
  }
  if (clean) return 0;
  // Berlekamp–Massey → Λ(x) (ascending coefficients)
  const lam = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let r = 0; r < nsym; r++) {
    let d = S[r] as number;
    for (let i = 1; i <= L; i++) d ^= gmul(lam[i] ?? 0, S[r - i] as number);
    if (d === 0) {
      m++;
    } else {
      const T = lam.slice();
      const coef = gdiv(d, b);
      while (lam.length < B.length + m) lam.push(0);
      for (let i = 0; i < B.length; i++) lam[i + m] = (lam[i + m] as number) ^ gmul(coef, B[i] as number);
      if (2 * L <= r) {
        L = r + 1 - L;
        B = T;
        b = d;
        m = 1;
      } else m++;
    }
  }
  while (lam.length > 1 && lam[lam.length - 1] === 0) lam.pop();
  if (L > nsym / 2 || lam.length - 1 !== L) return -1;
  // Chien search: position p (0 = first byte) ↔ locator X = α^{n−1−p}; root is X⁻¹
  const pos: number[] = [];
  for (let p = 0; p < n; p++) {
    const xinv = EXP[(255 - ((n - 1 - p) % 255)) % 255] as number;
    let v = 0;
    let xp = 1;
    for (let i = 0; i < lam.length; i++) {
      v ^= gmul(lam[i] as number, xp);
      xp = gmul(xp, xinv);
    }
    if (v === 0) pos.push(p);
  }
  if (pos.length !== L) return -1;
  // Ω(x) = S(x)·Λ(x) mod x^nsym
  const omega = new Array<number>(nsym).fill(0);
  for (let i = 0; i < nsym; i++) for (let j = 0; j < lam.length && i + j < nsym; j++) omega[i + j] = (omega[i + j] as number) ^ gmul(S[i] as number, lam[j] as number);
  for (const p of pos) {
    const X = EXP[(n - 1 - p) % 255] as number;
    const xinv = EXP[(255 - ((n - 1 - p) % 255)) % 255] as number;
    let om = 0;
    let xp = 1;
    for (let i = 0; i < nsym; i++) {
      om ^= gmul(omega[i] as number, xp);
      xp = gmul(xp, xinv);
    }
    // Λ'(x) keeps odd-degree terms: Σ_{i odd} Λ_i x^{i−1}
    let dl = 0;
    xp = 1; // x^{i-1} for i = 1
    const x2 = gmul(xinv, xinv);
    for (let i = 1; i < lam.length; i += 2) {
      dl ^= gmul(lam[i] as number, xp);
      xp = gmul(xp, x2);
    }
    if (dl === 0) return -1;
    cw[p] = (cw[p] as number) ^ gmul(X, gdiv(om, dl)); // b = 0 → factor X^{1−b} = X
  }
  // verify
  for (let i = 0; i < nsym; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s = gmul(s, EXP[i] as number) ^ (cw[j] as number);
    if (s) return -1;
  }
  return L;
}

// ─────────────────────────────── tables (verified against the standard's table) ───────────────────────────────

/** index 0..3 = L, M, Q, H; entries indexed by version (0 unused). */
const ECC_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
/** 2-bit format-info code → level index (L=01, M=00, Q=11, H=10). */
const LEVEL_OF_BITS = [1, 0, 3, 2];
export const LEVEL_NAME = ["L", "M", "Q", "H"] as const;

export function alignmentPositions(v: number): number[] {
  if (v === 1) return [];
  const size = v * 4 + 17;
  const num = Math.floor(v / 7) + 2;
  const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (num * 2 - 2)) * 2;
  const res = [6];
  for (let pos = size - 7; res.length < num; pos -= step) res.splice(1, 0, pos);
  return res;
}

function rawModules(v: number): number {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const na = Math.floor(v / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}

/** Function-pattern map for version v (1 = not data). Cached. */
const fnCache = new Map<number, Uint8Array>();
function functionMap(v: number): Uint8Array {
  const hit = fnCache.get(v);
  if (hit) return hit;
  const n = v * 4 + 17;
  const f = new Uint8Array(n * n);
  const rect = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < n && y < n) f[y * n + x] = 1;
  };
  rect(0, 0, 9, 9); // TL finder + separator + format
  rect(n - 8, 0, 8, 9); // TR
  rect(0, n - 8, 9, 8); // BL
  rect(6, 0, 1, n);
  rect(0, 6, n, 1);
  const ap = alignmentPositions(v);
  for (let i = 0; i < ap.length; i++)
    for (let j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
      rect((ap[i] as number) - 2, (ap[j] as number) - 2, 5, 5);
    }
  if (v >= 7) {
    rect(n - 11, 0, 3, 6);
    rect(0, n - 11, 6, 3);
  }
  fnCache.set(v, f);
  return f;
}

// ───────────────────────────────── format info ─────────────────────────────────

const FORMAT_CODES: number[] = [];
for (let d = 0; d < 32; d++) {
  let rem = d << 10;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  FORMAT_CODES.push(((d << 10) | rem) ^ 0x5412);
}
const popcnt = (x: number) => {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
};

function readFormat(bit: (x: number, y: number) => number, n: number): { level: number; mask: number } | null {
  let a = 0;
  for (let i = 0; i <= 5; i++) a |= bit(8, i) << i;
  a |= bit(8, 7) << 6;
  a |= bit(8, 8) << 7;
  a |= bit(7, 8) << 8;
  for (let i = 9; i < 15; i++) a |= bit(14 - i, 8) << i;
  let b = 0;
  for (let i = 0; i < 8; i++) b |= bit(n - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) b |= bit(8, n - 15 + i) << i;
  let best = -1;
  let bestD = 99;
  for (let d = 0; d < 32; d++) {
    const dist = Math.min(popcnt(a ^ (FORMAT_CODES[d] as number)), popcnt(b ^ (FORMAT_CODES[d] as number)));
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  if (bestD > 3) return null;
  return { level: LEVEL_OF_BITS[best >> 3] as number, mask: best & 7 };
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0,
];

// ───────────────────────────────── segments ─────────────────────────────────

const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

class Bits {
  pos = 0;
  d: Uint8Array;
  constructor(d: Uint8Array) {
    this.d = d;
  }
  get left() {
    return this.d.length * 8 - this.pos;
  }
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | (((this.d[this.pos >> 3] as number) >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
}

function bytesToText(b: number[], eci: number): string {
  const u8 = Uint8Array.from(b);
  const tryDec = (label: string, fatal: boolean) => {
    try {
      return new TextDecoder(label, { fatal }).decode(u8);
    } catch {
      return null;
    }
  };
  if (eci === 26 || eci < 0) {
    const s = tryDec("utf-8", true);
    if (s !== null) return s;
  }
  if (eci === 20) {
    const s = tryDec("shift_jis", false);
    if (s !== null) return s;
  }
  if (eci === 29 || eci === 28) {
    const s = tryDec(eci === 29 ? "gb18030" : "big5", false);
    if (s !== null) return s;
  }
  let out = "";
  for (const c of b) out += String.fromCharCode(c);
  return out;
}

function parseSegments(data: Uint8Array, v: number): string | null {
  const br = new Bits(data);
  const cc = (bitsFor: [number, number, number]) => (v <= 9 ? bitsFor[0] : v <= 26 ? bitsFor[1] : bitsFor[2]);
  let text = "";
  let eci = -1;
  while (br.left >= 4) {
    const mode = br.read(4);
    if (mode === 0) break;
    if (mode === 1) {
      let cnt = br.read(cc([10, 12, 14]));
      while (cnt >= 3) {
        if (br.left < 10) return null;
        const t = br.read(10);
        if (t > 999) return null;
        text += String(t).padStart(3, "0");
        cnt -= 3;
      }
      if (cnt === 2) {
        if (br.left < 7) return null;
        const t = br.read(7);
        if (t > 99) return null;
        text += String(t).padStart(2, "0");
      } else if (cnt === 1) {
        if (br.left < 4) return null;
        const t = br.read(4);
        if (t > 9) return null;
        text += String(t);
      }
    } else if (mode === 2) {
      let cnt = br.read(cc([9, 11, 13]));
      while (cnt >= 2) {
        if (br.left < 11) return null;
        const t = br.read(11);
        if (t >= 45 * 45) return null;
        text += ALNUM[Math.floor(t / 45)]! + ALNUM[t % 45]!;
        cnt -= 2;
      }
      if (cnt === 1) {
        if (br.left < 6) return null;
        const t = br.read(6);
        if (t >= 45) return null;
        text += ALNUM[t];
      }
    } else if (mode === 4) {
      const cnt = br.read(cc([8, 16, 16]));
      if (br.left < cnt * 8) return null;
      const bytes: number[] = [];
      for (let i = 0; i < cnt; i++) bytes.push(br.read(8));
      text += bytesToText(bytes, eci);
    } else if (mode === 8) {
      const cnt = br.read(cc([8, 10, 12]));
      if (br.left < cnt * 13) return null;
      const bytes: number[] = [];
      for (let i = 0; i < cnt; i++) {
        const t = br.read(13);
        const w = Math.floor(t / 0xc0) * 0x100 + (t % 0xc0);
        const sj = w + (w < 0x1f00 ? 0x8140 : 0xc140);
        bytes.push(sj >> 8, sj & 255);
      }
      text += bytesToText(bytes, 20);
    } else if (mode === 7) {
      const b0 = br.read(8);
      if ((b0 & 0x80) === 0) eci = b0;
      else if ((b0 & 0xc0) === 0x80) eci = ((b0 & 0x3f) << 8) | br.read(8);
      else eci = ((b0 & 0x1f) << 16) | br.read(16);
    } else if (mode === 3) {
      br.read(16); // structured append: sequence info is not needed for a single symbol
    } else if (mode === 5 || mode === 9) {
      if (mode === 9) br.read(8);
    } else return null;
  }
  return text;
}

// ───────────────────────────────── matrix decode ─────────────────────────────────

export interface QrDecoded {
  text: string;
  version: number;
  level: "L" | "M" | "Q" | "H";
  mask: number;
  /** Reed–Solomon corrections applied (a proxy for how marginal the read was). */
  corrected: number;
  mirrored: boolean;
}

function decodeOnce(bits: Uint8Array, n: number, mirrored: boolean): QrDecoded | null {
  const v = (n - 17) / 4;
  if (!Number.isInteger(v) || v < 1 || v > 40) return null;
  const bit = (x: number, y: number) => (bits[y * n + x] as number) & 1;
  const fmt = readFormat(bit, n);
  if (!fmt) return null;
  const fn = functionMap(v);
  const mask = MASKS[fmt.mask] as (x: number, y: number) => boolean;
  const raw = rawModules(v);
  const nCw = raw >> 3;
  const out = new Uint8Array(nCw);
  let k = 0;
  const total = nCw * 8;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < n; vert++) {
      const y = upward ? n - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (fn[y * n + x] || k >= total) continue;
        let b = bit(x, y);
        if (mask(x, y)) b ^= 1;
        if (b) out[k >> 3] = (out[k >> 3] as number) | (0x80 >> (k & 7));
        k++;
      }
    }
  }
  const nb = (NUM_BLOCKS[fmt.level] as number[])[v] as number;
  const ecLen = (ECC_PER_BLOCK[fmt.level] as number[])[v] as number;
  const nShort = nb - (nCw % nb);
  const shortLen = Math.floor(nCw / nb);
  const blocks: Uint8Array[] = [];
  for (let j = 0; j < nb; j++) blocks.push(new Uint8Array(shortLen + 1));
  let p = 0;
  for (let i = 0; i <= shortLen; i++)
    for (let j = 0; j < nb; j++) {
      if (i === shortLen - ecLen && j < nShort) continue;
      (blocks[j] as Uint8Array)[i] = out[p++] as number;
    }
  const data: number[] = [];
  let corrected = 0;
  for (let j = 0; j < nb; j++) {
    let blk = blocks[j] as Uint8Array;
    if (j < nShort) {
      // drop the pad slot between data and parity
      const t = new Uint8Array(shortLen);
      t.set(blk.subarray(0, shortLen - ecLen));
      t.set(blk.subarray(shortLen + 1 - ecLen), shortLen - ecLen);
      blk = t;
    }
    const c = rsCorrect(blk, ecLen);
    if (c < 0) return null;
    corrected += c;
    for (let i = 0; i < blk.length - ecLen; i++) data.push(blk[i] as number);
  }
  const text = parseSegments(Uint8Array.from(data), v);
  if (text === null) return null;
  return { text, version: v, level: LEVEL_NAME[fmt.level] as "L" | "M" | "Q" | "H", mask: fmt.mask, corrected, mirrored };
}

/** Decodes an n×n module matrix (1 = dark). Tries the transposed (mirrored) symbol as a fallback. */
export function decodeQrMatrix(bits: Uint8Array, n: number): QrDecoded | null {
  const a = decodeOnce(bits, n, false);
  if (a) return a;
  const t = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) t[x * n + y] = bits[y * n + x] as number;
  return decodeOnce(t, n, true);
}
