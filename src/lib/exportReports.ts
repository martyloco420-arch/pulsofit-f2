import { getTodayIsoDate } from './storage';
import {
  formatDistance,
  formatVolume,
  formatWeight,
  getDistanceUnit,
  getWeightUnit,
  kgToDisplayWeight,
  kmToDisplayDistance,
} from './units';
import type { AppDatabase } from '../types/fitness';

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
