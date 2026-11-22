import { ALL_MUSCLES, MUSCLE_LABELS } from './recovery';
import { RESISTANCE_BAND_PRESETS, formatWeight, kgToDisplayWeight } from './units';
import type {
  BandConfig,
  LoadMode,
  MuscleGroup,
  WeightUnit,
  WorkoutSet,
  WorkoutSession,
} from '../types/fitness';

export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function estimate1RM(weightKg: number, reps: number): number {
  if (weightKg <= 0) return 0;
  if (reps <= 1) return Math.round(weightKg * 10) / 10;
  // Epley formula
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

export function getPreviousExerciseSets(
  workouts: WorkoutSession[],
  exerciseId: string,
  exerciseName: string,
): {
  date: string;
  sets: WorkoutSet[];
  loadMode?: LoadMode;
  bandConfig?: BandConfig;
} | null {
  const targetNorm = normalizeExerciseName(exerciseName);
  const sorted = [...workouts].sort((a, b) =>
    b.completedAt.localeCompare(a.completedAt),
  );

  for (const session of sorted) {
    for (const ex of session.exercises) {
      const matchesId = ex.exerciseId && ex.exerciseId === exerciseId;
      const matchesName = normalizeExerciseName(ex.name) === targetNorm;
      if (matchesId || matchesName) {
        const doneSets = ex.sets.filter((s) => s.completed);
        if (doneSets.length > 0) {
          return {
            date: session.completedAt,
            sets: doneSets,
            loadMode: ex.loadMode,
            bandConfig: ex.bandConfig,
          };
        }
      }
    }
  }
  return null;
}

export function buildRecentLoadsSummary(
  workouts: WorkoutSession[],
): Record<string, { weightKg: number; reps: number; rpe?: number }> {
  const summary: Record<string, { weightKg: number; reps: number; rpe?: number }> = {};
  const sorted = [...workouts].sort((a, b) =>
    b.completedAt.localeCompare(a.completedAt),
  );

  for (const session of sorted) {
    for (const ex of session.exercises) {
      if (summary[ex.name]) continue;
      const doneSets = ex.sets.filter((s) => s.completed);
      if (doneSets.length === 0) continue;
      const best = doneSets.reduce((prev, cur) =>
        cur.weightKg * cur.reps >= prev.weightKg * prev.reps ? cur : prev,
      );
      summary[ex.name] = {
        weightKg: best.weightKg,
        reps: best.reps,
        rpe: best.rpe,
      };
    }
    if (Object.keys(summary).length >= 12) break;
  }

  return summary;
}

export interface WeeklyVolumePoint {
  weekKey: string;
  label: string;
  volumeKg: number;
  sessions: number;
}

function getMondayWeekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function getWeeklyVolumeStats(
  workouts: WorkoutSession[],
  numWeeks = 6,
): WeeklyVolumePoint[] {
  const now = new Date();
  const currentMonday = getMondayWeekStart(now);
  const buckets = new Map<string, WeeklyVolumePoint>();

  for (let i = numWeeks - 1; i >= 0; i--) {
    const start = new Date(currentMonday);
    start.setDate(currentMonday.getDate() - i * 7);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const label =
      i === 0
        ? 'Esta sem.'
        : `${start.getDate()} ${start.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}`;
    buckets.set(key, { weekKey: key, label, volumeKg: 0, sessions: 0 });
  }

  for (const w of workouts) {
    const dt = new Date(w.completedAt);
    if (Number.isNaN(dt.getTime())) continue;
    const monday = getMondayWeekStart(dt);
    const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.volumeKg += w.totalVolumeKg;
      bucket.sessions += 1;
    }
  }

  return Array.from(buckets.values());
}

export interface Exercise1RMPoint {
  date: string;
  label: string;
  est1RM: number;
  bestWeightKg: number;
  bestReps: number;
  avgRpe?: number;
}

export interface ExerciseProgressionSeries {
  key: string;
  name: string;
  latest1RM: number;
  peak1RM: number;
  points: Exercise1RMPoint[];
}

export function getExercise1RMHistory(
  workouts: WorkoutSession[],
): ExerciseProgressionSeries[] {
  const byExercise = new Map<string, { name: string; points: Exercise1RMPoint[] }>();
  const chronological = [...workouts].sort((a, b) =>
    a.completedAt.localeCompare(b.completedAt),
  );

  for (const w of chronological) {
    const dateLabel = new Date(w.completedAt).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
    });

    for (const ex of w.exercises) {
      const done = ex.sets.filter(
        (s) => s.completed && s.weightKg > 0 && s.setType !== 'warmup',
      );
      if (done.length === 0) continue;

      let top1RM = 0;
      let bestSet = done[0];
      let rpeSum = 0;
      let rpeCount = 0;

      for (const s of done) {
        const est = estimate1RM(s.weightKg, s.reps);
        if (est > top1RM) {
          top1RM = est;
          bestSet = s;
        }
        if (typeof s.rpe === 'number') {
          rpeSum += s.rpe;
          rpeCount += 1;
        }
      }

      const key = normalizeExerciseName(ex.name);
      const existing = byExercise.get(key) ?? { name: ex.name, points: [] };
      existing.name = ex.name;
      existing.points.push({
        date: w.completedAt,
        label: dateLabel,
        est1RM: top1RM,
        bestWeightKg: bestSet.weightKg,
        bestReps: bestSet.reps,
        avgRpe: rpeCount > 0 ? Math.round((rpeSum / rpeCount) * 10) / 10 : undefined,
      });
      byExercise.set(key, existing);
    }
  }

  return Array.from(byExercise.entries())
    .map(([key, val]) => ({
      key,
      name: val.name,
      latest1RM: val.points[val.points.length - 1]?.est1RM ?? 0,
      peak1RM: Math.max(...val.points.map((p) => p.est1RM)),
      points: val.points,
    }))
    .sort((a, b) => b.points.length - a.points.length || b.peak1RM - a.peak1RM);
}

export interface PRRecordEvent {
  id: string;
  exerciseName: string;
  date: string;
  weightKg: number;
  reps: number;
  est1RM: number;
  improvementKg: number | null;
}

export function getPRHistory(workouts: WorkoutSession[]): PRRecordEvent[] {
  const chronological = [...workouts].sort((a, b) =>
    a.completedAt.localeCompare(b.completedAt),
  );
  const bestSoFar = new Map<string, number>();
  const events: PRRecordEvent[] = [];

  for (const w of chronological) {
    for (const ex of w.exercises) {
      const done = ex.sets.filter(
        (s) => s.completed && s.weightKg > 0 && s.setType !== 'warmup',
      );
      if (done.length === 0) continue;

      let sessionBest1RM = 0;
      let bestSet = done[0];
      for (const s of done) {
        const est = estimate1RM(s.weightKg, s.reps);
        if (est > sessionBest1RM) {
          sessionBest1RM = est;
          bestSet = s;
        }
      }

      const key = normalizeExerciseName(ex.name);
      const prevBest = bestSoFar.get(key);
      if (prevBest === undefined || sessionBest1RM > prevBest) {
        events.push({
          id: `pr_${w.id}_${key}`,
          exerciseName: ex.name,
          date: w.completedAt,
          weightKg: bestSet.weightKg,
          reps: bestSet.reps,
          est1RM: sessionBest1RM,
          improvementKg:
            prevBest !== undefined
              ? Math.round((sessionBest1RM - prevBest) * 10) / 10
              : null,
        });
        bestSoFar.set(key, sessionBest1RM);
      }
    }
  }

  return events.sort((a, b) => b.date.localeCompare(a.date));
}

export interface MuscleWorkDistribution {
  muscle: MuscleGroup;
  label: string;
  effectiveSets: number;
  percentage: number;
}

export function getMuscleDistribution(
  workouts: WorkoutSession[],
): MuscleWorkDistribution[] {
  const counts = {} as Record<MuscleGroup, number>;
  for (const m of ALL_MUSCLES) {
    counts[m] = 0;
  }

  for (const w of workouts) {
    for (const ex of w.exercises) {
      const doneCount = ex.sets.filter(
        (s) => s.completed && s.setType !== 'warmup',
      ).length;
      if (doneCount === 0) continue;
      for (const pm of ex.primaryMuscles) {
        counts[pm] = (counts[pm] ?? 0) + doneCount;
      }
      for (const sm of ex.secondaryMuscles) {
        counts[sm] = (counts[sm] ?? 0) + doneCount * 0.5;
      }
    }
  }

  const total = Object.values(counts).reduce((sum, v) => sum + v, 0);

  return ALL_MUSCLES.map((m) => ({
    muscle: m,
    label: MUSCLE_LABELS[m],
    effectiveSets: Math.round(counts[m] * 10) / 10,
    percentage: total > 0 ? Math.round((counts[m] / total) * 100) : 0,
  }))
    .filter((item) => item.effectiveSets > 0)
    .sort((a, b) => b.effectiveSets - a.effectiveSets);
}

export type OverloadStatus =
  | 'progress'
  | 'hold_low_recovery'
  | 'consolidate'
  | 'deload';

export interface OverloadRecoveryContext {
  recoveryPct: number;
  elevatedPulse: boolean;
  restingBpm?: number | null;
  hrvMs?: number | null;
  stressLabel?: string;
  currentBandIds?: string[];
}

export interface ProgressiveOverloadHint {
  status: OverloadStatus;
  kind: 'weight' | 'reps' | 'bands' | 'hold' | 'deload';
  avgRpe: number;
  hasExplicitRpe: boolean;
  recoveryPct: number;
  elevatedPulse: boolean;
  deltaWeightKg: number;
  deltaReps: number;
  deltaSets: number;
  nextBandLevelIds?: string[];
  nextBandLabel?: string;
  deloadFactor?: number;
  label: string;
  rationale: string;
}

export function computeProgressiveOverloadHint(
  previousSets: WorkoutSet[] | undefined,
  weightUnit: WeightUnit,
  loadMode?: LoadMode,
  recoveryContext?: OverloadRecoveryContext,
): ProgressiveOverloadHint | null {
  if (!previousSets || previousSets.length === 0) return null;
  const workingSets = previousSets.filter((s) => s.completed && s.setType !== 'warmup');
  if (workingSets.length === 0) return null;

  const rpes = workingSets
    .map((s) => s.rpe)
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r) && r > 0);
  const hasExplicitRpe = rpes.length > 0;
  const avgRpeRaw = hasExplicitRpe
    ? rpes.reduce((sum, r) => sum + r, 0) / rpes.length
    : 8;
  const avgRpe = Math.round(avgRpeRaw * 10) / 10;

  const recoveryPct = Math.max(0, Math.min(100, Math.round(recoveryContext?.recoveryPct ?? 76)));
  const elevatedPulse = Boolean(recoveryContext?.elevatedPulse);
  const restingBpm = recoveryContext?.restingBpm ?? null;

  // 1) RPE >= 9 (or > 8.5): light deload (-10% volume/load)
  if (avgRpe > 8.5) {
    return {
      status: 'deload',
      kind: 'deload',
      avgRpe,
      hasExplicitRpe,
      recoveryPct,
      elevatedPulse,
      deltaWeightKg: 0,
      deltaReps: 0,
      deltaSets: 0,
      deloadFactor: 0.9,
      label: 'Descarga ligera sugerida (-10% volumen)',
      rationale: `RPE prom. anterior ${avgRpe.toFixed(1)} ≥ 9 — reduce 10% la carga o el volumen hoy para consolidar recuperación.`,
    };
  }

  // 2) RPE between 7.5 and 8.5 (> 7 and <= 8.5): maintain load to consolidate technique
  if (avgRpe > 7) {
    return {
      status: 'consolidate',
      kind: 'hold',
      avgRpe,
      hasExplicitRpe,
      recoveryPct,
      elevatedPulse,
      deltaWeightKg: 0,
      deltaReps: 0,
      deltaSets: 0,
      label: 'Mantener carga · Consolidar técnica',
      rationale: hasExplicitRpe
        ? `RPE prom. anterior ${avgRpe.toFixed(1)} (7.5–8.5) — consolida ejecución y tempo antes de subir carga.`
        : 'Sin RPE previo registrado — mantén carga actual para medir tu esfuerzo hoy.',
    };
  }

  // 3) RPE <= 7, check Recovery Index & PPG resting pulse before progressing
  if (recoveryPct < 65 || elevatedPulse) {
    const reasons: string[] = [];
    if (recoveryPct < 65) {
      reasons.push(`recuperación hoy al ${recoveryPct}% (< 65%)`);
    }
    if (elevatedPulse) {
      reasons.push(
        restingBpm ? `pulso PPG elevado (${restingBpm} BPM)` : 'pulso/estrés PPG elevado',
      );
    }
    return {
      status: 'hold_low_recovery',
      kind: 'hold',
      avgRpe,
      hasExplicitRpe,
      recoveryPct,
      elevatedPulse,
      deltaWeightKg: 0,
      deltaReps: 0,
      deltaSets: 0,
      label: 'Mantener carga actual (sin forzar)',
      rationale: `RPE previo ${avgRpe.toFixed(1)} ≤ 7, pero con ${reasons.join(' y ')} conviene mantener la carga sin forzar esfuerzo máximo.`,
    };
  }

  // 4) RPE <= 7 AND good recovery (>= 65% and normal pulse): ready for automatic progression
  const hasExternalWeight = workingSets.some((s) => s.weightKg > 0);
  if (loadMode === 'bands') {
    const currentBandIds = recoveryContext?.currentBandIds ?? [];
    let nextBandLevelIds: string[] | undefined;
    let nextBandLabel: string | undefined;
    if (currentBandIds.length <= 1) {
      const activeId = currentBandIds[0] ?? 'media';
      const idx = RESISTANCE_BAND_PRESETS.findIndex((b) => b.id === activeId);
      if (idx >= 0 && idx < RESISTANCE_BAND_PRESETS.length - 1) {
        const nextBand = RESISTANCE_BAND_PRESETS[idx + 1];
        nextBandLevelIds = [nextBand.id];
        nextBandLabel = `Liga ${nextBand.label}`;
      }
    }

    return {
      status: 'progress',
      kind: nextBandLevelIds ? 'bands' : 'reps',
      avgRpe,
      hasExplicitRpe,
      recoveryPct,
      elevatedPulse,
      deltaWeightKg: 0,
      deltaReps: 2,
      deltaSets: 1,
      nextBandLevelIds,
      nextBandLabel,
      label: nextBandLabel
        ? `Subir: +2 reps, +1 serie o ${nextBandLabel}`
        : 'Subir: +2 reps o +1 serie',
      rationale: `RPE prom. ${avgRpe.toFixed(1)} ≤ 7 y recuperación al ${recoveryPct}% — listo para subir intensidad.`,
    };
  }

  if (!hasExternalWeight) {
    return {
      status: 'progress',
      kind: 'reps',
      avgRpe,
      hasExplicitRpe,
      recoveryPct,
      elevatedPulse,
      deltaWeightKg: 0,
      deltaReps: 2,
      deltaSets: 1,
      label: 'Subir: +2 reps o +1 serie',
      rationale: `RPE prom. ${avgRpe.toFixed(1)} ≤ 7 y recuperación al ${recoveryPct}% — suma 2 reps por serie o 1 serie extra.`,
    };
  }

  const stepKg = weightUnit === 'lb' ? Math.round((5 / 2.20462) * 100) / 100 : 2.5;
  const displayStep =
    weightUnit === 'lb' ? '+5 lb' : `+${kgToDisplayWeight(2.5, 'kg')} kg`;
  const topWeight = Math.max(...workingSets.map((s) => s.weightKg));
  const nextWeight = topWeight + stepKg;

  return {
    status: 'progress',
    kind: 'weight',
    avgRpe,
    hasExplicitRpe,
    recoveryPct,
    elevatedPulse,
    deltaWeightKg: stepKg,
    deltaReps: 2,
    deltaSets: 1,
    label: `Subir: ${displayStep}, +2 reps o +1 serie`,
    rationale: `RPE prom. ${avgRpe.toFixed(1)} ≤ 7 y recuperación al ${recoveryPct}% — sube hacia ${formatWeight(nextWeight, weightUnit)} o suma volumen.`,
  };
}


