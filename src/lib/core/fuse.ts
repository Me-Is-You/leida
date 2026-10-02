/**
 * Inverse-variance range fusion. Each source contributes a range with a 1σ
 * uncertainty; the mode weight scales how much the source is trusted
 * (precision × weight). Sources that disagree by > `gate`·σ are rejected
 * as outliers, and the conflict is reported instead of hidden.
 */
export interface RangeSource {
  id: "sonar" | "vision" | "depth";
  rangeM: number;
  sigmaM: number;
  /** Mode weight, any positive scale. */
  weight: number;
}

export interface FusedRange {
  rangeM: number | null;
  sigmaM: number | null;
  used: string[];
  rejected: string[];
  conflict: boolean;
}

export function fuseRanges(sources: RangeSource[], gate = 3): FusedRange {
  const valid = sources.filter(
    (s) => Number.isFinite(s.rangeM) && s.rangeM > 0 && s.sigmaM > 0 && s.weight > 0,
  );
  if (valid.length === 0) return { rangeM: null, sigmaM: null, used: [], rejected: [], conflict: false };
  if (valid.length === 1) {
    const s = valid[0] as RangeSource;
    return { rangeM: s.rangeM, sigmaM: s.sigmaM, used: [s.id], rejected: [], conflict: false };
  }
  // The most precise (weighted) source anchors the gate.
  const prec = (s: RangeSource) => s.weight / (s.sigmaM * s.sigmaM);
  const anchor = valid.reduce((a, b) => (prec(a) >= prec(b) ? a : b));
  const used: RangeSource[] = [anchor];
  const rejected: string[] = [];
  for (const s of valid) {
    if (s === anchor) continue;
    const tol = gate * Math.hypot(s.sigmaM, anchor.sigmaM);
    if (Math.abs(s.rangeM - anchor.rangeM) <= tol) used.push(s);
    else rejected.push(s.id);
  }
  let wsum = 0;
  let acc = 0;
  for (const s of used) {
    const p = prec(s);
    wsum += p;
    acc += p * s.rangeM;
  }
  // σ of the combination (unweighted precision, i.e. the true statistical σ)
  const trueP = used.reduce((a, s) => a + 1 / (s.sigmaM * s.sigmaM), 0);
  return {
    rangeM: acc / wsum,
    sigmaM: Math.sqrt(1 / trueP),
    used: used.map((s) => s.id),
    rejected,
    conflict: rejected.length > 0,
  };
}
