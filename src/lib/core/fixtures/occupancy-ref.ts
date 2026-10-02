// Reference implementation (Map based) kept for equivalence tests only.
/** Sparse log-odds occupancy grid (2-D, x/z) updated by range rays. */
export class OccupancyGrid {
  readonly cell: number;
  private readonly l = new Map<number, number>();
  private readonly lFree: number;
  private readonly lOcc: number;
  private readonly lMin = -4;
  private readonly lMax = 5;
  version = 0;

  constructor(cell = 0.25, pFree = 0.35, pOcc = 0.72) {
    this.cell = cell;
    this.lFree = Math.log(pFree / (1 - pFree));
    this.lOcc = Math.log(pOcc / (1 - pOcc));
  }

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  private bump(ix: number, iz: number, d: number) {
    const k = this.key(ix, iz);
    const v = Math.max(this.lMin, Math.min(this.lMax, (this.l.get(k) ?? 0) + d));
    this.l.set(k, v);
  }

  /**
   * Integrate one ray from (ox,oz) to (hx,hz). `hit=false` means the ray
   * reached max range without a return: all cells are free, none occupied.
   */
  integrateRay(ox: number, oz: number, hx: number, hz: number, hit = true) {
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
    this.bump(Math.floor(x / this.cell), Math.floor(z / this.cell), this.lOcc);
    this.version++;
  }

  probability(x: number, z: number): number | null {
    const v = this.l.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    return v === undefined ? null : 1 / (1 + Math.exp(-v));
  }

  occupiedCells(pMin = 0.65): { x: number; z: number; p: number }[] {
    const out: { x: number; z: number; p: number }[] = [];
    for (const [k, v] of this.l) {
      const p = 1 / (1 + Math.exp(-v));
      if (p < pMin) continue;
      const ix = Math.floor(k / 65536) - 32768;
      const iz = (k % 65536) - 32768;
      out.push({ x: (ix + 0.5) * this.cell, z: (iz + 0.5) * this.cell, p });
    }
    return out;
  }

  /** Number of cells with any evidence, and the area they cover (m²). */
  explored(): { cells: number; areaM2: number } {
    return { cells: this.l.size, areaM2: this.l.size * this.cell * this.cell };
  }

  clear() {
    this.l.clear();
    this.version++;
  }
}
