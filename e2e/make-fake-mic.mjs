// Writes a 48 kHz mono WAV that looks like a microphone hearing our own chirp train:
// a direct arrival every 0.2 s plus one room echo at the given distance and strength.
import { writeFileSync } from "node:fs";
const [out = "fake-mic.wav", dist = "1.5", echoGain = "0.3"] = process.argv.slice(2);
const fs = 48000;
const spacing = 0.06;
const c = 331.3 + 0.606 * 22;
const dt = (2 * Number(dist) - spacing) / c;
const chirpN = Math.floor(fs * 0.045);
const f0 = 18000, f1 = 21500, dur = 0.045;
const chirp = new Float32Array(chirpN);
for (let i = 0; i < chirpN; i++) {
  const t = i / fs;
  const hann = 0.5 * (1 - Math.cos((2 * Math.PI * t) / dur));
  chirp[i] = Math.sin(2 * Math.PI * (f0 * t + 0.5 * ((f1 - f0) / dur) * t * t)) * hann;
}
const N = fs * 2;
const x = new Float32Array(N);
let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < N; i++) x[i] = (rnd() - 0.5) * 0.004;
for (let start = Math.floor(0.05 * fs); start + chirpN < N; start += Math.floor(0.2 * fs)) {
  const eo = start + Math.round(dt * fs);
  for (let i = 0; i < chirpN; i++) {
    x[start + i] += 0.6 * chirp[i];
    if (eo + i < N) x[eo + i] += 0.6 * Number(echoGain) * chirp[i];
  }
}
const buf = Buffer.alloc(44 + N * 2);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 2, 4); buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(fs, 24); buf.writeUInt32LE(fs * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
writeFileSync(out, buf);
console.log(`wrote ${out}: echo at ${dist} m (Δt ${(dt * 1000).toFixed(2)} ms), gain ${echoGain}`);
