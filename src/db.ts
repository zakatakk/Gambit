/** IndexedDB persistence: profile, settings, games, rating history, and puzzle attempts. */
import type { GameRecord, Profile, PuzzleAttempt, RatingHistoryPoint, Settings } from './types';
import { DEFAULT_SETTINGS, TIME_CONTROLS } from './types';

const DB_NAME = 'gambit';
const DB_VERSION = 3;
const GAME_TS_INDEX = 'ts';
const LIVE_GAME_KEY = 'livegame';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('games')) {
        const games = db.createObjectStore('games', { keyPath: 'id', autoIncrement: true });
        games.createIndex(GAME_TS_INDEX, 'ts');
      }
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'ts' });
      if (!db.objectStoreNames.contains('attempts')) db.createObjectStore('attempts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('reviews')) db.createObjectStore('reviews', { keyPath: 'gameTs' });
      if (!db.objectStoreNames.contains('livegame')) db.createObjectStore('livegame');
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open Gambit storage'));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      dbPromise = null;
      reject(new Error('Gambit storage upgrade is blocked by another tab'));
    };
  });
  return dbPromise;
}

function transaction<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => IDBRequest<T> | void
): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      reject(error);
      return;
    }
    let result: T | undefined;
    let settled = false;
    const fail = (error: DOMException | null) => {
      if (settled) return;
      settled = true;
      reject(error ?? new Error('IndexedDB transaction failed'));
    };
    try {
      const request = run(tx);
      if (request) {
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => fail(request.error);
      }
    } catch (error) {
      try { tx.abort(); } catch { /* transaction may already be inactive */ }
      settled = true;
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error);
  }));
}

function requestTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  requestFor: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return transaction<T>(storeName, mode, (tx) => requestFor(tx.objectStore(storeName)))
    .then((value) => value as T);
}

function recentRecords<T>(storeName: string, limit: number, indexName?: string): Promise<T[]> {
  if (!Number.isFinite(limit) || limit <= 0) return Promise.resolve([]);
  const boundedLimit = Math.floor(limit);
  return open().then((db) => new Promise<T[]>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(storeName, 'readonly');
    } catch (error) {
      reject(error);
      return;
    }
    const store = tx.objectStore(storeName);
    const source = indexName ? store.index(indexName) : store;
    const request = source.openCursor(null, 'prev');
    const records: T[] = [];
    let settled = false;
    const fail = (error: DOMException | null) => {
      if (settled) return;
      settled = true;
      reject(error ?? new Error(`IndexedDB cursor failed: ${storeName}`));
    };
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || records.length >= boundedLimit) return;
      records.push(cursor.value as T);
      if (records.length < boundedLimit) cursor.continue();
    };
    request.onerror = () => fail(request.error);
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(records);
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error);
  }));
}

export const DEFAULT_PROFILE: Profile = {
  rating: 1500,
  rd: 350,
  volatility: 0.06,
  lastPlayed: 0,
  assessed: false,
};

export async function getProfile(): Promise<Profile> {
  const profile = await requestTransaction<Profile | undefined>('kv', 'readonly', (store) => store.get('profile'));
  return profile ?? { ...DEFAULT_PROFILE };
}

export async function updateProfile(updates: Partial<Profile>): Promise<Profile> {
  let updated: Profile = { ...DEFAULT_PROFILE };
  await transaction<void>('kv', 'readwrite', (tx) => {
    const store = tx.objectStore('kv');
    const request = store.get('profile');
    request.onsuccess = () => {
      updated = { ...DEFAULT_PROFILE, ...request.result, ...updates };
      store.put(updated, 'profile');
    };
  });
  return updated;
}

async function saveRatedResult(
  profile: Profile,
  point: RatingHistoryPoint,
  attempt?: PuzzleAttempt
): Promise<void> {
  const stores = attempt ? ['kv', 'history', 'attempts'] : ['kv', 'history'];
  await transaction<void>(stores, 'readwrite', (tx) => {
    const profileStore = tx.objectStore('kv');
    const existingProfile = profileStore.get('profile');
    existingProfile.onsuccess = () => {
      const current = existingProfile.result as Profile | undefined;
      profileStore.put({ ...profile, assessed: current?.assessed ?? profile.assessed }, 'profile');
    };
    tx.objectStore('history').put(point);
    if (attempt) tx.objectStore('attempts').put(attempt);
  });
}

export async function saveProfileAndHistory(profile: Profile, point: RatingHistoryPoint): Promise<void> {
  await saveRatedResult(profile, point);
}

export async function savePuzzleRatingResult(
  profile: Profile,
  point: RatingHistoryPoint,
  attempt: PuzzleAttempt
): Promise<void> {
  await saveRatedResult(profile, point, attempt);
}

export async function getSettings(): Promise<Settings> {
  const settings = await requestTransaction<Partial<Settings> | undefined>('kv', 'readonly', (store) => store.get('settings'));
  return { ...DEFAULT_SETTINGS, ...settings };
}

/** Atomically merge preference changes so near-simultaneous controls don't overwrite one another. */
export async function updateSettings(updates: Partial<Settings>): Promise<Settings> {
  let updated: Settings = { ...DEFAULT_SETTINGS };
  await transaction<void>('kv', 'readwrite', (tx) => {
    const store = tx.objectStore('kv');
    const request = store.get('settings');
    request.onsuccess = () => {
      updated = { ...DEFAULT_SETTINGS, ...request.result, ...updates };
      store.put(updated, 'settings');
    };
  });
  return updated;
}

export async function addGame(game: GameRecord): Promise<number> {
  const key = await requestTransaction<IDBValidKey>('games', 'readwrite', (store) => store.add(game));
  if (typeof key !== 'number') throw new TypeError('Expected a numeric game ID');
  return key;
}

export async function updateGame(game: GameRecord): Promise<void> {
  if (game.id === undefined) throw new TypeError('Cannot update a game without its ID');
  await requestTransaction('games', 'readwrite', (store) => store.put(game));
}

export function recentGames(limit = 20): Promise<GameRecord[]> {
  return recentRecords<GameRecord>('games', limit, GAME_TS_INDEX);
}

export function countGames(): Promise<number> {
  return requestTransaction<number>('games', 'readonly', (store) => store.count());
}

export async function getHistory(limit = 100): Promise<RatingHistoryPoint[]> {
  return (await recentRecords<RatingHistoryPoint>('history', limit)).reverse();
}

export function getAttempts(): Promise<PuzzleAttempt[]> {
  return requestTransaction('attempts', 'readonly', (store) => store.getAll());
}

/** Store a puzzle attempt without touching the rating (practice mode). */
export function addAttempt(attempt: PuzzleAttempt): Promise<unknown> {
  return requestTransaction('attempts', 'readwrite', (store) => store.put(attempt));
}

export interface SavedReview {
  gameTs: number;
  savedAt: number;
  review: unknown;
}

export async function saveReview(gameTs: number, review: unknown): Promise<void> {
  await requestTransaction('reviews', 'readwrite', (store) =>
    store.put({ gameTs, savedAt: Date.now(), review })
  );
}

export async function getReview(gameTs: number): Promise<unknown | null> {
  const saved = await requestTransaction<SavedReview | undefined>('reviews', 'readonly', (store) => store.get(gameTs));
  return saved?.review ?? null;
}

export async function reviewedGameTimestamps(): Promise<Set<number>> {
  const reviews = await requestTransaction<SavedReview[]>('reviews', 'readonly', (store) => store.getAll());
  return new Set(reviews.map((review) => review.gameTs));
}

export async function clearAll(): Promise<void> {
  await transaction(['kv', 'games', 'history', 'attempts', 'reviews', 'livegame'], 'readwrite', (tx) => {
    tx.objectStore('kv').clear();
    tx.objectStore('games').clear();
    tx.objectStore('history').clear();
    tx.objectStore('attempts').clear();
    tx.objectStore('reviews').clear();
    tx.objectStore('livegame').clear();
  });
}

/** Persist the unfinished-game snapshot (null clears it). Single-slot by design. */
export async function saveLiveGame(state: unknown): Promise<void> {
  await requestTransaction('livegame', 'readwrite', (store) => store.put(state, LIVE_GAME_KEY));
}
export async function getLiveGame(): Promise<unknown | null> {
  return requestTransaction<unknown>('livegame', 'readonly', (store) => store.get(LIVE_GAME_KEY));
}

export async function clearLiveGame(): Promise<void> {
  await requestTransaction('livegame', 'readwrite', (store) => store.delete(LIVE_GAME_KEY));
}

/** Persist the in-progress assessment snapshot (null clears it). */
export async function saveSavedAssessment(state: unknown): Promise<void> {
  await requestTransaction('kv', 'readwrite', (store) => store.put(state, 'assessment'));
}

export async function getSavedAssessment(): Promise<unknown | null> {
  return requestTransaction<unknown>('kv', 'readonly', (store) => store.get('assessment'));
}

/** Export a JSON backup of everything stored by the app. */
export async function exportData(): Promise<string> {
  const [profile, settings, games, history, attempts, reviews] = await Promise.all([
    getProfile(),
    getSettings(),
    requestTransaction<GameRecord[]>('games', 'readonly', (store) => store.getAll()),
    requestTransaction<RatingHistoryPoint[]>('history', 'readonly', (store) => store.getAll()),
    getAttempts(),
    requestTransaction<SavedReview[]>('reviews', 'readonly', (store) => store.getAll()),
  ]);
  return JSON.stringify({ app: 'gambit', version: 2, exportedAt: Date.now(), profile, settings, games, history, attempts, reviews }, null, 2);
}

interface BackupData {
  app?: unknown;
  profile?: Profile;
  settings?: Partial<Settings>;
  games?: GameRecord[];
  history?: RatingHistoryPoint[];
  attempts?: PuzzleAttempt[];
  reviews?: SavedReview[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isProfile(value: unknown): value is Profile {
  return isObject(value) && finiteNumber(value.rating) && finiteNumber(value.rd) &&
    finiteNumber(value.volatility) && finiteNumber(value.lastPlayed) && typeof value.assessed === 'boolean';
}

function isSettings(value: unknown): value is Partial<Settings> {
  if (!isObject(value)) return false;
  if (value.theme !== undefined && !['system', 'light', 'dark'].includes(String(value.theme))) return false;
  if (value.skin !== undefined && !['classic', 'midnight', 'bauhaus', 'lakehouse', 'cyber'].includes(String(value.skin))) return false;
  if (value.sounds !== undefined && typeof value.sounds !== 'boolean') return false;
  if (value.strictMode !== undefined && typeof value.strictMode !== 'boolean') return false;
  if (value.engineTier !== undefined && !['lite', 'full'].includes(String(value.engineTier))) return false;
  if (value.pieceSet !== undefined && !['cburnett', 'staunty', 'merida'].includes(String(value.pieceSet))) return false;
  if (value.boardTheme !== undefined && !['auto', 'walnut', 'marine', 'slate'].includes(String(value.boardTheme))) return false;
  if (value.accent !== undefined && !['oxblood', 'forest', 'royal', 'aubergine'].includes(String(value.accent))) return false;
  if (value.autoQueen !== undefined && typeof value.autoQueen !== 'boolean') return false;
  if (value.showCoords !== undefined && typeof value.showCoords !== 'boolean') return false;
  if (value.lastTimeControl !== undefined &&
      !TIME_CONTROLS.some((entry) => entry.id === value.lastTimeControl)) return false;
  if (value.lastColor !== undefined && !['random', 'w', 'b'].includes(String(value.lastColor))) return false;
  return value.lastOpponentRating === undefined || finiteNumber(value.lastOpponentRating);
}

function isGame(value: unknown): value is GameRecord {
  return isObject(value) && finiteNumber(value.ts) &&
    ['cpu', 'assessment', 'passplay'].includes(String(value.type)) && ['w', 'b'].includes(String(value.color)) &&
    ['win', 'loss', 'draw', 'abandoned'].includes(String(value.result)) &&
    typeof value.movesUci === 'string' && typeof value.startFen === 'string' &&
    finiteNumber(value.opponentRating) && ['lite', 'full'].includes(String(value.opponentTier)) &&
    typeof value.rated === 'boolean' && typeof value.termination === 'string' &&
    (value.id === undefined || finiteNumber(value.id)) &&
    (value.ratingBefore === undefined || finiteNumber(value.ratingBefore)) &&
    (value.ratingAfter === undefined || finiteNumber(value.ratingAfter));
}

function isHistory(value: unknown): value is RatingHistoryPoint {
  return isObject(value) && finiteNumber(value.ts) && finiteNumber(value.rating) && finiteNumber(value.rd) &&
    ['assessment', 'game', 'puzzle', 'reset', 'seed'].includes(String(value.kind));
}

function isAttempt(value: unknown): value is PuzzleAttempt {
  return isObject(value) && typeof value.id === 'string' && typeof value.won === 'boolean' &&
    finiteNumber(value.rating) && finiteNumber(value.ts) &&
    (value.score === undefined || finiteNumber(value.score)) &&
    (value.mistakes === undefined || finiteNumber(value.mistakes));
}

function isSavedReview(value: unknown): value is SavedReview {
  return isObject(value) && finiteNumber(value.gameTs) && finiteNumber(value.savedAt) && 'review' in value;
}

function validateBackup(json: string): BackupData {
  const data: unknown = JSON.parse(json);
  if (!isObject(data) || data.app !== 'gambit') throw new TypeError('Not a Gambit backup file');
  if (data.profile !== undefined && !isProfile(data.profile)) throw new TypeError('Invalid profile in backup');
  if (data.settings !== undefined && !isSettings(data.settings)) throw new TypeError('Invalid settings in backup');
  const validators = { games: isGame, history: isHistory, attempts: isAttempt, reviews: isSavedReview } as const;
  for (const [key, validate] of Object.entries(validators)) {
    const records = data[key];
    if (records !== undefined && (!Array.isArray(records) || !records.every(validate))) {
      throw new TypeError(`Invalid ${key} in backup`);
    }
  }
  return data as BackupData;
}

/** Validate all records before atomically replacing app-owned data. */
export async function importData(json: string): Promise<void> {
  const backup = validateBackup(json);
  await transaction(['kv', 'games', 'history', 'attempts', 'reviews'], 'readwrite', (tx) => {
    const kv = tx.objectStore('kv');
    const games = tx.objectStore('games');
    const history = tx.objectStore('history');
    const attempts = tx.objectStore('attempts');
    const reviews = tx.objectStore('reviews');
    kv.clear();
    games.clear();
    history.clear();
    attempts.clear();
    reviews.clear();
    if (backup.profile) kv.put(backup.profile, 'profile');
    if (backup.settings) kv.put({ ...DEFAULT_SETTINGS, ...backup.settings }, 'settings');
    for (const { id: _id, ...game } of backup.games ?? []) games.add(game);
    for (const point of backup.history ?? []) history.put(point);
    for (const attempt of backup.attempts ?? []) attempts.put(attempt);
    for (const review of backup.reviews ?? []) reviews.put(review);
  });
}
