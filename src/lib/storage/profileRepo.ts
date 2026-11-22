import type {
  AdaptiveNutritionState,
  AppDatabase,
  BodyCompositionScan,
  BodyWeightEntry,
  CoachChatMessage,
  CoachPersonality,
  DailyReadinessEntry,
  ManualDailyActivity,
  ProfileSlot,
  UserProfile,
} from '../../types/fitness';
import { calculateNutritionTargets } from '../../data/foods';
import {
  DEFAULT_PROFILE_SLOTS,
  LEGACY_STORE_NAME,
  LS_ACTIVE_PROFILE_KEY,
  LS_REGISTRY_KEY,
  REGISTRY_RECORD_KEY,
  STORE_HEAVY,
  STORE_META,
  STORE_REGISTRY,
  getIdbKeyForProfile,
  getLsPrefsKeyForProfile,
  openLegacyIndexedDB,
  openPulsoFitDB,
  safeNum,
  safeStr,
  unmarkProfileHydrated,
} from './dbCore';

export function createDefaultProfile(profileName = 'Atleta'): UserProfile {
  return {
    name: profileName,
    weightKg: 75,
    heightCm: 175,
    age: 28,
    sex: 'hombre',
    goal: 'ganar_musculo',
    equipment: ['gimnasio_completo'],
    trainingDaysPerWeek: 4,
    targetWeightKg: 78,
    weightUnit: 'kg',
    distanceUnit: 'km',
    liquidUnit: 'ml',
    waistUnit: 'cm',
    lowPowerMode: 'auto',
    rpeTrackingEnabled: true,
  };
}

export function normalizeUserProfile(
  rawProfile: Partial<UserProfile> | undefined,
  baseProfile: UserProfile,
): UserProfile {
  return {
    ...baseProfile,
    ...(rawProfile ?? {}),
    weightKg: Math.max(25, safeNum(rawProfile?.weightKg, baseProfile.weightKg)),
    heightCm: Math.max(100, safeNum(rawProfile?.heightCm, baseProfile.heightCm)),
    age: Math.max(12, Math.round(safeNum(rawProfile?.age, baseProfile.age))),
    targetWeightKg: Math.max(
      25,
      safeNum(rawProfile?.targetWeightKg, baseProfile.targetWeightKg),
    ),
    trainingDaysPerWeek: Math.max(
      1,
      Math.min(7, Math.round(safeNum(rawProfile?.trainingDaysPerWeek, 4))),
    ),
    weightUnit: rawProfile?.weightUnit === 'lb' ? 'lb' : 'kg',
    distanceUnit: rawProfile?.distanceUnit === 'mi' ? 'mi' : 'km',
    liquidUnit: rawProfile?.liquidUnit === 'oz' ? 'oz' : 'ml',
    waistUnit:
      rawProfile?.waistUnit === 'in' || rawProfile?.waistUnit === 'cm'
        ? rawProfile.waistUnit
        : rawProfile?.distanceUnit === 'mi'
          ? 'in'
          : 'cm',
    preferredVoiceUri:
      typeof rawProfile?.preferredVoiceUri === 'string' &&
      rawProfile.preferredVoiceUri.trim()
        ? rawProfile.preferredVoiceUri.trim()
        : undefined,
    equipment:
      Array.isArray(rawProfile?.equipment) && rawProfile.equipment.length > 0
        ? rawProfile.equipment
        : baseProfile.equipment,
    lowPowerMode:
      rawProfile?.lowPowerMode === 'on' || rawProfile?.lowPowerMode === 'off'
        ? rawProfile.lowPowerMode
        : 'auto',
    rpeTrackingEnabled: rawProfile?.rpeTrackingEnabled !== false,
  };
}

export function normalizeReadinessMap(
  rawReadiness: Record<string, DailyReadinessEntry> | undefined,
  nowIso: string,
): Record<string, DailyReadinessEntry> {
  const normalizedReadiness: Record<string, DailyReadinessEntry> = {};
  if (rawReadiness && typeof rawReadiness === 'object') {
    for (const [k, entry] of Object.entries(rawReadiness)) {
      if (!entry || typeof entry !== 'object') continue;
      normalizedReadiness[k] = {
        ...entry,
        date: entry.date || k,
        sleepHours: safeNum(entry.sleepHours, 7),
        sleepQuality: safeNum(entry.sleepQuality, 3),
        energyLevel: safeNum(entry.energyLevel, 3),
        sorenessLevel: safeNum(entry.sorenessLevel, 2),
        score: Math.max(0, Math.min(100, safeNum(entry.score, 70))),
        updatedAt: safeStr(entry.updatedAt, nowIso),
      };
    }
  }
  return normalizedReadiness;
}

export function normalizeManualActivityMap(
  rawManual: Record<string, ManualDailyActivity> | undefined,
  nowIso: string,
): Record<string, ManualDailyActivity> {
  if (!rawManual || typeof rawManual !== 'object') return {};
  return Object.fromEntries(
    Object.entries(rawManual)
      .filter(([, entry]) => Boolean(entry) && typeof entry === 'object')
      .map(([k, entry]) => [
        k,
        {
          ...entry,
          date: safeStr(entry.date, k),
          steps: Math.max(0, safeNum(entry.steps, 0)),
          activeMin: Math.max(0, safeNum(entry.activeMin, 0)),
          activeKcal: Math.max(0, safeNum(entry.activeKcal, 0)),
          pausaActivaCount:
            typeof entry.pausaActivaCount === 'number'
              ? Math.max(0, Math.round(entry.pausaActivaCount))
              : undefined,
          lastPausaActivaAt:
            typeof entry.lastPausaActivaAt === 'string'
              ? entry.lastPausaActivaAt
              : undefined,
          updatedAt: safeStr(entry.updatedAt, nowIso),
        },
      ]),
  );
}

export function normalizeCoachChatHistory(
  rawHistory: CoachChatMessage[] | undefined,
  nowIso: string,
): CoachChatMessage[] {
  if (!Array.isArray(rawHistory)) return [];
  return rawHistory
    .filter(
      (m): m is CoachChatMessage =>
        Boolean(m) &&
        typeof m === 'object' &&
        typeof m.text === 'string' &&
        m.text.trim().length > 0,
    )
    .slice(-6)
    .map((m, idx) => ({
      id: safeStr(m.id, `coach_msg_${idx}_${Date.now()}`),
      role: m.role === 'user' ? 'user' : 'coach',
      text: m.text.trim(),
      headline: typeof m.headline === 'string' ? m.headline : undefined,
      goodBullets: Array.isArray(m.goodBullets)
        ? m.goodBullets
            .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
            .slice(0, 3)
        : undefined,
      weakBullets: Array.isArray(m.weakBullets)
        ? m.weakBullets
            .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
            .slice(0, 3)
        : undefined,
      actionTip: typeof m.actionTip === 'string' ? m.actionTip : undefined,
      personality: (m.personality === 'motivador' ? 'motivador' : 'sargento') as CoachPersonality,
      source: m.source === 'gemini' ? 'gemini' : 'offline',
      createdAt: safeStr(m.createdAt, nowIso),
    }));
}

export function normalizeScheduledRestDates(rawDates: string[] | undefined): string[] {
  if (!Array.isArray(rawDates)) return [];
  return Array.from(
    new Set(
      rawDates
        .filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim()))
        .map((d) => d.trim()),
    ),
  ).sort();
}

export function recalculateLatestWeightAndAdaptiveNutrition(
  db: AppDatabase,
  nextScans: BodyCompositionScan[],
  nextWeights: BodyWeightEntry[],
): AppDatabase {
  const mergedByDate = new Map<string, number>();
  for (const bw of nextWeights) {
    if (bw.date && Number.isFinite(bw.weightKg) && bw.weightKg > 0) {
      mergedByDate.set(bw.date, bw.weightKg);
    }
  }
  for (const sc of [...nextScans].sort((a, b) =>
    (a.recordedAt || a.date).localeCompare(b.recordedAt || b.date),
  )) {
    if (sc.date && Number.isFinite(sc.weightKg) && sc.weightKg > 0) {
      mergedByDate.set(sc.date, sc.weightKg);
    }
  }

  const sortedDates = Array.from(mergedByDate.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const resolvedWeight =
    sortedDates.length > 0
      ? Math.round(sortedDates[sortedDates.length - 1][1] * 10) / 10
      : db.profile.weightKg;

  const updatedProfile: UserProfile = {
    ...db.profile,
    weightKg:
      Number.isFinite(resolvedWeight) && resolvedWeight > 20
        ? resolvedWeight
        : db.profile.weightKg,
  };

  let nextAdaptive: AdaptiveNutritionState | null = db.adaptiveNutrition ?? null;
  if (nextAdaptive) {
    const prevBase = calculateNutritionTargets(db.profile);
    const nextBase = calculateNutritionTargets(updatedProfile);
    const bmrDelta = nextBase.bmr - prevBase.bmr;
    const nextEstimatedTdee = Math.max(
      Math.round(nextBase.bmr * 1.15),
      Math.round(nextAdaptive.estimatedTdee + bmrDelta),
    );
    let nextCalorieTarget = nextEstimatedTdee;
    if (updatedProfile.goal === 'perder_grasa') {
      nextCalorieTarget = Math.max(1250, Math.round(nextEstimatedTdee - 450));
    } else if (updatedProfile.goal === 'ganar_musculo') {
      nextCalorieTarget = Math.round(nextEstimatedTdee + 280);
    }
    const fatG = Math.max(
      Math.round(updatedProfile.weightKg * 0.7),
      Math.round((nextCalorieTarget * 0.25) / 9),
    );
    const remainingCal = Math.max(
      160,
      nextCalorieTarget - nextBase.proteinG * 4 - fatG * 9,
    );
    nextAdaptive = {
      ...nextAdaptive,
      estimatedTdee: nextEstimatedTdee,
      theoreticalTdee: nextBase.tdee,
      calorieTarget: nextCalorieTarget,
      proteinG: nextBase.proteinG,
      fatG,
      carbsG: Math.round(remainingCal / 4),
      waterMl: nextBase.waterMl,
    };
  }

  return {
    ...db,
    profile: updatedProfile,
    adaptiveNutrition: nextAdaptive,
    bodyScans: nextScans,
    bodyWeights: nextWeights,
  };
}

export function getActiveProfileId(): string {
  if (typeof window === 'undefined') return 'main';
  try {
    return window.localStorage.getItem(LS_ACTIVE_PROFILE_KEY)?.trim() || 'main';
  } catch {
    return 'main';
  }
}

export function setActiveProfileId(profileId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_ACTIVE_PROFILE_KEY, profileId || 'main');
  } catch {
    // Ignore storage quota errors
  }
}

function normalizeRegistry(raw: unknown): ProfileSlot[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PROFILE_SLOTS];
  const valid = raw.filter(
    (item): item is ProfileSlot =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as ProfileSlot).id === 'string' &&
      typeof (item as ProfileSlot).label === 'string',
  );
  const byId = new Map<string, ProfileSlot>();
  for (const def of DEFAULT_PROFILE_SLOTS) {
    byId.set(def.id, def);
  }
  for (const slot of valid) {
    byId.set(slot.id, slot);
  }
  return Array.from(byId.values());
}

export async function loadProfileRegistry(): Promise<ProfileSlot[]> {
  // 1. Try primary PulsoFitDB registry store
  try {
    const db = await openPulsoFitDB();
    const res = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE_REGISTRY, 'readonly');
      const store = tx.objectStore(STORE_REGISTRY);
      const req = store.get(REGISTRY_RECORD_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (res) {
      return normalizeRegistry(res);
    }
  } catch {
    // Fall through to legacy DB / localStorage
  }

  // 2. Migrate from legacy pulsofit_db registry if present
  try {
    const legacyDb = await openLegacyIndexedDB();
    const legacyRes = await new Promise<unknown>((resolve, reject) => {
      const tx = legacyDb.transaction(LEGACY_STORE_NAME, 'readonly');
      const store = tx.objectStore(LEGACY_STORE_NAME);
      const req = store.get(REGISTRY_RECORD_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    legacyDb.close();
    if (legacyRes) {
      const normalized = normalizeRegistry(legacyRes);
      await saveProfileRegistry(normalized);
      return normalized;
    }
  } catch {
    // Fallback to localStorage
  }

  try {
    const lsRaw = localStorage.getItem(LS_REGISTRY_KEY);
    if (lsRaw) {
      const normalized = normalizeRegistry(JSON.parse(lsRaw));
      await saveProfileRegistry(normalized);
      return normalized;
    }
  } catch {
    // Ignore
  }

  return [...DEFAULT_PROFILE_SLOTS];
}

export async function saveProfileRegistry(slots: ProfileSlot[]): Promise<void> {
  const normalized = normalizeRegistry(slots);
  try {
    localStorage.setItem(LS_REGISTRY_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore
  }
  try {
    const db = await openPulsoFitDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_REGISTRY, 'readwrite');
      const store = tx.objectStore(STORE_REGISTRY);
      const req = store.put(normalized, REGISTRY_RECORD_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}

export async function deleteProfileStorage(profileId: string): Promise<void> {
  if (profileId === 'main' || profileId === 'guest') return;
  unmarkProfileHydrated(profileId);
  try {
    localStorage.removeItem(getLsPrefsKeyForProfile(profileId));
  } catch {
    // Ignore
  }
  try {
    const db = await openPulsoFitDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_HEAVY], 'readwrite');
      const key = getIdbKeyForProfile(profileId);
      tx.objectStore(STORE_META).delete(key);
      tx.objectStore(STORE_HEAVY).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}
