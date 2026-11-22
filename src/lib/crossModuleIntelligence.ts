import { calculateNutritionTargets } from '../data/foods';
import { getLocalDateKey, getTodayIsoDate } from './storage';
import type {
  AppDatabase,
  CardioSession,
  HiitSession,
  UserProfile,
  WorkoutSession,
} from '../types/fitness';

export interface DailyExerciseBurnSummary {
  date: string;
  cardioKcal: number;
  strengthKcal: number;
  hiitKcal: number;
  totalExerciseKcal: number;
  cardioCount: number;
  strengthCount: number;
  hiitCount: number;
}

/**
 * Calcula las calorías quemadas en el día a partir de:
 * - Caminatas GPS y cardio (`cardioSessions`)
 * - Rutinas de fuerza / ligas (`workouts`)
 * - Sesiones HIIT (`hiitSessions`)
 * Reconciliado por ID único y fecha en hora local.
 */
export function computeDailyExerciseBurn(
  profile: UserProfile,
  workouts: WorkoutSession[],
  cardioSessions: CardioSession[] = [],
  hiitSessions: HiitSession[] = [],
  dateIso = getTodayIsoDate(),
): DailyExerciseBurnSummary {
  const weightKg = profile.weightKg > 0 ? profile.weightKg : 75;

  let cardioKcal = 0;
  let cardioCount = 0;
  const seenCardioIds = new Set<string>();
  for (const c of cardioSessions) {
    if (c.id) {
      if (seenCardioIds.has(c.id)) continue;
      seenCardioIds.add(c.id);
    }
    if (getLocalDateKey(c.date || c.completedAt) !== dateIso) continue;
    cardioKcal += Math.max(0, Math.round(c.caloriesBurned || 0));
    cardioCount += 1;
  }

  let strengthKcal = 0;
  let strengthCount = 0;
  const seenWorkoutIds = new Set<string>();
  for (const w of workouts) {
    if (w.id) {
      if (seenWorkoutIds.has(w.id)) continue;
      seenWorkoutIds.add(w.id);
    }
    if (getLocalDateKey(w.completedAt) !== dateIso) continue;
    const mins = Math.max(1, Math.round((w.durationSec || 0) / 60));
    const kcal = Math.max(10, Math.round(mins * (weightKg * 0.085)));
    strengthKcal += kcal;
    strengthCount += 1;
  }

  let hiitKcal = 0;
  let hiitCount = 0;
  const seenHiitIds = new Set<string>();
  for (const h of hiitSessions) {
    if (h.id) {
      if (seenHiitIds.has(h.id)) continue;
      seenHiitIds.add(h.id);
    }
    if (getLocalDateKey(h.date || h.completedAt) !== dateIso) continue;
    hiitKcal += Math.max(0, Math.round(h.caloriesBurned || 0));
    hiitCount += 1;
  }

  return {
    date: dateIso,
    cardioKcal,
    strengthKcal,
    hiitKcal,
    totalExerciseKcal: cardioKcal + strengthKcal + hiitKcal,
    cardioCount,
    strengthCount,
    hiitCount,
  };
}

/**
 * Recalcula BMR (Mifflin-St Jeor), calorías objetivo y proteína diaria
 * automáticamente cada vez que el atleta registra o actualiza un pesaje.
 */
export function recalculateNutritionAfterWeighIn(
  prev: AppDatabase,
  latestWeightKg: number,
): AppDatabase {
  const safeWeight =
    Number.isFinite(latestWeightKg) && latestWeightKg > 20
      ? Math.round(latestWeightKg * 10) / 10
      : prev.profile.weightKg;

  const updatedProfile: UserProfile = {
    ...prev.profile,
    weightKg: safeWeight,
  };

  const targets = calculateNutritionTargets(updatedProfile);

  // If the user has an adaptiveNutrition calibration, proportionally adjust calorieTarget & proteinG to the new BMR/weight
  let nextAdaptive = prev.adaptiveNutrition ?? null;
  if (nextAdaptive) {
    const prevBase = calculateNutritionTargets(prev.profile);
    const bmrDelta = targets.bmr - prevBase.bmr;
    const nextEstimatedTdee = Math.max(
      Math.round(targets.bmr * 1.15),
      Math.round(nextAdaptive.estimatedTdee + bmrDelta),
    );
    let nextCalorieTarget = nextEstimatedTdee;
    if (updatedProfile.goal === 'perder_grasa') {
      nextCalorieTarget = Math.max(1250, Math.round(nextEstimatedTdee - 450));
    } else if (updatedProfile.goal === 'ganar_musculo') {
      nextCalorieTarget = Math.round(nextEstimatedTdee + 280);
    }
    const fatG = Math.max(
      Math.round(safeWeight * 0.7),
      Math.round((nextCalorieTarget * 0.25) / 9),
    );
    const remainingCal = Math.max(
      160,
      nextCalorieTarget - targets.proteinG * 4 - fatG * 9,
    );
    nextAdaptive = {
      ...nextAdaptive,
      estimatedTdee: nextEstimatedTdee,
      theoreticalTdee: targets.tdee,
      calorieTarget: nextCalorieTarget,
      proteinG: targets.proteinG,
      fatG,
      carbsG: Math.round(remainingCal / 4),
      waterMl: targets.waterMl,
    };
  }

  return {
    ...prev,
    profile: updatedProfile,
    adaptiveNutrition: nextAdaptive,
  };
}

export interface RecoveryIndexSummary {
  score: number; // 0..100
  statusLabel: string;
  accentHex: string;
  sleepQualityPct: number | null;
  sleepDurationMin: number | null;
  hrvMs: number | null;
  bpm: number | null;
  stressLabel: string;
  stressLevelPct: number | null;
  recommendation: string;
  hasRealSignals: boolean;
}

/**
 * Índice de Recuperación (0–100) combinando:
 * - Última Calidad de Sueño (%)
 * - Último Estrés / HRV (RMSSD en ms) y Pulso en reposo (BPM)
 */
export function computeRecoveryIndex0To100(db: AppDatabase): RecoveryIndexSummary {
  const todayIso = getTodayIsoDate();

  const sortedSleep = [...(db.sleepSessions ?? [])].sort((a, b) =>
    (b.wakeUpAt || b.date).localeCompare(a.wakeUpAt || a.date),
  );
  const latestSleep = sortedSleep[0] ?? null;

  const sortedPulse = [...(db.pulseHrvRecords ?? [])].sort((a, b) =>
    (b.recordedAt || b.date).localeCompare(a.recordedAt || a.date),
  );
  const latestPulse = sortedPulse[0] ?? null;
  const todayReadiness = db.readinessByDate?.[todayIso] ?? null;

  const sleepQualityPct = latestSleep
    ? Math.max(0, Math.min(100, Math.round(latestSleep.sleepQualityPct)))
    : todayReadiness?.sleepQuality
      ? Math.min(100, Math.round(todayReadiness.sleepQuality * 20))
      : null;

  const sleepDurationMin = latestSleep
    ? Math.max(0, Math.round(latestSleep.durationMinutes))
    : todayReadiness?.sleepHours
      ? Math.round(todayReadiness.sleepHours * 60)
      : null;

  const hrvMs =
    latestPulse && latestPulse.hrvRmssdMs > 0
      ? Math.round(latestPulse.hrvRmssdMs)
      : todayReadiness?.hrvRmssdMs && todayReadiness.hrvRmssdMs > 0
        ? Math.round(todayReadiness.hrvRmssdMs)
        : null;

  const bpm =
    latestPulse && latestPulse.bpm > 0
      ? Math.round(latestPulse.bpm)
      : todayReadiness?.restingBpm && todayReadiness.restingBpm > 0
        ? Math.round(todayReadiness.restingBpm)
        : null;

  // Autonomic HRV score (0..100): 20 ms -> 30, 55 ms -> 78, 85+ ms -> 98
  let hrvAutonomicScore: number | null = null;
  if (hrvMs !== null) {
    const hrvPart = Math.min(70, Math.max(15, Math.round((hrvMs / 75) * 70)));
    const bpmBonus =
      bpm !== null ? Math.min(30, Math.max(6, Math.round(30 - Math.max(0, bpm - 56) * 0.7))) : 20;
    hrvAutonomicScore = Math.max(10, Math.min(100, hrvPart + bpmBonus));
  } else if (bpm !== null) {
    hrvAutonomicScore = Math.max(20, Math.min(95, Math.round(95 - Math.max(0, bpm - 55) * 1.1)));
  }

  let score = 76;
  const hasRealSignals = sleepQualityPct !== null || hrvAutonomicScore !== null;

  if (sleepQualityPct !== null && hrvAutonomicScore !== null) {
    score = Math.round(sleepQualityPct * 0.55 + hrvAutonomicScore * 0.45);
  } else if (sleepQualityPct !== null) {
    score = sleepQualityPct;
  } else if (hrvAutonomicScore !== null) {
    score = hrvAutonomicScore;
  } else if (todayReadiness?.score) {
    score = Math.round(todayReadiness.score);
  }

  score = Math.max(0, Math.min(100, score));

  // Stress estimate inverted from HRV & BPM
  const stressLevelPct =
    hrvAutonomicScore !== null ? Math.max(5, Math.min(95, 100 - hrvAutonomicScore)) : null;
  const stressLabel =
    stressLevelPct === null
      ? 'Sin toma PPG'
      : stressLevelPct <= 30
        ? 'Estrés bajo'
        : stressLevelPct <= 58
          ? 'Estrés moderado'
          : 'Estrés elevado';

  let statusLabel = 'Recuperación óptima';
  let accentHex = '#a3e635';
  let recommendation = 'Sistema listo para cargas altas, PRs o intervalos intensos.';

  if (!hasRealSignals) {
    statusLabel = 'Pendiente de sensores';
    accentHex = '#38bdf8';
    recommendation =
      'Registra una noche en Sueño o mide tu pulso PPG para calibrar tu índice real.';
  } else if (score >= 78) {
    statusLabel = 'Óptima para exigirte';
    accentHex = '#a3e635';
    recommendation = 'Alta disponibilidad neuromuscular y autonómica. Ideal para sesión intensa.';
  } else if (score >= 55) {
    statusLabel = 'Moderada';
    accentHex = '#fbbf24';
    recommendation = 'Entrena con normalidad controlando volumen y respetando descansos.';
  } else {
    statusLabel = 'Recuperación baja';
    accentHex = '#fb7185';
    recommendation = 'Prioriza técnica suave, caminata ligera, hidratación y sueño temprano.';
  }

  return {
    score,
    statusLabel,
    accentHex,
    sleepQualityPct,
    sleepDurationMin,
    hrvMs,
    bpm,
    stressLabel,
    stressLevelPct,
    recommendation,
    hasRealSignals,
  };
}

export interface SleepPulseIntensityAlert {
  triggered: boolean;
  lowSleepQuality: boolean;
  elevatedPulse: boolean;
  sleepQualityPct: number | null;
  latestBpm: number | null;
  title: string;
  message: string;
  suggestion: string;
}

/**
 * Inteligencia cruzada Sueño + Pulso -> Dashboard y Entrenar:
 * Detecta si la última sesión de sueño tuvo calidad < 65% o si el último
 * registro de pulso está elevado (reposo >= 85 BPM o >12 BPM sobre promedio personal)
 * para sugerir ajustar la intensidad del entrenamiento del día.
 */
export function computeSleepPulseIntensityAlert(
  db: AppDatabase,
): SleepPulseIntensityAlert | null {
  const todayIso = getTodayIsoDate();

  // 1. Último registro de sueño
  const sortedSleep = [...(db.sleepSessions ?? [])].sort((a, b) =>
    (b.wakeUpAt || b.date).localeCompare(a.wakeUpAt || a.date),
  );
  const latestSleep = sortedSleep[0] ?? null;
  const todayReadiness = db.readinessByDate?.[todayIso] ?? null;

  let sleepQualityPct: number | null = latestSleep
    ? latestSleep.sleepQualityPct
    : null;
  if (
    sleepQualityPct === null &&
    todayReadiness &&
    todayReadiness.sleepQuality > 0
  ) {
    sleepQualityPct = Math.min(100, Math.round(todayReadiness.sleepQuality * 20));
  }

  const lowSleepQuality =
    sleepQualityPct !== null && sleepQualityPct < 65;

  // 2. Último registro de pulso (PPG, Presión Arterial o Check-in)
  const pulseCandidates: { bpm: number; sortKey: string }[] = [];

  for (const p of db.pulseHrvRecords ?? []) {
    if (Number.isFinite(p.bpm) && p.bpm > 0) {
      pulseCandidates.push({
        bpm: p.bpm,
        sortKey: p.recordedAt || `${p.date}T08:00:00.000Z`,
      });
    }
  }
  for (const bp of db.bloodPressureRecords ?? []) {
    if (typeof bp.pulseBpm === 'number' && bp.pulseBpm > 0) {
      pulseCandidates.push({
        bpm: bp.pulseBpm,
        sortKey: bp.recordedAt || `${bp.date}T08:30:00.000Z`,
      });
    }
  }
  if (todayReadiness?.restingBpm && todayReadiness.restingBpm > 0) {
    pulseCandidates.push({
      bpm: todayReadiness.restingBpm,
      sortKey: todayReadiness.updatedAt || `${todayIso}T07:00:00.000Z`,
    });
  }

  pulseCandidates.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  const latestBpm = pulseCandidates[0]?.bpm ?? null;

  let baselineBpm: number | null = null;
  if (pulseCandidates.length >= 4) {
    const prior = pulseCandidates.slice(1, 8);
    baselineBpm = Math.round(
      prior.reduce((sum, item) => sum + item.bpm, 0) / prior.length,
    );
  }

  const elevatedPulse =
    latestBpm !== null &&
    (latestBpm >= 85 ||
      (baselineBpm !== null && latestBpm >= 78 && latestBpm - baselineBpm >= 12));

  if (!lowSleepQuality && !elevatedPulse) {
    return null;
  }

  const reasons: string[] = [];
  if (lowSleepQuality && sleepQualityPct !== null) {
    reasons.push(`calidad de sueño en ${sleepQualityPct}% (< 65%)`);
  }
  if (elevatedPulse && latestBpm !== null) {
    reasons.push(
      baselineBpm !== null && latestBpm < 85
        ? `pulso elevado a ${latestBpm} BPM (promedio habitual ${baselineBpm} BPM)`
        : `pulso en reposo elevado (${latestBpm} BPM)`,
    );
  }

  const title =
    lowSleepQuality && elevatedPulse
      ? 'Alerta de recuperación: sueño bajo y pulso elevado'
      : lowSleepQuality
        ? 'Aviso inteligente: descanso nocturno bajo'
        : 'Aviso inteligente: pulso en reposo elevado';

  const message = `Se detectó ${reasons.join(' y ')}.`;
  const suggestion =
    'Sugerencia: reduce cargas 10–15% hoy, mantén RPE ≤ 7 o prioriza caminata suave y movilidad.';

  return {
    triggered: true,
    lowSleepQuality,
    elevatedPulse,
    sleepQualityPct,
    latestBpm,
    title,
    message,
    suggestion,
  };
}
