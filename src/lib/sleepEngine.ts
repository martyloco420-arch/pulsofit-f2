import type {
  DailyReadinessEntry,
  SleepNoiseEvent,
  SleepPhase,
  SleepSession,
  SleepSmartWindowMin,
  SleepSoundscapeType,
  SleepTimelinePoint,
} from '../types/fitness';
import { getTodayIsoDate } from './storage';

export interface LiveSleepEpochSample {
  minuteOffset: number;
  timestamp: string;
  movementScore: number; // 0..100
  audioDbLevel: number; // 0..100
  audioVariability?: number; // 0..100
  snoreOrNoiseEvent?: boolean;
}

export interface PhaseBreakdownMetric {
  phase: SleepPhase;
  label: string;
  minutes: number;
  pct: number;
  healthyRangeLabel: string;
  minHealthyPct: number;
  maxHealthyPct: number;
  status: 'Óptimo' | 'Bajo' | 'Alto';
  colorHex: string;
}

export interface SleepCycleAnalytics {
  deepMin: number;
  remMin: number;
  lightMin: number;
  awakeMin: number;
  deepPct: number;
  remPct: number;
  lightPct: number;
  awakePct: number;
  completedCycles90: number;
  partialCycleMin: number;
  physicalRecoveryPct: number;
  mentalRecoveryPct: number;
  recommendation: string;
  phases: PhaseBreakdownMetric[];
}

export interface CycleTimeRecommendation {
  cycles: number;
  sleepHoursLabel: string;
  timeHHMM: string;
  isRecommended: boolean;
}

export function formatMinutesAsHoursMin(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hrs = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hrs === 0) return `${mins} min`;
  return `${hrs} h ${String(mins).padStart(2, '0')} min`;
}

export function computeTargetWakeWindow(
  wakeTimeHHMM: string,
  smartWindowMin: SleepSmartWindowMin,
  nowMs = Date.now(),
): {
  targetMs: number;
  windowStartMs: number;
  windowStartLabel: string;
  targetLabel: string;
} {
  const [hStr, mStr] = wakeTimeHHMM.split(':');
  const targetH = Math.max(0, Math.min(23, Number.parseInt(hStr || '7', 10) || 7));
  const targetM = Math.max(0, Math.min(59, Number.parseInt(mStr || '0', 10) || 0));

  const targetDate = new Date(nowMs);
  targetDate.setHours(targetH, targetM, 0, 0);
  if (targetDate.getTime() <= nowMs + 15_000) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  const targetMs = targetDate.getTime();
  const windowStartMs = targetMs - smartWindowMin * 60_000;

  const formatHm = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return {
    targetMs,
    windowStartMs,
    windowStartLabel: formatHm(windowStartMs),
    targetLabel: formatHm(targetMs),
  };
}

/**
 * Classifies a 5-minute sleep interval into one of 4 physiological stages:
 * - despierto: high movement spikes or loud ambient sound
 * - profundo: total stillness + slow rhythmic quiet breathing, weighted to 1st half of night
 * - rem: bodily stillness + irregular/variable breathing or brief micro-twitches, weighted to 2nd half & dawn
 * - ligero: moderate movement / posture adjustments and cycle transitions
 */
export function classifySleepPhase(
  minuteOffset: number,
  movementScore: number,
  audioDbLevel: number,
  audioVariability = 14,
  totalDurationMin = 450,
): SleepPhase {
  // 1. Despierto: picos altos de movimiento o sonido ambiental fuerte
  if (
    movementScore >= 52 ||
    audioDbLevel >= 52 ||
    (movementScore >= 36 && audioDbLevel >= 40)
  ) {
    return 'despierto';
  }

  // Initial sleep onset latency (~10 min) -> Ligero
  if (minuteOffset < 10) {
    return 'ligero';
  }

  const safeTotal = Math.max(90, totalDurationMin);
  const nightProgress = Math.max(0, Math.min(1, minuteOffset / safeTotal));
  const cyclePos = (minuteOffset % 90) / 90; // 0..1 within each 90-min cycle

  // 2. Sueño Profundo: quietud total + respiración lenta/rítmica, ponderado en 1ª mitad de la noche
  const deepWindowLimit = nightProgress <= 0.5 ? 0.56 : 0.25;
  const isDeepQuiet =
    movementScore < 15 && audioDbLevel < 26 && audioVariability < 22;
  if (isDeepQuiet && cyclePos >= 0.14 && cyclePos <= deepWindowLimit) {
    return 'profundo';
  }

  // 3. Sueño REM: quietud corporal (o micro-espasmos breves <= 20) + respiración variable/irregular,
  // ponderado en 2ª mitad de la noche y madrugada
  const inRemCycleZone = cyclePos >= (nightProgress >= 0.48 ? 0.55 : 0.74);
  const hasRemSignature =
    movementScore <= 22 &&
    (audioVariability >= 20 || (audioDbLevel >= 16 && audioDbLevel <= 36) || inRemCycleZone);

  if (
    hasRemSignature &&
    ((nightProgress >= 0.42 && cyclePos >= 0.56) ||
      (nightProgress >= 0.2 && cyclePos >= 0.74 && audioVariability >= 22))
  ) {
    return 'rem';
  }

  // Fallback for ultra-quiet early-night moments near deep window
  if (movementScore < 11 && nightProgress < 0.45 && cyclePos <= 0.62) {
    return 'profundo';
  }

  // 4. Sueño Ligero: movimiento moderado / cambios de postura y respiración regular
  return 'ligero';
}

function bucketSamplesTo5MinIntervals(
  rawSamples: LiveSleepEpochSample[],
  bedtimeAt: string,
  elapsedMin: number,
): LiveSleepEpochSample[] {
  const startMs = Number.isNaN(Date.parse(bedtimeAt)) ? Date.now() : Date.parse(bedtimeAt);
  const sorted = [...rawSamples].sort((a, b) => a.minuteOffset - b.minuteOffset);
  const binCount = Math.max(1, Math.floor(elapsedMin / 5) + 1);
  const bins: LiveSleepEpochSample[][] = Array.from({ length: binCount }, () => []);

  for (const s of sorted) {
    const idx = Math.max(0, Math.min(binCount - 1, Math.floor(s.minuteOffset / 5)));
    bins[idx].push(s);
  }

  const result: LiveSleepEpochSample[] = [];
  let prevAudio = sorted[0]?.audioDbLevel ?? 12;
  let prevMove = sorted[0]?.movementScore ?? 16;

  for (let i = 0; i < binCount; i += 1) {
    const minuteOffset = i * 5;
    const bin = bins[i];
    const timestamp = new Date(startMs + minuteOffset * 60_000).toISOString();

    if (bin.length > 0) {
      const avgMove =
        bin.reduce((acc, s) => acc + s.movementScore, 0) / bin.length;
      const peakMove = Math.max(...bin.map((s) => s.movementScore));
      const blendedMove = Math.round(avgMove * 0.65 + peakMove * 0.35);

      const avgAudio =
        bin.reduce((acc, s) => acc + s.audioDbLevel, 0) / bin.length;
      const explicitVar = bin
        .map((s) => s.audioVariability)
        .filter((v): v is number => typeof v === 'number');

      let variability = 0;
      if (explicitVar.length > 0) {
        variability = explicitVar.reduce((acc, v) => acc + v, 0) / explicitVar.length;
      } else if (bin.length > 1) {
        const mean = avgAudio;
        const variance =
          bin.reduce((acc, s) => acc + (s.audioDbLevel - mean) ** 2, 0) / bin.length;
        variability = Math.min(100, Math.sqrt(variance) * 3.2);
      } else {
        variability = Math.min(100, Math.abs(avgAudio - prevAudio) * 2.4);
      }

      const snoreOrNoise = bin.some((s) => Boolean(s.snoreOrNoiseEvent));
      prevAudio = avgAudio;
      prevMove = blendedMove;

      result.push({
        minuteOffset,
        timestamp,
        movementScore: Math.round(blendedMove),
        audioDbLevel: Math.round(avgAudio),
        audioVariability: Math.round(variability),
        snoreOrNoiseEvent: snoreOrNoise,
      });
    } else {
      // Interpolate smoothly for gaps between live samples keeping ultradian curve natural
      const cyclePos = (minuteOffset % 90) / 90;
      const nightProgress = minuteOffset / Math.max(90, elapsedMin);
      const isLateRemZone = nightProgress >= 0.45 && cyclePos >= 0.6;
      const interpMove = isLateRemZone
        ? Math.min(20, Math.max(8, Math.round(prevMove * 0.85)))
        : cyclePos < 0.5 && nightProgress < 0.55
          ? Math.max(6, Math.round(prevMove * 0.6))
          : Math.max(12, Math.round(prevMove * 0.9));
      const interpVar = isLateRemZone ? 26 : 11;

      result.push({
        minuteOffset,
        timestamp,
        movementScore: interpMove,
        audioDbLevel: Math.round(prevAudio),
        audioVariability: interpVar,
      });
    }
  }

  return result;
}

export function computePhysicalAndMentalRecovery(params: {
  durationMinutes: number;
  deepPct: number;
  remPct: number;
  awakePct: number;
  sleepQualityPct: number;
}): {
  physicalRecoveryPct: number;
  mentalRecoveryPct: number;
  recommendation: string;
} {
  const { durationMinutes, deepPct, remPct, awakePct, sleepQualityPct } = params;
  const durationFactor = Math.min(1, durationMinutes / 450); // 7.5h = 1.0

  // Physical recovery relies heavily on Deep Sleep (target 15-25%) + duration
  const deepScore = Math.min(100, (deepPct / 20) * 100);
  const physicalRecoveryPct = Math.max(
    18,
    Math.min(
      99,
      Math.round(deepScore * 0.6 + durationFactor * 100 * 0.25 + sleepQualityPct * 0.15),
    ),
  );

  // Mental / focus recovery relies heavily on REM Sleep (target 20-25%) + low awake fragmentation
  const remScore = Math.min(100, (remPct / 22) * 100);
  const continuityFactor = Math.max(0, 100 - Math.max(0, awakePct - 4) * 5);
  const mentalRecoveryPct = Math.max(
    18,
    Math.min(
      99,
      Math.round(remScore * 0.62 + continuityFactor * 0.23 + durationFactor * 100 * 0.15),
    ),
  );

  // Recomendación breve en español de México según qué fase faltó anoche
  let recommendation = '';
  if (durationMinutes < 360) {
    recommendation =
      'Dormiste menos de 6 horas: prioriza acostarte 45 min antes hoy y mantén tu entrenamiento en intensidad moderada.';
  } else if (awakePct >= 12) {
    recommendation =
      'Tuviste varios micro-despertares anoche: evita pantallas y cafeína después de las 4:00 p.m. para mejorar tu continuidad.';
  } else if (deepPct < 15 && remPct < 20) {
    recommendation =
      'Faltó tanto Sueño Profundo como REM: hoy evita cargas máximas, cena ligero y busca un cuarto más fresco para recuperar mejor.';
  } else if (deepPct < 15) {
    recommendation =
      'Tu Sueño Profundo estuvo bajo (<15%): la recuperación física está limitada. Hoy enfócate en técnica o descarga y evita entrenar muy tarde.';
  } else if (remPct < 20) {
    recommendation =
      'Faltó Sueño REM (<20%) en la madrugada: puedes notar menor enfoque mental. No recortes tu alarma tan temprano y date un respiro entre bloques.';
  } else {
    recommendation =
      'Excelente balance entre Sueño Profundo y REM: tu recuperación física y mental está al tiro para rendir fuerte hoy.';
  }

  return {
    physicalRecoveryPct,
    mentalRecoveryPct,
    recommendation,
  };
}

export function computeSleepSessionAnalytics(session: SleepSession): SleepCycleAnalytics {
  const totalMin = Math.max(1, session.durationMinutes || 1);
  const hasSplitFields =
    typeof session.lightSleepMin === 'number' &&
    typeof session.remSleepMin === 'number';

  let deepMin = Math.max(0, session.deepSleepMin || 0);
  let awakeMin = Math.max(0, session.awakeMin || 0);
  let lightMin = hasSplitFields ? Math.max(0, session.lightSleepMin!) : 0;
  let remMin = hasSplitFields ? Math.max(0, session.remSleepMin!) : 0;

  if (!hasSplitFields) {
    // Re-derive REM vs Light cleanly from timeline or physiological split for legacy records
    const remPts = session.timeline.filter((t) => t.phase === 'rem').length;
    const lightPts = session.timeline.filter((t) => t.phase === 'ligero').length;
    if (remPts > 0 || lightPts > 0) {
      const remShare = remPts / Math.max(1, remPts + lightPts);
      remMin = Math.round(session.lightRemSleepMin * remShare);
      lightMin = Math.max(0, session.lightRemSleepMin - remMin);
    } else {
      remMin = Math.round(session.lightRemSleepMin * 0.3);
      lightMin = Math.max(0, session.lightRemSleepMin - remMin);
    }
  }

  const deepPct = Math.round((deepMin / totalMin) * 100);
  const remPct = Math.round((remMin / totalMin) * 100);
  const lightPct = Math.round((lightMin / totalMin) * 100);
  const awakePct = Math.max(0, 100 - deepPct - remPct - lightPct);

  const completedCycles90 =
    typeof session.completedCycles90 === 'number'
      ? session.completedCycles90
      : Math.floor(totalMin / 90);
  const partialCycleMin = totalMin % 90;

  const computedRecovery = computePhysicalAndMentalRecovery({
    durationMinutes: totalMin,
    deepPct,
    remPct,
    awakePct,
    sleepQualityPct: session.sleepQualityPct,
  });

  const physicalRecoveryPct =
    typeof session.physicalRecoveryPct === 'number'
      ? session.physicalRecoveryPct
      : computedRecovery.physicalRecoveryPct;
  const mentalRecoveryPct =
    typeof session.mentalRecoveryPct === 'number'
      ? session.mentalRecoveryPct
      : computedRecovery.mentalRecoveryPct;
  const recommendation =
    session.recoveryRecommendation || computedRecovery.recommendation;

  const evalStatus = (pct: number, min: number, max: number): 'Óptimo' | 'Bajo' | 'Alto' => {
    if (pct < min) return 'Bajo';
    if (pct > max) return 'Alto';
    return 'Óptimo';
  };

  const phases: PhaseBreakdownMetric[] = [
    {
      phase: 'profundo',
      label: 'Sueño Profundo',
      minutes: deepMin,
      pct: deepPct,
      healthyRangeLabel: '15–25%',
      minHealthyPct: 15,
      maxHealthyPct: 25,
      status: evalStatus(deepPct, 15, 25),
      colorHex: '#34D399',
    },
    {
      phase: 'rem',
      label: 'Sueño REM',
      minutes: remMin,
      pct: remPct,
      healthyRangeLabel: '20–25%',
      minHealthyPct: 20,
      maxHealthyPct: 25,
      status: evalStatus(remPct, 20, 25),
      colorHex: '#22D3EE',
    },
    {
      phase: 'ligero',
      label: 'Sueño Ligero',
      minutes: lightMin,
      pct: lightPct,
      healthyRangeLabel: '45–55%',
      minHealthyPct: 45,
      maxHealthyPct: 55,
      status: evalStatus(lightPct, 45, 55),
      colorHex: '#60A5FA',
    },
    {
      phase: 'despierto',
      label: 'Despierto',
      minutes: awakeMin,
      pct: awakePct,
      healthyRangeLabel: '< 10%',
      minHealthyPct: 0,
      maxHealthyPct: 9,
      status: awakePct >= 10 ? 'Alto' : 'Óptimo',
      colorHex: '#FB923C',
    },
  ];

  return {
    deepMin,
    remMin,
    lightMin,
    awakeMin,
    deepPct,
    remPct,
    lightPct,
    awakePct,
    completedCycles90,
    partialCycleMin,
    physicalRecoveryPct,
    mentalRecoveryPct,
    recommendation,
    phases,
  };
}

export function computeSleepCycleRecommendations(
  mode: 'bedtime' | 'waketime',
  timeHHMM: string,
  latencyMin = 15,
): CycleTimeRecommendation[] {
  const [hStr, mStr] = timeHHMM.split(':');
  const h = Math.max(0, Math.min(23, Number.parseInt(hStr || '23', 10) || 0));
  const m = Math.max(0, Math.min(59, Number.parseInt(mStr || '0', 10) || 0));
  const baseMin = h * 60 + m;

  const formatMinOfDay = (totalM: number) => {
    const wrapped = ((totalM % 1440) + 1440) % 1440;
    const hh = Math.floor(wrapped / 60);
    const mm = wrapped % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  const cycleCounts = mode === 'bedtime' ? [4, 5, 6] : [6, 5, 4];
  return cycleCounts.map((cycles) => {
    const sleepMin = cycles * 90;
    const hrs = Math.floor(sleepMin / 60);
    const remM = sleepMin % 60;
    const sleepHoursLabel = remM > 0 ? `${hrs}h ${remM}m` : `${hrs}h`;
    const targetMinutes =
      mode === 'bedtime'
        ? baseMin + latencyMin + sleepMin
        : baseMin - sleepMin - latencyMin;
    return {
      cycles,
      sleepHoursLabel,
      timeHHMM: formatMinOfDay(targetMinutes),
      isRecommended: cycles === 5,
    };
  });
}

export function calculateSleepReadinessScore(
  sleepHours: number,
  sleepQuality1to5: number,
  energyLevel: number,
  sorenessLevel: number,
): number {
  const sleepHrScore = Math.min(30, Math.max(5, Math.round((sleepHours / 8) * 30)));
  const qualScore = Math.round(((sleepQuality1to5 - 1) / 4) * 25);
  const energyScore = Math.round(((energyLevel - 1) / 4) * 25);
  const sorenessScore = Math.round(((5 - sorenessLevel) / 4) * 20);
  return Math.max(10, Math.min(100, sleepHrScore + qualScore + energyScore + sorenessScore));
}

export function mapQualityPctToRating(qualityPct: number): number {
  if (qualityPct >= 86) return 5;
  if (qualityPct >= 70) return 4;
  if (qualityPct >= 54) return 3;
  if (qualityPct >= 38) return 2;
  return 1;
}

export function convertSleepToReadiness(
  session: SleepSession,
  existing?: DailyReadinessEntry | null,
): DailyReadinessEntry {
  const sleepHours = Math.max(
    1,
    Math.min(14, Math.round((session.durationMinutes / 60) * 10) / 10),
  );
  const sleepQuality = mapQualityPctToRating(session.sleepQualityPct);
  const energyLevel = existing?.energyLevel ?? (session.sleepQualityPct >= 75 ? 4 : 3);
  const sorenessLevel = existing?.sorenessLevel ?? 2;
  const score = calculateSleepReadinessScore(
    sleepHours,
    sleepQuality,
    energyLevel,
    sorenessLevel,
  );

  const analytics = computeSleepSessionAnalytics(session);

  return {
    date: session.date || getTodayIsoDate(),
    sleepHours,
    sleepQuality,
    energyLevel,
    sorenessLevel,
    score,
    updatedAt: new Date().toISOString(),
    source: 'sueno',
    sleepSessionId: session.id,
    physicalRecoveryPct: analytics.physicalRecoveryPct,
    mentalRecoveryPct: analytics.mentalRecoveryPct,
    sleepRecommendation: analytics.recommendation,
    deepSleepPct: analytics.deepPct,
    remSleepPct: analytics.remPct,
    completedCycles90: analytics.completedCycles90,
  };
}

export function buildSleepSessionFromSamples(params: {
  bedtimeAt: string;
  wakeUpAt: string;
  targetWakeTime: string;
  smartWindowMin: SleepSmartWindowMin;
  triggeredBySmartAlarm: boolean;
  soundscapeUsed: SleepSoundscapeType;
  micEnabled: boolean;
  motionEnabled: boolean;
  samples: LiveSleepEpochSample[];
  noiseEvents: SleepNoiseEvent[];
}): SleepSession {
  const startMs = Date.parse(params.bedtimeAt);
  const endMs = Date.parse(params.wakeUpAt);
  const elapsedMin = Math.max(
    1,
    Math.round(
      (Number.isNaN(endMs) || Number.isNaN(startMs) ? 60_000 : Math.max(60_000, endMs - startMs)) /
        60_000,
    ),
  );

  const rawSamples =
    params.samples.length > 0
      ? params.samples
      : [
          {
            minuteOffset: 0,
            timestamp: params.bedtimeAt,
            movementScore: 22,
            audioDbLevel: 14,
            audioVariability: 10,
          },
          {
            minuteOffset: elapsedMin,
            timestamp: params.wakeUpAt,
            movementScore: 28,
            audioDbLevel: 16,
            audioVariability: 20,
          },
        ];

  const intervalSamples = bucketSamplesTo5MinIntervals(
    rawSamples,
    params.bedtimeAt,
    elapsedMin,
  );

  const timeline: SleepTimelinePoint[] = intervalSamples.map((s) => ({
    minuteOffset: s.minuteOffset,
    timestamp: s.timestamp,
    phase: classifySleepPhase(
      s.minuteOffset,
      s.movementScore,
      s.audioDbLevel,
      s.audioVariability ?? 14,
      elapsedMin,
    ),
    movementScore: Math.round(s.movementScore),
    audioDbLevel: Math.round(s.audioDbLevel),
    audioVariability: Math.round(s.audioVariability ?? 14),
    snoreOrNoiseEvent: s.snoreOrNoiseEvent,
  }));

  const deepCount = timeline.filter((t) => t.phase === 'profundo').length;
  const remCount = timeline.filter((t) => t.phase === 'rem').length;
  const awakeCount = timeline.filter((t) => t.phase === 'despierto').length;
  const totalPts = Math.max(1, timeline.length);

  const deepSleepMin = Math.round((deepCount / totalPts) * elapsedMin);
  const remSleepMin = Math.round((remCount / totalPts) * elapsedMin);
  const awakeMin = Math.round((awakeCount / totalPts) * elapsedMin);
  const lightSleepMin = Math.max(0, elapsedMin - deepSleepMin - remSleepMin - awakeMin);
  const lightRemSleepMin = lightSleepMin + remSleepMin;

  const avgMovement =
    timeline.reduce((acc, t) => acc + t.movementScore, 0) / totalPts;

  const deepPct = Math.round((deepSleepMin / Math.max(1, elapsedMin)) * 100);
  const remPct = Math.round((remSleepMin / Math.max(1, elapsedMin)) * 100);
  const awakePct = Math.round((awakeMin / Math.max(1, elapsedMin)) * 100);

  const durationScore = Math.min(40, (elapsedMin / 450) * 40); // 7.5h = 40 pts
  const deepRatioScore = Math.min(22, (deepPct / 20) * 22);
  const remRatioScore = Math.min(18, (remPct / 22) * 18);
  const continuityScore = Math.max(0, 20 - (awakePct / 100) * 70 - (avgMovement / 100) * 8);

  const sleepQualityPct = Math.max(
    25,
    Math.min(98, Math.round(durationScore + deepRatioScore + remRatioScore + continuityScore)),
  );

  const completedCycles90 = Math.floor(elapsedMin / 90);
  const recovery = computePhysicalAndMentalRecovery({
    durationMinutes: elapsedMin,
    deepPct,
    remPct,
    awakePct,
    sleepQualityPct,
  });

  const snoreEventsCount = params.noiseEvents.filter((e) => e.type === 'ronquido').length;
  const noiseEventsCount = params.noiseEvents.length;

  const wakeDate = new Date(Number.isNaN(endMs) ? Date.now() : endMs);
  const y = wakeDate.getFullYear();
  const m = String(wakeDate.getMonth() + 1).padStart(2, '0');
  const d = String(wakeDate.getDate()).padStart(2, '0');

  return {
    id: `sleep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date: `${y}-${m}-${d}`,
    bedtimeAt: params.bedtimeAt,
    wakeUpAt: params.wakeUpAt,
    targetWakeTime: params.targetWakeTime,
    smartWindowMin: params.smartWindowMin,
    triggeredBySmartAlarm: params.triggeredBySmartAlarm,
    durationMinutes: elapsedMin,
    sleepQualityPct,
    deepSleepMin,
    lightRemSleepMin,
    lightSleepMin,
    remSleepMin,
    awakeMin,
    completedCycles90,
    physicalRecoveryPct: recovery.physicalRecoveryPct,
    mentalRecoveryPct: recovery.mentalRecoveryPct,
    recoveryRecommendation: recovery.recommendation,
    snoreEventsCount,
    noiseEventsCount,
    movementIndex: Math.round(avgMovement),
    soundscapeUsed: params.soundscapeUsed,
    micEnabled: params.micEnabled,
    motionEnabled: params.motionEnabled,
    timeline,
    noiseEvents: params.noiseEvents,
  };
}

export function buildDemoSleepSession(params: {
  targetWakeTime: string;
  smartWindowMin: SleepSmartWindowMin;
  soundscapeUsed: SleepSoundscapeType;
}): SleepSession {
  const durationMinutes = 465; // 7 h 45 min (5 ciclos completos de 90 min)
  const endMs = Date.now();
  const startMs = endMs - durationMinutes * 60_000;
  const bedtimeAt = new Date(startMs).toISOString();
  const wakeUpAt = new Date(endMs).toISOString();

  const stepMin = 5;
  const samples: LiveSleepEpochSample[] = [];
  const noiseEvents: SleepNoiseEvent[] = [];

  for (let min = 0; min <= durationMinutes; min += stepMin) {
    const ts = new Date(startMs + min * 60_000).toISOString();
    const cyclePhase = (min % 90) / 90;
    const nightProgress = min / durationMinutes;

    let movement = 24;
    let audio = 14;
    let variability = 12;
    let hasNoise = false;

    if (min <= 10 || min >= durationMinutes - 10) {
      movement = min >= durationMinutes - 10 ? 34 : 28;
      audio = 20;
      variability = 16;
    } else if (min === 170 || min === 365) {
      // Two brief awakenings
      movement = 58;
      audio = 44;
      variability = 36;
      hasNoise = true;
      noiseEvents.push({
        id: `sn_${min}`,
        timestamp: ts,
        minuteOffset: min,
        type: 'movimiento',
        intensity: 60,
        label: 'Micro-despertar y cambio de postura',
      });
    } else if (min === 105 || min === 285 || min === 330) {
      movement = 14;
      audio = 46;
      variability = 30;
      hasNoise = true;
      noiseEvents.push({
        id: `sn_${min}`,
        timestamp: ts,
        minuteOffset: min,
        type: 'ronquido',
        intensity: min === 285 ? 56 : 44,
        label: min === 285 ? 'Ronquido moderado detectado' : 'Ronquido leve detectado',
      });
    } else if (nightProgress <= 0.5 && cyclePhase >= 0.16 && cyclePhase <= 0.52) {
      // Deep sleep weighted heavily to 1st half of night
      movement = 7;
      audio = 9;
      variability = 8;
    } else if (nightProgress >= 0.42 && cyclePhase >= 0.58) {
      // REM sleep expanding in 2nd half & dawn
      movement = 13;
      audio = 22;
      variability = 28;
    } else if (nightProgress > 0.5 && cyclePhase >= 0.16 && cyclePhase <= 0.28) {
      // Brief late deep touch
      movement = 9;
      audio = 10;
      variability = 9;
    } else {
      // Light sleep transitions
      movement = 24;
      audio = 15;
      variability = 13;
    }

    samples.push({
      minuteOffset: min,
      timestamp: ts,
      movementScore: movement,
      audioDbLevel: audio,
      audioVariability: variability,
      snoreOrNoiseEvent: hasNoise,
    });
  }

  return buildSleepSessionFromSamples({
    bedtimeAt,
    wakeUpAt,
    targetWakeTime: params.targetWakeTime,
    smartWindowMin: params.smartWindowMin,
    triggeredBySmartAlarm: true,
    soundscapeUsed: params.soundscapeUsed,
    micEnabled: true,
    motionEnabled: true,
    samples,
    noiseEvents,
  });
}

function getAudioContextClass(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

export class SleepSoundscapeEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private stopNodes: (() => void)[] = [];
  private activeType: SleepSoundscapeType = 'ninguno';
  private volume = 0.55;

  public getIsPlaying(): boolean {
    return this.ctx !== null && this.activeType !== 'ninguno';
  }

  public getActiveType(): SleepSoundscapeType {
    return this.activeType;
  }

  public start(type: SleepSoundscapeType, volume = 0.55): void {
    this.stopImmediate();
    if (type === 'ninguno') {
      this.activeType = 'ninguno';
      return;
    }

    const AudioCtx = getAudioContextClass();
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const masterGain = ctx.createGain();
    this.volume = Math.max(0.02, Math.min(1, volume));
    masterGain.gain.setValueAtTime(0.001, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(this.volume * 0.45, ctx.currentTime + 1.6);
    masterGain.connect(ctx.destination);

    this.ctx = ctx;
    this.masterGain = masterGain;
    this.activeType = type;

    if (type === 'lluvia') {
      this.buildRainGraph(ctx, masterGain);
    } else if (type === 'ruido_marron') {
      this.buildBrownNoiseGraph(ctx, masterGain);
    } else if (type === 'frecuencia_432') {
      this.buildRelaxingFrequencyGraph(ctx, masterGain);
    }
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.volume * 0.45,
        this.ctx.currentTime,
        0.15,
      );
    }
  }

  public fadeOutAndStop(durationSec = 4): void {
    if (!this.ctx || !this.masterGain) {
      this.stopImmediate();
      return;
    }
    const ctx = this.ctx;
    const gain = this.masterGain;
    try {
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + durationSec);
    } catch {
      // Ignore audio automation error
    }
    window.setTimeout(() => {
      if (this.ctx === ctx) {
        this.stopImmediate();
      }
    }, durationSec * 1000 + 120);
  }

  public stopImmediate(): void {
    for (const cleanup of this.stopNodes) {
      try {
        cleanup();
      } catch {
        // Ignore
      }
    }
    this.stopNodes = [];
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        // Ignore
      }
    }
    this.ctx = null;
    this.masterGain = null;
    this.activeType = 'ninguno';
  }

  private buildBrownNoiseGraph(ctx: AudioContext, dest: AudioNode): void {
    const bufferSize = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i += 1) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = output[i];
      output[i] *= 3.2;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 260;

    source.connect(lowpass);
    lowpass.connect(dest);
    source.start();

    this.stopNodes.push(() => {
      source.stop();
      source.disconnect();
      lowpass.disconnect();
    });
  }

  private buildRainGraph(ctx: AudioContext, dest: AudioNode): void {
    const bufferSize = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < bufferSize; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      output[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 920;
    bandpass.Q.value = 0.55;

    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 2200;

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.14; // gentle rain swell every ~7s
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(bandpass.frequency);

    source.connect(bandpass);
    bandpass.connect(warmth);
    warmth.connect(dest);
    source.start();
    lfo.start();

    this.stopNodes.push(() => {
      source.stop();
      lfo.stop();
      source.disconnect();
      lfo.disconnect();
      bandpass.disconnect();
      warmth.disconnect();
    });
  }

  private buildRelaxingFrequencyGraph(ctx: AudioContext, dest: AudioNode): void {
    // 432 Hz warm harmonic drone + 216 Hz sub-octave + 4 Hz theta pulse
    const oscPrimary = ctx.createOscillator();
    oscPrimary.type = 'sine';
    oscPrimary.frequency.value = 432;

    const oscSub = ctx.createOscillator();
    oscSub.type = 'sine';
    oscSub.frequency.value = 216;

    const oscFifth = ctx.createOscillator();
    oscFifth.type = 'sine';
    oscFifth.frequency.value = 324;

    const gPrimary = ctx.createGain();
    gPrimary.gain.value = 0.18;

    const gSub = ctx.createGain();
    gSub.gain.value = 0.24;

    const gFifth = ctx.createGain();
    gFifth.gain.value = 0.08;

    const breathLfo = ctx.createOscillator();
    breathLfo.frequency.value = 0.18;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.06;
    breathLfo.connect(breathGain);
    breathGain.connect(gPrimary.gain);

    oscPrimary.connect(gPrimary);
    oscSub.connect(gSub);
    oscFifth.connect(gFifth);

    gPrimary.connect(dest);
    gSub.connect(dest);
    gFifth.connect(dest);

    oscPrimary.start();
    oscSub.start();
    oscFifth.start();
    breathLfo.start();

    this.stopNodes.push(() => {
      oscPrimary.stop();
      oscSub.stop();
      oscFifth.stop();
      breathLfo.stop();
      oscPrimary.disconnect();
      oscSub.disconnect();
      oscFifth.disconnect();
      breathLfo.disconnect();
    });
  }
}

export class ProgressiveAlarmEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private intervalId: number | null = null;
  private active = false;
  private stepCount = 0;

  public isRunning(): boolean {
    return this.active;
  }

  public start(): void {
    if (this.active) return;
    const AudioCtx = getAudioContextClass();
    this.active = true;
    this.stepCount = 0;

    if (AudioCtx) {
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const masterGain = ctx.createGain();
      // Start ultra soft and progressively ramp up over 45 seconds
      masterGain.gain.setValueAtTime(0.05, ctx.currentTime);
      masterGain.gain.linearRampToValueAtTime(0.75, ctx.currentTime + 45);
      masterGain.connect(ctx.destination);
      this.ctx = ctx;
      this.masterGain = masterGain;
    }

    const playChimePhrase = () => {
      if (!this.active) return;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([200, 140, 220]);
        } catch {
          // Ignore vibration error
        }
      }

      if (!this.ctx || !this.masterGain) return;
      const ctx = this.ctx;
      const dest = this.masterGain;
      const notes = [523.25, 659.25, 783.99, 987.77]; // C5 E5 G5 B5 gentle chime
      const now = ctx.currentTime;

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.28);

        env.gain.setValueAtTime(0.001, now + idx * 0.28);
        env.gain.linearRampToValueAtTime(0.32, now + idx * 0.28 + 0.08);
        env.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.28 + 1.4);

        osc.connect(env);
        env.connect(dest);
        osc.start(now + idx * 0.28);
        osc.stop(now + idx * 0.28 + 1.5);
      });

      this.stepCount += 1;
    };

    playChimePhrase();
    this.intervalId = window.setInterval(playChimePhrase, 3000);
  }

  public stop(): void {
    this.active = false;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(0);
      } catch {
        // Ignore
      }
    }
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        // Ignore
      }
      this.ctx = null;
      this.masterGain = null;
    }
  }
}
