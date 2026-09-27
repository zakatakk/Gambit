/**
 * Engine client. Stockfish builds (both lite SF10 and full SF16) are used
 * DIRECTLY as classic Workers speaking UCI line strings — their documented
 * web usage. We send UCI commands; we receive UCI lines.
 * Strength = Skill Level + UCI_LimitStrength + MultiPV-based move selection
 * (randomization among near-best lines) computed on 'bestmove'.
 */
import type { ChessJsMove, EngineStrengthParams } from './engineProtocol';
import type { EngineTier } from './types';

interface InfoLine {
  cp: number | null;
  mate: number | null;
  pv: string[];
}

const SEARCH_TIMEOUT_MIN_MS = 5_000;
const SEARCH_TIMEOUT_GRACE_MS = 1_500;

async function fetchProgress(url: string, onFrac: (f: number) => void): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Engine download failed (${res.status})`);
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body || !total) return;
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    onFrac(Math.min(1, got / total));
  }
}

/** Choose among the engine's MultiPV lines according to desired strength. */
export function pickMove(lines: InfoLine[], strength: EngineStrengthParams): string {
  const list = lines.filter((l) => l.pv.length > 0);
  if (list.length === 0) return '';
  const cpOf = (l: InfoLine) =>
    l.mate !== null ? (l.mate > 0 ? 10000 - l.mate * 10 : -10000 - l.mate * 10) : (l.cp ?? 0);
  const best = list[0];
  const bestCp = cpOf(best);

  // Occasionally play a clearly worse line (human-like error at low ratings).
  const blunderChance = strength.blunderChance ?? 0;
  if (blunderChance > 0 && Math.random() < blunderChance) {
    const badPool = list.filter((l) => bestCp - cpOf(l) <= 320 && cpOf(l) > -400);
    if (badPool.length > 1) {
      return badPool[1 + Math.floor(Math.random() * (badPool.length - 1))].pv[0];
    }
  }
  // Otherwise randomize among near-best lines within the window.
  const window = strength.randomCp ?? 0;
  const pool = list.filter((l) => {
    const loss = bestCp - cpOf(l);
    return loss >= 0 && loss <= window && cpOf(l) > -500;
  });
  if (pool.length > 1) {
    return pool[Math.floor(Math.random() * pool.length)].pv[0];
  }
  return best.pv[0];
}

export class EngineClient {
  private worker: Worker | null = null;
  private currentTier: EngineTier | null = null;
  private lineHandler: ((line: string) => void) | null = null;
  private activeSearchFailure: ((error: Error) => void) | null = null;

  get tier(): EngineTier | null {
    return this.currentTier;
  }

  async init(tier: EngineTier, onProgress?: (phase: string, frac: number) => void): Promise<void> {
    if (this.worker && this.currentTier === tier) return;
    if (this.activeSearchFailure) this.activeSearchFailure(new Error('Engine tier changed during search'));
    if (this.worker) this.discardWorker(this.worker);
    const file = tier === 'full' ? 'stockfish-nnue-16-single.js' : 'stockfish.js';
    // Resolves under the deploy base (works at / and /repo/ on GitHub Pages).
    // Plain path concat (NOT new URL + import.meta.url): Vite rewrites that
    // pattern into a static asset import, which breaks the dynamic tier switch.
    const engineUrl = `${import.meta.env.BASE_URL}engine/${file}`;

    // Warm the HTTP/SW cache with real progress, then boot the worker from cache.
    onProgress?.('download', 0);
    await fetchProgress(engineUrl, (f) => onProgress?.('download', f));
    onProgress?.('booting', 1);

    this.worker = new Worker(engineUrl);
    await new Promise<void>((resolve, reject) => {
      const w = this.worker!;
      w.onmessage = (ev: MessageEvent) => {
        const line = String(ev.data);
        if (line === 'uciok') {
          w.postMessage('isready');
        } else if (line === 'readyok') {
          resolve();
        }
      };
      w.onerror = (e) => {
        this.discardWorker(w);
        reject(new Error(e.message || 'engine worker failed to boot'));
      };
      w.postMessage('uci');
    });
    const worker = this.worker;
    if (!worker) throw new Error('Engine worker failed to boot');
    worker.onmessage = (ev: MessageEvent) => {
      this.lineHandler?.(String(ev.data));
    };
    worker.onerror = (e) => {
      const error = new Error(e.message || 'engine worker failed');
      if (this.activeSearchFailure) this.activeSearchFailure(error);
      else this.discardWorker(worker);
    };
    this.currentTier = tier;
    onProgress?.('ready', 1);
  }

  private send(line: string): void {
    this.worker?.postMessage(line);
  }

  private discardWorker(worker: Worker): void {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    if (this.worker === worker) {
      this.worker = null;
      this.currentTier = null;
      this.lineHandler = null;
    }
  }

  private search<T>(
    moveTime: number,
    onLine: (line: string, resolve: (value: T) => void, reject: (error: Error) => void) => void,
    start: () => void
  ): Promise<T> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('Engine not initialized'));
    if (this.activeSearchFailure || this.lineHandler) {
      return Promise.reject(new Error('Engine is already searching'));
    }

    const timeoutMs = Math.max(SEARCH_TIMEOUT_MIN_MS, Math.ceil(Math.max(0, moveTime) * 5));
    return new Promise<T>((resolve, reject) => {
      const previousHandler = this.lineHandler;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let stopTimeout: ReturnType<typeof setTimeout> | undefined;
      let handleLine: (line: string) => void;
      let handleWorkerFailure: (error: Error) => void;

      const cleanup = () => {
        if (timeout !== undefined) clearTimeout(timeout);
        if (stopTimeout !== undefined) clearTimeout(stopTimeout);
        if (this.lineHandler === handleLine) this.lineHandler = previousHandler;
        if (this.activeSearchFailure === handleWorkerFailure) this.activeSearchFailure = null;
      };
      const fail = (error: Error, discardWorker = false) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (discardWorker) this.discardWorker(worker);
        reject(error);
      };
      const finish = (value: T) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      handleWorkerFailure = (error) => fail(error, true);
      handleLine = (line) => {
        try {
          onLine(line, finish, (error) => fail(error));
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)), true);
        }
      };
      this.lineHandler = handleLine;
      this.activeSearchFailure = handleWorkerFailure;
      timeout = setTimeout(() => {
        try {
          this.send('stop');
        } catch {
          fail(new Error('Engine worker stopped responding'), true);
          return;
        }
        stopTimeout = setTimeout(
          () => fail(new Error('Engine search timed out; the worker stopped responding'), true),
          SEARCH_TIMEOUT_GRACE_MS
        );
      }, timeoutMs);

      try {
        start();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)), true);
      }
    });
  }

  async play(fen: string, strength: EngineStrengthParams): Promise<ChessJsMove> {
    const lines: InfoLine[] = [];
    const useMulti = (strength.randomCp ?? 0) > 0 || (strength.blunderChance ?? 0) > 0;
    return this.search(strength.moveTime, (line, resolve, reject) => {
      if (line.startsWith('info')) {
        const l = parseInfo(line);
        if (l) lines.push(l);
      } else if (line.startsWith('bestmove')) {
        const raw = line.split(/\s+/)[1] ?? '';
        if (!raw || raw === '(none)') {
          reject(new Error('no-move'));
          return;
        }
        const chosen = useMulti && lines.length > 0 ? pickMove(lines, strength) : raw;
        const uci = chosen || raw;
        const mv: ChessJsMove = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
        if (uci.length > 4) mv.promotion = uci[4];
        resolve(mv);
      }
    }, () => {
      this.send('ucinewgame');
      this.send(`setoption name Skill Level value ${strength.skill | 0}`);
      if (strength.limitedElo) {
        this.send('setoption name UCI_LimitStrength value true');
        this.send(`setoption name UCI_Elo value ${strength.limitedElo | 0}`);
      } else {
        this.send('setoption name UCI_LimitStrength value false');
      }
      this.send(`setoption name MultiPV value ${useMulti ? 5 : 1}`);
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${strength.moveTime | 0}`);
    });
  }

  async analyse(
    fen: string,
    moveTime: number,
    onEval: (cp: number, pv: string[]) => void
  ): Promise<ChessJsMove> {
    return this.search(moveTime, (line, resolve, reject) => {
      if (line.startsWith('info')) {
        const l = parseInfo(line);
        if (l && l.cp !== null) onEval(l.cp, l.pv);
      } else if (line.startsWith('bestmove')) {
        const raw = line.split(/\s+/)[1] ?? '';
        if (!raw || raw === '(none)') {
          reject(new Error('no-move'));
          return;
        }
        const mv: ChessJsMove = { from: raw.slice(0, 2), to: raw.slice(2, 4) };
        if (raw.length > 4) mv.promotion = raw[4];
        resolve(mv);
      }
    }, () => {
      this.send('ucinewgame');
      this.send('setoption name MultiPV value 1');
      this.send('setoption name UCI_LimitStrength value false');
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${moveTime | 0}`);
    });
  }

  stop(): void {
    this.send('stop');
  }
}

function parseInfo(line: string): InfoLine | null {
  const mCp = /score cp (-?\d+)/.exec(line);
  const mMate = /score mate (-?\d+)/.exec(line);
  const mPv = / pv (.+)$/.exec(line);
  if ((!mCp && !mMate) || !mPv) return null;
  return {
    cp: mCp ? parseInt(mCp[1], 10) : null,
    mate: mMate ? parseInt(mMate[1], 10) : null,
    pv: mPv[1].trim().split(/\s+/),
  };
}

export const engine = new EngineClient();
