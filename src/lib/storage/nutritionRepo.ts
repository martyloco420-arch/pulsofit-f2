import type {
  AppDatabase,
  FoodEntry,
  HydrationSettings,
} from '../../types/fitness';
import {
  type RecordDeleteTarget,
  getLocalDateKey,
  getTodayIsoDate,
  resolveDeleteIndex,
  safeNum,
  safeStr,
} from './dbCore';

export function createDefaultHydrationSettings(): HydrationSettings {
  return {
    mlPerKg: 35,
    containerMl: 500,
    wakeHour: 7,
    sleepHour: 22,
    hotDayByDate: {},
    remindersEnabled: false,
  };
}

export function normalizeFoodLogs(
  rawFoods: Partial<FoodEntry>[] | undefined,
  nowIso: string,
): FoodEntry[] {
  return (Array.isArray(rawFoods) ? rawFoods : []).map((f, i) => ({
    id: safeStr(f?.id, `food_norm_${i}_${Date.now()}`),
    date: getLocalDateKey(f?.date || f?.createdAt || getTodayIsoDate()),
    mealType:
      f?.mealType === 'desayuno' ||
      f?.mealType === 'almuerzo' ||
      f?.mealType === 'cena' ||
      f?.mealType === 'snack'
        ? f.mealType
        : 'almuerzo',
    name: safeStr(f?.name, 'Alimento'),
    calories: Math.max(0, Math.round(safeNum(f?.calories, 0))),
    proteinG: Math.max(0, safeNum(f?.proteinG, 0)),
    carbsG: Math.max(0, safeNum(f?.carbsG, 0)),
    fatG: Math.max(0, safeNum(f?.fatG, 0)),
    createdAt: safeStr(f?.createdAt, nowIso),
  }));
}

export function normalizeHydrationSettings(
  rawSettings: Partial<HydrationSettings> | undefined,
): HydrationSettings {
  const defaults = createDefaultHydrationSettings();
  return {
    ...defaults,
    ...(rawSettings ?? {}),
    hotDayByDate:
      rawSettings?.hotDayByDate && typeof rawSettings.hotDayByDate === 'object'
        ? rawSettings.hotDayByDate
        : {},
  };
}

export function normalizeNutritionDomain(
  raw: Partial<AppDatabase>,
  nowIso: string,
): Pick<
  AppDatabase,
  | 'foodLogs'
  | 'favoriteMeals'
  | 'weeklyMealPlan'
  | 'hydrationByDate'
  | 'hydrationLogsByDate'
  | 'hydrationSettings'
  | 'electrolytesByDate'
  | 'adaptiveNutrition'
  | 'activeFast'
  | 'fastingHistory'
> {
  return {
    foodLogs: normalizeFoodLogs(raw.foodLogs, nowIso),
    favoriteMeals: Array.isArray(raw.favoriteMeals) ? raw.favoriteMeals : [],
    weeklyMealPlan: raw.weeklyMealPlan ?? null,
    hydrationByDate:
      raw.hydrationByDate && typeof raw.hydrationByDate === 'object'
        ? raw.hydrationByDate
        : {},
    hydrationLogsByDate:
      raw.hydrationLogsByDate && typeof raw.hydrationLogsByDate === 'object'
        ? raw.hydrationLogsByDate
        : {},
    hydrationSettings: normalizeHydrationSettings(raw.hydrationSettings),
    electrolytesByDate:
      raw.electrolytesByDate && typeof raw.electrolytesByDate === 'object'
        ? raw.electrolytesByDate
        : {},
    adaptiveNutrition: raw.adaptiveNutrition ?? null,
    activeFast: raw.activeFast ?? null,
    fastingHistory: Array.isArray(raw.fastingHistory) ? raw.fastingHistory : [],
  };
}

export function deleteFoodRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; changed: boolean } {
  const list = db.foodLogs ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (f) => f.id,
    (f) => [f.createdAt, f.date],
  );
  if (idx < 0) return { nextDb: db, changed: false };
  return {
    nextDb: { ...db, foodLogs: list.filter((_, i) => i !== idx) },
    changed: true,
  };
}

export function deleteFastingRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; changed: boolean } {
  const list = db.fastingHistory ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (f) => f.id,
    (f) => [f.endedAt, f.startedAt, f.date],
  );
  if (idx < 0) return { nextDb: db, changed: false };
  return {
    nextDb: { ...db, fastingHistory: list.filter((_, i) => i !== idx) },
    changed: true,
  };
}

export function deleteHydrationLogRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; changed: boolean } {
  const targetDate = target.date || getTodayIsoDate();
  const today = getTodayIsoDate();
  const existingLogs = db.hydrationLogsByDate?.[targetDate] ?? [];
  const currentTotal = db.hydrationByDate?.[targetDate] ?? 0;

  if (existingLogs.length === 0) {
    if (currentTotal > 0 && target.index === 0) {
      const nextHydrationByDate = { ...db.hydrationByDate, [targetDate]: 0 };
      const nextActiveFast =
        db.activeFast && targetDate === today
          ? { ...db.activeFast, waterGlassesCount: 0 }
          : db.activeFast;
      return {
        nextDb: {
          ...db,
          activeFast: nextActiveFast,
          hydrationByDate: nextHydrationByDate,
        },
        changed: true,
      };
    }
    return { nextDb: db, changed: false };
  }

  const idx = resolveDeleteIndex(
    existingLogs,
    target,
    (l) => l.id,
    (l) => [l.recordedAt, l.date],
  );
  if (idx < 0) return { nextDb: db, changed: false };
  const removed = existingLogs[idx];
  const nextLogs = existingLogs.filter((_, i) => i !== idx);
  const nextVal = Math.max(0, currentTotal - removed.amountMl);
  const removedGlasses = Math.max(1, Math.round(removed.amountMl / 250));
  const nextActiveFast =
    db.activeFast && targetDate === today
      ? {
          ...db.activeFast,
          waterGlassesCount: Math.max(
            0,
            db.activeFast.waterGlassesCount - removedGlasses,
          ),
        }
      : db.activeFast;

  return {
    nextDb: {
      ...db,
      activeFast: nextActiveFast,
      hydrationByDate: {
        ...db.hydrationByDate,
        [targetDate]: nextVal,
      },
      hydrationLogsByDate: {
        ...(db.hydrationLogsByDate ?? {}),
        [targetDate]: nextLogs,
      },
    },
    changed: true,
  };
}

export function countNutritionDomainByDate(
  db: AppDatabase,
  dateIso: string,
): {
  foods: number;
  fasts: number;
  hydrationMl: number;
  hydrationLogs: number;
  electrolytes: number;
} {
  return {
    foods: (db.foodLogs ?? []).filter(
      (f) => getLocalDateKey(f.date || f.createdAt) === dateIso,
    ).length,
    fasts: (db.fastingHistory ?? []).filter(
      (f) => getLocalDateKey(f.date || f.endedAt) === dateIso,
    ).length,
    hydrationMl: db.hydrationByDate?.[dateIso] ?? 0,
    hydrationLogs: (db.hydrationLogsByDate?.[dateIso] ?? []).length,
    electrolytes: db.electrolytesByDate?.[dateIso] ?? 0,
  };
}

export function filterNutritionDomainByDate(
  db: AppDatabase,
  dateIso: string,
): Pick<
  AppDatabase,
  | 'foodLogs'
  | 'fastingHistory'
  | 'hydrationByDate'
  | 'hydrationLogsByDate'
  | 'electrolytesByDate'
  | 'hydrationSettings'
  | 'activeFast'
> {
  const nextHydrationByDate = { ...(db.hydrationByDate ?? {}) };
  delete nextHydrationByDate[dateIso];
  const nextHydrationLogsByDate = { ...(db.hydrationLogsByDate ?? {}) };
  delete nextHydrationLogsByDate[dateIso];
  const nextElectrolytesByDate = { ...(db.electrolytesByDate ?? {}) };
  delete nextElectrolytesByDate[dateIso];
  const nextHotDays = { ...(db.hydrationSettings?.hotDayByDate ?? {}) };
  delete nextHotDays[dateIso];

  const today = getTodayIsoDate();
  const nextActiveFast =
    db.activeFast && dateIso === today
      ? { ...db.activeFast, waterGlassesCount: 0, electrolytesCount: 0 }
      : db.activeFast;

  return {
    foodLogs: (db.foodLogs ?? []).filter(
      (f) => getLocalDateKey(f.date || f.createdAt) !== dateIso,
    ),
    fastingHistory: (db.fastingHistory ?? []).filter(
      (f) => getLocalDateKey(f.date || f.endedAt) !== dateIso,
    ),
    hydrationByDate: nextHydrationByDate,
    hydrationLogsByDate: nextHydrationLogsByDate,
    electrolytesByDate: nextElectrolytesByDate,
    hydrationSettings: db.hydrationSettings
      ? { ...db.hydrationSettings, hotDayByDate: nextHotDays }
      : db.hydrationSettings,
    activeFast: nextActiveFast,
  };
}
