import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BatteryLow,
  Check,
  Database,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Ruler,
  Sparkles,
  Trash2,
  Upload,
  User,
  Volume2,
} from 'lucide-react';
import { EQUIPMENT_OPTIONS } from '../data/exercises';
import { calculateNutritionTargets } from '../data/foods';
import {
  ALL_MUSCLES,
  MUSCLE_LABELS,
  getDecayedFatigueMap,
  getRecoveryStatus,
} from '../lib/recovery';
import { computeHydrationGoal } from '../lib/hydration';
import {
  type BackupPreviewCounts,
  type CleanupCategoryId,
  type RecordDeleteTarget,
  exportDatabaseToCsv,
  exportDatabaseToJson,
  getBackupAgeInfo,
  getTodayIsoDate,
  parseAndValidateBackupJson,
  summarizeBackupCounts,
} from '../lib/storage';
import {
  getAvailableMexicanVoices,
  speakVoiceTest,
} from '../lib/voiceCoach';
import {
  displayWeightToKg,
  getDistanceUnit,
  getLiquidUnit,
  getWaistUnit,
  getWeightUnit,
  kgToDisplayWeight,
} from '../lib/units';
import { useLowPowerMode } from '../lib/lowPowerMode';
import type {
  AppDatabase,
  BloodPressureRecord,
  DistanceUnit,
  EquipmentType,
  Goal,
  HydrationSettings,
  LengthUnit,
  LiquidUnit,
  LowPowerPreference,
  PulseHrvRecord,
  Sex,
  SleepSession,
  UserProfile,
  WeightUnit,
} from '../types/fitness';
import { BackupPreviewModal } from './BackupPreviewModal';
import { DatabaseHistoryTab } from './DatabaseHistoryTab';
import { PWAInstallButton } from './PWAInstallButton';
import { PushNotificationsCard } from './PushNotificationsCard';

interface PerfilTabProps {
  database: AppDatabase;
  activeProfileLabel?: string;
  onUpdateProfile: (profile: UserProfile) => void;
  onResetMuscleFatigue: () => void;
  onImportDatabase: (nextDb: AppDatabase) => void;
  openDatosSignal?: number;
  openSleepSignal?: number;
  openPulseSignal?: number;
  onDeleteWorkout?: (workoutId: string) => void;
  onDeleteHiitSession?: (hiitId: string) => void;
  onDeleteCardioSession?: (sessionId: string) => void;
  onDeleteBodyScan?: (scanId: string) => void;
  onDeleteBodyWeight?: (weightId: string) => void;
  onDeleteFood?: (foodId: string) => void;
  onDeleteWaterLog?: (date: string, target: RecordDeleteTarget | string) => void;
  onSaveSleepSession?: (session: SleepSession) => void;
  onDeleteSleepSession?: (sleepId: string) => void;
  onSavePulseRecord?: (record: PulseHrvRecord) => void;
  onDeletePulseRecord?: (pulseId: string) => void;
  onSaveBloodPressureRecord?: (record: BloodPressureRecord) => void;
  onDeleteBloodPressureRecord?: (bpId: string) => void;
  onOpenScale?: () => void;
  onClearCategory?: (category: CleanupCategoryId) => Promise<void> | void;
  onClearProfileHistory?: () => Promise<void> | void;
  onFactoryReset?: () => Promise<void> | void;
  onUpdateHydrationSettings?: (next: HydrationSettings) => void;
  isHydrated?: boolean;
  openPushSettingsSignal?: number;
}

const GOAL_OPTIONS: { id: Goal; label: string; desc: string }[] = [
  { id: 'perder_grasa', label: 'Perder grasa', desc: 'Déficit moderado y alta densidad' },
  { id: 'mantener_peso', label: 'Mantener peso', desc: 'Equilibrio y recomposición' },
  { id: 'ganar_musculo', label: 'Ganar músculo', desc: 'Superávit ligero e hipertrofia' },
];

const SEX_OPTIONS: { id: Sex; label: string }[] = [
  { id: 'hombre', label: 'Hombre' },
  { id: 'mujer', label: 'Mujer' },
  { id: 'otro', label: 'Otro' },
];

export const PerfilTab: React.FC<PerfilTabProps> = ({
  database,
  activeProfileLabel = 'Principal',
  onUpdateProfile,
  onResetMuscleFatigue,
  onImportDatabase,
  openDatosSignal = 0,
  openSleepSignal = 0,
  openPulseSignal = 0,
  onDeleteWorkout = () => {},
  onDeleteHiitSession = () => {},
  onDeleteCardioSession = () => {},
  onDeleteBodyScan = () => {},
  onDeleteBodyWeight = () => {},
  onDeleteFood = () => {},
  onDeleteWaterLog,
  onSaveSleepSession = () => {},
  onDeleteSleepSession = () => {},
  onSavePulseRecord = () => {},
  onDeletePulseRecord = () => {},
  onSaveBloodPressureRecord = () => {},
  onDeleteBloodPressureRecord = () => {},
  onOpenScale = () => {},
  onClearCategory,
  onClearProfileHistory,
  onFactoryReset,
  onUpdateHydrationSettings,
  isHydrated = true,
  openPushSettingsSignal = 0,
}) => {
  const { profile, muscleFatigue } = database;
  const [perfilSubTab, setPerfilSubTab] = useState<'perfil' | 'datos'>(
    openDatosSignal > 0 || openSleepSignal > 0 || openPulseSignal > 0
      ? 'datos'
      : 'perfil',
  );

  useEffect(() => {
    if (openDatosSignal > 0 || openSleepSignal > 0 || openPulseSignal > 0) {
      setPerfilSubTab('datos');
    }
  }, [openDatosSignal, openSleepSignal, openPulseSignal]);

  useEffect(() => {
    if (openPushSettingsSignal > 0) {
      setPerfilSubTab('perfil');
    }
  }, [openPushSettingsSignal]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<{
    type: 'ok' | 'error';
    message: string;
  } | null>(null);
  const [backupAge, setBackupAge] = useState(() => getBackupAgeInfo());
  const [confirmResetFatigue, setConfirmResetFatigue] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<{
    db: AppDatabase;
    counts: BackupPreviewCounts;
    fileName: string;
  } | null>(null);

  useEffect(() => {
    setBackupAge(getBackupAgeInfo());
  }, [perfilSubTab]);

  // Voces disponibles en español (es-MX / LatAm, bloqueando es-ES)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>(() =>
    getAvailableMexicanVoices(),
  );
  const [voiceTestStatus, setVoiceTestStatus] = useState<string | null>(null);

  useEffect(() => {
    const refreshVoices = () => {
      setAvailableVoices(getAvailableMexicanVoices());
    };
    refreshVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
      return () => {
        window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
      };
    }
    return undefined;
  }, []);

  const decayedFatigue = useMemo(() => getDecayedFatigueMap(muscleFatigue), [muscleFatigue]);
  const targets = useMemo(() => calculateNutritionTargets(profile), [profile]);

  const weightUnit = getWeightUnit(profile.weightUnit);
  const distanceUnit = getDistanceUnit(profile.distanceUnit);
  const liquidUnit = getLiquidUnit(profile.liquidUnit);
  const waistUnit = getWaistUnit(profile);
  const todayIso = getTodayIsoDate();
  const effectiveHydrationSettings: HydrationSettings = useMemo(
    () =>
      database.hydrationSettings ?? {
        mlPerKg: 35,
        containerMl: 500,
        wakeHour: 7,
        sleepHour: 22,
        hotDayByDate: {},
        remindersEnabled: false,
      },
    [database.hydrationSettings],
  );
  const todayHydrationGoal = useMemo(
    () =>
      computeHydrationGoal(
        profile,
        database.bodyWeights,
        database.bodyScans,
        database.workouts,
        effectiveHydrationSettings,
        todayIso,
        database.cardioSessions ?? [],
        database.hiitSessions ?? [],
      ),
    [
      profile,
      database.bodyWeights,
      database.bodyScans,
      database.workouts,
      effectiveHydrationSettings,
      todayIso,
      database.cardioSessions,
      database.hiitSessions,
    ],
  );
  const todayWaterMl = database.hydrationByDate?.[todayIso] ?? 0;
  const lowPower = useLowPowerMode();
  const currentLowPowerPref: LowPowerPreference =
    profile.lowPowerMode === 'on' || profile.lowPowerMode === 'off'
      ? profile.lowPowerMode
      : 'auto';

  // Buffered string state for numeric fields (commits only onBlur or explicit save)
  const [weightText, setWeightText] = useState(() =>
    String(kgToDisplayWeight(profile.weightKg, weightUnit)),
  );
  const [targetWeightText, setTargetWeightText] = useState(() =>
    String(kgToDisplayWeight(profile.targetWeightKg, weightUnit)),
  );
  const [heightText, setHeightText] = useState(() => String(profile.heightCm));
  const [ageText, setAgeText] = useState(() => String(profile.age));
  const [profileSavedMsg, setProfileSavedMsg] = useState(false);

  useEffect(() => {
    setWeightText(String(kgToDisplayWeight(profile.weightKg, weightUnit)));
  }, [profile.weightKg, weightUnit]);

  useEffect(() => {
    setTargetWeightText(String(kgToDisplayWeight(profile.targetWeightKg, weightUnit)));
  }, [profile.targetWeightKg, weightUnit]);

  useEffect(() => {
    setHeightText(String(profile.heightCm));
  }, [profile.heightCm]);

  useEffect(() => {
    setAgeText(String(profile.age));
  }, [profile.age]);

  const avgFatigue = Math.round(
    ALL_MUSCLES.reduce((sum, m) => sum + (decayedFatigue[m] ?? 0), 0) / ALL_MUSCLES.length,
  );

  const updateField = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => {
    onUpdateProfile({
      ...profile,
      [key]: value,
    });
  };

  const commitWeightField = (
    raw: string,
    field: 'weightKg' | 'targetWeightKg',
    setter: (v: string) => void,
  ) => {
    const normalized = raw.replace(',', '.').trim();
    const parsed = parseFloat(normalized);
    if (Number.isNaN(parsed)) {
      setter(String(kgToDisplayWeight(profile[field], weightUnit)));
      return;
    }
    const kgVal = displayWeightToKg(parsed, weightUnit);
    const clampedKg = Math.round(Math.max(30, Math.min(250, kgVal)) * 10) / 10;
    setter(String(kgToDisplayWeight(clampedKg, weightUnit)));
    if (clampedKg !== profile[field]) {
      updateField(field, clampedKg);
    }
  };

  const commitIntegerField = (
    raw: string,
    field: 'heightCm' | 'age',
    min: number,
    max: number,
    setter: (v: string) => void,
  ) => {
    const parsed = parseInt(raw.trim(), 10);
    if (Number.isNaN(parsed)) {
      setter(String(profile[field]));
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    setter(String(clamped));
    if (clamped !== profile[field]) {
      updateField(field, clamped);
    }
  };

  const handleCommitAllProfileNumbers = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const parsedW = parseFloat(weightText.replace(',', '.').trim());
    const parsedTW = parseFloat(targetWeightText.replace(',', '.').trim());
    const parsedH = parseInt(heightText.trim(), 10);
    const parsedA = parseInt(ageText.trim(), 10);

    const nextWeightKg = Number.isNaN(parsedW)
      ? profile.weightKg
      : Math.round(Math.max(30, Math.min(250, displayWeightToKg(parsedW, weightUnit))) * 10) / 10;
    const nextTargetKg = Number.isNaN(parsedTW)
      ? profile.targetWeightKg
      : Math.round(Math.max(30, Math.min(250, displayWeightToKg(parsedTW, weightUnit))) * 10) / 10;
    const nextHeight = Number.isNaN(parsedH)
      ? profile.heightCm
      : Math.max(120, Math.min(230, parsedH));
    const nextAge = Number.isNaN(parsedA)
      ? profile.age
      : Math.max(14, Math.min(95, parsedA));

    setWeightText(String(kgToDisplayWeight(nextWeightKg, weightUnit)));
    setTargetWeightText(String(kgToDisplayWeight(nextTargetKg, weightUnit)));
    setHeightText(String(nextHeight));
    setAgeText(String(nextAge));

    onUpdateProfile({
      ...profile,
      weightKg: nextWeightKg,
      targetWeightKg: nextTargetKg,
      heightCm: nextHeight,
      age: nextAge,
    });
    setProfileSavedMsg(true);
    window.setTimeout(() => setProfileSavedMsg(false), 2200);
  };

  const toggleEquipment = (eqId: EquipmentType) => {
    const exists = profile.equipment.includes(eqId);
    if (exists && profile.equipment.length === 1) {
      // Keep at least one selected
      return;
    }
    const next = exists
      ? profile.equipment.filter((e) => e !== eqId)
      : [...profile.equipment, eqId];
    updateField('equipment', next);
  };

  const handleExportJson = () => {
    exportDatabaseToJson(database, activeProfileLabel);
    setBackupAge(getBackupAgeInfo());
    setBackupFeedback({
      type: 'ok',
      message: `Respaldo JSON descargado para "${activeProfileLabel}".`,
    });
  };

  const handleExportCsv = () => {
    exportDatabaseToCsv(database, activeProfileLabel);
    setBackupFeedback({
      type: 'ok',
      message: `Historial CSV exportado para "${activeProfileLabel}" (compatible con Excel).`,
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      setBackupFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo leer el archivo JSON de respaldo.',
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
    setBackupFeedback({
      type: 'ok',
      message: `Respaldo restaurado: ${counts.workouts} rutinas, ${counts.cardioSessions} cardio, ${counts.bodyScans} báscula y ${counts.foodLogs} comidas.`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">
            {perfilSubTab === 'perfil' ? 'Perfil y recuperación' : 'Datos, Sueño y Signos'}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {perfilSubTab === 'perfil'
              ? 'Tus datos calculan tus calorías, adaptan tus rutinas y miden la fatiga muscular.'
              : 'Administra respaldos JSON/CSV, monitor de sueño, pulso PPG y comparación de fechas.'}
          </p>
        </div>

        {/* Sub-tabs inside Perfil: Mi Perfil | Datos y Respaldos */}
        <div
          role="tablist"
          aria-label="Secciones de Perfil"
          className="grid grid-cols-2 gap-1.5 rounded-2xl border border-[#222631] bg-[#12141A] p-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={perfilSubTab === 'perfil'}
            onClick={() => setPerfilSubTab('perfil')}
            className={`min-h-[44px] rounded-xl px-4 text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 transition-colors ${
              perfilSubTab === 'perfil'
                ? 'bg-[#D4FF33] text-[#0A0B0D]'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <User className="w-4 h-4 shrink-0" />
            Mi Perfil
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={perfilSubTab === 'datos'}
            onClick={() => setPerfilSubTab('datos')}
            className={`min-h-[44px] rounded-xl px-4 text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 transition-colors ${
              perfilSubTab === 'datos'
                ? 'bg-[#D4FF33] text-[#0A0B0D]'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            <Database className="w-4 h-4 shrink-0" />
            Datos y Respaldos
          </button>
        </div>
      </div>

      {perfilSubTab === 'datos' ? (
        <DatabaseHistoryTab
          database={database}
          activeProfileLabel={activeProfileLabel}
          onDeleteWorkout={onDeleteWorkout}
          onDeleteHiitSession={onDeleteHiitSession}
          onDeleteCardioSession={onDeleteCardioSession}
          onDeleteBodyScan={onDeleteBodyScan}
          onDeleteBodyWeight={onDeleteBodyWeight}
          onDeleteFood={onDeleteFood}
          onDeleteWaterLog={onDeleteWaterLog}
          openSleepSignal={openSleepSignal}
          onSaveSleepSession={onSaveSleepSession}
          onDeleteSleepSession={onDeleteSleepSession}
          openPulseSignal={openPulseSignal}
          onSavePulseRecord={onSavePulseRecord}
          onDeletePulseRecord={onDeletePulseRecord}
          onSaveBloodPressureRecord={onSaveBloodPressureRecord}
          onDeleteBloodPressureRecord={onDeleteBloodPressureRecord}
          onImportDatabase={onImportDatabase}
          onOpenScale={onOpenScale}
          onClearCategory={onClearCategory}
          onClearProfileHistory={onClearProfileHistory}
          onFactoryReset={onFactoryReset}
        />
      ) : (
        <>
      {/* 3. PANEL DE RECUPERACIÓN MUSCULAR (Prominent at top or dedicated section) */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-[#D4FF33]" />
              <h2 className="text-2xl font-bold font-display text-white">
                Panel de recuperación muscular
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Fatiga de 0% a 100% · Se actualiza al terminar cada rutina y se recupera gradualmente con el descanso
            </p>
          </div>
          <div className="text-right">
            <span className="text-xs text-zinc-400 block">Fatiga promedio</span>
            <span className="text-2xl font-extrabold font-mono tabular-nums text-[#D4FF33]">
              {avgFatigue}%
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
          {ALL_MUSCLES.map((muscle) => {
            const fatigue = decayedFatigue[muscle] ?? 0;
            const status = getRecoveryStatus(fatigue);
            return (
              <div
                key={muscle}
                className="rounded-2xl border border-[#1E222C] bg-[#0E1014] p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-white">
                    {MUSCLE_LABELS[muscle]}
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`font-semibold ${status.textClass}`}>
                      {status.label}
                    </span>
                    <span className="font-mono tabular-nums font-bold text-white">
                      {fatigue}%
                    </span>
                  </div>
                </div>
                <div className="h-2.5 w-full rounded-full bg-[#1C2029] overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${status.barClass}`}
                    style={{ width: `${fatigue}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-1 flex justify-end">
          {!confirmResetFatigue ? (
            <button
              type="button"
              onClick={() => setConfirmResetFatigue(true)}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-[#2A2F3D] bg-[#171A23] px-4 text-xs font-semibold text-zinc-300 hover:text-white"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Marcar descanso completo (0%)
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmResetFatigue(false)}
                className="min-h-[44px] rounded-xl bg-[#1E222B] px-3.5 text-xs font-semibold text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  onResetMuscleFatigue();
                  setConfirmResetFatigue(false);
                }}
                className="min-h-[44px] rounded-xl bg-[#D4FF33] px-4 text-xs font-bold text-[#0A0B0D]"
              >
                Confirmar 0% fatiga
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 1. DATOS CORPORALES Y META PRINCIPAL */}
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-5">
          <div>
            <h2 className="text-2xl font-bold font-display text-white">
              Datos corporales y meta
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              TMB {targets.bmr} kcal · Meta diaria estimada {targets.calories} kcal ({targets.proteinG}g proteína)
            </p>
          </div>

          <form onSubmit={handleCommitAllProfileNumbers} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Peso actual ({weightUnit})
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={weightText}
                  onChange={(e) => setWeightText(e.target.value)}
                  onBlur={() =>
                    commitWeightField(weightText, 'weightKg', setWeightText)
                  }
                  className="w-full min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-base font-mono font-bold tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Peso objetivo ({weightUnit})
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={targetWeightText}
                  onChange={(e) => setTargetWeightText(e.target.value)}
                  onBlur={() =>
                    commitWeightField(
                      targetWeightText,
                      'targetWeightKg',
                      setTargetWeightText,
                    )
                  }
                  className="w-full min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-base font-mono font-bold tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Altura (cm)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={heightText}
                  onChange={(e) => setHeightText(e.target.value)}
                  onBlur={() =>
                    commitIntegerField(heightText, 'heightCm', 120, 230, setHeightText)
                  }
                  className="w-full min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-base font-mono font-bold tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Edad (años)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={ageText}
                  onChange={(e) => setAgeText(e.target.value)}
                  onBlur={() => commitIntegerField(ageText, 'age', 14, 95, setAgeText)}
                  className="w-full min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-base font-mono font-bold tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              {profileSavedMsg ? (
                <span className="text-xs font-semibold text-[#D4FF33]">
                  Medidas actualizadas correctamente.
                </span>
              ) : (
                <span className="text-[11px] text-zinc-500">
                  Se guarda automáticamente al salir del campo o pulsar Guardar.
                </span>
              )}
              <button
                type="submit"
                className="min-h-[40px] rounded-xl border border-[#2B303C] bg-[#181C24] hover:border-[#D4FF33]/50 px-3.5 text-xs font-bold text-[#D4FF33] shrink-0"
              >
                Guardar medidas
              </button>
            </div>
          </form>

          {/* Sexo */}
          <div>
            <span className="block text-xs font-semibold text-zinc-300 mb-2">Sexo</span>
            <div className="grid grid-cols-3 gap-2">
              {SEX_OPTIONS.map((opt) => {
                const active = profile.sex === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateField('sex', opt.id)}
                    className={`min-h-[48px] rounded-2xl text-sm font-bold transition-colors ${
                      active
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'border border-[#2A2F3D] bg-[#0E1014] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Meta Principal */}
          <div>
            <span className="block text-xs font-semibold text-zinc-300 mb-2">
              Meta principal
            </span>
            <div className="space-y-2">
              {GOAL_OPTIONS.map((opt) => {
                const active = profile.goal === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateField('goal', opt.id)}
                    className={`w-full min-h-[56px] rounded-2xl px-4 py-3 text-left flex items-center justify-between gap-3 border transition-colors ${
                      active
                        ? 'border-[#D4FF33] bg-[#D4FF33]/12 text-white'
                        : 'border-[#252A36] bg-[#0E1014] text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-bold">{opt.label}</p>
                      <p className="text-xs text-zinc-400">{opt.desc}</p>
                    </div>
                    {active && <Check className="w-5 h-5 text-[#D4FF33] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 2. EQUIPO DISPONIBLE Y DÍAS POR SEMANA */}
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-5">
          <div>
            <h2 className="text-2xl font-bold font-display text-white">
              Equipo y frecuencia semanal
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Selecciona todo el equipo al que tienes acceso para adaptar tus rutinas.
            </p>
          </div>

          <div className="space-y-2.5">
            {EQUIPMENT_OPTIONS.map((eq) => {
              const selected = profile.equipment.includes(eq.id);
              return (
                <button
                  key={eq.id}
                  type="button"
                  onClick={() => toggleEquipment(eq.id)}
                  className={`w-full min-h-[58px] rounded-2xl px-4 py-3 text-left flex items-center justify-between gap-3 border transition-colors active:scale-[0.99] ${
                    selected
                      ? 'border-[#D4FF33] bg-[#D4FF33]/12 text-white'
                      : 'border-[#252A36] bg-[#0E1014] text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <div>
                    <p className="text-sm font-bold">{eq.label}</p>
                    <p className="text-xs text-zinc-400">{eq.subtitle}</p>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                      selected ? 'bg-[#D4FF33] text-[#0A0B0D]' : 'border border-zinc-600'
                    }`}
                  >
                    {selected && <Check className="w-4 h-4 stroke-[3]" />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Días de entrenamiento por semana */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-300">
                Días de entrenamiento por semana
              </span>
              <span className="text-sm font-mono font-bold text-[#D4FF33]">
                {profile.trainingDaysPerWeek} días
              </span>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {[2, 3, 4, 5, 6, 7].map((days) => {
                const active = profile.trainingDaysPerWeek === days;
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => updateField('trainingDaysPerWeek', days)}
                    className={`min-h-[48px] rounded-2xl text-base font-mono font-extrabold transition-colors ${
                      active
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'border border-[#2A2F3D] bg-[#0E1014] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {days}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* SISTEMA GRANULAR DE UNIDADES (KG/LB, KM/MI, ML/OZ) */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Ruler className="w-5 h-5 text-[#D4FF33]" />
              <h2 className="text-2xl font-bold font-display text-white">
                Unidades de medida
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Personaliza de forma independiente peso, distancia y líquidos. Tu historial interno se conserva en métrico para no alterar tus gráficas.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Peso: kg / lb */}
          <div className="rounded-2xl border border-[#222631] bg-[#0E1014] p-3.5 space-y-2">
            <span className="block text-xs font-semibold text-zinc-300">
              Peso (fuerza y báscula)
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(['kg', 'lb'] as WeightUnit[]).map((u) => {
                const active = weightUnit === u;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => updateField('weightUnit', u)}
                    className={`min-h-[44px] rounded-xl text-sm font-extrabold uppercase transition-colors ${
                      active
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'border border-[#2A2F3D] bg-[#161922] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {u === 'kg' ? 'Kilogramos (kg)' : 'Libras (lb)'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Distancia: km / mi */}
          <div className="rounded-2xl border border-[#222631] bg-[#0E1014] p-3.5 space-y-2">
            <span className="block text-xs font-semibold text-zinc-300">
              Distancia y ritmo (GPS)
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(['km', 'mi'] as DistanceUnit[]).map((u) => {
                const active = distanceUnit === u;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => updateField('distanceUnit', u)}
                    className={`min-h-[44px] rounded-xl text-sm font-extrabold uppercase transition-colors ${
                      active
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'border border-[#2A2F3D] bg-[#161922] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {u === 'km' ? 'Kilómetros (km)' : 'Millas (mi)'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Líquidos: ml / oz */}
          <div className="rounded-2xl border border-[#222631] bg-[#0E1014] p-3.5 space-y-2">
            <span className="block text-xs font-semibold text-zinc-300">
              Líquidos (hidratación)
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(['ml', 'oz'] as LiquidUnit[]).map((u) => {
                const active = liquidUnit === u;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => updateField('liquidUnit', u)}
                    className={`min-h-[44px] rounded-xl text-sm font-extrabold uppercase transition-colors ${
                      active
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'border border-[#2A2F3D] bg-[#161922] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {u === 'ml' ? 'Mililitros (ml)' : 'Onzas (oz)'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cintura: cm / in */}
          <div className="rounded-2xl border border-[#222631] bg-[#0E1014] p-3.5 space-y-2">
            <span className="block text-xs font-semibold text-zinc-300">
              Cintura (báscula OKOK)
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(['cm', 'in'] as LengthUnit[]).map((u) => {
                const active = waistUnit === u;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => updateField('waistUnit', u)}
                    className={`min-h-[44px] rounded-xl text-sm font-extrabold uppercase transition-colors ${
                      active
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'border border-[#2A2F3D] bg-[#161922] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {u === 'cm' ? 'Centímetros (cm)' : 'Pulgadas (in)'}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* MODO BAJO CONSUMO INTELIGENTE */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <BatteryLow className="w-5 h-5 text-amber-300" />
              <h2 className="text-2xl font-bold font-display text-white">
                Modo Bajo Consumo
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Reduce el refresco visual a ~15 fps, pausa animaciones decorativas, espacia el GPS de caminatas a 5 s y agrupa escrituras en IndexedDB cada 30 s.
            </p>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-extrabold ${
              lowPower.isLowPower
                ? 'border-amber-400/45 bg-amber-500/15 text-amber-300'
                : 'border-[#282D3B] bg-[#0E1014] text-zinc-400'
            }`}
          >
            <BatteryLow className="w-3.5 h-3.5" />
            {lowPower.isLowPower ? 'Activo' : 'Normal'}
          </span>
        </div>

        <div
          role="radiogroup"
          aria-label="Modo Bajo Consumo"
          className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
        >
          {(
            [
              {
                id: 'auto' as LowPowerPreference,
                title: 'Automático (<20%)',
                desc: 'Se activa solo si la batería baja de 20% y no está cargando.',
              },
              {
                id: 'on' as LowPowerPreference,
                title: 'Siempre activo',
                desc: 'Máximo ahorro continuo en entrenamientos largos y GPS.',
              },
              {
                id: 'off' as LowPowerPreference,
                title: 'Desactivado',
                desc: 'Rendimiento completo a 60 fps y guardado en tiempo real.',
              },
            ] as const
          ).map((opt) => {
            const active = currentLowPowerPref === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => updateField('lowPowerMode', opt.id)}
                className={`rounded-2xl border p-3.5 text-left transition-colors ${
                  active
                    ? opt.id === 'on' || (opt.id === 'auto' && lowPower.isLowPower)
                      ? 'border-amber-400/70 bg-amber-500/12'
                      : 'border-[#D4FF33] bg-[#D4FF33]/10'
                    : 'border-[#252A38] bg-[#0E1014] hover:border-zinc-600'
                }`}
              >
                <p
                  className={`text-sm font-extrabold ${
                    active
                      ? opt.id === 'on' || (opt.id === 'auto' && lowPower.isLowPower)
                        ? 'text-amber-300'
                        : 'text-[#D4FF33]'
                      : 'text-white'
                  }`}
                >
                  {opt.title}
                </p>
                <p className="text-[11px] text-zinc-400 mt-1 leading-snug">
                  {opt.desc}
                </p>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] font-mono text-zinc-400">
          {lowPower.battery.supported && lowPower.battery.level !== null
            ? `Batería detectada: ${Math.round(lowPower.battery.level * 100)}% · ${
                lowPower.battery.charging ? 'Cargando' : 'En uso de batería'
              }`
            : 'Detección nativa de batería no disponible en este navegador; usa el interruptor manual cuando lo necesites.'}
        </p>
      </section>

      {/* VOZ DEL COACH (100% ESPAÑOL DE MÉXICO) */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Volume2 className="w-5 h-5 text-[#D4FF33]" />
              <h2 className="text-2xl font-bold font-display text-white">
                Voz del Coach (México)
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Forzado a español de México (<span className="font-mono text-zinc-300">es-MX</span>) con respaldo Latinoamérica. Todas las voces de España (<span className="font-mono text-zinc-300">es-ES</span>) están bloqueadas y la música baja al 20% mientras habla.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="coach-voice-select"
              className="block text-xs font-semibold text-zinc-300 mb-1.5"
            >
              Voz en español disponible en tu dispositivo
            </label>
            <select
              id="coach-voice-select"
              value={profile.preferredVoiceUri ?? ''}
              onChange={(e) =>
                updateField('preferredVoiceUri', e.target.value || undefined)
              }
              className="w-full min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-sm font-semibold text-white focus:border-[#D4FF33] focus:outline-none"
            >
              <option value="">
                Automática (priorizar es-MX / Latinoamérica)
              </option>
              {availableVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              const ok = speakVoiceTest(profile.preferredVoiceUri);
              setVoiceTestStatus(
                ok
                  ? 'Reproduciendo prueba en español de México...'
                  : 'Tu navegador no soporta síntesis de voz en este entorno.',
              );
              window.setTimeout(() => setVoiceTestStatus(null), 3500);
            }}
            className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] px-5 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform shrink-0"
          >
            <Volume2 className="w-4 h-4" />
            Probar voz
          </button>
        </div>

        <p className="text-[11px] text-zinc-400">
          {availableVoices.length > 0
            ? `${availableVoices.length} ${
                availableVoices.length === 1 ? 'voz compatible detectada' : 'voces compatibles detectadas'
              } (es-MX / LatAm).`
            : 'Se usará el motor es-MX predeterminado del sistema operativo (voces es-ES filtradas).'}
        </p>

        {voiceTestStatus && (
          <p role="status" className="text-xs font-semibold text-[#D4FF33]">
            {voiceTestStatus}
          </p>
        )}
      </section>

      {/* RECORDATORIOS INTELIGENTES Y PUSH */}
      <PushNotificationsCard
        isHydrated={isHydrated}
        workouts={database.workouts}
        cardioSessions={database.cardioSessions ?? []}
        hiitSessions={database.hiitSessions ?? []}
        highlightSignal={openPushSettingsSignal}
        todayTargetMl={todayHydrationGoal.totalTargetMl}
        todayConsumedMl={todayWaterMl}
        liquidUnit={liquidUnit}
        hydrationSettings={effectiveHydrationSettings}
        onUpdateHydrationSettings={onUpdateHydrationSettings}
      />

      {/* RESPALDO JSON / CSV & INSTALACIÓN PWA */}
      <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
        <div>
          <h2 className="text-2xl font-bold font-display text-white">
            Respaldo local y aplicación instalada
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Todos tus datos viven en IndexedDB en este teléfono (perfil activo: <span className="text-white font-semibold">{activeProfileLabel}</span>). Exporta JSON o CSV en 1 toque.
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
            <Check className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
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
                Han pasado más de 7 días sin respaldar. Exporta un archivo .json para proteger tus datos.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={handleExportJson}
            className="min-h-[52px] flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] px-4 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
          >
            <Download className="w-5 h-5" />
            Exportar .json
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="min-h-[52px] flex items-center justify-center gap-2 rounded-2xl border border-[#D4FF33]/40 bg-[#181B23] px-4 text-sm font-bold text-[#D4FF33] hover:bg-[#20242F] active:scale-[0.98] transition-transform"
          >
            <FileSpreadsheet className="w-5 h-5" />
            Exportar .csv
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[52px] flex items-center justify-center gap-2 rounded-2xl border border-[#2E3442] bg-[#181B23] px-4 text-sm font-bold text-white hover:bg-[#20242F] active:scale-[0.98] transition-transform"
          >
            <Upload className="w-5 h-5 text-[#D4FF33]" />
            Importar .json
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {backupFeedback && (
          <p
            role="status"
            className={`text-sm font-semibold ${
              backupFeedback.type === 'ok' ? 'text-[#D4FF33]' : 'text-rose-400'
            }`}
          >
            {backupFeedback.message}
          </p>
        )}

        <PWAInstallButton variant="card" />
      </section>

      <BackupPreviewModal
        isOpen={pendingBackup !== null}
        fileName={pendingBackup?.fileName ?? ''}
        targetProfileLabel={activeProfileLabel}
        counts={pendingBackup?.counts ?? null}
        onCancel={() => setPendingBackup(null)}
        onConfirm={handleConfirmPendingImport}
      />
        </>
      )}
    </div>
  );
};
