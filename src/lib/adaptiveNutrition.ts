import { calculateNutritionTargets } from '../data/foods';
import type {
  AdaptiveNutritionState,
  BodyWeightEntry,
  FoodEntry,
  UserProfile,
} from '../types/fitness';

export interface SmoothedWeightPoint {
  id: string;
  date: string;
  label: string;
  rawWeightKg: number;
  emaWeightKg: number;
  deltaFromTrend: number;
}

// Smoothing factor alpha = 0.25 (~7-day exponential moving average)
const EMA_ALPHA = 0.25;

export function computeSmoothedWeightTrend(
  bodyWeights: BodyWeightEntry[],
): SmoothedWeightPoint[] {
  if (bodyWeights.length === 0) return [];

  const sorted = [...bodyWeights].sort((a, b) => a.date.localeCompare(b.date));
  const points: SmoothedWeightPoint[] = [];

  let prevEma = sorted[0].weightKg;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const ema =
      i === 0
        ? entry.weightKg
        : EMA_ALPHA * entry.weightKg + (1 - EMA_ALPHA) * prevEma;
    prevEma = ema;

    const emaRounded = Math.round(ema * 100) / 100;
    const [y, m, d] = entry.date.split('-').map(Number);
    const label = new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
    });

    points.push({
      id: entry.id,
      date: entry.date,
      label,
      rawWeightKg: entry.weightKg,
      emaWeightKg: emaRounded,
      deltaFromTrend: Math.round((entry.weightKg - emaRounded) * 100) / 100,
    });
  }

  return points;
}

export interface CheckInResult {
  ok: boolean;
  error?: string;
  adaptiveState?: AdaptiveNutritionState;
}

export function runWeeklyAdaptiveCheckIn(
  profile: UserProfile,
  bodyWeights: BodyWeightEntry[],
  foodLogs: FoodEntry[],
  referenceDateIso: string,
): CheckInResult {
  const baseTargets = calculateNutritionTargets(profile);
  const trendPoints = computeSmoothedWeightTrend(bodyWeights);

  // Collect food calories from last 7 days up to referenceDateIso
  const [ry, rm, rd] = referenceDateIso.split('-').map(Number);
  const endDt = new Date(ry, (rm || 1) - 1, rd || 1);
  const startDt = new Date(endDt);
  startDt.setDate(endDt.getDate() - 6);
  const startIso = `${startDt.getFullYear()}-${String(startDt.getMonth() + 1).padStart(2, '0')}-${String(startDt.getDate()).padStart(2, '0')}`;

  const caloriesByDay = new Map<string, number>();
  for (const log of foodLogs) {
    if (log.date >= startIso && log.date <= referenceDateIso) {
      caloriesByDay.set(log.date, (caloriesByDay.get(log.date) ?? 0) + log.calories);
    }
  }

  const loggedDaysCount = caloriesByDay.size;
  if (loggedDaysCount === 0) {
    return {
      ok: false,
      error:
        'Registra al menos un día de comidas en los últimos 7 días para calcular tu consumo promedio real.',
    };
  }

  const totalKcal7d = Array.from(caloriesByDay.values()).reduce((a, b) => a + b, 0);
  const avgCaloriesLast7Days = Math.round(totalKcal7d / loggedDaysCount);

  // Calculate weekly trend change (kg / 7 days) from EMA trend
  let weeklyTrendChangeKg = 0;
  let notePrefix = '';

  if (trendPoints.length >= 2) {
    const latest = trendPoints[trendPoints.length - 1];
    // Find point closest to 7 days prior to latest
    const latestMs = Date.parse(latest.date);
    let baseline = trendPoints[0];
    for (const pt of trendPoints) {
      const diffDays = (latestMs - Date.parse(pt.date)) / (1000 * 60 * 60 * 24);
      if (diffDays >= 6 && diffDays <= 10) {
        baseline = pt;
      }
    }

    const spanDays = Math.max(
      1,
      (latestMs - Date.parse(baseline.date)) / (1000 * 60 * 60 * 24),
    );
    const rawChange = latest.emaWeightKg - baseline.emaWeightKg;
    // Normalize to 7-day rate and clamp to physiological bounds [-1.5, +1.5] kg/sem
    const normalized7d = (rawChange / spanDays) * 7;
    weeklyTrendChangeKg = Math.max(-1.5, Math.min(1.5, Math.round(normalized7d * 100) / 100));
    notePrefix = `Tendencia EMA (${spanDays.toFixed(0)}d): ${weeklyTrendChangeKg >= 0 ? '+' : ''}${weeklyTrendChangeKg.toFixed(2)} kg/sem.`;
  } else {
    notePrefix =
      'Con un solo registro de peso, se tomó tu ingesta registrada frente al gasto teórico base.';
  }

  // Energy balance: 1 kg body tissue ~ 7700 kcal => 1100 kcal/day per kg/week change
  const dailyBalanceKcal = weeklyTrendChangeKg * 1100;
  const rawEstimatedTdee = avgCaloriesLast7Days - dailyBalanceKcal;

  // Clamp estimated TDEE to safe physiological envelope around BMR
  const minSafeTdee = Math.round(baseTargets.bmr * 1.15);
  const maxSafeTdee = Math.round(baseTargets.bmr * 2.25);
  const estimatedTdee = Math.max(
    minSafeTdee,
    Math.min(maxSafeTdee, Math.round(rawEstimatedTdee)),
  );

  // Recalculate next week's calorie and macro targets based on real TDEE & user goal
  let calorieTarget = estimatedTdee;
  if (profile.goal === 'perder_grasa') {
    calorieTarget = Math.max(1250, Math.round(estimatedTdee - 450));
  } else if (profile.goal === 'ganar_musculo') {
    calorieTarget = Math.round(estimatedTdee + 280);
  }

  const latestWeight =
    trendPoints[trendPoints.length - 1]?.emaWeightKg ?? profile.weightKg;
  const proteinPerKg =
    profile.goal === 'perder_grasa'
      ? 2.1
      : profile.goal === 'ganar_musculo'
        ? 2.0
        : 1.8;
  const proteinG = Math.round(latestWeight * proteinPerKg);
  const fatG = Math.max(
    Math.round(latestWeight * 0.7),
    Math.round((calorieTarget * 0.25) / 9),
  );
  const remainingCal = Math.max(160, calorieTarget - proteinG * 4 - fatG * 9);
  const carbsG = Math.round(remainingCal / 4);

  const deltaVsTheoretical = estimatedTdee - baseTargets.tdee;
  const tdeeComparison =
    Math.abs(deltaVsTheoretical) < 40
      ? 'Tu gasto real coincide con el teórico.'
      : deltaVsTheoretical > 0
        ? `Tu metabolismo real está +${deltaVsTheoretical} kcal/día por encima de la fórmula base.`
        : `Tu metabolismo real está ${deltaVsTheoretical} kcal/día por debajo de la fórmula base.`;

  return {
    ok: true,
    adaptiveState: {
      estimatedTdee,
      theoreticalTdee: baseTargets.tdee,
      calorieTarget,
      proteinG,
      carbsG,
      fatG,
      waterMl: baseTargets.waterMl,
      avgCaloriesLast7Days,
      loggedDaysCount,
      weeklyTrendChangeKg,
      lastCheckInAt: new Date().toISOString(),
      summaryNote: `${notePrefix} ${tdeeComparison}`,
    },
  };
}
