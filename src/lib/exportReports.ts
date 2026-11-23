import { computeBodyCompositionScan } from './bodyComposition';
import { shiftIsoDate } from './compareDates';
import { classifyBloodPressure } from './pulsePpgEngine';
import {
  flushPendingAppDatabaseSaves,
  getLocalDateKey,
  getTodayIsoDate,
  loadAppDatabase,
  loadProfileRegistry,
} from './storage';
import {
  KG_TO_LB,
  formatDistance,
  formatLiquid,
  formatVolume,
  formatWaist,
  formatWeight,
  getDistanceUnit,
  getLiquidUnit,
  getWaistUnit,
  getWeightUnit,
  kgToDisplayWeight,
  kmToDisplayDistance,
} from './units';
import type {
  AppDatabase,
  BloodPressureRecord,
  PulseHrvRecord,
  Sex,
} from '../types/fitness';

function escapeCsvCell(val: string | number | undefined | null): string {
  const str = val === undefined || val === null ? '' : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCsvFile(filename: string, headers: string[], rows: (string | number)[][]): void {
  const csvLines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];
  // UTF-8 BOM for clean Excel / Google Sheets Spanish accent rendering
  const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportWorkoutsCsv(db: AppDatabase): number {
  const weightUnit = getWeightUnit(db.profile.weightUnit);
  const headers = [
    'Fecha',
    'Rutina',
    'Duracion_Min',
    'Ejercicio',
    'Tipo_Serie',
    `Peso_${weightUnit}`,
    'Repeticiones',
    'RPE',
    'Liga',
  ];
  const rows: (string | number)[][] = [];

  for (const w of db.workouts) {
    const dateStr = w.completedAt.slice(0, 10);
    const durMin = Math.round(w.durationSec / 60);
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        if (!s.completed) continue;
        rows.push([
          dateStr,
          w.title,
          durMin,
          ex.name,
          s.setType ?? 'normal',
          kgToDisplayWeight(s.weightKg, weightUnit),
          s.reps,
          s.rpe ?? '',
          s.bandLabel ?? '',
        ]);
      }
    }
  }

  downloadCsvFile(`pulsofit-fuerza-${getTodayIsoDate()}.csv`, headers, rows);
  return rows.length;
}

export function exportNutritionCsv(db: AppDatabase): number {
  const headers = ['Fecha', 'Comida', 'Alimento', 'Calorias_kcal', 'Proteina_g', 'Carbs_g', 'Grasas_g'];
  const rows: (string | number)[][] = db.foodLogs.map((f) => [
    f.date,
    f.mealType,
    f.name,
    f.calories,
    f.proteinG,
    f.carbsG,
    f.fatG,
  ]);
  downloadCsvFile(`pulsofit-nutricion-${getTodayIsoDate()}.csv`, headers, rows);
  return rows.length;
}

export function exportBodyMetricsCsv(db: AppDatabase): number {
  const weightUnit = getWeightUnit(db.profile.weightUnit);
  const headers = [
    'Fecha',
    'Tipo',
    `Peso_${weightUnit}`,
    'Grasa_Pct',
    'Musculo_Pct',
    'Agua_Pct',
    'Cintura_cm',
    'Pecho_cm',
    'Brazo_cm',
    'Muslo_cm',
    'Cadera_cm',
  ];
  const rows: (string | number)[][] = [];

  for (const bw of db.bodyWeights) {
    rows.push([
      bw.date,
      'peso',
      kgToDisplayWeight(bw.weightKg, weightUnit),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }
  for (const sc of db.bodyScans) {
    rows.push([
      sc.date,
      'bascula_bia',
      kgToDisplayWeight(sc.weightKg, weightUnit),
      sc.bodyFatPct,
      sc.totalMusclePct,
      sc.bodyWaterPct,
      '',
      '',
      '',
      '',
      '',
    ]);
  }
  for (const m of db.bodyMeasurements ?? []) {
    rows.push([
      m.date,
      'medidas',
      '',
      '',
      '',
      '',
      m.waistCm ?? '',
      m.chestCm ?? '',
      m.armCm ?? '',
      m.thighCm ?? '',
      m.hipsCm ?? '',
    ]);
  }

  downloadCsvFile(`pulsofit-cuerpo-${getTodayIsoDate()}.csv`, headers, rows);
  return rows.length;
}

export function exportCardioCsv(db: AppDatabase): number {
  const distUnit = getDistanceUnit(db.profile.distanceUnit);
  const headers = [
    'Fecha',
    'Actividad',
    'Duracion_Min',
    `Distancia_${distUnit}`,
    'Calorias_kcal',
    'Tenis',
  ];
  const rows: (string | number)[][] = (db.cardioSessions ?? []).map((c) => [
    c.date,
    c.activityType,
    Math.round(c.durationSec / 60),
    Number(kmToDisplayDistance(c.distanceKm, distUnit).toFixed(2)),
    c.caloriesBurned,
    c.shoeName ?? '',
  ]);
  downloadCsvFile(`pulsofit-cardio-${getTodayIsoDate()}.csv`, headers, rows);
  return rows.length;
}

export function buildPrintableSummaryStats(db: AppDatabase) {
  const weightUnit = getWeightUnit(db.profile.weightUnit);
  const distanceUnit = getDistanceUnit(db.profile.distanceUnit);
  const totalVolumeKg = db.workouts.reduce((sum, w) => sum + w.totalVolumeKg, 0);
  const totalCardioKm = (db.cardioSessions ?? []).reduce((sum, c) => sum + c.distanceKm, 0);
  const latestScan = [...db.bodyScans].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0] ?? null;

  return {
    generatedDate: getTodayIsoDate(),
    weightText: formatWeight(db.profile.weightKg, weightUnit),
    targetWeightText: formatWeight(db.profile.targetWeightKg, weightUnit),
    workoutsCount: db.workouts.length,
    totalVolumeText: formatVolume(totalVolumeKg, weightUnit),
    cardioCount: (db.cardioSessions ?? []).length,
    totalDistanceText: formatDistance(totalCardioKm, distanceUnit, 1),
    hiitCount: (db.hiitSessions ?? []).length,
    latestBodyFat: latestScan ? `${latestScan.bodyFatPct}%` : 'N/D',
    latestMuscle: latestScan ? `${latestScan.totalMusclePct}%` : 'N/D',
    recentWorkouts: [...db.workouts]
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      .slice(0, 8),
  };
}

export interface MonthlyClinicalReportResult {
  ok: boolean;
  reason?: 'no_data' | 'print_blocked';
  message?: string;
  method?: 'window' | 'iframe';
  rangeStart: string;
  rangeEnd: string;
  recordCount: number;
}

function escapeHtml(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSexLabel(sex: Sex): string {
  if (sex === 'hombre') return 'Masculino';
  if (sex === 'mujer') return 'Femenino';
  return 'Otro / No especificado';
}

function formatHumanDateEs(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  if (Number.isNaN(dt.getTime())) return isoDate;
  return dt.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDurationMinutesLabel(totalMin: number): string {
  if (!Number.isFinite(totalMin) || totalMin <= 0) return 'N/D';
  const rounded = Math.round(totalMin);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function computeStats(values: number[]): {
  count: number;
  avg: number;
  min: number;
  max: number;
} | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0);
  if (clean.length === 0) return null;
  const sum = clean.reduce((acc, v) => acc + v, 0);
  return {
    count: clean.length,
    avg: sum / clean.length,
    min: Math.min(...clean),
    max: Math.max(...clean),
  };
}

function getBpBadgeStyle(category: string): { bg: string; color: string; border: string } {
  switch (category) {
    case 'Normal':
      return { bg: '#ECFDF5', color: '#065F46', border: '#6EE7B7' };
    case 'Elevada':
      return { bg: '#FFFBEB', color: '#92400E', border: '#FCD34D' };
    case 'Alta Nivel 1':
      return { bg: '#FFF7ED', color: '#9A3412', border: '#FDBA74' };
    case 'Alta Nivel 2':
      return { bg: '#FEF2F2', color: '#991B1B', border: '#FCA5A5' };
    default:
      return { bg: '#F0F9FF', color: '#075985', border: '#7DD3FC' };
  }
}

function buildMonthlyClinicalReportHtml(params: {
  db: AppDatabase;
  profileLabel: string;
  startIso: string;
  todayIso: string;
}): { html: string; recordCount: number } {
  const { db, profileLabel, startIso, todayIso } = params;
  const weightUnit = getWeightUnit(db.profile.weightUnit);
  const distanceUnit = getDistanceUnit(db.profile.distanceUnit);
  const liquidUnit = getLiquidUnit(db.profile.liquidUnit);
  const waistUnit = getWaistUnit(db.profile);

  const inRange = (rawDate?: string | null, fallbackIso?: string): string | null => {
    const key = getLocalDateKey(rawDate || fallbackIso || '');
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    return key >= startIso && key <= todayIso ? key : null;
  };

  // --- 1. Cardiovascular & Recovery (30d) ---
  const bp30 = (db.bloodPressureRecords ?? [])
    .map((bp) => ({ bp, day: inRange(bp.date, bp.recordedAt) }))
    .filter((item): item is { bp: BloodPressureRecord; day: string } =>
      Boolean(item.day),
    )
    .sort((a, b) => (a.bp.recordedAt || a.day).localeCompare(b.bp.recordedAt || b.day));

  const pulse30 = (db.pulseHrvRecords ?? [])
    .map((p) => ({ p, day: inRange(p.date, p.recordedAt) }))
    .filter((item): item is { p: PulseHrvRecord; day: string } =>
      Boolean(item.day),
    )
    .sort((a, b) => (a.p.recordedAt || a.day).localeCompare(b.p.recordedAt || b.day));

  const readiness30 = Object.entries(db.readinessByDate ?? {})
    .filter(([date]) => date >= startIso && date <= todayIso)
    .map(([date, entry]) => ({ date, entry }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const bpSysStats = computeStats(bp30.map((x) => x.bp.systolic));
  const bpDiaStats = computeStats(bp30.map((x) => x.bp.diastolic));
  const bpMeanClass =
    bpSysStats && bpDiaStats
      ? classifyBloodPressure(Math.round(bpSysStats.avg), Math.round(bpDiaStats.avg))
      : null;

  const pulseRecordIdsIn30 = new Set(pulse30.map((x) => x.p.id));
  const pulseDatesIn30 = new Set(pulse30.map((x) => x.day));

  const restingBpmValues: number[] = pulse30.map((x) => x.p.bpm);
  for (const r of readiness30) {
    if (
      typeof r.entry.restingBpm === 'number' &&
      r.entry.restingBpm > 0 &&
      (!r.entry.pulseRecordId || !pulseRecordIdsIn30.has(r.entry.pulseRecordId)) &&
      !pulseDatesIn30.has(r.date)
    ) {
      restingBpmValues.push(r.entry.restingBpm);
    }
  }
  if (restingBpmValues.length === 0) {
    for (const item of bp30) {
      if (typeof item.bp.pulseBpm === 'number' && item.bp.pulseBpm > 0) {
        restingBpmValues.push(item.bp.pulseBpm);
      }
    }
  }
  const bpmStats = computeStats(restingBpmValues);

  const hrvValues: number[] = pulse30.map((x) => x.p.hrvRmssdMs);
  for (const r of readiness30) {
    if (
      typeof r.entry.hrvRmssdMs === 'number' &&
      r.entry.hrvRmssdMs > 0 &&
      (!r.entry.pulseRecordId || !pulseRecordIdsIn30.has(r.entry.pulseRecordId)) &&
      !pulseDatesIn30.has(r.date)
    ) {
      hrvValues.push(r.entry.hrvRmssdMs);
    }
  }
  const hrvStats = computeStats(hrvValues);

  // --- 2. Anthropometry & Body Composition (30d) ---
  // Consolidate all daily weights (scans supersede simple entries on the same date)
  const dailyWeightMap = new Map<
    string,
    { date: string; weightKg: number; sourceOrder: number; ts: number }
  >();
  for (const bw of db.bodyWeights ?? []) {
    const d = getLocalDateKey(bw.date);
    if (!d || !Number.isFinite(bw.weightKg) || bw.weightKg <= 0) continue;
    const prev = dailyWeightMap.get(d);
    if (!prev || prev.sourceOrder <= 1) {
      dailyWeightMap.set(d, {
        date: d,
        weightKg: bw.weightKg,
        sourceOrder: 1,
        ts: Date.parse(`${d}T12:00:00`) || 0,
      });
    }
  }
  const scansInRange30: Array<(typeof db.bodyScans)[number] & { day: string }> = [];
  for (const sc of db.bodyScans ?? []) {
    const d = getLocalDateKey(sc.date || sc.recordedAt);
    if (!d) continue;
    if (d >= startIso && d <= todayIso) {
      scansInRange30.push({ ...sc, day: d });
    }
    if (!Number.isFinite(sc.weightKg) || sc.weightKg <= 0) continue;
    const prev = dailyWeightMap.get(d);
    const ts = Date.parse(sc.recordedAt) || Date.parse(`${d}T12:00:00`) || 0;
    if (!prev || prev.sourceOrder < 2 || ts >= prev.ts) {
      dailyWeightMap.set(d, {
        date: d,
        weightKg: sc.weightKg,
        sourceOrder: 2,
        ts,
      });
    }
  }

  const allDailyWeightsAsc = Array.from(dailyWeightMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const weights30 = allDailyWeightsAsc.filter(
    (w) => w.date >= startIso && w.date <= todayIso,
  );
  scansInRange30.sort((a, b) =>
    (a.recordedAt || a.day).localeCompare(b.recordedAt || b.day),
  );

  const startWeightEntry = weights30[0] ?? null;
  const endWeightEntry = weights30[weights30.length - 1] ?? null;

  const startWeightDisplay = startWeightEntry
    ? kgToDisplayWeight(startWeightEntry.weightKg, weightUnit)
    : null;
  const endWeightDisplay = endWeightEntry
    ? kgToDisplayWeight(endWeightEntry.weightKg, weightUnit)
    : null;
  const netWeightDeltaDisplay =
    startWeightDisplay !== null && endWeightDisplay !== null
      ? Number((endWeightDisplay - startWeightDisplay).toFixed(1))
      : null;

  // 30-day moving average anchored at the latest weight in window (or today)
  let movingAvg30dDisplay: number | null = null;
  if (endWeightEntry) {
    const maStartIso = shiftIsoDate(endWeightEntry.date, -29);
    const maSlice = allDailyWeightsAsc.filter(
      (w) => w.date >= maStartIso && w.date <= endWeightEntry.date,
    );
    if (maSlice.length > 0) {
      const avgKg =
        maSlice.reduce((sum, w) => sum + w.weightKg, 0) / maSlice.length;
      movingAvg30dDisplay = Number(
        (weightUnit === 'lb' ? avgKg * KG_TO_LB : avgKg).toFixed(1),
      );
    }
  }

  // Waist measurements in 30d (combine bodyMeasurements + bodyScans)
  const measurements30 = (db.bodyMeasurements ?? [])
    .map((m) => ({ m, day: inRange(m.date) }))
    .filter((x): x is { m: NonNullable<AppDatabase['bodyMeasurements']>[number]; day: string } =>
      Boolean(x.day),
    )
    .sort((a, b) => a.day.localeCompare(b.day));

  const waistByDate = new Map<string, number>();
  for (const item of measurements30) {
    if (typeof item.m.waistCm === 'number' && item.m.waistCm > 0) {
      waistByDate.set(item.day, item.m.waistCm);
    }
  }
  for (const sc of scansInRange30) {
    if (typeof sc.waistCm === 'number' && sc.waistCm > 0) {
      waistByDate.set(sc.day, sc.waistCm);
    }
  }
  const waistPoints30 = Array.from(waistByDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, cm]) => ({ date, cm }));
  const latestWaist = waistPoints30[waistPoints30.length - 1] ?? null;
  const firstWaist = waistPoints30[0] ?? null;

  // Body fat % (latest BIA scan in 30d, or anthropometric estimate if weight exists)
  const latestScan30 = scansInRange30[scansInRange30.length - 1] ?? null;
  const firstScan30 = scansInRange30[0] ?? null;
  let bodyFatValueText = 'Sin datos';
  let bodyFatSourceNote = 'Sin pesajes en el período';
  let latestBmiText = 'N/D';
  let latestMuscleText = 'N/D';

  if (latestScan30) {
    bodyFatValueText = `${latestScan30.bodyFatPct.toFixed(1)}%`;
    latestBmiText = latestScan30.bmi.toFixed(1);
    latestMuscleText = `${latestScan30.totalMusclePct.toFixed(1)}%`;
    if (scansInRange30.length >= 2 && firstScan30) {
      const fatDelta = Number(
        (latestScan30.bodyFatPct - firstScan30.bodyFatPct).toFixed(1),
      );
      bodyFatSourceNote = `Báscula BIA (${scansInRange30.length} escaneos · Δ ${fatDelta > 0 ? '+' : ''}${fatDelta}%)`;
    } else {
      bodyFatSourceNote = `Báscula BIA (${latestScan30.day})`;
    }
  } else if (endWeightEntry) {
    const estimated = computeBodyCompositionScan(
      {
        weightKg: endWeightEntry.weightKg,
        waistCm: latestWaist?.cm,
        date: endWeightEntry.date,
        source: 'manual',
      },
      db.profile,
    );
    bodyFatValueText = `${estimated.bodyFatPct.toFixed(1)}%`;
    latestBmiText = estimated.bmi.toFixed(1);
    bodyFatSourceNote = 'Estimación antropométrica (Deurenberg)';
  }

  // --- 3. Adherence & Habits (30d) ---
  const workouts30 = (db.workouts ?? []).filter((w) =>
    Boolean(inRange(w.completedAt)),
  );
  const hiit30 = (db.hiitSessions ?? []).filter((h) =>
    Boolean(inRange(h.date, h.completedAt)),
  );
  const cardio30 = (db.cardioSessions ?? []).filter((c) =>
    Boolean(inRange(c.date, c.completedAt)),
  );

  const totalSessions30 = workouts30.length + hiit30.length + cardio30.length;
  const totalStrengthVolumeKg = workouts30.reduce(
    (sum, w) => sum + (w.totalVolumeKg || 0),
    0,
  );
  const totalCardioKm = cardio30.reduce((sum, c) => sum + (c.distanceKm || 0), 0);

  // Nutrition (daily average across logged days in 30d)
  const foods30 = (db.foodLogs ?? []).filter((f) =>
    Boolean(inRange(f.date, f.createdAt)),
  );
  const foodByDay = new Map<
    string,
    { kcal: number; proteinG: number; carbsG: number; fatG: number }
  >();
  for (const f of foods30) {
    const day = inRange(f.date, f.createdAt);
    if (!day) continue;
    const acc = foodByDay.get(day) ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    acc.kcal += Number(f.calories) || 0;
    acc.proteinG += Number(f.proteinG) || 0;
    acc.carbsG += Number(f.carbsG) || 0;
    acc.fatG += Number(f.fatG) || 0;
    foodByDay.set(day, acc);
  }
  const nutritionDaysCount = foodByDay.size;
  const nutritionTotals = Array.from(foodByDay.values()).reduce(
    (acc, d) => ({
      kcal: acc.kcal + d.kcal,
      proteinG: acc.proteinG + d.proteinG,
      carbsG: acc.carbsG + d.carbsG,
      fatG: acc.fatG + d.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  const avgDailyKcal =
    nutritionDaysCount > 0 ? Math.round(nutritionTotals.kcal / nutritionDaysCount) : null;
  const avgDailyProteinG =
    nutritionDaysCount > 0
      ? Math.round(nutritionTotals.proteinG / nutritionDaysCount)
      : null;
  const avgDailyCarbsG =
    nutritionDaysCount > 0 ? Math.round(nutritionTotals.carbsG / nutritionDaysCount) : null;
  const avgDailyFatG =
    nutritionDaysCount > 0 ? Math.round(nutritionTotals.fatG / nutritionDaysCount) : null;

  // Hydration (daily average across days > 0 in 30d)
  const hydrationDayMap = new Map<string, number>();
  for (const [date, ml] of Object.entries(db.hydrationByDate ?? {})) {
    if (date >= startIso && date <= todayIso && typeof ml === 'number' && ml > 0) {
      hydrationDayMap.set(date, ml);
    }
  }
  for (const [date, logs] of Object.entries(db.hydrationLogsByDate ?? {})) {
    if (date < startIso || date > todayIso || hydrationDayMap.has(date)) continue;
    const sum = (logs ?? []).reduce((acc, item) => acc + (item.amountMl || 0), 0);
    if (sum > 0) hydrationDayMap.set(date, sum);
  }
  const hydrationDaysCount = hydrationDayMap.size;
  const avgHydrationMl =
    hydrationDaysCount > 0
      ? Array.from(hydrationDayMap.values()).reduce((a, b) => a + b, 0) /
        hydrationDaysCount
      : null;

  // Sleep (sleepSessions in 30d, with fallback to readinessByDate sleep entries)
  const sleep30 = (db.sleepSessions ?? [])
    .map((s) => ({ s, day: inRange(s.date, s.wakeUpAt) }))
    .filter((item): item is { s: NonNullable<AppDatabase['sleepSessions']>[number]; day: string } =>
      Boolean(item.day),
    )
    .sort((a, b) => a.day.localeCompare(b.day));

  const sleepDatesIn30 = new Set(sleep30.map((x) => x.day));
  const sleepDurationsMin: number[] = sleep30.map((x) => x.s.durationMinutes);
  const sleepQualitiesPct: number[] = sleep30.map((x) => x.s.sleepQualityPct);

  for (const r of readiness30) {
    if (sleepDatesIn30.has(r.date)) continue;
    if (typeof r.entry.sleepHours === 'number' && r.entry.sleepHours > 0) {
      sleepDurationsMin.push(Math.round(r.entry.sleepHours * 60));
      if (typeof r.entry.sleepQuality === 'number' && r.entry.sleepQuality > 0) {
        sleepQualitiesPct.push(Math.min(100, Math.round(r.entry.sleepQuality * 20)));
      }
    }
  }
  const avgSleepMinutes =
    sleepDurationsMin.length > 0
      ? sleepDurationsMin.reduce((a, b) => a + b, 0) / sleepDurationsMin.length
      : null;
  const avgSleepQualityPct =
    sleepQualitiesPct.length > 0
      ? Math.round(
          sleepQualitiesPct.reduce((a, b) => a + b, 0) / sleepQualitiesPct.length,
        )
      : null;

  const recordCount =
    bp30.length +
    pulse30.length +
    weights30.length +
    scansInRange30.length +
    measurements30.length +
    workouts30.length +
    hiit30.length +
    cardio30.length +
    foods30.length +
    hydrationDaysCount +
    sleep30.length +
    readiness30.length;

  const issuedAtStr = new Date().toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const bpBadge = bpMeanClass ? getBpBadgeStyle(bpMeanClass.category) : null;

  const recentBpRowsHtml =
    bp30.length > 0
      ? [...bp30]
          .reverse()
          .slice(0, 8)
          .map((item) => {
            const cls = classifyBloodPressure(item.bp.systolic, item.bp.diastolic);
            const badge = getBpBadgeStyle(cls.category);
            return `
              <tr>
                <td class="mono">${escapeHtml(item.day)}</td>
                <td class="mono bold">${escapeHtml(`${item.bp.systolic}/${item.bp.diastolic} mmHg`)}</td>
                <td class="mono">${typeof item.bp.pulseBpm === 'number' && item.bp.pulseBpm > 0 ? `${item.bp.pulseBpm} BPM` : '—'}</td>
                <td>
                  <span class="badge" style="background:${badge.bg};color:${badge.color};border-color:${badge.border};">
                    ${escapeHtml(cls.category)}
                  </span>
                </td>
              </tr>`;
          })
          .join('')
      : `<tr><td colspan="4" class="empty-cell">No se registraron tomas de presión arterial en los últimos 30 días.</td></tr>`;

  const netDeltaText =
    netWeightDeltaDisplay === null
      ? 'N/D'
      : `${netWeightDeltaDisplay > 0 ? '+' : ''}${netWeightDeltaDisplay.toFixed(1)} ${weightUnit}`;

  const waistDeltaText =
    firstWaist && latestWaist && waistPoints30.length >= 2
      ? (() => {
          const diffCm = Number((latestWaist.cm - firstWaist.cm).toFixed(1));
          const sign = diffCm > 0 ? '+' : '';
          return `Inicio: ${formatWaist(firstWaist.cm, waistUnit)} · Cambio: ${sign}${formatWaist(diffCm, waistUnit)}`;
        })()
      : latestWaist
        ? `Registrada el ${latestWaist.date}`
        : 'Sin mediciones de cintura en el período';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reporte Clínico Mensual (30d) — ${escapeHtml(db.profile.name || 'Atleta')}</title>
  <style>
    @page {
      size: A4;
      margin: 14mm;
    }
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #FFFFFF;
      color: #0F172A;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page-wrap {
      max-width: 820px;
      margin: 0 auto;
      padding: 20px 24px 28px;
      background: #FFFFFF;
    }
    .print-toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid #E2E8F0;
    }
    .btn-print {
      background: #0F172A;
      color: #FFFFFF;
      border: none;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .header {
      border-bottom: 2px solid #0F172A;
      padding-bottom: 14px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .brand {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #334155;
      margin-bottom: 4px;
    }
    h1 {
      margin: 0;
      font-size: 21px;
      line-height: 1.2;
      font-weight: 800;
      color: #0F172A;
    }
    .subtitle {
      margin: 4px 0 0;
      font-size: 11.5px;
      color: #475569;
    }
    .meta-box {
      text-align: right;
      font-size: 11px;
      color: #334155;
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      padding: 8px 12px;
      min-width: 225px;
    }
    .meta-box strong {
      color: #0F172A;
    }
    .patient-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 16px;
      padding: 10px 12px;
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
    }
    .patient-item .label {
      display: block;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748B;
      font-weight: 700;
    }
    .patient-item .val {
      display: block;
      margin-top: 2px;
      font-size: 13px;
      font-weight: 700;
      color: #0F172A;
    }
    section.card {
      border: 1px solid #CBD5E1;
      border-radius: 10px;
      padding: 13px 15px;
      margin-bottom: 14px;
      background: #FFFFFF;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #E2E8F0;
      padding-bottom: 6px;
      margin-bottom: 10px;
    }
    .section-head h2 {
      margin: 0;
      font-size: 13.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #0F172A;
    }
    .section-tag {
      font-size: 10.5px;
      color: #475569;
      font-weight: 600;
    }
    .kpi-grid-3 {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 10px;
    }
    .kpi-grid-4 {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .kpi-box {
      border: 1px solid #E2E8F0;
      background: #F8FAFC;
      border-radius: 8px;
      padding: 9px 10px;
    }
    .kpi-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #475569;
    }
    .kpi-value {
      margin-top: 3px;
      font-size: 16px;
      font-weight: 800;
      color: #0F172A;
      font-variant-numeric: tabular-nums;
    }
    .kpi-sub {
      margin-top: 3px;
      font-size: 10.5px;
      color: #475569;
    }
    .badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      border: 1px solid #CBD5E1;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      font-size: 11px;
    }
    th, td {
      border-bottom: 1px solid #E2E8F0;
      padding: 6px 8px;
      text-align: left;
    }
    th {
      background: #F1F5F9;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #334155;
      font-weight: 700;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-variant-numeric: tabular-nums;
    }
    .bold {
      font-weight: 700;
    }
    .empty-cell {
      text-align: center;
      color: #64748B;
      padding: 10px;
      font-style: italic;
    }
    .ref-note {
      margin-top: 8px;
      padding: 7px 10px;
      background: #F8FAFC;
      border-left: 3px solid #64748B;
      font-size: 10.5px;
      color: #334155;
    }
    .footer {
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px solid #CBD5E1;
      font-size: 10px;
      color: #64748B;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    @media print {
      .print-toolbar {
        display: none !important;
      }
      .page-wrap {
        padding: 0;
        max-width: 100%;
      }
      section.card {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="page-wrap">
    <div class="print-toolbar">
      <button type="button" class="btn-print" onclick="window.print()">Imprimir / Guardar PDF</button>
    </div>

    <header class="header">
      <div>
        <div class="brand">PulsoFit · Resumen Biomédico de Seguimiento</div>
        <h1>Reporte Clínico Mensual (30 Días)</h1>
        <p class="subtitle">
          Compilado de signos vitales, antropometría y adherencia de hábitos del perfil activo.
        </p>
      </div>
      <div class="meta-box">
        <div><strong>Emisión:</strong> ${escapeHtml(todayIso)} (${escapeHtml(issuedAtStr)})</div>
        <div><strong>Período evaluado:</strong> ${escapeHtml(formatHumanDateEs(startIso))} → ${escapeHtml(formatHumanDateEs(todayIso))}</div>
        <div class="mono"><strong>Rango exacto:</strong> ${escapeHtml(startIso)} a ${escapeHtml(todayIso)} (30 días)</div>
      </div>
    </header>

    <div class="patient-strip">
      <div class="patient-item">
        <span class="label">Nombre completo</span>
        <span class="val">${escapeHtml(db.profile.name || 'Atleta')}</span>
      </div>
      <div class="patient-item">
        <span class="label">Edad</span>
        <span class="val">${db.profile.age ? `${escapeHtml(db.profile.age)} años` : 'N/D'}</span>
      </div>
      <div class="patient-item">
        <span class="label">Sexo</span>
        <span class="val">${escapeHtml(formatSexLabel(db.profile.sex))}</span>
      </div>
      <div class="patient-item">
        <span class="label">Estatura</span>
        <span class="val">${
          db.profile.heightCm
            ? `${escapeHtml(db.profile.heightCm)} cm (${(db.profile.heightCm / 100).toFixed(2)} m)`
            : 'N/D'
        }</span>
      </div>
    </div>

    <!-- 1. SALUD CARDIOVASCULAR Y RECUPERACIÓN -->
    <section class="card">
      <div class="section-head">
        <h2>1. Salud Cardiovascular y Recuperación</h2>
        <span class="section-tag">Perfil: ${escapeHtml(profileLabel)}</span>
      </div>

      <div class="kpi-grid-3">
        <div class="kpi-box">
          <div class="kpi-label">Presión Arterial Promedio</div>
          <div class="kpi-value mono">
            ${
              bpSysStats && bpDiaStats
                ? `${Math.round(bpSysStats.avg)}/${Math.round(bpDiaStats.avg)} mmHg`
                : 'Sin datos'
            }
          </div>
          <div class="kpi-sub">
            ${
              bpSysStats && bpDiaStats && bpMeanClass && bpBadge
                ? `<span class="badge" style="background:${bpBadge.bg};color:${bpBadge.color};border-color:${bpBadge.border};">${escapeHtml(bpMeanClass.category)}</span> · Mín ${Math.round(bpSysStats.min)}/${Math.round(bpDiaStats.min)} · Máx ${Math.round(bpSysStats.max)}/${Math.round(bpDiaStats.max)} (${bp30.length} tomas)`
                : '0 tomas registradas en 30d'
            }
          </div>
        </div>

        <div class="kpi-box">
          <div class="kpi-label">Frecuencia Cardíaca en Reposo</div>
          <div class="kpi-value mono">
            ${bpmStats ? `${Math.round(bpmStats.avg)} BPM` : 'Sin datos'}
          </div>
          <div class="kpi-sub">
            ${
              bpmStats
                ? `Mín ${Math.round(bpmStats.min)} BPM · Máx ${Math.round(bpmStats.max)} BPM (${bpmStats.count} lecturas)`
                : 'Sin lecturas PPG ni pulso basal en 30d'
            }
          </div>
        </div>

        <div class="kpi-box">
          <div class="kpi-label">Variabilidad Cardíaca (HRV RMSSD)</div>
          <div class="kpi-value mono">
            ${hrvStats ? `${Math.round(hrvStats.avg)} ms` : 'Sin datos'}
          </div>
          <div class="kpi-sub">
            ${
              hrvStats
                ? `Mín ${Math.round(hrvStats.min)} ms · Máx ${Math.round(hrvStats.max)} ms (${hrvStats.count} lecturas)`
                : 'Sin mediciones RMSSD en 30d'
            }
          </div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Lectura PA</th>
            <th>Pulso</th>
            <th>Clasificación clínica</th>
          </tr>
        </thead>
        <tbody>
          ${recentBpRowsHtml}
        </tbody>
      </table>

      <div class="ref-note">
        <strong>Referencia clínica de presión arterial (AHA/ACC):</strong> Normal (&lt;120 / &lt;80 mmHg) · Elevada (120–129 / &lt;80) · Alta Nivel 1 (130–139 o 80–89) · Alta Nivel 2 (&ge;140 o &ge;90) · Baja (&lt;90 o &lt;60).
      </div>
    </section>

    <!-- 2. ANTROPOMETRÍA Y COMPOSICIÓN CORPORAL -->
    <section class="card">
      <div class="section-head">
        <h2>2. Antropometría y Composición Corporal</h2>
        <span class="section-tag">Unidades activas: ${escapeHtml(weightUnit.toUpperCase())} / ${escapeHtml(waistUnit.toUpperCase())}</span>
      </div>

      <div class="kpi-grid-4">
        <div class="kpi-box">
          <div class="kpi-label">Peso Inicial vs Actual (30d)</div>
          <div class="kpi-value mono">
            ${
              startWeightDisplay !== null && endWeightDisplay !== null
                ? `${startWeightDisplay.toFixed(1)} → ${endWeightDisplay.toFixed(1)} ${escapeHtml(weightUnit)}`
                : 'Sin pesajes'
            }
          </div>
          <div class="kpi-sub">
            ${
              startWeightEntry && endWeightEntry
                ? `Cambio neto: <strong>${escapeHtml(netDeltaText)}</strong> (${weights30.length} días reg.)`
                : 'Sin registros de peso en los últimos 30 días'
            }
          </div>
        </div>

        <div class="kpi-box">
          <div class="kpi-label">Media Móvil de Peso (30d)</div>
          <div class="kpi-value mono">
            ${
              movingAvg30dDisplay !== null
                ? `${movingAvg30dDisplay.toFixed(1)} ${escapeHtml(weightUnit)}`
                : 'N/D'
            }
          </div>
          <div class="kpi-sub">
            ${
              endWeightEntry
                ? `Meta perfil: ${escapeHtml(formatWeight(db.profile.targetWeightKg, weightUnit, 1))}`
                : 'Requiere al menos 1 pesaje en 30d'
            }
          </div>
        </div>

        <div class="kpi-box">
          <div class="kpi-label">Circunferencia de Cintura</div>
          <div class="kpi-value mono">
            ${latestWaist ? escapeHtml(formatWaist(latestWaist.cm, waistUnit)) : 'Sin datos'}
          </div>
          <div class="kpi-sub">
            ${escapeHtml(waistDeltaText)}
          </div>
        </div>

        <div class="kpi-box">
          <div class="kpi-label">% Grasa Corporal Estimado</div>
          <div class="kpi-value mono">${escapeHtml(bodyFatValueText)}</div>
          <div class="kpi-sub">
            ${escapeHtml(bodyFatSourceNote)} · IMC ${escapeHtml(latestBmiText)}${latestMuscleText !== 'N/D' ? ` · Músculo ${escapeHtml(latestMuscleText)}` : ''}
          </div>
        </div>
      </div>
    </section>

    <!-- 3. ADHERENCIA Y HÁBITOS -->
    <section class="card">
      <div class="section-head">
        <h2>3. Adherencia y Hábitos (Últimos 30 Días)</h2>
        <span class="section-tag">Ventana móvil de 30 días naturales</span>
      </div>

      <div class="kpi-grid-4">
        <div class="kpi-box">
          <div class="kpi-label">Entrenamientos Completados</div>
          <div class="kpi-value mono">${totalSessions30} sesiones</div>
          <div class="kpi-sub">
            ${workouts30.length} fuerza · ${hiit30.length} HIIT · ${cardio30.length} cardio
            ${totalStrengthVolumeKg > 0 ? `<br />Volumen: ${escapeHtml(formatVolume(totalStrengthVolumeKg, weightUnit))}` : ''}
            ${totalCardioKm > 0 ? `<br />Distancia: ${escapeHtml(formatDistance(totalCardioKm, distanceUnit, 1))}` : ''}
          </div>
        </div>

        <div class="kpi-box">
          <div class="kpi-label">Nutrición Promedio Diaria</div>
          <div class="kpi-value mono">
            ${avgDailyKcal !== null ? `${avgDailyKcal} kcal/d` : 'Sin datos'}
          </div>
          <div class="kpi-sub">
            ${
              avgDailyProteinG !== null
                ? `Proteína: <strong>${avgDailyProteinG} g/d</strong> · C ${avgDailyCarbsG ?? 0}g · G ${avgDailyFatG ?? 0}g<br />(${nutritionDaysCount}/30 días registrados)`
                : '0 días con comidas registradas'
            }
          </div>
        </div>

        <div class="kpi-box">
          <div class="kpi-label">Hidratación Promedio Diaria</div>
          <div class="kpi-value mono">
            ${
              avgHydrationMl !== null
                ? escapeHtml(formatLiquid(avgHydrationMl, liquidUnit))
                : 'Sin datos'
            }
          </div>
          <div class="kpi-sub">
            ${
              hydrationDaysCount > 0
                ? `${hydrationDaysCount}/30 días con ingesta hídrica`
                : '0 días con hidratación registrada'
            }
          </div>
        </div>

        <div class="kpi-box">
          <div class="kpi-label">Sueño y Descanso Promedio</div>
          <div class="kpi-value mono">
            ${
              avgSleepMinutes !== null
                ? escapeHtml(formatDurationMinutesLabel(avgSleepMinutes))
                : 'Sin datos'
            }
          </div>
          <div class="kpi-sub">
            ${
              avgSleepQualityPct !== null
                ? `Calidad media: <strong>${avgSleepQualityPct}%</strong> (${sleepDurationsMin.length}/30 noches)`
                : sleepDurationsMin.length > 0
                  ? `${sleepDurationsMin.length}/30 noches registradas`
                  : '0 noches registradas en 30d'
            }
          </div>
        </div>
      </div>
    </section>

    <footer class="footer">
      <span>Generado localmente por PulsoFit a partir del almacenamiento IndexedDB del dispositivo.</span>
      <span>Uso informativo y de seguimiento personal; no sustituye valoración médica diagnóstica.</span>
    </footer>
  </div>
</body>
</html>`;

  return { html, recordCount };
}

function triggerHiddenIframePrint(html: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.className = 'fixed right-0 bottom-0 w-0 h-0 border-0 opacity-0 pointer-events-none';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return false;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove();
    }, 1500);
  };
  win.addEventListener('afterprint', cleanup, { once: true });

  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      // Fallback cleanup below
    } finally {
      window.setTimeout(() => {
        if (iframe.parentNode) iframe.remove();
      }, 60_000);
    }
  }, 280);

  return true;
}

export async function exportMonthlyClinicalReport(
  profileId: string,
): Promise<MonthlyClinicalReportResult> {
  // Open print window synchronously BEFORE awaiting async storage queries
  // so Android Chrome PWA does not classify it as a blocked popup.
  let printWin: Window | null = null;
  if (typeof window !== 'undefined') {
    try {
      printWin = window.open('', '_blank');
      if (printWin) {
        printWin.document.open();
        printWin.document.write(
          '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" /><title>PulsoFit — Generando Reporte Clínico...</title></head><body style="font-family:system-ui,-apple-system,sans-serif;padding:32px;color:#0F172A;background:#FFFFFF;">Compilando Reporte Clínico Mensual (30 días)...</body></html>',
        );
        printWin.document.close();
      }
    } catch {
      printWin = null;
    }
  }

  const todayIso = getTodayIsoDate();
  const startIso = shiftIsoDate(todayIso, -29);

  await flushPendingAppDatabaseSaves().catch(() => {});

  const [db, registry] = await Promise.all([
    loadAppDatabase(profileId),
    loadProfileRegistry(),
  ]);

  const slotLabel =
    registry.find((slot) => slot.id === profileId)?.label ||
    db.profile.name ||
    'Principal';

  const { html, recordCount } = buildMonthlyClinicalReportHtml({
    db,
    profileLabel: slotLabel,
    startIso,
    todayIso,
  });

  if (recordCount === 0) {
    if (printWin && !printWin.closed) {
      try {
        printWin.close();
      } catch {
        // Ignore close restrictions
      }
    }
    return {
      ok: false,
      reason: 'no_data',
      message: `No hay registros en los últimos 30 días (${startIso} al ${todayIso}) para el perfil "${slotLabel}".`,
      rangeStart: startIso,
      rangeEnd: todayIso,
      recordCount: 0,
    };
  }

  if (printWin && !printWin.closed) {
    try {
      printWin.document.open();
      printWin.document.write(html);
      printWin.document.close();
      window.setTimeout(() => {
        try {
          if (printWin && !printWin.closed) {
            printWin.focus();
            printWin.print();
          }
        } catch {
          // User can still tap the toolbar Print button inside the opened window
        }
      }, 260);
      return {
        ok: true,
        method: 'window',
        rangeStart: startIso,
        rangeEnd: todayIso,
        recordCount,
      };
    } catch {
      try {
        printWin.close();
      } catch {
        // Ignore
      }
    }
  }

  const iframeTriggered = triggerHiddenIframePrint(html);
  if (!iframeTriggered) {
    return {
      ok: false,
      reason: 'print_blocked',
      message:
        'El navegador bloqueó la vista de impresión automática. Permite ventanas emergentes o intenta desde otro navegador.',
      rangeStart: startIso,
      rangeEnd: todayIso,
      recordCount,
    };
  }

  return {
    ok: true,
    method: 'iframe',
    rangeStart: startIso,
    rangeEnd: todayIso,
    recordCount,
  };
}

