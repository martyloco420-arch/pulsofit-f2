import { normalizeExerciseName } from './analytics';
import { getTodayIsoDate } from './storage';
import {
  cmToDisplayWaist,
  getDistanceUnit,
  getWaistUnit,
  getWeightUnit,
  kgToDisplayWeight,
  kmToDisplayDistance,
  paceSecPerKmToUnit,
} from './units';
import type {
  AppDatabase,
  BodyCompositionScan,
  BodyMeasurementEntry,
  BodyWeightEntry,
  CardioSession,
  DistanceUnit,
  Goal,
  LengthUnit,
  WeightUnit,
  WorkoutSession,
} from '../types/fitness';

export type ComparisonWindowMode = 'day' | '7d' | '30d';

export type ComparisonPresetId =
  | 'week_vs_4w'
  | 'last7_vs_prev7'
  | 'month_vs_prev_month'
  | 'first_vs_latest';

export interface PeriodRange {
  anchorDate: string; // YYYY-MM-DD
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface BodySnapshot {
  weightKg: number | null;
  weightDate: string | null;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
  musclePct: number | null;
  scanDate: string | null;
  waistCm: number | null;
  waistDate: string | null;
}

export interface StrengthExerciseSnapshot {
  key: string;
  name: string;
  loadMode: 'weights' | 'bands';
  bandLabel: string | null;
  bestWeightKg: number;
  repsAtBest: number;
  est1RMKg: number;
  sessionDate: string;
}

export interface StrengthExerciseComparison {
  key: string;
  name: string;
  before: StrengthExerciseSnapshot;
  after: StrengthExerciseSnapshot;
  deltaWeightKg: number;
  deltaReps: number;
  trend: 'positive' | 'negative' | 'neutral';
}

export interface CardioPeriodSummary {
  sessionsCount: number;
  totalDistanceKm: number;
  totalDurationSec: number;
  avgPaceSecPerKm: number;
  totalCaloriesBurned: number;
}

export interface DateComparisonResult {
  rangeA: PeriodRange;
  rangeB: PeriodRange;
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  waistUnit: LengthUnit;
  goal: Goal;
  bodyBefore: BodySnapshot;
  bodyAfter: BodySnapshot;
  workoutsCountA: number;
  workoutsCountB: number;
  totalVolumeKgA: number;
  totalVolumeKgB: number;
  matchedExercises: StrengthExerciseComparison[];
  cardioA: CardioPeriodSummary;
  cardioB: CardioPeriodSummary;
}

export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return getTodayIsoDate();
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function getPeriodRange(
  anchorDate: string,
  windowMode: ComparisonWindowMode,
): PeriodRange {
  const safeAnchor = /^\d{4}-\d{2}-\d{2}$/.test(anchorDate)
    ? anchorDate
    : getTodayIsoDate();
  if (windowMode === '7d') {
    return {
      anchorDate: safeAnchor,
      startDate: shiftIsoDate(safeAnchor, -6),
      endDate: safeAnchor,
    };
  }
  if (windowMode === '30d') {
    return {
      anchorDate: safeAnchor,
      startDate: shiftIsoDate(safeAnchor, -29),
      endDate: safeAnchor,
    };
  }
  return {
    anchorDate: safeAnchor,
    startDate: safeAnchor,
    endDate: safeAnchor,
  };
}

export function getComparisonPresetDates(
  preset: ComparisonPresetId,
  db: AppDatabase,
): { dateA: string; dateB: string; windowMode: ComparisonWindowMode } {
  const today = getTodayIsoDate();
  if (preset === 'week_vs_4w') {
    return {
      dateA: shiftIsoDate(today, -28),
      dateB: today,
      windowMode: '7d',
    };
  }
  if (preset === 'last7_vs_prev7') {
    return {
      dateA: shiftIsoDate(today, -7),
      dateB: today,
      windowMode: '7d',
    };
  }
  if (preset === 'month_vs_prev_month') {
    return {
      dateA: shiftIsoDate(today, -30),
      dateB: today,
      windowMode: '30d',
    };
  }

  // first_vs_latest: locate earliest and latest dates recorded across modules
  const allDates: string[] = [];
  for (const s of db.bodyScans) allDates.push(s.date);
  for (const bw of db.bodyWeights) allDates.push(bw.date);
  for (const m of db.bodyMeasurements ?? []) allDates.push(m.date);
  for (const w of db.workouts) allDates.push(w.completedAt.slice(0, 10));
  for (const c of db.cardioSessions ?? []) allDates.push(c.date);

  const valid = allDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (valid.length >= 2 && valid[0] !== valid[valid.length - 1]) {
    return {
      dateA: valid[0],
      dateB: valid[valid.length - 1],
      windowMode: 'day',
    };
  }
  return {
    dateA: shiftIsoDate(today, -28),
    dateB: today,
    windowMode: 'day',
  };
}

function resolveBodySnapshot(
  range: PeriodRange,
  bodyScans: BodyCompositionScan[],
  bodyWeights: BodyWeightEntry[],
  bodyMeasurements: BodyMeasurementEntry[],
): BodySnapshot {
  const scansChrono = [...bodyScans].sort((a, b) =>
    (a.recordedAt || a.date).localeCompare(b.recordedAt || b.date),
  );
  const weightsChrono = [...bodyWeights].sort((a, b) => a.date.localeCompare(b.date));
  const measChrono = [...bodyMeasurements].sort((a, b) => a.date.localeCompare(b.date));

  // Prefer scan inside range; otherwise closest prior scan up to endDate
  const scansInRange = scansChrono.filter(
    (s) => s.date >= range.startDate && s.date <= range.endDate,
  );
  const scansOnOrBefore = scansChrono.filter((s) => s.date <= range.endDate);
  const pickedScan =
    scansInRange[scansInRange.length - 1] ??
    scansOnOrBefore[scansOnOrBefore.length - 1] ??
    null;

  // Weight: prefer pickedScan weight if it's inside range or newer than bodyWeights on/before endDate
  const weightsInRange = weightsChrono.filter(
    (bw) => bw.date >= range.startDate && bw.date <= range.endDate,
  );
  const weightsOnOrBefore = weightsChrono.filter((bw) => bw.date <= range.endDate);
  const pickedWeightEntry =
    weightsInRange[weightsInRange.length - 1] ??
    weightsOnOrBefore[weightsOnOrBefore.length - 1] ??
    null;

  let weightKg: number | null = null;
  let weightDate: string | null = null;
  if (pickedScan && pickedWeightEntry) {
    if (pickedScan.date >= pickedWeightEntry.date) {
      weightKg = pickedScan.weightKg;
      weightDate = pickedScan.date;
    } else {
      weightKg = pickedWeightEntry.weightKg;
      weightDate = pickedWeightEntry.date;
    }
  } else if (pickedScan) {
    weightKg = pickedScan.weightKg;
    weightDate = pickedScan.date;
  } else if (pickedWeightEntry) {
    weightKg = pickedWeightEntry.weightKg;
    weightDate = pickedWeightEntry.date;
  }

  // Waist: look in both bodyScans.waistCm and bodyMeasurements.waistCm up to endDate
  const waistCandidates: { date: string; waistCm: number }[] = [];
  for (const s of scansChrono) {
    if (typeof s.waistCm === 'number' && s.waistCm > 0 && s.date <= range.endDate) {
      waistCandidates.push({ date: s.date, waistCm: s.waistCm });
    }
  }
  for (const m of measChrono) {
    if (typeof m.waistCm === 'number' && m.waistCm > 0 && m.date <= range.endDate) {
      waistCandidates.push({ date: m.date, waistCm: m.waistCm });
    }
  }
  waistCandidates.sort((a, b) => a.date.localeCompare(b.date));
  const waistInRange = waistCandidates.filter(
    (w) => w.date >= range.startDate && w.date <= range.endDate,
  );
  const pickedWaist =
    waistInRange[waistInRange.length - 1] ??
    waistCandidates[waistCandidates.length - 1] ??
    null;

  return {
    weightKg,
    weightDate,
    bodyFatPct: pickedScan ? pickedScan.bodyFatPct : null,
    muscleMassKg: pickedScan ? pickedScan.totalMuscleMassKg : null,
    musclePct: pickedScan ? pickedScan.totalMusclePct : null,
    scanDate: pickedScan ? pickedScan.date : null,
    waistCm: pickedWaist ? pickedWaist.waistCm : null,
    waistDate: pickedWaist ? pickedWaist.date : null,
  };
}

function summarizeExerciseInPeriod(
  workouts: WorkoutSession[],
): Map<string, StrengthExerciseSnapshot> {
  const byKey = new Map<string, StrengthExerciseSnapshot>();

  for (const session of workouts) {
    const sessionDate = session.completedAt.slice(0, 10);
    for (const ex of session.exercises) {
      const doneSets = ex.sets.filter(
        (s) => s.completed && s.setType !== 'warmup',
      );
      if (doneSets.length === 0) continue;

      const isBands =
        ex.loadMode === 'bands' || doneSets.some((s) => Boolean(s.bandLabel));
      let bestSet = doneSets[0];
      for (const s of doneSets) {
        if (
          s.weightKg > bestSet.weightKg ||
          (s.weightKg === bestSet.weightKg && s.reps > bestSet.reps)
        ) {
          bestSet = s;
        }
      }

      const est1RMKg =
        bestSet.weightKg > 0
          ? Math.round(bestSet.weightKg * (1 + bestSet.reps / 30) * 10) / 10
          : 0;
      const bandLabel = isBands
        ? bestSet.bandLabel ?? ex.bandConfig?.label ?? 'Liga'
        : null;

      const key = normalizeExerciseName(ex.name);
      const candidate: StrengthExerciseSnapshot = {
        key,
        name: ex.name,
        loadMode: isBands ? 'bands' : 'weights',
        bandLabel,
        bestWeightKg: bestSet.weightKg,
        repsAtBest: bestSet.reps,
        est1RMKg,
        sessionDate,
      };

      const prev = byKey.get(key);
      if (
        !prev ||
        candidate.bestWeightKg > prev.bestWeightKg ||
        (candidate.bestWeightKg === prev.bestWeightKg &&
          candidate.repsAtBest > prev.repsAtBest)
      ) {
        byKey.set(key, candidate);
      }
    }
  }

  return byKey;
}

function summarizeCardioPeriod(sessions: CardioSession[]): CardioPeriodSummary {
  if (sessions.length === 0) {
    return {
      sessionsCount: 0,
      totalDistanceKm: 0,
      totalDurationSec: 0,
      avgPaceSecPerKm: 0,
      totalCaloriesBurned: 0,
    };
  }

  let totalDistanceKm = 0;
  let totalDurationSec = 0;
  let totalCaloriesBurned = 0;

  for (const c of sessions) {
    totalDistanceKm += c.distanceKm || 0;
    totalDurationSec += c.durationSec || 0;
    totalCaloriesBurned += c.caloriesBurned || 0;
  }

  const avgPaceSecPerKm =
    totalDistanceKm > 0.01
      ? Math.round(totalDurationSec / totalDistanceKm)
      : 0;

  return {
    sessionsCount: sessions.length,
    totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
    totalDurationSec,
    avgPaceSecPerKm,
    totalCaloriesBurned: Math.round(totalCaloriesBurned),
  };
}

export function buildDateComparison(
  db: AppDatabase,
  dateA: string,
  dateB: string,
  windowMode: ComparisonWindowMode,
): DateComparisonResult {
  const rangeA = getPeriodRange(dateA, windowMode);
  const rangeB = getPeriodRange(dateB, windowMode);

  const weightUnit = getWeightUnit(db.profile.weightUnit);
  const distanceUnit = getDistanceUnit(db.profile.distanceUnit);
  const waistUnit = getWaistUnit(db.profile);

  const bodyBefore = resolveBodySnapshot(
    rangeA,
    db.bodyScans,
    db.bodyWeights,
    db.bodyMeasurements ?? [],
  );
  const bodyAfter = resolveBodySnapshot(
    rangeB,
    db.bodyScans,
    db.bodyWeights,
    db.bodyMeasurements ?? [],
  );

  const workoutsA = db.workouts.filter((w) => {
    const d = w.completedAt.slice(0, 10);
    return d >= rangeA.startDate && d <= rangeA.endDate;
  });
  const workoutsB = db.workouts.filter((w) => {
    const d = w.completedAt.slice(0, 10);
    return d >= rangeB.startDate && d <= rangeB.endDate;
  });

  const exMapA = summarizeExerciseInPeriod(workoutsA);
  const exMapB = summarizeExerciseInPeriod(workoutsB);
  const matchedExercises: StrengthExerciseComparison[] = [];

  for (const [key, before] of exMapA.entries()) {
    const after = exMapB.get(key);
    if (!after) continue;
    const deltaWeightKg = Math.round((after.bestWeightKg - before.bestWeightKg) * 10) / 10;
    const deltaReps = after.repsAtBest - before.repsAtBest;
    let trend: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (deltaWeightKg > 0.05) {
      trend = 'positive';
    } else if (deltaWeightKg < -0.05) {
      trend = 'negative';
    } else if (deltaReps > 0) {
      trend = 'positive';
    } else if (deltaReps < 0) {
      trend = 'negative';
    }
    matchedExercises.push({
      key,
      name: after.name || before.name,
      before,
      after,
      deltaWeightKg,
      deltaReps,
      trend,
    });
  }

  matchedExercises.sort((a, b) => Math.abs(b.deltaWeightKg) - Math.abs(a.deltaWeightKg));

  const cardioSessionsA = (db.cardioSessions ?? []).filter(
    (c) => c.date >= rangeA.startDate && c.date <= rangeA.endDate,
  );
  const cardioSessionsB = (db.cardioSessions ?? []).filter(
    (c) => c.date >= rangeB.startDate && c.date <= rangeB.endDate,
  );

  return {
    rangeA,
    rangeB,
    weightUnit,
    distanceUnit,
    waistUnit,
    goal: db.profile.goal,
    bodyBefore,
    bodyAfter,
    workoutsCountA: workoutsA.length,
    workoutsCountB: workoutsB.length,
    totalVolumeKgA: workoutsA.reduce((sum, w) => sum + w.totalVolumeKg, 0),
    totalVolumeKgB: workoutsB.reduce((sum, w) => sum + w.totalVolumeKg, 0),
    matchedExercises,
    cardioA: summarizeCardioPeriod(cardioSessionsA),
    cardioB: summarizeCardioPeriod(cardioSessionsB),
  };
}

export function formatPaceDisplay(secPerKm: number, unit: DistanceUnit): string {
  if (!secPerKm || secPerKm <= 0) return '—';
  const converted = Math.round(paceSecPerKmToUnit(secPerKm, unit));
  const mins = Math.floor(converted / 60);
  const secs = converted % 60;
  return `${mins}:${String(secs).padStart(2, '0')} /${unit}`;
}

export function formatPaceDeltaDisplay(
  deltaSecPerKm: number,
  unit: DistanceUnit,
): string {
  const converted = Math.round(
    paceSecPerKmToUnit(Math.abs(deltaSecPerKm), unit),
  );
  if (converted === 0) return `0:00 /${unit}`;
  const mins = Math.floor(converted / 60);
  const secs = converted % 60;
  const sign = deltaSecPerKm < 0 ? '-' : '+';
  return `${sign}${mins}:${String(secs).padStart(2, '0')} /${unit}`;
}

export function collectRecordedComparisonDates(db: AppDatabase): string[] {
  const set = new Set<string>();
  for (const s of db.bodyScans) set.add(s.date);
  for (const bw of db.bodyWeights) set.add(bw.date);
  for (const m of db.bodyMeasurements ?? []) set.add(m.date);
  for (const w of db.workouts) set.add(w.completedAt.slice(0, 10));
  for (const c of db.cardioSessions ?? []) set.add(c.date);
  return Array.from(set)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort((a, b) => b.localeCompare(a));
}

export function formatExerciseLoadDisplay(
  snap: StrengthExerciseSnapshot,
  unit: WeightUnit,
): { primary: string; secondary: string } {
  if (snap.loadMode === 'bands') {
    const resistance =
      snap.bestWeightKg > 0
        ? `${kgToDisplayWeight(snap.bestWeightKg, unit)} ${unit}`
        : '';
    return {
      primary: snap.bandLabel || 'Liga',
      secondary: `${resistance ? `${resistance} · ` : ''}${snap.repsAtBest} reps`,
    };
  }
  if (snap.bestWeightKg <= 0) {
    return {
      primary: `${snap.repsAtBest} reps`,
      secondary: 'Peso corporal',
    };
  }
  return {
    primary: `${kgToDisplayWeight(snap.bestWeightKg, unit)} ${unit}`,
    secondary: `${snap.repsAtBest} reps · ${snap.sessionDate}`,
  };
}

export function convertMetricForDisplay(
  val: number | null,
  kind: 'weight' | 'waist' | 'distance',
  units: { weightUnit: WeightUnit; waistUnit: LengthUnit; distanceUnit: DistanceUnit },
): number | null {
  if (val === null) return null;
  if (kind === 'weight') return kgToDisplayWeight(val, units.weightUnit);
  if (kind === 'waist') return cmToDisplayWaist(val, units.waistUnit);
  return Math.round(kmToDisplayDistance(val, units.distanceUnit) * 100) / 100;
}
