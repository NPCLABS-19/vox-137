import { validateSession } from "./model.js";
const openDB = () =>
  new Promise((resolve, reject) => {
    const r = indexedDB.open("vox-137", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("sessions");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function saveSession(state) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite");
      tx.objectStore("sessions").put(structuredClone(state), "current");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function loadSession() {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const r = db
        .transaction("sessions")
        .objectStore("sessions")
        .get("current");
      r.onsuccess = () => resolve(r.result ? validateSession(r.result) : null);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
function encode(data) {
  const bytes = new Uint8Array(data.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < data.length; i++) view.setFloat32(i * 4, data[i], true);
  let s = "";
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
function decode(text) {
  if (typeof text !== "string" || text.length > 8200000)
    throw Error("Audio payload is too large.");
  const str = atob(text);
  if (str.length % 4) throw Error("Invalid audio payload.");
  const bytes = Uint8Array.from(str, (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer),
    data = new Float32Array(bytes.length / 4);
  for (let i = 0; i < data.length; i++) data[i] = view.getFloat32(i * 4, true);
  return data;
}
export function packSession(s) {
  return JSON.stringify(s, (key, value) =>
    value instanceof Float32Array ? { pcm: encode(value) } : value,
  );
}
export function unpackSession(text) {
  if (text.length > 100000000)
    throw Error("Session exceeds the 100 MB import limit.");
  return validateSession(
    JSON.parse(text, (key, value) =>
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 1 &&
      typeof value.pcm === "string"
        ? decode(value.pcm)
        : value,
    ),
  );
}
// VOX-specific lossless stereo data carrier: one bit in both channels per audio frame.
export function backupWave(text) {
  const bytes = new TextEncoder().encode(text),
    header = new Uint8Array(12);
  header.set(new TextEncoder().encode("VOX13701"));
  new DataView(header.buffer).setUint32(8, bytes.length, true);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, 12);
  const length = all.length * 8,
    buffer = new ArrayBuffer(44 + length * 4),
    v = new DataView(buffer);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + length * 4, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, 44100, true);
  v.setUint32(28, 176400, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, length * 4, true);
  for (let n = 0; n < all.length; n++)
    for (let bit = 0; bit < 8; bit++) {
      const val = all[n] & (1 << bit) ? 12000 : -12000,
        o = 44 + (n * 8 + bit) * 4;
      v.setInt16(o, val, true);
      v.setInt16(o + 2, val, true);
    }
  return buffer;
}
export function readBackupWave(buffer) {
  const v = new DataView(buffer);
  if (buffer.byteLength < 44) throw Error("Invalid VOX backup WAV.");
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buffer, o, n));
  if (str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE")
    throw Error("Not a WAV file.");
  let dataOffset = 0,
    dataSize = 0,
    channels = 0,
    rate = 0,
    bits = 0,
    format = 0;
  for (let o = 12; o + 8 <= buffer.byteLength; ) {
    const tag = str(o, 4),
      len = v.getUint32(o + 4, true);
    if (o + 8 + len > buffer.byteLength) throw Error("Truncated WAV.");
    if (tag === "fmt " && len >= 16) {
      format = v.getUint16(o + 8, true);
      channels = v.getUint16(o + 10, true);
      rate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    }
    if (tag === "data") {
      dataOffset = o + 8;
      dataSize = len;
    }
    o += 8 + len + (len % 2);
  }
  if (
    format !== 1 ||
    channels !== 2 ||
    rate !== 44100 ||
    bits !== 16 ||
    dataSize < 384
  )
    throw Error("Use a lossless VOX stereo backup WAV.");
  const readByte = (n) => {
    let x = 0;
    for (let bit = 0; bit < 8; bit++)
      if (v.getInt16(dataOffset + (n * 8 + bit) * 4, true) > 0) x |= 1 << bit;
    return x;
  };
  const header = Uint8Array.from({ length: 12 }, (_, i) => readByte(i));
  if (new TextDecoder().decode(header.subarray(0, 8)) !== "VOX13701")
    throw Error("This is not a VOX backup. Hardware data is not supported.");
  const length = new DataView(header.buffer).getUint32(8, true);
  if (length > 100000000 || 12 + length > dataSize / 32)
    throw Error("Incomplete backup data.");
  const bytes = Uint8Array.from({ length }, (_, i) => readByte(12 + i));
  return new TextDecoder().decode(bytes);
}
