/**
 * Synthesizes the game's sound effects and background music as 16-bit mono WAV files in
 * assets/sounds; rerun with `node scripts/generate-sounds.mjs`.
 *
 * Tile sounds are modelled on how a resin tile actually sounds: a click of noise through a few
 * low-Q resonances of the tile (≈1–3 kHz) and the table — a dry knock. No pure tones or reverb:
 * those make tiles sound like glass. Draw and discard come
 * in a few variants (draw1.wav…) that the game picks between, so repeated hits do not sound
 * machine-made.
 *
 * Long sounds (music, wins, kongs, settlement) are then compressed to AAC (.m4a) with macOS
 * `afconvert` or `ffmpeg`. Short tile sounds stay WAV: AAC adds ~50 ms of priming silence, which
 * would make a discard lag behind the tap.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let RATE = 44100;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets/sounds');

/** Deterministic noise so regenerated files are identical. */
let seed = 1;
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x7fffffff) * 2 - 1;
};
/** Deterministic value in [lo, hi). */
const rand = (lo, hi) => lo + ((noise() + 1) / 2) * (hi - lo);

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

/** One-pole filter coefficient for a cutoff in Hz. */
const coef = (hz) => Math.exp((-2 * Math.PI * hz) / RATE);

/**
 * Band-limited noise with an envelope: `env(t)` gives the level at t seconds. Used for the
 * crisp click of a hit (short, bright) and the hiss of a tile sliding on felt (longer, softer).
 */
function noiseBand(buf, { start = 0, dur, gain, low = 200, high = 8000, env }) {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor(dur * RATE);
  const lp = coef(high);
  const hp = coef(low);
  let l = 0;
  let h = 0;
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    l = lp * l + (1 - lp) * noise();
    h = hp * h + (1 - hp) * l; // low-passed copy, subtracted to high-pass
    buf[s0 + i] += gain * env(i / RATE) * (l - h);
  }
}

/**
 * Resonant band-pass filter (RBJ biquad, 0 dB peak). Driven by a click it rings like a struck
 * object, but with a low Q it stays a coloured knock rather than a pure note.
 */
function resonate(input, { freq, q }) {
  const w = (2 * Math.PI * freq) / RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/**
 * A tile striking something. Mahjong tiles are dense resin: a hit is a dry, dead "dok", never a
 * ring. A click of noise excites a few low-Q resonances of the tile (`pitch` ≈ 1 kHz and two
 * inharmonic ones above it) and of the table below. Pure decaying tones or reverb make it sound
 * like glass, so neither is used. `thump` is the table's share.
 */
function hit(buf, { start = 0, gain = 1, pitch = 1100, thump = 0.5, bright = 1 }) {
  const n = Math.floor(0.06 * RATE);
  const click = new Float32Array(n);
  for (let i = 0; i < n; i++) click[i] = noise() * Math.exp(-i / RATE / 0.0006);
  const parts = [
    [resonate(click, { freq: pitch * rand(0.95, 1.05), q: 7 }), 1],
    [resonate(click, { freq: pitch * 2.05 * rand(0.95, 1.05), q: 6 }), 0.55 * bright],
    [resonate(click, { freq: pitch * 3.3 * rand(0.95, 1.05), q: 5 }), 0.2 * bright],
    [resonate(click, { freq: rand(140, 180), q: 3 }), 1.6 * thump],
    [resonate(click, { freq: rand(320, 400), q: 3 }), 0.6 * thump],
  ];
  const s0 = Math.floor(start * RATE);
  // A two-stage low-pass takes the edge off the click.
  const lp = coef(3000);
  let l1 = 0;
  let l2 = 0;
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    let v = 0.06 * click[i];
    for (const [p, g] of parts) v += g * p[i];
    l1 = lp * l1 + (1 - lp) * v;
    l2 = lp * l2 + (1 - lp) * l1;
    buf[s0 + i] += gain * l2;
  }
}

/**
 * A plucked string (Karplus–Strong): a burst of soft noise circulating in a delay line one period
 * long, losing its highs a little every pass. Warm like a guzheng, never glassy. `sustain` is
 * roughly the seconds until it fades by 60 dB.
 */
function pluck(buf, { start, freq, gain, sustain = 1 }) {
  // The two-point average adds half a sample of delay; leave it out of the line so it stays in tune.
  const period = Math.max(2, Math.round(RATE / freq - 0.5));
  const loss = 10 ** ((-3 * period) / (sustain * RATE));
  const line = new Float32Array(period);
  // A softened excitation: a finger, not a pick.
  let prev = 0;
  for (let i = 0; i < period; i++) {
    prev = 0.5 * prev + 0.5 * noise();
    line[i] = prev;
  }
  const s0 = Math.floor(start * RATE);
  const n = Math.min(buf.length - s0, Math.floor(sustain * RATE));
  for (let i = 0; i < n; i++) {
    const j = i % period;
    const next = line[(j + 1) % period];
    const v = line[j];
    line[j] = loss * 0.5 * (v + next);
    buf[s0 + i] += gain * v * Math.min(1, (n - i) / (0.05 * RATE));
  }
}

/** A tile pushed across the felt: a soft brushing swell. */
function slide(buf, { start = 0, dur, gain = 0.15 }) {
  noiseBand(buf, { start, dur, gain, low: 600, high: 2500, env: (t) => Math.sin((Math.PI * t) / dur) ** 2 });
}

/** Gusting wind: noise through a broad band-pass whose centre and level drift like gusts. */
function wind(buf, { start, dur, gain }) {
  const s0 = Math.floor(start * RATE);
  const n = Math.min(buf.length - s0, Math.floor(dur * RATE));
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  let b0 = 0;
  let a1 = 0;
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const u = t / dur;
    // Two overlapping gusts: rise, a lull, a second smaller rise, die away.
    const gust = Math.sin(Math.PI * Math.min(1, u * 1.6)) * 0.8 + 0.5 * Math.sin(Math.PI * Math.max(0, Math.min(1, (u - 0.35) * 1.6)));
    if (i % 64 === 0) {
      const freq = 280 + 650 * gust;
      const w = (2 * Math.PI * freq) / RATE;
      const alpha = Math.sin(w) / (2 * 1.3);
      b0 = alpha / (1 + alpha);
      a1 = (-2 * Math.cos(w)) / (1 + alpha);
      a2 = (1 - alpha) / (1 + alpha);
    }
    const x = noise();
    const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    buf[s0 + i] += gain * gust * Math.min(1, (n - i) / (0.1 * RATE)) * y;
  }
}

/** Rain: a soft hiss with a patter of drops (low-Q knocks, so it stays wet rather than glassy). */
function rain(buf, { start, dur, gain, drops }) {
  const env = (t) => Math.min(1, t / 0.15) * Math.min(1, (dur - t) / 0.35);
  noiseBand(buf, { start, dur, gain: 0.25 * gain, low: 1200, high: 5000, env: (t) => Math.max(0, env(t)) });
  const len = Math.floor(0.012 * RATE);
  for (let d = 0; d < drops; d++) {
    const t = rand(0, dur - 0.02);
    const click = new Float32Array(len);
    for (let i = 0; i < len; i++) click[i] = noise() * Math.exp(-i / RATE / 0.0003);
    const drop = resonate(click, { freq: rand(1400, 3800), q: 3 });
    const s0 = Math.floor((start + t) * RATE);
    const g = gain * rand(0.2, 1) * Math.max(0, env(t));
    for (let i = 0; i < len && s0 + i < buf.length; i++) buf[s0 + i] += g * drop[i];
  }
}

/** A short melody of plucks: [[seconds, Hz, gain?, sustain?], …]. */
function plucks(buf, notes) {
  for (const [start, freq, gain = 0.3, sustain = 0.8] of notes) pluck(buf, { start, freq, gain, sustain });
}

function writeWav(name, buf, peak = 0.85, endFade = 0.005) {
  const max = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  // Fade the last few milliseconds so the file never ends on a click.
  const fade = Math.min(buf.length, Math.floor(endFade * RATE));
  for (let i = 0; i < fade; i++) buf[buf.length - 1 - i] *= i / fade;
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

// Drawing a tile: it slides off the wall and taps against the hand.
for (let v = 1; v <= 3; v++) {
  const b = buffer(0.12);
  slide(b, { dur: rand(0.045, 0.06), gain: 0.08 });
  hit(b, { start: rand(0.04, 0.05), gain: 0.5, pitch: rand(1250, 1450), thump: 0, bright: 0.6 });
  writeWav(`draw${v}`, b, 0.45);
}
// Discard: the tile is set down on the felt — a firm clack and a thump.
for (let v = 1; v <= 3; v++) {
  const b = buffer(0.2);
  const pitch = rand(950, 1150);
  slide(b, { dur: 0.02, gain: 0.04 });
  hit(b, { start: 0.012, gain: 1, pitch, thump: 0.7 });
  writeWav(`discard${v}`, b, 0.8);
}
// Pong: three tiles laid down quickly, clacking against each other.
{
  const b = buffer(0.32);
  let t = 0.005;
  for (let i = 0; i < 3; i++) {
    hit(b, { start: t, gain: rand(0.75, 1), pitch: rand(1000, 1300), thump: 0.45 });
    t += rand(0.055, 0.075);
  }
  writeWav('pong', b, 0.85);
}
// Kong: four tiles, set down harder, the last one squared up against the rest. Finished below as
// 刮风 (exposed kong, wind) and 下雨 (concealed kong, rain), as every Sichuan table calls them.
let kongClacks;
{
  const b = buffer(0.42);
  let t = 0.005;
  for (let i = 0; i < 4; i++) {
    hit(b, { start: t, gain: rand(0.8, 1), pitch: rand(1000, 1250), thump: 0.55 });
    t += rand(0.05, 0.065);
  }
  hit(b, { start: t + 0.03, gain: 1, pitch: 1000, thump: 1 });
  kongClacks = b;
}
// Self-drawn win (自摸): the hand is pushed down with a firm slap, then a guzheng sweeps up the
// pentatonic scale and rings on a chord — the big one, since everyone pays.
{
  const b = buffer(1.6);
  hit(b, { start: 0.005, gain: 0.8, pitch: 1050, thump: 0.9 });
  hit(b, { start: 0.03, gain: 1, pitch: 1000, thump: 1 });
  const sweep = [392, 440, 494, 587, 659, 784, 880, 988, 1175]; // G major pentatonic, G4 → D6
  sweep.forEach((f, i) => pluck(b, { start: 0.1 + i * 0.038, freq: f, gain: 0.32 - i * 0.015, sustain: 0.9 }));
  const end = 0.1 + sweep.length * 0.038 + 0.06;
  [196, 392, 587, 784].forEach((f, i) => pluck(b, { start: end + i * 0.012, freq: f, gain: i === 0 ? 0.35 : 0.3, sustain: 1.6 }));
  writeWav('zimo', b, 0.8);
}
// Win on a discard (点炮): a sharp slap as the tile is taken, three quick rising plucks and a
// short chord — clearly a win, but smaller than a self-draw.
{
  const b = buffer(1);
  hit(b, { start: 0.005, gain: 1, pitch: 1100, thump: 0.8 });
  [587, 784, 988].forEach((f, i) => pluck(b, { start: 0.07 + i * 0.06, freq: f, gain: 0.32, sustain: 0.6 }));
  [294, 587, 740].forEach((f, i) => pluck(b, { start: 0.27 + i * 0.01, freq: f, gain: 0.28, sustain: 0.75 }));
  writeWav('hu', b, 0.75);
}
// UI tap: a light wooden tick.
{
  const b = buffer(0.04);
  hit(b, { gain: 0.5, pitch: 900, thump: 0, bright: 0.3 });
  writeWav('tap', b, 0.35);
}
// An AI character speaks: a gentle pop.
{
  RATE = 22050;
  const b = buffer(0.12);
  tone(b, { freq: 660, dur: 0.1, gain: 0.3, decay: 30, harmonics: [1, 0.2] });
  tone(b, { start: 0.03, freq: 990, dur: 0.08, gain: 0.15, decay: 40, harmonics: [1] });
  writeWav('chat', b, 0.45);
}
// Background music: a calm 16-bar pentatonic loop (seamless: ends on the bar line).
{
  RATE = 22050;
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
  writeWav('music', b, 0.45, 0);
}

// --- Added later: kept at the end so the noise sequence, and every file above, stays the same. ---
RATE = 44100;
// 刮风 / 下雨: the kong clacks, then wind (exposed kong) or rain (concealed kong).
{
  const b = buffer(1.5);
  b.set(kongClacks.subarray(0, Math.min(kongClacks.length, b.length)));
  wind(b, { start: 0.2, dur: 1.25, gain: 0.1 });
  writeWav('kong_wind', b, 0.85);
}
{
  const b = buffer(1.5);
  b.set(kongClacks.subarray(0, Math.min(kongClacks.length, b.length)));
  rain(b, { start: 0.2, dur: 1.25, gain: 0.11, drops: 140 });
  writeWav('kong_rain', b, 0.85);
}
// Your move: you can 碰 / 杠 / 胡 or 自摸. Two quick rising plucks.
{
  const b = buffer(0.6);
  plucks(b, [[0, 587, 0.35, 0.5], [0.09, 880, 0.35, 0.55]]);
  writeWav('alert', b, 0.6);
}
// Time running out: a woodblock tick.
{
  const b = buffer(0.06);
  hit(b, { gain: 1, pitch: 1500, thump: 0, bright: 0.4 });
  writeWav('tick', b, 0.45);
}
// 听牌: you are ready — a gentle two-note rise.
{
  const b = buffer(0.8);
  plucks(b, [[0, 659, 0.3, 0.6], [0.12, 988, 0.28, 0.7]]);
  writeWav('ting', b, 0.5);
}
// A new hand: the tiles are washed and stacked — a swelling rattle of many small clacks.
{
  const dur = 1.1;
  const b = buffer(dur + 0.1);
  noiseBand(b, { dur, gain: 0.05, low: 500, high: 3000, env: (t) => Math.sin((Math.PI * t) / dur) });
  for (let i = 0; i < 70; i++) {
    const t = rand(0, dur);
    hit(b, { start: t, gain: rand(0.15, 0.45) * Math.sin((Math.PI * t) / dur), pitch: rand(950, 1400), thump: 0.15 });
  }
  writeWav('shuffle', b, 0.6);
}
// 换三张: three tiles slide across the table and land.
{
  const b = buffer(0.45);
  slide(b, { dur: 0.22, gain: 0.12 });
  [0.2, 0.25, 0.3].forEach((t) => hit(b, { start: t + rand(0, 0.01), gain: rand(0.6, 0.85), pitch: rand(1000, 1250), thump: 0.4 }));
  writeWav('swap', b, 0.7);
}
// 定缺 revealed: a low, firm chord.
{
  const b = buffer(0.8);
  plucks(b, [[0, 196, 0.35, 0.7], [0.015, 294, 0.3, 0.7], [0.03, 392, 0.28, 0.7]]);
  writeWav('dingque', b, 0.55);
}
// End of hand, you came out ahead: a bright guzheng phrase landing on the tonic.
{
  const b = buffer(1.6);
  plucks(b, [[0, 392], [0.12, 440], [0.24, 587], [0.36, 659], [0.52, 784, 0.32, 1.2], [0.53, 392, 0.25, 1.2]]);
  writeWav('settle_win', b, 0.6);
}
// End of hand, you lost: a slower falling phrase, softer.
{
  const b = buffer(1.6);
  plucks(b, [[0, 440, 0.28], [0.18, 392, 0.28], [0.36, 330, 0.28], [0.56, 294, 0.3, 1.1], [0.57, 147, 0.22, 1.1]]);
  writeWav('settle_lose', b, 0.5);
}

// Somebody else wins — told apart by what it means for you.
// You dealt in (点炮): your tile is snatched with a slap, then a falling "uh-oh".
{
  const b = buffer(1);
  hit(b, { start: 0.005, gain: 1, pitch: 1050, thump: 0.9 });
  plucks(b, [[0.1, 330, 0.32, 0.5], [0.26, 247, 0.32, 0.7], [0.27, 123, 0.25, 0.7]]);
  writeWav('deal_in', b, 0.7);
}
// Another player self-draws (自摸) and you pay too: the hand pushed down, a low muted chord.
{
  const b = buffer(0.9);
  hit(b, { start: 0.005, gain: 0.8, pitch: 1050, thump: 0.9 });
  hit(b, { start: 0.03, gain: 0.9, pitch: 1000, thump: 1 });
  plucks(b, [[0.1, 147, 0.3, 0.6], [0.11, 220, 0.25, 0.6], [0.12, 294, 0.22, 0.6]]);
  writeWav('other_zimo', b, 0.55);
}
// Another player wins off someone else's discard: none of your business — one knock, one soft note.
{
  const b = buffer(0.7);
  hit(b, { start: 0.005, gain: 0.9, pitch: 1050, thump: 0.8 });
  plucks(b, [[0.08, 196, 0.25, 0.5]]);
  writeWav('other_hu', b, 0.45);
}
// AAC at 64 kbps mono: indistinguishable for these sounds at about a sixth of the size.
const COMPRESSED = ['music', 'settle_win', 'settle_lose', 'shuffle', 'kong_wind', 'kong_rain', 'zimo', 'hu', 'deal_in'];
const has = (cmd) => {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const encoder = has('afconvert') ? 'afconvert' : has('ffmpeg') ? 'ffmpeg' : null;
if (!encoder) throw new Error('Compressing needs afconvert (macOS) or ffmpeg on the PATH.');
for (const name of COMPRESSED) {
  const wav = path.join(OUT, `${name}.wav`);
  const m4a = path.join(OUT, `${name}.m4a`);
  if (encoder === 'afconvert') execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', wav, m4a]);
  else execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '64k', m4a]);
  rmSync(wav);
}
console.log(`Sounds written to ${OUT}`);
