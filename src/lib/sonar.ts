import { renderChirp } from "./core/dsp.ts";
import { aggregateEchoes, processEcho, TRACE_BINS, type EchoResult, type SonarParams } from "./core/sonar-core.ts";
import type { SonarPing } from "./types";

export interface SonarConfig {
  tempC: number;
  spacingM: number;
  maxRangeM: number;
  minSnrDb: number;
  average: number;
  gain: number;
}

export const CHIRP_BAND: [number, number] = [18000, 21500];
export const CHIRP_DURATION = 0.045;
const RECORD_S = 0.55;
/** Chirp is scheduled this long after the recording starts (headroom for output latency). */
const LEAD_S = 0.08;

let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let node: AudioWorkletNode | null = null;
let mic: MediaStreamAudioSourceNode | null = null;
let busy = false;
let workletReady: Promise<void> | null = null;

export function sonarBusy() {
  return busy;
}

function buildParams(fs: number, cfg: SonarConfig): SonarParams {
  return {
    sampleRate: fs,
    chirp: renderChirp(fs, CHIRP_BAND[0], CHIRP_BAND[1], CHIRP_DURATION, 0, undefined, cfg.gain),
    chirpBand: CHIRP_BAND,
    chirpDuration: CHIRP_DURATION,
    tempC: cfg.tempC,
    maxRangeM: cfg.maxRangeM,
    minRangeM: 0.12,
    spacingM: cfg.spacingM,
    minSnrDb: cfg.minSnrDb,
  };
}

async function ensureGraph(): Promise<{ ctx: AudioContext; node: AudioWorkletNode; micRaw: boolean }> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("此浏览器不支持麦克风 (需要 HTTPS)");
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    workletReady = null;
    node = null;
    mic = null;
  }
  if (ctx.state === "suspended") await ctx.resume();
  if (ctx.sampleRate < 44100) throw new Error(`采样率 ${ctx.sampleRate} Hz 过低，无法发射 18–21.5 kHz chirp`);
  if (!workletReady) workletReady = ctx.audioWorklet.addModule("/worklets/capture.js");
  await workletReady;
  if (!stream || stream.getTracks().every((t) => t.readyState === "ended")) {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
    mic?.disconnect();
    mic = null;
  }
  if (!node) {
    node = new AudioWorkletNode(ctx, "aether-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
  }
  if (!mic) {
    mic = ctx.createMediaStreamSource(stream);
    mic.connect(node);
  }
  const s = stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings | undefined;
  const micRaw = !!s && s.echoCancellation === false && s.noiseSuppression === false && s.autoGainControl === false;
  return { ctx, node, micRaw };
}

function recordOnce(c: AudioContext, n: AudioWorkletNode, chirp: Float64Array | ArrayLike<number>): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const frames = Math.round(c.sampleRate * RECORD_S);
    const timer = window.setTimeout(() => {
      n.port.onmessage = null;
      n.port.postMessage({ cmd: "cancel" });
      reject(new Error("录音超时 (音频线程无响应)"));
    }, 3000);
    n.port.onmessage = (e: MessageEvent<{ samples: Float32Array }>) => {
      window.clearTimeout(timer);
      n.port.onmessage = null;
      resolve(e.data.samples);
    };
    n.port.postMessage({ cmd: "start", frames });
    const buf = c.createBuffer(1, chirp.length, c.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < chirp.length; i++) ch[i] = chirp[i] as number;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(c.currentTime + LEAD_S);
  });
}

function toPing(r: EchoResult, extra: { pings: number; accepted: number; sigmaM: number | null; micRaw: boolean | null; fs: number }): SonarPing {
  const ok = r.status === "ok" && r.distM !== null;
  return {
    t: Date.now(),
    distM: ok ? r.distM : null,
    status: r.status,
    message: r.message,
    snrDb: r.snrDb,
    confidence: r.confidence,
    directSnrDb: r.directSnrDb,
    peak: r.echoPeak,
    lagSamples: r.echoLag !== null && r.directLag !== null ? Math.round(r.echoLag - r.directLag) : null,
    dtUs: r.dtUs,
    pings: extra.pings,
    accepted: extra.accepted,
    sigmaM: extra.sigmaM,
    echoes: r.echoes,
    source: ok ? "device" : "none",
    trace: r.trace,
    micRaw: extra.micRaw,
  };
}

function errorPing(message: string): SonarPing {
  return {
    t: Date.now(),
    distM: null,
    status: "error",
    message,
    snrDb: 0,
    confidence: 0,
    directSnrDb: 0,
    peak: 0,
    lagSamples: null,
    dtUs: null,
    pings: 0,
    accepted: 0,
    sigmaM: null,
    echoes: [],
    source: "none",
    trace: new Array<number>(TRACE_BINS).fill(0),
    micRaw: null,
  };
}

/**
 * One real measurement (average of `cfg.average` chirps). Must be invoked from
 * a user gesture the first time (microphone permission + AudioContext).
 * Never fabricates a distance: when nothing is heard the ping has distM = null.
 */
export async function pingSonar(cfg: SonarConfig): Promise<SonarPing> {
  if (busy) return errorPing("上一次脉冲尚未结束");
  busy = true;
  try {
    const g = await ensureGraph();
    const params = buildParams(g.ctx.sampleRate, cfg);
    const results: EchoResult[] = [];
    for (let i = 0; i < cfg.average; i++) {
      const rec = await recordOnce(g.ctx, g.node, params.chirp);
      results.push(processEcho(rec, params));
      if (i < cfg.average - 1) await new Promise((r) => setTimeout(r, 120));
    }
    const agg = aggregateEchoes(results);
    const okRes = results.filter((r) => r.status === "ok");
    const dists = okRes.map((r) => r.distM as number);
    const mean = dists.reduce((s, d) => s + d, 0) / (dists.length || 1);
    const sigma = dists.length > 1 ? Math.sqrt(dists.reduce((s, d) => s + (d - mean) ** 2, 0) / (dists.length - 1)) : null;
    return toPing(agg, { pings: results.length, accepted: okRes.length, sigmaM: sigma, micRaw: g.micRaw, fs: g.ctx.sampleRate });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorPing(/Permission|NotAllowed/i.test(msg) ? "麦克风权限被拒绝" : msg);
  } finally {
    busy = false;
  }
}

export function audioLatencyInfo(): { sampleRate: number; baseLatencyMs: number; outputLatencyMs: number } | null {
  if (!ctx) return null;
  return {
    sampleRate: ctx.sampleRate,
    baseLatencyMs: (ctx.baseLatency || 0) * 1000,
    outputLatencyMs: ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0) * 1000,
  };
}

export function stopSonar() {
  mic?.disconnect();
  mic = null;
  node?.disconnect();
  node = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  void ctx?.close().catch(() => undefined);
  ctx = null;
  workletReady = null;
}

export function buildChirpPreview(cfg?: Partial<SonarConfig>): number[] {
  const fs = 48000;
  const data = renderChirp(fs, CHIRP_BAND[0], CHIRP_BAND[1], CHIRP_DURATION, 0, undefined, cfg?.gain ?? 0.8);
  // Show a 2 ms slice at native rate so the waveform is readable, not aliased.
  const n = Math.min(data.length, Math.round(fs * 0.0045));
  const mid = Math.floor(data.length / 2) - Math.floor(n / 2);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(data[mid + i] ?? 0);
  return out;
}

export function chirpEnvelopePreview(): number[] {
  const data = renderChirp(48000, CHIRP_BAND[0], CHIRP_BAND[1], CHIRP_DURATION, 0, undefined, 1);
  const bins = 80;
  const step = Math.floor(data.length / bins);
  const out: number[] = [];
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (let i = 0; i < step; i++) m = Math.max(m, Math.abs(data[b * step + i] ?? 0));
    out.push(m);
  }
  return out;
}
