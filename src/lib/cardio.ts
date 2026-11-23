import { kmToDisplayDistance, paceSecPerKmToUnit } from './units';
import type { CardioActivityType, DistanceUnit, GpsPoint } from '../types/fitness';

export const ACTIVITY_OPTIONS: {
  id: CardioActivityType;
  label: string;
  usesGps: boolean;
  defaultMet: number;
  subtitle: string;
}[] = [
  {
    id: 'correr',
    label: 'Correr',
    usesGps: true,
    defaultMet: 9.8,
    subtitle: 'GPS en vivo + parciales',
  },
  {
    id: 'caminar',
    label: 'Caminar',
    usesGps: true,
    defaultMet: 3.8,
    subtitle: 'GPS en vivo + pasos',
  },
  {
    id: 'ciclismo',
    label: 'Ciclismo',
    usesGps: true,
    defaultMet: 7.5,
    subtitle: 'GPS ruta + velocidad',
  },
  {
    id: 'caminadora',
    label: 'Caminadora',
    usesGps: false,
    defaultMet: 8.5,
    subtitle: 'Interior sin GPS',
  },
];

export function getActivityMeta(type: CardioActivityType) {
  return ACTIVITY_OPTIONS.find((a) => a.id === type) ?? ACTIVITY_OPTIONS[0];
}

export const GPS_INITIAL_MAX_ACCURACY_M = 50;
export const GPS_SUBSEQUENT_MAX_ACCURACY_M = 25;
export const GPS_MIN_DISPLACEMENT_METERS = 2;
export const GPS_MAX_INSTANT_SPEED_MPS = 9.72; // 35 km/h
export const GPS_MAX_INSTANT_SPEED_KMH = 35;

export type GpsSignalQuality = 'optima' | 'aceptable' | 'buscando';

export function classifyGpsSignalQuality(accuracyM: number | null): {
  quality: GpsSignalQuality;
  label: string;
} {
  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM > 25) {
    return { quality: 'buscando', label: 'Buscando señal' };
  }
  if (accuracyM <= 10) {
    return { quality: 'optima', label: 'Óptima' };
  }
  return { quality: 'aceptable', label: 'Aceptable' };
}

export function haversineDistanceKm(a: GpsPoint, b: GpsPoint): number {
  const R = 6371; // km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

export type GpsPointValidationResult =
  | {
      accepted: true;
      isInitial: boolean;
      distanceKm: number;
      distanceMeters: number;
      dtSec: number;
      speedMps: number;
      speedKmh: number;
    }
  | {
      accepted: false;
      reason: 'accuracy' | 'drift' | 'speed_jump' | 'invalid_timestamp';
      distanceMeters?: number;
      speedMps?: number;
    };

export function validateGpsPoint(
  candidate: GpsPoint,
  lastValidPoint: GpsPoint | null,
): GpsPointValidationResult {
  const accuracy =
    typeof candidate.accuracyM === 'number' && Number.isFinite(candidate.accuracyM)
      ? candidate.accuracyM
      : Infinity;

  if (!lastValidPoint) {
    if (accuracy > GPS_INITIAL_MAX_ACCURACY_M) {
      return { accepted: false, reason: 'accuracy' };
    }
    return {
      accepted: true,
      isInitial: true,
      distanceKm: 0,
      distanceMeters: 0,
      dtSec: 0,
      speedMps: 0,
      speedKmh: 0,
    };
  }

  if (accuracy > GPS_SUBSEQUENT_MAX_ACCURACY_M) {
    return { accepted: false, reason: 'accuracy' };
  }

  const distanceKm = haversineDistanceKm(lastValidPoint, candidate);
  const distanceMeters = distanceKm * 1000;
  if (distanceMeters < GPS_MIN_DISPLACEMENT_METERS) {
    return {
      accepted: false,
      reason: 'drift',
      distanceMeters,
    };
  }

  const dtMs = candidate.timestamp - lastValidPoint.timestamp;
  if (!Number.isFinite(dtMs) || dtMs <= 0) {
    return {
      accepted: false,
      reason: 'invalid_timestamp',
      distanceMeters,
    };
  }

  const dtSec = dtMs / 1000;
  const speedMps = distanceMeters / dtSec;
  const speedKmh = speedMps * 3.6;

  if (
    speedMps > GPS_MAX_INSTANT_SPEED_MPS ||
    speedKmh > GPS_MAX_INSTANT_SPEED_KMH
  ) {
    return {
      accepted: false,
      reason: 'speed_jump',
      distanceMeters,
      speedMps,
    };
  }

  return {
    accepted: true,
    isInitial: false,
    distanceKm,
    distanceMeters,
    dtSec,
    speedMps,
    speedKmh,
  };
}

export function estimateCardioCalories(
  activityType: CardioActivityType,
  weightKg: number,
  durationSec: number,
  distanceKm: number,
): number {
  const safeWeight = Math.max(35, weightKg || 70);
  const hours = Math.max(0, durationSec / 3600);
  const speedKmh = hours > 0 ? distanceKm / hours : 0;

  let met = getActivityMeta(activityType).defaultMet;
  if (activityType === 'correr') {
    if (speedKmh >= 12) met = 11.8;
    else if (speedKmh >= 9.5) met = 9.8;
    else if (speedKmh >= 7.5) met = 8.3;
    else met = 7.0;
  } else if (activityType === 'caminar') {
    if (speedKmh >= 6) met = 4.8;
    else if (speedKmh >= 4.5) met = 3.8;
    else met = 3.0;
  } else if (activityType === 'ciclismo') {
    if (speedKmh >= 24) met = 10.0;
    else if (speedKmh >= 18) met = 7.5;
    else met = 5.5;
  }

  // Standard ACSM MET calorie formula: MET * weightKg * hours
  const kcal = met * safeWeight * hours;
  return Math.max(0, Math.round(kcal));
}

export function formatPaceMinKm(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) {
    return '--:--';
  }
  const rounded = Math.round(secPerKm);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatCardioDuration(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function buildKilometerVoiceCue(
  kmNumber: number,
  totalSec: number,
  splitSec: number,
  distanceUnit: DistanceUnit = 'km',
): string {
  const paceInUnit = paceSecPerKmToUnit(splitSec, distanceUnit);
  const splitMin = Math.floor(paceInUnit / 60);
  const splitRemSec = Math.round(paceInUnit % 60);
  const totalMin = Math.floor(totalSec / 60);
  const totalRemSec = Math.round(totalSec % 60);

  if (distanceUnit === 'mi') {
    const milesText = kmToDisplayDistance(kmNumber, 'mi')
      .toFixed(2)
      .replace('.', ' punto ');
    return `Parcial completado. Distancia total: ${milesText} millas. Tiempo total: ${totalMin} minutos y ${totalRemSec} segundos. Ritmo actual: ${splitMin} minutos con ${splitRemSec} segundos por milla.`;
  }

  return `Kilómetro ${kmNumber} completado. Distancia total: ${kmNumber} ${
    kmNumber === 1 ? 'kilómetro' : 'kilómetros'
  }. Tiempo total: ${totalMin} minutos y ${totalRemSec} segundos. Ritmo del último kilómetro: ${splitMin} minutos con ${splitRemSec} segundos por kilómetro.`;
}

export function buildTimedVoiceCue(
  elapsedMinutes: number,
  distanceKm: number,
  avgPaceSecPerKm: number,
  distanceUnit: DistanceUnit = 'km',
): string {
  const displayDist = kmToDisplayDistance(distanceKm, distanceUnit);
  const distText = displayDist.toFixed(2).replace('.', ' punto ');
  const paceInUnit = paceSecPerKmToUnit(avgPaceSecPerKm, distanceUnit);
  const paceMin = Math.floor(paceInUnit / 60);
  const paceSec = Math.round(paceInUnit % 60);
  const unitPlural = distanceUnit === 'mi' ? 'millas' : 'kilómetros';
  const unitSingular = distanceUnit === 'mi' ? 'milla' : 'kilómetro';
  const paceSentence =
    paceInUnit > 0 && paceInUnit < 3600
      ? `Ritmo promedio: ${paceMin} minutos con ${paceSec} segundos por ${unitSingular}.`
      : '';

  return `Llevas ${elapsedMinutes} minutos en actividad. Distancia acumulada: ${distText} ${unitPlural}. ${paceSentence}`.trim();
}

export function estimateCardioSteps(
  activityType: CardioActivityType,
  distanceKm: number,
  durationSec: number,
  heightCm = 175,
): number {
  if (activityType === 'ciclismo') return 0;
  const safeHeight = Math.max(130, Math.min(220, heightCm || 175));
  if (distanceKm > 0.01) {
    // Walking stride ~ 0.415 * height; running stride ~ 0.62 * height
    const strideMeters =
      activityType === 'caminar'
        ? (safeHeight * 0.415) / 100
        : (safeHeight * 0.62) / 100;
    return Math.max(0, Math.round((distanceKm * 1000) / strideMeters));
  }
  if (durationSec > 0) {
    const stepsPerMin = activityType === 'caminar' ? 105 : 150;
    return Math.round((durationSec / 60) * stepsPerMin);
  }
  return 0;
}

export function computeAvgSpeedKmh(
  distanceKm: number,
  activeDurationSec: number,
): number {
  if (distanceKm <= 0 || activeDurationSec <= 0) return 0;
  return Math.round((distanceKm / (activeDurationSec / 3600)) * 10) / 10;
}

