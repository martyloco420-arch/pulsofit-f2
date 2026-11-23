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
  LS_ACTIVE_PROFILE_KEY,
  type RecordDeleteTarget,
  dedupeById,
  getLocalDateKey,
  getTodayIsoDate,
  readRawProfileFromLegacyStorage,
  readRawProfileFromPulsoFitDB,
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

export type HrvRhrRangeDays = 7 | 14 | 30 | 90;

export interface HrvRhrDailyPoint {
  date: string; // YYYY-MM-DD local
  shortDate: string; // e.g. 12 nov
  fullDate: string; // e.g. jue, 12 nov 2026
  avgHrvMs: number | null;
  avgRhrBpm: number | null;
  sampleCount: number;
}

export interface HrvRhrTrendSummary {
  profileId: string;
  rangeDays: HrvRhrRangeDays;
  startDate: string;
  endDate: string;
  points: HrvRhrDailyPoint[];
  daysWithData: number;
  totalMeasurements: number;
  avgHrvMs: number | null;
  avgRhrBpm: number | null;
  avgHrv30dMs: number | null;
  avgRhr30dBpm: number | null;
  minHrvMs: number | null;
  maxHrvMs: number | null;
  minRhrBpm: number | null;
  maxRhrBpm: number | null;
}

export type HrvRhr30dSummary = HrvRhrTrendSummary;

function shiftLocalCalendarDate(baseIso: string, deltaDays: number): string {
  const parts = baseIso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    const dt = new Date();
    dt.setDate(dt.getDate() + deltaDays);
    return dt.toLocaleDateString('en-CA');
  }
  const dt = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  dt.setDate(dt.getDate() + deltaDays);
  return dt.toLocaleDateString('en-CA');
}

function formatChartDayLabels(isoDate: string): { shortDate: string; fullDate: string } {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) {
    return { shortDate: isoDate, fullDate: isoDate };
  }
  const shortDate = dt
    .toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
    .replace('.', '');
  const fullDate = dt.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return { shortDate, fullDate };
}

export function computeHrvRhrTrend(
  records: PulseHrvRecord[],
  rangeDays: HrvRhrRangeDays = 30,
  profileId = 'main',
  todayIso = new Date().toLocaleDateString('en-CA'),
): HrvRhrTrendSummary {
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(todayIso)
    ? todayIso
    : new Date().toLocaleDateString('en-CA');
  const startOffset = -(rangeDays - 1);
  const startDate = shiftLocalCalendarDate(endDate, startOffset);

  const groupedByDate = new Map<string, PulseHrvRecord[]>();
  for (const rec of records) {
    const localDate = getLocalDateKey(rec.date || rec.recordedAt);
    if (localDate < startDate || localDate > endDate) continue;
    const list = groupedByDate.get(localDate) ?? [];
    list.push(rec);
    groupedByDate.set(localDate, list);
  }

  const points: HrvRhrDailyPoint[] = [];
  let daysWithData = 0;
  let totalMeasurements = 0;
  const allHrvValues: number[] = [];
  const allRhrValues: number[] = [];

  for (let offset = startOffset; offset <= 0; offset += 1) {
    const date = shiftLocalCalendarDate(endDate, offset);
    const dayRecords = groupedByDate.get(date) ?? [];
    const hrvList = dayRecords
      .map((r) => r.hrvRmssdMs)
      .filter((v) => Number.isFinite(v) && v > 0);
    const rhrList = dayRecords
      .map((r) => r.bpm)
      .filter((v) => Number.isFinite(v) && v > 0);

    const avgHrvMs =
      hrvList.length > 0
        ? Math.round(hrvList.reduce((acc, v) => acc + v, 0) / hrvList.length)
        : null;
    const avgRhrBpm =
      rhrList.length > 0
        ? Math.round(rhrList.reduce((acc, v) => acc + v, 0) / rhrList.length)
        : null;

    if (avgHrvMs !== null || avgRhrBpm !== null) {
      daysWithData += 1;
    }
    totalMeasurements += dayRecords.length;
    allHrvValues.push(...hrvList);
    allRhrValues.push(...rhrList);

    const labels = formatChartDayLabels(date);
    points.push({
      date,
      shortDate: labels.shortDate,
      fullDate: labels.fullDate,
      avgHrvMs,
      avgRhrBpm,
      sampleCount: dayRecords.length,
    });
  }

  const avgHrvMs =
    allHrvValues.length > 0
      ? Math.round(allHrvValues.reduce((acc, v) => acc + v, 0) / allHrvValues.length)
      : null;
  const avgRhrBpm =
    allRhrValues.length > 0
      ? Math.round(allRhrValues.reduce((acc, v) => acc + v, 0) / allRhrValues.length)
      : null;

  return {
    profileId,
    rangeDays,
    startDate,
    endDate,
    points,
    daysWithData,
    totalMeasurements,
    avgHrvMs,
    avgRhrBpm,
    avgHrv30dMs: avgHrvMs,
    avgRhr30dBpm: avgRhrBpm,
    minHrvMs: allHrvValues.length > 0 ? Math.min(...allHrvValues) : null,
    maxHrvMs: allHrvValues.length > 0 ? Math.max(...allHrvValues) : null,
    minRhrBpm: allRhrValues.length > 0 ? Math.min(...allRhrValues) : null,
    maxRhrBpm: allRhrValues.length > 0 ? Math.max(...allRhrValues) : null,
  };
}

export function computeHrvRhr30dTrend(
  records: PulseHrvRecord[],
  profileId = 'main',
  todayIso = new Date().toLocaleDateString('en-CA'),
): HrvRhrTrendSummary {
  return computeHrvRhrTrend(records, 30, profileId, todayIso);
}

function resolveCurrentProfileIdSafe(profileId?: string): string {
  if (typeof profileId === 'string' && profileId.trim()) {
    return profileId.trim();
  }
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(LS_ACTIVE_PROFILE_KEY);
      if (stored && stored.trim()) return stored.trim();
    } catch {
      // Ignore storage access errors
    }
  }
  return 'main';
}

export async function loadActiveProfileHrvRhrTrend(
  rangeDays: HrvRhrRangeDays = 30,
  profileId?: string,
  todayIso?: string,
): Promise<HrvRhrTrendSummary> {
  const resolvedProfileId = resolveCurrentProfileIdSafe(profileId);
  let raw: Partial<AppDatabase> | null = null;
  try {
    raw = await readRawProfileFromPulsoFitDB(resolvedProfileId);
  } catch {
    raw = null;
  }
  if (!raw) {
    try {
      raw = await readRawProfileFromLegacyStorage(resolvedProfileId);
    } catch {
      raw = null;
    }
  }

  const nowIso = new Date().toISOString();
  const records = dedupeById(
    (Array.isArray(raw?.pulseHrvRecords) ? raw.pulseHrvRecords : []).map((rec, idx) =>
      normalizePulseRecord(rec ?? {}, idx, nowIso),
    ),
  );

  return computeHrvRhrTrend(records, rangeDays, resolvedProfileId, todayIso);
}

export async function loadActiveProfileHrvRhr30d(
  profileId?: string,
  todayIso?: string,
): Promise<HrvRhrTrendSummary> {
  return loadActiveProfileHrvRhrTrend(30, profileId, todayIso);
}
