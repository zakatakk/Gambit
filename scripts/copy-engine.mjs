/** Copy Stockfish engine builds from node_modules into public/engine. */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function firstExisting(dir, names) {
  for (const n of names) {
    const p = path.join(dir, n);
    if (existsSync(p)) return p;
  }
  return null;
}

function pkgDir(name) {
  const resolver = createRequire(path.join(process.cwd(), 'package.json'));
  return path.dirname(resolver.resolve(`${name}/package.json`));
}

const OUT = path.resolve('public/engine');
mkdirSync(OUT, { recursive: true });

// Lite: stockfish.js 10.0.2 ships stockfish.js + stockfish.wasm (asm fallback too).
const liteDir = pkgDir('stockfish-lite');
const liteJs = firstExisting(liteDir, ['stockfish.js']);
const liteWasm = firstExisting(liteDir, ['stockfish.wasm']);
if (!liteJs || !liteWasm) {
  console.error('Lite engine files not found in', liteDir);
  process.exit(1);
}
copyFileSync(liteJs, path.join(OUT, 'stockfish.js'));
copyFileSync(liteWasm, path.join(OUT, 'stockfish.wasm'));
console.log('lite:', statSync(path.join(OUT, 'stockfish.js')).size, 'bytes js');

// Full: stockfish 16 ships stockfish-nnue-16-single.js (+ .wasm).
const fullDir = pkgDir('stockfish');
const fullNames = ['stockfish-nnue-16-single.js', 'src/stockfish-nnue-16-single.js'];
const fullJs = firstExisting(fullDir, fullNames);
if (!fullJs) {
  console.error('Full engine JS not found in', fullDir, '- run npm install again');
  process.exit(1);
}
copyFileSync(fullJs, path.join(OUT, 'stockfish-nnue-16-single.js'));
const fullWasm = firstExisting(fullDir, ['stockfish-nnue-16-single.wasm', 'src/stockfish-nnue-16-single.wasm']);
if (fullWasm) {
  copyFileSync(fullWasm, path.join(OUT, 'stockfish-nnue-16-single.wasm'));
  console.log('full wasm:', statSync(path.join(OUT, 'stockfish-nnue-16-single.wasm')).size, 'bytes');
}
// NNUE network file is fetched by the engine at runtime.
const nnue = firstExisting(fullDir, ['nn-5af11540bbfe.nnue', 'src/nn-5af11540bbfe.nnue']);
if (nnue) {
  copyFileSync(nnue, path.join(OUT, 'nn-5af11540bbfe.nnue'));
  console.log('full nnue:', statSync(path.join(OUT, 'nn-5af11540bbfe.nnue')).size, 'bytes');
}
console.log('full js:', statSync(path.join(OUT, 'stockfish-nnue-16-single.js')).size, 'bytes');
