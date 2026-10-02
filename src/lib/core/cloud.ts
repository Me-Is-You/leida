/**
 * Bounded point clouds: one ring buffer per kind, voxel de-duplication (so a
 * static wall seen 1000 times is one point, not 1000) and PLY export.
 */

export type CloudKind = "person" | "object" | "wall" | "free" | "traj" | "sonar";
export const CLOUD_KINDS: CloudKind[] = ["person", "object", "wall", "free", "traj", "sonar"];

/**
 * Fixed-capacity point ring with voxel de-duplication. The voxel index lives
 * in an open-addressing hash table over typed arrays (linear probing,
 * backward-shift deletion): no string keys, no per-point allocation, so adding
 * 20 000 points produces no garbage for the GC to collect mid-frame.
 */
export class PointRing {
  readonly capacity: number;
  readonly voxel: number;
  /** xyz triplets, only the first `size` points are valid (ring order). */
  readonly pos: Float32Array;
  readonly time: Float32Array;
  private readonly slotKey: Int32Array; // voxel (ix,iy,iz) of each occupied slot
  private readonly slotLive: Uint8Array;
  private readonly tab: Int32Array; // hash table → slot index, −1 = empty
  private readonly mask: number;
  private head = 0;
  size = 0;
  version = 0;

  constructor(capacity: number, voxel: number) {
    this.capacity = capacity;
    this.voxel = voxel;
    this.pos = new Float32Array(capacity * 3);
    this.time = new Float32Array(capacity);
    this.slotKey = new Int32Array(capacity * 3);
    this.slotLive = new Uint8Array(capacity);
    let t = 8;
    while (t < capacity * 2) t <<= 1;
    this.tab = new Int32Array(t).fill(-1);
    this.mask = t - 1;
  }

  private hash(ix: number, iy: number, iz: number): number {
    let h = Math.imul(ix, 0x9e3779b1) ^ Math.imul(iy, 0x85ebca6b) ^ Math.imul(iz, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 13;
    return h & this.mask;
  }

  /** Table position holding voxel (ix,iy,iz), or the empty position where it would go (as ~pos). */
  private probe(ix: number, iy: number, iz: number): number {
    const { tab, slotKey, mask } = this;
    let i = this.hash(ix, iy, iz);
    for (;;) {
      const s = tab[i] as number;
      if (s < 0) return ~i;
      const o = s * 3;
      if (slotKey[o] === ix && slotKey[o + 1] === iy && slotKey[o + 2] === iz) return i;
      i = (i + 1) & mask;
    }
  }

  private removeAt(pos: number) {
    const { tab, slotKey, mask } = this;
    let i = pos;
    let j = pos;
    for (;;) {
      j = (j + 1) & mask;
      const s = tab[j] as number;
      if (s < 0) break;
      const o = s * 3;
      const ideal = this.hash(slotKey[o] as number, slotKey[o + 1] as number, slotKey[o + 2] as number);
      // can the entry at j move back into the hole at i without breaking its probe chain?
      if (((j - ideal) & mask) >= ((j - i) & mask)) {
        tab[i] = s;
        i = j;
      }
    }
    tab[i] = -1;
  }

  /** Returns true when a *new* point was stored. Re-observing a voxel refreshes it. */
  add(x: number, y: number, z: number, t = 0): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    const inv = 1 / this.voxel;
    const ix = Math.round(x * inv) | 0;
    const iy = Math.round(y * inv) | 0;
    const iz = Math.round(z * inv) | 0;
    const found = this.probe(ix, iy, iz);
    if (found >= 0) {
      const hit = this.tab[found] as number;
      // running average keeps the voxel centred on its observations
      const o = hit * 3;
      this.pos[o] = (this.pos[o] as number) * 0.8 + x * 0.2;
      this.pos[o + 1] = (this.pos[o + 1] as number) * 0.8 + y * 0.2;
      this.pos[o + 2] = (this.pos[o + 2] as number) * 0.8 + z * 0.2;
      this.time[hit] = t;
      return false;
    }
    const slot = this.head;
    if (this.slotLive[slot]) {
      const o = slot * 3;
      const old = this.probe(this.slotKey[o] as number, this.slotKey[o + 1] as number, this.slotKey[o + 2] as number);
      if (old >= 0) this.removeAt(old);
    }
    // the eviction may have shifted entries, so probe the insertion point again
    const at = ~this.probe(ix, iy, iz);
    this.tab[at] = slot;
    this.slotKey[slot * 3] = ix;
    this.slotKey[slot * 3 + 1] = iy;
    this.slotKey[slot * 3 + 2] = iz;
    this.slotLive[slot] = 1;
    this.pos[slot * 3] = x;
    this.pos[slot * 3 + 1] = y;
    this.pos[slot * 3 + 2] = z;
    this.time[slot] = t;
    this.head = slot + 1 === this.capacity ? 0 : slot + 1;
    this.size = Math.min(this.size + 1, this.capacity);
    this.version++;
    return true;
  }

  clear() {
    this.tab.fill(-1);
    this.slotLive.fill(0);
    this.head = 0;
    this.size = 0;
    this.version++;
  }

  /** Copy of the valid positions (length = size·3). */
  positions(): Float32Array {
    return this.pos.slice(0, this.size * 3);
  }
}

export class PointCloud {
  readonly rings: Record<CloudKind, PointRing>;

  constructor(capacity: Partial<Record<CloudKind, number>> = {}, voxel = 0.08) {
    const cap = { person: 4000, object: 8000, wall: 12000, free: 6000, traj: 2000, sonar: 3000, ...capacity };
    this.rings = {
      person: new PointRing(cap.person, voxel * 0.8),
      object: new PointRing(cap.object, voxel),
      wall: new PointRing(cap.wall, voxel * 1.2),
      free: new PointRing(cap.free, voxel * 2.5),
      traj: new PointRing(cap.traj, voxel * 0.5),
      sonar: new PointRing(cap.sonar, voxel),
    };
  }

  add(kind: CloudKind, x: number, y: number, z: number, t = 0): boolean {
    return this.rings[kind].add(x, y, z, t);
  }

  get version(): number {
    let v = 0;
    for (const k of CLOUD_KINDS) v += this.rings[k].version;
    return v;
  }

  get total(): number {
    let n = 0;
    for (const k of CLOUD_KINDS) n += this.rings[k].size;
    return n;
  }

  counts(): Record<CloudKind, number> {
    const out = {} as Record<CloudKind, number>;
    for (const k of CLOUD_KINDS) out[k] = this.rings[k].size;
    return out;
  }

  clear() {
    for (const k of CLOUD_KINDS) this.rings[k].clear();
  }

  toJSON(): { kind: CloudKind; x: number; y: number; z: number; t: number }[] {
    const out: { kind: CloudKind; x: number; y: number; z: number; t: number }[] = [];
    for (const kind of CLOUD_KINDS) {
      const r = this.rings[kind];
      for (let i = 0; i < r.size; i++) {
        out.push({
          kind,
          x: round(r.pos[i * 3] as number),
          y: round(r.pos[i * 3 + 1] as number),
          z: round(r.pos[i * 3 + 2] as number),
          t: round(r.time[i] as number),
        });
      }
    }
    return out;
  }

  /** ASCII PLY, Y-up like the on-screen scene (x east, y up, z north). */
  toPly(): string {
    const color: Record<CloudKind, [number, number, number]> = {
      person: [143, 180, 184],
      object: [199, 189, 163],
      wall: [102, 107, 117],
      free: [115, 158, 133],
      traj: [196, 166, 115],
      sonar: [184, 199, 214],
    };
    const lines: string[] = [];
    for (const kind of CLOUD_KINDS) {
      const r = this.rings[kind];
      const c = color[kind];
      for (let i = 0; i < r.size; i++) {
        lines.push(
          `${(r.pos[i * 3] as number).toFixed(3)} ${(r.pos[i * 3 + 1] as number).toFixed(3)} ${(r.pos[i * 3 + 2] as number).toFixed(3)} ${c[0]} ${c[1]} ${c[2]}`,
        );
      }
    }
    return [
      "ply",
      "format ascii 1.0",
      "comment AETHER point cloud (x east, y up, z north, metres)",
      `element vertex ${lines.length}`,
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "end_header",
      ...lines,
      "",
    ].join("\n");
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
