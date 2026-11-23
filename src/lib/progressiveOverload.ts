import { EXERCISE_CATALOG } from '../data/exercises';
import { getDecayedFatigueMap, getRecoveryStatus } from './recovery';
import {
  RESISTANCE_BAND_PRESETS,
  displayWeightToKg,
  formatWeight,
  kgToDisplayWeight,
} from './units';
import type {
  ActiveWorkout,
  CardioSession,
  ExerciseDefinition,
  LoadMode,
  MuscleFatigueMap,
  MuscleGroup,
  WeightUnit,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types/fitness';

export type ExerciseLoadCategory =
  | 'external_compound'
  | 'external_isolation'
  | 'bodyweight_or_band'
  | 'isometric';

export type OverloadStatus =
  | 'progress'
  | 'consolidate'
  | 'hold_low_recovery'
  | 'deload';

export type OverloadActionType =
  | 'progress_weight'
  | 'progress_reps'
  | 'progress_time'
  | 'maintain'
  | 'deload'
  | 'reduce_volume';

export interface ProgressiveOverloadRecommendation {
  category: ExerciseLoadCategory;
  action: OverloadActionType;
  status: OverloadStatus;
  pillLabel: string;
  label: string;
  rationale: string;
  avgRpe: number;
  hasExplicitRpe: boolean;
  recoveryScore: number;
  systemicRecoveryPct: number;
  muscleRecoveryPct: number;
  muscleStatusLabel: string;
  previousBestWeightKg: number;
  previousAvgReps: number;
  targetReps: number;
  completedTargetReps: boolean;
  deltaWeightKg: number;
  recommendedWeightKg?: number;
  deltaReps: number;
  deltaDurationSec: number;
  deltaSets: number;
  deloadFactor?: number;
  nextBandLevelIds?: string[];
  nextBandLabel?: string;
}

export interface AutoregulatedOverloadParams {
  exercise: WorkoutExercise;
  workouts: WorkoutSession[];
  weightUnit: WeightUnit;
  systemicRecoveryPct?: number;
  muscleFatigue?: MuscleFatigueMap;
  decayedFatigueMap?: Record<MuscleGroup, number>;
  elevatedPulse?: boolean;
  restingBpm?: number | null;
}

const COMPOUND_EXERCISE_IDS = new Set<string>([
  'press_banca_barra',
  'press_inclinado_mancuernas',
  'jalon_pecho',
  'remo_barra',
  'remo_mancuerna',
  'press_militar_barra',
  'press_hombro_mancuernas',
  'sentadilla_barra',
  'prensa_piernas',
  'sentadilla_goblet',
  'zancadas_mancuernas',
  'sentadilla_bulgara_bw',
  'peso_muerto_rumano_barra',
  'peso_muerto_rumano_mancuernas',
  'puente_gluteo_liga',
  'flexiones',
  'dominadas_australianas',
  'flexiones_pica',
  'fondos_banco',
]);

const ISOLATION_EXERCISE_IDS = new Set<string>([
  'aperturas_polea',
  'aperturas_mancuernas',
  'elevaciones_laterales_mancuerna',
  'curl_biceps_barra',
  'curl_martillo_mancuernas',
  'extension_triceps_polea',
  'press_frances_mancuernas',
  'curl_femoral_maquina',
  'elevacion_talones',
  'crunch_polea',
  'elevacion_piernas',
]);

const ISOMETRIC_EXERCISE_IDS = new Set<string>(['plancha_frontal']);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function findExerciseDefinition(
  exerciseId?: string,
  exerciseName?: string,
): ExerciseDefinition | undefined {
  if (exerciseId) {
    const byId = EXERCISE_CATALOG.find((ex) => ex.id === exerciseId);
    if (byId) return byId;
  }
  if (exerciseName) {
    const norm = normalizeText(exerciseName);
    const byName = EXERCISE_CATALOG.find(
      (ex) => normalizeText(ex.name) === norm,
    );
    if (byName) return byName;
  }
  return undefined;
}

function getPreviousExerciseHistory(
  workouts: WorkoutSession[],
  exerciseId: string,
  exerciseName: string,
): {
  date: string;
  sets: WorkoutSet[];
  loadMode?: LoadMode;
} | null {
  const targetNorm = normalizeText(exerciseName);
  const sorted = [...workouts].sort((a, b) =>
    (b.completedAt || b.startedAt).localeCompare(a.completedAt || a.startedAt),
  );

  for (const session of sorted) {
    for (const ex of session.exercises) {
      const matchesId = Boolean(
        exerciseId && ex.exerciseId && ex.exerciseId === exerciseId,
      );
      const matchesName = normalizeText(ex.name) === targetNorm;
      if (matchesId || matchesName) {
        const doneSets = ex.sets.filter((s) => s.completed);
        if (doneSets.length > 0) {
          return {
            date: session.completedAt,
            sets: doneSets,
            loadMode: ex.loadMode,
          };
        }
      }
    }
  }
  return null;
}

export function classifyExerciseLoadCategory(
  exercise: WorkoutExercise,
  definition: ExerciseDefinition | undefined,
  previousSets: WorkoutSet[],
  previousLoadMode?: LoadMode,
): ExerciseLoadCategory {
  const normName = normalizeText(exercise.name);

  if (
    ISOMETRIC_EXERCISE_IDS.has(exercise.exerciseId) ||
    (definition && ISOMETRIC_EXERCISE_IDS.has(definition.id)) ||
    /plancha|plank|isometric|wall\s*sit|hollow\s*hold|l-?sit/.test(normName) ||
    Boolean(
      definition?.instructions &&
        /segundos de tension/i.test(normalizeText(definition.instructions)),
    )
  ) {
    return 'isometric';
  }

  const effectiveLoadMode = exercise.loadMode ?? previousLoadMode;
  const isBandCatalogOnly = Boolean(
    definition &&
      definition.equipment.length === 1 &&
      definition.equipment[0] === 'ligas_resistencia',
  );
  if (effectiveLoadMode === 'bands' || isBandCatalogOnly) {
    return 'bodyweight_or_band';
  }

  const hasExternalWeightInHistory = previousSets.some((s) => s.weightKg > 0);
  const hasExternalWeightCurrent = exercise.sets.some((s) => s.weightKg > 0);
  const hasAnyExternalWeight =
    hasExternalWeightInHistory || hasExternalWeightCurrent;

  const isBodyweightCatalog =
    Boolean(definition && definition.suggestedWeightKg === 0) &&
    !hasAnyExternalWeight;

  if (isBodyweightCatalog || !hasAnyExternalWeight) {
    return 'bodyweight_or_band';
  }

  if (
    ISOLATION_EXERCISE_IDS.has(exercise.exerciseId) ||
    (definition && ISOLATION_EXERCISE_IDS.has(definition.id)) ||
    /apertura|cruce|elevacion lateral|curl|extension|press frances|patada|crunch|talones|fly|raise/.test(
      normName,
    )
  ) {
    return 'external_isolation';
  }

  if (
    COMPOUND_EXERCISE_IDS.has(exercise.exerciseId) ||
    (definition && COMPOUND_EXERCISE_IDS.has(definition.id)) ||
    /sentadilla|squat|press de banca|press inclinado|press militar|press de hombro|peso muerto|deadlift|remo|row|jalon|pulldown|dominada|prensa|zancada|bulgara|hip thrust|puente de gluteo|fondos/.test(
      normName,
    )
  ) {
    return 'external_compound';
  }

  const secondaryCount =
    definition?.secondaryMuscles.length ?? exercise.secondaryMuscles.length;
  return secondaryCount > 0 ? 'external_compound' : 'external_isolation';
}

/**
 * Redondea un peso objetivo (en kg) al incremento práctico más cercano
 * según preferencia del perfil (KG: 2.5 kg / 1 kg; LB: 5 lb / 2.5 lb).
 */
export function roundToPracticalWeightKg(
  targetKg: number,
  weightUnit: WeightUnit,
  originalKg?: number,
): number {
  if (!Number.isFinite(targetKg) || targetKg <= 0) return 0;

  if (weightUnit === 'lb') {
    const rawLb = kgToDisplayWeight(targetKg, 'lb');
    const stepLb = rawLb >= 45 ? 5 : 2.5;
    let roundedLb = Math.max(stepLb, Math.round(rawLb / stepLb) * stepLb);
    if (originalKg && originalKg > 0) {
      const origLb = kgToDisplayWeight(originalKg, 'lb');
      if (roundedLb >= origLb && origLb > stepLb) {
        roundedLb = Math.max(stepLb, origLb - stepLb);
      }
    }
    return displayWeightToKg(roundedLb, 'lb');
  }

  const stepKg = targetKg >= 20 ? 2.5 : 1;
  let roundedKg = Math.max(stepKg, Math.round(targetKg / stepKg) * stepKg);
  if (originalKg && originalKg > 0 && roundedKg >= originalKg && originalKg > stepKg) {
    roundedKg = Math.max(stepKg, Math.round((originalKg - stepKg) * 2) / 2);
  }
  return Math.round(roundedKg * 10) / 10;
}

export function computeAutoregulatedOverload({
  exercise,
  workouts,
  weightUnit,
  systemicRecoveryPct,
  muscleFatigue,
  decayedFatigueMap,
  elevatedPulse = false,
  restingBpm = null,
}: AutoregulatedOverloadParams): ProgressiveOverloadRecommendation | null {
  const prevHistory = getPreviousExerciseHistory(
    workouts,
    exercise.exerciseId,
    exercise.name,
  );
  if (!prevHistory || prevHistory.sets.length === 0) {
    return null;
  }

  const workingSets = prevHistory.sets.filter(
    (s) => s.completed && s.setType !== 'warmup',
  );
  if (workingSets.length === 0) {
    return null;
  }

  const definition = findExerciseDefinition(exercise.exerciseId, exercise.name);
  const category = classifyExerciseLoadCategory(
    exercise,
    definition,
    workingSets,
    prevHistory.loadMode,
  );

  // Recuperación muscular local desde src/lib/recovery.ts
  const resolvedFatigueMap =
    decayedFatigueMap ??
    (muscleFatigue ? getDecayedFatigueMap(muscleFatigue) : null);
  const targetMuscles =
    exercise.primaryMuscles.length > 0
      ? exercise.primaryMuscles
      : (definition?.primaryMuscles ?? []);

  const avgPrimaryFatigue =
    resolvedFatigueMap && targetMuscles.length > 0
      ? targetMuscles.reduce(
          (sum, m) => sum + (resolvedFatigueMap[m] ?? 0),
          0,
        ) / targetMuscles.length
      : 0;

  const muscleRecoveryPct = Math.max(
    0,
    Math.min(100, Math.round(100 - avgPrimaryFatigue)),
  );
  const muscleStatusLabel = getRecoveryStatus(avgPrimaryFatigue).label;

  const systemicPct = Math.max(
    0,
    Math.min(100, Math.round(systemicRecoveryPct ?? 76)),
  );

  // El factor limitante (recuperación sistémica vs recuperación muscular local) gobierna la autoregulación
  const recoveryScore =
    resolvedFatigueMap && targetMuscles.length > 0
      ? Math.min(systemicPct, muscleRecoveryPct)
      : systemicPct;

  // RPE previo
  const explicitRpes = workingSets
    .map((s) => s.rpe)
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r) && r > 0);
  const hasExplicitRpe = explicitRpes.length > 0;
  const avgRpeRaw = hasExplicitRpe
    ? explicitRpes.reduce((sum, r) => sum + r, 0) / explicitRpes.length
    : 7.5;
  const avgRpe = Math.round(avgRpeRaw * 10) / 10;

  // Repeticiones / duración objetivo y cumplimiento previo
  const activeWorkingTemplateSets = exercise.sets.filter(
    (s) => s.setType !== 'warmup',
  );
  const targetReps =
    definition?.defaultReps ??
    activeWorkingTemplateSets[0]?.durationSec ??
    activeWorkingTemplateSets[0]?.reps ??
    workingSets[0]?.durationSec ??
    workingSets[0]?.reps ??
    10;

  const prevRepsOrDuration = workingSets.map((s) =>
    category === 'isometric' ? (s.durationSec ?? s.reps) : s.reps,
  );
  const previousAvgReps =
    Math.round(
      (prevRepsOrDuration.reduce((sum, val) => sum + val, 0) /
        prevRepsOrDuration.length) *
        10,
    ) / 10;
  const completedTargetReps = previousAvgReps >= targetReps;

  const previousBestWeightKg = Math.max(
    0,
    ...workingSets.map((s) => s.weightKg),
  );

  const isExternalLoad =
    category === 'external_compound' || category === 'external_isolation';

  // 1) Recuperación < 45 -> Descarga (-10% carga en externos; -1 serie / -15% volumen en peso corporal/ligas/isométricos)
  if (recoveryScore < 45) {
    if (isExternalLoad && previousBestWeightKg > 0) {
      const rawDeloadKg = previousBestWeightKg * 0.9;
      const targetWeightKg = roundToPracticalWeightKg(
        rawDeloadKg,
        weightUnit,
        previousBestWeightKg,
      );
      const dropKg = Math.max(0, previousBestWeightKg - targetWeightKg);
      const dropFormatted = formatWeight(dropKg, weightUnit);
      const targetFormatted = formatWeight(targetWeightKg, weightUnit);

      return {
        category,
        action: 'deload',
        status: 'deload',
        pillLabel: `Descarga -${dropFormatted}`,
        label: `Descarga sugerida: -10% (${targetFormatted})`,
        rationale: `Recuperación en ${recoveryScore}% (< 45%, músculo ${muscleStatusLabel.toLowerCase()}). Reduce ~10% la carga hacia ${targetFormatted} para disipar fatiga.`,
        avgRpe,
        hasExplicitRpe,
        recoveryScore,
        systemicRecoveryPct: systemicPct,
        muscleRecoveryPct,
        muscleStatusLabel,
        previousBestWeightKg,
        previousAvgReps,
        targetReps,
        completedTargetReps,
        deltaWeightKg: -dropKg,
        recommendedWeightKg: targetWeightKg,
        deltaReps: 0,
        deltaDurationSec: 0,
        deltaSets: 0,
        deloadFactor: 0.9,
      };
    }

    return {
      category,
      action: 'reduce_volume',
      status: 'deload',
      pillLabel: '-1 serie · -15% vol.',
      label: 'Descarga sugerida: -1 serie o -15% volumen',
      rationale: `Recuperación en ${recoveryScore}% (< 45%). Reduce 1 serie o ~15% del volumen (${category === 'isometric' ? 'segundos' : 'repeticiones'}) sin forzar fatiga acumulada.`,
      avgRpe,
      hasExplicitRpe,
      recoveryScore,
      systemicRecoveryPct: systemicPct,
      muscleRecoveryPct,
      muscleStatusLabel,
      previousBestWeightKg,
      previousAvgReps,
      targetReps,
      completedTargetReps,
      deltaWeightKg: 0,
      deltaReps: 0,
      deltaDurationSec: 0,
      deltaSets: -1,
      deloadFactor: 0.85,
    };
  }

  // 2) Recuperación 45-69, pulso PPG elevado o RPE > 8.5 (o > 8) -> Mantener carga y consolidar técnica
  if (recoveryScore < 70 || avgRpe > 8.5 || avgRpe > 8 || elevatedPulse) {
    const reasons: string[] = [];
    if (recoveryScore < 70) {
      reasons.push(`recuperación al ${recoveryScore}% (45–69%)`);
    }
    if (avgRpe > 8.5) {
      reasons.push(`RPE previo ${avgRpe.toFixed(1)} (> 8.5)`);
    } else if (avgRpe > 8) {
      reasons.push(`RPE previo ${avgRpe.toFixed(1)} (> 8)`);
    }
    if (elevatedPulse) {
      reasons.push(
        restingBpm ? `pulso elevado (${restingBpm} BPM)` : 'estrés autonómico elevado',
      );
    }

    return {
      category,
      action: 'maintain',
      status:
        recoveryScore < 70 || elevatedPulse ? 'hold_low_recovery' : 'consolidate',
      pillLabel: isExternalLoad
        ? 'Mantener carga'
        : category === 'isometric'
          ? 'Mantener tiempo'
          : 'Mantener reps',
      label: isExternalLoad
        ? 'Mantener carga · Consolidar técnica'
        : category === 'isometric'
          ? 'Mantener tiempo · Consolidar postura'
          : 'Mantener volumen · Consolidar técnica',
      rationale: `Con ${reasons.join(' y ')}, mantén el estímulo actual y prioriza control técnico antes de progresar.`,
      avgRpe,
      hasExplicitRpe,
      recoveryScore,
      systemicRecoveryPct: systemicPct,
      muscleRecoveryPct,
      muscleStatusLabel,
      previousBestWeightKg,
      previousAvgReps,
      targetReps,
      completedTargetReps,
      deltaWeightKg: 0,
      recommendedWeightKg: isExternalLoad ? previousBestWeightKg : undefined,
      deltaReps: 0,
      deltaDurationSec: 0,
      deltaSets: 0,
    };
  }

  // 3) Recuperación >= 70 y RPE <= 8 -> Verificar si completó repeticiones objetivo
  if (!completedTargetReps) {
    return {
      category,
      action: 'maintain',
      status: 'consolidate',
      pillLabel: `Objetivo: ${targetReps}${category === 'isometric' ? 's' : ' reps'}`,
      label: `Consolidar hasta completar ${targetReps}${category === 'isometric' ? 's' : ' reps'}`,
      rationale: `Recuperación óptima (${recoveryScore}%) y RPE ${avgRpe.toFixed(1)} ≤ 8. Promedio previo ${previousAvgReps} vs meta ${targetReps}: completa el objetivo antes de subir carga.`,
      avgRpe,
      hasExplicitRpe,
      recoveryScore,
      systemicRecoveryPct: systemicPct,
      muscleRecoveryPct,
      muscleStatusLabel,
      previousBestWeightKg,
      previousAvgReps,
      targetReps,
      completedTargetReps,
      deltaWeightKg: 0,
      recommendedWeightKg: isExternalLoad ? previousBestWeightKg : undefined,
      deltaReps: 0,
      deltaDurationSec: 0,
      deltaSets: 0,
    };
  }

  // 4) Progresión autorregulada: Recuperación >= 70 + RPE <= 8 + objetivo cumplido
  if (category === 'external_compound') {
    const stepKg = 2.5;
    const nextWeightKg = previousBestWeightKg + stepKg;
    const deltaFormatted = formatWeight(stepKg, weightUnit);
    const nextFormatted = formatWeight(nextWeightKg, weightUnit);

    return {
      category,
      action: 'progress_weight',
      status: 'progress',
      pillLabel: `+${deltaFormatted}`,
      label: `Subir +${deltaFormatted} (Compuesto · ${nextFormatted})`,
      rationale: `Recuperación ${recoveryScore}% ≥ 70%, RPE ${avgRpe.toFixed(1)} ≤ 8 y ${previousAvgReps}/${targetReps} reps cumplidas. Sube +${deltaFormatted} hacia ${nextFormatted}.`,
      avgRpe,
      hasExplicitRpe,
      recoveryScore,
      systemicRecoveryPct: systemicPct,
      muscleRecoveryPct,
      muscleStatusLabel,
      previousBestWeightKg,
      previousAvgReps,
      targetReps,
      completedTargetReps,
      deltaWeightKg: stepKg,
      recommendedWeightKg: nextWeightKg,
      deltaReps: 0,
      deltaDurationSec: 0,
      deltaSets: 0,
    };
  }

  if (category === 'external_isolation') {
    const stepKg = 1;
    const nextWeightKg = previousBestWeightKg + stepKg;
    const deltaFormatted = formatWeight(stepKg, weightUnit);

    return {
      category,
      action: 'progress_weight',
      status: 'progress',
      pillLabel: `+${deltaFormatted} · +1-2 reps`,
      label: `Subir +${deltaFormatted} o +1–2 reps (Aislamiento)`,
      rationale: `Recuperación ${recoveryScore}% ≥ 70% y RPE ${avgRpe.toFixed(1)} ≤ 8 con objetivo cumplido. Progresa +${deltaFormatted} o añade 1–2 repeticiones limpias.`,
      avgRpe,
      hasExplicitRpe,
      recoveryScore,
      systemicRecoveryPct: systemicPct,
      muscleRecoveryPct,
      muscleStatusLabel,
      previousBestWeightKg,
      previousAvgReps,
      targetReps,
      completedTargetReps,
      deltaWeightKg: stepKg,
      recommendedWeightKg: nextWeightKg,
      deltaReps: 2,
      deltaDurationSec: 0,
      deltaSets: 0,
    };
  }

  if (category === 'isometric') {
    return {
      category,
      action: 'progress_time',
      status: 'progress',
      pillLabel: '+5s a +10s',
      label: 'Progresar +5s a +10s isométricos',
      rationale: `Recuperación ${recoveryScore}% ≥ 70% y RPE ${avgRpe.toFixed(1)} ≤ 8. Suma de 5 a 10 segundos por serie manteniendo tensión continua.`,
      avgRpe,
      hasExplicitRpe,
      recoveryScore,
      systemicRecoveryPct: systemicPct,
      muscleRecoveryPct,
      muscleStatusLabel,
      previousBestWeightKg: 0,
      previousAvgReps,
      targetReps,
      completedTargetReps,
      deltaWeightKg: 0,
      deltaReps: 10,
      deltaDurationSec: 10,
      deltaSets: 0,
    };
  }

  // Peso corporal o ligas de resistencia (nunca sugerir aumentar kg)
  let nextBandLevelIds: string[] | undefined;
  let nextBandLabel: string | undefined;
  if (exercise.loadMode === 'bands') {
    const currentIds = exercise.bandConfig?.levelIds ?? ['media'];
    if (currentIds.length <= 1) {
      const idx = RESISTANCE_BAND_PRESETS.findIndex(
        (b) => b.id === (currentIds[0] ?? 'media'),
      );
      if (idx >= 0 && idx < RESISTANCE_BAND_PRESETS.length - 1) {
        const nextBand = RESISTANCE_BAND_PRESETS[idx + 1];
        nextBandLevelIds = [nextBand.id];
        nextBandLabel = `Liga ${nextBand.label}`;
      }
    }
  }

  return {
    category: 'bodyweight_or_band',
    action: 'progress_reps',
    status: 'progress',
    pillLabel: '+1 a +2 reps',
    label: nextBandLabel
      ? `Subir +1–2 reps o ${nextBandLabel}`
      : 'Progresar +1 a +2 reps por serie',
    rationale: `Recuperación ${recoveryScore}% ≥ 70% y RPE ${avgRpe.toFixed(1)} ≤ 8. Añade +1 a +2 repeticiones controladas${nextBandLabel ? ` o pasa a ${nextBandLabel}` : ''}.`,
    avgRpe,
    hasExplicitRpe,
    recoveryScore,
    systemicRecoveryPct: systemicPct,
    muscleRecoveryPct,
    muscleStatusLabel,
    previousBestWeightKg: 0,
    previousAvgReps,
    targetReps,
    completedTargetReps,
    deltaWeightKg: 0,
    deltaReps: 2,
    deltaDurationSec: 0,
    deltaSets: 0,
    nextBandLevelIds,
    nextBandLabel,
  };
}

// ---------------------------------------------------------------------------
// Detección Inteligente de Récords Personales (PRs)
// ---------------------------------------------------------------------------

export function estimateEpley1RM(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0 || reps > 12) return 0;
  if (reps === 1) return Math.round(weightKg * 10) / 10;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

export interface ExercisePRBaseline {
  hasPriorHistory: boolean;
  priorSessionsCount: number;
  maxWeightKg: number;
  maxEpley1RM: number;
  maxSetVolumeKg: number;
}

export function getExerciseHistoricalPRBaseline(
  workouts: WorkoutSession[],
  exerciseId: string,
  exerciseName: string,
  excludeWorkoutId?: string,
): ExercisePRBaseline {
  const targetNorm = normalizeText(exerciseName);
  let priorSessionsCount = 0;
  let maxWeightKg = 0;
  let maxEpley1RM = 0;
  let maxSetVolumeKg = 0;

  for (const session of workouts) {
    if (excludeWorkoutId && session.id === excludeWorkoutId) continue;

    let sessionMatchedExercise = false;
    for (const ex of session.exercises) {
      const matchesId = Boolean(
        exerciseId && ex.exerciseId && ex.exerciseId === exerciseId,
      );
      const matchesName = normalizeText(ex.name) === targetNorm;
      if (!matchesId && !matchesName) continue;

      const completedSets = ex.sets.filter(
        (s) => s.completed && s.setType !== 'warmup',
      );
      if (completedSets.length === 0) continue;

      sessionMatchedExercise = true;

      if (ex.loadMode === 'bands') continue;

      for (const s of completedSets) {
        if (s.weightKg <= 0 || s.reps <= 0) continue;
        if (s.weightKg > maxWeightKg) {
          maxWeightKg = s.weightKg;
        }
        if (s.reps <= 12) {
          const epley = estimateEpley1RM(s.weightKg, s.reps);
          if (epley > maxEpley1RM) {
            maxEpley1RM = epley;
          }
        }
        const setVol = s.weightKg * s.reps;
        if (setVol > maxSetVolumeKg) {
          maxSetVolumeKg = setVol;
        }
      }
    }

    if (sessionMatchedExercise) {
      priorSessionsCount += 1;
    }
  }

  return {
    hasPriorHistory: priorSessionsCount >= 1,
    priorSessionsCount,
    maxWeightKg,
    maxEpley1RM,
    maxSetVolumeKg,
  };
}

export function evaluateWorkoutPRs(
  workout: ActiveWorkout,
  previousWorkouts: WorkoutSession[],
): {
  exercises: WorkoutExercise[];
  hasAnyPR: boolean;
  prLabels: string[];
} {
  const workoutPrLabelSet = new Set<string>();
  let hasAnyPR = false;

  const annotatedExercises = workout.exercises.map((ex) => {
    const baseline = getExerciseHistoricalPRBaseline(
      previousWorkouts,
      ex.exerciseId,
      ex.name,
      workout.id,
    );

    if (!baseline.hasPriorHistory || ex.loadMode === 'bands') {
      return {
        ...ex,
        sets: ex.sets.map((s) => {
          if (!s.isPR && !s.prLabels) return s;
          const { isPR: _dropIsPr, prLabels: _dropLabels, ...rest } = s;
          return rest;
        }),
      };
    }

    let runningMaxWeight = baseline.maxWeightKg;
    let runningMaxEpley = baseline.maxEpley1RM;
    let runningMaxSetVol = baseline.maxSetVolumeKg;

    const annotatedSets = ex.sets.map((s) => {
      if (
        !s.completed ||
        s.setType === 'warmup' ||
        s.weightKg <= 0 ||
        s.reps <= 0
      ) {
        if (!s.isPR && !s.prLabels) return s;
        const { isPR: _dropIsPr, prLabels: _dropLabels, ...rest } = s;
        return rest;
      }

      const labels: string[] = [];

      if (s.weightKg > runningMaxWeight) {
        labels.push('Peso máx');
      }
      if (baseline.maxEpley1RM > 0 && s.reps <= 12 && runningMaxEpley > 0) {
        const epley = estimateEpley1RM(s.weightKg, s.reps);
        if (epley > runningMaxEpley) {
          labels.push('1RM est.');
        }
      }
      const setVolume = s.weightKg * s.reps;
      if (setVolume > runningMaxSetVol) {
        labels.push('Vol. serie');
      }

      if (s.weightKg > runningMaxWeight) {
        runningMaxWeight = s.weightKg;
      }
      if (baseline.maxEpley1RM > 0 && s.reps <= 12) {
        const epley = estimateEpley1RM(s.weightKg, s.reps);
        if (epley > runningMaxEpley) {
          runningMaxEpley = epley;
        }
      }
      if (setVolume > runningMaxSetVol) {
        runningMaxSetVol = setVolume;
      }

      if (labels.length > 0) {
        hasAnyPR = true;
        for (const lbl of labels) {
          workoutPrLabelSet.add(`${ex.name}: ${lbl}`);
        }
        return {
          ...s,
          isPR: true,
          prLabels: labels,
        };
      }

      if (!s.isPR && !s.prLabels) return s;
      const { isPR: _dropIsPr, prLabels: _dropLabels, ...rest } = s;
      return rest;
    });

    return {
      ...ex,
      sets: annotatedSets,
    };
  });

  return {
    exercises: annotatedExercises,
    hasAnyPR,
    prLabels: Array.from(workoutPrLabelSet),
  };
}

export function evaluateCardioPR(
  candidate: Pick<
    CardioSession,
    'id' | 'activityType' | 'distanceKm' | 'avgPaceSecPerKm'
  >,
  previousCardioSessions: CardioSession[],
): {
  isPR: boolean;
  prLabels: string[];
} {
  const priorSameModality = previousCardioSessions.filter(
    (c) => c.id !== candidate.id && c.activityType === candidate.activityType,
  );

  // Exige al menos 1 registro histórico previo de la misma modalidad cardio
  if (priorSameModality.length < 1) {
    return { isPR: false, prLabels: [] };
  }

  const labels: string[] = [];

  // Mejor ritmo promedio (min/km) en recorridos >= 1 km
  if (candidate.distanceKm >= 1 && candidate.avgPaceSecPerKm > 0) {
    const priorLongEnough = priorSameModality.filter(
      (c) => c.distanceKm >= 1 && c.avgPaceSecPerKm > 0,
    );
    if (priorLongEnough.length >= 1) {
      const bestPriorPaceSecPerKm = Math.min(
        ...priorLongEnough.map((c) => c.avgPaceSecPerKm),
      );
      if (candidate.avgPaceSecPerKm < bestPriorPaceSecPerKm) {
        labels.push('Mejor ritmo');
      }
    }
  }

  // Mayor distancia continua recorrida
  const maxPriorDistanceKm = Math.max(
    ...priorSameModality.map((c) => c.distanceKm),
  );
  if (candidate.distanceKm > 0 && candidate.distanceKm > maxPriorDistanceKm) {
    labels.push('Mayor distancia');
  }

  return {
    isPR: labels.length > 0,
    prLabels: labels,
  };
}
