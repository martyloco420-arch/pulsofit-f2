import type {
  BodyCompositionScan,
  MetricStatusLevel,
  ScaleSource,
  UserProfile,
  WeighInTimeSlot,
} from '../types/fitness';

export interface PartialScanInput {
  weightKg: number;
  waistCm?: number;
  timeSlot?: WeighInTimeSlot;
  impedanceOhm?: number;
  bodyFatPct?: number;
  skeletalMusclePct?: number;
  totalMusclePct?: number;
  bodyWaterPct?: number;
  visceralFatLevel?: number;
  boneMassKg?: number;
  bmrKcal?: number;
  proteinPct?: number;
  bodyAge?: number;
  bmi?: number;
  leanMassKg?: number;
  source: ScaleSource;
  date: string;
}

export interface RangeBarSegment {
  label: 'Bajo' | 'Saludable' | 'Alto' | 'Crítico';
  widthPct: number;
  colorClass: string;
}

export interface RangeBarSpec {
  markerPct: number; // 0..100
  minLabel: string;
  healthyLabel: string;
  maxLabel: string;
  segments: RangeBarSegment[];
}

export interface MetricCardDescriptor {
  key: keyof BodyCompositionScan;
  label: string;
  value: number;
  unit: string;
  status: MetricStatusLevel;
  higherIsBetter: boolean | null;
  previousDelta: number | null;
  best30DaysValue: number | null;
  subLabel?: string;
  guide: string;
  rangeBar: RangeBarSpec;
  isPrimaryOkok?: boolean;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function getDefaultTimeSlot(date = new Date()): WeighInTimeSlot {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'manana';
  if (hour >= 12 && hour < 19) return 'tarde';
  return 'noche';
}

export function getScanTimeSlot(scan: BodyCompositionScan): WeighInTimeSlot {
  if (scan.timeSlot === 'manana' || scan.timeSlot === 'tarde' || scan.timeSlot === 'noche') {
    return scan.timeSlot;
  }
  const d = new Date(scan.recordedAt);
  if (Number.isNaN(d.getTime())) return 'manana';
  return getDefaultTimeSlot(d);
}

export function getTimeSlotLabel(slot: WeighInTimeSlot): string {
  switch (slot) {
    case 'manana':
      return 'Mañana / Ayunas';
    case 'tarde':
      return 'Tarde';
    case 'noche':
      return 'Noche';
  }
}

export function computeBodyCompositionScan(
  input: PartialScanInput,
  profile: UserProfile,
): BodyCompositionScan {
  const weightKg = round1(clamp(input.weightKg, 25, 280));
  const heightCm = clamp(profile.heightCm || 175, 120, 230);
  const heightM = heightCm / 100;
  const age = clamp(profile.age || 28, 14, 95);
  const isMale = profile.sex === 'hombre';
  const sexBit = isMale ? 1 : profile.sex === 'mujer' ? 0 : 0.5;

  const bmi = round1(input.bmi ?? weightKg / (heightM * heightM));
  const idealWeightKg = round1(22 * heightM * heightM);
  const obesityDegreePct = round1(((weightKg - idealWeightKg) / idealWeightKg) * 100);

  // Estimate bodyFatPct via BIA impedance if provided, or Deurenberg/Gallagher formula
  let estimatedFatPct: number;
  if (typeof input.bodyFatPct === 'number' && input.bodyFatPct > 3 && input.bodyFatPct < 65) {
    estimatedFatPct = input.bodyFatPct;
  } else if (typeof input.impedanceOhm === 'number' && input.impedanceOhm > 100) {
    const ri = (heightCm * heightCm) / input.impedanceOhm;
    const ffm =
      0.406 * ri +
      0.331 * weightKg +
      0.021 * heightCm -
      0.056 * age +
      (isMale ? 5.4 : 0.8);
    const clampedFfm = clamp(ffm, weightKg * 0.42, weightKg * 0.94);
    estimatedFatPct = ((weightKg - clampedFfm) / weightKg) * 100;
  } else {
    const trainingFactor = Math.min(2.5, (profile.trainingDaysPerWeek || 3) * 0.35);
    estimatedFatPct = 1.2 * bmi + 0.23 * age - 10.8 * sexBit - 5.4 - trainingFactor;
  }

  const bodyFatPct = round1(clamp(estimatedFatPct, 5, 58));
  const bodyFatMassKg = round1((weightKg * bodyFatPct) / 100);
  const leanMassKg = round1(input.leanMassKg ?? weightKg - bodyFatMassKg);

  const boneMassKg = round1(
    input.boneMassKg ?? clamp(leanMassKg * (isMale ? 0.048 : 0.045), 1.5, 4.8),
  );

  const defaultWaterMass = leanMassKg * 0.725;
  const bodyWaterPct = round1(
    input.bodyWaterPct ?? clamp((defaultWaterMass / weightKg) * 100, 35, 75),
  );
  const bodyWaterMassKg = round1((weightKg * bodyWaterPct) / 100);

  const defaultTotalMuscleMass = Math.max(weightKg * 0.3, leanMassKg - boneMassKg);
  const totalMusclePct = round1(
    input.totalMusclePct ??
      clamp((defaultTotalMuscleMass / weightKg) * 100, 30, 88),
  );
  const totalMuscleMassKg = round1((weightKg * totalMusclePct) / 100);

  const defaultSkeletalMass = leanMassKg * (isMale ? 0.575 : 0.53);
  const skeletalMusclePct = round1(
    input.skeletalMusclePct ??
      clamp((defaultSkeletalMass / weightKg) * 100, 22, 62),
  );
  const skeletalMuscleMassKg = round1((weightKg * skeletalMusclePct) / 100);

  const proteinPct = round1(
    input.proteinPct ??
      clamp(100 - bodyFatPct - bodyWaterPct - (boneMassKg / weightKg) * 100, 10, 26),
  );

  const visceralFatLevel = Math.round(
    input.visceralFatLevel ??
      clamp(
        (bmi - 16) * 0.65 + (bodyFatPct - (isMale ? 12 : 20)) * 0.25 + (age - 20) * 0.06,
        1,
        28,
      ),
  );

  const bmrKcal = Math.round(input.bmrKcal ?? 370 + 21.6 * leanMassKg);

  const idealFat = isMale ? 15 : 23;
  const fatDiff = bodyFatPct - idealFat;
  const muscleBonus = (skeletalMusclePct - (isMale ? 40 : 34)) * 0.4;
  const bodyAge = Math.round(
    input.bodyAge ?? clamp(age + fatDiff * 0.45 - muscleBonus, 16, 85),
  );

  const now = new Date();
  const waistCm =
    typeof input.waistCm === 'number' && input.waistCm >= 40 && input.waistCm <= 200
      ? round1(input.waistCm)
      : undefined;

  return {
    id: `scan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date: input.date,
    recordedAt: now.toISOString(),
    timeSlot: input.timeSlot ?? getDefaultTimeSlot(now),
    source: input.source,
    impedanceOhm: input.impedanceOhm,
    weightKg,
    waistCm,
    leanMassKg,
    bmi,
    obesityDegreePct,
    bodyFatPct,
    bodyFatMassKg,
    skeletalMusclePct,
    skeletalMuscleMassKg,
    totalMusclePct,
    totalMuscleMassKg,
    bodyWaterPct,
    bodyWaterMassKg,
    visceralFatLevel,
    boneMassKg,
    bmrKcal,
    proteinPct,
    bodyAge,
    realAge: age,
    idealWeightKg,
  };
}

/**
 * Builds a normalized 4-zone traffic light bar:
 * 0-25% Bajo (Sky), 25-60% Saludable (Emerald), 60-82% Alto (Amber), 82-100% Crítico (Rose).
 */
function buildFourZoneStatusAndBar(
  val: number,
  lowEnd: number,
  healthyMax: number,
  highMax: number,
  scaleMin: number,
  scaleMax: number,
  unitSuffix = '',
): { status: MetricStatusLevel; rangeBar: RangeBarSpec } {
  let status: MetricStatusLevel;
  let markerPct: number;

  if (val < lowEnd) {
    status = 'Bajo';
    const ratio = clamp((val - scaleMin) / Math.max(0.1, lowEnd - scaleMin), 0, 1);
    markerPct = 4 + ratio * 21;
  } else if (val <= healthyMax) {
    status = 'Saludable';
    const ratio = clamp((val - lowEnd) / Math.max(0.1, healthyMax - lowEnd), 0, 1);
    markerPct = 25 + ratio * 35;
  } else if (val <= highMax) {
    status = 'Alto';
    const ratio = clamp((val - healthyMax) / Math.max(0.1, highMax - healthyMax), 0, 1);
    markerPct = 60 + ratio * 22;
  } else {
    status = 'Crítico';
    const ratio = clamp((val - highMax) / Math.max(0.1, scaleMax - highMax), 0, 1);
    markerPct = 82 + ratio * 15;
  }

  return {
    status,
    rangeBar: {
      markerPct: Math.round(clamp(markerPct, 3, 97)),
      minLabel: `${round1(scaleMin)}${unitSuffix}`,
      healthyLabel: `${round1(lowEnd)}–${round1(healthyMax)}${unitSuffix}`,
      maxLabel: `${round1(scaleMax)}+${unitSuffix}`,
      segments: [
        { label: 'Bajo', widthPct: 25, colorClass: 'bg-sky-500' },
        { label: 'Saludable', widthPct: 35, colorClass: 'bg-emerald-500' },
        { label: 'Alto', widthPct: 22, colorClass: 'bg-amber-400' },
        { label: 'Crítico', widthPct: 18, colorClass: 'bg-rose-500' },
      ],
    },
  };
}

/**
 * For "higher is better" metrics (Muscle, Water, Protein, Bone), maps low values to Crítico/Bajo
 * and optimal high values into Saludable zone.
 */
function buildHigherOptimalStatusAndBar(
  val: number,
  criticalBelow: number,
  lowBelow: number,
  healthyMax: number,
  scaleMin: number,
  scaleMax: number,
  unitSuffix = '',
): { status: MetricStatusLevel; rangeBar: RangeBarSpec } {
  let status: MetricStatusLevel;
  let markerPct: number;

  if (val < criticalBelow) {
    status = 'Crítico';
    const ratio = clamp((val - scaleMin) / Math.max(0.1, criticalBelow - scaleMin), 0, 1);
    markerPct = 82 + (1 - ratio) * 15; // Shown in Crítico band visually or left side? Wait: keep bar consistent Bajo|Saludable|Alto|Crítico OR label bar order!
    // Actually if bar segments are always [Bajo 25% | Saludable 35% | Alto 22% | Crítico 18%], let's place marker inside the matching status segment so color and position ALWAYS agree!
    markerPct = 84 + (1 - ratio) * 12;
  } else if (val < lowBelow) {
    status = 'Bajo';
    const ratio = clamp((val - criticalBelow) / Math.max(0.1, lowBelow - criticalBelow), 0, 1);
    markerPct = 5 + ratio * 18;
  } else if (val <= healthyMax) {
    status = 'Saludable';
    const ratio = clamp((val - lowBelow) / Math.max(0.1, healthyMax - lowBelow), 0, 1);
    markerPct = 27 + ratio * 31;
  } else {
    status = 'Alto';
    const ratio = clamp((val - healthyMax) / Math.max(0.1, scaleMax - healthyMax), 0, 1);
    markerPct = 62 + ratio * 18;
  }

  return {
    status,
    rangeBar: {
      markerPct: Math.round(clamp(markerPct, 3, 97)),
      minLabel: `Min ${round1(lowBelow)}${unitSuffix}`,
      healthyLabel: `Óptimo ${round1(lowBelow)}–${round1(healthyMax)}${unitSuffix}`,
      maxLabel: `${round1(scaleMax)}${unitSuffix}`,
      segments: [
        { label: 'Bajo', widthPct: 25, colorClass: 'bg-sky-500' },
        { label: 'Saludable', widthPct: 35, colorClass: 'bg-emerald-500' },
        { label: 'Alto', widthPct: 22, colorClass: 'bg-amber-400' },
        { label: 'Crítico', widthPct: 18, colorClass: 'bg-rose-500' },
      ],
    },
  };
}

export function build19MetricCards(
  current: BodyCompositionScan,
  history: BodyCompositionScan[],
  profile: UserProfile,
): MetricCardDescriptor[] {
  const isMale = profile.sex === 'hombre';
  const sortedDesc = [...history]
    .filter((s) => s.id !== current.id)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const previous = sortedDesc[0] ?? null;

  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const last30 = [current, ...sortedDesc].filter(
    (s) => Date.parse(s.recordedAt) >= cutoffMs,
  );

  const delta = (key: keyof BodyCompositionScan): number | null => {
    if (!previous) return null;
    const prevVal = previous[key];
    const curVal = current[key];
    if (typeof prevVal !== 'number' || typeof curVal !== 'number') return null;
    return round1(curVal - prevVal);
  };

  const best30 = (
    key: keyof BodyCompositionScan,
    mode: 'min' | 'max' | 'closest_ideal',
  ): number | null => {
    if (last30.length === 0) return null;
    const vals = last30
      .map((s) => s[key])
      .filter((v): v is number => typeof v === 'number');
    if (vals.length === 0) return null;
    if (mode === 'min') return Math.min(...vals);
    if (mode === 'max') return Math.max(...vals);
    const target = profile.targetWeightKg || current.idealWeightKg;
    return vals.reduce((best, v) =>
      Math.abs(v - target) < Math.abs(best - target) ? v : best,
    );
  };

  const heightM = clamp(profile.heightCm || 175, 120, 230) / 100;
  const weightLow = round1(18.5 * heightM * heightM);
  const weightHealthyMax = round1(24.9 * heightM * heightM);
  const weightHighMax = round1(29.9 * heightM * heightM);
  const weightEval = buildFourZoneStatusAndBar(
    current.weightKg,
    weightLow,
    weightHealthyMax,
    weightHighMax,
    round1(weightLow * 0.75),
    round1(weightHighMax * 1.15),
  );

  const bmiEval = buildFourZoneStatusAndBar(current.bmi, 18.5, 24.9, 29.9, 14, 38);

  const fatLow = isMale ? 8 : 15;
  const fatHealthyMax = isMale ? 20 : 27;
  const fatHighMax = isMale ? 26 : 33;
  const fatEval = buildFourZoneStatusAndBar(
    current.bodyFatPct,
    fatLow,
    fatHealthyMax,
    fatHighMax,
    4,
    45,
    '%',
  );

  const visceralEval = buildFourZoneStatusAndBar(
    current.visceralFatLevel,
    1,
    9,
    14,
    1,
    24,
  );

  const muscleCrit = isMale ? 60 : 54;
  const muscleLow = isMale ? 72 : 65;
  const muscleMax = isMale ? 92 : 86;
  const muscleEval = buildHigherOptimalStatusAndBar(
    current.totalMusclePct,
    muscleCrit,
    muscleLow,
    muscleMax,
    45,
    95,
    '%',
  );

  const skelCrit = isMale ? 30 : 25;
  const skelLow = isMale ? 36 : 30;
  const skelMax = isMale ? 55 : 50;
  const skelEval = buildHigherOptimalStatusAndBar(
    current.skeletalMusclePct,
    skelCrit,
    skelLow,
    skelMax,
    20,
    62,
    '%',
  );

  const waterCrit = isMale ? 46 : 41;
  const waterLow = isMale ? 53 : 48;
  const waterMax = isMale ? 66 : 61;
  const waterEval = buildHigherOptimalStatusAndBar(
    current.bodyWaterPct,
    waterCrit,
    waterLow,
    waterMax,
    38,
    72,
    '%',
  );

  const proteinEval = buildHigherOptimalStatusAndBar(
    current.proteinPct,
    12,
    15,
    22,
    10,
    26,
    '%',
  );

  const boneThreshold = isMale ? 2.5 : 1.9;
  const boneEval = buildHigherOptimalStatusAndBar(
    current.boneMassKg,
    round1(boneThreshold * 0.78),
    boneThreshold,
    round1(boneThreshold * 1.45),
    1.4,
    4.5,
  );

  const bodyAgeEval = buildFourZoneStatusAndBar(
    current.bodyAge,
    Math.max(16, current.realAge - 12),
    current.realAge + 2,
    current.realAge + 7,
    16,
    Math.max(60, current.realAge + 15),
    ' a',
  );

  const waistLow = isMale ? 68 : 60;
  const waistHealthyMax = isMale ? 94 : 80;
  const waistHighMax = isMale ? 102 : 88;
  const waistEval =
    typeof current.waistCm === 'number'
      ? buildFourZoneStatusAndBar(
          current.waistCm,
          waistLow,
          waistHealthyMax,
          waistHighMax,
          55,
          125,
        )
      : null;

  const obesityEval = buildFourZoneStatusAndBar(
    current.obesityDegreePct,
    -10,
    10,
    20,
    -25,
    45,
    '%',
  );

  const bmrEval = buildHigherOptimalStatusAndBar(
    current.bmrKcal,
    1100,
    isMale ? 1450 : 1200,
    2400,
    950,
    2800,
  );

  const cards: MetricCardDescriptor[] = [
    // --- 10 PRINCIPALES ESTILO OKOK ---
    {
      key: 'weightKg',
      label: 'Peso',
      value: current.weightKg,
      unit: 'kg',
      status: weightEval.status,
      higherIsBetter: null,
      previousDelta: delta('weightKg'),
      best30DaysValue: best30('weightKg', 'closest_ideal'),
      guide: 'Balance total frente a tu estatura ideal y meta personal.',
      rangeBar: weightEval.rangeBar,
      isPrimaryOkok: true,
    },
    {
      key: 'bmi',
      label: 'IMC (BMI)',
      value: current.bmi,
      unit: '',
      status: bmiEval.status,
      higherIsBetter: false,
      previousDelta: delta('bmi'),
      best30DaysValue: best30('bmi', 'closest_ideal'),
      guide: 'Relación peso/estatura. Rango saludable estándar: 18.5 a 24.9.',
      rangeBar: bmiEval.rangeBar,
      isPrimaryOkok: true,
    },
    {
      key: 'bodyFatPct',
      label: 'Grasa corporal',
      value: current.bodyFatPct,
      unit: '%',
      status: fatEval.status,
      higherIsBetter: false,
      previousDelta: delta('bodyFatPct'),
      best30DaysValue: best30('bodyFatPct', 'min'),
      guide: isMale
        ? 'Tejido adiposo total. Saludable: 8%–20% en hombres.'
        : 'Tejido adiposo total. Saludable: 15%–27% en mujeres.',
      rangeBar: fatEval.rangeBar,
      isPrimaryOkok: true,
    },
    {
      key: 'visceralFatLevel',
      label: 'Grasa visceral',
      value: current.visceralFatLevel,
      unit: 'nivel',
      status: visceralEval.status,
      higherIsBetter: false,
      previousDelta: delta('visceralFatLevel'),
      best30DaysValue: best30('visceralFatLevel', 'min'),
      guide: 'Grasa interna alrededor de órganos. Mantén nivel 1 a 9 (crítico >= 15).',
      rangeBar: visceralEval.rangeBar,
      isPrimaryOkok: true,
    },
    {
      key: 'totalMusclePct',
      label: 'Masa muscular',
      value: current.totalMusclePct,
      unit: '%',
      status: muscleEval.status,
      higherIsBetter: true,
      previousDelta: delta('totalMusclePct'),
      best30DaysValue: best30('totalMusclePct', 'max'),
      subLabel: `${current.totalMuscleMassKg} kg totales`,
      guide: 'Tejido muscular activo; impulsa tu fuerza y gasto calórico diario.',
      rangeBar: muscleEval.rangeBar,
      isPrimaryOkok: true,
    },
    {
      key: 'bodyWaterPct',
      label: 'Agua corporal',
      value: current.bodyWaterPct,
      unit: '%',
      status: waterEval.status,
      higherIsBetter: true,
      previousDelta: delta('bodyWaterPct'),
      best30DaysValue: best30('bodyWaterPct', 'max'),
      subLabel: `${current.bodyWaterMassKg} kg de hidratación`,
      guide: 'Hidratación celular clave para rendimiento y lecturas BIA estables.',
      rangeBar: waterEval.rangeBar,
      isPrimaryOkok: true,
    },
    {
      key: 'proteinPct',
      label: 'Proteína',
      value: current.proteinPct,
      unit: '%',
      status: proteinEval.status,
      higherIsBetter: true,
      previousDelta: delta('proteinPct'),
      best30DaysValue: best30('proteinPct', 'max'),
      guide: 'Reserva proteica estructural; baja si falta masa muscular o ingesta.',
      rangeBar: proteinEval.rangeBar,
      isPrimaryOkok: true,
    },
    {
      key: 'boneMassKg',
      label: 'Masa ósea',
      value: current.boneMassKg,
      unit: 'kg',
      status: boneEval.status,
      higherIsBetter: true,
      previousDelta: delta('boneMassKg'),
      best30DaysValue: best30('boneMassKg', 'max'),
      guide: 'Contenido mineral del esqueleto; mejora con entrenamiento de fuerza.',
      rangeBar: boneEval.rangeBar,
      isPrimaryOkok: true,
    },
    {
      key: 'bodyAge',
      label: 'Edad metabólica',
      value: current.bodyAge,
      unit: 'años',
      status: bodyAgeEval.status,
      higherIsBetter: false,
      previousDelta: delta('bodyAge'),
      best30DaysValue: best30('bodyAge', 'min'),
      subLabel: `vs Edad real (${current.realAge} años)`,
      guide: 'Edad fisiológica estimada según tu TMB, grasa corporal y músculo.',
      rangeBar: bodyAgeEval.rangeBar,
      isPrimaryOkok: true,
    },
  ];

  if (typeof current.waistCm === 'number' && waistEval) {
    cards.push({
      key: 'waistCm',
      label: 'Cintura',
      value: current.waistCm,
      unit: 'cm',
      status: waistEval.status,
      higherIsBetter: false,
      previousDelta: delta('waistCm'),
      best30DaysValue: best30('waistCm', 'min'),
      guide: isMale
        ? 'Indicador directo de riesgo metabólico (saludable < 94 cm).'
        : 'Indicador directo de riesgo metabólico (saludable < 80 cm).',
      rangeBar: waistEval.rangeBar,
      isPrimaryOkok: true,
    });
  }

  // --- MÉTRICAS COMPLEMENTARIAS BIA ---
  cards.push(
    {
      key: 'leanMassKg',
      label: 'Peso libre de grasa / Masa magra',
      value: current.leanMassKg,
      unit: 'kg',
      status: fatEval.status,
      higherIsBetter: true,
      previousDelta: delta('leanMassKg'),
      best30DaysValue: best30('leanMassKg', 'max'),
      guide: 'Todo tu peso corporal descontando el tejido adiposo.',
      rangeBar: fatEval.rangeBar,
    },
    {
      key: 'skeletalMusclePct',
      label: 'Masa muscular esquelética (%)',
      value: current.skeletalMusclePct,
      unit: '%',
      status: skelEval.status,
      higherIsBetter: true,
      previousDelta: delta('skeletalMusclePct'),
      best30DaysValue: best30('skeletalMusclePct', 'max'),
      guide: 'Músculo voluntario unido a los huesos que responde al entrenamiento.',
      rangeBar: skelEval.rangeBar,
    },
    {
      key: 'skeletalMuscleMassKg',
      label: 'Peso muscular esquelético',
      value: current.skeletalMuscleMassKg,
      unit: 'kg',
      status: skelEval.status,
      higherIsBetter: true,
      previousDelta: delta('skeletalMuscleMassKg'),
      best30DaysValue: best30('skeletalMuscleMassKg', 'max'),
      guide: 'Kilogramos exactos de músculo esquelético activo.',
      rangeBar: skelEval.rangeBar,
    },
    {
      key: 'totalMuscleMassKg',
      label: 'Peso muscular total',
      value: current.totalMuscleMassKg,
      unit: 'kg',
      status: muscleEval.status,
      higherIsBetter: true,
      previousDelta: delta('totalMuscleMassKg'),
      best30DaysValue: best30('totalMuscleMassKg', 'max'),
      guide: 'Suma de músculo esquelético, liso y cardíaco en el cuerpo.',
      rangeBar: muscleEval.rangeBar,
    },
    {
      key: 'bodyFatMassKg',
      label: 'Peso de grasa corporal',
      value: current.bodyFatMassKg,
      unit: 'kg',
      status: fatEval.status,
      higherIsBetter: false,
      previousDelta: delta('bodyFatMassKg'),
      best30DaysValue: best30('bodyFatMassKg', 'min'),
      guide: 'Masa absoluta de grasa; útil para medir recomposición real.',
      rangeBar: fatEval.rangeBar,
    },
    {
      key: 'bodyWaterMassKg',
      label: 'Peso del agua corporal',
      value: current.bodyWaterMassKg,
      unit: 'kg',
      status: waterEval.status,
      higherIsBetter: true,
      previousDelta: delta('bodyWaterMassKg'),
      best30DaysValue: best30('bodyWaterMassKg', 'max'),
      guide: 'Litros/kilos de fluidos intracelulares y extracelulares.',
      rangeBar: waterEval.rangeBar,
    },
    {
      key: 'obesityDegreePct',
      label: 'Grado de obesidad',
      value: current.obesityDegreePct,
      unit: '%',
      status: obesityEval.status,
      higherIsBetter: false,
      previousDelta: delta('obesityDegreePct'),
      best30DaysValue: best30('obesityDegreePct', 'min'),
      guide: 'Desviación porcentual respecto a tu peso ideal teórico (0%).',
      rangeBar: obesityEval.rangeBar,
    },
    {
      key: 'bmrKcal',
      label: 'Metabolismo basal (TMB)',
      value: current.bmrKcal,
      unit: 'kcal',
      status: bmrEval.status,
      higherIsBetter: true,
      previousDelta: delta('bmrKcal'),
      best30DaysValue: best30('bmrKcal', 'max'),
      guide: 'Calorías mínimas que quema tu cuerpo en reposo completo.',
      rangeBar: bmrEval.rangeBar,
    },
    {
      key: 'idealWeightKg',
      label: 'Peso ideal estándar',
      value: current.idealWeightKg,
      unit: 'kg',
      status: weightEval.status,
      higherIsBetter: null,
      previousDelta: round1(current.weightKg - current.idealWeightKg),
      best30DaysValue: best30('weightKg', 'closest_ideal'),
      subLabel: 'Diferencia vs peso actual',
      guide: 'Referencia de IMC 22 acorde a tu estatura registrada.',
      rangeBar: weightEval.rangeBar,
    },
    {
      key: 'realAge',
      label: 'Edad cronológica',
      value: current.realAge,
      unit: 'años',
      status: bodyAgeEval.status,
      higherIsBetter: null,
      previousDelta: null,
      best30DaysValue: null,
      subLabel:
        current.bodyAge < current.realAge
          ? `${current.realAge - current.bodyAge} años menor metabólicamente`
          : current.bodyAge > current.realAge
            ? `${current.bodyAge - current.realAge} años mayor metabólicamente`
            : 'En línea con edad metabólica',
      guide: 'Referencia base para comparar tu edad metabólica actual.',
      rangeBar: bodyAgeEval.rangeBar,
    },
  );

  return cards;
}
