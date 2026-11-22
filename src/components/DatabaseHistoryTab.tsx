import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Database,
  Download,
  Dumbbell,
  FileSpreadsheet,
  Footprints,
  HeartPulse,
  Moon,
  Scale,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  Utensils,
} from 'lucide-react';
import { DataCleanupConfirmModal } from './DataCleanupConfirmModal';
import { InlineDeleteConfirmButton } from './InlineDeleteConfirmButton';
import { PulsePressureSection } from './PulsePressureSection';
import { BackupPreviewModal } from './BackupPreviewModal';

const CompareDatesView = React.lazy(() =>
  import('./CompareDatesView').then((m) => ({ default: m.CompareDatesView })),
);
import { formatMinutesAsHoursMin } from '../lib/sleepEngine';
import {
  type BackupPreviewCounts,
  type CleanupCategoryId,
  type RecordDeleteTarget,
  exportDatabaseToCsv,
  exportDatabaseToJson,
  getBackupAgeInfo,
  getLocalDateKey,
  getTodayIsoDate,
  parseAndValidateBackupJson,
  summarizeBackupCounts,
  summarizeCategoryCounts,
} from '../lib/storage';

const SleepRecoverySection = React.lazy(() =>
  import('./SleepRecoverySection').then((m) => ({ default: m.SleepRecoverySection })),
);
import {
  formatDistance,
  formatLiquid,
  formatVolume,
  formatWeight,
  getDistanceUnit,
  getLiquidUnit,
  getWeightUnit,
} from '../lib/units';
import type {
  AppDatabase,
  BloodPressureRecord,
  CardioActivityType,
  PulseHrvRecord,
  SleepSession,
} from '../types/fitness';

interface DatabaseHistoryTabProps {
  database: AppDatabase;
  activeProfileLabel: string;
  onDeleteWorkout: (workoutId: string) => void;
  onDeleteHiitSession?: (hiitId: string) => void;
  onDeleteCardioSession: (sessionId: string) => void;
  onDeleteBodyScan: (scanId: string) => void;
  onDeleteBodyWeight?: (weightId: string) => void;
  onDeleteFood: (foodId: string) => void;
  onDeleteWaterLog?: (date: string, target: RecordDeleteTarget | string) => void;
  openSleepSignal?: number;
  onSaveSleepSession?: (session: SleepSession) => void;
  onDeleteSleepSession?: (sleepId: string) => void;
  openPulseSignal?: number;
  onSavePulseRecord?: (record: PulseHrvRecord) => void;
  onDeletePulseRecord?: (pulseId: string) => void;
  onSaveBloodPressureRecord?: (record: BloodPressureRecord) => void;
  onDeleteBloodPressureRecord?: (bpId: string) => void;
  onImportDatabase: (nextDb: AppDatabase) => void;
  onOpenScale: () => void;
  onClearCategory?: (category: CleanupCategoryId) => Promise<void> | void;
  onClearProfileHistory?: () => Promise<void> | void;
  onFactoryReset?: () => Promise<void> | void;
}

type ModuleFilter =
  | 'all'
  | 'strength'
  | 'cardio'
  | 'scale'
  | 'nutrition'
  | 'sleep'
  | 'pulse';

const CARDIO_LABELS: Record<CardioActivityType, string> = {
  correr: 'Carrera',
  caminar: 'Caminata',
  ciclismo: 'Ciclismo',
  caminadora: 'Caminadora',
};

const MEAL_LABELS: Record<string, string> = {
  desayuno: 'Desayuno',
  comida: 'Comida',
  cena: 'Cena',
  snack: 'Snack',
};

interface UnifiedRecord {
  id: string;
  module: Exclude<ModuleFilter, 'all'>;
  sortKey: string;
  dateLabel: string;
  title: string;
  subtitle: string;
  metricsLine: string;
  badgeText: string;
  deletable: boolean;
  onDelete?: () => void;
}

export const DatabaseHistoryTab: React.FC<DatabaseHistoryTabProps> = ({
  database,
  activeProfileLabel,
  onDeleteWorkout,
  onDeleteHiitSession = () => {},
  onDeleteCardioSession,
  onDeleteBodyScan,
  onDeleteBodyWeight = () => {},
  onDeleteFood,
  onDeleteWaterLog,
  openSleepSignal = 0,
  onSaveSleepSession = () => {},
  onDeleteSleepSession = () => {},
  openPulseSignal = 0,
  onSavePulseRecord = () => {},
  onDeletePulseRecord = () => {},
  onSaveBloodPressureRecord = () => {},
  onDeleteBloodPressureRecord = () => {},
  onImportDatabase,
  onOpenScale,
  onClearCategory,
  onClearProfileHistory,
  onFactoryReset,
}) => {
  const [dbView, setDbView] = useState<'historial' | 'pulso' | 'sueno' | 'comparar'>(
    openPulseSignal > 0 ? 'pulso' : openSleepSignal > 0 ? 'sueno' : 'historial',
  );
  const [filter, setFilter] = useState<ModuleFilter>('all');
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'error';
    message: string;
  } | null>(null);
  const [pendingBackup, setPendingBackup] = useState<{
    db: AppDatabase;
    counts: BackupPreviewCounts;
    fileName: string;
  } | null>(null);
  const [backupAge, setBackupAge] = useState(() => getBackupAgeInfo());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingCategoryClear, setPendingCategoryClear] = useState<{
    category: CleanupCategoryId;
    label: string;
    count: number;
  } | null>(null);
  const [pendingDangerAction, setPendingDangerAction] = useState<
    'profile_history' | 'factory_reset' | null
  >(null);
  const [isCleaning, setIsCleaning] = useState(false);

  const categorySummaries = useMemo(
    () => summarizeCategoryCounts(database),
    [database],
  );

  React.useEffect(() => {
    if (openSleepSignal > 0) setDbView('sueno');
  }, [openSleepSignal]);

  React.useEffect(() => {
    if (openPulseSignal > 0) setDbView('pulso');
  }, [openPulseSignal]);

  const todayReadiness = database.readinessByDate?.[getTodayIsoDate()] ?? null;

  const weightUnit = getWeightUnit(database.profile.weightUnit);
  const distanceUnit = getDistanceUnit(database.profile.distanceUnit);
  const liquidUnit = getLiquidUnit(database.profile.liquidUnit);

  const hydrationDaysCount = useMemo(
    () => Object.values(database.hydrationByDate ?? {}).filter((ml) => ml > 0).length,
    [database.hydrationByDate],
  );

  const unifiedRecords = useMemo<UnifiedRecord[]>(() => {
    const items: UnifiedRecord[] = [];

    // 1. Fuerza y Ligas
    for (const w of database.workouts) {
      const hasBands = w.exercises.some((ex) => ex.loadMode === 'bands');
      const bandLabels = Array.from(
        new Set(
          w.exercises
            .filter((ex) => ex.loadMode === 'bands' && ex.bandConfig?.label)
            .map((ex) => ex.bandConfig!.label),
        ),
      );
      const mins = Math.max(1, Math.round(w.durationSec / 60));
      items.push({
        id: `wk_${w.id}`,
        module: 'strength',
        sortKey: w.completedAt,
        dateLabel: getLocalDateKey(w.completedAt),
        title: w.title,
        subtitle:
          bandLabels.length > 0
            ? `${w.exercises.length} ejercicios · ${bandLabels.join(', ')}`
            : `${w.exercises.length} ejercicios de fuerza`,
        metricsLine: `${w.completedSets} series · Vol. ${formatVolume(
          w.totalVolumeKg,
          weightUnit,
        )} · ${mins} min`,
        badgeText: hasBands ? 'Fuerza / Ligas' : 'Fuerza',
        deletable: true,
        onDelete: () => onDeleteWorkout(w.id),
      });
    }

    // 1b. HIIT / Tabata
    for (const h of database.hiitSessions ?? []) {
      items.push({
        id: `ht_${h.id}`,
        module: 'strength',
        sortKey: h.completedAt || `${h.date}T12:00:00.000Z`,
        dateLabel: h.date,
        title: h.name,
        subtitle: `${h.rounds} rondas × ${h.cycles} ciclos (${h.workSec}s/${h.restSec}s)`,
        metricsLine: `${Math.max(1, Math.round(h.totalDurationSec / 60))} min · ${h.caloriesBurned} kcal`,
        badgeText: 'HIIT',
        deletable: true,
        onDelete: () => onDeleteHiitSession(h.id),
      });
    }

    // 2. Cardio / Caminatas
    for (const c of database.cardioSessions ?? []) {
      const mins = Math.max(1, Math.round(c.durationSec / 60));
      items.push({
        id: `cd_${c.id}`,
        module: 'cardio',
        sortKey: c.completedAt || `${c.date}T12:00:00.000Z`,
        dateLabel: c.date,
        title: CARDIO_LABELS[c.activityType] ?? c.activityType,
        subtitle: c.shoeName ? `Calzado: ${c.shoeName}` : 'Sesión registrada',
        metricsLine: `${formatDistance(c.distanceKm, distanceUnit)} · ${mins} min · ${c.caloriesBurned} kcal`,
        badgeText: 'Cardio / Caminata',
        deletable: true,
        onDelete: () => onDeleteCardioSession(c.id),
      });
    }

    // 3. Báscula BIA + Pesos rápidos
    const scanDateWeightSet = new Set<string>();
    for (const b of database.bodyScans) {
      scanDateWeightSet.add(`${b.date}_${Math.round(b.weightKg * 10)}`);
      const sourceLabel =
        b.source === 'bluetooth'
          ? 'Bluetooth'
          : b.source === 'captura_ia'
            ? 'Captura IA'
            : 'Manual';
      items.push({
        id: `sc_${b.id}`,
        module: 'scale',
        sortKey: b.recordedAt || `${b.date}T08:00:00.000Z`,
        dateLabel: b.date,
        title: `Pesaje Báscula (${formatWeight(b.weightKg, weightUnit)})`,
        subtitle: `Fuente: ${sourceLabel} · IMC ${b.bmi.toFixed(1)} · Grasa visceral ${b.visceralFatLevel}`,
        metricsLine: `Grasa ${b.bodyFatPct.toFixed(1)}% · Músculo ${b.totalMusclePct.toFixed(
          1,
        )}% · Agua ${b.bodyWaterPct.toFixed(1)}%`,
        badgeText: 'Báscula BIA',
        deletable: true,
        onDelete: () => onDeleteBodyScan(b.id),
      });
    }

    for (const bw of database.bodyWeights ?? []) {
      if (scanDateWeightSet.has(`${bw.date}_${Math.round(bw.weightKg * 10)}`)) {
        continue;
      }
      items.push({
        id: `bw_${bw.id}`,
        module: 'scale',
        sortKey: `${bw.date}T07:30:00.000Z`,
        dateLabel: bw.date,
        title: `Registro de peso (${formatWeight(bw.weightKg, weightUnit)})`,
        subtitle: 'Peso corporal manual guardado',
        metricsLine: formatWeight(bw.weightKg, weightUnit),
        badgeText: 'Peso Corporal',
        deletable: true,
        onDelete: () => onDeleteBodyWeight(bw.id),
      });
    }

    // 4. Nutrición y Agua
    for (const f of database.foodLogs) {
      items.push({
        id: `fd_${f.id}`,
        module: 'nutrition',
        sortKey: f.createdAt || `${f.date}T13:00:00.000Z`,
        dateLabel: f.date,
        title: f.name,
        subtitle: MEAL_LABELS[f.mealType] ?? f.mealType,
        metricsLine: `${f.calories} kcal · P ${Math.round(f.proteinG)}g · C ${Math.round(
          f.carbsG,
        )}g · G ${Math.round(f.fatG)}g`,
        badgeText: 'Nutrición',
        deletable: true,
        onDelete: () => onDeleteFood(f.id),
      });
    }

    const hydrationDatesWithLogs = new Set<string>();
    for (const [date, logs] of Object.entries(database.hydrationLogsByDate ?? {})) {
      if (!Array.isArray(logs) || logs.length === 0) continue;
      hydrationDatesWithLogs.add(date);
      logs.forEach((log, idx) => {
        const displayLiq = formatLiquid(log.amountMl, liquidUnit);
        items.push({
          id: `hyd_${log.id || `${date}_${idx}`}`,
          module: 'nutrition',
          sortKey: log.recordedAt || `${date}T12:00:00.000Z`,
          dateLabel: date,
          title: `Agua tomada (+${displayLiq})`,
          subtitle: 'Toma individual de hidratación',
          metricsLine: `+${displayLiq}`,
          badgeText: 'Agua',
          deletable: Boolean(onDeleteWaterLog),
          onDelete: onDeleteWaterLog
            ? () =>
                onDeleteWaterLog(date, {
                  id: log.id,
                  timestamp: log.recordedAt,
                  date,
                  index: idx,
                })
            : undefined,
        });
      });
    }

    for (const [date, ml] of Object.entries(database.hydrationByDate ?? {})) {
      if (ml > 0 && !hydrationDatesWithLogs.has(date)) {
        items.push({
          id: `hy_${date}`,
          module: 'nutrition',
          sortKey: `${date}T23:59:00.000Z`,
          dateLabel: date,
          title: `Hidratación del día (${formatLiquid(ml, liquidUnit)})`,
          subtitle: 'Resumen diario de agua tomada',
          metricsLine: `${formatLiquid(ml, liquidUnit)} acumulados`,
          badgeText: 'Agua',
          deletable: Boolean(onDeleteWaterLog),
          onDelete: onDeleteWaterLog
            ? () => onDeleteWaterLog(date, { date, index: 0 })
            : undefined,
        });
      }
    }

    // 5. Sueño y Descanso
    for (const s of database.sleepSessions ?? []) {
      const hasSplit =
        typeof s.remSleepMin === 'number' && typeof s.lightSleepMin === 'number';
      const cyclesCount =
        typeof s.completedCycles90 === 'number'
          ? s.completedCycles90
          : Math.floor(s.durationMinutes / 90);
      items.push({
        id: `sl_${s.id}`,
        module: 'sleep',
        sortKey: s.wakeUpAt || `${s.date}T07:00:00.000Z`,
        dateLabel: s.date,
        title: `Sueño ${formatMinutesAsHoursMin(s.durationMinutes)} (Calidad ${s.sleepQualityPct}% · ${cyclesCount} ciclos)`,
        subtitle: hasSplit
          ? `Profundo ${s.deepSleepMin}m · REM ${s.remSleepMin}m · Ligero ${s.lightSleepMin}m · Despierto ${s.awakeMin}m`
          : `Profundo ${s.deepSleepMin}m · Ligero/REM ${s.lightRemSleepMin}m · Despierto ${s.awakeMin}m`,
        metricsLine: `${
          typeof s.physicalRecoveryPct === 'number' && typeof s.mentalRecoveryPct === 'number'
            ? `Recup. Física ${s.physicalRecoveryPct}% · Mental ${s.mentalRecoveryPct}% · `
            : ''
        }Ronquidos: ${s.snoreEventsCount} · Ruidos: ${s.noiseEventsCount}${
          s.triggeredBySmartAlarm ? ' · Alarma inteligente' : ''
        }`,
        badgeText: 'Sueño',
        deletable: true,
        onDelete: () => onDeleteSleepSession(s.id),
      });
    }

    // 6. Pulso PPG y Presión Arterial
    for (const p of database.pulseHrvRecords ?? []) {
      items.push({
        id: `pg_${p.id}`,
        module: 'pulse',
        sortKey: p.recordedAt || `${p.date}T08:00:00.000Z`,
        dateLabel: p.date,
        title: `Pulso ${p.bpm} BPM · HRV ${p.hrvRmssdMs} ms`,
        subtitle: `Fuente: ${p.source === 'ppg_camara' ? 'Cámara PPG' : 'Manual'}`,
        metricsLine: `Recuperación ${p.recoveryImpactScore}% · Calidad señal ${p.signalQualityPct}%`,
        badgeText: 'Pulso PPG',
        deletable: true,
        onDelete: () => onDeletePulseRecord(p.id),
      });
    }

    for (const bp of database.bloodPressureRecords ?? []) {
      items.push({
        id: `bp_${bp.id}`,
        module: 'pulse',
        sortKey: bp.recordedAt || `${bp.date}T08:30:00.000Z`,
        dateLabel: bp.date,
        title: `Presión ${bp.systolic}/${bp.diastolic} mmHg (${bp.category})`,
        subtitle: bp.notes || 'Toma registrada en IndexedDB',
        metricsLine: bp.pulseBpm ? `Pulso ${bp.pulseBpm} BPM` : `Clasificación: ${bp.category}`,
        badgeText: 'Presión Arterial',
        deletable: true,
        onDelete: () => onDeleteBloodPressureRecord(bp.id),
      });
    }

    return items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [
    database.workouts,
    database.hiitSessions,
    database.cardioSessions,
    database.bodyScans,
    database.bodyWeights,
    database.foodLogs,
    database.hydrationByDate,
    database.hydrationLogsByDate,
    database.sleepSessions,
    database.pulseHrvRecords,
    database.bloodPressureRecords,
    weightUnit,
    distanceUnit,
    liquidUnit,
    onDeleteWorkout,
    onDeleteHiitSession,
    onDeleteCardioSession,
    onDeleteBodyScan,
    onDeleteBodyWeight,
    onDeleteFood,
    onDeleteWaterLog,
    onDeleteSleepSession,
    onDeletePulseRecord,
    onDeleteBloodPressureRecord,
  ]);

  const filteredRecords = useMemo(() => {
    const q = query.trim().toLowerCase();
    return unifiedRecords.filter((item) => {
      if (filter !== 'all' && item.module !== filter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.dateLabel.includes(q) ||
        item.badgeText.toLowerCase().includes(q)
      );
    });
  }, [unifiedRecords, filter, query]);

  const handleExportJson = () => {
    exportDatabaseToJson(database, activeProfileLabel);
    setBackupAge(getBackupAgeInfo());
    setFeedback({
      type: 'ok',
      message: `Respaldo JSON de "${activeProfileLabel}" exportado correctamente.`,
    });
  };

  const handleExportCsv = () => {
    exportDatabaseToCsv(database, activeProfileLabel);
    setFeedback({
      type: 'ok',
      message: `Historial CSV de "${activeProfileLabel}" exportado (listo para Excel).`,
    });
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const validated = parseAndValidateBackupJson(text);
      const counts = summarizeBackupCounts(validated);
      setPendingBackup({
        db: validated,
        counts,
        fileName: file.name,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo importar el archivo JSON seleccionado.',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmPendingImport = () => {
    if (!pendingBackup) return;
    const { db, counts } = pendingBackup;
    onImportDatabase(db);
    setPendingBackup(null);
    setFeedback({
      type: 'ok',
      message: `Respaldo importado en "${activeProfileLabel}": ${counts.workouts} rutinas, ${counts.cardioSessions} cardio y ${counts.bodyScans} pesajes.`,
    });
  };

  const renderModuleIcon = (mod: Exclude<ModuleFilter, 'all'>) => {
    switch (mod) {
      case 'strength':
        return <Dumbbell className="w-4 h-4 text-[#D4FF33]" />;
      case 'cardio':
        return <Footprints className="w-4 h-4 text-sky-400" />;
      case 'scale':
        return <Scale className="w-4 h-4 text-amber-300" />;
      case 'nutrition':
        return <Utensils className="w-4 h-4 text-emerald-400" />;
      case 'sleep':
        return <Moon className="w-4 h-4 text-indigo-300" />;
      case 'pulse':
        return <HeartPulse className="w-4 h-4 text-rose-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-6 h-6 text-[#D4FF33]" />
            <h1 className="text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">
              Base de Datos
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Historial centralizado en IndexedDB · Perfil activo:{' '}
            <span className="font-bold text-[#D4FF33]">{activeProfileLabel}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-2xl bg-[#12141A] border border-[#222631] p-1">
            <button
              type="button"
              onClick={() => setDbView('historial')}
              className={`min-h-[40px] px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                dbView === 'historial'
                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              <Database className="w-3.5 h-3.5 shrink-0" />
              Datos
            </button>
            <button
              type="button"
              onClick={() => setDbView('pulso')}
              className={`min-h-[40px] px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                dbView === 'pulso'
                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              <HeartPulse className="w-3.5 h-3.5 shrink-0" />
              Pulso y Presión
            </button>
            <button
              type="button"
              onClick={() => setDbView('sueno')}
              className={`min-h-[40px] px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                dbView === 'sueno'
                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              <Moon className="w-3.5 h-3.5 shrink-0" />
              Sueño
            </button>
            <button
              type="button"
              onClick={() => setDbView('comparar')}
              className={`min-h-[40px] px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                dbView === 'comparar'
                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              <CalendarRange className="w-3.5 h-3.5 shrink-0" />
              Comparar
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenScale}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-2xl border border-[#2A2F3D] bg-[#141720] px-4 text-xs font-bold text-white hover:border-[#D4FF33]/50"
          >
            <Scale className="w-4 h-4 text-[#D4FF33]" />
            Registrar báscula
          </button>
        </div>
      </div>

      {dbView === 'comparar' ? (
        <React.Suspense
          fallback={
            <div className="space-y-4 animate-pulse">
              <div className="h-44 rounded-3xl bg-[#12141A] border border-[#222631]" />
              <div className="h-36 rounded-3xl bg-[#12141A] border border-[#222631]" />
            </div>
          }
        >
          <CompareDatesView database={database} />
        </React.Suspense>
      ) : dbView === 'pulso' ? (
        <PulsePressureSection
          pulseRecords={database.pulseHrvRecords ?? []}
          bloodPressureRecords={database.bloodPressureRecords ?? []}
          todayReadiness={todayReadiness}
          onSavePulseRecord={onSavePulseRecord}
          onDeletePulseRecord={onDeletePulseRecord}
          onSaveBloodPressureRecord={onSaveBloodPressureRecord}
          onDeleteBloodPressureRecord={onDeleteBloodPressureRecord}
        />
      ) : dbView === 'sueno' ? (
        <React.Suspense
          fallback={
            <div className="space-y-4 animate-pulse">
              <div className="h-44 rounded-3xl bg-[#12141A] border border-[#222631]" />
              <div className="h-36 rounded-3xl bg-[#12141A] border border-[#222631]" />
            </div>
          }
        >
          <SleepRecoverySection
            sleepSessions={database.sleepSessions ?? []}
            todayReadiness={todayReadiness}
            onSaveSleepSession={onSaveSleepSession}
            onDeleteSleepSession={onDeleteSleepSession}
          />
        </React.Suspense>
      ) : (
        <>
      {/* 1-Tap Backup Toolbar */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
        <div>
          <h2 className="text-lg font-bold font-display text-white">
            Respaldos externos en 1 toque
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Guarda una copia completa (.json restaurable o .csv para Excel) o importa un respaldo previo en este perfil.
          </p>
        </div>

        <div
          className={`rounded-2xl border px-3.5 py-2.5 flex items-start gap-2.5 text-xs ${
            backupAge.isOverdue
              ? 'border-amber-400/40 bg-amber-500/10 text-amber-100'
              : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
          }`}
        >
          {backupAge.isOverdue ? (
            <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
          )}
          <div className="space-y-0.5">
            <p className="font-bold">
              {backupAge.lastIso
                ? `Último respaldo JSON: ${new Date(backupAge.lastIso).toLocaleDateString('es-MX', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })} · hace ${backupAge.daysSince} ${backupAge.daysSince === 1 ? 'día' : 'días'}`
                : 'Último respaldo JSON: Ninguno exportado aún'}
            </p>
            {backupAge.daysSince !== null && backupAge.daysSince >= 7 && (
              <p className="text-amber-200/90">
                Han pasado más de 7 días sin respaldar. Exporta un archivo .json para proteger tu historial.
              </p>
            )}
            {backupAge.daysSince === null && (
              <p className="text-amber-200/90">
                Recomendación: exporta tu primer respaldo .json cada 7 días para tener una copia segura.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={handleExportJson}
            className="min-h-[50px] flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] px-4 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
          >
            <Download className="w-4 h-4" />
            Exportar Respaldo (.json)
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="min-h-[50px] flex items-center justify-center gap-2 rounded-2xl border border-[#D4FF33]/40 bg-[#181B23] px-4 text-sm font-bold text-[#D4FF33] hover:bg-[#20242F] active:scale-[0.98] transition-transform"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar Tabla (.csv)
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[50px] flex items-center justify-center gap-2 rounded-2xl border border-[#2E3442] bg-[#181B23] px-4 text-sm font-bold text-white hover:bg-[#20242F] active:scale-[0.98] transition-transform"
          >
            <Upload className="w-4 h-4 text-[#D4FF33]" />
            Importar Respaldo (.json)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>

        {feedback && (
          <p
            role="status"
            className={`text-sm font-semibold ${
              feedback.type === 'ok' ? 'text-[#D4FF33]' : 'text-rose-400'
            }`}
          >
            {feedback.message}
          </p>
        )}
      </section>

      {/* Summary KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-[#222631] bg-[#12141A] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400">Fuerza / Ligas</span>
            <Dumbbell className="w-4 h-4 text-[#D4FF33]" />
          </div>
          <p className="mt-2 text-2xl font-extrabold font-mono tabular-nums text-white">
            {database.workouts.length}
          </p>
          <p className="text-[11px] text-zinc-500">rutinas guardadas</p>
        </div>

        <div className="rounded-2xl border border-[#222631] bg-[#12141A] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400">Cardio / GPS</span>
            <Footprints className="w-4 h-4 text-sky-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold font-mono tabular-nums text-white">
            {(database.cardioSessions ?? []).length}
          </p>
          <p className="text-[11px] text-zinc-500">caminatas y carreras</p>
        </div>

        <div className="rounded-2xl border border-[#222631] bg-[#12141A] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400">Báscula BIA</span>
            <Scale className="w-4 h-4 text-amber-300" />
          </div>
          <p className="mt-2 text-2xl font-extrabold font-mono tabular-nums text-white">
            {database.bodyScans.length}
          </p>
          <p className="text-[11px] text-zinc-500">escaneos corporales</p>
        </div>

        <div className="rounded-2xl border border-[#222631] bg-[#12141A] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400">Nutrición / Agua</span>
            <Utensils className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold font-mono tabular-nums text-white">
            {database.foodLogs.length}
          </p>
          <p className="text-[11px] text-zinc-500">
            comidas · {hydrationDaysCount}d agua
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'all', label: 'Todo' },
                { id: 'strength', label: 'Fuerza / Ligas' },
                { id: 'cardio', label: 'Caminatas / Cardio' },
                { id: 'scale', label: 'Báscula' },
                { id: 'pulse', label: 'Pulso / Presión' },
                { id: 'sleep', label: 'Sueño' },
                { id: 'nutrition', label: 'Nutrición' },
              ] as { id: ModuleFilter; label: string }[]
            ).map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`min-h-[40px] rounded-xl px-3.5 text-xs font-bold transition-colors ${
                    active
                      ? 'bg-[#D4FF33] text-[#0A0B0D]'
                      : 'border border-[#272C38] bg-[#0E1014] text-zinc-300 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative sm:w-64">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar fecha, alimento o rutina..."
              className="w-full min-h-[42px] rounded-xl border border-[#272C38] bg-[#0B0C0F] pl-10 pr-3 text-xs text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
            />
          </div>
        </div>

        {/* Unified Chronological Table / Cards */}
        {filteredRecords.length === 0 ? (
          <div className="py-10 text-center space-y-2 border border-dashed border-[#252A36] rounded-2xl">
            <p className="text-sm font-semibold text-zinc-300">
              No hay registros en esta vista para {activeProfileLabel}.
            </p>
            <p className="text-xs text-zinc-500">
              Tus entrenamientos, caminatas, pesajes y comidas aparecerán aquí ordenados por fecha.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredRecords.map((row) => (
              <div
                key={row.id}
                className="py-3.5 flex items-start justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#181C25] border border-[#242936] flex items-center justify-center shrink-0 mt-0.5">
                    {renderModuleIcon(row.module)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-mono text-zinc-400">
                        {row.dateLabel}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#D4FF33]">
                        {row.badgeText}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-white truncate mt-0.5">
                      {row.title}
                    </p>
                    <p className="text-xs text-zinc-400 truncate">{row.subtitle}</p>
                    <p className="text-xs font-mono tabular-nums text-zinc-200 mt-1">
                      {row.metricsLine}
                    </p>
                  </div>
                </div>

                {row.deletable && row.onDelete && (
                  <InlineDeleteConfirmButton
                    onConfirm={row.onDelete}
                    ariaLabel={`Eliminar registro ${row.title}`}
                    size="md"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Category Data Cleanup Manager */}
      {onClearCategory && (
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold font-display text-white">
                Gestión y Limpieza de Datos
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Limpia una categoría completa del perfil activo ({activeProfileLabel}) manteniendo el resto intacto.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {categorySummaries.map((cat) => (
              <div
                key={cat.category}
                className="rounded-2xl border border-[#222631] bg-[#0E1014] p-3.5 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-white">
                      {cat.label}
                    </span>
                    <span className="rounded-lg bg-[#181C26] border border-[#262C3A] px-2 py-0.5 text-[11px] font-mono font-bold text-[#D4FF33] shrink-0">
                      {cat.count}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    {cat.description}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={cat.count === 0}
                  onClick={() =>
                    setPendingCategoryClear({
                      category: cat.category,
                      label: cat.label,
                      count: cat.count,
                    })
                  }
                  className="min-h-[38px] w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs font-bold text-rose-300 hover:bg-rose-500/20 transition disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Limpiar categoría
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Danger Zone: Two-tier cleanup */}
      {(onClearProfileHistory || onFactoryReset) && (
        <section className="rounded-3xl border border-rose-500/35 bg-[#150E12] p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl border border-rose-500/40 bg-rose-500/15 flex items-center justify-center text-rose-400 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-display text-white">
                Zona de peligro
              </h2>
              <p className="text-xs text-rose-200/80 mt-0.5">
                Acciones irreversibles sobre el almacenamiento local en IndexedDB. Recomendamos exportar un respaldo .json antes de continuar.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {onClearProfileHistory && (
              <div className="rounded-2xl border border-rose-500/25 bg-[#0D0F14] p-4 flex flex-col justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-extrabold text-white">
                    Vaciar historial del perfil activo
                  </p>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Borra rutinas, cardio, báscula, pesos, PPG, presión, comidas, agua, sueño, medidas y fotos de "{activeProfileLabel}". Conserva tus datos físicos, metas, equipo y plantillas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingDangerAction('profile_history')}
                  className="min-h-[44px] w-full rounded-xl border border-rose-500/50 bg-rose-600/20 hover:bg-rose-600/30 px-4 text-xs font-extrabold text-rose-200 transition"
                >
                  Vaciar historial (conservar perfil y metas)
                </button>
              </div>
            )}

            {onFactoryReset && (
              <div className="rounded-2xl border border-rose-500/45 bg-[#0D0F14] p-4 flex flex-col justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-extrabold text-rose-300">
                    Reinicio total de fábrica
                  </p>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Elimina absolutamente todos los perfiles, bases de datos IndexedDB, fotografías privadas y preferencias guardadas en este dispositivo.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingDangerAction('factory_reset')}
                  className="min-h-[44px] w-full rounded-xl bg-rose-600 hover:bg-rose-500 px-4 text-xs font-extrabold text-white transition"
                >
                  Borrar absolutamente todo
                </button>
              </div>
            )}
          </div>
        </section>
      )}
        </>
      )}

      <BackupPreviewModal
        isOpen={pendingBackup !== null}
        fileName={pendingBackup?.fileName ?? ''}
        targetProfileLabel={activeProfileLabel}
        counts={pendingBackup?.counts ?? null}
        onCancel={() => setPendingBackup(null)}
        onConfirm={handleConfirmPendingImport}
      />

      <DataCleanupConfirmModal
        isOpen={pendingCategoryClear !== null}
        title={`¿Limpiar "${pendingCategoryClear?.label ?? ''}"?`}
        description={`Se eliminarán ${pendingCategoryClear?.count ?? 0} registro(s) de esta categoría en el perfil "${activeProfileLabel}" y se actualizarán gráficas e indicadores vinculados.`}
        confirmButtonLabel="Confirmar limpieza"
        dangerLevel="destructive"
        isProcessing={isCleaning}
        onCancel={() => setPendingCategoryClear(null)}
        onConfirm={async () => {
          if (!pendingCategoryClear || !onClearCategory) return;
          setIsCleaning(true);
          try {
            await onClearCategory(pendingCategoryClear.category);
            setFeedback({
              type: 'ok',
              message: `Se limpió la categoría "${pendingCategoryClear.label}" en "${activeProfileLabel}".`,
            });
            setPendingCategoryClear(null);
          } finally {
            setIsCleaning(false);
          }
        }}
      />

      <DataCleanupConfirmModal
        isOpen={pendingDangerAction === 'profile_history'}
        title={`¿Vaciar historial de "${activeProfileLabel}"?`}
        description="Se eliminarán todas las sesiones de entrenamiento, cardio, pesajes, lecturas PPG/presión, comidas, hidratación, sueño, medidas y fotos de este perfil."
        details={[
          'Se conservarán tu perfil físico, metas, unidades, equipo disponible, comidas favoritas y plantillas.',
          'La fatiga muscular se restablecerá a 0% y los kilómetros acumulados de calzado volverán a 0.',
        ]}
        confirmButtonLabel="Vaciar historial del perfil"
        dangerLevel="destructive"
        isProcessing={isCleaning}
        onCancel={() => setPendingDangerAction(null)}
        onConfirm={async () => {
          if (!onClearProfileHistory) return;
          setIsCleaning(true);
          try {
            await onClearProfileHistory();
            setFeedback({
              type: 'ok',
              message: `Historial de "${activeProfileLabel}" vaciado correctamente.`,
            });
            setPendingDangerAction(null);
          } finally {
            setIsCleaning(false);
          }
        }}
      />

      <DataCleanupConfirmModal
        isOpen={pendingDangerAction === 'factory_reset'}
        title="¿Reinicio total de fábrica?"
        description="Esta acción borrará permanentemente todas las bases IndexedDB (PulsoFitDB, pulsofit_db, pulsofit_photos_db), perfiles familiares y preferencias locales."
        details={[
          'No se puede deshacer si no exportaste un respaldo .json.',
          'La aplicación quedará limpia en un perfil Principal vacío.',
        ]}
        confirmButtonLabel="Reiniciar de fábrica"
        dangerLevel="factory"
        requireKeyword="BORRAR"
        isProcessing={isCleaning}
        onCancel={() => setPendingDangerAction(null)}
        onConfirm={async () => {
          if (!onFactoryReset) return;
          setIsCleaning(true);
          try {
            await onFactoryReset();
            setFeedback({
              type: 'ok',
              message: 'Reinicio de fábrica completado. Almacenamiento limpio.',
            });
            setPendingDangerAction(null);
          } finally {
            setIsCleaning(false);
          }
        }}
      />
    </div>
  );
};
