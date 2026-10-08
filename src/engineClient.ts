/**
 * Engine client. Stockfish builds (lite SF10 and full SF16) are classic Web
 * Workers speaking UCI lines directly. Search calls share one worker and are
 * serialized; engine failure rejects the active request instead of hanging UI.
 */
import type { ChessJsMove, EngineStrengthParams } from './engineProtocol';
import type { EngineTier } from './types';

interface InfoLine {
  cp: number | null;
  mate: number | null;
  pv: string[];
  depth: number;
  multipv: number;
}

const SEARCH_TIMEOUT_MIN_MS = 5_000;
const SEARCH_TIMEOUT_GRACE_MS = 1_500;
const ENGINE_INIT_TIMEOUT_MS = 90_000;
const ENGINE_ASSET_CACHE = 'gambit-engine-assets-v2';
const LITE_ENGINE_ASSETS = [
  { file: 'stockfish.js', size: 0 },
  { file: 'stockfish.wasm', size: 0 },
] as const;
const FULL_ENGINE_ASSETS = [
  { file: 'stockfish-nnue-16-single.js', size: 25_594 },
  { file: 'stockfish-nnue-16-single.wasm', size: 575_029 },
  { file: 'nn-5af11540bbfe.nnue', size: 40_119_326 },
] as const;

export async function fetchProgress(
  url: string,
  onFrac: (f: number) => void,
  expectedBytes?: number
): Promise<void> {
  let cache: Cache | null = null;
  try {
    if ('caches' in globalThis) cache = await caches.open(ENGINE_ASSET_CACHE);
  } catch {
    // Private mode or quota restrictions should not prevent online play.
  }

  if (cache && await cache.match(url)) {
    onFrac(1);
    return;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Engine download failed (${res.status}): ${url}`);

  // Cache the stream directly; the engine worker reuses these bytes instead of
  // downloading the asset again during startup.
  const cacheWrite = cache?.put(url, res.clone()).catch(() => undefined);
  const total = expectedBytes ?? Number(res.headers.get('content-length') || 0);
  const reader = res.body?.getReader();
  if (!reader) {
    await cacheWrite;
    onFrac(1);
    return;
  }

  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (total > 0) onFrac(Math.min(1, received / total));
  }
  if (received === 0) throw new Error(`Downloaded engine asset is empty: ${url}`);
  await cacheWrite;
  onFrac(1);
}

async function downloadEngineAssets(
  tier: EngineTier,
  onProgress?: (phase: string, frac: number) => void
): Promise<void> {
  const assets = tier === 'full' ? FULL_ENGINE_ASSETS : LITE_ENGINE_ASSETS;
  const totalBytes = assets.reduce((total, asset) => total + asset.size, 0);
  let downloadedBytes = 0;
  let completedAssets = 0;

  for (const asset of assets) {
    try {
      await fetchProgress(
        `${import.meta.env.BASE_URL}engine/${asset.file}`,
        (fraction) => {
          const progress = totalBytes
            ? (downloadedBytes + fraction * asset.size) / totalBytes
            : (completedAssets + fraction) / assets.length;
          onProgress?.('download', progress);
        },
        asset.size || undefined
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not fetch ${asset.file}: ${message}`, { cause: error });
    }
    downloadedBytes += asset.size;
    completedAssets++;
  }
}

function isFullEngineReady(worker: Worker, resolve: () => void, reject: (error: Error) => void): (line: string) => void {
  let isReady = false;
  let networkLoaded = false;
  let settled = false;
  let initialized = false;

  return (line) => {
    if (settled) return;
    if (line === 'uciok' && !initialized) {
      initialized = true;
      worker.postMessage('setoption name Use NNUE value true');
      worker.postMessage('isready');
    } else if (line === 'Load eval file success: 1') {
      networkLoaded = true;
    } else if (line.startsWith('Failed to download eval file')) {
      settled = true;
      reject(new Error('Stockfish could not load its NNUE network'));
      return;
    } else if (line === 'readyok') {
      isReady = true;
    }

    // Stockfish can print “NNUE evaluation enabled” only after its first search.
    // readyok fences the option/load commands; do not wait for that info line.
    if (isReady && networkLoaded) {
      settled = true;
      resolve();
    }
  };
}

function isLiteEngineReady(worker: Worker, resolve: () => void): (line: string) => void {
  let initialized = false;
  return (line) => {
    if (line === 'uciok' && !initialized) {
      initialized = true;
      worker.postMessage('isready');
    } else if (line === 'readyok') {
      resolve();
    }
  };
}

function waitForEngineReady(worker: Worker, tier: EngineTier): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const onReady = tier === 'full'
      ? isFullEngineReady(worker, () => finish(), (error) => finish(error))
      : isLiteEngineReady(worker, () => finish());
    const timeout = setTimeout(
      () => finish(new Error('Engine initialization timed out')),
      ENGINE_INIT_TIMEOUT_MS
    );

    worker.onmessage = (event: MessageEvent) => onReady(String(event.data));
    worker.onerror = (event) => finish(new Error(event.message || 'engine worker failed to boot'));
    worker.onmessageerror = () => finish(new Error('Could not read engine worker response'));
    try {
      worker.postMessage('uci');
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Choose a weaker UCI multipv candidate without mistaking later depths for new lines. */
export function pickMove(lines: InfoLine[], strength: EngineStrengthParams): string {
  const candidates = lines.filter((line) => line.pv.length > 0)
    .sort((a, b) => a.multipv - b.multipv);
  if (candidates.length === 0) return '';
  const score = (line: InfoLine) => line.mate !== null
    ? (line.mate > 0 ? 10000 - line.mate * 10 : -10000 - line.mate * 10)
    : (line.cp ?? 0);
  const bestScore = score(candidates[0]);

  const blunderWindow = strength.blunderWindowCp ?? 320;
  const blunderFloor = strength.blunderFloorCp ?? -400;

  if ((strength.blunderChance ?? 0) > 0 && Math.random() < (strength.blunderChance ?? 0)) {
    const weaker = candidates.filter((line) => bestScore - score(line) <= blunderWindow && score(line) > blunderFloor);
    if (weaker.length > 1) return weaker[1 + Math.floor(Math.random() * (weaker.length - 1))].pv[0];
  }

  const window = strength.randomCp ?? 0;
  const nearBest = candidates.filter((line) => {
    const loss = bestScore - score(line);
    return loss >= 0 && loss <= window && score(line) > -500;
  });
  if (nearBest.length > 1) return nearBest[Math.floor(Math.random() * nearBest.length)].pv[0];
  return candidates[0].pv[0];
}

export class EngineClient {
  private worker: Worker | null = null;
  private currentTier: EngineTier | null = null;
  private initialization: { tier: EngineTier; promise: Promise<void> } | null = null;
  private lineHandler: ((line: string) => void) | null = null;
  private activeSearchFailure: ((error: Error) => void) | null = null;
  /** Rejects the active search without discarding the worker (used by cancelSearch). */
  private activeSearchCancel: ((error: Error) => void) | null = null;
  /** Output still owed by cancelled searches: their bestmove arrives after 'stop'. */
  private staleBestmoves = 0;

  get tier(): EngineTier | null {
    return this.currentTier;
  }

  async init(tier: EngineTier, onProgress?: (phase: string, frac: number) => void): Promise<void> {
    if (this.worker && this.currentTier === tier) return;
    if (this.initialization?.tier === tier) {
      await this.initialization.promise;
      onProgress?.('ready', 1);
      return;
    }
    if (this.initialization) {
      const previous = this.initialization.promise;
      await previous.catch(() => {});
      if (this.initialization?.promise === previous) this.initialization = null;
      return this.init(tier, onProgress);
    }

    if (this.activeSearchFailure) this.activeSearchFailure(new Error('Engine tier changed during search'));
    if (this.worker) this.discardWorker(this.worker);

    const promise = this.initializeWorker(tier, onProgress);
    this.initialization = { tier, promise };
    try {
      await promise;
    } finally {
      if (this.initialization?.promise === promise) this.initialization = null;
    }
  }

  private async initializeWorker(tier: EngineTier, onProgress?: (phase: string, frac: number) => void): Promise<void> {
    const file = tier === 'full' ? 'stockfish-nnue-16-single.js' : 'stockfish.js';
    // Plain path concatenation preserves runtime tier switching in Vite builds.
    const engineUrl = `${import.meta.env.BASE_URL}engine/${file}`;

    onProgress?.('download', 0);
    await downloadEngineAssets(tier, onProgress);
    onProgress?.('booting', 1);

    const worker = new Worker(engineUrl);
    this.worker = worker;
    this.staleBestmoves = 0;
    try {
      await waitForEngineReady(worker, tier);
    } catch (error) {
      this.discardWorker(worker);
      throw error;
    }

    if (this.worker !== worker) throw new Error('Engine worker was superseded during initialization');

    worker.onmessage = (event: MessageEvent) => this.dispatchLine(String(event.data));
    worker.onerror = (event) => {
      const error = new Error(event.message || 'engine worker failed');
      if (this.activeSearchFailure) this.activeSearchFailure(error);
      else this.discardWorker(worker);
    };
    worker.onmessageerror = () => {
      const error = new Error('Could not read engine worker response');
      if (this.activeSearchFailure) this.activeSearchFailure(error);
      else this.discardWorker(worker);
    };
    this.currentTier = tier;
    onProgress?.('ready', 1);
  }

  private send(line: string): void {
    if (!this.worker) throw new Error('Engine worker is not available');
    this.worker.postMessage(line);
  }

  /** Route engine output. Lines from a cancelled search arrive before the next
   * search's output (UCI is in order), so they are dropped up to its bestmove. */
  private dispatchLine(line: string): void {
    if (this.staleBestmoves > 0) {
      if (line.startsWith('bestmove')) this.staleBestmoves--;
      return;
    }
    this.lineHandler?.(line);
  }

  /** Cancel an active search: send 'stop' and keep the worker warm, so the next
   * search starts immediately and its answer is never mixed with this one. */
  cancelSearch(): void {
    const cancel = this.activeSearchCancel;
    if (!cancel || !this.worker) return;
    this.staleBestmoves++;
    try {
      this.worker.postMessage('stop');
    } catch {
      this.discardWorker(this.worker);
    }
    cancel(new Error('Engine search cancelled'));
  }

  private discardWorker(worker: Worker): void {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    if (this.worker === worker) {
      this.worker = null;
      this.currentTier = null;
      this.lineHandler = null;
      this.staleBestmoves = 0;
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
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let stopTimeout: ReturnType<typeof setTimeout> | undefined;
      let handleLine: (line: string) => void;
      let handleWorkerFailure: (error: Error) => void;
      let handleCancel: (error: Error) => void;

      const cleanup = () => {
        if (timeout !== undefined) clearTimeout(timeout);
        if (stopTimeout !== undefined) clearTimeout(stopTimeout);
        if (this.lineHandler === handleLine) this.lineHandler = null;
        if (this.activeSearchFailure === handleWorkerFailure) this.activeSearchFailure = null;
        if (this.activeSearchCancel === handleCancel) this.activeSearchCancel = null;
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
      handleCancel = (error) => fail(error);
      handleLine = (line) => {
        try {
          onLine(line, finish, (error) => fail(error));
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)), true);
        }
      };
      this.lineHandler = handleLine;
      this.activeSearchFailure = handleWorkerFailure;
      this.activeSearchCancel = handleCancel;
      timeout = setTimeout(() => {
        try {
          this.send('stop');
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)), true);
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
    const latestByPv = new Map<number, InfoLine>();
    const useMulti = (strength.randomCp ?? 0) > 0 || (strength.blunderChance ?? 0) > 0;
    return this.search(strength.moveTime, (line, resolve, reject) => {
      if (line.startsWith('info')) {
        const info = parseInfo(line);
        if (info) {
          const previous = latestByPv.get(info.multipv);
          if (!previous || info.depth >= previous.depth) latestByPv.set(info.multipv, info);
        }
      } else if (line.startsWith('bestmove')) {
        const raw = line.split(/\s+/)[1] ?? '';
        if (!raw || raw === '(none)') {
          reject(new Error('no-move'));
          return;
        }
        const candidates = [...latestByPv.values()];
        const chosen = useMulti && candidates.length > 0 ? pickMove(candidates, strength) : raw;
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
      this.send(`setoption name MultiPV value ${useMulti ? Math.max(1, Math.min(500, strength.multipv ?? 5)) : 1}`);
      this.send(`position fen ${fen}`);
      this.send(strength.depth ? `go depth ${strength.depth | 0}` : `go movetime ${strength.moveTime | 0}`);
    });
  }

  async analyse(
    fen: string,
    moveTime: number,
    onEval: (cp: number | null, mate: number | null, pv: string[], depth: number, multipv: number) => void,
    multiPv = 1
  ): Promise<ChessJsMove> {
    return this.search(moveTime, (line, resolve, reject) => {
      if (line.startsWith('info')) {
        const info = parseInfo(line);
        if (info && (info.cp !== null || info.mate !== null)) {
          onEval(info.cp, info.mate, info.pv, info.depth, info.multipv);
        }
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
      this.send(`setoption name MultiPV value ${Math.max(1, Math.min(5, Math.floor(multiPv)))}`);
      this.send('setoption name UCI_LimitStrength value false');
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${moveTime | 0}`);
    });
  }

}

function parseInfo(line: string): InfoLine | null {
  const cpMatch = /\bscore cp (-?\d+)/.exec(line);
  const mateMatch = /\bscore mate (-?\d+)/.exec(line);
  const depthMatch = /\bdepth (\d+)/.exec(line);
  const multipvMatch = /\bmultipv (\d+)/.exec(line);
  const pvMatch = /\b pv (.+)$/.exec(line);
  if ((!cpMatch && !mateMatch) || !pvMatch) return null;
  return {
    cp: cpMatch ? parseInt(cpMatch[1], 10) : null,
    mate: mateMatch ? parseInt(mateMatch[1], 10) : null,
    pv: pvMatch[1].trim().split(/\s+/),
    depth: depthMatch ? parseInt(depthMatch[1], 10) : 0,
    multipv: multipvMatch ? parseInt(multipvMatch[1], 10) : 1,
  };
}

export const engine = new EngineClient();
