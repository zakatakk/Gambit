/** Relative on purpose — resolves under the deploy base (GitHub Pages subpath OK). */
export const PUZZLE_BUNDLE_URL = `${import.meta.env.BASE_URL}data/puzzles.json`;

/** Injected by Vite (see define in vite.config.ts). */
declare const __APP_VERSION__: string;

/** When this bundle was built (UTC). Shown in Settings next to Refresh app. */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
