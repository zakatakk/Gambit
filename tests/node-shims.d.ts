/** Minimal node typings for tests (the project keeps dependencies browser-only). */
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}
