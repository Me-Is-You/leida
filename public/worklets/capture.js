/* AudioWorklet: records exactly N frames from the microphone on request.
 * Runs on the audio thread, so there are no dropped buffers like with
 * AnalyserNode polling. Protocol: main → {cmd:"start", frames}; worklet → {samples, startFrame}. */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = null;
    this.n = 0;
    this.want = 0;
    this.startFrame = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.cmd === "start") {
        this.want = Math.max(128, d.frames | 0);
        this.buf = new Float32Array(this.want);
        this.n = 0;
        this.startFrame = currentFrame;
      } else if (d.cmd === "cancel") {
        this.buf = null;
      }
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.buf && ch) {
      const take = Math.min(ch.length, this.want - this.n);
      this.buf.set(ch.subarray(0, take), this.n);
      this.n += take;
      if (this.n >= this.want) {
        const out = this.buf;
        this.buf = null;
        this.port.postMessage({ samples: out, startFrame: this.startFrame }, [out.buffer]);
      }
    }
    return true;
  }
}

registerProcessor("aether-capture", CaptureProcessor);
