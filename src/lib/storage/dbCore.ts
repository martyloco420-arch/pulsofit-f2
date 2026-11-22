import type {
  AppDatabase,
  BloodPressureRecord,
  BodyCompositionScan,
  CardioSession,
  HiitSession,
  ProfileSlot,
  PulseHrvRecord,
  SleepSession,
  WorkoutSession,
} from '../../types/fitness';
import {
  LOW_POWER_IDB_BATCH_MS,
  isLowPowerActiveNow,
} from '../lowPowerMode';

export const CURRENT_SCHEMA_VERSION = 1;

// Primary IndexedDB ("PulsoFitDB") with dedicated stores for metadata & heavy histories
export const DB_NAME = 'PulsoFitDB';
export const DB_VERSION = 1;
export const STORE_META = 'profile_meta';
export const STORE_HEAVY = 'heavy_histories';
export const STORE_REGISTRY = 'registry';

// Legacy IndexedDB ("pulsofit_db") & localStorage keys preserved strictly for migration
export const LEGACY_DB_NAME = 'pulsofit_db';
export const LEGACY_DB_VERSION = 1;
export const LEGACY_STORE_NAME = 'app_state';
export const RECORD_KEY = 'main';
export const LS_FALLBACK_KEY = 'pulsofit_backup_state_v1';

// Lightweight preferences & metadata keys in localStorage
export const REGISTRY_RECORD_KEY = 'profiles_registry';
export const LS_REGISTRY_KEY = 'pulsofit_profiles_registry_v1';
export const LS_ACTIVE_PROFILE_KEY = 'pulsofit_active_profile_v1';
export const LS_PREFS_PREFIX = 'pulsofit_prefs_';

export const DEFAULT_PROFILE_SLOTS: ProfileSlot[] = [
  { id: 'main', label: 'Principal', isDefault: true },
  { id: 'guest', label: 'Invitado / Familia', isDefault: true },
];

export type DataModuleRecordType =
  | 'workouts'
  | 'hiit'
  | 'cardio'
  | 'shoes'
  | 'body_scans'
  | 'body_weights'
  | 'pulse'
  | 'blood_pressure'
  | 'nutrition'
  | 'fasting'
  | 'hydration'
  | 'sleep'
  | 'measurements'
  | 'photos';

export type CleanupCategoryId =
  | 'workouts'
  | 'hiit'
  | 'cardio'
  | 'body_composition'
  | 'pulse'
  | 'blood_pressure'
  | 'nutrition'
  | 'hydration'
  | 'sleep'
  | 'measurements'
  | 'photos'
  | 'manual_activity';

export interface RecordDeleteTarget {
  id?: string;
  timestamp?: string;
  index?: number;
  date?: string;
}

export interface DayRecordBreakdown {
  dateIso: string;
  workouts: number;
  hiit: number;
  cardio: number;
  bodyScans: number;
  bodyWeights: number;
  pulse: number;
  bloodPressure: number;
  foods: number;
  fasts: number;
  hydrationMl: number;
  hydrationLogs: number;
  electrolytes: number;
  sleep: number;
  measurements: number;
  readiness: number;
  manualActivity: number;
  progressPhotoIds: string[];
  totalCount: number;
}

export interface CategorySummaryItem {
  category: CleanupCategoryId;
  label: string;
  description: string;
  count: number;
}

export interface BackupPreviewCounts {
  profileName: string;
  workouts: number;
  cardioSessions: number;
  hiitSessions: number;
  bodyScans: number;
  bodyWeights: number;
  foodLogs: number;
  sleepSessions: number;
  pulseHrvRecords: number;
  bloodPressureRecords: number;
  hydrationDays: number;
  manualActivityDays: number;
}

export interface HeavyHistoryPayload {
  workouts: WorkoutSession[];
  cardioSessions: CardioSession[];
  hiitSessions: HiitSession[];
  sleepSessions: SleepSession[];
  pulseHrvRecords: PulseHrvRecord[];
  bloodPressureRecords: BloodPressureRecord[];
  bodyScans: BodyCompositionScan[];
}

export interface LightweightPrefsPayload {
  weightUnit: AppDatabase['profile']['weightUnit'];
  distanceUnit: AppDatabase['profile']['distanceUnit'];
  liquidUnit: AppDatabase['profile']['liquidUnit'];
  waistUnit: AppDatabase['profile']['waistUnit'];
  lowPowerMode: AppDatabase['profile']['lowPowerMode'];
  preferredVoiceUri?: string;
  dailyStepsGoal?: number;
  dailyActiveMinGoal?: number;
  dailyActiveKcalGoal?: number;
  updatedAt: string;
}

// Strict hydration lock: forbids IndexedDB writes for a profile until initial read & migration finish
const hydratedProfiles = new Set<string>();
let globalHydrated = false;

export function isDatabaseHydrated(profileId = 'main'): boolean {
  return globalHydrated && hydratedProfiles.has(profileId);
}

export function markProfileHydrated(profileId = 'main'): void {
  hydratedProfiles.add(profileId);
  globalHydrated = true;
}

export function unmarkProfileHydrated(profileId: string): void {
  hydratedProfiles.delete(profileId);
}

export function resetAllHydrationLocks(): void {
  hydratedProfiles.clear();
  globalHydrated = false;
}

export function resolveSchemaVersion(raw?: Partial<AppDatabase> | null): number {
  const ver = raw?.schemaVersion;
  return typeof ver === 'number' && Number.isFinite(ver) && ver >= 1
    ? Math.floor(ver)
    : CURRENT_SCHEMA_VERSION;
}

/**
 * Returns local calendar date formatted strictly as YYYY-MM-DD using en-CA locale.
 * Never uses UTC toISOString() day boundaries so late-night entries stay on today's local day.
 */
export function getLocalDateKey(input?: Date | number | string): string {
  if (input === undefined) {
    return new Date().toLocaleDateString('en-CA');
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const dt = new Date(trimmed);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toLocaleDateString('en-CA');
    }
    return new Date().toLocaleDateString('en-CA');
  }
  const dt = typeof input === 'number' ? new Date(input) : input;
  if (Number.isNaN(dt.getTime())) {
    return new Date().toLocaleDateString('en-CA');
  }
  return dt.toLocaleDateString('en-CA');
}

export function getTodayIsoDate(): string {
  return getLocalDateKey(new Date());
}

export function safeNum(val: unknown, fallback = 0): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

export function safeStr(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

export function dedupeById<T extends { id?: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const id = typeof item?.id === 'string' && item.id.trim() ? item.id : null;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(item);
  }
  return out;
}

export function resolveDeleteIndex<T>(
  list: T[],
  target: RecordDeleteTarget,
  getId: (item: T) => string | undefined,
  getTimestamps: (item: T) => (string | undefined)[],
): number {
  if (target.id) {
    const idxById = list.findIndex((item) => getId(item) === target.id);
    if (idxById >= 0) return idxById;
  }
  if (target.timestamp) {
    const idxByTs = list.findIndex((item) =>
      getTimestamps(item).some((ts) => ts && ts === target.timestamp),
    );
    if (idxByTs >= 0) return idxByTs;
  }
  if (
    typeof target.index === 'number' &&
    Number.isInteger(target.index) &&
    target.index >= 0 &&
    target.index < list.length
  ) {
    return target.index;
  }
  return -1;
}

export function openPulsoFitDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
      if (!db.objectStoreNames.contains(STORE_HEAVY)) {
        db.createObjectStore(STORE_HEAVY);
      }
      if (!db.objectStoreNames.contains(STORE_REGISTRY)) {
        db.createObjectStore(STORE_REGISTRY);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open PulsoFitDB'));
  });
}

export function openLegacyIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = indexedDB.open(LEGACY_DB_NAME, LEGACY_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        db.createObjectStore(LEGACY_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open legacy DB'));
  });
}

export function getIdbKeyForProfile(profileId: string): string {
  return profileId === 'main' ? RECORD_KEY : `profile_${profileId}`;
}

export function getLsFallbackKeyForProfile(profileId: string): string {
  // Strictly preserve pulsofit_backup_state_v1 for legacy reads without deleting it
  return profileId === 'main'
    ? LS_FALLBACK_KEY
    : `pulsofit_backup_profile_${profileId}_v1`;
}

export function getLsPrefsKeyForProfile(profileId: string): string {
  return `${LS_PREFS_PREFIX}${profileId || 'main'}_v1`;
}

export function saveLightweightPrefs(
  profileId: string,
  prefs: LightweightPrefsPayload,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getLsPrefsKeyForProfile(profileId), JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

export function splitDatabaseForStorage(data: AppDatabase): {
  meta: Partial<AppDatabase>;
  heavy: HeavyHistoryPayload;
  lightPrefs: LightweightPrefsPayload;
} {
  const heavy: HeavyHistoryPayload = {
    workouts: data.workouts ?? [],
    cardioSessions: data.cardioSessions ?? [],
    hiitSessions: data.hiitSessions ?? [],
    sleepSessions: data.sleepSessions ?? [],
    pulseHrvRecords: data.pulseHrvRecords ?? [],
    bloodPressureRecords: data.bloodPressureRecords ?? [],
    bodyScans: data.bodyScans ?? [],
  };

  const meta: Partial<AppDatabase> = {
    schemaVersion: resolveSchemaVersion(data),
    updatedAt: data.updatedAt,
    profile: data.profile,
    muscleFatigue: data.muscleFatigue,
    activeWorkout: data.activeWorkout,
    workoutTemplates: data.workoutTemplates ?? [],
    shoes: data.shoes ?? [],
    bodyWeights: data.bodyWeights ?? [],
    bodyMeasurements: data.bodyMeasurements ?? [],
    progressPhotos: data.progressPhotos ?? [],
    readinessByDate: data.readinessByDate ?? {},
    foodLogs: data.foodLogs ?? [],
    favoriteMeals: data.favoriteMeals ?? [],
    weeklyMealPlan: data.weeklyMealPlan ?? null,
    hydrationByDate: data.hydrationByDate ?? {},
    hydrationLogsByDate: data.hydrationLogsByDate ?? {},
    hydrationSettings: data.hydrationSettings,
    electrolytesByDate: data.electrolytesByDate ?? {},
    adaptiveNutrition: data.adaptiveNutrition ?? null,
    activeFast: data.activeFast ?? null,
    fastingHistory: data.fastingHistory ?? [],
    manualActivityByDate: data.manualActivityByDate ?? {},
    coachPersonality: data.coachPersonality ?? 'sargento',
    coachChatHistory: (data.coachChatHistory ?? []).slice(-6),
    scheduledRestDates: data.scheduledRestDates ?? [],
  };

  const lightPrefs: LightweightPrefsPayload = {
    weightUnit: data.profile.weightUnit,
    distanceUnit: data.profile.distanceUnit,
    liquidUnit: data.profile.liquidUnit,
    waistUnit: data.profile.waistUnit,
    lowPowerMode: data.profile.lowPowerMode,
    preferredVoiceUri: data.profile.preferredVoiceUri,
    dailyStepsGoal: data.profile.dailyStepsGoal,
    dailyActiveMinGoal: data.profile.dailyActiveMinGoal,
    dailyActiveKcalGoal: data.profile.dailyActiveKcalGoal,
    updatedAt: data.updatedAt,
  };

  return { meta, heavy, lightPrefs };
}

export async function writeProfileToPulsoFitDB(
  payload: AppDatabase,
  profileId: string,
): Promise<void> {
  const idbKey = getIdbKeyForProfile(profileId);
  const { meta, heavy, lightPrefs } = splitDatabaseForStorage(payload);

  // Store lightweight preferences & metadata in localStorage (without heavy GPS/sleep/PPG arrays)
  saveLightweightPrefs(profileId, lightPrefs);

  const db = await openPulsoFitDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_META, STORE_HEAVY], 'readwrite');
    tx.objectStore(STORE_META).put(meta, idbKey);
    tx.objectStore(STORE_HEAVY).put(heavy, idbKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed writing PulsoFitDB'));
  });
  db.close();
}

export async function readRawProfileFromPulsoFitDB(
  profileId: string,
): Promise<Partial<AppDatabase> | null> {
  const idbKey = getIdbKeyForProfile(profileId);
  const db = await openPulsoFitDB();
  const { meta, heavy } = await new Promise<{
    meta: Partial<AppDatabase> | null;
    heavy: Partial<HeavyHistoryPayload> | null;
  }>((resolve, reject) => {
    const tx = db.transaction([STORE_META, STORE_HEAVY], 'readonly');
    const metaReq = tx.objectStore(STORE_META).get(idbKey);
    const heavyReq = tx.objectStore(STORE_HEAVY).get(idbKey);
    let metaRes: Partial<AppDatabase> | null = null;
    let heavyRes: Partial<HeavyHistoryPayload> | null = null;
    metaReq.onsuccess = () => {
      metaRes = (metaReq.result as Partial<AppDatabase>) ?? null;
    };
    heavyReq.onsuccess = () => {
      heavyRes = (heavyReq.result as Partial<HeavyHistoryPayload>) ?? null;
    };
    tx.oncomplete = () => resolve({ meta: metaRes, heavy: heavyRes });
    tx.onerror = () => reject(tx.error ?? new Error('Failed reading PulsoFitDB'));
  });
  db.close();

  if (!meta && !heavy) return null;
  return {
    ...(meta ?? {}),
    ...(heavy ?? {}),
  };
}

export async function readRawProfileFromLegacyStorage(
  profileId: string,
): Promise<Partial<AppDatabase> | null> {
  const idbKey = getIdbKeyForProfile(profileId);
  const lsKey = getLsFallbackKeyForProfile(profileId);

  try {
    const legacyDb = await openLegacyIndexedDB();
    const result = await new Promise<Partial<AppDatabase> | null>((resolve, reject) => {
      const tx = legacyDb.transaction(LEGACY_STORE_NAME, 'readonly');
      const store = tx.objectStore(LEGACY_STORE_NAME);
      const req = store.get(idbKey);
      req.onsuccess = () => resolve((req.result as Partial<AppDatabase>) ?? null);
      req.onerror = () => reject(req.error);
    });
    legacyDb.close();
    if (result) {
      return result;
    }
  } catch {
    // Fall through to legacy localStorage backup
  }

  try {
    const lsRaw = localStorage.getItem(lsKey);
    if (lsRaw) {
      return JSON.parse(lsRaw) as Partial<AppDatabase>;
    }
  } catch {
    // Ignore parse error
  }

  return null;
}

export async function loadAppDatabaseWithNormalizer(
  profileId: string,
  normalizer: (raw: Partial<AppDatabase>) => AppDatabase,
  createInitial: (profileName: string) => AppDatabase,
): Promise<AppDatabase> {
  let rawResolved: Partial<AppDatabase> | null = null;
  let migratedFromLegacy = false;

  try {
    rawResolved = await readRawProfileFromPulsoFitDB(profileId);
  } catch {
    rawResolved = null;
  }

  if (!rawResolved) {
    const legacyRaw = await readRawProfileFromLegacyStorage(profileId);
    if (legacyRaw) {
      rawResolved = legacyRaw;
      migratedFromLegacy = true;
    }
  }

  const resolved = rawResolved
    ? normalizer(rawResolved)
    : createInitial(profileId === 'guest' ? 'Invitado' : 'Atleta');

  // Persist migrated legacy data cleanly into PulsoFitDB BEFORE unlocking writes
  if (migratedFromLegacy) {
    try {
      await writeProfileToPulsoFitDB(resolved, profileId);
    } catch {
      // Even if IDB write fails (e.g. private browsing), hydrated state stays safe in memory
    }
  }

  // Unlock writes ONLY after hydration & migration completed
  markProfileHydrated(profileId);
  return resolved;
}

export async function saveAppDatabase(
  data: AppDatabase,
  profileId = 'main',
  options?: { force?: boolean },
): Promise<void> {
  // Strict isHydrated guard: never overwrite existing IndexedDB data before hydration completes
  if (!options?.force && !isDatabaseHydrated(profileId)) {
    return;
  }

  if (options?.force) {
    markProfileHydrated(profileId);
  }

  const payload: AppDatabase = {
    ...data,
    schemaVersion: resolveSchemaVersion(data),
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeProfileToPulsoFitDB(payload, profileId);
  } catch {
    // Fallback: ensure lightweight prefs are still updated in localStorage
    const { lightPrefs } = splitDatabaseForStorage(payload);
    saveLightweightPrefs(profileId, lightPrefs);
  }
}

const pendingDbSaves = new Map<string, AppDatabase>();
const pendingSaveTimers = new Map<string, number>();
let flushLifecycleRegistered = false;

export function clearScheduledBatchForProfile(profileId: string): void {
  const timerId = pendingSaveTimers.get(profileId);
  if (timerId !== undefined && typeof window !== 'undefined') {
    window.clearTimeout(timerId);
  }
  pendingSaveTimers.delete(profileId);
}

export function clearAllPendingBatches(): void {
  for (const profileId of Array.from(pendingSaveTimers.keys())) {
    clearScheduledBatchForProfile(profileId);
  }
  pendingDbSaves.clear();
}

export async function flushPendingAppDatabaseSaves(
  targetProfileId?: string,
): Promise<void> {
  const ids = targetProfileId
    ? pendingDbSaves.has(targetProfileId)
      ? [targetProfileId]
      : []
    : Array.from(pendingDbSaves.keys());

  await Promise.all(
    ids.map(async (id) => {
      clearScheduledBatchForProfile(id);
      const pendingData = pendingDbSaves.get(id);
      pendingDbSaves.delete(id);
      if (pendingData && hydratedProfiles.has(id)) {
        await saveAppDatabase(pendingData, id);
      }
    }),
  );
}

function ensureFlushLifecycleListeners(): void {
  if (flushLifecycleRegistered || typeof window === 'undefined') return;
  flushLifecycleRegistered = true;

  const flushAll = () => {
    void flushPendingAppDatabaseSaves();
  };

  window.addEventListener('pagehide', flushAll);
  window.addEventListener('beforeunload', flushAll);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushAll();
      }
    });
  }
}

export function scheduleSaveAppDatabase(
  data: AppDatabase,
  profileId = 'main',
): void {
  // Refuse scheduling writes until initial load/migration finishes for this profile
  if (!isDatabaseHydrated(profileId)) {
    return;
  }

  ensureFlushLifecycleListeners();

  if (!isLowPowerActiveNow() || typeof window === 'undefined') {
    clearScheduledBatchForProfile(profileId);
    pendingDbSaves.delete(profileId);
    void saveAppDatabase(data, profileId);
    return;
  }

  // Low Power Mode active: coalesce & batch IndexedDB writes every 30s
  pendingDbSaves.set(profileId, data);
  if (!pendingSaveTimers.has(profileId)) {
    const timerId = window.setTimeout(() => {
      pendingSaveTimers.delete(profileId);
      const latest = pendingDbSaves.get(profileId);
      pendingDbSaves.delete(profileId);
      if (latest && hydratedProfiles.has(profileId)) {
        void saveAppDatabase(latest, profileId);
      }
    }, LOW_POWER_IDB_BATCH_MS);
    pendingSaveTimers.set(profileId, timerId);
  }
}

export async function persistProfileDatabaseImmediate(
  data: AppDatabase,
  profileId = 'main',
): Promise<void> {
  if (!isDatabaseHydrated(profileId)) return;
  clearScheduledBatchForProfile(profileId);
  pendingDbSaves.delete(profileId);
  await saveAppDatabase(data, profileId);
}

export async function deleteIndexedDbSafe(name: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const fallbackTimer =
      typeof window !== 'undefined' ? window.setTimeout(finish, 900) : null;
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => {
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
        finish();
      };
      req.onerror = () => {
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
        finish();
      };
      req.onblocked = () => {
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
        finish();
      };
    } catch {
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      finish();
    }
  });
}

export async function clearPulsoFitStoresIfOpen(): Promise<void> {
  try {
    const db = await openPulsoFitDB();
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction([STORE_META, STORE_HEAVY, STORE_REGISTRY], 'readwrite');
        tx.objectStore(STORE_META).clear();
        tx.objectStore(STORE_HEAVY).clear();
        tx.objectStore(STORE_REGISTRY).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore store clear error
  }
}
