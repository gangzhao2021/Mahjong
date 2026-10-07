/**
 * Synthesizes the game's placeholder sound effects and background music as
 * 16-bit mono WAV files in assets/sounds. Replace with recorded / licensed
 * audio before release; rerun with `node scripts/generate-sounds.mjs`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets/sounds');

/** Deterministic noise so regenerated files are identical. */
let seed = 1;
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x7fffffff) * 2 - 1;
};

const buffer = (seconds) => new Float32Array(Math.ceil(seconds * RATE));

/** Adds a decaying tone (with a couple of soft harmonics) starting at `start` seconds. */
function tone(buf, { start = 0, freq, dur, gain = 0.3, decay = 6, harmonics = [1, 0.3, 0.1], attack = 0.004 }) {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor(dur * RATE);
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / attack) * Math.exp(-decay * t);
    let v = 0;
    harmonics.forEach((h, k) => (v += h * Math.sin(2 * Math.PI * freq * (k + 1) * t)));
    buf[s0 + i] += gain * env * v;
  }
}

/** Adds a short filtered noise burst — the "click" of tiles. */
function click(buf, { start = 0, dur = 0.03, gain = 0.5, smooth = 0.55 }) {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor(dur * RATE);
  let last = 0;
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / RATE;
    last = smooth * last + (1 - smooth) * noise();
    buf[s0 + i] += gain * last * Math.exp((-t / dur) * 5);
  }
}

function writeWav(name, buf, peak = 0.85) {
  const max = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const data = Buffer.alloc(buf.length * 2);
  buf.forEach((v, i) => data.writeInt16LE(Math.round((v / max) * peak * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path.join(OUT, `${name}.wav`), Buffer.concat([header, data]));
}

mkdirSync(OUT, { recursive: true });

// Picking up / drawing a tile: a light click.
{
  const b = buffer(0.08);
  click(b, { dur: 0.025, gain: 0.6, smooth: 0.3 });
  tone(b, { freq: 1900, dur: 0.05, gain: 0.15, decay: 70 });
  writeWav('draw', b, 0.5);
}
// Discard: a tile hitting the table — a clack with a woody body.
{
  const b = buffer(0.18);
  click(b, { dur: 0.04, gain: 0.9, smooth: 0.45 });
  tone(b, { freq: 820, dur: 0.15, gain: 0.35, decay: 38, harmonics: [1, 0.5, 0.25] });
  tone(b, { freq: 1640, dur: 0.08, gain: 0.12, decay: 60 });
  writeWav('discard', b, 0.75);
}
// Pong: two quick rising notes.
{
  const b = buffer(0.35);
  tone(b, { freq: 523, dur: 0.18, gain: 0.35, decay: 12 });
  tone(b, { start: 0.09, freq: 784, dur: 0.24, gain: 0.35, decay: 10 });
  writeWav('pong', b);
}
// Kong: three notes and a low knock.
{
  const b = buffer(0.5);
  click(b, { dur: 0.05, gain: 0.5, smooth: 0.7 });
  [392, 523, 659].forEach((f, i) => tone(b, { start: 0.06 * i, freq: f, dur: 0.3, gain: 0.3, decay: 8 }));
  writeWav('kong', b);
}
// Win: a bright arpeggio with a sustained top note.
{
  const b = buffer(1.3);
  [523, 659, 784, 1047].forEach((f, i) => tone(b, { start: 0.09 * i, freq: f, dur: 0.9, gain: 0.3, decay: 3.5 }));
  tone(b, { start: 0.36, freq: 1568, dur: 0.9, gain: 0.08, decay: 3 });
  writeWav('win', b);
}
// UI tap: a soft blip.
{
  const b = buffer(0.06);
  tone(b, { freq: 1200, dur: 0.05, gain: 0.3, decay: 60, harmonics: [1] });
  writeWav('tap', b, 0.4);
}
// An AI character speaks: a gentle pop.
{
  const b = buffer(0.12);
  tone(b, { freq: 660, dur: 0.1, gain: 0.3, decay: 30, harmonics: [1, 0.2] });
  tone(b, { start: 0.03, freq: 990, dur: 0.08, gain: 0.15, decay: 40, harmonics: [1] });
  writeWav('chat', b, 0.45);
}
// Background music: a calm 16-bar pentatonic loop (seamless: ends on the bar line).
{
  const bpm = 84;
  const beat = 60 / bpm;
  const bars = 8;
  const b = buffer(bars * 4 * beat);
  const scale = [392, 440, 523, 587, 659, 784, 880]; // G pentatonic-ish
  const melody = [2, 4, 5, 4, 2, 1, 0, 1, 2, 4, 6, 5, 4, 2, 1, 2, 4, 5, 6, 5, 4, 2, 4, 2, 1, 0, 1, 2, 1, 0, 1, 2];
  melody.forEach((n, i) => tone(b, { start: i * beat, freq: scale[n], dur: beat * 1.6, gain: 0.14, decay: 2.2, harmonics: [1, 0.25, 0.08], attack: 0.02 }));
  const bass = [196, 220, 262, 196, 175, 196, 220, 196];
  bass.forEach((f, i) => tone(b, { start: i * 4 * beat, freq: f / 2, dur: 4 * beat, gain: 0.12, decay: 0.6, harmonics: [1, 0.4], attack: 0.05 }));
  // Fade the last half-beat into the loop point to avoid a click.
  const fade = Math.floor(beat * 0.5 * RATE);
  for (let i = 0; i < fade; i++) b[b.length - 1 - i] *= i / fade;
  writeWav('music', b, 0.45);
}

console.log(`Sounds written to ${OUT}`);
