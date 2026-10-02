/**
 * Bounded point clouds: one ring buffer per kind, voxel de-duplication (so a
 * static wall seen 1000 times is one point, not 1000) and PLY export.
 */

export type CloudKind = "person" | "object" | "wall" | "free" | "traj" | "sonar";
export const CLOUD_KINDS: CloudKind[] = ["person", "object", "wall", "free", "traj", "sonar"];

export class PointRing {
  readonly capacity: number;
  readonly voxel: number;
  /** xyz triplets, only the first `size` points are valid (ring order). */
  readonly pos: Float32Array;
  readonly time: Float32Array;
  private readonly keys: (string | null)[];
  private readonly index = new Map<string, number>();
  private head = 0;
  size = 0;
  version = 0;

  constructor(capacity: number, voxel: number) {
    this.capacity = capacity;
    this.voxel = voxel;
    this.pos = new Float32Array(capacity * 3);
    this.time = new Float32Array(capacity);
    this.keys = new Array<string | null>(capacity).fill(null);
  }

  private keyOf(x: number, y: number, z: number): string {
    const v = this.voxel;
    return `${Math.round(x / v)},${Math.round(y / v)},${Math.round(z / v)}`;
  }

  /** Returns true when a *new* point was stored. Re-observing a voxel refreshes it. */
  add(x: number, y: number, z: number, t = 0): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    const k = this.keyOf(x, y, z);
    const hit = this.index.get(k);
    if (hit !== undefined) {
      // running average keeps the voxel centred on its observations
      const o = hit * 3;
      this.pos[o] = (this.pos[o] as number) * 0.8 + x * 0.2;
      this.pos[o + 1] = (this.pos[o + 1] as number) * 0.8 + y * 0.2;
      this.pos[o + 2] = (this.pos[o + 2] as number) * 0.8 + z * 0.2;
      this.time[hit] = t;
      return false;
    }
    const slot = this.head;
    const old = this.keys[slot];
    if (old) this.index.delete(old);
    this.keys[slot] = k;
    this.index.set(k, slot);
    this.pos[slot * 3] = x;
    this.pos[slot * 3 + 1] = y;
    this.pos[slot * 3 + 2] = z;
    this.time[slot] = t;
    this.head = (slot + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
    this.version++;
    return true;
  }

  clear() {
    this.index.clear();
    this.keys.fill(null);
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
