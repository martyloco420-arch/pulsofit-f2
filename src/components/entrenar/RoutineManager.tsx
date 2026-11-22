import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Copy,
  Edit3,
  Flame,
  Info,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { MUSCLE_LABELS } from '../../lib/recovery';
import { formatWeight } from '../../lib/units';
import type {
  ActiveFastState,
  AdaptiveNutritionState,
  AppDatabase,
  BodyCompositionScan,
  BodyWeightEntry,
  CardioSession,
  DailyReadinessEntry,
  ExerciseDefinition,
  FoodEntry,
  HiitSession,
  HydrationSettings,
  MuscleGroup,
  TabId,
  UserProfile,
  WeightUnit,
  WorkoutSession,
  WorkoutTemplate,
} from '../../types/fitness';
import type { InspectedExerciseInfo } from '../ExerciseDemoModal';
import { HoyOverview } from '../HoyOverview';
import { InlineDeleteConfirmButton } from '../InlineDeleteConfirmButton';
import { WorkoutCalendarAnalyticsCard } from '../WorkoutCalendarAnalyticsCard';

export interface AiGeneratedRoutine {
  title: string;
  rationale: string;
  warmup: { name: string; durationOrReps: string }[];
  exercises: {
    name: string;
    primaryMuscles: MuscleGroup[];
    secondaryMuscles: MuscleGroup[];
    sets: number;
    reps: number;
    suggestedWeightKg: number;
    restSec: number;
    notes?: string;
  }[];
}

interface BlueprintRoutine {
  id: string;
  title: string;
  focusLabel: string;
  readinessScore: number;
  isRecommended?: boolean;
  exercises: ExerciseDefinition[];
}

export interface RoutineManagerProps {
  effectiveDatabase: AppDatabase;
  profile: UserProfile;
  weightUnit: WeightUnit;
  equipmentLabels: string;
  workouts: WorkoutSession[];
  cardioSessions: CardioSession[];
  hiitSessions: HiitSession[];
  bodyWeights: BodyWeightEntry[];
  bodyScans: BodyCompositionScan[];
  foodLogs: FoodEntry[];
  hydrationByDate: Record<string, number>;
  hydrationSettings?: HydrationSettings;
  adaptiveNutrition?: AdaptiveNutritionState | null;
  activeFast: ActiveFastState | null;
  todayReadiness: DailyReadinessEntry | null;
  workoutTemplates: WorkoutTemplate[];
  availableExercises: ExerciseDefinition[];
  recommendedRoutine?: BlueprintRoutine;
  otherRoutines: BlueprintRoutine[];
  freshestMuscles: MuscleGroup[];
  decayedFatigue: Record<MuscleGroup, number>;
  recoveryIndex: {
    score: number;
    bpm?: number | null;
    stressLabel: string;
  };
  sleepPulseAlert: {
    title: string;
    message: string;
    suggestion: string;
    lowSleepQuality?: boolean;
  } | null;
  aiRoutine: AiGeneratedRoutine | null;
  isGeneratingAi: boolean;
  aiError: string | null;
  rpeTrackingEnabled: boolean;
  formatPreviousSessionLine: (exerciseId: string, exerciseName: string) => string;
  onStartEmpty: () => void;
  onStartBlueprint: (title: string, defs: ExerciseDefinition[]) => void;
  onStartTemplate: (tpl: WorkoutTemplate) => void;
  onSaveTemplate: (template: WorkoutTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  onGenerateAiRoutine: () => void;
  onStartAiRoutine: () => void;
  onOpenReplacePreview: (
    exIdx: number,
    name: string,
    primaryMuscles: MuscleGroup[],
  ) => void;
  onInspectExercise: (
    info: InspectedExerciseInfo & { previewIdx?: number },
  ) => void;
  onUpdateProfile: (profile: UserProfile) => void;
  onSaveReadiness: (entry: DailyReadinessEntry) => void;
  onNavigateTab: (tab: TabId) => void;
  onOpenSleep?: () => void;
  onOpenPulse?: () => void;
}

export const RoutineManager: React.FC<RoutineManagerProps> = ({
  effectiveDatabase,
  profile,
  weightUnit,
  equipmentLabels,
  workouts,
  cardioSessions,
  hiitSessions,
  bodyWeights,
  bodyScans,
  foodLogs,
  hydrationByDate,
  hydrationSettings,
  adaptiveNutrition,
  activeFast,
  todayReadiness,
  workoutTemplates,
  availableExercises,
  recommendedRoutine,
  otherRoutines,
  freshestMuscles,
  decayedFatigue,
  recoveryIndex,
  sleepPulseAlert,
  aiRoutine,
  isGeneratingAi,
  aiError,
  rpeTrackingEnabled,
  formatPreviousSessionLine,
  onStartEmpty,
  onStartBlueprint,
  onStartTemplate,
  onSaveTemplate,
  onDeleteTemplate,
  onGenerateAiRoutine,
  onStartAiRoutine,
  onOpenReplacePreview,
  onInspectExercise,
  onUpdateProfile,
  onSaveReadiness,
  onNavigateTab,
  onOpenSleep,
  onOpenPulse,
}) => {
  const [editingTemplate, setEditingTemplate] = useState<WorkoutTemplate | null>(
    null,
  );
  const [tplSearch, setTplSearch] = useState('');
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);

  const handleDuplicateTemplate = (tpl: WorkoutTemplate) => {
    const nowIso = new Date().toISOString();
    const duplicated: WorkoutTemplate = {
      ...tpl,
      id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      name: `${tpl.name} (Copia)`,
      exercises: tpl.exercises.map((ex, idx) => ({
        ...ex,
        id: `tex_dup_${Date.now()}_${idx}`,
      })),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    onSaveTemplate(duplicated);
    setTemplateNotice(`"${duplicated.name}" duplicada en Mis plantillas.`);
    window.setTimeout(() => setTemplateNotice(null), 2800);
  };

  return (
    <>
      {/* Inteligencia cruzada: Aviso si último sueño < 65% o pulso elevado */}
      {sleepPulseAlert && (
        <section
          role="status"
          className="rounded-3xl border border-amber-400/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-amber-300" />
            </div>
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs sm:text-sm font-extrabold text-amber-200">
                {sleepPulseAlert.title}
              </p>
              <p className="text-xs text-zinc-200 leading-relaxed">
                {sleepPulseAlert.message} {sleepPulseAlert.suggestion}
              </p>
            </div>
          </div>
          {(onOpenSleep || onOpenPulse) && (
            <button
              type="button"
              onClick={() => {
                if (sleepPulseAlert.lowSleepQuality && onOpenSleep) {
                  onOpenSleep();
                } else if (onOpenPulse) {
                  onOpenPulse();
                }
              }}
              className="min-h-[38px] rounded-xl border border-amber-400/40 bg-[#12141A] px-3 text-xs font-bold text-amber-200 hover:text-white shrink-0"
            >
              Ver Sueño / Pulso
            </button>
          )}
        </section>
      )}

      {/* UNIFIED DAILY OVERVIEW ("Hoy en PulsoFit") + READINESS CHECK-IN */}
      <HoyOverview
        profile={profile}
        workouts={workouts}
        cardioSessions={cardioSessions}
        hiitSessions={hiitSessions}
        bodyWeights={bodyWeights}
        bodyScans={bodyScans}
        foodLogs={foodLogs}
        hydrationByDate={hydrationByDate}
        hydrationSettings={hydrationSettings}
        adaptiveNutrition={adaptiveNutrition}
        activeFast={activeFast}
        todayReadiness={todayReadiness}
        recommendedTitle={recommendedRoutine?.title ?? 'Rutina recomendada'}
        onStartRecommended={() => {
          if (recommendedRoutine) {
            onStartBlueprint(
              recommendedRoutine.title,
              recommendedRoutine.exercises,
            );
          }
        }}
        onSaveReadiness={onSaveReadiness}
        onNavigateTab={onNavigateTab}
        onOpenSleep={onOpenSleep}
        onOpenPulse={onOpenPulse}
      />

      {/* MONTHLY WORKOUT CALENDAR & DURATION ANALYTICS */}
      <WorkoutCalendarAnalyticsCard database={effectiveDatabase} />

      {/* Header, Seguimiento RPE Toggle & Equipment context */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">
              Entrenar hoy
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Equipo: <span className="text-zinc-200">{equipmentLabels}</span>
              <span className="mx-2 text-zinc-600">·</span>
              <button
                type="button"
                onClick={() => onNavigateTab('perfil')}
                className="text-[#D4FF33] font-semibold underline-offset-4 hover:underline"
              >
                Cambiar equipo
              </button>
            </p>
          </div>
          <button
            type="button"
            onClick={onStartEmpty}
            className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl border border-[#2B303C] bg-[#151820] px-5 text-sm font-semibold text-white hover:bg-[#1D212B] active:scale-[0.98] transition-transform shrink-0"
          >
            <Plus className="w-4 h-4 text-[#D4FF33]" />
            Rutina libre
          </button>
        </div>

        {/* Workout Manager RPE & Recovery Control Strip */}
        <div className="rounded-2xl border border-[#222631] bg-[#12141A] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#D4FF33]/12 border border-[#D4FF33]/35 flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4 text-[#D4FF33]" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-white">
                Seguimiento RPE (1–10) y Progresión Inteligente
              </p>
              <p className="text-[11px] text-zinc-400 truncate">
                Recup. hoy:{' '}
                <span className="font-mono font-bold text-zinc-200">
                  {recoveryIndex.score}%
                </span>{' '}
                ·{' '}
                {recoveryIndex.bpm
                  ? `PPG ${recoveryIndex.bpm} BPM (${recoveryIndex.stressLabel})`
                  : recoveryIndex.stressLabel}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={rpeTrackingEnabled}
            aria-label="Activar o desactivar Seguimiento RPE"
            onClick={() =>
              onUpdateProfile({
                ...profile,
                rpeTrackingEnabled: !rpeTrackingEnabled,
              })
            }
            className={`min-h-[40px] px-3.5 rounded-xl text-xs font-extrabold transition-colors shrink-0 border ${
              rpeTrackingEnabled
                ? 'bg-[#D4FF33] border-[#D4FF33] text-[#0A0B0D]'
                : 'bg-[#1A1D26] border-[#2A2F3D] text-zinc-400 hover:text-white'
            }`}
          >
            Seguimiento RPE: {rpeTrackingEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* FITBOD-STYLE AI ROUTINE GENERATOR HERO */}
      <section className="rounded-3xl border border-[#D4FF33]/40 bg-[#13161D] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-[#D4FF33]">
              Entrenador IA · Adaptado a tu recuperación
            </p>
            <h2 className="mt-1 text-2xl sm:text-3xl font-extrabold font-display text-white">
              Generador inteligente de sesión
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Músculos más frescos hoy:{' '}
              <span className="text-zinc-100 font-semibold">
                {freshestMuscles
                  .map(
                    (m) =>
                      `${MUSCLE_LABELS[m]} (${100 - (decayedFatigue[m] ?? 0)}%)`,
                  )
                  .join(' · ')}
              </span>
            </p>
          </div>
          <Sparkles className="w-6 h-6 text-[#D4FF33] shrink-0" />
        </div>

        <button
          type="button"
          onClick={onGenerateAiRoutine}
          disabled={isGeneratingAi}
          className="w-full min-h-[56px] flex items-center justify-center gap-2.5 rounded-2xl bg-[#D4FF33] disabled:opacity-70 px-6 text-base font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
        >
          {isGeneratingAi ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Diseñando calentamiento y ejercicios con Gemini...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              {aiRoutine ? 'Regenerar Rutina de Hoy' : 'Generar Rutina de Hoy'}
            </>
          )}
        </button>

        {aiError && (
          <div
            role="alert"
            className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-sm text-rose-200"
          >
            {aiError}
          </div>
        )}

        {/* AI Routine Preview with Warmup + Replace buttons */}
        {aiRoutine && (
          <div className="pt-3 border-t border-white/10 space-y-5">
            <div>
              <h3 className="text-2xl font-extrabold font-display text-white">
                {aiRoutine.title}
              </h3>
              <p className="mt-1 text-sm text-zinc-300 leading-relaxed">
                {aiRoutine.rationale}
              </p>
            </div>

            {aiRoutine.warmup?.length > 0 && (
              <div className="rounded-2xl bg-[#0D0F13] border border-[#222631] p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-[#D4FF33]">
                  <Flame className="w-4 h-4" />
                  Calentamiento específico ({aiRoutine.warmup.length} pasos)
                </div>
                <div className="divide-y divide-white/5">
                  {aiRoutine.warmup.map((w, idx) => (
                    <div
                      key={`${w.name}_${idx}`}
                      className="py-2 flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-zinc-200">{w.name}</span>
                      <span className="font-mono text-xs text-zinc-400 shrink-0">
                        {w.durationOrReps}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2.5">
              {aiRoutine.exercises.map((ex, idx) => (
                <div
                  key={`${ex.name}_${idx}`}
                  className="rounded-2xl border border-[#222631] bg-[#0E1014] p-3.5 flex items-center justify-between gap-2.5"
                >
                  <button
                    type="button"
                    onClick={() =>
                      onInspectExercise({
                        name: ex.name,
                        primaryMuscles: ex.primaryMuscles,
                        secondaryMuscles: ex.secondaryMuscles,
                        notes: ex.notes,
                        previewIdx: idx,
                      })
                    }
                    className="min-w-0 flex-1 text-left group"
                  >
                    <p className="text-sm font-bold text-white truncate group-hover:text-[#D4FF33] transition-colors inline-flex items-center gap-1.5 max-w-full">
                      <span className="truncate">{ex.name}</span>
                      <Info className="w-3.5 h-3.5 text-[#D4FF33] shrink-0" />
                    </p>
                    <p className="text-[11px] font-mono text-[#D4FF33]/90 mt-0.5 truncate">
                      {formatPreviousSessionLine('', ex.name)}
                    </p>
                    <p className="text-xs font-mono tabular-nums text-zinc-400 mt-0.5">
                      {ex.sets} × {ex.reps}
                      {ex.suggestedWeightKg > 0
                        ? ` · ${formatWeight(ex.suggestedWeightKg, weightUnit)}`
                        : ' · Peso corporal'}
                      {' · '}Descanso {ex.restSec}s
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">
                      {ex.primaryMuscles.map((m) => MUSCLE_LABELS[m]).join(' · ')}
                    </p>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onInspectExercise({
                          name: ex.name,
                          primaryMuscles: ex.primaryMuscles,
                          secondaryMuscles: ex.secondaryMuscles,
                          notes: ex.notes,
                          previewIdx: idx,
                        })
                      }
                      aria-label={`Ver técnica y mapa muscular de ${ex.name}`}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-[#2B303C] bg-[#181B23] text-zinc-200 hover:border-[#D4FF33] hover:text-[#D4FF33]"
                    >
                      <Info className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenReplacePreview(idx, ex.name, ex.primaryMuscles)
                      }
                      className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#2B303C] bg-[#181B23] px-3 text-xs font-bold text-[#D4FF33] hover:bg-[#222633]"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                      Reemplazar
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={onStartAiRoutine}
              className="w-full min-h-[56px] flex items-center justify-center gap-3 rounded-2xl bg-white text-base font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
            >
              <Play className="w-5 h-5 fill-current" />
              Comenzar esta rutina
            </button>
          </div>
        )}
      </section>

      {/* Custom Workout Templates ("Mis plantillas personalizadas") */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold font-display text-zinc-200">
              Mis plantillas personalizadas
            </h2>
            <p className="text-xs text-zinc-400">
              Crea, edita, duplica o inicia tus divisiones semanales (PPL,
              Torso/Pierna, Full Body)
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const now = new Date().toISOString();
              setTplSearch('');
              setEditingTemplate({
                id: `tpl_${Date.now()}`,
                name: 'Mi plantilla nueva',
                exercises: [],
                createdAt: now,
                updatedAt: now,
              });
            }}
            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-[#D4FF33]/40 bg-[#151820] px-3.5 text-xs font-bold text-[#D4FF33] hover:border-[#D4FF33] shrink-0"
          >
            <Plus className="w-4 h-4" />
            Nueva plantilla
          </button>
        </div>

        {templateNotice && (
          <p
            role="status"
            className="rounded-2xl border border-[#D4FF33]/40 bg-[#D4FF33]/10 px-3.5 py-2.5 text-xs font-bold text-[#D4FF33]"
          >
            {templateNotice}
          </p>
        )}

        {workoutTemplates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#2A2F3D] bg-[#12141A] p-4 text-xs text-zinc-400 flex flex-wrap items-center justify-between gap-2">
            <span>
              Aún no tienes plantillas guardadas. Crea una o guarda cualquier
              sesión en curso.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {workoutTemplates.map((tpl) => (
              <div
                key={tpl.id}
                className="rounded-2xl border border-[#222631] bg-[#12141A] p-4 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold font-display text-white truncate">
                        {tpl.name}
                      </h3>
                      <p className="text-xs text-zinc-400">
                        {tpl.exercises.length} ejercicios
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDuplicateTemplate(tpl)}
                        aria-label={`Duplicar ${tpl.name}`}
                        title="Duplicar plantilla"
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-[#D4FF33]"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTplSearch('');
                          setEditingTemplate(tpl);
                        }}
                        aria-label={`Editar ${tpl.name}`}
                        title="Editar plantilla"
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <InlineDeleteConfirmButton
                        onConfirm={() => onDeleteTemplate(tpl.id)}
                        ariaLabel={`Eliminar ${tpl.name}`}
                        size="sm"
                      />
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-zinc-400">
                    {tpl.exercises.slice(0, 4).map((ex) => (
                      <li key={ex.id} className="truncate">
                        · {ex.name} ({ex.defaultSets}×{ex.defaultReps})
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  disabled={tpl.exercises.length === 0}
                  onClick={() => onStartTemplate(tpl)}
                  className="w-full min-h-[46px] flex items-center justify-center gap-2 rounded-xl bg-[#D4FF33] disabled:opacity-50 text-xs font-extrabold text-[#0A0B0D] active:scale-[0.98]"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Iniciar plantilla
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Local Quick Splits */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold font-display text-zinc-200">
          Rutinas rápidas sin conexión
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[recommendedRoutine, ...otherRoutines]
            .filter((r): r is BlueprintRoutine => Boolean(r))
            .map((routine) => (
              <div
                key={routine.id}
                className="rounded-2xl border border-[#222631] bg-[#12141A] p-5 flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-xl font-bold font-display text-white">
                      {routine.title}
                    </h3>
                    <span className="font-mono tabular-nums text-xs text-[#D4FF33] shrink-0">
                      {routine.readinessScore}% listo
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">
                    {routine.focusLabel} · {routine.exercises.length} ejercicios
                  </p>
                  <ul className="mt-3 space-y-1 text-xs text-zinc-400">
                    {routine.exercises.slice(0, 3).map((ex) => (
                      <li key={ex.id}>
                        <button
                          type="button"
                          onClick={() =>
                            onInspectExercise({
                              name: ex.name,
                              primaryMuscles: ex.primaryMuscles,
                              secondaryMuscles: ex.secondaryMuscles,
                              notes: ex.instructions,
                            })
                          }
                          className="w-full text-left truncate hover:text-[#D4FF33] inline-flex items-center gap-1.5 py-0.5"
                        >
                          <span className="truncate">· {ex.name}</span>
                          <Info className="w-3 h-3 text-zinc-500 shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onStartBlueprint(routine.title, routine.exercises)
                  }
                  className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-[#1D212B] hover:bg-[#262B38] text-sm font-bold text-white active:scale-[0.98] transition-transform"
                >
                  <Play className="w-4 h-4 text-[#D4FF33]" />
                  Iniciar {routine.title}
                </button>
              </div>
            ))}
        </div>
      </section>

      {/* Custom Template Editor Modal */}
      {editingTemplate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-t-3xl sm:rounded-3xl border border-[#262B36] bg-[#13151A] max-h-[90dvh] flex flex-col">
            <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden" />
            <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-[#D4FF33]">
                  Editor de plantilla
                </p>
                <h3 className="text-xl font-bold font-display text-white">
                  Personaliza tu división
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingTemplate(null)}
                aria-label="Cerrar editor de plantilla"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Nombre de la plantilla
                </label>
                <input
                  type="text"
                  value={editingTemplate.name}
                  onChange={(e) =>
                    setEditingTemplate({
                      ...editingTemplate,
                      name: e.target.value,
                    })
                  }
                  className="w-full min-h-[46px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-sm font-bold text-white focus:border-[#D4FF33] focus:outline-none"
                />
              </div>

              {editingTemplate.exercises.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-[#D4FF33]">
                    Ejercicios ({editingTemplate.exercises.length})
                  </p>
                  {editingTemplate.exercises.map((tex, idx) => (
                    <div
                      key={tex.id}
                      className="rounded-2xl border border-[#222631] bg-[#0E1014] p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-white truncate">
                          {idx + 1}. {tex.name}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingTemplate({
                              ...editingTemplate,
                              exercises: editingTemplate.exercises.filter(
                                (item) => item.id !== tex.id,
                              ),
                            })
                          }
                          aria-label={`Quitar ${tex.name}`}
                          className="text-zinc-500 hover:text-rose-400 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <label className="text-zinc-400">
                          Series
                          <input
                            type="number"
                            min={1}
                            max={10}
                            value={tex.defaultSets}
                            onChange={(e) => {
                              const val = Math.max(
                                1,
                                Math.min(10, Number(e.target.value) || 3),
                              );
                              setEditingTemplate({
                                ...editingTemplate,
                                exercises: editingTemplate.exercises.map(
                                  (item) =>
                                    item.id === tex.id
                                      ? { ...item, defaultSets: val }
                                      : item,
                                ),
                              });
                            }}
                            className="mt-1 w-full min-h-[36px] rounded-xl border border-[#2A2F3D] bg-[#161922] px-2.5 text-white font-mono"
                          />
                        </label>
                        <label className="text-zinc-400">
                          Reps
                          <input
                            type="number"
                            min={1}
                            max={50}
                            value={tex.defaultReps}
                            onChange={(e) => {
                              const val = Math.max(
                                1,
                                Math.min(50, Number(e.target.value) || 10),
                              );
                              setEditingTemplate({
                                ...editingTemplate,
                                exercises: editingTemplate.exercises.map(
                                  (item) =>
                                    item.id === tex.id
                                      ? { ...item, defaultReps: val }
                                      : item,
                                ),
                              });
                            }}
                            className="mt-1 w-full min-h-[36px] rounded-xl border border-[#2A2F3D] bg-[#161922] px-2.5 text-white font-mono"
                          />
                        </label>
                        <label className="text-zinc-400">
                          Descanso (s)
                          <input
                            type="number"
                            min={15}
                            max={300}
                            step={15}
                            value={tex.restSec}
                            onChange={(e) => {
                              const val = Math.max(
                                15,
                                Math.min(300, Number(e.target.value) || 90),
                              );
                              setEditingTemplate({
                                ...editingTemplate,
                                exercises: editingTemplate.exercises.map(
                                  (item) =>
                                    item.id === tex.id
                                      ? { ...item, restSec: val }
                                      : item,
                                ),
                              });
                            }}
                            className="mt-1 w-full min-h-[36px] rounded-xl border border-[#2A2F3D] bg-[#161922] px-2.5 text-white font-mono"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-white/10">
                <p className="text-xs font-bold text-zinc-300">
                  Agregar ejercicios al plan
                </p>
                <input
                  type="text"
                  value={tplSearch}
                  onChange={(e) => setTplSearch(e.target.value)}
                  placeholder="Buscar ejercicio para agregar..."
                  className="w-full min-h-[42px] rounded-xl border border-[#2A2F3D] bg-[#0B0C0F] px-3.5 text-xs text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                />
                <div className="max-h-44 overflow-y-auto space-y-1.5">
                  {availableExercises
                    .filter((def) =>
                      def.name
                        .toLowerCase()
                        .includes(tplSearch.trim().toLowerCase()),
                    )
                    .slice(0, 18)
                    .map((def) => (
                      <button
                        key={def.id}
                        type="button"
                        onClick={() =>
                          setEditingTemplate({
                            ...editingTemplate,
                            exercises: [
                              ...editingTemplate.exercises,
                              {
                                id: `tex_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                                exerciseId: def.id,
                                name: def.name,
                                primaryMuscles: def.primaryMuscles,
                                secondaryMuscles: def.secondaryMuscles,
                                defaultSets: def.defaultSets,
                                defaultReps: def.defaultReps,
                                suggestedWeightKg: def.suggestedWeightKg,
                                restSec: def.defaultRestSec,
                                notes: def.instructions,
                              },
                            ],
                          })
                        }
                        className="w-full min-h-[42px] rounded-xl border border-[#222631] bg-[#181B23] hover:border-[#D4FF33]/60 px-3 py-2 flex items-center justify-between text-left"
                      >
                        <span className="text-xs font-bold text-white truncate">
                          {def.name}
                        </span>
                        <Plus className="w-4 h-4 text-[#D4FF33] shrink-0" />
                      </button>
                    ))}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-white/10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingTemplate(null)}
                className="min-h-[48px] flex-1 rounded-2xl bg-[#1B1E26] text-xs font-bold text-zinc-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  !editingTemplate.name.trim() ||
                  editingTemplate.exercises.length === 0
                }
                onClick={() => {
                  onSaveTemplate({
                    ...editingTemplate,
                    name: editingTemplate.name.trim(),
                    updatedAt: new Date().toISOString(),
                  });
                  setEditingTemplate(null);
                }}
                className="min-h-[48px] flex-1 rounded-2xl bg-[#D4FF33] disabled:opacity-50 text-xs font-extrabold text-[#0A0B0D]"
              >
                Guardar plantilla
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
