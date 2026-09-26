/**
 * Build public/data/puzzles.json from the Lichess puzzle database (CC0).
 * Filters: popularity >= 70, NbPlays >= 50, rating bands 600-2600, dedupe by theme mix.
 * Usage: npm run puzzles (downloads lichess_db_puzzle.csv.zst, ~50MB).
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createReadStream, writeFile } from 'node:fs';
import { writeFile as writeFileAsync } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.resolve('data');
const RAW = path.join(DATA_DIR, 'puzzles.csv');
const OUT = path.resolve('public/data/puzzles.json');

const BANDS = [
  [600, 1000, 400],
  [1000, 1400, 600],
  [1400, 1800, 700],
  [1800, 2200, 700],
  [2200, 2600, 500],
];

async function ensureCsv() {
  if (existsSync(RAW)) {
    console.log('Using cached', RAW);
    return;
  }
  mkdirSync(DATA_DIR, { recursive: true });
  console.log('Downloading Lichess puzzle DB (~50MB zstd)...');
  const res = await fetch('https://database.lichess.org/lichess_db_puzzle.csv.zst');
  if (!res.ok || !res.body) throw new Error('Download failed: ' + res.status);
  const { decompress } = await import('fzstd');
  const buf = new Uint8Array(await res.arrayBuffer());
  const out = decompress(buf);
  await writeFileAsync(RAW, out);
  console.log('Decompressed to', RAW, statSync(RAW).size, 'bytes');
}

function parseThemes(t) {
  return (t || '').split(' ').filter(Boolean);
}

async function main() {
  await ensureCsv();
  // Stream the 1GB+ CSV line by line (readFile would exceed V8 string limits).
  const rl = createInterface({ input: createReadStream(RAW, 'utf8'), crlfDelay: Infinity });
  // Bounded reservoir sample per band (uniform, memory-safe on 6M rows).
  const CAP = 4000;
  const reservoirs = BANDS.map(() => []);
  const seenPerBand = BANDS.map(() => 0);
  const themeCount = new Map();
  let header = null;
  let idx = {};
  let count = 0;

  for await (const line of rl) {
    if (!header) {
      header = line.split(',');
      idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
      continue;
    }
    if (!line.trim()) continue;
    count++;
    if (count % 1000000 === 0) console.log('scanned', count);
    const cols = parseCsvLine(line);
    if (!cols || cols.length < 8) continue;
    const id = cols[idx['PuzzleId']];
    const fen = cols[idx['FEN']];
    const moves = cols[idx['Moves']].split(' ');
    const rating = parseInt(cols[idx['Rating']], 10);
    const rd = parseInt(cols[idx['RatingDeviation']], 10);
    const pop = parseInt(cols[idx['Popularity']], 10);
    const nb = parseInt(cols[idx['NbPlays']], 10);
    const themes = parseThemes(cols[idx['Themes']]);
    if (pop < 70 || nb < 50) continue;
    if (rd > 100) continue;
    if (themes.includes('veryLong') || themes.includes('oneMove')) continue;
    if (moves.length < 2 || moves.length > 8) continue;
    for (const t of themes) themeCount.set(t, (themeCount.get(t) || 0) + 1);

    const band = BANDS.findIndex(([lo, hi]) => rating >= lo && rating < hi);
    if (band === -1) continue;
    seenPerBand[band]++;
    const res = reservoirs[band];
    if (res.length < CAP) {
      res.push({ id, fen, moves, rating, rd, pop, themes });
    } else if (Math.random() < CAP / seenPerBand[band]) {
      res[Math.floor(Math.random() * CAP)] = { id, fen, moves, rating, rd, pop, themes };
    }
  }
  console.log('scanned total', count);

  // Emit the reservoirs, filtered to common themes, sorted by rating.
  const puzzles = [];
  for (let b = 0; b < BANDS.length; b++) {
    const [lo, hi] = BANDS[b];
    const kept = reservoirs[b]
      .map((p) => ({
        id: p.id,
        fen: p.fen,
        moves: p.moves,
        rating: p.rating,
        rd: p.rd,
        popularity: p.pop,
        themes: p.themes.filter((t) => themeCount.get(t) > 50),
      }))
      .sort((x, y) => x.rating - y.rating || (x.id < y.id ? -1 : 1));
    puzzles.push(...kept);
    console.log(`band ${lo}-${hi}: saw ${seenPerBand[b]}, kept ${kept.length}`);
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  await writeFileAsync(OUT, JSON.stringify({ puzzles }));
  const kb = Math.round(statSync(OUT).size / 1024);
  console.log(`Wrote ${OUT}: ${puzzles.length} puzzles, ${kb}KB`);
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur !== '' || line[line.length - 1] === ',') out.push(cur);
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
