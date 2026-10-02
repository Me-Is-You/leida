/**
 * Minimal runtime schema validator (≈120 lines, zero dependencies) with full
 * static type inference. Replaces zod for settings / session files.
 *
 * Semantics: unknown object keys are stripped; `undefined` falls back to the
 * schema default when one exists; every failure reports a dotted path.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; path: (string | number)[]; message: string };

export interface Sch<T> {
  parse(v: unknown, path?: (string | number)[]): Result<T>;
  readonly hasDefault: boolean;
  readonly def?: T;
  /** Marks the key optional in object types. */
  readonly optional?: true;
}

export type Infer<S> = S extends Sch<infer T> ? T : never;

const fail = (path: (string | number)[], message: string): Result<never> => ({ ok: false, path, message });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });

function withDef<T>(parse: Sch<T>["parse"], hasDefault: boolean, def?: T): Sch<T> {
  return { parse, hasDefault, def };
}

export function num(o: { min?: number; max?: number; int?: boolean; def?: number } = {}): Sch<number> {
  const hasDefault = o.def !== undefined;
  return withDef<number>(
    (v, path = []) => {
      if (v === undefined && hasDefault) return ok(o.def as number);
      if (typeof v !== "number" || !Number.isFinite(v)) return fail(path, "must be a finite number");
      if (o.int && !Number.isInteger(v)) return fail(path, "must be an integer");
      if (o.min !== undefined && v < o.min) return fail(path, `must be ≥ ${o.min}`);
      if (o.max !== undefined && v > o.max) return fail(path, `must be ≤ ${o.max}`);
      return ok(v);
    },
    hasDefault,
    o.def,
  );
}

export function str(o: { max?: number; def?: string } = {}): Sch<string> {
  const hasDefault = o.def !== undefined;
  return withDef<string>(
    (v, path = []) => {
      if (v === undefined && hasDefault) return ok(o.def as string);
      if (typeof v !== "string") return fail(path, "must be a string");
      if (o.max !== undefined && v.length > o.max) return fail(path, `must be ≤ ${o.max} chars`);
      return ok(v);
    },
    hasDefault,
    o.def,
  );
}

export function bool(def?: boolean): Sch<boolean> {
  return withDef<boolean>(
    (v, path = []) => {
      if (v === undefined && def !== undefined) return ok(def);
      return typeof v === "boolean" ? ok(v) : fail(path, "must be a boolean");
    },
    def !== undefined,
    def,
  );
}

export function oneOf<const V extends readonly (string | number)[]>(values: V, def?: V[number]): Sch<V[number]> & { options: V } {
  const s = withDef<V[number]>(
    (v, path = []) => {
      if (v === undefined && def !== undefined) return ok(def);
      return (values as readonly unknown[]).includes(v) ? ok(v as V[number]) : fail(path, `must be one of ${values.join(" | ")}`);
    },
    def !== undefined,
    def,
  );
  return Object.assign(s, { options: values });
}

export function arr<T>(item: Sch<T>, o: { max?: number; def?: T[] } = {}): Sch<T[]> {
  const hasDefault = o.def !== undefined;
  return withDef<T[]>(
    (v, path = []) => {
      if (v === undefined && hasDefault) return ok(o.def as T[]);
      if (!Array.isArray(v)) return fail(path, "must be an array");
      if (o.max !== undefined && v.length > o.max) return fail(path, `must have ≤ ${o.max} items`);
      const out: T[] = new Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const r = item.parse(v[i], [...path, i]);
        if (!r.ok) return r;
        out[i] = r.value;
      }
      return ok(out);
    },
    hasDefault,
    o.def,
  );
}

export function opt<T>(s: Sch<T>): Sch<T | undefined> & { optional: true } {
  return {
    parse: (v, path) => (v === undefined ? ok(undefined) : s.parse(v, path)),
    hasDefault: true,
    def: undefined,
    optional: true,
  };
}

type OptKeys<S> = { [K in keyof S]: S[K] extends { optional: true } ? K : never }[keyof S];
export type InferObj<S> = { [K in Exclude<keyof S, OptKeys<S>>]: Infer<S[K]> } & { [K in OptKeys<S>]?: Infer<S[K]> };

export interface ObjSchema<S extends Record<string, Sch<unknown>>> extends Sch<InferObj<S>> {
  /** Parse leniently: every field that fails (and has a default) is replaced by its default. */
  salvage(v: unknown): InferObj<S> | null;
  shape: S;
}

export function obj<S extends Record<string, Sch<unknown>>>(shape: S, o: { def?: InferObj<S> } = {}): ObjSchema<S> {
  const keys = Object.keys(shape) as (keyof S & string)[];
  const parse: Sch<InferObj<S>>["parse"] = (v, path = []) => {
    if (v === undefined && o.def !== undefined) return ok(o.def);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(path, "must be an object");
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const r = (shape[k] as Sch<unknown>).parse((v as Record<string, unknown>)[k], [...path, k]);
      if (!r.ok) return r;
      if (r.value !== undefined) out[k] = r.value;
    }
    return ok(out as InferObj<S>);
  };
  const salvage = (v: unknown): InferObj<S> | null => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const f = shape[k] as Sch<unknown>;
      const r = f.parse((v as Record<string, unknown>)[k], [k]);
      if (r.ok) {
        if (r.value !== undefined) out[k] = r.value;
      } else if (f.hasDefault) {
        if (f.def !== undefined) out[k] = f.def;
      } else return null;
    }
    return out as InferObj<S>;
  };
  return { parse, hasDefault: o.def !== undefined, def: o.def, salvage, shape };
}

export const issueText = (r: { path: (string | number)[]; message: string }) => `${r.path.join(".") || "root"}: ${r.message}`;
