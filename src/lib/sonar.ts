import { startMic } from "./device";
import { pingFromDistance } from "./engine";
import type { SampleSource, SonarPing } from "./types";

let ctx: AudioContext | null = null;

function getCtx() {
  if (!ctx) ctx = new AudioContext({ sampleRate: 48000 });
  return ctx;
}

function makeChirp(sampleRate: number, duration = 0.045) {
  const n = Math.floor(sampleRate * duration);
  const data = new Float32Array(n);
  const f0 = 18000;
  const f1 = 21500;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = f0 + (f1 - f0) * (t / duration);
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    data[i] = Math.sin(2 * Math.PI * f * t) * hann * 0.92;
  }
  return data;
}

function xcorrPeak(signal: Float32Array, kernel: Float32Array) {
  const maxLag = Math.min(signal.length - kernel.length, 6000);
  let best = -Infinity;
  let lag = 0;
  for (let l = 0; l < maxLag; l += 2) {
    let s = 0;
    for (let i = 0; i < kernel.length; i += 4) s += signal[l + i] * kernel[i];
    if (s > best) {
      best = s;
      lag = l;
    }
  }
  return { lag, peak: best };
}

export async function pingSonar(fallbackM: number): Promise<SonarPing> {
  const t = performance.now();
  try {
    const audio = getCtx();
    if (audio.state === "suspended") await audio.resume();
    const chirp = makeChirp(audio.sampleRate);
    const buf = audio.createBuffer(1, chirp.length, audio.sampleRate);
    buf.copyToChannel(chirp, 0);

    const stream = await startMic();
    const mic = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    mic.connect(analyser);

    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(audio.destination);

    const captured = new Float32Array(audio.sampleRate * 0.12);
    let offset = 0;
    const t0 = audio.currentTime;
    src.start();

    await new Promise<void>((resolve) => {
      const step = () => {
        const td = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(td);
        const take = Math.min(td.length, captured.length - offset);
        captured.set(td.subarray(0, take), offset);
        offset += take;
        if (audio.currentTime - t0 < 0.11 && offset < captured.length) {
          requestAnimationFrame(step);
        } else resolve();
      };
      step();
    });

    const { lag, peak } = xcorrPeak(captured, chirp);
    const dt = lag / audio.sampleRate;
    const distM = (dt * 343) / 2;
    const plausible = distM > 0.05 && distM < 8 && peak > 0.002;
    const source: SampleSource = plausible ? "device" : "twin";
    const used = plausible ? distM : fallbackM;
    const ping = pingFromDistance(used, source);
    return { ...ping, t, peak: plausible ? peak : ping.peak, lagSamples: lag, dtUs: dt * 1e6 };
  } catch {
    const ping = pingFromDistance(fallbackM, "twin");
    return { ...ping, t };
  }
}

export function buildChirpPreview(): number[] {
  const data = makeChirp(48000, 0.045);
  const step = Math.floor(data.length / 80);
  const out: number[] = [];
  for (let i = 0; i < 80; i++) out.push(data[i * step] ?? 0);
  return out;
}
