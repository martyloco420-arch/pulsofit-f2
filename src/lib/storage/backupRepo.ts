import type { AppDatabase, CoachPersonality } from '../../types/fitness';
import { createInitialMuscleFatigue } from '../recovery';
import {
  type BackupPreviewCounts,
  CURRENT_SCHEMA_VERSION,
  type CategorySummaryItem,
  type CleanupCategoryId,
  DB_NAME,
  DEFAULT_PROFILE_SLOTS,
  type DataModuleRecordType,
  type DayRecordBreakdown,
  LEGACY_DB_NAME,
  type RecordDeleteTarget,
  clearAllPendingBatches,
  clearPulsoFitStoresIfOpen,
  deleteIndexedDbSafe,
  getLocalDateKey,
  getTodayIsoDate,
  loadAppDatabaseWithNormalizer,
  resetAllHydrationLocks,
  resolveSchemaVersion,
  saveAppDatabase,
} from './dbCore';
import {
  createDefaultProfile,
  normalizeCoachChatHistory,
  normalizeManualActivityMap,
  normalizeReadinessMap,
  normalizeScheduledRestDates,
  normalizeUserProfile,
  recalculateLatestWeightAndAdaptiveNutrition,
  saveProfileRegistry,
  setActiveProfileId,
} from './profileRepo';
import {
  countWorkoutDomainByDate,
  deleteCardioRecord,
  deleteHiitRecord,
  deleteShoeRecord,
  deleteWorkoutRecord,
  filterWorkoutDomainByDate,
  normalizeWorkoutDomain,
} from './workoutRepo';
import {
  countBiometricsDomainByDate,
  deleteBloodPressureRecord,
  deleteMeasurementRecord,
  deleteProgressPhotoRecord,
  deletePulseRecord,
  deleteSleepRecord,
  filterBiometricsDomainByDate,
  normalizeBiometricsDomain,
  removeBodyScanAndSyncWeights,
  removeBodyWeightRecord,
} from './biometricsRepo';
import {
  countNutritionDomainByDate,
  createDefaultHydrationSettings,
  deleteFastingRecord,
  deleteFoodRecord,
  deleteHydrationLogRecord,
  filterNutritionDomainByDate,
  normalizeNutritionDomain,
} from './nutritionRepo';

export function createInitialDatabase(profileName = 'Atleta'): AppDatabase {
  const today = getTodayIsoDate();
  const nowIso = new Date().toISOString();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: nowIso,
    profile: createDefaultProfile(profileName),
    muscleFatigue: createInitialMuscleFatigue(nowIso),
    activeWorkout: null,
    workouts: [],
    workoutTemplates: [],
    hiitSessions: [],
    cardioSessions: [],
    shoes: [],
    sleepSessions: [],
    pulseHrvRecords: [],
    bloodPressureRecords: [],
    bodyWeights: [
      {
        id: `bw_${Date.now()}`,
        date: today,
        weightKg: 75,
      },
    ],
    bodyScans: [],
    bodyMeasurements: [],
    progressPhotos: [],
    readinessByDate: {},
    foodLogs: [],
    favoriteMeals: [],
    weeklyMealPlan: null,
    hydrationByDate: {},
    hydrationLogsByDate: {},
    hydrationSettings: createDefaultHydrationSettings(),
    electrolytesByDate: {},
    adaptiveNutrition: null,
    activeFast: null,
    fastingHistory: [],
    manualActivityByDate: {},
    coachPersonality: 'sargento',
    coachChatHistory: [],
    scheduledRestDates: [],
  };
}

export function normalizeDatabase(raw: Partial<AppDatabase>): AppDatabase {
  const base = createInitialDatabase();
  const nowIso = new Date().toISOString();

  const normalizedProfile = normalizeUserProfile(raw.profile, base.profile);
  const workoutDomain = normalizeWorkoutDomain(raw, nowIso);
  const biometricsDomain = normalizeBiometricsDomain(
    raw,
    base.bodyWeights,
    base.profile.weightKg,
    nowIso,
  );
  const nutritionDomain = normalizeNutritionDomain(raw, nowIso);

  return {
    schemaVersion: resolveSchemaVersion(raw),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso,
    profile: normalizedProfile,
    ...workoutDomain,
    ...biometricsDomain,
    ...nutritionDomain,
    readinessByDate: normalizeReadinessMap(raw.readinessByDate, nowIso),
    manualActivityByDate: normalizeManualActivityMap(raw.manualActivityByDate, nowIso),
    coachPersonality: (
      raw.coachPersonality === 'motivador' ? 'motivador' : 'sargento'
    ) as CoachPersonality,
    coachChatHistory: normalizeCoachChatHistory(raw.coachChatHistory, nowIso),
    scheduledRestDates: normalizeScheduledRestDates(raw.scheduledRestDates),
  };
}

export async function loadAppDatabase(profileId = 'main'): Promise<AppDatabase> {
  return loadAppDatabaseWithNormalizer(
    profileId,
    normalizeDatabase,
    createInitialDatabase,
  );
}

const LAST_JSON_BACKUP_KEY = 'pulsofit_last_json_backup_at';

export function getLastJsonBackupAt(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = window.localStorage.getItem(LAST_JSON_BACKUP_KEY);
    if (!val) return null;
    const ms = Date.parse(val);
    return Number.isFinite(ms) ? val : null;
  } catch {
    return null;
  }
}

export function getBackupAgeInfo(): {
  lastIso: string | null;
  daysSince: number | null;
  isOverdue: boolean;
} {
  const lastIso = getLastJsonBackupAt();
  if (!lastIso) {
    return { lastIso: null, daysSince: null, isOverdue: true };
  }
  const diffMs = Math.max(0, Date.now() - Date.parse(lastIso));
  const daysSince = Math.floor(diffMs / 86400000);
  return {
    lastIso,
    daysSince,
    isOverdue: daysSince >= 7,
  };
}

export function summarizeBackupCounts(db: AppDatabase): BackupPreviewCounts {
  return {
    profileName: db.profile?.name || 'Atleta',
    workouts: (db.workouts ?? []).length,
    cardioSessions: (db.cardioSessions ?? []).length,
    hiitSessions: (db.hiitSessions ?? []).length,
    bodyScans: (db.bodyScans ?? []).length,
    bodyWeights: (db.bodyWeights ?? []).length,
    foodLogs: (db.foodLogs ?? []).length,
    sleepSessions: (db.sleepSessions ?? []).length,
    pulseHrvRecords: (db.pulseHrvRecords ?? []).length,
    bloodPressureRecords: (db.bloodPressureRecords ?? []).length,
    hydrationDays: Object.values(db.hydrationByDate ?? {}).filter((v) => v > 0).length,
    manualActivityDays: Object.keys(db.manualActivityByDate ?? {}).length,
  };
}

export function exportDatabaseToJson(
  data: AppDatabase,
  profileLabel = 'Principal',
): void {
  const exportedAt = new Date().toISOString();
  const exportPayload = {
    app: 'PulsoFit',
    profileSlot: profileLabel,
    exportedAt,
    ...data,
  };
  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const safeLabel = profileLabel.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `pulsofit-respaldo-${safeLabel}-${getTodayIsoDate()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LAST_JSON_BACKUP_KEY, exportedAt);
    } catch {
      // Ignore storage quota errors
    }
  }
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportDatabaseToCsv(
  data: AppDatabase,
  profileLabel = 'Principal',
): void {
  const rows: (string | number)[][] = [
    [
      'Perfil',
      'Modulo',
      'Fecha',
      'Titulo_o_Concepto',
      'Detalle',
      'Valor_1',
      'Unidad_1',
      'Valor_2',
      'Unidad_2',
      'Calorias_kcal',
      'Notas_o_Extras',
    ],
  ];

  // 1. Fuerza y Ligas
  for (const w of data.workouts) {
    const dateIso = getLocalDateKey(w.completedAt);
    for (const ex of w.exercises) {
      const doneSets = ex.sets.filter((s) => s.completed);
      for (let i = 0; i < doneSets.length; i += 1) {
        const s = doneSets[i];
        rows.push([
          profileLabel,
          'Fuerza / Ligas',
          dateIso,
          w.title,
          `${ex.name} (Serie ${i + 1})`,
          s.weightKg,
          'kg',
          s.reps,
          'reps',
          '',
          s.bandLabel
            ? `${s.bandLabel}${s.rpe ? ` | RPE ${s.rpe}` : ''}`
            : s.rpe
              ? `RPE ${s.rpe}`
              : '',
        ]);
      }
    }
  }

  // 2. Cardio / Caminatas
  for (const c of data.cardioSessions ?? []) {
    rows.push([
      profileLabel,
      'Cardio / Caminata',
      c.date,
      c.activityType,
      c.shoeName || 'Sin tenis asignado',
      c.distanceKm,
      'km',
      Math.round(c.durationSec / 60),
      'min',
      c.caloriesBurned,
      `Ritmo prom: ${c.avgPaceSecPerKm} s/km | Splits: ${c.splits.length}`,
    ]);
  }

  // 3. Báscula y Composición Corporal
  for (const b of data.bodyScans) {
    rows.push([
      profileLabel,
      'Bascula BIA',
      b.date,
      `Pesaje (${b.source})`,
      `IMC ${b.bmi} | Grasa visceral ${b.visceralFatLevel}`,
      b.weightKg,
      'kg',
      b.bodyFatPct,
      '% grasa',
      b.bmrKcal,
      `Musculo total ${b.totalMusclePct}% | Agua ${b.bodyWaterPct}% | Masa magra ${b.leanMassKg} kg${
        typeof b.waistCm === 'number' ? ` | Cintura ${b.waistCm} cm` : ''
      }`,
    ]);
  }

  // 4. Registro simple de peso corporal (sin escaneo BIA)
  for (const bw of data.bodyWeights) {
    rows.push([
      profileLabel,
      'Peso Corporal',
      bw.date,
      'Peso en ayunas',
      'Registro diario',
      bw.weightKg,
      'kg',
      '',
      '',
      '',
      '',
    ]);
  }

  // 5. Nutrición
  for (const f of data.foodLogs) {
    rows.push([
      profileLabel,
      'Nutricion',
      f.date,
      f.mealType,
      f.name,
      f.proteinG,
      'g proteina',
      f.carbsG,
      'g carbs',
      f.calories,
      `Grasas ${f.fatG} g`,
    ]);
  }

  // 6. Hidratación diaria
  for (const [date, ml] of Object.entries(data.hydrationByDate ?? {})) {
    if (ml > 0) {
      rows.push([
        profileLabel,
        'Hidratacion',
        date,
        'Agua diaria',
        'Total del día',
        ml,
        'ml',
        '',
        '',
        '',
        '',
      ]);
    }
  }

  // 7. Sueño y Descanso
  for (const s of data.sleepSessions ?? []) {
    rows.push([
      profileLabel,
      'Sueno y Descanso',
      s.date,
      `Calidad ${s.sleepQualityPct}%`,
      `Profundo ${s.deepSleepMin}m | Ligero/REM ${s.lightRemSleepMin}m | Despierto ${s.awakeMin}m`,
      Math.round((s.durationMinutes / 60) * 100) / 100,
      'horas',
      s.sleepQualityPct,
      '% calidad',
      '',
      `Ronquidos: ${s.snoreEventsCount} | Ruidos: ${s.noiseEventsCount} | Alarma inteligente: ${
        s.triggeredBySmartAlarm ? 'Si' : 'Manual'
      }`,
    ]);
  }

  // 8. Pulso PPG y HRV
  for (const p of data.pulseHrvRecords ?? []) {
    rows.push([
      profileLabel,
      'Pulso y HRV',
      p.date,
      `Pulso ${p.bpm} BPM`,
      `Fuente: ${p.source === 'ppg_camara' ? 'Camara PPG' : 'Manual'}`,
      p.bpm,
      'BPM',
      p.hrvRmssdMs,
      'ms RMSSD',
      '',
      `Calidad senal: ${p.signalQualityPct}% | Recuperacion: ${p.recoveryImpactScore}/100`,
    ]);
  }

  // 9. Presion Arterial
  for (const bp of data.bloodPressureRecords ?? []) {
    rows.push([
      profileLabel,
      'Presion Arterial',
      bp.date,
      `Toma ${bp.systolic}/${bp.diastolic}`,
      `Rango: ${bp.category}`,
      bp.systolic,
      'mmHg sis',
      bp.diastolic,
      'mmHg dia',
      '',
      bp.pulseBpm ? `Pulso ${bp.pulseBpm} BPM` : '',
    ]);
  }

  // UTF-8 BOM for proper accent handling in Excel
  const csvContent =
    '\uFEFF' + rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const safeLabel = profileLabel.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `pulsofit-historial-${safeLabel}-${getTodayIsoDate()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseAndValidateBackupJson(jsonText: string): AppDatabase {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('El archivo no contiene un formato JSON válido.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Estructura de respaldo inválida.');
  }

  const candidate = parsed as Partial<AppDatabase>;
  if (!candidate.profile || typeof candidate.profile !== 'object') {
    throw new Error('El respaldo no contiene datos de perfil válidos.');
  }

  if (
    typeof candidate.profile.weightKg !== 'number' ||
    typeof candidate.profile.heightCm !== 'number'
  ) {
    throw new Error('Faltan medidas corporales requeridas en el respaldo.');
  }

  return normalizeDatabase(candidate);
}

export function deleteModuleRecordInDb(
  db: AppDatabase,
  moduleType: DataModuleRecordType,
  target: RecordDeleteTarget | string,
): { nextDb: AppDatabase; deletedPhotoIds: string[]; changed: boolean } {
  const normalizedTarget: RecordDeleteTarget =
    typeof target === 'string' ? { id: target } : target;

  switch (moduleType) {
    case 'workouts': {
      const res = deleteWorkoutRecord(db, normalizedTarget);
      return { ...res, deletedPhotoIds: [] };
    }
    case 'hiit': {
      const res = deleteHiitRecord(db, normalizedTarget);
      return { ...res, deletedPhotoIds: [] };
    }
    case 'cardio': {
      const res = deleteCardioRecord(db, normalizedTarget);
      return { ...res, deletedPhotoIds: [] };
    }
    case 'shoes': {
      const res = deleteShoeRecord(db, normalizedTarget);
      return { ...res, deletedPhotoIds: [] };
    }
    case 'body_scans': {
      const res = removeBodyScanAndSyncWeights(db, normalizedTarget);
      if (!res.changed) return { nextDb: db, deletedPhotoIds: [], changed: false };
      return {
        nextDb: recalculateLatestWeightAndAdaptiveNutrition(
          db,
          res.nextScans,
          res.nextWeights,
        ),
        deletedPhotoIds: [],
        changed: true,
      };
    }
    case 'body_weights': {
      const res = removeBodyWeightRecord(db, normalizedTarget);
      if (!res.changed) return { nextDb: db, deletedPhotoIds: [], changed: false };
      return {
        nextDb: recalculateLatestWeightAndAdaptiveNutrition(
          db,
          db.bodyScans ?? [],
          res.nextWeights,
        ),
        deletedPhotoIds: [],
        changed: true,
      };
    }
    case 'pulse': {
      const res = deletePulseRecord(db, normalizedTarget);
      return { ...res, deletedPhotoIds: [] };
    }
    case 'blood_pressure': {
      const res = deleteBloodPressureRecord(db, normalizedTarget);
      return { ...res, deletedPhotoIds: [] };
    }
    case 'nutrition': {
      const res = deleteFoodRecord(db, normalizedTarget);
      return { ...res, deletedPhotoIds: [] };
    }
    case 'fasting': {
      const res = deleteFastingRecord(db, normalizedTarget);
      return { ...res, deletedPhotoIds: [] };
    }
    case 'hydration': {
      const res = deleteHydrationLogRecord(db, normalizedTarget);
      return { ...res, deletedPhotoIds: [] };
    }
    case 'sleep': {
      const res = deleteSleepRecord(db, normalizedTarget);
      return { ...res, deletedPhotoIds: [] };
    }
    case 'measurements': {
      const res = deleteMeasurementRecord(db, normalizedTarget);
      return { ...res, deletedPhotoIds: [] };
    }
    case 'photos':
      return deleteProgressPhotoRecord(db, normalizedTarget);
  }
}

export function countRecordsByDate(
  db: AppDatabase,
  dateIso: string,
): DayRecordBreakdown {
  const w = countWorkoutDomainByDate(db, dateIso);
  const b = countBiometricsDomainByDate(db, dateIso);
  const n = countNutritionDomainByDate(db, dateIso);
  const readiness = db.readinessByDate?.[dateIso] ? 1 : 0;
  const manualActivity = db.manualActivityByDate?.[dateIso] ? 1 : 0;

  const totalCount =
    w.workouts +
    w.hiit +
    w.cardio +
    b.bodyScans +
    b.bodyWeights +
    b.pulse +
    b.bloodPressure +
    n.foods +
    n.fasts +
    (n.hydrationLogs > 0 ? n.hydrationLogs : n.hydrationMl > 0 ? 1 : 0) +
    (n.electrolytes > 0 ? 1 : 0) +
    b.sleep +
    b.measurements +
    readiness +
    manualActivity +
    b.progressPhotoIds.length;

  return {
    dateIso,
    workouts: w.workouts,
    hiit: w.hiit,
    cardio: w.cardio,
    bodyScans: b.bodyScans,
    bodyWeights: b.bodyWeights,
    pulse: b.pulse,
    bloodPressure: b.bloodPressure,
    foods: n.foods,
    fasts: n.fasts,
    hydrationMl: n.hydrationMl,
    hydrationLogs: n.hydrationLogs,
    electrolytes: n.electrolytes,
    sleep: b.sleep,
    measurements: b.measurements,
    readiness,
    manualActivity,
    progressPhotoIds: b.progressPhotoIds,
    totalCount,
  };
}

export function deleteDayRecordsInDb(
  db: AppDatabase,
  dateIso: string,
  options?: { includeProgressPhotos?: boolean },
): { nextDb: AppDatabase; deletedPhotoIds: string[] } {
  const includePhotos = options?.includeProgressPhotos ?? false;

  const nextWorkoutSlice = filterWorkoutDomainByDate(db, dateIso);
  const nextBiometricsSlice = filterBiometricsDomainByDate(db, dateIso, includePhotos);
  const nextNutritionSlice = filterNutritionDomainByDate(db, dateIso);

  const nextReadinessByDate = { ...(db.readinessByDate ?? {}) };
  delete nextReadinessByDate[dateIso];
  const nextManualActivity = { ...(db.manualActivityByDate ?? {}) };
  delete nextManualActivity[dateIso];

  const baseUpdated: AppDatabase = {
    ...db,
    ...nextWorkoutSlice,
    ...nextNutritionSlice,
    pulseHrvRecords: nextBiometricsSlice.pulseHrvRecords,
    bloodPressureRecords: nextBiometricsSlice.bloodPressureRecords,
    sleepSessions: nextBiometricsSlice.sleepSessions,
    bodyMeasurements: nextBiometricsSlice.bodyMeasurements,
    progressPhotos: nextBiometricsSlice.progressPhotos,
    readinessByDate: nextReadinessByDate,
    manualActivityByDate: nextManualActivity,
    scheduledRestDates: (db.scheduledRestDates ?? []).filter((d) => d !== dateIso),
  };

  return {
    nextDb: recalculateLatestWeightAndAdaptiveNutrition(
      baseUpdated,
      nextBiometricsSlice.nextScans,
      nextBiometricsSlice.nextWeights,
    ),
    deletedPhotoIds: nextBiometricsSlice.deletedPhotoIds,
  };
}

export function summarizeCategoryCounts(db: AppDatabase): CategorySummaryItem[] {
  const hydrationLogsTotal = Object.values(db.hydrationLogsByDate ?? {}).reduce(
    (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
    0,
  );
  const hydrationDaysCount = Object.values(db.hydrationByDate ?? {}).filter(
    (v) => v > 0,
  ).length;

  return [
    {
      category: 'workouts',
      label: 'Entrenamientos de Fuerza',
      description: 'Sesiones, series, RPE y recalibración de fatiga muscular',
      count: (db.workouts ?? []).length,
    },
    {
      category: 'hiit',
      label: 'Sesiones HIIT / Tabata',
      description: 'Circuitos de intervalos completados',
      count: (db.hiitSessions ?? []).length,
    },
    {
      category: 'cardio',
      label: 'Cardio y Rutas GPS',
      description: 'Caminatas, carreras, ciclismo y parciales GPS',
      count: (db.cardioSessions ?? []).length,
    },
    {
      category: 'body_composition',
      label: 'Báscula y Pesajes',
      description: 'Escaneos BIA OKOK y registros diarios de peso',
      count: (db.bodyScans ?? []).length + (db.bodyWeights ?? []).length,
    },
    {
      category: 'pulse',
      label: 'Lecturas PPG / HRV y Estrés',
      description: 'Frecuencia cardíaca en reposo, HRV RMSSD e impacto',
      count: (db.pulseHrvRecords ?? []).length,
    },
    {
      category: 'blood_pressure',
      label: 'Presión Arterial',
      description: 'Registros sistólica, diastólica y pulso',
      count: (db.bloodPressureRecords ?? []).length,
    },
    {
      category: 'nutrition',
      label: 'Nutrición y Ayunos',
      description: 'Comidas registradas, macros e historial de ayuno',
      count: (db.foodLogs ?? []).length + (db.fastingHistory ?? []).length,
    },
    {
      category: 'hydration',
      label: 'Hidratación y Electrolitos',
      description: 'Tomas de agua registradas por día y electrolitos',
      count: Math.max(hydrationLogsTotal, hydrationDaysCount),
    },
    {
      category: 'sleep',
      label: 'Sueño y Descanso',
      description: 'Sesiones nocturnas, fases y eventos de sonido',
      count: (db.sleepSessions ?? []).length,
    },
    {
      category: 'measurements',
      label: 'Medidas Corporales',
      description: 'Cintura, pecho, brazos, muslos y cadera',
      count: (db.bodyMeasurements ?? []).length,
    },
    {
      category: 'photos',
      label: 'Fotos de Progreso',
      description: 'Metadatos y archivos comprimidos en IndexedDB',
      count: (db.progressPhotos ?? []).length,
    },
    {
      category: 'manual_activity',
      label: 'Pasos Manuales y Check-in',
      description: 'Registros manuales de pasos y check-ins de preparación',
      count:
        Object.keys(db.manualActivityByDate ?? {}).length +
        Object.keys(db.readinessByDate ?? {}).length,
    },
  ];
}

export function clearCategoryInDb(
  db: AppDatabase,
  category: CleanupCategoryId,
): { nextDb: AppDatabase; deletedPhotoIds: string[] } {
  switch (category) {
    case 'workouts':
      return {
        nextDb: {
          ...db,
          workouts: [],
          activeWorkout: null,
          muscleFatigue: createInitialMuscleFatigue(),
        },
        deletedPhotoIds: [],
      };
    case 'hiit':
      return {
        nextDb: { ...db, hiitSessions: [] },
        deletedPhotoIds: [],
      };
    case 'cardio':
      return {
        nextDb: {
          ...db,
          cardioSessions: [],
          shoes: (db.shoes ?? []).map((s) => ({ ...s, accumulatedKm: 0 })),
        },
        deletedPhotoIds: [],
      };
    case 'body_composition':
      return {
        nextDb: recalculateLatestWeightAndAdaptiveNutrition(db, [], []),
        deletedPhotoIds: [],
      };
    case 'pulse':
      return {
        nextDb: { ...db, pulseHrvRecords: [] },
        deletedPhotoIds: [],
      };
    case 'blood_pressure':
      return {
        nextDb: { ...db, bloodPressureRecords: [] },
        deletedPhotoIds: [],
      };
    case 'nutrition':
      return {
        nextDb: {
          ...db,
          foodLogs: [],
          fastingHistory: [],
          activeFast: null,
        },
        deletedPhotoIds: [],
      };
    case 'hydration':
      return {
        nextDb: {
          ...db,
          hydrationByDate: {},
          hydrationLogsByDate: {},
          electrolytesByDate: {},
          hydrationSettings: db.hydrationSettings
            ? { ...db.hydrationSettings, hotDayByDate: {} }
            : db.hydrationSettings,
          activeFast: db.activeFast
            ? { ...db.activeFast, waterGlassesCount: 0, electrolytesCount: 0 }
            : null,
        },
        deletedPhotoIds: [],
      };
    case 'sleep':
      return {
        nextDb: { ...db, sleepSessions: [] },
        deletedPhotoIds: [],
      };
    case 'measurements':
      return {
        nextDb: { ...db, bodyMeasurements: [] },
        deletedPhotoIds: [],
      };
    case 'photos': {
      const deletedPhotoIds = (db.progressPhotos ?? [])
        .map((p) => p.id)
        .filter(Boolean);
      return {
        nextDb: { ...db, progressPhotos: [] },
        deletedPhotoIds,
      };
    }
    case 'manual_activity':
      return {
        nextDb: {
          ...db,
          manualActivityByDate: {},
          readinessByDate: {},
        },
        deletedPhotoIds: [],
      };
  }
}

export function clearProfileHistoryPreserveProfile(db: AppDatabase): {
  nextDb: AppDatabase;
  deletedPhotoIds: string[];
} {
  const nowIso = new Date().toISOString();
  const deletedPhotoIds = (db.progressPhotos ?? [])
    .map((p) => p.id)
    .filter(Boolean);

  return {
    nextDb: {
      ...db,
      updatedAt: nowIso,
      muscleFatigue: createInitialMuscleFatigue(nowIso),
      activeWorkout: null,
      workouts: [],
      hiitSessions: [],
      cardioSessions: [],
      shoes: (db.shoes ?? []).map((s) => ({ ...s, accumulatedKm: 0 })),
      sleepSessions: [],
      pulseHrvRecords: [],
      bloodPressureRecords: [],
      bodyWeights: [],
      bodyScans: [],
      bodyMeasurements: [],
      progressPhotos: [],
      readinessByDate: {},
      foodLogs: [],
      hydrationByDate: {},
      hydrationLogsByDate: {},
      electrolytesByDate: {},
      hydrationSettings: db.hydrationSettings
        ? { ...db.hydrationSettings, hotDayByDate: {} }
        : db.hydrationSettings,
      activeFast: null,
      fastingHistory: [],
      manualActivityByDate: {},
      coachChatHistory: [],
      scheduledRestDates: [],
    },
    deletedPhotoIds,
  };
}

/**
 * Total Factory Reset: clears all IndexedDB databases (PulsoFitDB, pulsofit_db, pulsofit_photos_db)
 * and all PulsoFit localStorage keys, then re-initializes a clean empty 'main' slot.
 */
export async function wipeAllPulsoFitStorage(): Promise<AppDatabase> {
  clearAllPendingBatches();
  resetAllHydrationLocks();

  await clearPulsoFitStoresIfOpen();
  await Promise.all([
    deleteIndexedDbSafe(DB_NAME),
    deleteIndexedDbSafe(LEGACY_DB_NAME),
    deleteIndexedDbSafe('pulsofit_photos_db'),
  ]);

  if (typeof window !== 'undefined') {
    try {
      const keysToDelete: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith('pulsofit_')) {
          keysToDelete.push(k);
        }
      }
      for (const k of keysToDelete) {
        window.localStorage.removeItem(k);
      }
    } catch {
      // Ignore localStorage cleanup errors
    }
  }

  const cleanDb: AppDatabase = {
    ...createInitialDatabase('Atleta'),
    bodyWeights: [],
  };

  await saveProfileRegistry(DEFAULT_PROFILE_SLOTS);
  setActiveProfileId('main');
  await saveAppDatabase(cleanDb, 'main', { force: true });
  return cleanDb;
}
