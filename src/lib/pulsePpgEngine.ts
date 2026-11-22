import type {
  BloodPressureCategory,
  DailyReadinessEntry,
  PulseHrvRecord,
} from '../types/fitness';
import { calculateSleepReadinessScore } from './sleepEngine';
import { getTodayIsoDate } from './storage';

export interface PpgSample {
  t: number; // ms timestamp (performance.now or Date.now)
  v: number; // average red intensity (0..255)
  g?: number; // average green intensity (0..255) for dual-channel detrending
  redCoveragePct?: number; // 0..100 fraction of ROI pixels covered by illuminated finger
}

export type FingerPlacementStatus = 'bien_puesto' | 'ajustar' | 'sin_dedo';

export const PPG_MIN_BPM = 45;
export const PPG_MAX_BPM = 190;
export const PPG_MIN_PEAK_DISTANCE_MS = 350; // Allows up to ~171 BPM while suppressing dicrotic notches
export const PPG_HIGHPASS_WINDOW_MS = 800; // 0.8s moving average baseline
export const PPG_MIN_SIGNAL_QUALITY_PCT = 70;
export const PPG_MIN_VALID_BEATS = 10;

// Strict optical finger + LED flash saturation thresholds
export const PPG_STRICT_MIN_RED_AVG = 175;
export const PPG_STRICT_RED_DOMINANCE_RATIO = 1.8;

export function analyzeRgbFrame(
  data: Uint8ClampedArray,
): {
  avgR: number;
  avgG: number;
  avgB: number;
  redCoveragePct: number;
  fingerStatus: FingerPlacementStatus;
  isFingerDetected: boolean;
} {
  const pixelCount = Math.max(1, data.length / 4);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let redPixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;

    if (
      r > PPG_STRICT_MIN_RED_AVG &&
      r > g * PPG_STRICT_RED_DOMINANCE_RATIO &&
      r > b * PPG_STRICT_RED_DOMINANCE_RATIO
    ) {
      redPixels += 1;
    }
  }

  const avgR = sumR / pixelCount;
  const avgG = sumG / pixelCount;
  const avgB = sumB / pixelCount;

  // Strict check: high red channel saturation (avgR > 175) & strong red dominance over green/blue (R > G * 1.8, R > B * 1.8)
  const redOverGreen = avgR / Math.max(1, avgG);
  const redOverBlue = avgR / Math.max(1, avgB);
  const pixelCoverage = (redPixels / pixelCount) * 100;
  const dominanceScore = Math.min(
    100,
    Math.max(0, ((avgR - Math.max(avgG, avgB) * PPG_STRICT_RED_DOMINANCE_RATIO) / 110) * 100),
  );
  const redCoveragePct = Math.max(
    0,
    Math.min(100, Math.round(pixelCoverage * 0.78 + dominanceScore * 0.22)),
  );

  const strictRedMet =
    avgR > PPG_STRICT_MIN_RED_AVG &&
    avgR > avgG * PPG_STRICT_RED_DOMINANCE_RATIO &&
    avgR > avgB * PPG_STRICT_RED_DOMINANCE_RATIO &&
    redCoveragePct >= 65;

  let fingerStatus: FingerPlacementStatus = 'sin_dedo';
  if (strictRedMet) {
    fingerStatus = 'bien_puesto';
  } else if (
    avgR >= 120 &&
    redOverGreen >= 1.35 &&
    redOverBlue >= 1.35 &&
    redCoveragePct >= 25
  ) {
    fingerStatus = 'ajustar';
  }

  return {
    avgR,
    avgG,
    avgB,
    redCoveragePct,
    fingerStatus,
    isFingerDetected: strictRedMet,
  };
}

function highPassMovingAvg(
  samples: { t: number; val: number }[],
  halfWindowMs: number,
): number[] {
  const out = new Array<number>(samples.length);
  let left = 0;
  let right = 0;
  let rollingSum = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const ti = samples[i].t;
    while (right < samples.length && samples[right].t <= ti + halfWindowMs) {
      rollingSum += samples[right].val;
      right += 1;
    }
    while (left < i && samples[left].t < ti - halfWindowMs) {
      rollingSum -= samples[left].val;
      left += 1;
    }
    const count = Math.max(1, right - left);
    const baseline = rollingSum / count;
    out[i] = samples[i].val - baseline;
  }
  return out;
}

export function detrendPpgSeries(samples: PpgSample[]): { t: number; ac: number }[] {
  if (samples.length < 6) return samples.map((s) => ({ t: s.t, ac: 0 }));

  const halfHighPassMs = PPG_HIGHPASS_WINDOW_MS / 2;

  const redHp = highPassMovingAvg(
    samples.map((s) => ({ t: s.t, val: s.v })),
    halfHighPassMs,
  );

  const hasGreen = samples.some((s) => typeof s.g === 'number');
  const greenHp = hasGreen
    ? highPassMovingAvg(
        samples.map((s) => ({ t: s.t, val: typeof s.g === 'number' ? s.g : s.v })),
        halfHighPassMs,
      )
    : null;

  const avgRedMean = samples.reduce((acc, s) => acc + s.v, 0) / samples.length;
  const redSaturated = avgRedMean >= 244;

  const highPassed: { t: number; hp: number }[] = samples.map((s, i) => {
    if (!greenHp) {
      return { t: s.t, hp: redHp[i] };
    }
    // Use green channel more heavily only if red sensor clips completely near 255
    const blended = redSaturated
      ? redHp[i] * 0.35 + greenHp[i] * 0.65
      : redHp[i] * 0.72 + greenHp[i] * 0.28;
    return { t: s.t, hp: blended };
  });

  // Smooth curve (~150ms triangular window) to attenuate finger micro-tremors (>5 Hz)
  const smoothHalfMs = 75;
  const smoothed: { t: number; ac: number }[] = new Array(highPassed.length);
  for (let i = 0; i < highPassed.length; i += 1) {
    const ti = highPassed[i].t;
    let wSum = 0;
    let wTotal = 0;
    for (let j = i; j >= 0 && ti - highPassed[j].t <= smoothHalfMs; j -= 1) {
      const w = 1 - (ti - highPassed[j].t) / (smoothHalfMs + 1);
      wSum += highPassed[j].hp * w;
      wTotal += w;
    }
    for (
      let j = i + 1;
      j < highPassed.length && highPassed[j].t - ti <= smoothHalfMs;
      j += 1
    ) {
      const w = 1 - (highPassed[j].t - ti) / (smoothHalfMs + 1);
      wSum += highPassed[j].hp * w;
      wTotal += w;
    }
    smoothed[i] = { t: ti, ac: wTotal > 0 ? wSum / wTotal : highPassed[i].hp };
  }

  return smoothed;
}

function medianOfSortedOrRaw(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeBpmAndHrv(samples: PpgSample[]): {
  bpm: number;
  hrvRmssdMs: number;
  signalQualityPct: number;
  validBeats: number;
  waveformPreview: number[];
} {
  const detrended = detrendPpgSeries(samples);
  if (detrended.length < 24) {
    return {
      bpm: 0,
      hrvRmssdMs: 0,
      signalQualityPct: 0,
      validBeats: 0,
      waveformPreview: [],
    };
  }

  // Skip initial 0.8s edge transient if the series is long enough
  const startTime = detrended[0].t + 800;
  const active = detrended.filter((p) => p.t >= startTime);
  const work = active.length >= 20 ? active : detrended;

  const mean = work.reduce((acc, p) => acc + p.ac, 0) / work.length;
  const variance =
    work.reduce((acc, p) => acc + (p.ac - mean) ** 2, 0) / work.length;
  const stdDev = Math.sqrt(variance);

  // Build normalized 42-point preview from last ~6 seconds
  const tail = work.slice(-90);
  const minTail = Math.min(...tail.map((p) => p.ac));
  const maxTail = Math.max(...tail.map((p) => p.ac));
  const spanTail = Math.max(0.001, maxTail - minTail);
  const step = Math.max(1, Math.floor(tail.length / 42));
  const waveformPreview: number[] = [];
  for (let i = 0; i < tail.length && waveformPreview.length < 42; i += step) {
    waveformPreview.push(Math.round(((tail[i].ac - minTail) / spanTail) * 100));
  }

  // Reject flat / dead signal or violent motion saturation
  if (stdDev < 0.06 || stdDev > 14) {
    return {
      bpm: 0,
      hrvRmssdMs: 0,
      signalQualityPct: 0,
      validBeats: 0,
      waveformPreview,
    };
  }

  // Peak detection enforcing physiological refractory distance
  const threshold = Math.max(0.08, stdDev * 0.42);
  const peakTimes: number[] = [];
  const peakAmps: number[] = [];

  for (let i = 1; i < work.length - 1; i += 1) {
    const curr = work[i].ac;
    const prev = work[i - 1].ac;
    const next = work[i + 1].ac;
    const prev2 = i >= 2 ? work[i - 2].ac : prev;
    const next2 = i + 2 < work.length ? work[i + 2].ac : next;

    if (
      curr > threshold &&
      curr >= prev &&
      curr >= next &&
      curr > prev2 &&
      curr > next2
    ) {
      const lastPeakT = peakTimes[peakTimes.length - 1];
      if (lastPeakT === undefined || work[i].t - lastPeakT >= PPG_MIN_PEAK_DISTANCE_MS) {
        peakTimes.push(work[i].t);
        peakAmps.push(curr);
      } else {
        const lastIdx = peakAmps.length - 1;
        if (lastIdx >= 0 && curr > peakAmps[lastIdx]) {
          peakTimes[lastIdx] = work[i].t;
          peakAmps[lastIdx] = curr;
        }
      }
    }
  }

  const minIbiMs = Math.max(PPG_MIN_PEAK_DISTANCE_MS, Math.round(60000 / PPG_MAX_BPM));
  const maxIbiMs = Math.round(60000 / PPG_MIN_BPM);

  const rawIbis: number[] = [];
  for (let i = 1; i < peakTimes.length; i += 1) {
    const diff = peakTimes[i] - peakTimes[i - 1];
    if (diff >= minIbiMs && diff <= maxIbiMs) {
      rawIbis.push(diff);
    }
  }

  if (rawIbis.length < 4) {
    return {
      bpm: 0,
      hrvRmssdMs: 0,
      signalQualityPct: Math.min(35, peakTimes.length * 4),
      validBeats: peakTimes.length,
      waveformPreview,
    };
  }

  // Rolling median filter: discard any RR/IBI deviating >20% from the median of recent valid beats
  const globalAnchorMedian = medianOfSortedOrRaw(rawIbis);
  const recentValidWindow: number[] = [];
  const rollingValidFlags = new Array<boolean>(rawIbis.length).fill(false);

  for (let i = 0; i < rawIbis.length; i += 1) {
    const ibi = rawIbis[i];
    const refMedian =
      recentValidWindow.length >= 3
        ? medianOfSortedOrRaw(recentValidWindow.slice(-5))
        : globalAnchorMedian;

    if (refMedian > 0 && Math.abs(ibi - refMedian) / refMedian <= 0.2) {
      rollingValidFlags[i] = true;
      recentValidWindow.push(ibi);
      if (recentValidWindow.length > 7) {
        recentValidWindow.shift();
      }
    }
  }

  const firstPassClean = rawIbis.filter((_, idx) => rollingValidFlags[idx]);
  if (firstPassClean.length < 4) {
    return {
      bpm: 0,
      hrvRmssdMs: 0,
      signalQualityPct: Math.min(45, firstPassClean.length * 10),
      validBeats: firstPassClean.length,
      waveformPreview,
    };
  }

  // Verification pass against clean IBI median (strict <= 20% tolerance)
  const cleanMedian = medianOfSortedOrRaw(firstPassClean);
  const finalValidFlags = rawIbis.map(
    (ibi, idx) =>
      rollingValidFlags[idx] &&
      cleanMedian > 0 &&
      Math.abs(ibi - cleanMedian) / cleanMedian <= 0.2,
  );
  const cleanIbis = rawIbis.filter((_, idx) => finalValidFlags[idx]);

  if (cleanIbis.length < 4) {
    return {
      bpm: 0,
      hrvRmssdMs: 0,
      signalQualityPct: Math.min(45, cleanIbis.length * 10),
      validBeats: cleanIbis.length,
      waveformPreview,
    };
  }

  const meanIbi = cleanIbis.reduce((acc, v) => acc + v, 0) / cleanIbis.length;
  const rawBpm = Math.round(60000 / meanIbi);
  const bpm = Math.max(PPG_MIN_BPM, Math.min(PPG_MAX_BPM, rawBpm));

  // RMSSD strictly across consecutive clean intervals; reject instantaneous noise spikes > 16% of mean IBI
  const maxStepDiffMs = Math.min(130, meanIbi * 0.16);
  let sqDiffSum = 0;
  let diffCount = 0;
  for (let i = 1; i < rawIbis.length; i += 1) {
    if (finalValidFlags[i] && finalValidFlags[i - 1]) {
      const diff = rawIbis[i] - rawIbis[i - 1];
      if (Math.abs(diff) <= maxStepDiffMs) {
        sqDiffSum += diff * diff;
        diffCount += 1;
      }
    }
  }

  if (diffCount < 3) {
    return {
      bpm: 0,
      hrvRmssdMs: 0,
      signalQualityPct: Math.min(45, cleanIbis.length * 6),
      validBeats: cleanIbis.length,
      waveformPreview,
    };
  }

  const rawRmssd = Math.sqrt(sqDiffSum / diffCount);
  // Physiological cap scaled to cardiac cycle so high BPM cannot produce impossible resting RMSSD spikes
  const cycleAwareCapMs = Math.min(115, Math.max(38, Math.round(meanIbi * 0.14)));
  const hrvRmssdMs = Math.max(8, Math.min(cycleAwareCapMs, Math.round(rawRmssd)));

  // Signal quality factors: strict finger coverage (avgR > 175 & >= 65% ROI), IBI consistency, and beat count
  const samplesWithCoverage = samples.filter(
    (s) => typeof s.redCoveragePct === 'number',
  );
  const fingerCoverageFactor =
    samplesWithCoverage.length > 0
      ? samplesWithCoverage.filter(
          (s) => (s.redCoveragePct ?? 0) >= 65 && s.v > PPG_STRICT_MIN_RED_AVG,
        ).length / samplesWithCoverage.length
      : samples.filter((s) => s.v > PPG_STRICT_MIN_RED_AVG).length / Math.max(1, samples.length);

  const consistencyRatio = cleanIbis.length / Math.max(1, rawIbis.length);
  const validBeats = cleanIbis.length + 1;
  const beatCountFactor = Math.min(1, validBeats / PPG_MIN_VALID_BEATS);
  const motionPenalty = stdDev > 8 ? Math.max(0.4, 1 - (stdDev - 8) * 0.1) : 1;

  const signalQualityPct = Math.max(
    0,
    Math.min(
      98,
      Math.round(
        (consistencyRatio * 0.45 +
          fingerCoverageFactor * 0.35 +
          beatCountFactor * 0.2) *
          motionPenalty *
          100,
      ),
    ),
  );

  return {
    bpm,
    hrvRmssdMs,
    signalQualityPct,
    validBeats,
    waveformPreview,
  };
}

/**
 * Computes physiological Stress % (5..95) inversely coherent with filtered HRV RMSSD and resting BPM:
 * - Higher filtered RMSSD & lower resting BPM -> Lower Stress %
 * - Lower filtered RMSSD & elevated BPM -> Higher Stress %
 */
export function computeStressPct(bpm: number, hrvRmssdMs: number): number {
  const safeBpm = Math.max(40, Math.min(200, bpm));
  const safeHrv = Math.max(6, Math.min(140, hrvRmssdMs));

  // RMSSD 10ms -> 0 relaxation, 78ms+ -> 1 full vagal tone
  const hrvRelaxFactor = Math.max(0, Math.min(1, (safeHrv - 10) / 68));
  // Resting BPM 52 -> 0 cardiac load, 110+ -> 1 elevated load
  const bpmLoadFactor = Math.max(0, Math.min(1, (safeBpm - 52) / 58));

  const stressRaw = (1 - hrvRelaxFactor) * 68 + bpmLoadFactor * 32;
  return Math.max(5, Math.min(95, Math.round(stressRaw)));
}

export function computePulseRecoveryImpact(bpm: number, hrvRmssdMs: number): number {
  const stressPct = computeStressPct(bpm, hrvRmssdMs);
  return Math.max(5, Math.min(98, 100 - stressPct));
}

export function applyPulseToReadiness(
  record: PulseHrvRecord,
  existing?: DailyReadinessEntry | null,
): DailyReadinessEntry {
  const sleepHours = existing?.sleepHours ?? 7.5;
  const sleepQuality = existing?.sleepQuality ?? 4;
  const sorenessLevel = existing?.sorenessLevel ?? 2;

  const hrvEnergy =
    record.recoveryImpactScore >= 80
      ? 5
      : record.recoveryImpactScore >= 64
        ? 4
        : record.recoveryImpactScore >= 46
          ? 3
          : record.recoveryImpactScore >= 30
            ? 2
            : 1;

  const baseScore = calculateSleepReadinessScore(
    sleepHours,
    sleepQuality,
    hrvEnergy,
    sorenessLevel,
  );
  const blendedScore = Math.max(
    10,
    Math.min(100, Math.round(baseScore * 0.7 + record.recoveryImpactScore * 0.3)),
  );

  return {
    date: record.date || getTodayIsoDate(),
    sleepHours,
    sleepQuality,
    energyLevel: hrvEnergy,
    sorenessLevel,
    score: blendedScore,
    updatedAt: new Date().toISOString(),
    source: 'ppg',
    sleepSessionId: existing?.sleepSessionId,
    physicalRecoveryPct: existing?.physicalRecoveryPct,
    mentalRecoveryPct: existing?.mentalRecoveryPct,
    sleepRecommendation: existing?.sleepRecommendation,
    deepSleepPct: existing?.deepSleepPct,
    remSleepPct: existing?.remSleepPct,
    completedCycles90: existing?.completedCycles90,
    restingBpm: record.bpm,
    hrvRmssdMs: record.hrvRmssdMs,
    pulseRecordId: record.id,
  };
}

export function classifyBloodPressure(
  systolic: number,
  diastolic: number,
): {
  category: BloodPressureCategory;
  labelColor: string;
  dotColor: string;
  borderBg: string;
  advice: string;
} {
  if (systolic < 90 || diastolic < 60) {
    return {
      category: 'Baja',
      labelColor: 'text-sky-300',
      dotColor: 'bg-sky-400',
      borderBg: 'border-sky-400/35 bg-sky-500/10',
      advice: 'Presión por debajo del rango estándar. Hidrátate bien y evita cambios bruscos.',
    };
  }
  if (systolic < 120 && diastolic < 80) {
    return {
      category: 'Normal',
      labelColor: 'text-emerald-300',
      dotColor: 'bg-emerald-400',
      borderBg: 'border-emerald-500/35 bg-emerald-500/10',
      advice: 'Rango cardiovascular óptimo para entrenar y recuperar.',
    };
  }
  if (systolic >= 120 && systolic <= 129 && diastolic < 80) {
    return {
      category: 'Elevada',
      labelColor: 'text-amber-300',
      dotColor: 'bg-amber-400',
      borderBg: 'border-amber-400/35 bg-amber-500/10',
      advice: 'Ligeramente elevada. Prioriza respiración tranquila, hidratación y sueño.',
    };
  }
  if ((systolic >= 130 && systolic <= 139) || (diastolic >= 80 && diastolic <= 89)) {
    return {
      category: 'Alta Nivel 1',
      labelColor: 'text-orange-300',
      dotColor: 'bg-orange-400',
      borderBg: 'border-orange-500/35 bg-orange-500/10',
      advice: 'Presión alta etapa 1. Realiza tomas en reposo y modera estimulantes.',
    };
  }
  return {
    category: 'Alta Nivel 2',
    labelColor: 'text-rose-300',
    dotColor: 'bg-rose-500',
    borderBg: 'border-rose-500/40 bg-rose-500/15',
    advice: 'Presión alta etapa 2. Repite en reposo tras 5 minutos y consulta a tu médico.',
  };
}
