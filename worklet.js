class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.enabled = false;
    this.chunks = [[], []];
    this.size = 0;
    this.port.onmessage = ({ data }) => {
      if (!data.record) {
        if (this.size) this.flush();
        this.port.postMessage({ kind: "finished" });
      }
      this.enabled = data.record;
    };
  }
  flush() {
    const out = this.chunks.map((a) => {
      const r = new Float32Array(this.size);
      let i = 0;
      for (const x of a) {
        r.set(x, i);
        i += x.length;
      }
      return r;
    });
    this.port.postMessage(
      { kind: "chunk", channels: out },
      out.map((a) => a.buffer),
    );
    this.chunks = [[], []];
    this.size = 0;
  }
  process(inputs, outputs) {
    const inp = inputs[0],
      out = outputs[0];
    if (!inp?.length) return true;
    for (let c = 0; c < out.length; c++) out[c].set(inp[c] || inp[0]);
    if (this.enabled) {
      for (let c = 0; c < 2; c++)
        this.chunks[c].push(new Float32Array(inp[c] || inp[0]));
      this.size += inp[0].length;
      if (this.size >= 2048) this.flush();
    }
    return true;
  }
}
class Input extends Capture {
  constructor(o) {
    super(o);
    this.lastPulse = -1;
    this.above = false;
    this.levelFrames = 0;
  }
  process(inputs, outputs) {
    super.process(inputs, outputs);
    const inp = inputs[0];
    if (!inp?.length) return true;
    const left = inp[0];
    let peak = 0;
    for (let i = 0; i < left.length; i++) {
      const x = Math.abs(left[i]);
      peak = Math.max(peak, x);
      const t = currentTime + i / sampleRate;
      if (x > 0.25 && !this.above && t - this.lastPulse > 0.045) {
        this.lastPulse = t;
        this.port.postMessage({ kind: "clock", time: t });
      }
      this.above = x > 0.12;
    }
    if (++this.levelFrames % 12 === 0)
      this.port.postMessage({ kind: "level", level: peak });
    return true;
  }
}
registerProcessor("vox-capture", Capture);
registerProcessor("vox-input", Input);
