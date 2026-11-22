import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Bluetooth,
  BookmarkPlus,
  Check,
  Clock,
  Dumbbell,
  Flame,
  Heart,
  Info,
  Link2,
  Link2Off,
  Minus,
  Plus,
  RotateCcw,
  SkipForward,
  Timer,
  TrendingUp,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  computeProgressiveOverloadHint,
  getPreviousExerciseSets,
} from '../../lib/analytics';
import {
  computeHeartRateZone,
  isBluetoothHeartRateSupported,
} from '../../lib/bluetoothHeartRate';
import { MUSCLE_LABELS } from '../../lib/recovery';
import {
  RESISTANCE_BAND_PRESETS,
  describeBandSelection,
  displayWeightToKg,
  formatVolume,
  formatWeight,
  kgToDisplayWeight,
} from '../../lib/units';
import { cancelCoachSpeech, speakCoachCue } from '../../lib/voiceCoach';
import type {
  ActiveWorkout,
  LoadMode,
  MuscleGroup,
  SetType,
  UserProfile,
  WeightUnit,
  WorkoutExercise,
  WorkoutSession,
} from '../../types/fitness';
import type { InspectedExerciseInfo } from '../ExerciseDemoModal';
import { InlineDeleteConfirmButton } from '../InlineDeleteConfirmButton';
import { formatSeconds } from './RestTimerBar';

const RPE_PRIMARY_OPTIONS: {
  value: number;
  shortLabel: string;
  detailLabel: string;
}[] = [
  { value: 6, shortLabel: 'Ligero', detailLabel: 'Muy manejable · 4+ RIR' },
  { value: 7, shortLabel: 'Moderado', detailLabel: 'Controlado · 3 RIR' },
  { value: 8, shortLabel: '2 RIR', detailLabel: 'Firme · 2 reps en reserva' },
  { value: 9, shortLabel: '1 RIR', detailLabel: 'Muy duro · casi al fallo' },
  { value: 10, shortLabel: 'Fallo', detailLabel: 'Esfuerzo máximo' },
];

const RPE_LOW_OPTIONS: { value: number; shortLabel: string }[] = [
  { value: 1, shortLabel: 'Muy suave' },
  { value: 2, shortLabel: 'Suave' },
  { value: 3, shortLabel: 'Cómodo' },
  { value: 4, shortLabel: 'Fácil' },
  { value: 5, shortLabel: 'Ligero' },
];

function getRpeShortLabel(rpe: number): string {
  const rounded = Math.round(rpe);
  const primary = RPE_PRIMARY_OPTIONS.find((o) => o.value === rounded);
  if (primary) return primary.shortLabel;
  const low = RPE_LOW_OPTIONS.find((o) => o.value === rounded);
  if (low) return low.shortLabel;
  return 'Moderado';
}

export interface ActiveWorkoutSessionProps {
  activeWorkout: ActiveWorkout;
  profile: UserProfile;
  workouts: WorkoutSession[];
  weightUnit: WeightUnit;
  elapsedSec: number;
  wakeLockActive: boolean;
  hrBpm: number | null;
  hrDeviceName: string | null;
  hrError: string | null;
  isConnectingHr: boolean;
  onToggleHeartRate: () => void;
  voiceCoachEnabled: boolean;
  speechAvailable: boolean;
  isAudioMuted: boolean;
  setIsAudioMuted: React.Dispatch<React.SetStateAction<boolean>>;
  lastSpokenCue: string | null;
  activeExerciseIdx: number;
  rpeTrackingEnabled: boolean;
  autoStartRest: boolean;
  preferredRestSec: number;
  restRemaining: number | null;
  restTotal: number;
  recoveryIndex: {
    score: number;
    bpm?: number | null;
    hrvMs?: number | null;
    stressLabel: string;
  };
  sleepPulseAlert: { elevatedPulse?: boolean } | null;
  activeRpePrompt: { exIdx: number; setIdx: number } | null;
  setActiveRpePrompt: React.Dispatch<
    React.SetStateAction<{ exIdx: number; setIdx: number } | null>
  >;
  setWeightDrafts: Record<string, string>;
  setSetWeightDrafts: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  overloadAppliedNote: Record<string, string>;
  savedTemplateBanner: string | null;
  formatPreviousSessionLine: (exerciseId: string, exerciseName: string) => string;
  onUpdateProfile: (profile: UserProfile) => void;
  onUpdateActiveWorkout: (workout: ActiveWorkout | null) => void;
  onCompleteWorkout: (workout: ActiveWorkout) => void;
  onSaveActiveAsTemplate: () => void;
  onOpenExercisePicker: () => void;
  onInspectExercise: (
    info: InspectedExerciseInfo & { activeIdx?: number },
  ) => void;
  onOpenReplaceActive: (
    exIdx: number,
    name: string,
    primaryMuscles: MuscleGroup[],
  ) => void;
  onAnnounceExerciseStart: (
    exIdx: number,
    exercisesList?: WorkoutExercise[],
    overrideEnabled?: boolean,
  ) => void;
  onSpeakAndRemember: (
    text: string,
    overrideEnabled?: boolean,
    overrideMuted?: boolean,
  ) => void;
  onRepeatCue: () => void;
  onStartRestTimer: (
    seconds: number,
    context?: {
      nextSetNum: number;
      exerciseName: string;
      nextExercise?: WorkoutExercise;
    },
  ) => void;
  onAdjustRestTimer: (delta: number) => void;
  onRestartRestTimer: () => void;
  onSkipRest: () => void;
  onUpdateSetField: (
    exIdx: number,
    setIdx: number,
    patch: {
      weightKg?: number;
      reps?: number;
      rpe?: number;
      completed?: boolean;
      setType?: SetType;
    },
  ) => void;
  onSelectRpeOneTap: (exIdx: number, setIdx: number, rpeVal: number) => void;
  onApplyProgressiveOverload: (
    exIdx: number,
    options: {
      deltaWeightKg?: number;
      deltaReps?: number;
      deltaSets?: number;
      nextBandLevelIds?: string[];
      deloadFactor?: number;
      feedbackLabel?: string;
    },
  ) => void;
  onSetExerciseLoadMode: (exIdx: number, mode: LoadMode) => void;
  onApplyExerciseBandLevels: (exIdx: number, levelIds: string[]) => void;
  onAddSetToExercise: (exIdx: number) => void;
  onRemoveSetFromExercise: (exIdx: number, setIdx: number) => void;
  onRemoveExercise: (exIdx: number) => void;
  onToggleSupersetWithNext: (exIdx: number) => void;
  onToggleWarmupItem: (wuId: string) => void;
}

export const ActiveWorkoutSession: React.FC<ActiveWorkoutSessionProps> = ({
  activeWorkout,
  profile,
  workouts,
  weightUnit,
  elapsedSec,
  wakeLockActive,
  hrBpm,
  hrDeviceName,
  hrError,
  isConnectingHr,
  onToggleHeartRate,
  voiceCoachEnabled,
  speechAvailable,
  isAudioMuted,
  setIsAudioMuted,
  lastSpokenCue,
  activeExerciseIdx,
  rpeTrackingEnabled,
  autoStartRest,
  preferredRestSec,
  restRemaining,
  restTotal,
  recoveryIndex,
  sleepPulseAlert,
  activeRpePrompt,
  setActiveRpePrompt,
  setWeightDrafts,
  setSetWeightDrafts,
  overloadAppliedNote,
  savedTemplateBanner,
  formatPreviousSessionLine,
  onUpdateProfile,
  onUpdateActiveWorkout,
  onCompleteWorkout,
  onSaveActiveAsTemplate,
  onOpenExercisePicker,
  onInspectExercise,
  onOpenReplaceActive,
  onAnnounceExerciseStart,
  onSpeakAndRemember,
  onRepeatCue,
  onStartRestTimer,
  onAdjustRestTimer,
  onRestartRestTimer,
  onSkipRest,
  onUpdateSetField,
  onSelectRpeOneTap,
  onApplyProgressiveOverload,
  onSetExerciseLoadMode,
  onApplyExerciseBandLevels,
  onAddSetToExercise,
  onRemoveSetFromExercise,
  onRemoveExercise,
  onToggleSupersetWithNext,
  onToggleWarmupItem,
}) => {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [combinedBandTargetExId, setCombinedBandTargetExId] = useState<
    string | null
  >(null);

  const activeExercises = activeWorkout.exercises ?? [];
  const completedSetsCount =
    activeExercises.length === 0
      ? 0
      : activeExercises.reduce(
          (acc, ex) => acc + ex.sets.filter((s) => s.completed).length,
          0,
        );

  const totalSetsCount =
    activeExercises.length === 0
      ? 0
      : activeExercises.reduce((acc, ex) => acc + ex.sets.length, 0);

  const liveVolumeKg =
    activeExercises.length === 0
      ? 0
      : activeExercises.reduce(
          (acc, ex) =>
            acc +
            ex.sets.reduce(
              (sAcc, s) => (s.completed ? sAcc + s.weightKg * s.reps : sAcc),
              0,
            ),
          0,
        );

  const supersetLabelByGroup = useMemo(() => {
    const map = new Map<string, string>();
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let idx = 0;
    for (const ex of activeExercises) {
      if (ex.supersetGroupId && !map.has(ex.supersetGroupId)) {
        map.set(ex.supersetGroupId, letters[idx % letters.length]);
        idx += 1;
      }
    }
    return map;
  }, [activeExercises]);

  const hrZone = hrBpm ? computeHeartRateZone(hrBpm, profile.age) : null;

  const updateExerciseNotes = (exIdx: number, notes: string) => {
    const nextExercises = activeWorkout.exercises.map((ex, i) =>
      i === exIdx ? { ...ex, notes } : ex,
    );
    onUpdateActiveWorkout({ ...activeWorkout, exercises: nextExercises });
  };

  return (
    <div className="space-y-5 pb-6">
      {/* Active Session Summary + Top Coach de Voz Switch + Large Audio Controls */}
      <div className="rounded-3xl border border-[#262B36] bg-[#13151A] p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-semibold text-[#D4FF33]">
                Entrenamiento en vivo
              </p>
              {wakeLockActive && (
                <span className="text-[11px] font-semibold text-emerald-300">
                  · Pantalla activa
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display text-white truncate">
              {activeWorkout.title}
            </h1>
          </div>
          <div className="flex items-center gap-2 text-right shrink-0">
            {isBluetoothHeartRateSupported() && (
              <button
                type="button"
                onClick={onToggleHeartRate}
                disabled={isConnectingHr}
                className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border px-2.5 text-xs font-bold ${
                  hrDeviceName
                    ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
                    : 'border-[#2A2F3D] bg-[#181B23] text-zinc-300 hover:border-[#D4FF33]'
                }`}
              >
                <Bluetooth className="w-3.5 h-3.5" />
                {isConnectingHr
                  ? '...'
                  : hrDeviceName
                    ? `${hrBpm ?? '--'} BPM`
                    : 'HR'}
              </button>
            )}
            <Clock className="w-4 h-4 text-[#D4FF33]" />
            <span className="text-xl font-bold font-mono tabular-nums text-white">
              {formatSeconds(elapsedSec)}
            </span>
          </div>
        </div>

        {hrError && (
          <p className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-2.5 text-xs text-rose-200">
            {hrError}
          </p>
        )}

        {hrBpm && hrZone && (
          <div
            className={`rounded-2xl border px-3.5 py-2.5 flex items-center justify-between ${hrZone.bgClass}`}
          >
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />
              <span className="text-xs font-bold text-white">
                {hrDeviceName}
              </span>
            </div>
            <div className="flex items-center gap-2.5 font-mono tabular-nums text-xs">
              <span className={`font-extrabold ${hrZone.colorClass}`}>
                {hrZone.label} ({hrZone.pctMax}%)
              </span>
              <span className="text-base font-extrabold text-white">
                {hrBpm} BPM
              </span>
            </div>
          </div>
        )}

        {/* Coach de Voz Top Switch */}
        <div className="rounded-2xl border border-[#2A2F3D] bg-[#0E1014] p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {voiceCoachEnabled && !isAudioMuted ? (
                <Volume2 className="w-5 h-5 text-[#D4FF33] shrink-0" />
              ) : (
                <VolumeX className="w-5 h-5 text-zinc-400 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">Coach de Voz</p>
                <p className="text-xs text-zinc-400 truncate">
                  {speechAvailable
                    ? voiceCoachEnabled
                      ? 'Guía técnica y avisos de descanso activos'
                      : 'Indicaciones de voz desactivadas'
                    : 'Síntesis de voz no disponible en este navegador'}
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={voiceCoachEnabled}
              aria-label="Activar o desactivar Coach de Voz"
              onClick={() => {
                const nextVal = !voiceCoachEnabled;
                onUpdateProfile({ ...profile, voiceCoachEnabled: nextVal });
                if (nextVal) {
                  const currentEx = activeWorkout.exercises[activeExerciseIdx];
                  if (currentEx) {
                    onAnnounceExerciseStart(
                      activeExerciseIdx,
                      activeWorkout.exercises,
                      true,
                    );
                  } else {
                    onSpeakAndRemember('Coach de voz activado.', true);
                  }
                } else {
                  cancelCoachSpeech();
                }
              }}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-extrabold transition-colors shrink-0 ${
                voiceCoachEnabled
                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                  : 'bg-[#1D212B] text-zinc-300'
              }`}
            >
              {voiceCoachEnabled ? 'ACTIVO' : 'APAGADO'}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                const nextMute = !isAudioMuted;
                setIsAudioMuted(nextMute);
                if (nextMute) {
                  cancelCoachSpeech();
                } else if (voiceCoachEnabled && lastSpokenCue) {
                  speakCoachCue(lastSpokenCue, { enabled: true, muted: false });
                }
              }}
              className={`min-h-[50px] flex flex-col items-center justify-center gap-1 rounded-xl px-2 text-xs font-bold transition-colors active:scale-[0.97] ${
                isAudioMuted
                  ? 'bg-rose-600/90 text-white'
                  : 'bg-[#1B1E26] text-white hover:bg-[#242834]'
              }`}
            >
              {isAudioMuted ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4 text-[#D4FF33]" />
              )}
              <span className="truncate">
                {isAudioMuted ? 'Con sonido' : 'Silenciar'}
              </span>
            </button>

            <button
              type="button"
              onClick={onRepeatCue}
              className="min-h-[50px] flex flex-col items-center justify-center gap-1 rounded-xl bg-[#1B1E26] hover:bg-[#242834] px-2 text-xs font-bold text-white active:scale-[0.97]"
            >
              <RotateCcw className="w-4 h-4 text-[#D4FF33]" />
              <span className="truncate">Repetir voz</span>
            </button>

            <button
              type="button"
              disabled={restRemaining === null}
              onClick={onSkipRest}
              className={`min-h-[50px] flex flex-col items-center justify-center gap-1 rounded-xl px-2 text-xs font-bold transition-colors active:scale-[0.97] ${
                restRemaining !== null
                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                  : 'bg-[#151820] text-zinc-500'
              }`}
            >
              <SkipForward className="w-4 h-4" />
              <span className="truncate">Saltar descanso</span>
            </button>
          </div>

          {lastSpokenCue && (
            <p className="text-xs text-zinc-400 leading-snug border-t border-white/5 pt-2">
              <span className="text-[#D4FF33] font-semibold">Coach: </span>
              {lastSpokenCue}
            </p>
          )}
        </div>

        {/* Seguimiento RPE & Recovery Indicator Bar */}
        <div className="rounded-2xl border border-[#262B36] bg-[#0E1014] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <Activity className="w-4 h-4 text-[#D4FF33] shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-white">Seguimiento RPE</p>
              <p className="text-[11px] text-zinc-400 truncate">
                Recup. {recoveryIndex.score}% ·{' '}
                {recoveryIndex.bpm
                  ? `${recoveryIndex.bpm} BPM PPG`
                  : recoveryIndex.stressLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={rpeTrackingEnabled}
            aria-label="Activar o desactivar Seguimiento RPE"
            onClick={() => {
              const nextVal = !rpeTrackingEnabled;
              if (!nextVal) setActiveRpePrompt(null);
              onUpdateProfile({ ...profile, rpeTrackingEnabled: nextVal });
            }}
            className={`min-h-[36px] px-3.5 rounded-xl text-xs font-extrabold transition-colors shrink-0 ${
              rpeTrackingEnabled
                ? 'bg-[#D4FF33] text-[#0A0B0D]'
                : 'bg-[#1D212B] text-zinc-400'
            }`}
          >
            {rpeTrackingEnabled ? 'RPE: ON' : 'RPE: OFF'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-[#1B1E26] px-4 py-2.5 flex items-center justify-between">
            <span className="text-zinc-400">Series</span>
            <span className="font-mono tabular-nums font-bold text-white">
              {completedSetsCount}/{totalSetsCount}
            </span>
          </div>
          <div className="rounded-2xl bg-[#1B1E26] px-4 py-2.5 flex items-center justify-between">
            <span className="text-zinc-400">Volumen</span>
            <span className="font-mono tabular-nums font-bold text-[#D4FF33]">
              {formatVolume(liveVolumeKg, weightUnit)}
            </span>
          </div>
        </div>

        {/* Configurable Automatic Rest Timer */}
        <div className="rounded-2xl border border-[#262B36] bg-[#0E1014] p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <Timer className="w-4 h-4 text-[#D4FF33]" />
              Descanso automático ({preferredRestSec}s · vibra al terminar)
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdateProfile({
                  ...profile,
                  autoStartRest: !autoStartRest,
                })
              }
              className={`min-h-[34px] px-3 rounded-lg text-xs font-bold transition-colors ${
                autoStartRest
                  ? 'bg-[#D4FF33] text-[#0A0B0D]'
                  : 'bg-[#1D212B] text-zinc-400'
              }`}
            >
              {autoStartRest ? 'Auto: ON' : 'Auto: OFF'}
            </button>
          </div>

          {restRemaining !== null ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-400">
                  Siguiente serie en
                </span>
                <span className="text-3xl font-extrabold font-mono tabular-nums text-[#D4FF33]">
                  {formatSeconds(restRemaining)}
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-[#1C2029] overflow-hidden">
                <div
                  className="h-full bg-[#D4FF33] transition-all duration-200"
                  style={{
                    width: `${Math.min(100, Math.round((restRemaining / Math.max(1, restTotal)) * 100))}%`,
                  }}
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => onAdjustRestTimer(-15)}
                  className="min-h-[44px] rounded-xl bg-[#1B1E26] text-xs font-bold text-zinc-200 active:scale-[0.97]"
                >
                  -15s
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustRestTimer(15)}
                  className="min-h-[44px] rounded-xl bg-[#1B1E26] text-xs font-bold text-zinc-200 active:scale-[0.97]"
                >
                  +15s
                </button>
                <button
                  type="button"
                  onClick={onRestartRestTimer}
                  className="min-h-[44px] rounded-xl bg-[#1B1E26] text-xs font-bold text-zinc-200 active:scale-[0.97]"
                >
                  Reiniciar
                </button>
                <button
                  type="button"
                  onClick={onSkipRest}
                  className="min-h-[44px] rounded-xl bg-[#272C37] text-xs font-bold text-white active:scale-[0.97]"
                >
                  Saltar
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {[45, 60, 90, 120].map((sec) => {
                const selected = preferredRestSec === sec;
                return (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => {
                      onUpdateProfile({ ...profile, preferredRestSec: sec });
                      onStartRestTimer(sec);
                    }}
                    className={`min-h-[44px] rounded-xl text-xs font-mono font-bold transition-colors active:scale-[0.97] ${
                      selected
                        ? 'bg-[#252B38] text-[#D4FF33] border border-[#D4FF33]/50'
                        : 'bg-[#1B1E26] text-zinc-300 hover:bg-[#232834]'
                    }`}
                  >
                    {sec}s
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Warmup Checklist */}
      {activeWorkout.warmup && activeWorkout.warmup.length > 0 && (
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-[#D4FF33]" />
            <h2 className="text-xl font-bold font-display text-white">
              Calentamiento previo
            </h2>
          </div>
          <div className="space-y-2">
            {activeWorkout.warmup.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => onToggleWarmupItem(w.id)}
                className={`w-full min-h-[48px] rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3 border text-left transition-colors ${
                  w.completed
                    ? 'border-[#D4FF33]/40 bg-[#D4FF33]/10 text-zinc-300'
                    : 'border-[#222631] bg-[#181B23] text-white'
                }`}
              >
                <div className="min-w-0">
                  <p
                    className={`text-sm font-semibold ${w.completed ? 'line-through text-zinc-400' : ''}`}
                  >
                    {w.name}
                  </p>
                  <p className="text-xs font-mono text-zinc-400">
                    {w.durationOrReps}
                  </p>
                </div>
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                    w.completed
                      ? 'bg-[#D4FF33] text-[#0A0B0D]'
                      : 'border border-zinc-600'
                  }`}
                >
                  {w.completed && <Check className="w-4 h-4 stroke-[3]" />}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Exercises List */}
      {activeWorkout.exercises.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#2C313E] bg-[#12141A] p-8 text-center space-y-3">
          <Dumbbell className="w-8 h-8 text-zinc-500 mx-auto" />
          <p className="text-base font-semibold text-zinc-200">
            Tu rutina libre está vacía
          </p>
          <p className="text-sm text-zinc-400">
            Agrega ejercicios filtrados para tu equipo disponible.
          </p>
          <button
            type="button"
            onClick={onOpenExercisePicker}
            className="min-h-[52px] inline-flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] px-6 text-sm font-bold text-[#0A0B0D]"
          >
            <Plus className="w-4 h-4" />
            Agregar primer ejercicio
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {activeWorkout.exercises.map((ex, exIdx) => {
            const previousLog = getPreviousExerciseSets(
              workouts,
              ex.exerciseId,
              ex.name,
            );
            const isCurrentExercise = activeExerciseIdx === exIdx;
            const loadMode: LoadMode =
              ex.loadMode === 'bands' ? 'bands' : 'weights';
            const currentBandIds = ex.bandConfig?.levelIds ?? ['media'];
            const currentBandSummary = describeBandSelection(
              currentBandIds,
              weightUnit,
            );
            const isCombinedOpen =
              combinedBandTargetExId === ex.id || currentBandIds.length > 1;
            const lastTimeSummary = formatPreviousSessionLine(
              ex.exerciseId,
              ex.name,
            );
            const weightStep = weightUnit === 'lb' ? 5 : 2.5;
            const supersetLetter = ex.supersetGroupId
              ? supersetLabelByGroup.get(ex.supersetGroupId)
              : null;
            const nextSameSuperset =
              exIdx < activeWorkout.exercises.length - 1 &&
              !!ex.supersetGroupId &&
              activeWorkout.exercises[exIdx + 1]?.supersetGroupId ===
                ex.supersetGroupId;
            const overloadHint = computeProgressiveOverloadHint(
              previousLog?.sets,
              weightUnit,
              loadMode,
              {
                recoveryPct: recoveryIndex.score,
                elevatedPulse: Boolean(sleepPulseAlert?.elevatedPulse),
                restingBpm: recoveryIndex.bpm ?? undefined,
                hrvMs: recoveryIndex.hrvMs ?? undefined,
                stressLabel: recoveryIndex.stressLabel,
                currentBandIds,
              },
            );
            const appliedBanner = overloadAppliedNote[ex.id];

            return (
              <section
                key={ex.id}
                className={`rounded-3xl border bg-[#12141A] p-4 sm:p-5 space-y-4 transition-colors ${
                  isCurrentExercise
                    ? 'border-[#D4FF33]/50'
                    : supersetLetter
                      ? 'border-sky-400/40'
                      : 'border-[#222631]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {supersetLetter && (
                      <span className="inline-block text-[11px] font-extrabold uppercase tracking-wider text-sky-300 mb-1">
                        Superserie {supersetLetter}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        onInspectExercise({
                          name: ex.name,
                          primaryMuscles: ex.primaryMuscles,
                          secondaryMuscles: ex.secondaryMuscles,
                          notes: ex.notes,
                          activeIdx: exIdx,
                        })
                      }
                      className="text-left group inline-flex items-center gap-2 max-w-full"
                    >
                      <h3 className="text-xl font-bold font-display text-white group-hover:text-[#D4FF33] transition-colors">
                        {ex.name}
                      </h3>
                      <Info className="w-4 h-4 text-[#D4FF33] shrink-0" />
                    </button>
                    <p className="text-xs font-mono text-[#D4FF33]/90 mt-0.5">
                      {lastTimeSummary}
                    </p>

                    {overloadHint && (
                      <div
                        className={`mt-2 rounded-2xl border p-3 space-y-2 ${
                          overloadHint.status === 'progress'
                            ? 'border-emerald-400/35 bg-emerald-500/10'
                            : overloadHint.status === 'hold_low_recovery'
                              ? 'border-amber-400/35 bg-amber-500/10'
                              : overloadHint.status === 'deload'
                                ? 'border-rose-400/35 bg-rose-500/10'
                                : 'border-sky-400/30 bg-sky-500/10'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {overloadHint.status === 'progress' ? (
                              <TrendingUp className="w-4 h-4 text-emerald-300 shrink-0" />
                            ) : overloadHint.status === 'hold_low_recovery' ||
                              overloadHint.status === 'deload' ? (
                              <AlertTriangle
                                className={`w-4 h-4 shrink-0 ${
                                  overloadHint.status === 'deload'
                                    ? 'text-rose-300'
                                    : 'text-amber-300'
                                }`}
                              />
                            ) : (
                              <Activity className="w-4 h-4 text-sky-300 shrink-0" />
                            )}
                            <span
                              className={`text-xs font-extrabold ${
                                overloadHint.status === 'progress'
                                  ? 'text-emerald-200'
                                  : overloadHint.status === 'hold_low_recovery'
                                    ? 'text-amber-200'
                                    : overloadHint.status === 'deload'
                                      ? 'text-rose-200'
                                      : 'text-sky-200'
                              }`}
                            >
                              {overloadHint.label}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                            <span className="rounded-md bg-[#0E1014]/80 px-2 py-0.5 text-zinc-200 border border-white/10">
                              RPE ant: {overloadHint.avgRpe.toFixed(1)}
                            </span>
                            <span className="rounded-md bg-[#0E1014]/80 px-2 py-0.5 text-zinc-200 border border-white/10">
                              Recup: {overloadHint.recoveryPct}%
                            </span>
                            {recoveryIndex.bpm && (
                              <span className="rounded-md bg-[#0E1014]/80 px-2 py-0.5 text-zinc-200 border border-white/10">
                                PPG: {recoveryIndex.bpm} BPM
                              </span>
                            )}
                          </div>
                        </div>

                        <p className="text-[11px] text-zinc-200 leading-relaxed">
                          {overloadHint.rationale}
                        </p>

                        {overloadHint.status === 'progress' && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            {overloadHint.deltaWeightKg > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  onApplyProgressiveOverload(exIdx, {
                                    deltaWeightKg: overloadHint.deltaWeightKg,
                                    feedbackLabel:
                                      weightUnit === 'lb'
                                        ? '+5 lb aplicado'
                                        : '+2.5 kg aplicado',
                                  })
                                }
                                className="min-h-[32px] rounded-xl bg-emerald-400 text-[#0A0B0D] px-3 text-[11px] font-extrabold active:scale-95"
                              >
                                {weightUnit === 'lb' ? '+5 lb' : '+2.5 kg'}
                              </button>
                            )}
                            {overloadHint.nextBandLevelIds &&
                              overloadHint.nextBandLabel && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onApplyProgressiveOverload(exIdx, {
                                      nextBandLevelIds:
                                        overloadHint.nextBandLevelIds,
                                      feedbackLabel: `Subido a ${overloadHint.nextBandLabel}`,
                                    })
                                  }
                                  className="min-h-[32px] rounded-xl bg-emerald-400 text-[#0A0B0D] px-3 text-[11px] font-extrabold active:scale-95"
                                >
                                  Subir a {overloadHint.nextBandLabel}
                                </button>
                              )}
                            <button
                              type="button"
                              onClick={() =>
                                onApplyProgressiveOverload(exIdx, {
                                  deltaReps: overloadHint.deltaReps || 2,
                                  feedbackLabel: `+${overloadHint.deltaReps || 2} reps aplicado`,
                                })
                              }
                              className="min-h-[32px] rounded-xl border border-emerald-400/50 bg-[#0E1014] text-emerald-200 hover:bg-emerald-400/15 px-3 text-[11px] font-extrabold active:scale-95"
                            >
                              +{overloadHint.deltaReps || 2} reps
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onApplyProgressiveOverload(exIdx, {
                                  deltaSets: overloadHint.deltaSets || 1,
                                  feedbackLabel: '+1 serie añadida',
                                })
                              }
                              className="min-h-[32px] rounded-xl border border-emerald-400/50 bg-[#0E1014] text-emerald-200 hover:bg-emerald-400/15 px-3 text-[11px] font-extrabold active:scale-95"
                            >
                              +1 serie
                            </button>
                          </div>
                        )}

                        {overloadHint.status === 'deload' && (
                          <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                onApplyProgressiveOverload(exIdx, {
                                  deloadFactor:
                                    overloadHint.deloadFactor ?? 0.9,
                                  feedbackLabel:
                                    'Descarga ligera (-10%) aplicada',
                                })
                              }
                              className="min-h-[32px] rounded-xl bg-rose-400 text-[#0A0B0D] px-3 text-[11px] font-extrabold active:scale-95"
                            >
                              Aplicar descarga -10%
                            </button>
                          </div>
                        )}

                        {appliedBanner && (
                          <p className="text-[11px] font-bold text-[#D4FF33]">
                            ✓ {appliedBanner}
                          </p>
                        )}
                      </div>
                    )}

                    <p className="text-xs text-zinc-400 mt-1">
                      {ex.primaryMuscles
                        .map((m) => MUSCLE_LABELS[m])
                        .join(' · ')}
                      {ex.secondaryMuscles.length > 0 &&
                        ` / Secundarios: ${ex.secondaryMuscles
                          .map((m) => MUSCLE_LABELS[m])
                          .join(', ')}`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                    {exIdx < activeWorkout.exercises.length - 1 && (
                      <button
                        type="button"
                        onClick={() => onToggleSupersetWithNext(exIdx)}
                        title={
                          nextSameSuperset
                            ? 'Desenlazar superserie con el siguiente'
                            : 'Enlazar en superserie con el siguiente'
                        }
                        className={`min-h-[44px] inline-flex items-center gap-1 rounded-xl border px-2.5 text-xs font-bold transition-colors ${
                          nextSameSuperset
                            ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                            : 'border-[#2A2F3D] bg-[#171A23] text-zinc-300 hover:border-sky-400'
                        }`}
                      >
                        {nextSameSuperset ? (
                          <Link2Off className="w-3.5 h-3.5" />
                        ) : (
                          <Link2 className="w-3.5 h-3.5" />
                        )}
                        <span className="hidden sm:inline">
                          {nextSameSuperset ? 'Soltar' : 'Superserie'}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        onInspectExercise({
                          name: ex.name,
                          primaryMuscles: ex.primaryMuscles,
                          secondaryMuscles: ex.secondaryMuscles,
                          notes: ex.notes,
                          activeIdx: exIdx,
                        })
                      }
                      aria-label={`Ver técnica y mapa muscular de ${ex.name}`}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-[#2A2F3D] bg-[#171A23] text-zinc-200 hover:border-[#D4FF33] hover:text-[#D4FF33]"
                    >
                      <Info className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onAnnounceExerciseStart(
                          exIdx,
                          activeWorkout.exercises,
                          true,
                        )
                      }
                      aria-label={`Anunciar ${ex.name} por voz`}
                      className={`min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors ${
                        isCurrentExercise
                          ? 'border-[#D4FF33] bg-[#D4FF33] text-[#0A0B0D]'
                          : 'border-[#2A2F3D] bg-[#171A23] text-white hover:bg-[#212531]'
                      }`}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      Iniciar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenReplaceActive(exIdx, ex.name, ex.primaryMuscles)
                      }
                      className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#2A2F3D] bg-[#171A23] px-3 text-xs font-bold text-[#D4FF33] hover:bg-[#212531]"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                      Reemplazar
                    </button>
                    <InlineDeleteConfirmButton
                      onConfirm={() => onRemoveExercise(exIdx)}
                      ariaLabel={`Quitar ${ex.name}`}
                      size="md"
                    />
                  </div>
                </div>

                {/* Editable Exercise Notes */}
                <div>
                  <input
                    type="text"
                    value={ex.notes ?? ''}
                    onChange={(e) => updateExerciseNotes(exIdx, e.target.value)}
                    placeholder="Notas del ejercicio (agarre, altura de banco, sensaciones...)"
                    aria-label={`Notas para ${ex.name}`}
                    className="w-full min-h-[38px] rounded-xl border border-[#222631] bg-[#0D0F14] px-3 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-[#D4FF33]/60 focus:outline-none"
                  />
                </div>

                {/* Load Mode Switch: Peso Libre (kg/lb) vs Ligas de Resistencia */}
                <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#141720] p-1">
                    <button
                      type="button"
                      onClick={() => onSetExerciseLoadMode(exIdx, 'weights')}
                      className={`min-h-[38px] rounded-lg text-xs font-extrabold transition-colors ${
                        loadMode === 'weights'
                          ? 'bg-[#D4FF33] text-[#0A0B0D]'
                          : 'text-zinc-300 hover:text-white'
                      }`}
                    >
                      Peso Libre ({weightUnit})
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetExerciseLoadMode(exIdx, 'bands')}
                      className={`min-h-[38px] rounded-lg text-xs font-extrabold transition-colors ${
                        loadMode === 'bands'
                          ? 'bg-[#D4FF33] text-[#0A0B0D]'
                          : 'text-zinc-300 hover:text-white'
                      }`}
                    >
                      Ligas de Resistencia
                    </button>
                  </div>

                  {loadMode === 'bands' && (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-zinc-300">
                          Resistencia seleccionada:{' '}
                          <strong className="text-[#D4FF33]">
                            {currentBandSummary.label}
                          </strong>
                        </span>
                        <span className="font-mono font-bold text-zinc-200">
                          ~{currentBandSummary.displayResistance} máx.
                        </span>
                      </div>

                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                        {RESISTANCE_BAND_PRESETS.map((band) => {
                          const activeSingle =
                            !isCombinedOpen &&
                            currentBandIds.length === 1 &&
                            currentBandIds[0] === band.id;
                          return (
                            <button
                              key={band.id}
                              type="button"
                              onClick={() => {
                                setCombinedBandTargetExId(null);
                                onApplyExerciseBandLevels(exIdx, [band.id]);
                              }}
                              className={`min-h-[44px] rounded-xl border px-2 py-1.5 text-left flex flex-col justify-center transition-colors ${
                                activeSingle
                                  ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-white'
                                  : 'border-[#252A36] bg-[#141720] text-zinc-300 hover:border-zinc-500'
                              }`}
                            >
                              <span className="flex items-center gap-1.5 text-[11px] font-bold truncate">
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: band.colorHex }}
                                />
                                <span className="truncate">
                                  {band.shortLabel}
                                </span>
                              </span>
                              <span className="text-[10px] font-mono text-zinc-400 mt-0.5">
                                {formatWeight(band.resistanceKg, weightUnit, 0)}
                              </span>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => {
                            setCombinedBandTargetExId(ex.id);
                            if (currentBandIds.length < 2) {
                              onApplyExerciseBandLevels(exIdx, [
                                currentBandIds[0] || 'media',
                                'fuerte',
                              ]);
                            }
                          }}
                          className={`min-h-[44px] rounded-xl border px-2 py-1.5 text-left flex flex-col justify-center transition-colors ${
                            isCombinedOpen
                              ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-[#D4FF33]'
                              : 'border-[#252A36] bg-[#141720] text-zinc-300 hover:border-zinc-500'
                          }`}
                        >
                          <span className="text-[11px] font-extrabold truncate">
                            Combinada
                          </span>
                          <span className="text-[10px] font-mono text-zinc-400 mt-0.5">
                            Sumar 2
                          </span>
                        </button>
                      </div>

                      {isCombinedOpen && (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          {[0, 1].map((slot) => (
                            <label
                              key={slot}
                              className="text-[11px] text-zinc-400"
                            >
                              Liga {slot + 1}
                              <select
                                value={currentBandIds[slot] ?? 'media'}
                                onChange={(e) => {
                                  const next = [
                                    currentBandIds[0] ?? 'media',
                                    currentBandIds[1] ?? 'fuerte',
                                  ];
                                  next[slot] = e.target.value;
                                  onApplyExerciseBandLevels(exIdx, next);
                                }}
                                className="mt-1 w-full min-h-[38px] rounded-xl border border-[#2A2F3D] bg-[#141720] px-2.5 text-xs font-semibold text-white"
                              >
                                {RESISTANCE_BAND_PRESETS.map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {b.label} (
                                    {formatWeight(
                                      b.resistanceKg,
                                      weightUnit,
                                      0,
                                    )}
                                    )
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Sets */}
                <div className="space-y-3">
                  {ex.sets.map((s, sIdx) => {
                    const prevSet =
                      previousLog?.sets[sIdx] ??
                      previousLog?.sets[previousLog.sets.length - 1];
                    const currentRpe = s.rpe ?? 8;
                    const currentSetType: SetType = s.setType ?? 'normal';
                    const displaySetWeight = kgToDisplayWeight(
                      s.weightKg,
                      weightUnit,
                    );
                    const draftVal = setWeightDrafts[s.id];

                    return (
                      <div
                        key={s.id}
                        className={`rounded-2xl p-3.5 transition-colors border space-y-3 ${
                          s.completed
                            ? 'border-[#D4FF33]/55 bg-[#D4FF33]/10'
                            : currentSetType === 'warmup'
                              ? 'border-amber-500/35 bg-amber-950/15'
                              : 'border-[#222631] bg-[#181B23]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`text-xs font-mono font-bold ${
                                currentSetType === 'warmup'
                                  ? 'text-amber-300'
                                  : currentSetType === 'dropset'
                                    ? 'text-sky-300'
                                    : currentSetType === 'failure'
                                      ? 'text-rose-300'
                                      : 'text-[#D4FF33]'
                              }`}
                            >
                              SERIE {sIdx + 1}
                              {currentSetType === 'warmup'
                                ? ' (C · Calent.)'
                                : currentSetType === 'dropset'
                                  ? ' (D · Drop)'
                                  : currentSetType === 'failure'
                                    ? ' (F · Fallo)'
                                    : ''}
                            </span>
                            <span className="text-xs font-mono tabular-nums text-zinc-400">
                              {prevSet
                                ? prevSet.bandLabel
                                  ? `Anterior: ${prevSet.bandLabel} × ${prevSet.reps}`
                                  : `Anterior: ${formatWeight(prevSet.weightKg, weightUnit)} × ${prevSet.reps}${prevSet.rpe ? ` @ RPE ${prevSet.rpe}` : ''}`
                                : 'Sin registro previo'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {(
                              [
                                {
                                  id: 'warmup',
                                  code: 'C',
                                  title: 'Calentamiento (excluido de 1RM)',
                                },
                                {
                                  id: 'normal',
                                  code: 'N',
                                  title: 'Serie normal',
                                },
                                {
                                  id: 'dropset',
                                  code: 'D',
                                  title: 'Drop set',
                                },
                                {
                                  id: 'failure',
                                  code: 'F',
                                  title: 'Al fallo',
                                },
                              ] as { id: SetType; code: string; title: string }[]
                            ).map((st) => (
                              <button
                                key={st.id}
                                type="button"
                                title={st.title}
                                onClick={() =>
                                  onUpdateSetField(exIdx, sIdx, {
                                    setType: st.id,
                                  })
                                }
                                className={`min-h-[30px] min-w-[28px] rounded-lg text-[11px] font-mono font-extrabold transition-colors ${
                                  currentSetType === st.id
                                    ? st.id === 'warmup'
                                      ? 'bg-amber-400 text-[#0A0B0D]'
                                      : st.id === 'dropset'
                                        ? 'bg-sky-400 text-[#0A0B0D]'
                                        : st.id === 'failure'
                                          ? 'bg-rose-500 text-white'
                                          : 'bg-[#D4FF33] text-[#0A0B0D]'
                                    : 'bg-[#0E1014] text-zinc-400 hover:text-white'
                                }`}
                              >
                                {st.code}
                              </button>
                            ))}
                            {ex.sets.length > 1 && (
                              <InlineDeleteConfirmButton
                                onConfirm={() =>
                                  onRemoveSetFromExercise(exIdx, sIdx)
                                }
                                ariaLabel={`Eliminar serie ${sIdx + 1} de ${ex.name}`}
                                size="sm"
                              />
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {/* Weight Stepper OR Band Equivalence Card */}
                          {loadMode === 'bands' ? (
                            <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0E1014] px-3.5 py-2.5 min-h-[60px]">
                              <div className="min-w-0">
                                <span className="block text-[11px] text-zinc-400">
                                  Carga con liga
                                </span>
                                <span className="block text-sm font-extrabold text-white truncate">
                                  {s.bandLabel || currentBandSummary.label}
                                </span>
                              </div>
                              <span className="font-mono text-sm font-bold text-[#D4FF33] shrink-0">
                                {formatWeight(s.weightKg, weightUnit, 0)}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-1 rounded-xl bg-[#0E1014] p-1.5">
                              <button
                                type="button"
                                aria-label={`Restar ${weightStep} ${weightUnit}`}
                                onClick={() => {
                                  const nextDisplay = Math.max(
                                    0,
                                    displaySetWeight - weightStep,
                                  );
                                  setSetWeightDrafts((prev) => {
                                    const copy = { ...prev };
                                    delete copy[s.id];
                                    return copy;
                                  });
                                  onUpdateSetField(exIdx, sIdx, {
                                    weightKg: displayWeightToKg(
                                      nextDisplay,
                                      weightUnit,
                                    ),
                                  });
                                }}
                                className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-lg bg-[#1C2029] text-white active:scale-95"
                              >
                                <Minus className="w-5 h-5" />
                              </button>
                              <div className="text-center px-2">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={
                                    draftVal !== undefined
                                      ? draftVal
                                      : String(displaySetWeight)
                                  }
                                  onChange={(e) =>
                                    setSetWeightDrafts((prev) => ({
                                      ...prev,
                                      [s.id]: e.target.value,
                                    }))
                                  }
                                  onBlur={() => {
                                    const raw = setWeightDrafts[s.id];
                                    setSetWeightDrafts((prev) => {
                                      const copy = { ...prev };
                                      delete copy[s.id];
                                      return copy;
                                    });
                                    if (raw === undefined) return;
                                    const parsed = parseFloat(
                                      raw.replace(',', '.').trim(),
                                    );
                                    if (!Number.isNaN(parsed) && parsed >= 0) {
                                      onUpdateSetField(exIdx, sIdx, {
                                        weightKg: displayWeightToKg(
                                          parsed,
                                          weightUnit,
                                        ),
                                      });
                                    }
                                  }}
                                  aria-label={`Peso real en ${weightUnit}`}
                                  className="w-16 bg-transparent text-center text-lg font-bold font-mono tabular-nums text-white focus:outline-none"
                                />
                                <span className="block text-[11px] text-zinc-400">
                                  {weightUnit}
                                </span>
                              </div>
                              <button
                                type="button"
                                aria-label={`Sumar ${weightStep} ${weightUnit}`}
                                onClick={() => {
                                  const nextDisplay =
                                    displaySetWeight + weightStep;
                                  setSetWeightDrafts((prev) => {
                                    const copy = { ...prev };
                                    delete copy[s.id];
                                    return copy;
                                  });
                                  onUpdateSetField(exIdx, sIdx, {
                                    weightKg: displayWeightToKg(
                                      nextDisplay,
                                      weightUnit,
                                    ),
                                  });
                                }}
                                className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-lg bg-[#1C2029] text-white active:scale-95"
                              >
                                <Plus className="w-5 h-5" />
                              </button>
                            </div>
                          )}

                          {/* Reps Stepper */}
                          <div className="flex items-center justify-between gap-1 rounded-xl bg-[#0E1014] p-1.5">
                            <button
                              type="button"
                              aria-label="Restar 1 repetición"
                              onClick={() =>
                                onUpdateSetField(exIdx, sIdx, {
                                  reps: Math.max(1, s.reps - 1),
                                })
                              }
                              className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-lg bg-[#1C2029] text-white active:scale-95"
                            >
                              <Minus className="w-5 h-5" />
                            </button>
                            <div className="text-center px-2">
                              <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                value={s.reps}
                                onChange={(e) =>
                                  onUpdateSetField(exIdx, sIdx, {
                                    reps: Math.max(
                                      1,
                                      Number(e.target.value) || 1,
                                    ),
                                  })
                                }
                                aria-label="Repeticiones reales"
                                className="w-16 bg-transparent text-center text-lg font-bold font-mono tabular-nums text-white focus:outline-none"
                              />
                              <span className="block text-[11px] text-zinc-400">
                                reps
                              </span>
                            </div>
                            <button
                              type="button"
                              aria-label="Sumar 1 repetición"
                              onClick={() =>
                                onUpdateSetField(exIdx, sIdx, {
                                  reps: s.reps + 1,
                                })
                              }
                              className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-lg bg-[#1C2029] text-white active:scale-95"
                            >
                              <Plus className="w-5 h-5" />
                            </button>
                          </div>
                        </div>

                        {/* 1-Touch Tactile RPE Selector */}
                        {rpeTrackingEnabled && (
                          <div className="rounded-xl bg-[#0E1014] border border-[#222631] p-2.5 space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-bold text-zinc-300">
                                  Esfuerzo RPE
                                </span>
                                <span className="rounded-lg bg-[#D4FF33]/15 border border-[#D4FF33]/40 px-2 py-0.5 text-[11px] font-mono font-extrabold text-[#D4FF33] truncate">
                                  RPE {currentRpe} · {getRpeShortLabel(currentRpe)}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveRpePrompt((prev) =>
                                    prev?.exIdx === exIdx && prev?.setIdx === sIdx
                                      ? null
                                      : { exIdx, setIdx: sIdx },
                                  )
                                }
                                className="text-[11px] font-bold text-[#D4FF33] hover:underline shrink-0"
                              >
                                {activeRpePrompt?.exIdx === exIdx &&
                                activeRpePrompt?.setIdx === sIdx
                                  ? 'Listo'
                                  : 'Cambiar (1 toque)'}
                              </button>
                            </div>

                            {activeRpePrompt?.exIdx === exIdx &&
                              activeRpePrompt?.setIdx === sIdx && (
                                <div className="space-y-2 pt-1 border-t border-white/5">
                                  <p className="text-[11px] font-semibold text-zinc-400">
                                    Toca tu esfuerzo real en 1 toque:
                                  </p>
                                  <div className="grid grid-cols-5 gap-1.5">
                                    {RPE_PRIMARY_OPTIONS.map((opt) => {
                                      const isSelected =
                                        currentRpe === opt.value;
                                      return (
                                        <button
                                          key={opt.value}
                                          type="button"
                                          title={opt.detailLabel}
                                          onClick={() =>
                                            onSelectRpeOneTap(
                                              exIdx,
                                              sIdx,
                                              opt.value,
                                            )
                                          }
                                          className={`min-h-[60px] rounded-xl px-1 py-1.5 flex flex-col items-center justify-center gap-0.5 border transition-transform active:scale-95 ${
                                            isSelected
                                              ? 'border-[#D4FF33] bg-[#D4FF33] text-[#0A0B0D]'
                                              : opt.value >= 9
                                                ? 'border-rose-500/35 bg-[#1B161B] text-white hover:border-[#D4FF33]'
                                                : 'border-[#2A2F3D] bg-[#181B23] text-white hover:border-[#D4FF33]'
                                          }`}
                                        >
                                          <span className="text-lg font-mono font-extrabold leading-none">
                                            {opt.value}
                                          </span>
                                          <span
                                            className={`text-[10px] font-bold leading-tight text-center ${
                                              isSelected
                                                ? 'text-[#0A0B0D]/90'
                                                : 'text-zinc-400'
                                            }`}
                                          >
                                            {opt.shortLabel}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-bold text-zinc-500 shrink-0">
                                      1–5:
                                    </span>
                                    <div className="grid grid-cols-5 gap-1 flex-1">
                                      {RPE_LOW_OPTIONS.map((opt) => {
                                        const isSelected =
                                          currentRpe === opt.value;
                                        return (
                                          <button
                                            key={opt.value}
                                            type="button"
                                            title={`${opt.value} · ${opt.shortLabel}`}
                                            onClick={() =>
                                              onSelectRpeOneTap(
                                                exIdx,
                                                sIdx,
                                                opt.value,
                                              )
                                            }
                                            className={`min-h-[36px] rounded-lg px-1 flex flex-col items-center justify-center border text-[11px] font-mono font-bold transition-transform active:scale-95 ${
                                              isSelected
                                                ? 'border-[#D4FF33] bg-[#D4FF33] text-[#0A0B0D]'
                                                : 'border-[#252A36] bg-[#141720] text-zinc-300 hover:border-zinc-400'
                                            }`}
                                          >
                                            <span>{opt.value}</span>
                                            <span
                                              className={`text-[9px] font-sans leading-none truncate max-w-full ${
                                                isSelected
                                                  ? 'text-[#0A0B0D]/80'
                                                  : 'text-zinc-500'
                                              }`}
                                            >
                                              {opt.shortLabel}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              )}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            onUpdateSetField(exIdx, sIdx, {
                              completed: !s.completed,
                            })
                          }
                          className={`w-full min-h-[50px] flex items-center justify-center gap-2 rounded-xl text-sm font-bold transition-transform active:scale-[0.98] ${
                            s.completed
                              ? 'bg-[#D4FF33] text-[#0A0B0D]'
                              : 'bg-[#242936] text-white hover:bg-[#2D3342]'
                          }`}
                        >
                          <Check className="w-5 h-5" />
                          {s.completed
                            ? 'Serie completada'
                            : 'Marcar serie lista'}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => onAddSetToExercise(exIdx)}
                  className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-2xl border border-[#2A2F3D] bg-[#161922] text-sm font-semibold text-zinc-200 hover:bg-[#1E222E] active:scale-[0.98]"
                >
                  <Plus className="w-4 h-4 text-[#D4FF33]" />
                  Agregar serie
                </button>
              </section>
            );
          })}
        </div>
      )}

      {/* Action Buttons at bottom of active workout */}
      <div className="space-y-3 pt-2">
        {savedTemplateBanner && (
          <p
            role="status"
            className="rounded-2xl border border-[#D4FF33]/40 bg-[#D4FF33]/10 p-3 text-xs font-bold text-[#D4FF33] text-center"
          >
            {savedTemplateBanner}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onOpenExercisePicker}
            className="w-full min-h-[52px] flex items-center justify-center gap-2 rounded-2xl border border-[#2B303C] bg-[#161920] text-sm font-bold text-white hover:bg-[#1F2430] active:scale-[0.98]"
          >
            <Plus className="w-5 h-5 text-[#D4FF33]" />
            Añadir otro ejercicio
          </button>

          <button
            type="button"
            disabled={activeWorkout.exercises.length === 0}
            onClick={onSaveActiveAsTemplate}
            className="w-full min-h-[52px] flex items-center justify-center gap-2 rounded-2xl border border-[#2B303C] bg-[#161920] disabled:opacity-50 text-sm font-bold text-zinc-200 hover:border-[#D4FF33]/50 hover:text-[#D4FF33] active:scale-[0.98]"
          >
            <BookmarkPlus className="w-4 h-4 text-[#D4FF33]" />
            Guardar como plantilla
          </button>
        </div>

        <button
          type="button"
          disabled={completedSetsCount === 0}
          onClick={() => onCompleteWorkout(activeWorkout)}
          className="w-full min-h-[56px] flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] disabled:bg-[#232730] disabled:text-zinc-500 text-base font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
        >
          <Check className="w-5 h-5" />
          Finalizar entrenamiento ({completedSetsCount} series)
        </button>

        {!confirmCancel ? (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="w-full min-h-[48px] rounded-2xl text-sm font-semibold text-zinc-400 hover:text-rose-400"
          >
            Descartar sesión actual
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setConfirmCancel(false)}
              className="min-h-[48px] rounded-2xl bg-[#1B1E26] text-sm font-semibold text-white"
            >
              Seguir entrenando
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmCancel(false);
                onUpdateActiveWorkout(null);
              }}
              className="min-h-[48px] rounded-2xl bg-rose-600 text-sm font-bold text-white flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-4 h-4" />
              Confirmar descarte
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
