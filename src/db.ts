/**
 * IndexedDB persistence: profile, settings, games, rating history, puzzle attempts.
 */
import type { GameRecord, Profile, RatingHistoryPoint, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const DB_NAME = 'gambit';
const DB_VERSION = 2;

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('games')) {
        const s = db.createObjectStore('games', { keyPath: 'id', autoIncrement: true });
        s.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains('history')) {
        db.createObjectStore('history', { keyPath: 'ts' });
      }
      if (!db.objectStoreNames.contains('attempts')) {
        db.createObjectStore('attempts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('reviews')) {
        db.createObjectStore('reviews', { keyPath: 'gameTs' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export const DEFAULT_PROFILE: Profile = {
  rating: 1500,
  rd: 350,
  volatility: 0.06,
  lastPlayed: 0,
  assessed: false,
};

export async function getProfile(): Promise<Profile> {
  const p = await tx<Profile | undefined>('kv', 'readonly', (s) => s.get('profile'));
  return p ?? { ...DEFAULT_PROFILE };
}

export async function saveProfile(p: Profile): Promise<void> {
  await tx('kv', 'readwrite', (s) => s.put(p, 'profile'));
}

export async function getSettings(): Promise<Settings> {
  const s = await tx<Settings | undefined>('kv', 'readonly', (st) => st.get('settings'));
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await tx('kv', 'readwrite', (st) => st.put(s, 'settings'));
}

export async function addGame(g: GameRecord): Promise<void> {
  await tx('games', 'readwrite', (s) => s.put(g) as unknown as IDBRequest<unknown>);
}

export async function recentGames(limit = 20): Promise<GameRecord[]> {
  const all = await tx<GameRecord[]>('games', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export async function addHistory(h: RatingHistoryPoint): Promise<void> {
  await tx('history', 'readwrite', (s) => s.put(h) as unknown as IDBRequest<unknown>);
}

export async function getHistory(limit = 100): Promise<RatingHistoryPoint[]> {
  const all = await tx<RatingHistoryPoint[]>('history', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => a.ts - b.ts).slice(-limit);
}

export async function addAttempt(a: { id: string; won: boolean; rating: number; ts: number }): Promise<void> {
  await tx('attempts', 'readwrite', (s) => s.put(a) as unknown as IDBRequest<unknown>);
}

export async function getAttempts(): Promise<{ id: string; won: boolean; rating: number; ts: number }[]> {
  return tx('attempts', 'readonly', (s) => s.getAll());
}

// ---- Saved game reviews (deep analysis) ----

export interface SavedReview {
  gameTs: number;
  savedAt: number;
  review: unknown; // DeepReview (kept untyped here to avoid an import cycle)
}

export async function saveReview(gameTs: number, review: unknown): Promise<void> {
  await tx('reviews', 'readwrite', (s) =>
    s.put({ gameTs, savedAt: Date.now(), review }) as unknown as IDBRequest<unknown>
  );
}

export async function getReview(gameTs: number): Promise<unknown | null> {
  const r = await tx<SavedReview | undefined>('reviews', 'readonly', (s) => s.get(gameTs));
  return r?.review ?? null;
}

export async function reviewedGameTimestamps(): Promise<Set<number>> {
  const all = await tx<SavedReview[]>('reviews', 'readonly', (s) => s.getAll());
  return new Set(all.map((r) => r.gameTs));
}

export async function clearAll(): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(['kv', 'games', 'history', 'attempts', 'reviews'], 'readwrite');
    t.objectStore('kv').clear();
    t.objectStore('games').clear();
    t.objectStore('history').clear();
    t.objectStore('attempts').clear();
    t.objectStore('reviews').clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Export a JSON backup of everything. */
export async function exportData(): Promise<string> {
  const [profile, settings, games, history, attempts, reviews] = await Promise.all([
    getProfile(),
    getSettings(),
    tx<GameRecord[]>('games', 'readonly', (s) => s.getAll()),
    tx<RatingHistoryPoint[]>('history', 'readonly', (s) => s.getAll()),
    getAttempts(),
    tx<SavedReview[]>('reviews', 'readonly', (s) => s.getAll()),
  ]);
  return JSON.stringify(
    { app: 'gambit', version: 2, exportedAt: Date.now(), profile, settings, games, history, attempts, reviews },
    null,
    2
  );
}

export async function importData(json: string): Promise<void> {
  const d = JSON.parse(json) as {
    profile?: Profile;
    settings?: Settings;
    games?: GameRecord[];
    history?: RatingHistoryPoint[];
    attempts?: { id: string; won: boolean; rating: number; ts: number }[];
    reviews?: SavedReview[];
  };
  if (d.profile) await saveProfile(d.profile);
  if (d.settings) await saveSettings({ ...DEFAULT_SETTINGS, ...d.settings });
  if (d.games) for (const g of d.games) await addGame(g);
  if (d.history) for (const h of d.history) await addHistory(h);
  if (d.attempts) for (const a of d.attempts) await addAttempt(a);
  if (d.reviews) for (const r of d.reviews) await saveReview(r.gameTs, r.review);
}
