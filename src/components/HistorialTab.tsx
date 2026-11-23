import React, { useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  HeartPulse,
  Moon,
  Scale,
  Search,
  Trash2,
  Trophy,
  Utensils,
} from 'lucide-react';
import { DataCleanupConfirmModal } from './DataCleanupConfirmModal';
import { InlineDeleteConfirmButton } from './InlineDeleteConfirmButton';
import { formatPaceMinKm } from '../lib/cardio';
import { shiftIsoDate } from '../lib/compareDates';
import { formatMinutesAsHoursMin } from '../lib/sleepEngine';
import {
  type RecordDeleteTarget,
  countRecordsByDate,
  getLocalDateKey,
  getTodayIsoDate,
} from '../lib/storage';
import {
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
  paceSecPerKmToUnit,
} from '../lib/units';
import type { AppDatabase, CardioActivityType } from '../types/fitness';

interface HistorialTabProps {
  database: AppDatabase;
  onDeleteWorkout: (id: string) => void;
  onDeleteHiitSession: (id: string) => void;
  onDeleteCardioSession: (id: string) => void;
  onDeleteBodyScan: (id: string) => void;
  onDeleteBodyWeight: (id: string) => void;
  onDeleteFood: (id: string) => void;
  onDeleteFastHistory: (id: string) => void;
  onDeleteSleepSession: (id: string) => void;
  onDeletePulseRecord: (id: string) => void;
  onDeleteBloodPressureRecord: (id: string) => void;
  onDeleteWaterLog?: (date: string, target: RecordDeleteTarget | string) => void;
  onClearDay?: (dateIso: string, includePhotos: boolean) => Promise<void> | void;
}

type HistorialFilter =
  | 'all'
  | 'ejercicios'
  | 'caminatas'
  | 'peso'
  | 'nutricion'
  | 'sueno_signos';

interface DetailRow {
  label: string;
  value: string;
}

interface HistorialSubLine {
  text: string;
  isPR?: boolean;
  prLabels?: string[];
}

interface HistorialItem {
  id: string;
  category: Exclude<HistorialFilter, 'all'>;
  dateIso: string; // YYYY-MM-DD
  sortKey: string; // ISO timestamp for chronological sorting
  timeLabel: string; // HH:MM
  badge: string;
  title: string;
  subtitle: string;
  highlightMetric: string;
  isPR?: boolean;
  prLabels?: string[];
  details: DetailRow[];
  subBlocks?: { heading: string; lines: (string | HistorialSubLine)[] }[];
  onDelete?: () => void;
}

const FILTER_PILLS: { id: HistorialFilter; label: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: 'ejercicios', label: 'Ejercicios' },
  { id: 'caminatas', label: 'Caminatas' },
  { id: 'peso', label: 'Peso' },
  { id: 'nutricion', label: 'Nutrición' },
  { id: 'sueno_signos', label: 'Sueño y Signos' },
];

const CARDIO_LABELS: Record<CardioActivityType, string> = {
  correr: 'Carrera',
  caminar: 'Caminata',
  ciclismo: 'Ciclismo',
  caminadora: 'Caminadora',
};

const MEAL_LABELS: Record<string, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Comida',
  comida: 'Comida',
  cena: 'Cena',
  snack: 'Snack',
};

function formatTimeHHMM(iso: string | undefined): string {
  if (!iso) return '--:--';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '--:--';
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

function formatDurationClock(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  return `${Math.max(1, mins)} min`;
}

function formatGroupDateLabel(
  dateIso: string,
  todayIso: string,
  yesterdayIso: string,
): string {
  if (dateIso === todayIso) return 'Hoy';
  if (dateIso === yesterdayIso) return 'Ayer';
  const dt = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return dateIso;
  return dt.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const HistorialTab: React.FC<HistorialTabProps> = ({
  database,
  onDeleteWorkout,
  onDeleteHiitSession,
  onDeleteCardioSession,
  onDeleteBodyScan,
  onDeleteBodyWeight,
  onDeleteFood,
  onDeleteFastHistory,
  onDeleteSleepSession,
  onDeletePulseRecord,
  onDeleteBloodPressureRecord,
  onDeleteWaterLog,
  onClearDay,
}) => {
  const [filter, setFilter] = useState<HistorialFilter>('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showClearDayPanel, setShowClearDayPanel] = useState(false);
  const [clearDateIso, setClearDateIso] = useState(() => getTodayIsoDate());
  const [includeClearDayPhotos, setIncludeClearDayPhotos] = useState(true);
  const [isClearDayModalOpen, setIsClearDayModalOpen] = useState(false);
  const [isClearingDay, setIsClearingDay] = useState(false);
  const [clearDayFeedback, setClearDayFeedback] = useState<string | null>(null);

  const weightUnit = getWeightUnit(database.profile.weightUnit);
  const distanceUnit = getDistanceUnit(database.profile.distanceUnit);
  const liquidUnit = getLiquidUnit(database.profile.liquidUnit);
  const lengthUnit = getWaistUnit(database.profile);

  const todayIso = getTodayIsoDate();
  const yesterdayIso = useMemo(() => shiftIsoDate(todayIso, -1), [todayIso]);

  const clearDayBreakdown = useMemo(
    () => countRecordsByDate(database, clearDateIso),
    [database, clearDateIso],
  );

  const allItems = useMemo<HistorialItem[]>(() => {
    const items: HistorialItem[] = [];

    // 1. Ejercicios: Workouts (Fuerza / Ligas)
    for (const w of database.workouts) {
      const dateIso = getLocalDateKey(w.completedAt);
      const prLabelCollector = new Set<string>(w.prLabels ?? []);
      let hasSetPR = false;

      const exerciseBlocks = w.exercises
        .map((ex) => {
          const doneSets = ex.sets.filter((s) => s.completed);
          if (doneSets.length === 0) return null;
          const lines: HistorialSubLine[] = doneSets.map((s, idx) => {
            if (s.isPR) {
              hasSetPR = true;
              for (const lbl of s.prLabels ?? []) {
                prLabelCollector.add(`${ex.name}: ${lbl}`);
              }
            }
            const load = s.bandLabel
              ? `${s.bandLabel} (${formatWeight(s.weightKg, weightUnit)})`
              : s.weightKg > 0
                ? formatWeight(s.weightKg, weightUnit)
                : 'Peso corporal';
            const tag =
              s.setType && s.setType !== 'normal' ? ` [${s.setType}]` : '';
            const rpe = s.rpe ? ` · RPE ${s.rpe}` : '';
            return {
              text: `Serie ${idx + 1}: ${load} × ${s.reps} reps${tag}${rpe}`,
              isPR: s.isPR,
              prLabels: s.prLabels,
            };
          });
          return { heading: ex.name, lines };
        })
        .filter((b): b is { heading: string; lines: HistorialSubLine[] } => b !== null);

      const workoutHasPR = Boolean(w.isPR) || hasSetPR;
      const workoutPrLabels = Array.from(prLabelCollector);

      items.push({
        id: `wk_${w.id}`,
        category: 'ejercicios',
        dateIso,
        sortKey: w.completedAt,
        timeLabel: formatTimeHHMM(w.completedAt),
        badge: 'Fuerza / Rutina',
        title: w.title,
        subtitle: `${w.exercises.length} ejercicios · ${w.completedSets} series completadas`,
        highlightMetric: formatVolume(w.totalVolumeKg, weightUnit),
        isPR: workoutHasPR || undefined,
        prLabels: workoutHasPR ? workoutPrLabels : undefined,
        details: [
          { label: 'Duración', value: formatDurationClock(w.durationSec) },
          { label: 'Series totales', value: String(w.completedSets) },
          { label: 'Volumen total', value: formatVolume(w.totalVolumeKg, weightUnit) },
          ...(workoutHasPR && workoutPrLabels.length > 0
            ? [{ label: 'Récords (PR)', value: workoutPrLabels.slice(0, 3).join(' · ') }]
            : []),
        ],
        subBlocks: exerciseBlocks,
        onDelete: () => onDeleteWorkout(w.id),
      });
    }

    // 1b. Ejercicios: HIIT
    for (const h of database.hiitSessions ?? []) {
      items.push({
        id: `hiit_${h.id}`,
        category: 'ejercicios',
        dateIso: h.date,
        sortKey: h.completedAt || `${h.date}T12:00:00.000Z`,
        timeLabel: formatTimeHHMM(h.completedAt),
        badge: 'HIIT',
        title: h.name,
        subtitle: `${h.rounds} rondas × ${h.cycles} ciclos (${h.workSec}s/${h.restSec}s)`,
        highlightMetric: `${h.caloriesBurned} kcal`,
        details: [
          { label: 'Duración total', value: formatDurationClock(h.totalDurationSec) },
          { label: 'Trabajo / Descanso', value: `${h.workSec}s / ${h.restSec}s` },
          { label: 'Calorías estimadas', value: `${h.caloriesBurned} kcal` },
        ],
        onDelete: () => onDeleteHiitSession(h.id),
      });
    }

    // 2. Caminatas / Cardio GPS
    for (const c of database.cardioSessions ?? []) {
      const paceUnitLabel = distanceUnit === 'mi' ? 'min/mi' : 'min/km';
      const avgPaceFormatted = `${formatPaceMinKm(
        paceSecPerKmToUnit(c.avgPaceSecPerKm, distanceUnit),
      )} ${paceUnitLabel}`;
      const splitsLines =
        c.splits && c.splits.length > 0
          ? c.splits.map(
              (sp) =>
                `Km ${sp.kmNumber}: ${formatPaceMinKm(
                  paceSecPerKmToUnit(sp.paceSecPerKm, distanceUnit),
                )} ${paceUnitLabel} (${formatDurationClock(sp.splitTimeSec)})`,
            )
          : [];
      items.push({
        id: `cd_${c.id}`,
        category: 'caminatas',
        dateIso: c.date,
        sortKey: c.completedAt || `${c.date}T12:00:00.000Z`,
        timeLabel: formatTimeHHMM(c.completedAt || c.startedAt),
        badge: CARDIO_LABELS[c.activityType] ?? 'Cardio',
        title: `${CARDIO_LABELS[c.activityType] ?? c.activityType} · ${formatDistance(
          c.distanceKm,
          distanceUnit,
        )}`,
        subtitle: `${formatDurationClock(c.durationSec)} activo · Ritmo ${avgPaceFormatted}`,
        highlightMetric: `${c.caloriesBurned} kcal`,
        isPR: c.isPR || undefined,
        prLabels: c.prLabels,
        details: [
          { label: 'Distancia', value: formatDistance(c.distanceKm, distanceUnit) },
          { label: 'Tiempo activo', value: formatDurationClock(c.durationSec) },
          {
            label: 'Tiempo total',
            value: formatDurationClock(c.totalDurationSec ?? c.durationSec),
          },
          { label: 'Ritmo promedio', value: avgPaceFormatted },
          {
            label: 'Pasos estimados',
            value: (c.estimatedSteps ?? 0).toLocaleString('es-MX'),
          },
          { label: 'Calzado', value: c.shoeName || 'Sin asignar' },
          ...(c.isPR
            ? [
                {
                  label: 'Récord (PR)',
                  value:
                    c.prLabels && c.prLabels.length > 0
                      ? c.prLabels.join(' · ')
                      : 'Récord Personal',
                },
              ]
            : []),
        ],
        subBlocks:
          splitsLines.length > 0
            ? [{ heading: `Parciales (${splitsLines.length})`, lines: splitsLines }]
            : undefined,
        onDelete: () => onDeleteCardioSession(c.id),
      });
    }

    // 3. Peso / Báscula BIA
    const scanDateWeightSet = new Set<string>();
    for (const b of database.bodyScans) {
      scanDateWeightSet.add(`${b.date}_${Math.round(b.weightKg * 10)}`);
      const srcLabel =
        b.source === 'bluetooth'
          ? 'Báscula Bluetooth'
          : b.source === 'captura_ia'
            ? 'Captura IA'
            : 'Registro manual';
      const details: DetailRow[] = [
        { label: 'Peso', value: formatWeight(b.weightKg, weightUnit) },
        { label: 'Grasa corporal', value: `${b.bodyFatPct.toFixed(1)}%` },
        { label: 'Masa muscular', value: `${b.totalMusclePct.toFixed(1)}%` },
        { label: 'Agua corporal', value: `${b.bodyWaterPct.toFixed(1)}%` },
        { label: 'IMC', value: b.bmi.toFixed(1) },
        { label: 'Grasa visceral', value: String(b.visceralFatLevel) },
        { label: 'Masa magra', value: formatWeight(b.leanMassKg, weightUnit) },
        { label: 'Proteína / Ósea', value: `${b.proteinPct.toFixed(1)}% / ${b.boneMassKg.toFixed(1)} kg` },
        { label: 'Edad metabólica', value: `${b.bodyAge} años` },
      ];
      if (typeof b.waistCm === 'number' && b.waistCm > 0) {
        details.push({
          label: 'Cintura',
          value: formatWaist(b.waistCm, lengthUnit),
        });
      }

      items.push({
        id: `sc_${b.id}`,
        category: 'peso',
        dateIso: b.date,
        sortKey: b.recordedAt || `${b.date}T08:00:00.000Z`,
        timeLabel: formatTimeHHMM(b.recordedAt),
        badge: 'Báscula BIA',
        title: `Pesaje ${formatWeight(b.weightKg, weightUnit)}`,
        subtitle: `Grasa ${b.bodyFatPct.toFixed(1)}% · Músculo ${b.totalMusclePct.toFixed(1)}% · ${srcLabel}`,
        highlightMetric: formatWeight(b.weightKg, weightUnit),
        details,
        onDelete: () => onDeleteBodyScan(b.id),
      });
    }

    // 3b. Manual bodyWeights without matching BIA scan on same day/weight
    for (const bw of database.bodyWeights) {
      if (scanDateWeightSet.has(`${bw.date}_${Math.round(bw.weightKg * 10)}`)) {
        continue;
      }
      items.push({
        id: `bw_${bw.id}`,
        category: 'peso',
        dateIso: bw.date,
        sortKey: `${bw.date}T07:30:00.000Z`,
        timeLabel: '07:30',
        badge: 'Peso Corporal',
        title: `Registro de peso ${formatWeight(bw.weightKg, weightUnit)}`,
        subtitle: 'Registro rápido de peso corporal',
        highlightMetric: `${kgToDisplayWeight(bw.weightKg, weightUnit)} ${weightUnit}`,
        details: [
          { label: 'Peso registrado', value: formatWeight(bw.weightKg, weightUnit) },
          { label: 'Fecha', value: bw.date },
        ],
        onDelete: () => onDeleteBodyWeight(bw.id),
      });
    }

    // 4. Nutrición: Comidas & Ayunos
    for (const f of database.foodLogs) {
      const mealName = MEAL_LABELS[f.mealType] ?? f.mealType;
      items.push({
        id: `fd_${f.id}`,
        category: 'nutricion',
        dateIso: f.date,
        sortKey: f.createdAt || `${f.date}T13:00:00.000Z`,
        timeLabel: formatTimeHHMM(f.createdAt),
        badge: mealName,
        title: f.name,
        subtitle: `Proteína ${Math.round(f.proteinG)}g · Carbs ${Math.round(f.carbsG)}g · Grasas ${Math.round(f.fatG)}g`,
        highlightMetric: `${f.calories} kcal`,
        details: [
          { label: 'Tiempo de comida', value: mealName },
          { label: 'Calorías', value: `${f.calories} kcal` },
          { label: 'Proteína', value: `${Math.round(f.proteinG)} g` },
          { label: 'Carbohidratos', value: `${Math.round(f.carbsG)} g` },
          { label: 'Grasas', value: `${Math.round(f.fatG)} g` },
        ],
        onDelete: () => onDeleteFood(f.id),
      });
    }

    for (const fh of database.fastingHistory ?? []) {
      items.push({
        id: `fh_${fh.id}`,
        category: 'nutricion',
        dateIso: fh.date,
        sortKey: fh.endedAt || `${fh.date}T11:00:00.000Z`,
        timeLabel: formatTimeHHMM(fh.endedAt),
        badge: 'Ayuno',
        title: `Ayuno ${fh.protocol} (${fh.actualHours.toFixed(1)} h)`,
        subtitle: fh.completedGoal
          ? `Meta de ${fh.targetHours}h completada`
          : `Meta objetivo: ${fh.targetHours}h`,
        highlightMetric: `${fh.actualHours.toFixed(1)} h`,
        details: [
          { label: 'Protocolo', value: fh.protocol },
          { label: 'Duración real', value: `${fh.actualHours.toFixed(1)} horas` },
          { label: 'Agua durante ayuno', value: `${fh.waterGlassesCount} vasos` },
          { label: 'Electrolitos', value: String(fh.electrolytesCount) },
        ],
        onDelete: () => onDeleteFastHistory(fh.id),
      });
    }

    // 4b. Hidratación (tomas granulares o resumen diario)
    const hydrationDatesSeen = new Set<string>();
    for (const [dateKey, logs] of Object.entries(database.hydrationLogsByDate ?? {})) {
      if (!Array.isArray(logs) || logs.length === 0) continue;
      hydrationDatesSeen.add(dateKey);
      logs.forEach((log, idx) => {
        const displayLiquid = formatLiquid(log.amountMl, liquidUnit);
        items.push({
          id: `hyd_${log.id || `${dateKey}_${idx}`}`,
          category: 'nutricion',
          dateIso: dateKey,
          sortKey: log.recordedAt || `${dateKey}T12:00:00.000Z`,
          timeLabel: formatTimeHHMM(log.recordedAt),
          badge: 'Hidratación',
          title: `Agua registrada (+${displayLiquid})`,
          subtitle: 'Toma de hidratación del día',
          highlightMetric: `+${displayLiquid}`,
          details: [
            { label: 'Cantidad', value: displayLiquid },
            { label: 'Fecha local', value: dateKey },
            { label: 'Hora', value: formatTimeHHMM(log.recordedAt) },
          ],
          onDelete: onDeleteWaterLog
            ? () =>
                onDeleteWaterLog(dateKey, {
                  id: log.id,
                  timestamp: log.recordedAt,
                  date: dateKey,
                  index: idx,
                })
            : undefined,
        });
      });
    }
    for (const [dateKey, ml] of Object.entries(database.hydrationByDate ?? {})) {
      if (ml <= 0 || hydrationDatesSeen.has(dateKey)) continue;
      const displayLiquid = formatLiquid(ml, liquidUnit);
      items.push({
        id: `hyday_${dateKey}`,
        category: 'nutricion',
        dateIso: dateKey,
        sortKey: `${dateKey}T23:55:00.000Z`,
        timeLabel: 'Día',
        badge: 'Hidratación',
        title: `Hidratación acumulada (${displayLiquid})`,
        subtitle: 'Registro diario de agua',
        highlightMetric: displayLiquid,
        details: [
          { label: 'Total del día', value: displayLiquid },
          { label: 'Fecha local', value: dateKey },
        ],
        onDelete: onDeleteWaterLog
          ? () => onDeleteWaterLog(dateKey, { date: dateKey, index: 0 })
          : undefined,
      });
    }

    // 5. Sueño y Signos: Sueño + Pulso PPG + Presión Arterial
    for (const s of database.sleepSessions ?? []) {
      const hasSplit =
        typeof s.remSleepMin === 'number' && typeof s.lightSleepMin === 'number';
      const cyclesLabel =
        typeof s.completedCycles90 === 'number'
          ? `${s.completedCycles90} ciclos`
          : `${Math.floor(s.durationMinutes / 90)} ciclos`;
      const phaseSubtitle = hasSplit
        ? `Calidad ${s.sleepQualityPct}% · ${cyclesLabel} · Profundo ${s.deepSleepMin}m · REM ${s.remSleepMin}m · Ligero ${s.lightSleepMin}m`
        : `Calidad ${s.sleepQualityPct}% · Profundo ${s.deepSleepMin}m · Ligero/REM ${s.lightRemSleepMin}m`;

      items.push({
        id: `sl_${s.id}`,
        category: 'sueno_signos',
        dateIso: s.date,
        sortKey: s.wakeUpAt || `${s.date}T07:00:00.000Z`,
        timeLabel: formatTimeHHMM(s.wakeUpAt),
        badge: 'Sueño',
        title: `Sueño ${formatMinutesAsHoursMin(s.durationMinutes)}`,
        subtitle: phaseSubtitle,
        highlightMetric: `${s.sleepQualityPct}%`,
        details: [
          {
            label: 'Horario',
            value: `${formatTimeHHMM(s.bedtimeAt)} – ${formatTimeHHMM(s.wakeUpAt)}`,
          },
          { label: 'Calidad de sueño', value: `${s.sleepQualityPct}%` },
          { label: 'Ciclos de 90 min', value: cyclesLabel },
          { label: 'Sueño profundo', value: formatMinutesAsHoursMin(s.deepSleepMin) },
          ...(hasSplit
            ? [
                { label: 'Sueño REM', value: formatMinutesAsHoursMin(s.remSleepMin!) },
                { label: 'Sueño ligero', value: formatMinutesAsHoursMin(s.lightSleepMin!) },
              ]
            : [
                { label: 'Ligero / REM', value: formatMinutesAsHoursMin(s.lightRemSleepMin) },
              ]),
          { label: 'Despierto', value: formatMinutesAsHoursMin(s.awakeMin) },
          ...(typeof s.physicalRecoveryPct === 'number' &&
          typeof s.mentalRecoveryPct === 'number'
            ? [
                {
                  label: 'Recup. Física / Mental',
                  value: `${s.physicalRecoveryPct}% / ${s.mentalRecoveryPct}%`,
                },
              ]
            : []),
          {
            label: 'Ronquidos / Ruidos',
            value: `${s.snoreEventsCount} / ${s.noiseEventsCount}`,
          },
          {
            label: 'Alarma inteligente',
            value: s.triggeredBySmartAlarm ? 'Activada en fase ligera' : 'Manual / Hora límite',
          },
        ],
        onDelete: () => onDeleteSleepSession(s.id),
      });
    }

    for (const p of database.pulseHrvRecords ?? []) {
      items.push({
        id: `ppg_${p.id}`,
        category: 'sueno_signos',
        dateIso: p.date,
        sortKey: p.recordedAt || `${p.date}T08:00:00.000Z`,
        timeLabel: formatTimeHHMM(p.recordedAt),
        badge: 'Pulso y HRV',
        title: `Pulso ${p.bpm} BPM · HRV ${p.hrvRmssdMs} ms`,
        subtitle: `${p.source === 'ppg_camara' ? 'Escáner Cámara PPG' : 'Manual'} · Recuperación ${p.recoveryImpactScore}%`,
        highlightMetric: `${p.bpm} BPM`,
        details: [
          { label: 'Pulso promedio', value: `${p.bpm} BPM` },
          { label: 'HRV (RMSSD)', value: `${p.hrvRmssdMs} ms` },
          { label: 'Impacto recuperación', value: `${p.recoveryImpactScore}%` },
          { label: 'Calidad de señal', value: `${p.signalQualityPct}%` },
        ],
        onDelete: () => onDeletePulseRecord(p.id),
      });
    }

    for (const bp of database.bloodPressureRecords ?? []) {
      items.push({
        id: `bp_${bp.id}`,
        category: 'sueno_signos',
        dateIso: bp.date,
        sortKey: bp.recordedAt || `${bp.date}T08:30:00.000Z`,
        timeLabel: formatTimeHHMM(bp.recordedAt),
        badge: 'Presión Arterial',
        title: `Presión ${bp.systolic}/${bp.diastolic} mmHg`,
        subtitle: `Rango: ${bp.category}${bp.pulseBpm ? ` · Pulso ${bp.pulseBpm} BPM` : ''}`,
        highlightMetric: bp.category,
        details: [
          { label: 'Sistólica', value: `${bp.systolic} mmHg` },
          { label: 'Diastólica', value: `${bp.diastolic} mmHg` },
          { label: 'Semáforo', value: bp.category },
          { label: 'Pulso', value: bp.pulseBpm ? `${bp.pulseBpm} BPM` : '--' },
          ...(bp.notes ? [{ label: 'Notas', value: bp.notes }] : []),
        ],
        onDelete: () => onDeleteBloodPressureRecord(bp.id),
      });
    }

    return items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [
    database,
    weightUnit,
    distanceUnit,
    liquidUnit,
    lengthUnit,
    onDeleteWorkout,
    onDeleteHiitSession,
    onDeleteCardioSession,
    onDeleteBodyScan,
    onDeleteBodyWeight,
    onDeleteFood,
    onDeleteFastHistory,
    onDeleteSleepSession,
    onDeletePulseRecord,
    onDeleteBloodPressureRecord,
    onDeleteWaterLog,
  ]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems.filter((item) => {
      if (filter !== 'all' && item.category !== filter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.badge.toLowerCase().includes(q) ||
        item.dateIso.includes(q)
      );
    });
  }, [allItems, filter, query]);

  const groupedByDate = useMemo(() => {
    const groups: { dateIso: string; label: string; items: HistorialItem[] }[] = [];
    const byDate = new Map<string, HistorialItem[]>();

    for (const item of filteredItems) {
      const list = byDate.get(item.dateIso);
      if (list) {
        list.push(item);
      } else {
        byDate.set(item.dateIso, [item]);
      }
    }

    const sortedDates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));
    for (const dateIso of sortedDates) {
      groups.push({
        dateIso,
        label: formatGroupDateLabel(dateIso, todayIso, yesterdayIso),
        items: byDate.get(dateIso)!,
      });
    }
    return groups;
  }, [filteredItems, todayIso, yesterdayIso]);

  const renderCategoryIcon = (item: HistorialItem) => {
    switch (item.category) {
      case 'ejercicios':
        return <Dumbbell className="w-4 h-4 text-[#D4FF33]" />;
      case 'caminatas':
        return <Footprints className="w-4 h-4 text-emerald-400" />;
      case 'peso':
        return <Scale className="w-4 h-4 text-amber-300" />;
      case 'nutricion':
        return item.badge === 'Hidratación' ? (
          <Droplets className="w-4 h-4 text-sky-400" />
        ) : item.badge === 'Ayuno' ? (
          <Flame className="w-4 h-4 text-emerald-400" />
        ) : (
          <Utensils className="w-4 h-4 text-emerald-400" />
        );
      case 'sueno_signos':
        return item.badge === 'Sueño' ? (
          <Moon className="w-4 h-4 text-indigo-300" />
        ) : (
          <HeartPulse className="w-4 h-4 text-rose-400" />
        );
    }
  };

  const clearDayDetailLines = useMemo(() => {
    const b = clearDayBreakdown;
    const lines: string[] = [];
    if (b.workouts > 0) lines.push(`${b.workouts} entrenamiento(s) de fuerza (se recalculará fatiga muscular)`);
    if (b.hiit > 0) lines.push(`${b.hiit} sesión(es) HIIT`);
    if (b.cardio > 0) lines.push(`${b.cardio} ruta(s) GPS / cardio (se ajustará el kilometraje del calzado)`);
    if (b.bodyScans > 0 || b.bodyWeights > 0) lines.push(`${b.bodyScans} escaneo(s) de báscula y ${b.bodyWeights} registro(s) de peso`);
    if (b.pulse > 0 || b.bloodPressure > 0) lines.push(`${b.pulse} lectura(s) PPG/HRV y ${b.bloodPressure} toma(s) de presión`);
    if (b.foods > 0 || b.fasts > 0) lines.push(`${b.foods} comida(s) y ${b.fasts} registro(s) de ayuno`);
    if (b.hydrationMl > 0 || b.hydrationLogs > 0 || b.electrolytes > 0) {
      lines.push(`Hidratación (${formatLiquid(b.hydrationMl, liquidUnit)}) y ${b.electrolytes} electrolitos`);
    }
    if (b.sleep > 0) lines.push(`${b.sleep} sesión(es) de sueño`);
    if (b.measurements > 0) lines.push(`${b.measurements} registro(s) de medidas corporales`);
    if (b.readiness > 0 || b.manualActivity > 0) lines.push('Check-in de preparación y actividad manual de pasos');
    if (includeClearDayPhotos && b.progressPhotoIds.length > 0) {
      lines.push(`${b.progressPhotoIds.length} foto(s) de progreso del día (incluyendo almacenamiento privado)`);
    }
    return lines;
  }, [clearDayBreakdown, includeClearDayPhotos, liquidUnit]);

  const handleConfirmClearDay = async () => {
    if (!onClearDay || isClearingDay) return;
    setIsClearingDay(true);
    try {
      await onClearDay(clearDateIso, includeClearDayPhotos);
      setClearDayFeedback(
        `Se eliminaron los registros del ${clearDateIso} en el perfil activo.`,
      );
      setIsClearDayModalOpen(false);
    } finally {
      setIsClearingDay(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[#D4FF33] text-xs font-bold">
            <Clock className="w-4 h-4" />
            <span>Bitácora cronológica unificada</span>
          </div>
          <h1 className="mt-1 text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">
            Historial
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Todos tus registros ordenados del más reciente al más antiguo. Toca cualquier tarjeta para ver el detalle.
          </p>
        </div>

        <div className="text-xs font-mono tabular-nums text-zinc-400 shrink-0">
          {filteredItems.length} registro{filteredItems.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Filter Pills + Search */}
      <div className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar historial">
          {FILTER_PILLS.map((pill) => {
            const active = filter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(pill.id)}
                className={`min-h-[40px] rounded-xl px-3.5 text-xs font-extrabold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[#D4FF33] text-[#0A0B0D]'
                    : 'border border-[#272C38] bg-[#0D0F14] text-zinc-300 hover:text-white'
                }`}
              >
                {pill.label}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar rutina, ejercicio, comida, caminata o fecha..."
            className="w-full min-h-[44px] rounded-2xl border border-[#272C38] bg-[#0B0C0F] pl-10 pr-4 text-xs text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
          />
        </div>
      </div>

      {/* Collapsible Specific Day Cleanup Center */}
      {onClearDay && (
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] overflow-hidden">
          <button
            type="button"
            onClick={() => {
              setClearDayFeedback(null);
              setShowClearDayPanel((v) => !v);
            }}
            aria-expanded={showClearDayPanel}
            className="w-full min-h-[54px] px-4 sm:px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl border border-rose-500/30 bg-rose-500/12 flex items-center justify-center text-rose-400 shrink-0">
                <Calendar className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Limpiar un día específico</p>
                <p className="text-[11px] text-zinc-400">
                  Borra en bloque todos los registros de una fecha sin afectar el resto del historial
                </p>
              </div>
            </div>
            {showClearDayPanel ? (
              <ChevronUp className="w-4 h-4 text-zinc-400 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
            )}
          </button>

          {showClearDayPanel && (
            <div className="px-4 sm:px-5 pb-5 pt-3 border-t border-white/5 bg-[#0D0F14] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1">
                  <label
                    htmlFor="historial-clear-day-date"
                    className="block text-xs font-semibold text-zinc-300 mb-1.5"
                  >
                    Fecha local a limpiar (YYYY-MM-DD)
                  </label>
                  <input
                    id="historial-clear-day-date"
                    type="date"
                    value={clearDateIso}
                    max={todayIso}
                    onChange={(e) => {
                      if (e.target.value) {
                        setClearDayFeedback(null);
                        setClearDateIso(e.target.value);
                      }
                    }}
                    className="w-full min-h-[44px] rounded-xl border border-[#2A2F3D] bg-[#12141A] px-3 text-sm font-mono text-white focus:border-[#D4FF33] focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setClearDateIso(todayIso)}
                    className={`min-h-[44px] rounded-xl border px-3 text-xs font-bold transition-colors ${
                      clearDateIso === todayIso
                        ? 'border-[#D4FF33] bg-[#D4FF33]/12 text-[#D4FF33]'
                        : 'border-[#2A2F3D] bg-[#12141A] text-zinc-300'
                    }`}
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    onClick={() => setClearDateIso(yesterdayIso)}
                    className={`min-h-[44px] rounded-xl border px-3 text-xs font-bold transition-colors ${
                      clearDateIso === yesterdayIso
                        ? 'border-[#D4FF33] bg-[#D4FF33]/12 text-[#D4FF33]'
                        : 'border-[#2A2F3D] bg-[#12141A] text-zinc-300'
                    }`}
                  >
                    Ayer
                  </button>
                </div>
              </div>

              {/* Live Breakdown Chips */}
              <div className="rounded-2xl border border-[#222631] bg-[#12141A] p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-zinc-200">
                    Registros encontrados el {clearDateIso}
                  </span>
                  <span className="rounded-lg bg-[#1C202B] px-2 py-0.5 text-[11px] font-mono font-bold text-[#D4FF33]">
                    {clearDayBreakdown.totalCount} elemento{clearDayBreakdown.totalCount === 1 ? '' : 's'}
                  </span>
                </div>

                {clearDayBreakdown.totalCount === 0 ? (
                  <p className="text-xs text-zinc-500">
                    No hay registros guardados en esta fecha para el perfil activo.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-mono text-zinc-300">
                    {clearDayBreakdown.workouts > 0 && (
                      <span className="rounded-lg border border-[#2A2F3D] bg-[#0D0F14] px-2 py-1">
                        Fuerza: {clearDayBreakdown.workouts}
                      </span>
                    )}
                    {clearDayBreakdown.hiit > 0 && (
                      <span className="rounded-lg border border-[#2A2F3D] bg-[#0D0F14] px-2 py-1">
                        HIIT: {clearDayBreakdown.hiit}
                      </span>
                    )}
                    {clearDayBreakdown.cardio > 0 && (
                      <span className="rounded-lg border border-[#2A2F3D] bg-[#0D0F14] px-2 py-1">
                        Cardio: {clearDayBreakdown.cardio}
                      </span>
                    )}
                    {(clearDayBreakdown.bodyScans > 0 || clearDayBreakdown.bodyWeights > 0) && (
                      <span className="rounded-lg border border-[#2A2F3D] bg-[#0D0F14] px-2 py-1">
                        Peso/Báscula: {clearDayBreakdown.bodyScans + clearDayBreakdown.bodyWeights}
                      </span>
                    )}
                    {(clearDayBreakdown.pulse > 0 || clearDayBreakdown.bloodPressure > 0) && (
                      <span className="rounded-lg border border-[#2A2F3D] bg-[#0D0F14] px-2 py-1">
                        Pulso/Presión: {clearDayBreakdown.pulse + clearDayBreakdown.bloodPressure}
                      </span>
                    )}
                    {(clearDayBreakdown.foods > 0 || clearDayBreakdown.fasts > 0) && (
                      <span className="rounded-lg border border-[#2A2F3D] bg-[#0D0F14] px-2 py-1">
                        Comidas/Ayuno: {clearDayBreakdown.foods + clearDayBreakdown.fasts}
                      </span>
                    )}
                    {(clearDayBreakdown.hydrationMl > 0 || clearDayBreakdown.hydrationLogs > 0) && (
                      <span className="rounded-lg border border-[#2A2F3D] bg-[#0D0F14] px-2 py-1">
                        Agua: {formatLiquid(clearDayBreakdown.hydrationMl, liquidUnit)}
                      </span>
                    )}
                    {clearDayBreakdown.sleep > 0 && (
                      <span className="rounded-lg border border-[#2A2F3D] bg-[#0D0F14] px-2 py-1">
                        Sueño: {clearDayBreakdown.sleep}
                      </span>
                    )}
                    {clearDayBreakdown.measurements > 0 && (
                      <span className="rounded-lg border border-[#2A2F3D] bg-[#0D0F14] px-2 py-1">
                        Medidas: {clearDayBreakdown.measurements}
                      </span>
                    )}
                    {clearDayBreakdown.progressPhotoIds.length > 0 && (
                      <span className="rounded-lg border border-[#2A2F3D] bg-[#0D0F14] px-2 py-1">
                        Fotos: {clearDayBreakdown.progressPhotoIds.length}
                      </span>
                    )}
                    {(clearDayBreakdown.readiness > 0 || clearDayBreakdown.manualActivity > 0) && (
                      <span className="rounded-lg border border-[#2A2F3D] bg-[#0D0F14] px-2 py-1">
                        Pasos/Check-in: {clearDayBreakdown.readiness + clearDayBreakdown.manualActivity}
                      </span>
                    )}
                  </div>
                )}

                {clearDayBreakdown.progressPhotoIds.length > 0 && (
                  <label className="flex items-center gap-2.5 pt-1 text-xs text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeClearDayPhotos}
                      onChange={(e) => setIncludeClearDayPhotos(e.target.checked)}
                      className="h-4 w-4 accent-rose-500 rounded"
                    />
                    <span>
                      Incluir {clearDayBreakdown.progressPhotoIds.length} foto(s) de progreso de ese día
                    </span>
                  </label>
                )}
              </div>

              {clearDayFeedback && (
                <p role="status" className="text-xs font-semibold text-[#D4FF33]">
                  {clearDayFeedback}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={clearDayBreakdown.totalCount === 0}
                  onClick={() => setIsClearDayModalOpen(true)}
                  className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 hover:bg-rose-500 px-4 text-xs font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" />
                  Limpiar registros del {clearDateIso}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Grouped Chronological Log */}
      {groupedByDate.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#272C38] bg-[#12141A] p-8 text-center space-y-2">
          <Clock className="w-8 h-8 text-zinc-600 mx-auto" />
          <p className="text-sm font-bold text-white">Sin registros en esta categoría</p>
          <p className="text-xs text-zinc-400">
            Tus rutinas, caminatas, pesajes, comidas, noches de sueño y tomas de pulso/presión aparecerán aquí automáticamente.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedByDate.map((group) => (
            <section key={group.dateIso} className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-extrabold text-white tracking-tight">
                  {group.label}
                </h2>
                <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                  {group.dateIso} · {group.items.length}
                </span>
              </div>

              <div className="space-y-2.5">
                {group.items.map((item) => {
                  const isExpanded = expandedId === item.id;

                  return (
                    <article
                      key={item.id}
                      className={`rounded-2xl border transition-colors overflow-hidden ${
                        isExpanded
                          ? 'border-[#D4FF33]/45 bg-[#141720]'
                          : 'border-[#222631] bg-[#12141A] hover:border-zinc-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedId(isExpanded ? null : item.id);
                        }}
                        aria-expanded={isExpanded}
                        className="w-full min-h-[68px] px-4 py-3.5 flex items-center justify-between gap-3 text-left"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-[#181C26] border border-[#262B38] flex items-center justify-center shrink-0 mt-0.5">
                            {renderCategoryIcon(item)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap text-[11px] text-zinc-400">
                              <span className="font-mono tabular-nums">{item.timeLabel}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-bold text-emerald-400">{item.badge}</span>
                              {item.isPR && (
                                <span
                                  title={item.prLabels?.join(' · ') || 'Récord Personal'}
                                  className="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-gradient-to-r from-amber-400/25 via-[#D4FF33]/25 to-amber-400/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-200"
                                >
                                  <Trophy className="w-2.5 h-2.5 text-[#D4FF33]" />
                                  PR
                                </span>
                              )}
                            </div>
                            <p className="text-sm sm:text-base font-bold text-white truncate mt-0.5">
                              {item.title}
                            </p>
                            <p className="text-xs text-zinc-400 truncate mt-0.5">
                              {item.subtitle}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs sm:text-sm font-extrabold font-mono tabular-nums text-[#D4FF33]">
                            {item.highlightMetric}
                          </span>
                          {item.onDelete && (
                            <InlineDeleteConfirmButton
                              onConfirm={() => {
                                item.onDelete?.();
                                if (isExpanded) setExpandedId(null);
                              }}
                              ariaLabel={`Eliminar ${item.title}`}
                              size="sm"
                            />
                          )}
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-zinc-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-zinc-400" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-3 border-t border-white/5 space-y-3.5 bg-[#0D0F14]">
                          {/* Structured Key/Value Detail Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                            {item.details.map((d) => (
                              <div
                                key={`${item.id}_${d.label}`}
                                className="rounded-xl border border-[#222631] bg-[#13161E] px-3 py-2"
                              >
                                <p className="text-[11px] text-zinc-400">{d.label}</p>
                                <p className="mt-0.5 text-xs sm:text-sm font-bold font-mono tabular-nums text-white break-words">
                                  {d.value}
                                </p>
                              </div>
                            ))}
                          </div>

                          {/* Nested Exercise Sets / Cardio Splits */}
                          {item.subBlocks && item.subBlocks.length > 0 && (
                            <div className="space-y-2.5 pt-1">
                              {item.subBlocks.map((block, bIdx) => (
                                <div
                                  key={`${item.id}_blk_${bIdx}`}
                                  className="rounded-xl border border-[#222631] bg-[#12141A] p-3 space-y-1"
                                >
                                  <p className="text-xs font-bold text-[#D4FF33]">
                                    {block.heading}
                                  </p>
                                  <ul className="space-y-1">
                                    {block.lines.map((line, lIdx) => {
                                      const lineText =
                                        typeof line === 'string' ? line : line.text;
                                      const lineIsPR =
                                        typeof line !== 'string' && Boolean(line.isPR);
                                      const linePrLabels =
                                        typeof line !== 'string' ? line.prLabels : undefined;
                                      return (
                                        <li
                                          key={lIdx}
                                          className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-zinc-300"
                                        >
                                          <span>{lineText}</span>
                                          {lineIsPR && (
                                            <span
                                              title={
                                                linePrLabels?.join(' · ') || 'Récord Personal'
                                              }
                                              className="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-gradient-to-r from-amber-400/25 via-[#D4FF33]/25 to-amber-400/20 px-2 py-0.5 text-[10px] font-sans font-extrabold uppercase tracking-wider text-amber-200"
                                            >
                                              <Trophy className="w-2.5 h-2.5 text-[#D4FF33]" />
                                              PR
                                              {linePrLabels && linePrLabels.length > 0
                                                ? ` · ${linePrLabels.join(' · ')}`
                                                : ''}
                                            </span>
                                          )}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Safe 2-Tap Delete Confirmation */}
                          {item.onDelete && (
                            <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-end gap-2">
                              <InlineDeleteConfirmButton
                                onConfirm={() => {
                                  item.onDelete?.();
                                  setExpandedId(null);
                                }}
                                ariaLabel={`Eliminar registro ${item.title}`}
                                confirmLabel="¿Borrar?"
                                size="md"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <DataCleanupConfirmModal
        isOpen={isClearDayModalOpen}
        title={`¿Limpiar todos los registros del ${clearDateIso}?`}
        description="Esta acción eliminará permanentemente los datos de esta fecha en el perfil activo y recalculará fatiga muscular, peso actual, kilometraje de calzado y recordatorios."
        details={clearDayDetailLines}
        confirmButtonLabel={`Eliminar ${clearDayBreakdown.totalCount} registro(s)`}
        dangerLevel="destructive"
        isProcessing={isClearingDay}
        onCancel={() => setIsClearDayModalOpen(false)}
        onConfirm={handleConfirmClearDay}
      />
    </div>
  );
};
