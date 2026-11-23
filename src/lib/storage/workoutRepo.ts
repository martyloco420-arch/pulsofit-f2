import type {
  AppDatabase,
  CardioSession,
  CardioSplit,
  GpsPoint,
  HiitSession,
  MuscleFatigueMap,
  ShoeGear,
  WorkoutExercise,
  WorkoutSession,
} from '../../types/fitness';
import {
  ALL_MUSCLES,
  createInitialMuscleFatigue,
  recomputeMuscleFatigueFromWorkouts,
} from '../recovery';
import {
  type RecordDeleteTarget,
  dedupeById,
  getLocalDateKey,
  resolveDeleteIndex,
  safeNum,
  safeStr,
} from './dbCore';

export function normalizeWorkoutSession(
  raw: Partial<WorkoutSession>,
  idx: number,
  nowIso: string,
): WorkoutSession {
  const exercises: WorkoutExercise[] = Array.isArray(raw.exercises)
    ? raw.exercises.map((ex, eIdx) => ({
        id: safeStr(
          ex?.id,
          `wex_${idx}_${eIdx}_${Math.random().toString(36).slice(2, 6)}`,
        ),
        exerciseId: safeStr(ex?.exerciseId, `ex_${idx}_${eIdx}`),
        name: safeStr(ex?.name, 'Ejercicio'),
        primaryMuscles: Array.isArray(ex?.primaryMuscles) ? ex.primaryMuscles : [],
        secondaryMuscles: Array.isArray(ex?.secondaryMuscles) ? ex.secondaryMuscles : [],
        loadMode: ex?.loadMode === 'bands' ? 'bands' : 'weights',
        bandConfig: ex?.bandConfig,
        restSec: Math.max(0, Math.round(safeNum(ex?.restSec, 90))),
        supersetGroupId:
          typeof ex?.supersetGroupId === 'string' || ex?.supersetGroupId === null
            ? ex.supersetGroupId
            : undefined,
        sets: Array.isArray(ex?.sets)
          ? ex.sets.map((s) => ({
              id: safeStr(s?.id, `set_${Math.random().toString(36).slice(2, 7)}`),
              reps: Math.max(0, Math.round(safeNum(s?.reps, 0))),
              weightKg: Math.max(0, safeNum(s?.weightKg, 0)),
              ...(typeof s?.durationSec === 'number' && Number.isFinite(s.durationSec)
                ? { durationSec: Math.max(0, Math.round(s.durationSec)) }
                : {}),
              rpe:
                typeof s?.rpe === 'number' && Number.isFinite(s.rpe)
                  ? s.rpe
                  : undefined,
              setType: s?.setType,
              completed: Boolean(s?.completed),
              bandLabel:
                typeof s?.bandLabel === 'string' ? s.bandLabel : undefined,
              ...(s?.isPR ? { isPR: true } : {}),
              ...(Array.isArray(s?.prLabels) && s.prLabels.length > 0
                ? {
                    prLabels: s.prLabels.filter(
                      (lbl): lbl is string => typeof lbl === 'string',
                    ),
                  }
                : {}),
            }))
          : [],
        notes: typeof ex?.notes === 'string' ? ex.notes : undefined,
      }))
    : [];

  return {
    id: safeStr(raw.id, `wk_norm_${idx}_${Date.now()}`),
    title: safeStr(raw.title, 'Entrenamiento'),
    startedAt: safeStr(raw.startedAt, safeStr(raw.completedAt, nowIso)),
    completedAt: safeStr(raw.completedAt, nowIso),
    durationSec: Math.max(0, Math.round(safeNum(raw.durationSec, 0))),
    totalVolumeKg: Math.max(0, Math.round(safeNum(raw.totalVolumeKg, 0))),
    completedSets: Math.max(0, Math.round(safeNum(raw.completedSets, 0))),
    exercises,
    fatigueImpact:
      raw.fatigueImpact && typeof raw.fatigueImpact === 'object'
        ? raw.fatigueImpact
        : {},
    ...(raw.isPR ? { isPR: true } : {}),
    ...(Array.isArray(raw.prLabels) && raw.prLabels.length > 0
      ? {
          prLabels: raw.prLabels.filter(
            (lbl): lbl is string => typeof lbl === 'string',
          ),
        }
      : {}),
  };
}

export function normalizeCardioSession(
  raw: Partial<CardioSession>,
  idx: number,
  nowIso: string,
): CardioSession {
  const routePoints: GpsPoint[] = Array.isArray(raw.routePoints)
    ? raw.routePoints
        .filter((p) => p && typeof p.lat === 'number' && typeof p.lng === 'number')
        .map((p) => ({
          lat: safeNum(p.lat, 0),
          lng: safeNum(p.lng, 0),
          timestamp: safeNum(p.timestamp, Date.now()),
          accuracyM: typeof p.accuracyM === 'number' ? p.accuracyM : undefined,
        }))
    : [];

  const splits: CardioSplit[] = Array.isArray(raw.splits)
    ? raw.splits.map((s, sIdx) => ({
        kmNumber: Math.max(1, Math.round(safeNum(s?.kmNumber, sIdx + 1))),
        splitTimeSec: Math.max(0, Math.round(safeNum(s?.splitTimeSec, 0))),
        paceSecPerKm: Math.max(0, Math.round(safeNum(s?.paceSecPerKm, 0))),
        cumulativeSec: Math.max(0, Math.round(safeNum(s?.cumulativeSec, 0))),
      }))
    : [];

  const completedAt = safeStr(raw.completedAt, nowIso);
  return {
    id: safeStr(raw.id, `cardio_norm_${idx}_${Date.now()}`),
    date: getLocalDateKey(raw.date || completedAt),
    activityType: raw.activityType ?? 'caminar',
    startedAt: safeStr(raw.startedAt, completedAt),
    completedAt,
    durationSec: Math.max(0, Math.round(safeNum(raw.durationSec, 0))),
    totalDurationSec:
      typeof raw.totalDurationSec === 'number'
        ? Math.max(0, raw.totalDurationSec)
        : undefined,
    pausedDurationSec:
      typeof raw.pausedDurationSec === 'number'
        ? Math.max(0, raw.pausedDurationSec)
        : undefined,
    distanceKm: Math.max(0, safeNum(raw.distanceKm, 0)),
    avgPaceSecPerKm: Math.max(0, Math.round(safeNum(raw.avgPaceSecPerKm, 0))),
    avgSpeedKmh: typeof raw.avgSpeedKmh === 'number' ? raw.avgSpeedKmh : 0,
    estimatedSteps: Math.max(0, Math.round(safeNum(raw.estimatedSteps, 0))),
    caloriesBurned: Math.max(0, Math.round(safeNum(raw.caloriesBurned, 0))),
    targetDistanceKm:
      typeof raw.targetDistanceKm === 'number' && Number.isFinite(raw.targetDistanceKm)
        ? raw.targetDistanceKm
        : null,
    pauseOnTargetReached: Boolean(raw.pauseOnTargetReached),
    routePoints,
    splits,
    shoeId: typeof raw.shoeId === 'string' && raw.shoeId ? raw.shoeId : null,
    shoeName: typeof raw.shoeName === 'string' && raw.shoeName ? raw.shoeName : null,
    ...(raw.isPR ? { isPR: true } : {}),
    ...(Array.isArray(raw.prLabels) && raw.prLabels.length > 0
      ? {
          prLabels: raw.prLabels.filter(
            (lbl): lbl is string => typeof lbl === 'string',
          ),
        }
      : {}),
  };
}

export function normalizeHiitSession(
  raw: Partial<HiitSession>,
  idx: number,
  nowIso: string,
): HiitSession {
  const completedAt = safeStr(raw.completedAt, nowIso);
  return {
    id: safeStr(raw.id, `hiit_norm_${idx}_${Date.now()}`),
    date: getLocalDateKey(raw.date || completedAt),
    name: safeStr(raw.name, 'HIIT'),
    workSec: Math.max(0, Math.round(safeNum(raw.workSec, 0))),
    restSec: Math.max(0, Math.round(safeNum(raw.restSec, 0))),
    rounds: Math.max(0, Math.round(safeNum(raw.rounds, 0))),
    cycles: Math.max(1, Math.round(safeNum(raw.cycles, 1))),
    totalDurationSec: Math.max(0, Math.round(safeNum(raw.totalDurationSec, 0))),
    caloriesBurned: Math.max(0, Math.round(safeNum(raw.caloriesBurned, 0))),
    completedAt,
  };
}

export function normalizeShoes(rawShoes: Partial<ShoeGear>[] | undefined, nowIso: string): ShoeGear[] {
  return (Array.isArray(rawShoes) ? rawShoes : []).map((sh, i) => ({
    id: safeStr(sh?.id, `shoe_norm_${i}_${Date.now()}`),
    name: safeStr(sh?.name, 'Tenis'),
    brand: typeof sh?.brand === 'string' ? sh.brand : undefined,
    accumulatedKm: Math.max(0, safeNum(sh?.accumulatedKm, 0)),
    maxAlertKm: Math.max(50, safeNum(sh?.maxAlertKm, 650)),
    isActive: Boolean(sh?.isActive),
    createdAt: safeStr(sh?.createdAt, nowIso),
  }));
}

export function normalizeMuscleFatigue(
  rawFatigue: Partial<MuscleFatigueMap> | undefined,
  nowIso: string,
): MuscleFatigueMap {
  const merged = createInitialMuscleFatigue(nowIso);
  if (rawFatigue && typeof rawFatigue === 'object') {
    for (const m of ALL_MUSCLES) {
      const entry = rawFatigue[m];
      if (entry && typeof entry.fatigue === 'number') {
        merged[m] = {
          fatigue: Math.max(0, Math.min(100, entry.fatigue)),
          lastUpdatedAt:
            typeof entry.lastUpdatedAt === 'string' ? entry.lastUpdatedAt : nowIso,
        };
      }
    }
  }
  return merged;
}

export function normalizeWorkoutDomain(
  raw: Partial<AppDatabase>,
  nowIso: string,
): Pick<
  AppDatabase,
  | 'muscleFatigue'
  | 'activeWorkout'
  | 'workouts'
  | 'workoutTemplates'
  | 'hiitSessions'
  | 'cardioSessions'
  | 'shoes'
> {
  return {
    muscleFatigue: normalizeMuscleFatigue(raw.muscleFatigue, nowIso),
    activeWorkout: raw.activeWorkout ?? null,
    workouts: dedupeById(
      (Array.isArray(raw.workouts) ? raw.workouts : []).map((w, i) =>
        normalizeWorkoutSession(w ?? {}, i, nowIso),
      ),
    ),
    workoutTemplates: Array.isArray(raw.workoutTemplates) ? raw.workoutTemplates : [],
    hiitSessions: dedupeById(
      (Array.isArray(raw.hiitSessions) ? raw.hiitSessions : []).map((h, i) =>
        normalizeHiitSession(h ?? {}, i, nowIso),
      ),
    ),
    cardioSessions: dedupeById(
      (Array.isArray(raw.cardioSessions) ? raw.cardioSessions : []).map((c, i) =>
        normalizeCardioSession(c ?? {}, i, nowIso),
      ),
    ),
    shoes: normalizeShoes(raw.shoes, nowIso),
  };
}

export function deleteWorkoutRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; changed: boolean } {
  const list = db.workouts ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (w) => w.id,
    (w) => [w.completedAt, w.startedAt],
  );
  if (idx < 0) return { nextDb: db, changed: false };
  const nextWorkouts = list.filter((_, i) => i !== idx);
  return {
    nextDb: {
      ...db,
      workouts: nextWorkouts,
      muscleFatigue: recomputeMuscleFatigueFromWorkouts(nextWorkouts),
    },
    changed: true,
  };
}

export function deleteHiitRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; changed: boolean } {
  const list = db.hiitSessions ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (h) => h.id,
    (h) => [h.completedAt, h.date],
  );
  if (idx < 0) return { nextDb: db, changed: false };
  return {
    nextDb: {
      ...db,
      hiitSessions: list.filter((_, i) => i !== idx),
    },
    changed: true,
  };
}

export function deleteCardioRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; changed: boolean } {
  const list = db.cardioSessions ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (c) => c.id,
    (c) => [c.completedAt, c.startedAt, c.date],
  );
  if (idx < 0) return { nextDb: db, changed: false };
  const removed = list[idx];
  const nextShoes =
    removed.shoeId && removed.distanceKm > 0
      ? (db.shoes ?? []).map((shoe) =>
          shoe.id === removed.shoeId
            ? {
                ...shoe,
                accumulatedKm: Math.max(
                  0,
                  Math.round((shoe.accumulatedKm - removed.distanceKm) * 100) / 100,
                ),
              }
            : shoe,
        )
      : db.shoes;

  return {
    nextDb: {
      ...db,
      cardioSessions: list.filter((_, i) => i !== idx),
      shoes: nextShoes,
    },
    changed: true,
  };
}

export function deleteShoeRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; changed: boolean } {
  const list = db.shoes ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (s) => s.id,
    (s) => [s.createdAt],
  );
  if (idx < 0) return { nextDb: db, changed: false };
  const nextShoes = list.filter((_, i) => i !== idx);
  if (list[idx]?.isActive && nextShoes.length > 0 && !nextShoes.some((s) => s.isActive)) {
    nextShoes[0] = { ...nextShoes[0], isActive: true };
  }
  return {
    nextDb: { ...db, shoes: nextShoes },
    changed: true,
  };
}

export function countWorkoutDomainByDate(
  db: AppDatabase,
  dateIso: string,
): { workouts: number; hiit: number; cardio: number } {
  return {
    workouts: (db.workouts ?? []).filter(
      (w) => getLocalDateKey(w.completedAt) === dateIso,
    ).length,
    hiit: (db.hiitSessions ?? []).filter(
      (h) => getLocalDateKey(h.date || h.completedAt) === dateIso,
    ).length,
    cardio: (db.cardioSessions ?? []).filter(
      (c) => getLocalDateKey(c.date || c.completedAt) === dateIso,
    ).length,
  };
}

export function filterWorkoutDomainByDate(
  db: AppDatabase,
  dateIso: string,
): Pick<AppDatabase, 'workouts' | 'muscleFatigue' | 'hiitSessions' | 'cardioSessions' | 'shoes'> {
  const removedCardio = (db.cardioSessions ?? []).filter(
    (c) => getLocalDateKey(c.date || c.completedAt) === dateIso,
  );
  const nextShoes = (db.shoes ?? []).map((shoe) => {
    const deducted = removedCardio
      .filter((c) => c.shoeId === shoe.id)
      .reduce((sum, c) => sum + (c.distanceKm || 0), 0);
    if (deducted <= 0) return shoe;
    return {
      ...shoe,
      accumulatedKm: Math.max(0, Math.round((shoe.accumulatedKm - deducted) * 100) / 100),
    };
  });

  const nextWorkouts = (db.workouts ?? []).filter(
    (w) => getLocalDateKey(w.completedAt) !== dateIso,
  );

  return {
    workouts: nextWorkouts,
    muscleFatigue: recomputeMuscleFatigueFromWorkouts(nextWorkouts),
    hiitSessions: (db.hiitSessions ?? []).filter(
      (h) => getLocalDateKey(h.date || h.completedAt) !== dateIso,
    ),
    cardioSessions: (db.cardioSessions ?? []).filter(
      (c) => getLocalDateKey(c.date || c.completedAt) !== dateIso,
    ),
    shoes: nextShoes,
  };
}
