import { calculateNutritionTargets } from '../data/foods';
import type { PersonalCoachContext } from './aiClient';
import { shiftIsoDate } from './compareDates';
import { computeDailyActivitySummary } from './dailyActivity';
import { computeHydrationGoal } from './hydration';
import { getLocalDateKey, getSavedCustomGoal, getTodayIsoDate } from './storage';
import { computeFlexibleStreakSummary } from './streakEngine';
import {
  formatLiquid,
  formatWeight,
  getLiquidUnit,
  getWeightUnit,
  kgToDisplayWeight,
} from './units';
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

  let statusLabel = 'Óptimo';
  let accentHex = '#a3e635';
  let recommendation = 'Sistema listo para cargas altas, PRs o intervalos intensos.';

  if (!hasRealSignals) {
    statusLabel = 'Pendiente de sensores';
    accentHex = '#38bdf8';
    recommendation =
      'Registra una noche en Sueño o mide tu pulso PPG para calibrar tu índice real.';
  } else if (score >= 70) {
    statusLabel = 'Óptimo';
    accentHex = '#a3e635';
    recommendation = 'Alta disponibilidad neuromuscular y autonómica. Ideal para sesión intensa.';
  } else if (score >= 45) {
    statusLabel = 'Moderado';
    accentHex = '#fbbf24';
    recommendation = 'Entrena con normalidad controlando volumen y respetando descansos.';
  } else {
    statusLabel = 'Recuperación';
    accentHex = '#38bdf8';
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

const GOAL_LABEL_MAP: Record<string, string> = {
  perder_grasa: 'Pérdida de grasa',
  mantener_peso: 'Recomposición y mantenimiento',
  ganar_musculo: 'Fuerza e hipertrofia',
};

function avgNums(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

/**
 * Construye el snapshot omnisciente del perfil activo (fechas locales en-CA)
 * cruzando Perfil, Equipo, Descansos/Modo Turno, Biometría 7d/30d, Entrenos/PRs/RPE,
 * Nutrición, Hidratación, Sueño y Racha para alimentar al AI Coach y al Briefing del Día.
 */
export function buildOmniscientCoachContext(
  db: AppDatabase,
  activeProfileId?: string,
): PersonalCoachContext {
  const profile = db.profile;
  const todayIso = getTodayIsoDate();
  const sevenDaysAgoIso = shiftIsoDate(todayIso, -6);
  const thirtyDaysAgoIso = shiftIsoDate(todayIso, -29);
  const weightUnit = getWeightUnit(profile.weightUnit);
  const liquidUnit = getLiquidUnit(profile.liquidUnit);

  const recoveryIndex = computeRecoveryIndex0To100(db);
  const streakSummary = computeFlexibleStreakSummary(db, todayIso);
  const todayAct = computeDailyActivitySummary(db, todayIso);
  const todayBurn = computeDailyExerciseBurn(
    profile,
    db.workouts,
    db.cardioSessions ?? [],
    db.hiitSessions ?? [],
    todayIso,
  );

  const fallbackTargets = calculateNutritionTargets(profile);
  const baseCalTarget = db.adaptiveNutrition?.calorieTarget ?? fallbackTargets.calories;
  const proteinTargetG = db.adaptiveNutrition?.proteinG ?? fallbackTargets.proteinG;
  const caloriesTarget = baseCalTarget + todayBurn.totalExerciseKcal;

  const todayFoods = db.foodLogs.filter((f) => f.date === todayIso);
  const caloriesConsumed = Math.round(
    todayFoods.reduce((s, f) => s + (f.calories || 0), 0),
  );
  const proteinConsumedG = Math.round(
    todayFoods.reduce((s, f) => s + (f.proteinG || 0), 0),
  );

  const todayWaterMl = Math.max(0, db.hydrationByDate?.[todayIso] ?? 0);
  const todayElectrolytes = Math.max(0, db.electrolytesByDate?.[todayIso] ?? 0);
  const todayPausaCount = Math.max(
    0,
    db.manualActivityByDate?.[todayIso]?.pausaActivaCount ?? 0,
  );
  const waterGoalToday = computeHydrationGoal(
    profile,
    db.bodyWeights,
    db.bodyScans,
    db.workouts,
    db.hydrationSettings ?? {
      mlPerKg: 35,
      containerMl: 500,
      wakeHour: 7,
      sleepHour: 22,
      hotDayByDate: {},
      remindersEnabled: false,
    },
    todayIso,
    db.cardioSessions ?? [],
    db.hiitSessions ?? [],
  ).totalTargetMl;
  const waterPct =
    waterGoalToday > 0
      ? Math.min(100, Math.round((todayWaterMl / waterGoalToday) * 100))
      : 0;

  // 1. Pesos 7d / 30d & Antropometría
  const weightMap = new Map<string, number>();
  for (const bw of db.bodyWeights) {
    if (bw.date && Number.isFinite(bw.weightKg) && bw.weightKg > 0) {
      weightMap.set(bw.date, bw.weightKg);
    }
  }
  for (const sc of db.bodyScans) {
    if (sc.date && Number.isFinite(sc.weightKg) && sc.weightKg > 0) {
      weightMap.set(sc.date, sc.weightKg);
    }
  }
  const weightPoints = Array.from(weightMap.entries())
    .map(([date, kg]) => ({ date, kg }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latestW = weightPoints[weightPoints.length - 1] ?? null;

  const findBaseline = (cutoffIso: string) => {
    const candidates = weightPoints.filter((w) => w.date >= cutoffIso);
    if (candidates.length >= 2) return candidates[0];
    return weightPoints.length >= 2 ? weightPoints[0] : null;
  };
  const formatDelta = (baseKg: number | null | undefined) => {
    if (!latestW || !baseKg) return null;
    const diffDisplay =
      Math.round(
        (kgToDisplayWeight(latestW.kg, weightUnit) -
          kgToDisplayWeight(baseKg, weightUnit)) *
          10,
      ) / 10;
    const sign = diffDisplay > 0 ? '+' : '';
    return `${sign}${diffDisplay} ${weightUnit}`;
  };

  const base7 = findBaseline(sevenDaysAgoIso);
  const base30 = findBaseline(thirtyDaysAgoIso);

  const latestScan = [...db.bodyScans].sort((a, b) =>
    (b.recordedAt || b.date).localeCompare(a.recordedAt || a.date),
  )[0];
  const latestMeasurement = [...(db.bodyMeasurements ?? [])]
    .filter((m) => typeof m.waistCm === 'number' && m.waistCm > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const waistCm =
    latestMeasurement?.waistCm ??
    (latestScan?.waistCm && latestScan.waistCm > 0 ? latestScan.waistCm : null);

  // 2. Presión Arterial, FC reposo y HRV (7d y 30d)
  const bpRecords = [...(db.bloodPressureRecords ?? [])].sort((a, b) =>
    (b.recordedAt || b.date).localeCompare(a.recordedAt || a.date),
  );
  const latestBp = bpRecords[0] ?? null;
  const bp7 = bpRecords.filter((b) => getLocalDateKey(b.date || b.recordedAt) >= sevenDaysAgoIso);
  const bp30 = bpRecords.filter((b) => getLocalDateKey(b.date || b.recordedAt) >= thirtyDaysAgoIso);

  const formatBpAvg = (list: typeof bpRecords) => {
    if (list.length === 0) return null;
    const avgSys = Math.round(list.reduce((s, r) => s + r.systolic, 0) / list.length);
    const avgDia = Math.round(list.reduce((s, r) => s + r.diastolic, 0) / list.length);
    return `${avgSys}/${avgDia} mmHg`;
  };

  const pulseRecords = [...(db.pulseHrvRecords ?? [])];
  const hrValues7: number[] = [];
  const hrValues30: number[] = [];
  const hrvValues7: number[] = [];
  const hrvValues30: number[] = [];

  for (const p of pulseRecords) {
    const d = getLocalDateKey(p.date || p.recordedAt);
    if (d >= thirtyDaysAgoIso) {
      if (p.bpm > 0) hrValues30.push(p.bpm);
      if (p.hrvRmssdMs > 0) hrvValues30.push(p.hrvRmssdMs);
      if (d >= sevenDaysAgoIso) {
        if (p.bpm > 0) hrValues7.push(p.bpm);
        if (p.hrvRmssdMs > 0) hrvValues7.push(p.hrvRmssdMs);
      }
    }
  }
  for (const bp of bpRecords) {
    const d = getLocalDateKey(bp.date || bp.recordedAt);
    if (d >= thirtyDaysAgoIso && typeof bp.pulseBpm === 'number' && bp.pulseBpm > 0) {
      hrValues30.push(bp.pulseBpm);
      if (d >= sevenDaysAgoIso) {
        hrValues7.push(bp.pulseBpm);
      }
    }
  }

  // 3. Entrenamientos recientes (Fuerza, HIIT, Cardio), RPE promedio y PRs
  const workouts7 = db.workouts.filter((w) => {
    const d = getLocalDateKey(w.completedAt);
    return d >= sevenDaysAgoIso && d <= todayIso;
  });
  const cardio7 = (db.cardioSessions ?? []).filter((c) => {
    const d = getLocalDateKey(c.date || c.completedAt);
    return d >= sevenDaysAgoIso && d <= todayIso;
  });
  const hiit7 = (db.hiitSessions ?? []).filter((h) => {
    const d = getLocalDateKey(h.date || h.completedAt);
    return d >= sevenDaysAgoIso && d <= todayIso;
  });
  const workoutsLast7Days = workouts7.length + cardio7.length + hiit7.length;

  const sortedWorkouts = [...db.workouts].sort((a, b) =>
    b.completedAt.localeCompare(a.completedAt),
  );
  const latestWorkout = sortedWorkouts[0];
  let lastWorkoutSummary: string | null = null;
  if (latestWorkout) {
    const rpes = latestWorkout.exercises
      .flatMap((ex) => ex.sets)
      .map((s) => s.rpe)
      .filter((r): r is number => typeof r === 'number' && r > 0);
    const avgRpe =
      rpes.length > 0
        ? (rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1)
        : null;
    lastWorkoutSummary = avgRpe
      ? `${latestWorkout.title} · RPE ${avgRpe}`
      : latestWorkout.title;
  }

  const rpe7Values = workouts7
    .flatMap((w) => w.exercises)
    .flatMap((ex) => ex.sets)
    .map((s) => s.rpe)
    .filter((r): r is number => typeof r === 'number' && r > 0);
  const avgWorkoutRpe7d = avgNums(rpe7Values);

  const recentPrLabels: string[] = [];
  for (const w of sortedWorkouts) {
    const d = getLocalDateKey(w.completedAt);
    if (d < thirtyDaysAgoIso) continue;
    if (Array.isArray(w.prLabels) && w.prLabels.length > 0) {
      for (const lbl of w.prLabels) {
        if (lbl && !recentPrLabels.includes(lbl)) {
          recentPrLabels.push(lbl);
        }
      }
    } else {
      for (const ex of w.exercises) {
        for (const s of ex.sets) {
          if (s.isPR && Array.isArray(s.prLabels)) {
            for (const lbl of s.prLabels) {
              const label = `${ex.name}: ${lbl}`;
              if (!recentPrLabels.includes(label)) {
                recentPrLabels.push(label);
              }
            }
          }
        }
      }
    }
    if (recentPrLabels.length >= 4) break;
  }
  for (const c of [...(db.cardioSessions ?? [])].sort((a, b) =>
    b.completedAt.localeCompare(a.completedAt),
  )) {
    if (recentPrLabels.length >= 5) break;
    const d = getLocalDateKey(c.date || c.completedAt);
    if (d < thirtyDaysAgoIso) continue;
    if (c.isPR && Array.isArray(c.prLabels)) {
      for (const lbl of c.prLabels) {
        if (lbl && !recentPrLabels.includes(lbl)) {
          recentPrLabels.push(lbl);
        }
      }
    }
  }

  const recentWorkoutsSummary: string[] = [];
  for (const w of sortedWorkouts.slice(0, 3)) {
    const d = getLocalDateKey(w.completedAt);
    const prBadge = w.isPR ? ' ★PR' : '';
    recentWorkoutsSummary.push(`${d}: ${w.title} (${Math.round(w.durationSec / 60)}m)${prBadge}`);
  }
  for (const c of [...(db.cardioSessions ?? [])]
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, 2)) {
    recentWorkoutsSummary.push(
      `${c.date}: ${c.activityType} ${c.distanceKm.toFixed(1)} km${c.isPR ? ' ★PR' : ''}`,
    );
  }

  // 4. Objetivo persistente customGoal
  const savedLocalGoal = activeProfileId ? getSavedCustomGoal(activeProfileId) : '';
  const resolvedCustomGoal =
    profile.customGoal?.trim() || savedLocalGoal || null;

  const syncedModules: string[] = [
    'Perfil y Equipo',
    'Biometría 7d/30d',
    'Entrenos y PRs',
    'Nutrición y Agua',
    'Sueño y Racha',
  ];

  return {
    profileName: profile.name || 'Atleta',
    goal: profile.goal,
    customGoal: resolvedCustomGoal,
    age: profile.age,
    heightCm: profile.heightCm,
    targetWeightDisplay: profile.targetWeightKg
      ? formatWeight(profile.targetWeightKg, weightUnit)
      : null,
    equipment: profile.equipment,
    trainingDaysPerWeek: profile.trainingDaysPerWeek,
    scheduledRestDates: (db.scheduledRestDates ?? []).slice(-7),
    pausaActivaCountToday: todayPausaCount,
    shiftModeActive: streakSummary.isTodayScheduledRest || todayPausaCount > 0,
    weightUnit,
    liquidUnit,
    personality: db.coachPersonality ?? 'sargento',
    daysSinceLastWorkout: streakSummary.daysSinceLastWorkout,
    workoutsLast7Days,
    trainedToday: streakSummary.isTodayTrained,
    lastWorkoutSummary,
    avgWorkoutRpe7d,
    recentWorkoutsSummary: recentWorkoutsSummary.slice(0, 4),
    recentPrLabels: recentPrLabels.slice(0, 4),
    recentCardioCount7d: cardio7.length,
    recentHiitCount7d: hiit7.length,
    latestWeightDisplay: latestW ? formatWeight(latestW.kg, weightUnit) : null,
    weightDelta7dDisplay:
      base7 && base7.date !== latestW?.date ? formatDelta(base7.kg) : null,
    weightDelta30dDisplay:
      base30 && base30.date !== latestW?.date ? formatDelta(base30.kg) : null,
    waistCm,
    bodyFatPct: latestScan ? latestScan.bodyFatPct : null,
    muscleMassPct: latestScan ? latestScan.totalMusclePct : null,
    todaySteps: todayAct.steps,
    stepsGoal: todayAct.stepsGoal,
    activeMinutesToday: todayAct.activeMin,
    activeMinutesGoal: todayAct.activeMinGoal,
    activeKcalToday: todayAct.activeKcal,
    activeKcalGoal: todayAct.activeKcalGoal,
    waterConsumedDisplay: formatLiquid(todayWaterMl, liquidUnit),
    waterTargetDisplay: formatLiquid(waterGoalToday, liquidUnit),
    waterPct,
    electrolytesToday: todayElectrolytes,
    pausaActivaDoneToday: todayPausaCount > 0,
    caloriesConsumed,
    caloriesTarget,
    proteinConsumedG,
    proteinTargetG,
    sleepQualityPct: recoveryIndex.sleepQualityPct,
    sleepHours:
      recoveryIndex.sleepDurationMin !== null
        ? Math.round((recoveryIndex.sleepDurationMin / 60) * 10) / 10
        : null,
    pulseBpm: recoveryIndex.bpm,
    hrvMs: recoveryIndex.hrvMs,
    avgBpm7d: avgNums(hrValues7),
    avgBpm30d: avgNums(hrValues30),
    avgHrv7d: avgNums(hrvValues7),
    avgHrv30d: avgNums(hrvValues30),
    stressLabel: recoveryIndex.stressLabel,
    lastBpDisplay: latestBp
      ? `${latestBp.systolic}/${latestBp.diastolic} mmHg (${latestBp.category})`
      : null,
    avgBp7dDisplay: formatBpAvg(bp7),
    avgBp30dDisplay: formatBpAvg(bp30),
    recoveryIndexScore: recoveryIndex.score,
    recoveryStatusLabel: recoveryIndex.statusLabel,
    streakDays: streakSummary.streakDays,
    shieldUsedInCurrent7d: streakSummary.shieldUsedInCurrent7d,
    isTodayRestShield: streakSummary.isTodayScheduledRest,
    syncedModules,
  };
}

export type ReadinessRingTier = 'optimal' | 'moderate' | 'recovery';

export interface DeterministicDailyBriefing {
  tier: ReadinessRingTier;
  tierLabel: string;
  accentHex: string;
  glowRgba: string;
  score: number;
  hasRealSignals: boolean;
  headline: string;
  readinessSummary: string;
  trainingPrescription: string;
  proteinRemainingG: number;
  caloriesRemaining: number;
  waterPct: number;
  waterStatusText: string;
  objectiveLabel: string;
  latestPrLabel: string | null;
}

export function buildDeterministicDailyBriefing(
  db: AppDatabase,
  context: PersonalCoachContext,
): DeterministicDailyBriefing {
  const recovery = computeRecoveryIndex0To100(db);
  const score = recovery.score;

  let tier: ReadinessRingTier = 'optimal';
  let tierLabel = 'Óptimo';
  let accentHex = '#a3e635';
  let glowRgba = 'rgba(163, 230, 53, 0.34)';

  if (score < 45) {
    tier = 'recovery';
    tierLabel = 'Recuperación';
    accentHex = '#38bdf8';
    glowRgba = 'rgba(56, 189, 248, 0.34)';
  } else if (score < 70) {
    tier = 'moderate';
    tierLabel = 'Moderado';
    accentHex = '#fbbf24';
    glowRgba = 'rgba(251, 191, 36, 0.32)';
  }

  const proteinRemainingG = Math.max(
    0,
    Math.round(context.proteinTargetG - context.proteinConsumedG),
  );
  const caloriesRemaining = Math.max(
    0,
    Math.round(context.caloriesTarget - context.caloriesConsumed),
  );

  const objectiveLabel =
    context.customGoal?.trim() ||
    GOAL_LABEL_MAP[context.goal] ||
    'Salud y rendimiento';

  let headline = 'Listo para empujar fuerte hoy';
  let trainingPrescription =
    'Disponibilidad alta: busca sobrecarga progresiva o intervalos exigentes.';

  if (context.isTodayRestShield) {
    headline = 'Día protegido con Escudo de Descanso';
    trainingPrescription =
      'Mantén pasos suaves, electrolitos y estiramientos sin presión de carga.';
  } else if (context.trainedToday) {
    headline = 'Entrenamiento del día completado';
    trainingPrescription =
      proteinRemainingG > 25
        ? `Prioriza recuperación: cubre los ${proteinRemainingG}g de proteína restantes e hidrátate.`
        : 'Excelente ejecución hoy. Prioriza hidratación y sueño reparador.';
  } else if (!recovery.hasRealSignals) {
    headline = 'Calibra tus sensores de recuperación';
    trainingPrescription =
      'Mide tu pulso PPG o registra sueño para ajustar la intensidad de tu sesión.';
  } else if (tier === 'recovery') {
    headline = 'Prioridad: descarga y recuperación';
    trainingPrescription =
      'Baja el volumen/carga 15–20%, prioriza movilidad, caminata o Pausa Activa.';
  } else if (tier === 'moderate') {
    headline = 'Estado moderado: entreno controlado';
    trainingPrescription =
      'Trabaja en RPE 7–8 respetando descansos entre series sin llegar al fallo.';
  }

  const hrvFragment =
    context.hrvMs !== null
      ? `HRV en ${context.hrvMs} ms${
          context.avgHrv7d ? ` (prom 7d: ${context.avgHrv7d} ms)` : ''
        }`
      : 'Sin toma HRV reciente';
  const bpmFragment =
    context.pulseBpm !== null ? `FC reposo ${context.pulseBpm} BPM` : 'Sin pulso reposo';
  const sleepFragment =
    context.sleepHours !== null
      ? `Sueño ${context.sleepHours.toFixed(1)}h${
          context.sleepQualityPct !== null ? ` (${context.sleepQualityPct}%)` : ''
        }`
      : 'Sueño por registrar';

  const readinessSummary = `${hrvFragment} · ${bpmFragment} · ${sleepFragment}.`;
  const waterStatusText = `${context.waterConsumedDisplay} / ${context.waterTargetDisplay} (${context.waterPct}%)`;

  return {
    tier,
    tierLabel,
    accentHex,
    glowRgba,
    score,
    hasRealSignals: recovery.hasRealSignals,
    headline,
    readinessSummary,
    trainingPrescription,
    proteinRemainingG,
    caloriesRemaining,
    waterPct: context.waterPct,
    waterStatusText,
    objectiveLabel,
    latestPrLabel: context.recentPrLabels?.[0] ?? null,
  };
}
