import { shiftIsoDate } from './compareDates';
import { computeDailyExerciseBurn } from './crossModuleIntelligence';
import { computePulseRecoveryImpact } from './pulsePpgEngine';
import { getTodayIsoDate } from './storage';
import type { AppDatabase } from '../types/fitness';

export interface ReadinessTrendDayPoint {
  date: string;
  shortDate: string;
  fullDate: string;
  readinessPct: number | null;
  readinessSource: 'guardado' | 'calculado' | 'sin_datos';
  sleepQualityPct: number | null;
  sleepHours: number | null;
  avgBpm: number | null;
  avgHrvMs: number | null;
  trainingLoadScore: number;
  exerciseKcal: number;
  exerciseMin: number;
}

export interface ReadinessTrend7dSummary {
  points: ReadinessTrendDayPoint[];
  daysWithReadiness: number;
  daysWithAnyData: number;
  avgReadiness: number | null;
  avgSleepPct: number | null;
  avgBpm: number | null;
  avgLoad: number;
  insightText: string;
}

function toLocalIsoDate(isoTimestamp: string): string {
  const dt = new Date(isoTimestamp);
  if (Number.isNaN(dt.getTime())) return isoTimestamp.slice(0, 10);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShortDayEs(dateIso: string, isToday: boolean): string {
  if (isToday) return 'Hoy';
  const [y, m, d] = dateIso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dt.getTime())) return dateIso.slice(5);
  const wd = dt
    .toLocaleDateString('es-MX', { weekday: 'short' })
    .replace('.', '')
    .slice(0, 3);
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${d}`;
}

function formatFullDateEs(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dt.getTime())) return dateIso;
  return dt.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function computeTrainingLoadForDate(
  db: AppDatabase,
  dateIso: string,
): { loadScore: number; exerciseKcal: number; exerciseMin: number } {
  const burn = computeDailyExerciseBurn(
    db.profile,
    db.workouts,
    db.cardioSessions ?? [],
    db.hiitSessions ?? [],
    dateIso,
  );

  let totalMin = 0;
  let totalSets = 0;
  for (const w of db.workouts) {
    if (toLocalIsoDate(w.completedAt) === dateIso) {
      totalMin += Math.max(1, Math.round((w.durationSec || 0) / 60));
      totalSets += Math.max(0, w.completedSets || 0);
    }
  }
  for (const c of db.cardioSessions ?? []) {
    if (c.date === dateIso) {
      totalMin += Math.max(1, Math.round((c.durationSec || 0) / 60));
    }
  }
  for (const h of db.hiitSessions ?? []) {
    if (h.date === dateIso) {
      totalMin += Math.max(1, Math.round((h.totalDurationSec || 0) / 60));
    }
  }

  if (totalMin === 0 && burn.totalExerciseKcal === 0) {
    return { loadScore: 0, exerciseKcal: 0, exerciseMin: 0 };
  }

  // Normalized 0..100 training load score combining kcal, duration, and resistance sets
  const kcalPart = (burn.totalExerciseKcal / 600) * 55;
  const minPart = (totalMin / 90) * 30;
  const setPart = (totalSets / 20) * 15;
  const loadScore = Math.max(
    6,
    Math.min(100, Math.round(kcalPart + minPart + setPart)),
  );

  return {
    loadScore,
    exerciseKcal: burn.totalExerciseKcal,
    exerciseMin: totalMin,
  };
}

export function computeReadiness7DayCorrelation(
  db: AppDatabase,
  endDateIso = getTodayIsoDate(),
): ReadinessTrend7dSummary {
  const dates: string[] = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    dates.push(shiftIsoDate(endDateIso, offset));
  }

  // Also check day -7 load so day -6 gets accurate prior-day load carryover
  const prevMinus7Load = computeTrainingLoadForDate(
    db,
    shiftIsoDate(endDateIso, -7),
  ).loadScore;

  const rawLoads = dates.map((d) => computeTrainingLoadForDate(db, d));
  const points: ReadinessTrendDayPoint[] = [];

  for (let i = 0; i < dates.length; i += 1) {
    const dateIso = dates[i];
    const readinessEntry = db.readinessByDate?.[dateIso] ?? null;
    const sleepSession =
      (db.sleepSessions ?? []).find((s) => s.date === dateIso) ?? null;

    // Sleep quality (%) & hours
    let sleepHours: number | null = null;
    let sleepQualityPct: number | null = null;
    if (sleepSession) {
      sleepHours = Math.round((sleepSession.durationMinutes / 60) * 10) / 10;
      sleepQualityPct = Math.max(
        0,
        Math.min(100, Math.round(sleepSession.sleepQualityPct)),
      );
    } else if (readinessEntry) {
      if (readinessEntry.sleepHours > 0) {
        sleepHours = Math.round(readinessEntry.sleepHours * 10) / 10;
      }
      if (readinessEntry.sleepQuality > 0) {
        sleepQualityPct = Math.min(
          100,
          Math.round(readinessEntry.sleepQuality * 20),
        );
      } else if (sleepHours !== null) {
        sleepQualityPct = Math.min(100, Math.round((sleepHours / 8) * 100));
      }
    }

    // Pulse (BPM) & HRV (RMSSD ms) averaged for the day
    const pulseSamples: number[] = [];
    const hrvSamples: number[] = [];
    for (const p of db.pulseHrvRecords ?? []) {
      if (p.date === dateIso && Number.isFinite(p.bpm) && p.bpm > 0) {
        pulseSamples.push(p.bpm);
        if (Number.isFinite(p.hrvRmssdMs) && p.hrvRmssdMs > 0) {
          hrvSamples.push(p.hrvRmssdMs);
        }
      }
    }
    for (const bp of db.bloodPressureRecords ?? []) {
      if (bp.date === dateIso && typeof bp.pulseBpm === 'number' && bp.pulseBpm > 0) {
        pulseSamples.push(bp.pulseBpm);
      }
    }
    if (
      pulseSamples.length === 0 &&
      readinessEntry?.restingBpm &&
      readinessEntry.restingBpm > 0
    ) {
      pulseSamples.push(readinessEntry.restingBpm);
    }
    if (
      hrvSamples.length === 0 &&
      readinessEntry?.hrvRmssdMs &&
      readinessEntry.hrvRmssdMs > 0
    ) {
      hrvSamples.push(readinessEntry.hrvRmssdMs);
    }

    const avgBpm =
      pulseSamples.length > 0
        ? Math.round(
            pulseSamples.reduce((sum, v) => sum + v, 0) / pulseSamples.length,
          )
        : null;
    const avgHrvMs =
      hrvSamples.length > 0
        ? Math.round(hrvSamples.reduce((sum, v) => sum + v, 0) / hrvSamples.length)
        : null;

    const loadInfo = rawLoads[i];
    const prevLoadScore = i === 0 ? prevMinus7Load : rawLoads[i - 1].loadScore;

    // Daily Readiness: use saved DailyReadinessEntry first; otherwise compute from real signals
    let readinessPct: number | null = null;
    let readinessSource: 'guardado' | 'calculado' | 'sin_datos' = 'sin_datos';

    if (readinessEntry && Number.isFinite(readinessEntry.score)) {
      readinessPct = Math.max(0, Math.min(100, Math.round(readinessEntry.score)));
      readinessSource = 'guardado';
    } else if (
      sleepQualityPct !== null ||
      avgBpm !== null ||
      loadInfo.loadScore > 0 ||
      prevLoadScore >= 25
    ) {
      const sleepComponent =
        sleepQualityPct !== null
          ? sleepQualityPct
          : sleepHours !== null
            ? Math.min(100, Math.round((sleepHours / 8) * 100))
            : 74;

      const pulseComponent =
        avgBpm !== null && avgHrvMs !== null
          ? computePulseRecoveryImpact(avgBpm, avgHrvMs)
          : avgBpm !== null
            ? Math.max(25, Math.min(98, Math.round(98 - Math.max(0, avgBpm - 55) * 1.45)))
            : 76;

      const fatiguePenalty = prevLoadScore * 0.28 + loadInfo.loadScore * 0.14;
      const loadFreshness = Math.max(30, Math.min(98, Math.round(94 - fatiguePenalty)));

      readinessPct = Math.max(
        15,
        Math.min(
          99,
          Math.round(
            sleepComponent * 0.45 + pulseComponent * 0.3 + loadFreshness * 0.25,
          ),
        ),
      );
      readinessSource = 'calculado';
    }

    points.push({
      date: dateIso,
      shortDate: formatShortDayEs(dateIso, dateIso === endDateIso),
      fullDate: formatFullDateEs(dateIso),
      readinessPct,
      readinessSource,
      sleepQualityPct,
      sleepHours,
      avgBpm,
      avgHrvMs,
      trainingLoadScore: loadInfo.loadScore,
      exerciseKcal: loadInfo.exerciseKcal,
      exerciseMin: loadInfo.exerciseMin,
    });
  }

  const readinessVals = points
    .map((p) => p.readinessPct)
    .filter((v): v is number => v !== null);
  const sleepVals = points
    .map((p) => p.sleepQualityPct)
    .filter((v): v is number => v !== null);
  const bpmVals = points
    .map((p) => p.avgBpm)
    .filter((v): v is number => v !== null);

  const avgReadiness =
    readinessVals.length > 0
      ? Math.round(readinessVals.reduce((s, v) => s + v, 0) / readinessVals.length)
      : null;
  const avgSleepPct =
    sleepVals.length > 0
      ? Math.round(sleepVals.reduce((s, v) => s + v, 0) / sleepVals.length)
      : null;
  const avgBpm =
    bpmVals.length > 0
      ? Math.round(bpmVals.reduce((s, v) => s + v, 0) / bpmVals.length)
      : null;
  const avgLoad = Math.round(
    points.reduce((s, p) => s + p.trainingLoadScore, 0) / points.length,
  );

  const daysWithAnyData = points.filter(
    (p) =>
      p.readinessPct !== null ||
      p.sleepQualityPct !== null ||
      p.avgBpm !== null ||
      p.trainingLoadScore > 0,
  ).length;

  // Build dynamic correlation insight
  let insightText =
    'Registra sueño, pulso o entrenamientos para descubrir cómo impactan tu recuperación semanal.';

  if (daysWithAnyData >= 2) {
    const goodSleepDays = points.filter(
      (p) => p.sleepQualityPct !== null && p.sleepQualityPct >= 75 && p.readinessPct !== null,
    );
    const poorSleepDays = points.filter(
      (p) => p.sleepQualityPct !== null && p.sleepQualityPct < 75 && p.readinessPct !== null,
    );
    const highLoadDays = points.filter((p) => p.trainingLoadScore >= 55);

    if (goodSleepDays.length > 0 && poorSleepDays.length > 0) {
      const avgGood = Math.round(
        goodSleepDays.reduce((s, p) => s + (p.readinessPct ?? 0), 0) /
          goodSleepDays.length,
      );
      const avgPoor = Math.round(
        poorSleepDays.reduce((s, p) => s + (p.readinessPct ?? 0), 0) /
          poorSleepDays.length,
      );
      const diff = avgGood - avgPoor;
      if (diff > 0) {
        insightText = `Cuando tu sueño supera 75%, tu preparación promedio sube +${diff} pts (${avgGood}% vs ${avgPoor}%).`;
      } else {
        insightText = `Promedio semanal: preparación ${avgReadiness ?? '--'}% y sueño ${avgSleepPct ?? '--'}%.`;
      }
    } else if (highLoadDays.length > 0 && avgBpm !== null) {
      insightText = `${highLoadDays.length} ${highLoadDays.length === 1 ? 'día' : 'días'} de carga alta (≥55 pts) con pulso medio de ${avgBpm} BPM esta semana.`;
    } else if (avgReadiness !== null) {
      insightText = `Preparación media de los últimos 7 días: ${avgReadiness}% · Pulso medio: ${avgBpm !== null ? `${avgBpm} BPM` : '--'}.`;
    }
  }

  return {
    points,
    daysWithReadiness: readinessVals.length,
    daysWithAnyData,
    avgReadiness,
    avgSleepPct,
    avgBpm,
    avgLoad,
    insightText,
  };
}
