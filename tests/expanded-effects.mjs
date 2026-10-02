import assert from "node:assert/strict";
import {
  VOICES,
  EFFECTS,
  KO_EFFECTS,
  createState,
  validateSession,
} from "../dist/model.js";
import {
  Engine,
  starterSample,
  renderVocal,
  renderKOEffect,
} from "../dist/engine.js";
const sample = starterSample(0);
const params = { pitch: 0, formant: 0, start: 0, speed: 1 };
assert.equal(VOICES.length, 16);
assert.ok(!VOICES.includes("synth"));
assert.equal(KO_EFFECTS.length, 16);
const signatures = new Set();
for (let voice = 0; voice < VOICES.length; voice++) {
  const rendered = renderVocal(sample, params, voice);
  assert.ok(rendered.data.every(Number.isFinite), VOICES[voice]);
  assert.ok(
    rendered.data.some((v) => Math.abs(v) > 0.001),
    VOICES[voice],
  );
  if (voice >= 7)
    signatures.add(
      Array.from(rendered.data.slice(3000, 3100))
        .map((v) => v.toFixed(4))
        .join(","),
    );
}
assert.equal(signatures.size, 9, "new characters have distinct output");
for (const fx of [21, 22, 26, 27]) {
  const out = renderKOEffect(sample, fx);
  assert.ok(out.data.every(Number.isFinite));
  assert.ok(out.data.some((v, i) => Math.abs(v - sample.data[i]) > 0.001));
}
const state = createState();
state.samples = Array.from({ length: 15 }, (_, i) => starterSample(i));
state.voice = 15;
state.patterns[0].steps[0].voice = {
  slot: 0,
  note: 0,
  params: null,
  voice: 15,
};
for (const fx of KO_EFFECTS) {
  state.patterns[0].effects[0] = fx;
  validateSession(state);
  const engine = new Engine();
  engine.ctx = {};
  const calls = [];
  engine.play = (...args) => calls.push(args);
  engine.trigger(
    state,
    { voice: { slot: 0, note: 0 }, drum: { hit: 0 }, multiplier: 1 },
    fx,
    0,
    0.125,
  );
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((c) => Number.isFinite(c[5])));
  assert.ok(calls.every((c) => c[8] === fx));
  if (fx === 23) assert.equal(calls[0][1].pitch, 12);
  if (fx === 24) assert.equal(calls[0][1].pitch, -12);
}
assert.equal(EFFECTS.length, 19);
console.log(
  "PASS: 16 finite voice modes, distinct new characters, K.O. audio transforms, 16 effect routes and backup validation.",
);
