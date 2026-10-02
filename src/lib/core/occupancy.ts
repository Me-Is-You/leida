/**
 * Sparse log-odds occupancy grid (2-D, x/z) updated by range rays. Cells live
 * in an open-addressing hash table over typed arrays (grown by doubling), so
 * ray integration allocates nothing.
 */
export class OccupancyGrid {
  readonly cell: number;
  private readonly lFree: number;
  private readonly lOcc: number;
  private readonly lMin = -4;
  private readonly lMax = 5;
  private kx = new Int32Array(1024);
  private kz = new Int32Array(1024);
  private lv = new Float32Array(1024);
  private used = new Uint8Array(1024);
  private mask = 1023;
  private n = 0;
  version = 0;

  constructor(cell = 0.25, pFree = 0.35, pOcc = 0.72) {
    this.cell = cell;
    this.lFree = Math.log(pFree / (1 - pFree));
    this.lOcc = Math.log(pOcc / (1 - pOcc));
  }

  private slot(ix: number, iz: number): number {
    let h = Math.imul(ix, 0x9e3779b1) ^ Math.imul(iz, 0x85ebca6b);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 13;
    let i = h & this.mask;
    while (this.used[i]) {
      if (this.kx[i] === ix && this.kz[i] === iz) return i;
      i = (i + 1) & this.mask;
    }
    return ~i;
  }

  private grow() {
    const { kx, kz, lv, used } = this;
    const size = (this.mask + 1) * 2;
    this.kx = new Int32Array(size);
    this.kz = new Int32Array(size);
    this.lv = new Float32Array(size);
    this.used = new Uint8Array(size);
    this.mask = size - 1;
    for (let i = 0; i < used.length; i++) {
      if (!used[i]) continue;
      const j = ~this.slot(kx[i] as number, kz[i] as number);
      this.kx[j] = kx[i] as number;
      this.kz[j] = kz[i] as number;
      this.lv[j] = lv[i] as number;
      this.used[j] = 1;
    }
  }

  private bump(ix: number, iz: number, d: number) {
    let i = this.slot(ix, iz);
    if (i < 0) {
      if ((this.n + 1) * 2 > this.mask + 1) {
        this.grow();
        i = this.slot(ix, iz);
      }
      i = ~i;
      this.kx[i] = ix;
      this.kz[i] = iz;
      this.lv[i] = 0;
      this.used[i] = 1;
      this.n++;
    }
    this.lv[i] = Math.max(this.lMin, Math.min(this.lMax, (this.lv[i] as number) + d));
  }

  /**
   * Integrate one ray from (ox,oz) to (hx,hz). `hit=false` means the ray
   * reached max range without a return: all cells are free, none occupied.
   */
  integrateRay(ox: number, oz: number, hx: number, hz: number, hit = true) {
    // a NaN/∞ coordinate would make the Bresenham loop spin 2000 steps and write garbage into cell (0,0)
    if (!Number.isFinite(ox + oz + hx + hz)) return;
    const c = this.cell;
    const x0 = Math.floor(ox / c);
    const z0 = Math.floor(oz / c);
    const x1 = Math.floor(hx / c);
    const z1 = Math.floor(hz / c);
    // Bresenham
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    let x = x0;
    let z = z0;
    let guard = 0;
    while (guard++ < 2000) {
      if (x === x1 && z === z1) break;
      this.bump(x, z, this.lFree);
      const e2 = 2 * err;
      if (e2 > -dz) {
        err -= dz;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        z += sz;
      }
    }
    if (hit) this.bump(x1, z1, this.lOcc);
    else this.bump(x1, z1, this.lFree);
    this.version++;
  }

  /** Mark a point observation (e.g. visual detection) as occupied without a ray. */
  markOccupied(x: number, z: number) {
    if (!Number.isFinite(x + z)) return;
    this.bump(Math.floor(x / this.cell), Math.floor(z / this.cell), this.lOcc);
    this.version++;
  }

  probability(x: number, z: number): number | null {
    const i = this.slot(Math.floor(x / this.cell), Math.floor(z / this.cell));
    return i < 0 ? null : 1 / (1 + Math.exp(-(this.lv[i] as number)));
  }

  /** Visit every cell with P(occupied) ≥ pMin without allocating. */
  forEachOccupied(pMin: number, fn: (x: number, z: number, p: number) => void) {
    const lMinOdds = Math.log(pMin / (1 - pMin));
    for (let i = 0; i < this.used.length; i++) {
      if (!this.used[i] || (this.lv[i] as number) < lMinOdds) continue;
      fn(((this.kx[i] as number) + 0.5) * this.cell, ((this.kz[i] as number) + 0.5) * this.cell, 1 / (1 + Math.exp(-(this.lv[i] as number))));
    }
  }

  occupiedCells(pMin = 0.65): { x: number; z: number; p: number }[] {
    const out: { x: number; z: number; p: number }[] = [];
    this.forEachOccupied(pMin, (x, z, p) => out.push({ x, z, p }));
    return out;
  }

  /** Number of cells with any evidence, and the area they cover (m²). */
  explored(): { cells: number; areaM2: number } {
    return { cells: this.n, areaM2: this.n * this.cell * this.cell };
  }

  clear() {
    this.used.fill(0);
    this.n = 0;
    this.version++;
  }
}
