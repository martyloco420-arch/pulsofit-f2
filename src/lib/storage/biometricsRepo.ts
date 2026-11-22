import type {
  AppDatabase,
  BloodPressureRecord,
  BodyCompositionScan,
  BodyWeightEntry,
  PulseHrvRecord,
  SleepNoiseEvent,
  SleepSession,
  SleepTimelinePoint,
} from '../../types/fitness';
import {
  type RecordDeleteTarget,
  dedupeById,
  getLocalDateKey,
  getTodayIsoDate,
  resolveDeleteIndex,
  safeNum,
  safeStr,
} from './dbCore';

export function normalizeSleepSession(
  raw: Partial<SleepSession>,
  idx: number,
  nowIso: string,
): SleepSession {
  const wakeUpAt = safeStr(raw.wakeUpAt, nowIso);
  const timeline: SleepTimelinePoint[] = Array.isArray(raw.timeline)
    ? raw.timeline.map((pt, pIdx) => ({
        minuteOffset: Math.max(0, Math.round(safeNum(pt?.minuteOffset, pIdx * 5))),
        timestamp: safeStr(pt?.timestamp, wakeUpAt),
        phase: pt?.phase ?? 'ligero',
        movementScore: Math.max(0, Math.min(100, safeNum(pt?.movementScore, 0))),
        audioDbLevel: Math.max(0, Math.min(100, safeNum(pt?.audioDbLevel, 0))),
        audioVariability:
          typeof pt?.audioVariability === 'number' ? pt.audioVariability : 0,
        snoreOrNoiseEvent: Boolean(pt?.snoreOrNoiseEvent),
      }))
    : [];

  const noiseEvents: SleepNoiseEvent[] = Array.isArray(raw.noiseEvents)
    ? raw.noiseEvents.map((ev, eIdx) => ({
        id: safeStr(ev?.id, `ev_${idx}_${eIdx}`),
        timestamp: safeStr(ev?.timestamp, wakeUpAt),
        minuteOffset: Math.max(0, Math.round(safeNum(ev?.minuteOffset, 0))),
        type: ev?.type ?? 'ruido_ambiente',
        intensity: Math.max(0, Math.min(100, safeNum(ev?.intensity, 0))),
        label: safeStr(ev?.label, 'Evento nocturno'),
      }))
    : [];

  return {
    id: safeStr(raw.id, `sleep_norm_${idx}_${Date.now()}`),
    date: getLocalDateKey(raw.date || wakeUpAt),
    bedtimeAt: safeStr(raw.bedtimeAt, wakeUpAt),
    wakeUpAt,
    targetWakeTime: safeStr(raw.targetWakeTime, '07:00'),
    smartWindowMin:
      raw.smartWindowMin === 15 || raw.smartWindowMin === 30 || raw.smartWindowMin === 45
        ? raw.smartWindowMin
        : 30,
    triggeredBySmartAlarm: Boolean(raw.triggeredBySmartAlarm),
    durationMinutes: Math.max(0, Math.round(safeNum(raw.durationMinutes, 0))),
    sleepQualityPct: Math.max(
      0,
      Math.min(100, Math.round(safeNum(raw.sleepQualityPct, 0))),
    ),
    deepSleepMin: Math.max(0, Math.round(safeNum(raw.deepSleepMin, 0))),
    lightRemSleepMin: Math.max(0, Math.round(safeNum(raw.lightRemSleepMin, 0))),
    lightSleepMin:
      typeof raw.lightSleepMin === 'number'
        ? Math.max(0, Math.round(raw.lightSleepMin))
        : undefined,
    remSleepMin:
      typeof raw.remSleepMin === 'number'
        ? Math.max(0, Math.round(raw.remSleepMin))
        : undefined,
    awakeMin: Math.max(0, Math.round(safeNum(raw.awakeMin, 0))),
    completedCycles90:
      typeof raw.completedCycles90 === 'number'
        ? Math.max(0, raw.completedCycles90)
        : 0,
    physicalRecoveryPct:
      typeof raw.physicalRecoveryPct === 'number'
        ? raw.physicalRecoveryPct
        : undefined,
    mentalRecoveryPct:
      typeof raw.mentalRecoveryPct === 'number' ? raw.mentalRecoveryPct : undefined,
    recoveryRecommendation:
      typeof raw.recoveryRecommendation === 'string'
        ? raw.recoveryRecommendation
        : undefined,
    snoreEventsCount: Math.max(0, Math.round(safeNum(raw.snoreEventsCount, 0))),
    noiseEventsCount: Math.max(0, Math.round(safeNum(raw.noiseEventsCount, 0))),
    movementIndex: Math.max(
      0,
      Math.min(100, Math.round(safeNum(raw.movementIndex, 0))),
    ),
    soundscapeUsed: raw.soundscapeUsed ?? 'ninguno',
    micEnabled: Boolean(raw.micEnabled),
    motionEnabled: Boolean(raw.motionEnabled),
    timeline,
    noiseEvents,
  };
}

export function normalizePulseRecord(
  raw: Partial<PulseHrvRecord>,
  idx: number,
  nowIso: string,
): PulseHrvRecord {
  const recordedAt = safeStr(raw.recordedAt, nowIso);
  return {
    id: safeStr(raw.id, `ppg_norm_${idx}_${Date.now()}`),
    date: getLocalDateKey(raw.date || recordedAt),
    recordedAt,
    bpm: Math.max(0, Math.round(safeNum(raw.bpm, 0))),
    hrvRmssdMs: Math.max(0, Math.round(safeNum(raw.hrvRmssdMs, 0))),
    recoveryImpactScore: Math.max(
      0,
      Math.min(100, Math.round(safeNum(raw.recoveryImpactScore, 0))),
    ),
    signalQualityPct: Math.max(
      0,
      Math.min(100, Math.round(safeNum(raw.signalQualityPct, 0))),
    ),
    durationSec: Math.max(0, Math.round(safeNum(raw.durationSec, 20))),
    source: raw.source === 'ppg_camara' ? 'ppg_camara' : 'manual',
    waveformPreview: Array.isArray(raw.waveformPreview)
      ? raw.waveformPreview.map((v) => safeNum(v, 0))
      : [],
  };
}

export function normalizeBloodPressureRecord(
  raw: Partial<BloodPressureRecord>,
  idx: number,
  nowIso: string,
): BloodPressureRecord {
  const recordedAt = safeStr(raw.recordedAt, nowIso);
  return {
    id: safeStr(raw.id, `bp_norm_${idx}_${Date.now()}`),
    date: getLocalDateKey(raw.date || recordedAt),
    recordedAt,
    systolic: Math.max(0, Math.round(safeNum(raw.systolic, 120))),
    diastolic: Math.max(0, Math.round(safeNum(raw.diastolic, 80))),
    pulseBpm:
      typeof raw.pulseBpm === 'number' && Number.isFinite(raw.pulseBpm)
        ? raw.pulseBpm
        : undefined,
    category: raw.category ?? 'Normal',
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
  };
}

export function normalizeBodyScan(
  raw: Partial<BodyCompositionScan>,
  idx: number,
  nowIso: string,
): BodyCompositionScan {
  const recordedAt = safeStr(raw.recordedAt, nowIso);
  return {
    id: safeStr(raw.id, `scan_norm_${idx}_${Date.now()}`),
    date: getLocalDateKey(raw.date || recordedAt),
    recordedAt,
    timeSlot:
      raw.timeSlot === 'manana' || raw.timeSlot === 'tarde' || raw.timeSlot === 'noche'
        ? raw.timeSlot
        : undefined,
    source:
      raw.source === 'bluetooth' || raw.source === 'captura_ia'
        ? raw.source
        : 'manual',
    impedanceOhm:
      typeof raw.impedanceOhm === 'number' && Number.isFinite(raw.impedanceOhm)
        ? raw.impedanceOhm
        : undefined,
    weightKg: Math.max(0, safeNum(raw.weightKg, 0)),
    waistCm:
      typeof raw.waistCm === 'number' && Number.isFinite(raw.waistCm)
        ? raw.waistCm
        : undefined,
    leanMassKg: Math.max(0, safeNum(raw.leanMassKg, 0)),
    bmi: Math.max(0, safeNum(raw.bmi, 0)),
    obesityDegreePct: safeNum(raw.obesityDegreePct, 0),
    bodyFatPct: Math.max(0, safeNum(raw.bodyFatPct, 0)),
    bodyFatMassKg: Math.max(0, safeNum(raw.bodyFatMassKg, 0)),
    skeletalMusclePct: Math.max(0, safeNum(raw.skeletalMusclePct, 0)),
    skeletalMuscleMassKg: Math.max(0, safeNum(raw.skeletalMuscleMassKg, 0)),
    totalMusclePct: Math.max(0, safeNum(raw.totalMusclePct, 0)),
    totalMuscleMassKg: Math.max(0, safeNum(raw.totalMuscleMassKg, 0)),
    bodyWaterPct: Math.max(0, safeNum(raw.bodyWaterPct, 0)),
    bodyWaterMassKg: Math.max(0, safeNum(raw.bodyWaterMassKg, 0)),
    visceralFatLevel: Math.max(0, safeNum(raw.visceralFatLevel, 0)),
    boneMassKg: Math.max(0, safeNum(raw.boneMassKg, 0)),
    bmrKcal: Math.max(0, safeNum(raw.bmrKcal, 0)),
    proteinPct: Math.max(0, safeNum(raw.proteinPct, 0)),
    bodyAge: Math.max(0, safeNum(raw.bodyAge, 0)),
    realAge: Math.max(0, safeNum(raw.realAge, 0)),
    idealWeightKg: Math.max(0, safeNum(raw.idealWeightKg, 0)),
  };
}

export function normalizeBodyWeights(
  rawWeights: Partial<BodyWeightEntry>[] | undefined,
  fallbackWeights: BodyWeightEntry[],
  defaultWeightKg: number,
): BodyWeightEntry[] {
  if (!Array.isArray(rawWeights)) {
    return fallbackWeights;
  }
  return rawWeights.map((bw, i) => ({
    id: safeStr(bw?.id, `bw_norm_${i}_${Date.now()}`),
    date: getLocalDateKey(bw?.date || getTodayIsoDate()),
    weightKg: Math.max(0, safeNum(bw?.weightKg, defaultWeightKg)),
  }));
}

export function normalizeBiometricsDomain(
  raw: Partial<AppDatabase>,
  fallbackWeights: BodyWeightEntry[],
  defaultWeightKg: number,
  nowIso: string,
): Pick<
  AppDatabase,
  | 'sleepSessions'
  | 'pulseHrvRecords'
  | 'bloodPressureRecords'
  | 'bodyWeights'
  | 'bodyScans'
  | 'bodyMeasurements'
  | 'progressPhotos'
> {
  return {
    sleepSessions: dedupeById(
      (Array.isArray(raw.sleepSessions) ? raw.sleepSessions : []).map((s, i) =>
        normalizeSleepSession(s ?? {}, i, nowIso),
      ),
    ),
    pulseHrvRecords: dedupeById(
      (Array.isArray(raw.pulseHrvRecords) ? raw.pulseHrvRecords : []).map((p, i) =>
        normalizePulseRecord(p ?? {}, i, nowIso),
      ),
    ),
    bloodPressureRecords: dedupeById(
      (Array.isArray(raw.bloodPressureRecords) ? raw.bloodPressureRecords : []).map(
        (b, i) => normalizeBloodPressureRecord(b ?? {}, i, nowIso),
      ),
    ),
    bodyWeights: normalizeBodyWeights(
      raw.bodyWeights,
      fallbackWeights,
      defaultWeightKg,
    ),
    bodyScans: dedupeById(
      (Array.isArray(raw.bodyScans) ? raw.bodyScans : []).map((sc, i) =>
        normalizeBodyScan(sc ?? {}, i, nowIso),
      ),
    ),
    bodyMeasurements: Array.isArray(raw.bodyMeasurements) ? raw.bodyMeasurements : [],
    progressPhotos: Array.isArray(raw.progressPhotos) ? raw.progressPhotos : [],
  };
}

export function removeBodyScanAndSyncWeights(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextScans: BodyCompositionScan[]; nextWeights: BodyWeightEntry[]; changed: boolean } {
  const list = db.bodyScans ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (s) => s.id,
    (s) => [s.recordedAt, s.date],
  );
  if (idx < 0) {
    return { nextScans: list, nextWeights: db.bodyWeights ?? [], changed: false };
  }

  const deleted = list[idx];
  const nextScans = list.filter((_, i) => i !== idx);
  let nextWeights = db.bodyWeights ?? [];

  const remainingForDate = nextScans
    .filter((s) => s.date === deleted.date)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  if (remainingForDate.length > 0) {
    const replacement = remainingForDate[0];
    nextWeights = [
      ...nextWeights.filter((b) => b.date !== deleted.date),
      {
        id: `bw_${Date.now()}`,
        date: deleted.date,
        weightKg: replacement.weightKg,
      },
    ].sort((a, b) => a.date.localeCompare(b.date));
  } else {
    nextWeights = nextWeights.filter(
      (b) =>
        !(
          b.date === deleted.date &&
          Math.abs(b.weightKg - deleted.weightKg) < 0.05
        ),
    );
  }

  return { nextScans, nextWeights, changed: true };
}

export function removeBodyWeightRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextWeights: BodyWeightEntry[]; changed: boolean } {
  const list = db.bodyWeights ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (w) => w.id,
    (w) => [w.date],
  );
  if (idx < 0) return { nextWeights: list, changed: false };
  return {
    nextWeights: list.filter((_, i) => i !== idx),
    changed: true,
  };
}

export function deletePulseRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; changed: boolean } {
  const list = db.pulseHrvRecords ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (p) => p.id,
    (p) => [p.recordedAt, p.date],
  );
  if (idx < 0) return { nextDb: db, changed: false };
  return {
    nextDb: { ...db, pulseHrvRecords: list.filter((_, i) => i !== idx) },
    changed: true,
  };
}

export function deleteBloodPressureRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; changed: boolean } {
  const list = db.bloodPressureRecords ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (bp) => bp.id,
    (bp) => [bp.recordedAt, bp.date],
  );
  if (idx < 0) return { nextDb: db, changed: false };
  return {
    nextDb: { ...db, bloodPressureRecords: list.filter((_, i) => i !== idx) },
    changed: true,
  };
}

export function deleteSleepRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; changed: boolean } {
  const list = db.sleepSessions ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (s) => s.id,
    (s) => [s.wakeUpAt, s.bedtimeAt, s.date],
  );
  if (idx < 0) return { nextDb: db, changed: false };
  return {
    nextDb: { ...db, sleepSessions: list.filter((_, i) => i !== idx) },
    changed: true,
  };
}

export function deleteMeasurementRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; changed: boolean } {
  const list = db.bodyMeasurements ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (m) => m.id,
    (m) => [m.date],
  );
  if (idx < 0) return { nextDb: db, changed: false };
  return {
    nextDb: { ...db, bodyMeasurements: list.filter((_, i) => i !== idx) },
    changed: true,
  };
}

export function deleteProgressPhotoRecord(
  db: AppDatabase,
  target: RecordDeleteTarget,
): { nextDb: AppDatabase; deletedPhotoIds: string[]; changed: boolean } {
  const list = db.progressPhotos ?? [];
  const idx = resolveDeleteIndex(
    list,
    target,
    (p) => p.id,
    (p) => [p.createdAt, p.date],
  );
  if (idx < 0) return { nextDb: db, deletedPhotoIds: [], changed: false };
  const removedId = list[idx]?.id;
  return {
    nextDb: { ...db, progressPhotos: list.filter((_, i) => i !== idx) },
    deletedPhotoIds: removedId ? [removedId] : [],
    changed: true,
  };
}

export function countBiometricsDomainByDate(
  db: AppDatabase,
  dateIso: string,
): {
  bodyScans: number;
  bodyWeights: number;
  pulse: number;
  bloodPressure: number;
  sleep: number;
  measurements: number;
  progressPhotoIds: string[];
} {
  return {
    bodyScans: (db.bodyScans ?? []).filter(
      (b) => getLocalDateKey(b.date || b.recordedAt) === dateIso,
    ).length,
    bodyWeights: (db.bodyWeights ?? []).filter(
      (w) => getLocalDateKey(w.date) === dateIso,
    ).length,
    pulse: (db.pulseHrvRecords ?? []).filter(
      (p) => getLocalDateKey(p.date || p.recordedAt) === dateIso,
    ).length,
    bloodPressure: (db.bloodPressureRecords ?? []).filter(
      (bp) => getLocalDateKey(bp.date || bp.recordedAt) === dateIso,
    ).length,
    sleep: (db.sleepSessions ?? []).filter(
      (s) => getLocalDateKey(s.date || s.wakeUpAt) === dateIso,
    ).length,
    measurements: (db.bodyMeasurements ?? []).filter(
      (m) => getLocalDateKey(m.date) === dateIso,
    ).length,
    progressPhotoIds: (db.progressPhotos ?? [])
      .filter((p) => getLocalDateKey(p.date || p.createdAt) === dateIso)
      .map((p) => p.id),
  };
}

export function filterBiometricsDomainByDate(
  db: AppDatabase,
  dateIso: string,
  includePhotos: boolean,
): {
  nextScans: BodyCompositionScan[];
  nextWeights: BodyWeightEntry[];
  pulseHrvRecords: PulseHrvRecord[];
  bloodPressureRecords: BloodPressureRecord[];
  sleepSessions: SleepSession[];
  bodyMeasurements: AppDatabase['bodyMeasurements'];
  progressPhotos: AppDatabase['progressPhotos'];
  deletedPhotoIds: string[];
} {
  const nextScans = (db.bodyScans ?? []).filter(
    (s) => getLocalDateKey(s.date || s.recordedAt) !== dateIso,
  );
  const nextWeights = (db.bodyWeights ?? []).filter(
    (w) => getLocalDateKey(w.date) !== dateIso,
  );
  const deletedPhotoIds = includePhotos
    ? (db.progressPhotos ?? [])
        .filter((p) => getLocalDateKey(p.date || p.createdAt) === dateIso)
        .map((p) => p.id)
    : [];
  const nextPhotos = includePhotos
    ? (db.progressPhotos ?? []).filter(
        (p) => getLocalDateKey(p.date || p.createdAt) !== dateIso,
      )
    : db.progressPhotos;

  return {
    nextScans,
    nextWeights,
    pulseHrvRecords: (db.pulseHrvRecords ?? []).filter(
      (p) => getLocalDateKey(p.date || p.recordedAt) !== dateIso,
    ),
    bloodPressureRecords: (db.bloodPressureRecords ?? []).filter(
      (bp) => getLocalDateKey(bp.date || bp.recordedAt) !== dateIso,
    ),
    sleepSessions: (db.sleepSessions ?? []).filter(
      (s) => getLocalDateKey(s.date || s.wakeUpAt) !== dateIso,
    ),
    bodyMeasurements: (db.bodyMeasurements ?? []).filter(
      (m) => getLocalDateKey(m.date) !== dateIso,
    ),
    progressPhotos: nextPhotos,
    deletedPhotoIds,
  };
}
