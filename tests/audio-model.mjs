import assert from "node:assert/strict";
import {
  createState,
  setStep,
  copyPattern,
  validateSession,
} from "../dist/model.js";
import {
  starterSample,
  drumSample,
  renderVocal,
  toWav,
} from "../dist/engine.js";
import {
  packSession,
  unpackSession,
  backupWave,
  readBackupWave,
} from "../dist/storage.js";
const state = createState();
state.samples = Array.from({ length: 15 }, (_, i) => starterSample(i));
validateSession(state);
state.pattern = 15;
setStep(state, 3, 7);
assert.equal(state.patterns[15].steps[3].voice.note, 7);
setStep(state, 3, 7);
assert.equal(state.patterns[15].steps[3].voice, null);
state.sound = 15;
state.drumHit = 7;
setStep(state, 3);
assert.equal(state.patterns[15].steps[3].drum.hit, 7);
copyPattern(state, 14);
state.patterns[15].steps[3].multiplier = 8;
assert.equal(state.patterns[14].steps[3].multiplier, 1);
state.locked = true;
assert.equal(setStep(state, 5), false);
state.locked = false;
const packed = packSession(state),
  restored = unpackSession(packed);
assert.deepEqual(restored, state);
assert.equal(readBackupWave(backupWave(packed)), packed);
const invalid = JSON.parse(packed);
invalid.bpm = Infinity;
assert.throws(() => unpackSession(JSON.stringify(invalid)));
assert.throws(() => readBackupWave(new ArrayBuffer(20)));
const sample = state.samples[0],
  params = { pitch: 0, formant: 0, start: 0, speed: 1 };
const rms = (a) => Math.sqrt(a.reduce((n, x) => n + x * x, 0) / a.length);
const outputs = [];
for (let v = 0; v < 8; v++) {
  const rendered = renderVocal(sample, params, v);
  assert.ok(rendered.data.every(Number.isFinite));
  assert.ok(rms(rendered.data) > 0.001, `voice ${v} silent`);
  outputs.push(rendered.data);
}
for (let i = 1; i < outputs.length; i++) {
  if (i === 1) continue;
  assert.notDeepEqual(outputs[i], outputs[0], `voice ${i} same as neutral`);
}
for (let hit = 0; hit < 16; hit++) {
  const s = drumSample(hit);
  assert.ok(s.data.every(Number.isFinite));
  assert.ok(rms(s.data) > 0.005, `drum ${hit} silent`);
}
const slow = renderVocal(sample, { ...params, speed: 0.5 }, 0);
assert.ok(slow.data.length > sample.data.length * 1.9);
const shifted = renderVocal(sample, { ...params, pitch: 12 }, 0);
assert.equal(shifted.data.length, sample.data.length);
const reverse = renderVocal(sample, params, 0, 0, true);
assert.equal(reverse.data[10], outputs[0][outputs[0].length - 11]);
const wav = toWav([outputs[0], outputs[0]], 22050),
  view = new DataView(wav);
assert.equal(view.getUint16(22, true), 2);
assert.equal(view.getUint32(24, true), 22050);
assert.equal(view.getUint32(40, true), outputs[0].length * 4);
console.log(
  "PASS: sequence edits, isolated copies, lock guard, validation, JSON/WAV backup round trips, 8 voice modes, 16 drums, independent speed/pitch, reverse, stereo WAV.",
);
