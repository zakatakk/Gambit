/**
 * Generate PWA icons. If @resvg/resvg-js is available, render PNGs;
 * otherwise emit SVG icons (modern iOS/PWA tooling accepts SVG icons; PNG fallback note).
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('public/icons');
mkdirSync(OUT, { recursive: true });

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1d1b17"/>
  <circle cx="256" cy="256" r="196" fill="#26231e"/>
  <g transform="translate(256,270) scale(7.2) translate(-22.5,-22.5)">
    <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill="#e9e4da" stroke="#e9e4da" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" fill="#e9e4da" stroke="#e9e4da" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

writeFileSync(path.join(OUT, 'icon.svg'), svg(512));

// Try to render PNGs if resvg is installed (optional dev dependency).
try {
  const { Resvg } = await import('@resvg/resvg-js');
  for (const size of [180, 192, 512]) {
    const png = new Resvg(svg(size), { fitTo: { mode: 'width', value: size } }).render().asPng();
    writeFileSync(path.join(OUT, `icon-${size}.png`), png);
    console.log('icon-' + size + '.png');
  }
} catch {
  console.log('resvg not installed; wrote icon.svg only (manifest uses SVG, iOS uses apple-touch-icon.png if present).');
}
