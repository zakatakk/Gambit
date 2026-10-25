/**
 * Maia-3 opponent client.
 *
 * Maia is a policy-only model: it predicts the move a human at a given rating
 * would most likely play, with no search. That is exactly what makes it feel
 * human, and why Stockfish remains the analysis/assessment engine.
 *
 * The 5M ONNX checkpoint is copied into public/engine by `npm run engine`.
 * inference runs in an ORT worker with the WASM runtime self-hosted so the
 * app still works offline after the first download.
 */
import type { Maia3 as Maia3Instance } from 'maia3-js/web';
import { fetchProgress } from './engineClient';
import type { ChessJsMove } from './engineProtocol';

const MODEL_PATH = 'engine/maia3_5m.onnx';
const ORT_PATH = 'engine/ort/';
const MODEL_BYTES = 22_550_022;

/** Maia-3 is trained on Lichess blitz ratings in this band. */
export const MAIA_MIN_ELO = 600;
export const MAIA_MAX_ELO = 2600;

/**
 * Maia's Elo input is a style target, not a calibrated playing strength.
 * Sampling at a little above zero keeps games varied without turning every
 * move into a random blunder; tune this if the bot feels too strong/weak.
 */
const SAMPLE_TEMPERATURE = 0.65;
const SAMPLE_TOP_P = 0.95;

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || './';
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return new URL(`${normalized}${path}`, document.baseURI).href;
}

function clampElo(value: number): number {
  return Math.max(MAIA_MIN_ELO, Math.min(MAIA_MAX_ELO, Math.round(value)));
}

export class MaiaClient {
  private instance: Maia3Instance | null = null;
  private initialization: Promise<void> | null = null;
  /** Bumped when a pending prediction should be ignored (new game/dispose). */
  private epoch = 0;

  get ready(): boolean {
    return this.instance !== null;
  }

  async init(onProgress?: (phase: 'download' | 'booting' | 'ready', fraction: number) => void): Promise<void> {
    if (this.instance) {
      onProgress?.('ready', 1);
      return;
    }
    if (this.initialization) {
      await this.initialization;
      onProgress?.('ready', 1);
      return;
    }

    const initialization = this.load(onProgress);
    this.initialization = initialization;
    try {
      await initialization;
    } finally {
      if (this.initialization === initialization) this.initialization = null;
    }
  }

  private async load(onProgress?: (phase: 'download' | 'booting' | 'ready', fraction: number) => void): Promise<void> {
    onProgress?.('download', 0);
    const bytes = await fetchProgress(
      assetUrl(MODEL_PATH),
      (fraction) => onProgress?.('download', fraction),
      MODEL_BYTES,
      true
    );
    if (!bytes) throw new Error('Maia-3 model could not be read');

    onProgress?.('booting', 1);
    const { Maia3 } = await import('maia3-js/web');
    const wasmPaths = assetUrl(ORT_PATH);
    const create = (proxy: boolean): Maia3Instance => new Maia3({
      modelBytes: bytes,
      executionProviders: ['wasm'],
      // No COOP/COEP in production, so SharedArrayBuffer (and multi-thread
      // WASM) is unavailable; one thread is the safe cross-browser setting.
      numThreads: 1,
      simd: true,
      proxy,
      wasmPaths,
      temperature: SAMPLE_TEMPERATURE,
      topP: SAMPLE_TOP_P,
      topK: 0,
    });

    // Worker inference keeps the board responsive. If a browser refuses the
    // proxy worker, fall back to the main thread rather than losing the bot.
    let instance = create(true);
    try {
      await instance.load();
    } catch (error) {
      await instance.close().catch(() => {});
      console.warn('[maia] worker inference failed, retrying on the main thread', error);
      instance = create(false);
      await instance.load();
    }
    this.instance = instance;
    onProgress?.('ready', 1);
  }

  /**
   * Pick a move for the side to play. `priorMoves` are UCI moves from the
   * standard start position, oldest first; Maia conditions on the last eight.
   */
  async play(
    fen: string,
    priorMoves: string[],
    selfElo: number,
    oppoElo: number
  ): Promise<ChessJsMove> {
    const instance = this.instance;
    if (!instance) throw new Error('Maia-3 is not loaded');
    const epoch = this.epoch;

    const result = await instance.predict({
      fen,
      priorMoves,
      selfElo: clampElo(selfElo),
      oppoElo: clampElo(oppoElo),
      temperature: SAMPLE_TEMPERATURE,
      topP: SAMPLE_TOP_P,
      // We only need the move, not per-candidate WDL: topK 0 skips the extra
      // forward passes and keeps a phone move under a few hundred ms.
      topK: 0,
    });

    if (epoch !== this.epoch) throw new Error('Maia-3 prediction cancelled');
    const uci = result.bestMove;
    if (!uci || uci.length < 4) throw new Error('Maia-3 returned no move');
    const move: ChessJsMove = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
    if (uci.length > 4) move.promotion = uci[4];
    return move;
  }

  /** Invalidate a prediction that is no longer for the current game. */
  cancelPending(): void {
    this.epoch++;
  }

  async close(): Promise<void> {
    this.epoch++;
    const instance = this.instance;
    this.instance = null;
    await instance?.close().catch(() => {});
  }
}

export const maia = new MaiaClient();
