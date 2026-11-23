import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Dumbbell,
  Info,
  Loader2,
  MapPin,
  Share2,
  Sparkles,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import {
  EQUIPMENT_OPTIONS,
  generateRecommendedRoutines,
  getFilteredExercises,
  instantiateWorkoutExercises,
} from '../data/exercises';
import {
  fetchWorkoutAlternativesAi,
  generateWorkoutAi,
} from '../lib/aiClient';
import {
  buildRecentLoadsSummary,
  getPreviousExerciseSets,
} from '../lib/analytics';
import { roundToPracticalWeightKg } from '../lib/progressiveOverload';
import {
  connectBluetoothHeartRateMonitor,
  type HeartRateDeviceHandle,
} from '../lib/bluetoothHeartRate';
import {
  computeRecoveryIndex0To100,
  computeSleepPulseIntensityAlert,
} from '../lib/crossModuleIntelligence';
import { resolveDetailedAnatomy } from '../lib/exerciseDemoDb';
import { notifyPushActivity } from '../lib/pushNotifications';
import {
  ALL_MUSCLES,
  MUSCLE_LABELS,
  createInitialMuscleFatigue,
  getDecayedFatigueMap,
} from '../lib/recovery';
import { generateAndShareWorkoutCard } from '../lib/sessionShareCard';
import { getTodayIsoDate } from '../lib/storage';
import {
  describeBandSelection,
  displayWeightToKg,
  formatVolume,
  formatWeight,
  getWeightUnit,
  kgToDisplayWeight,
} from '../lib/units';
import {
  buildExerciseStartCue,
  cancelCoachSpeech,
  isSpeechSupported,
  speakCoachCue,
} from '../lib/voiceCoach';
import type {
  ActiveFastState,
  ActiveWorkout,
  AdaptiveNutritionState,
  AppDatabase,
  BodyCompositionScan,
  BodyWeightEntry,
  CardioActivityType,
  CardioSession,
  DailyReadinessEntry,
  ExerciseDefinition,
  FoodEntry,
  HiitSession,
  HydrationSettings,
  LoadMode,
  MuscleFatigueMap,
  MuscleGroup,
  SetType,
  ShoeGear,
  TabId,
  UserProfile,
  WarmupItem,
  WeightUnit,
  WorkoutExercise,
  WorkoutSession,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '../types/fitness';
import { useHardwareManager } from '../hooks/useHardwareManager';
import {
  ExerciseDemoModal,
  type InspectedExerciseInfo,
} from './ExerciseDemoModal';
import { HiitTimerSection } from './HiitTimerSection';
import { ActiveWorkoutSession } from './entrenar/ActiveWorkoutSession';
import { ExerciseCatalogModal } from './entrenar/ExerciseCatalogModal';
import {
  RestTimerBar,
  computeRemainingSeconds,
  formatSeconds,
  playRestBeep,
  triggerRestCompletionVibration,
} from './entrenar/RestTimerBar';
import {
  type AiGeneratedRoutine,
  RoutineManager,
} from './entrenar/RoutineManager';

const CardioTab = React.lazy(() =>
  import('./CardioTab').then((m) => ({ default: m.CardioTab })),
);

const DarkCardioSkeleton: React.FC = () => (
  <div
    className="space-y-4 animate-pulse"
    aria-busy="true"
    aria-label="Cargando módulo Cardio"
  >
    <div className="h-40 rounded-3xl bg-[#12141A] border border-[#222631]" />
    <div className="h-32 rounded-3xl bg-[#12141A] border border-[#222631]" />
  </div>
);

export interface EntrenarTabProps {
  database?: AppDatabase;
  profile: UserProfile;
  muscleFatigue: MuscleFatigueMap;
  workouts: WorkoutSession[];
  activeWorkout: ActiveWorkout | null;
  lastCompletedSession: WorkoutSession | null;
  cardioSessions?: CardioSession[];
  shoes?: ShoeGear[];
  bodyWeights?: BodyWeightEntry[];
  bodyScans?: BodyCompositionScan[];
  foodLogs?: FoodEntry[];
  hydrationByDate?: Record<string, number>;
  hydrationSettings?: HydrationSettings;
  adaptiveNutrition?: AdaptiveNutritionState | null;
  activeFast?: ActiveFastState | null;
  readinessByDate?: Record<string, DailyReadinessEntry>;
  workoutTemplates?: WorkoutTemplate[];
  hiitSessions?: HiitSession[];
  onStartWorkout: (workout: ActiveWorkout) => void;
  onUpdateActiveWorkout: (workout: ActiveWorkout | null) => void;
  onCompleteWorkout: (workout: ActiveWorkout) => void;
  onDismissSummary: () => void;
  onUpdateProfile: (profile: UserProfile) => void;
  onNavigateTab: (tab: TabId) => void;
  onSaveCardioSession?: (session: CardioSession) => void;
  onDeleteCardioSession?: (id: string) => void;
  onAddShoe?: (name: string, brand?: string) => void;
  onSetActiveShoe?: (id: string) => void;
  onDeleteShoe?: (id: string) => void;
  onSaveReadiness?: (entry: DailyReadinessEntry) => void;
  onSaveTemplate?: (template: WorkoutTemplate) => void;
  onDeleteTemplate?: (id: string) => void;
  onSaveHiitSession?: (session: HiitSession) => void;
  onDeleteHiitSession?: (id: string) => void;
  onAddManualSteps?: (date: string, deltaSteps: number) => void;
  openWalkSignal?: number;
  onOpenSleep?: () => void;
  onOpenPulse?: () => void;
}

interface AiAlternativeOption {
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  suggestedWeightKg: number;
  reps: number;
  restSec: number;
  reason: string;
}

export const EntrenarTab: React.FC<EntrenarTabProps> = ({
  database,
  profile,
  muscleFatigue,
  workouts,
  activeWorkout,
  lastCompletedSession,
  cardioSessions = [],
  shoes = [],
  bodyWeights = [],
  bodyScans = [],
  foodLogs = [],
  hydrationByDate = {},
  hydrationSettings,
  adaptiveNutrition,
  activeFast = null,
  readinessByDate = {},
  workoutTemplates = [],
  hiitSessions = [],
  onStartWorkout,
  onUpdateActiveWorkout,
  onCompleteWorkout,
  onDismissSummary,
  onUpdateProfile,
  onNavigateTab,
  onSaveCardioSession = () => {},
  onDeleteCardioSession = () => {},
  onAddShoe = () => {},
  onSetActiveShoe = () => {},
  onDeleteShoe = () => {},
  onSaveReadiness = () => {},
  onSaveTemplate = () => {},
  onDeleteTemplate = () => {},
  onSaveHiitSession = () => {},
  onDeleteHiitSession = () => {},
  onAddManualSteps: _onAddManualSteps,
  openWalkSignal = 0,
  onOpenSleep,
  onOpenPulse,
}) => {
  const [subTab, setSubTab] = useState<'fuerza' | 'hiit' | 'cardio'>('fuerza');
  const [requestedCardioActivity, setRequestedCardioActivity] =
    useState<CardioActivityType | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [restRemaining, setRestRemaining] = useState<number | null>(null);
  const [restTotal, setRestTotal] = useState(profile.preferredRestSec ?? 90);
  const [restTargetEndTime, setRestTargetEndTime] = useState<number | null>(
    null,
  );
  const [restPaused, setRestPaused] = useState(false);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const hardware = useHardwareManager();
  const [setWeightDrafts, setSetWeightDrafts] = useState<
    Record<string, string>
  >({});
  const [savedTemplateBanner, setSavedTemplateBanner] = useState<string | null>(
    null,
  );
  const [isGeneratingWorkoutCard, setIsGeneratingWorkoutCard] = useState(false);
  const [workoutCardFeedback, setWorkoutCardFeedback] = useState<string | null>(
    null,
  );
  const [workoutCardPreviewUrl, setWorkoutCardPreviewUrl] = useState<
    string | null
  >(null);

  // Live BLE Heart Rate Monitor state for Strength
  const [hrBpm, setHrBpm] = useState<number | null>(null);
  const [hrDeviceName, setHrDeviceName] = useState<string | null>(null);
  const [hrError, setHrError] = useState<string | null>(null);
  const [isConnectingHr, setIsConnectingHr] = useState(false);
  const hrHandleRef = useRef<HeartRateDeviceHandle | null>(null);

  const weightUnit: WeightUnit = getWeightUnit(profile.weightUnit);
  const todayIso = new Date().toLocaleDateString('en-CA');
  const todayReadiness = readinessByDate[todayIso] ?? null;

  // AI Fitbod routine generator state
  const [aiRoutine, setAiRoutine] = useState<AiGeneratedRoutine | null>(null);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Replace exercise modal state (works for both AI preview & live workout)
  const [replaceTarget, setReplaceTarget] = useState<{
    mode: 'preview' | 'active';
    exIdx: number;
    name: string;
    primaryMuscles: MuscleGroup[];
  } | null>(null);
  const [aiAlternatives, setAiAlternatives] = useState<AiAlternativeOption[]>(
    [],
  );
  const [isLoadingAlternatives, setIsLoadingAlternatives] = useState(false);
  const [alternativesError, setAlternativesError] = useState<string | null>(
    null,
  );

  // Audio Voice Coach state
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [lastSpokenCue, setLastSpokenCue] = useState<string | null>(null);
  const [activeExerciseIdx, setActiveExerciseIdx] = useState(0);

  // Technique & Muscle Map modal state
  const [inspectedExercise, setInspectedExercise] = useState<
    (InspectedExerciseInfo & { activeIdx?: number; previewIdx?: number }) | null
  >(null);

  const restEndRef = useRef<number | null>(null);
  const pausedRestMsRef = useRef<number>(0);
  const tenSecWarnedRef = useRef(false);
  const restContextRef = useRef<{
    nextSetNum: number;
    exerciseName: string;
    nextExercise?: WorkoutExercise;
  } | null>(null);

  const [activeRpePrompt, setActiveRpePrompt] = useState<{
    exIdx: number;
    setIdx: number;
  } | null>(null);
  const [overloadAppliedNote, setOverloadAppliedNote] = useState<
    Record<string, string>
  >({});

  const autoStartRest = profile.autoStartRest ?? true;
  const preferredRestSec = profile.preferredRestSec ?? 90;
  const voiceCoachEnabled = profile.voiceCoachEnabled ?? true;
  const rpeTrackingEnabled = profile.rpeTrackingEnabled !== false;
  const speechAvailable = isSpeechSupported();

  const decayedFatigue = useMemo(
    () => getDecayedFatigueMap(muscleFatigue),
    [muscleFatigue],
  );

  const effectiveDatabase = useMemo<AppDatabase>(
    () =>
      database ?? {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        profile,
        muscleFatigue: muscleFatigue ?? createInitialMuscleFatigue(),
        activeWorkout,
        workouts,
        cardioSessions,
        shoes,
        bodyWeights,
        bodyScans,
        readinessByDate,
        foodLogs,
        hydrationByDate,
        hiitSessions,
      },
    [
      database,
      profile,
      muscleFatigue,
      activeWorkout,
      workouts,
      cardioSessions,
      shoes,
      bodyWeights,
      bodyScans,
      readinessByDate,
      foodLogs,
      hydrationByDate,
      hiitSessions,
    ],
  );

  useEffect(() => {
    if (openWalkSignal > 0) {
      setRequestedCardioActivity('caminar');
      setSubTab('cardio');
    }
  }, [openWalkSignal]);

  const routines = useMemo(
    () => generateRecommendedRoutines(profile, decayedFatigue),
    [profile, decayedFatigue],
  );
  const availableExercises = useMemo(
    () => getFilteredExercises(profile.equipment),
    [profile.equipment],
  );

  const freshestMuscles = useMemo(() => {
    return [...ALL_MUSCLES]
      .sort((a, b) => (decayedFatigue[a] ?? 0) - (decayedFatigue[b] ?? 0))
      .slice(0, 3);
  }, [decayedFatigue]);

  useEffect(() => {
    setWorkoutCardFeedback(null);
    setWorkoutCardPreviewUrl(null);
  }, [lastCompletedSession?.id]);

  const handleGenerateWorkoutCard = async () => {
    if (!lastCompletedSession || isGeneratingWorkoutCard) return;
    setIsGeneratingWorkoutCard(true);
    setWorkoutCardFeedback(null);
    try {
      const result = await generateAndShareWorkoutCard({
        session: lastCompletedSession,
        profile,
      });
      setWorkoutCardPreviewUrl(result.dataUrl);
      setWorkoutCardFeedback(
        result.status === 'shared'
          ? 'Tarjeta compartida correctamente.'
          : 'Tarjeta PNG descargada en tu dispositivo.',
      );
    } catch {
      setWorkoutCardFeedback('No se pudo generar la tarjeta resumen.');
    } finally {
      setIsGeneratingWorkoutCard(false);
    }
  };

  const speakAndRemember = (
    text: string,
    overrideEnabled?: boolean,
    overrideMuted?: boolean,
  ) => {
    setLastSpokenCue(text);
    speakCoachCue(text, {
      enabled: overrideEnabled ?? voiceCoachEnabled,
      muted: overrideMuted ?? isAudioMuted,
      preferredVoiceUri: profile.preferredVoiceUri,
    });
  };

  const announceExerciseStart = (
    exIdx: number,
    exercisesList?: WorkoutExercise[],
    overrideEnabled?: boolean,
  ) => {
    const list = exercisesList ?? activeWorkout?.exercises ?? [];
    const target = list[exIdx];
    if (!target) return;
    setActiveExerciseIdx(exIdx);
    const cue = buildExerciseStartCue(target, weightUnit);
    speakAndRemember(cue, overrideEnabled);
  };

  // Elapsed workout timer (wall-clock timestamps + visibilitychange sync)
  useEffect(() => {
    if (!activeWorkout) {
      setElapsedSec(0);
      setRestRemaining(null);
      setRestTargetEndTime(null);
      setRestPaused(false);
      restEndRef.current = null;
      pausedRestMsRef.current = 0;
      restContextRef.current = null;
      tenSecWarnedRef.current = false;
      setActiveExerciseIdx(0);
      setSetWeightDrafts({});
      setActiveRpePrompt(null);
      setOverloadAppliedNote({});
      cancelCoachSpeech();
      return undefined;
    }

    const update = () => {
      const startMs = Date.parse(activeWorkout.startedAt);
      if (!Number.isNaN(startMs)) {
        setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        update();
      }
    };
    update();
    const id = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeWorkout]);

  // Rest countdown timer (absolute targetEndTime + visibilitychange sync + 10s warning + sound + vibration + voice cue)
  useEffect(() => {
    if (restRemaining === null || restPaused) return undefined;

    const syncRestCountdown = () => {
      if (restEndRef.current === null) return;
      const diff = computeRemainingSeconds(restEndRef.current);
      if (diff <= 0) {
        restEndRef.current = null;
        pausedRestMsRef.current = 0;
        tenSecWarnedRef.current = false;
        setRestTargetEndTime(null);
        setRestPaused(false);
        setRestRemaining(null);
        playRestBeep();
        triggerRestCompletionVibration();

        const ctx = restContextRef.current;
        restContextRef.current = null;
        if (ctx?.nextExercise) {
          const cue = buildExerciseStartCue(ctx.nextExercise, weightUnit);
          speakAndRemember(cue);
        } else if (ctx) {
          speakAndRemember(
            `¡Tiempo! Comienza la serie ${ctx.nextSetNum} de ${ctx.exerciseName}.`,
          );
        } else {
          speakAndRemember(
            '¡Tiempo de descanso terminado! Comienza la siguiente serie.',
          );
        }
      } else {
        if (diff <= 10 && !tenSecWarnedRef.current) {
          tenSecWarnedRef.current = true;
          speakAndRemember('Diez segundos. Prepárate para la siguiente serie.');
        }
        setRestRemaining(diff);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncRestCountdown();
      }
    };

    syncRestCountdown();
    const id = window.setInterval(syncRestCountdown, 250);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    restRemaining !== null,
    restPaused,
    voiceCoachEnabled,
    isAudioMuted,
    weightUnit,
  ]);

  const startRestTimer = (
    seconds: number,
    context?: {
      nextSetNum: number;
      exerciseName: string;
      nextExercise?: WorkoutExercise;
    },
  ) => {
    const safeSec = Math.max(15, seconds);
    const remainingMs = safeSec * 1000;
    const targetEndTime = Date.now() + remainingMs;
    setRestTotal(safeSec);
    restEndRef.current = targetEndTime;
    pausedRestMsRef.current = remainingMs;
    tenSecWarnedRef.current = safeSec <= 10;
    restContextRef.current = context ?? null;
    setRestPaused(false);
    setRestTargetEndTime(targetEndTime);
    setRestRemaining(safeSec);
  };

  const togglePauseRestTimer = () => {
    if (restRemaining === null) return;
    if (!restPaused) {
      const remainingMs =
        restEndRef.current !== null
          ? Math.max(0, restEndRef.current - Date.now())
          : restRemaining * 1000;
      pausedRestMsRef.current = remainingMs;
      restEndRef.current = null;
      setRestTargetEndTime(null);
      setRestPaused(true);
      setRestRemaining(Math.max(0, Math.ceil(remainingMs / 1000)));
    } else {
      const remainingMs = Math.max(0, pausedRestMsRef.current);
      if (remainingMs <= 0) {
        restEndRef.current = null;
        pausedRestMsRef.current = 0;
        restContextRef.current = null;
        tenSecWarnedRef.current = false;
        setRestTargetEndTime(null);
        setRestPaused(false);
        setRestRemaining(null);
        return;
      }
      const targetEndTime = Date.now() + remainingMs;
      restEndRef.current = targetEndTime;
      setRestTargetEndTime(targetEndTime);
      setRestPaused(false);
      setRestRemaining(computeRemainingSeconds(targetEndTime));
    }
  };

  const adjustRestTimer = (delta: number) => {
    if (restRemaining === null) return;
    const baseMs = restPaused
      ? pausedRestMsRef.current
      : restEndRef.current !== null
        ? Math.max(0, restEndRef.current - Date.now())
        : 0;
    const nextMs = Math.max(0, baseMs + delta * 1000);
    const nextSec = Math.ceil(nextMs / 1000);
    if (nextSec <= 0) {
      restEndRef.current = null;
      pausedRestMsRef.current = 0;
      restContextRef.current = null;
      tenSecWarnedRef.current = false;
      setRestTargetEndTime(null);
      setRestPaused(false);
      setRestRemaining(null);
    } else if (restPaused) {
      pausedRestMsRef.current = nextMs;
      if (nextSec > 10) tenSecWarnedRef.current = false;
      setRestRemaining(nextSec);
    } else {
      const targetEndTime = Date.now() + nextMs;
      restEndRef.current = targetEndTime;
      if (nextSec > 10) tenSecWarnedRef.current = false;
      setRestTargetEndTime(targetEndTime);
      setRestRemaining(nextSec);
    }
  };

  const restartRestTimer = () => {
    const safeTotal = Math.max(15, restTotal || preferredRestSec);
    const remainingMs = safeTotal * 1000;
    const targetEndTime = Date.now() + remainingMs;
    restEndRef.current = targetEndTime;
    pausedRestMsRef.current = remainingMs;
    tenSecWarnedRef.current = safeTotal <= 10;
    setRestPaused(false);
    setRestTargetEndTime(targetEndTime);
    setRestRemaining(safeTotal);
  };

  const handleSkipRest = () => {
    if (restRemaining === null) return;
    const ctx = restContextRef.current;
    restEndRef.current = null;
    pausedRestMsRef.current = 0;
    restContextRef.current = null;
    tenSecWarnedRef.current = false;
    setRestTargetEndTime(null);
    setRestPaused(false);
    setRestRemaining(null);
    if (ctx?.nextExercise) {
      speakAndRemember(buildExerciseStartCue(ctx.nextExercise, weightUnit));
    } else if (ctx) {
      speakAndRemember(
        `Descanso omitido. Comienza la serie ${ctx.nextSetNum} de ${ctx.exerciseName}.`,
      );
    } else {
      speakAndRemember('Descanso omitido. Comienza la siguiente serie.');
    }
  };

  const handleRepeatCue = () => {
    if (lastSpokenCue) {
      speakAndRemember(lastSpokenCue, true, false);
      if (isAudioMuted) setIsAudioMuted(false);
    } else if (activeWorkout?.exercises[activeExerciseIdx]) {
      const cue = buildExerciseStartCue(
        activeWorkout.exercises[activeExerciseIdx],
        weightUnit,
      );
      speakAndRemember(cue, true, false);
      if (isAudioMuted) setIsAudioMuted(false);
    }
  };

  // Clean up BLE HR monitor on unmount
  useEffect(() => {
    return () => {
      hrHandleRef.current?.disconnect();
    };
  }, []);

  const handleToggleHeartRate = async () => {
    if (hrHandleRef.current) {
      hrHandleRef.current.disconnect();
      hrHandleRef.current = null;
      setHrDeviceName(null);
      setHrBpm(null);
      return;
    }
    setHrError(null);
    setIsConnectingHr(true);
    try {
      const handle = await connectBluetoothHeartRateMonitor(
        (bpm) => setHrBpm(bpm),
        () => {
          hrHandleRef.current = null;
          setHrDeviceName(null);
          setHrBpm(null);
        },
      );
      hrHandleRef.current = handle;
      setHrDeviceName(handle.deviceName);
    } catch (err) {
      setHrError(
        err instanceof Error
          ? err.message
          : 'No se pudo conectar la banda cardíaca BLE.',
      );
    } finally {
      setIsConnectingHr(false);
    }
  };

  const handleGenerateAiRoutine = async () => {
    setIsGeneratingAi(true);
    setAiError(null);
    try {
      const recentLoads = buildRecentLoadsSummary(workouts);
      const data = await generateWorkoutAi<AiGeneratedRoutine>({
        profile,
        fatigueMap: decayedFatigue,
        recentLoads,
        readiness: todayReadiness,
      });
      setAiRoutine(data);
    } catch (err) {
      setAiError(
        err instanceof Error
          ? err.message
          : 'Error de conexión al generar rutina con Gemini.',
      );
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const openReplaceModal = async (
    mode: 'preview' | 'active',
    exIdx: number,
    name: string,
    primaryMuscles: MuscleGroup[],
  ) => {
    setReplaceTarget({ mode, exIdx, name, primaryMuscles });
    setAiAlternatives([]);
    setAlternativesError(null);
    setIsLoadingAlternatives(true);

    try {
      const data = await fetchWorkoutAlternativesAi<{
        alternatives?: AiAlternativeOption[];
      }>({
        exerciseName: name,
        primaryMuscles,
        equipment: profile.equipment,
        weightUnit,
      });
      setAiAlternatives(
        Array.isArray(data?.alternatives) ? data.alternatives : [],
      );
    } catch (err) {
      setAlternativesError(
        err instanceof Error
          ? err.message
          : 'Sin conexión a Gemini; puedes elegir una variante local compatible.',
      );
    } finally {
      setIsLoadingAlternatives(false);
    }
  };

  const applyReplacement = (variant: {
    name: string;
    primaryMuscles: MuscleGroup[];
    secondaryMuscles: MuscleGroup[];
    suggestedWeightKg: number;
    reps: number;
    restSec: number;
    exerciseId?: string;
  }) => {
    if (!replaceTarget) return;

    const anatomy = resolveDetailedAnatomy(
      variant.name,
      variant.primaryMuscles,
      variant.secondaryMuscles,
    );

    if (replaceTarget.mode === 'preview' && aiRoutine) {
      const nextExercises = aiRoutine.exercises.map((ex, i) =>
        i === replaceTarget.exIdx
          ? {
              ...ex,
              name: variant.name,
              primaryMuscles: anatomy.recoveredPrimary,
              secondaryMuscles: anatomy.recoveredSecondary,
              suggestedWeightKg: variant.suggestedWeightKg,
              reps: variant.reps,
              restSec: variant.restSec,
            }
          : ex,
      );
      setAiRoutine({ ...aiRoutine, exercises: nextExercises });
    } else if (replaceTarget.mode === 'active' && activeWorkout) {
      const nextExercises = activeWorkout.exercises.map((ex, i) => {
        if (i !== replaceTarget.exIdx) return ex;
        return {
          ...ex,
          exerciseId:
            variant.exerciseId ??
            `ai_${variant.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
          name: variant.name,
          primaryMuscles: anatomy.recoveredPrimary,
          secondaryMuscles: anatomy.recoveredSecondary,
          restSec: variant.restSec || ex.restSec,
          sets: ex.sets.map((s) => ({
            ...s,
            weightKg: variant.suggestedWeightKg,
            reps: variant.reps || s.reps,
            completed: false,
          })),
        };
      });
      onUpdateActiveWorkout({ ...activeWorkout, exercises: nextExercises });
    }

    setReplaceTarget(null);
  };

  const handleStartAiRoutine = () => {
    if (!aiRoutine) return;
    const warmupItems: WarmupItem[] = (aiRoutine.warmup ?? []).map((w, idx) => ({
      id: `wu_${Date.now()}_${idx}`,
      name: w.name,
      durationOrReps: w.durationOrReps,
      completed: false,
    }));

    const exercises: WorkoutExercise[] = aiRoutine.exercises.map((ex, idx) => {
      const prev = getPreviousExerciseSets(workouts, '', ex.name);
      const baseWeight = prev?.sets[0]?.weightKg ?? ex.suggestedWeightKg ?? 0;
      const setCount = Math.max(1, Math.min(8, ex.sets || 3));
      const repCount = Math.max(1, ex.reps || 10);
      const anatomy = resolveDetailedAnatomy(
        ex.name,
        ex.primaryMuscles.length > 0 ? ex.primaryMuscles : ['pecho'],
        ex.secondaryMuscles ?? [],
      );

      return {
        id: `we_ai_${Date.now()}_${idx}`,
        exerciseId: `ai_${ex.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        name: ex.name,
        primaryMuscles: anatomy.recoveredPrimary,
        secondaryMuscles: anatomy.recoveredSecondary,
        restSec: ex.restSec || preferredRestSec,
        notes: ex.notes,
        sets: Array.from({ length: setCount }, (_, sIdx) => ({
          id: `set_ai_${Date.now()}_${idx}_${sIdx}`,
          weightKg: prev?.sets[sIdx]?.weightKg ?? baseWeight,
          reps: prev?.sets[sIdx]?.reps ?? repCount,
          rpe: 8,
          completed: false,
        })),
      };
    });

    onStartWorkout({
      id: `wk_ai_${Date.now()}`,
      title: aiRoutine.title,
      rationale: aiRoutine.rationale,
      warmup: warmupItems,
      startedAt: new Date().toISOString(),
      exercises,
      isAiGenerated: true,
    });
    setAiRoutine(null);
    if (exercises.length > 0) {
      announceExerciseStart(0, exercises);
    }
  };

  const handleStartBlueprint = (title: string, defs: ExerciseDefinition[]) => {
    const baseExercises = instantiateWorkoutExercises(defs, profile);
    const enriched = baseExercises.map((ex) => {
      const prev = getPreviousExerciseSets(workouts, ex.exerciseId, ex.name);
      return {
        ...ex,
        restSec: preferredRestSec || ex.restSec,
        sets: ex.sets.map((s, sIdx) => ({
          ...s,
          weightKg:
            prev?.sets[sIdx]?.weightKg ?? prev?.sets[0]?.weightKg ?? s.weightKg,
          reps: prev?.sets[sIdx]?.reps ?? s.reps,
          rpe: 8,
        })),
      };
    });

    onStartWorkout({
      id: `wk_${Date.now()}`,
      title,
      startedAt: new Date().toISOString(),
      exercises: enriched,
    });
    if (enriched.length > 0) {
      announceExerciseStart(0, enriched);
    }
  };

  const handleStartTemplate = (tpl: WorkoutTemplate) => {
    const exercises: WorkoutExercise[] = tpl.exercises.map((tex, idx) => {
      const prev = getPreviousExerciseSets(workouts, tex.exerciseId, tex.name);
      const useBands = tex.loadMode === 'bands' || prev?.loadMode === 'bands';
      const bandCfg = tex.bandConfig ?? prev?.bandConfig;
      const count = Math.max(1, Math.min(8, tex.defaultSets || 3));
      const baseWeight =
        useBands && bandCfg
          ? bandCfg.totalKg
          : (prev?.sets[0]?.weightKg ?? tex.suggestedWeightKg ?? 0);
      return {
        id: `we_tpl_${Date.now()}_${idx}`,
        exerciseId: tex.exerciseId,
        name: tex.name,
        primaryMuscles: tex.primaryMuscles,
        secondaryMuscles: tex.secondaryMuscles,
        restSec: tex.restSec || preferredRestSec,
        notes: tex.notes,
        loadMode: useBands ? 'bands' : 'weights',
        bandConfig: bandCfg,
        supersetGroupId: tex.supersetGroupId ?? null,
        sets: Array.from({ length: count }, (_, sIdx) => ({
          id: `set_tpl_${Date.now()}_${idx}_${sIdx}`,
          weightKg:
            useBands && bandCfg
              ? bandCfg.totalKg
              : (prev?.sets[sIdx]?.weightKg ?? baseWeight),
          reps: prev?.sets[sIdx]?.reps ?? tex.defaultReps,
          rpe: 8,
          setType: 'normal' as SetType,
          completed: false,
          ...(useBands && bandCfg ? { bandLabel: bandCfg.label } : {}),
        })),
      };
    });

    onStartWorkout({
      id: `wk_tpl_${Date.now()}`,
      title: tpl.name,
      startedAt: new Date().toISOString(),
      exercises,
    });
    if (exercises.length > 0) {
      announceExerciseStart(0, exercises);
    }
  };

  const handleSaveActiveAsTemplate = () => {
    if (!activeWorkout || activeWorkout.exercises.length === 0) return;
    const nowIso = new Date().toISOString();
    const localDay = new Date().toLocaleDateString('en-CA');
    const tplExercises: WorkoutTemplateExercise[] = activeWorkout.exercises.map(
      (ex, idx) => {
        const workingSets = ex.sets.filter((s) => s.setType !== 'warmup');
        const refSet = workingSets[0] ?? ex.sets[0];
        return {
          id: `tex_${Date.now()}_${idx}`,
          exerciseId: ex.exerciseId,
          name: ex.name,
          primaryMuscles: ex.primaryMuscles,
          secondaryMuscles: ex.secondaryMuscles,
          defaultSets: Math.max(1, workingSets.length || ex.sets.length),
          defaultReps: refSet?.reps ?? 10,
          suggestedWeightKg: refSet?.weightKg ?? 0,
          restSec: ex.restSec || preferredRestSec,
          notes: ex.notes,
          loadMode: ex.loadMode,
          bandConfig: ex.bandConfig,
          supersetGroupId: ex.supersetGroupId ?? null,
        };
      },
    );

    const newTpl: WorkoutTemplate = {
      id: `tpl_${Date.now()}`,
      name:
        activeWorkout.title === 'Rutina libre'
          ? `Plantilla ${localDay}`
          : activeWorkout.title,
      exercises: tplExercises,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    onSaveTemplate(newTpl);
    setSavedTemplateBanner(`"${newTpl.name}" guardada en Mis Plantillas.`);
    window.setTimeout(() => setSavedTemplateBanner(null), 3200);
  };

  const handleStartEmpty = () => {
    onStartWorkout({
      id: `wk_${Date.now()}`,
      title: 'Rutina libre',
      startedAt: new Date().toISOString(),
      exercises: [],
    });
    setShowExercisePicker(true);
  };

  const toggleWarmupItem = (wuId: string) => {
    if (!activeWorkout?.warmup) return;
    onUpdateActiveWorkout({
      ...activeWorkout,
      warmup: activeWorkout.warmup.map((w) =>
        w.id === wuId ? { ...w, completed: !w.completed } : w,
      ),
    });
  };

  const toggleSupersetWithNext = (exIdx: number) => {
    if (!activeWorkout || exIdx >= activeWorkout.exercises.length - 1) return;
    const cur = activeWorkout.exercises[exIdx];
    const next = activeWorkout.exercises[exIdx + 1];
    const sharedId = cur.supersetGroupId;

    if (sharedId && next.supersetGroupId === sharedId) {
      const prev = exIdx > 0 ? activeWorkout.exercises[exIdx - 1] : null;
      const keepCur = prev?.supersetGroupId === sharedId;
      const nextExercises = activeWorkout.exercises.map((ex, i) => {
        if (i === exIdx && !keepCur) return { ...ex, supersetGroupId: null };
        if (i === exIdx + 1) return { ...ex, supersetGroupId: null };
        return ex;
      });
      onUpdateActiveWorkout({ ...activeWorkout, exercises: nextExercises });
    } else {
      const groupId = sharedId || next.supersetGroupId || `ss_${Date.now()}`;
      const nextExercises = activeWorkout.exercises.map((ex, i) =>
        i === exIdx || i === exIdx + 1 ? { ...ex, supersetGroupId: groupId } : ex,
      );
      onUpdateActiveWorkout({ ...activeWorkout, exercises: nextExercises });
    }
  };

  const applyProgressiveOverloadToExercise = (
    exIdx: number,
    options: {
      deltaWeightKg?: number;
      deltaReps?: number;
      deltaSets?: number;
      nextBandLevelIds?: string[];
      deloadFactor?: number;
      feedbackLabel?: string;
    },
  ) => {
    if (!activeWorkout) return;
    const targetEx = activeWorkout.exercises[exIdx];
    if (!targetEx) return;

    const nextExercises = activeWorkout.exercises.map((ex, ei) => {
      if (ei !== exIdx) return ex;

      if (options.nextBandLevelIds && options.nextBandLevelIds.length > 0) {
        const bandInfo = describeBandSelection(
          options.nextBandLevelIds,
          weightUnit,
        );
        return {
          ...ex,
          loadMode: 'bands' as LoadMode,
          bandConfig: {
            levelIds: options.nextBandLevelIds,
            label: bandInfo.label,
            totalKg: bandInfo.totalKg,
          },
          sets: ex.sets.map((s) =>
            s.completed
              ? s
              : {
                  ...s,
                  weightKg: bandInfo.totalKg,
                  bandLabel: bandInfo.label,
                },
          ),
        };
      }

      if (options.deltaSets && options.deltaSets > 0) {
        const refSet = ex.sets[ex.sets.length - 1];
        const extraSets = Array.from({ length: options.deltaSets }, (_, k) => ({
          id: `set_prog_${Date.now()}_${ex.sets.length + k}`,
          weightKg:
            ex.loadMode === 'bands' && ex.bandConfig
              ? ex.bandConfig.totalKg
              : (refSet?.weightKg ?? 20),
          reps: refSet?.reps ?? 10,
          rpe: refSet?.rpe ?? 8,
          setType: 'normal' as SetType,
          completed: false,
          ...(ex.loadMode === 'bands' && ex.bandConfig
            ? { bandLabel: ex.bandConfig.label }
            : {}),
        }));
        return {
          ...ex,
          sets: [...ex.sets, ...extraSets],
        };
      }

      if (options.deloadFactor && options.deloadFactor < 1) {
        const factor = options.deloadFactor;
        const hasWeighted =
          ex.loadMode !== 'bands' &&
          ex.sets.some((s) => !s.completed && s.weightKg > 0);
        if (hasWeighted) {
          return {
            ...ex,
            sets: ex.sets.map((s) => {
              if (s.completed || s.setType === 'warmup' || s.weightKg <= 0)
                return s;
              const reducedKg = roundToPracticalWeightKg(
                s.weightKg * factor,
                weightUnit,
                s.weightKg,
              );
              return { ...s, weightKg: reducedKg };
            }),
          };
        }
        let updatedSets = ex.sets.map((s) =>
          s.completed || s.setType === 'warmup'
            ? s
            : { ...s, reps: Math.max(1, Math.round(s.reps * factor)) },
        );
        if (updatedSets.length > 1) {
          const lastPendingIdx = [...updatedSets]
            .reverse()
            .findIndex((s) => !s.completed && s.setType !== 'warmup');
          if (lastPendingIdx >= 0) {
            const removeAt = updatedSets.length - 1 - lastPendingIdx;
            updatedSets = updatedSets.filter((_, idx) => idx !== removeAt);
          }
        }
        return { ...ex, sets: updatedSets };
      }

      const dKg = options.deltaWeightKg ?? 0;
      const dReps = options.deltaReps ?? 0;
      return {
        ...ex,
        sets: ex.sets.map((s) =>
          s.completed || s.setType === 'warmup'
            ? s
            : {
                ...s,
                weightKg:
                  dKg > 0
                    ? Math.round((s.weightKg + dKg) * 10) / 10
                    : s.weightKg,
                reps: Math.max(1, s.reps + dReps),
              },
        ),
      };
    });

    onUpdateActiveWorkout({ ...activeWorkout, exercises: nextExercises });
    if (options.feedbackLabel) {
      setOverloadAppliedNote((prev) => ({
        ...prev,
        [targetEx.id]: options.feedbackLabel!,
      }));
    }
  };

  const updateSetField = (
    exIdx: number,
    setIdx: number,
    patch: {
      weightKg?: number;
      reps?: number;
      rpe?: number;
      completed?: boolean;
      setType?: SetType;
    },
  ) => {
    if (!activeWorkout) return;
    const nextExercises = activeWorkout.exercises.map((ex, ei) => {
      if (ei !== exIdx) return ex;
      const nextSets = ex.sets.map((s, si) => {
        if (si !== setIdx) return s;
        const resolvedWeightKg =
          ex.loadMode === 'bands' &&
          ex.bandConfig &&
          patch.completed === true &&
          s.weightKg <= 0
            ? ex.bandConfig.totalKg
            : Math.max(0, patch.weightKg ?? s.weightKg);
        const resolvedBandLabel =
          ex.loadMode === 'bands' && ex.bandConfig
            ? (s.bandLabel ?? ex.bandConfig.label)
            : s.bandLabel;
        return {
          ...s,
          ...patch,
          weightKg: resolvedWeightKg,
          reps: Math.max(0, patch.reps ?? s.reps),
          rpe:
            patch.rpe !== undefined
              ? Math.max(1, Math.min(10, patch.rpe))
              : (s.rpe ?? 8),
          ...(resolvedBandLabel ? { bandLabel: resolvedBandLabel } : {}),
        };
      });
      return { ...ex, sets: nextSets };
    });

    if (patch.completed === true) {
      if (rpeTrackingEnabled) {
        setActiveRpePrompt({ exIdx, setIdx });
      }
      const updatedExercise = nextExercises[exIdx];
      const restSeconds = preferredRestSec || updatedExercise.restSec || 90;

      const ssId = updatedExercise.supersetGroupId;
      const supersetPartnerIdx = ssId
        ? nextExercises.findIndex(
            (other, idx) =>
              idx !== exIdx &&
              other.supersetGroupId === ssId &&
              other.sets.some((s) => !s.completed),
          )
        : -1;

      if (supersetPartnerIdx !== -1 && supersetPartnerIdx > exIdx) {
        const partner = nextExercises[supersetPartnerIdx];
        setActiveExerciseIdx(supersetPartnerIdx);
        speakAndRemember(`Superserie: pasa directo a ${partner.name}.`);
      } else {
        const nextUncompletedIdx = updatedExercise.sets.findIndex(
          (s) => !s.completed,
        );
        if (nextUncompletedIdx !== -1) {
          setActiveExerciseIdx(exIdx);
          if (autoStartRest) {
            startRestTimer(restSeconds, {
              nextSetNum: nextUncompletedIdx + 1,
              exerciseName: updatedExercise.name,
            });
            speakAndRemember(
              `Serie ${setIdx + 1} completada. Descansa ${restSeconds} segundos.`,
            );
          } else {
            speakAndRemember(`Serie ${setIdx + 1} completada.`);
          }
        } else {
          const nextExercise = nextExercises[exIdx + 1];
          if (nextExercise) {
            setActiveExerciseIdx(exIdx + 1);
            if (autoStartRest) {
              startRestTimer(restSeconds, {
                nextSetNum: 1,
                exerciseName: nextExercise.name,
                nextExercise,
              });
              speakAndRemember(
                `Ejercicio completado. Descansa ${restSeconds} segundos antes de pasar a ${nextExercise.name}.`,
              );
            } else {
              announceExerciseStart(exIdx + 1, nextExercises);
            }
          } else {
            speakAndRemember(
              `Última serie de ${updatedExercise.name} completada. Excelente trabajo.`,
            );
          }
        }
      }
    } else if (patch.completed === false) {
      if (
        activeRpePrompt?.exIdx === exIdx &&
        activeRpePrompt?.setIdx === setIdx
      ) {
        setActiveRpePrompt(null);
      }
    }

    onUpdateActiveWorkout({ ...activeWorkout, exercises: nextExercises });
  };

  const handleSelectRpeOneTap = (
    exIdx: number,
    setIdx: number,
    rpeVal: number,
  ) => {
    updateSetField(exIdx, setIdx, { rpe: rpeVal });
    setActiveRpePrompt(null);
  };

  const setExerciseLoadMode = (exIdx: number, mode: LoadMode) => {
    if (!activeWorkout) return;
    const nextExercises = activeWorkout.exercises.map((ex, ei) => {
      if (ei !== exIdx) return ex;
      if (mode === 'bands') {
        const currentIds = ex.bandConfig?.levelIds ?? ['media'];
        const bandInfo = describeBandSelection(currentIds, weightUnit);
        return {
          ...ex,
          loadMode: 'bands' as LoadMode,
          bandConfig: {
            levelIds: currentIds,
            label: bandInfo.label,
            totalKg: bandInfo.totalKg,
          },
          sets: ex.sets.map((s) =>
            s.completed
              ? s
              : { ...s, weightKg: bandInfo.totalKg, bandLabel: bandInfo.label },
          ),
        };
      }
      return {
        ...ex,
        loadMode: 'weights' as LoadMode,
      };
    });
    onUpdateActiveWorkout({ ...activeWorkout, exercises: nextExercises });
  };

  const applyExerciseBandLevels = (exIdx: number, levelIds: string[]) => {
    if (!activeWorkout) return;
    const bandInfo = describeBandSelection(levelIds, weightUnit);
    const nextExercises = activeWorkout.exercises.map((ex, ei) => {
      if (ei !== exIdx) return ex;
      return {
        ...ex,
        loadMode: 'bands' as LoadMode,
        bandConfig: {
          levelIds,
          label: bandInfo.label,
          totalKg: bandInfo.totalKg,
        },
        sets: ex.sets.map((s) =>
          s.completed
            ? s
            : { ...s, weightKg: bandInfo.totalKg, bandLabel: bandInfo.label },
        ),
      };
    });
    onUpdateActiveWorkout({ ...activeWorkout, exercises: nextExercises });
  };

  const addSetToExercise = (exIdx: number) => {
    if (!activeWorkout) return;
    const nextExercises = activeWorkout.exercises.map((ex, ei) => {
      if (ei !== exIdx) return ex;
      const lastSet = ex.sets[ex.sets.length - 1];
      return {
        ...ex,
        sets: [
          ...ex.sets,
          {
            id: `set_${Date.now()}_${ex.sets.length}`,
            weightKg:
              ex.loadMode === 'bands' && ex.bandConfig
                ? ex.bandConfig.totalKg
                : (lastSet?.weightKg ?? 20),
            reps: lastSet?.reps ?? 10,
            rpe: lastSet?.rpe ?? 8,
            completed: false,
            ...(ex.loadMode === 'bands' && ex.bandConfig
              ? { bandLabel: ex.bandConfig.label }
              : {}),
          },
        ],
      };
    });
    onUpdateActiveWorkout({ ...activeWorkout, exercises: nextExercises });
  };

  const removeSetFromExercise = (exIdx: number, setIdx: number) => {
    if (!activeWorkout) return;
    const nextExercises = activeWorkout.exercises.map((ex, ei) => {
      if (ei !== exIdx) return ex;
      if (ex.sets.length <= 1) return ex;
      return {
        ...ex,
        sets: ex.sets.filter((_, si) => si !== setIdx),
      };
    });
    onUpdateActiveWorkout({ ...activeWorkout, exercises: nextExercises });
  };

  const removeExercise = (exIdx: number) => {
    if (!activeWorkout) return;
    const remaining = activeWorkout.exercises.filter((_, ei) => ei !== exIdx);
    if (activeExerciseIdx >= remaining.length) {
      setActiveExerciseIdx(Math.max(0, remaining.length - 1));
    }
    onUpdateActiveWorkout({
      ...activeWorkout,
      exercises: remaining,
    });
  };

  const addExerciseFromCatalog = (def: ExerciseDefinition) => {
    if (!activeWorkout) return;
    const [instantiated]: WorkoutExercise[] = instantiateWorkoutExercises(
      [def],
      profile,
    );
    const prev = getPreviousExerciseSets(workouts, def.id, def.name);
    const useBandsDefault =
      prev?.loadMode === 'bands' ||
      (profile.equipment.length === 1 &&
        profile.equipment[0] === 'ligas_resistencia');
    const bandConfig =
      prev?.bandConfig ??
      (useBandsDefault
        ? {
            levelIds: ['media'],
            label: describeBandSelection(['media'], weightUnit).label,
            totalKg: describeBandSelection(['media'], weightUnit).totalKg,
          }
        : undefined);

    const enriched: WorkoutExercise = {
      ...instantiated,
      restSec: preferredRestSec || instantiated.restSec,
      loadMode: useBandsDefault ? 'bands' : 'weights',
      bandConfig,
      sets: instantiated.sets.map((s, sIdx) => ({
        ...s,
        weightKg:
          useBandsDefault && bandConfig
            ? bandConfig.totalKg
            : (prev?.sets[sIdx]?.weightKg ??
              prev?.sets[0]?.weightKg ??
              s.weightKg),
        reps: prev?.sets[sIdx]?.reps ?? s.reps,
        rpe: 8,
        ...(useBandsDefault && bandConfig ? { bandLabel: bandConfig.label } : {}),
      })),
    };
    onUpdateActiveWorkout({
      ...activeWorkout,
      exercises: [...activeWorkout.exercises, enriched],
    });
    setShowExercisePicker(false);
  };

  const equipmentLabels = profile.equipment
    .map((id) => EQUIPMENT_OPTIONS.find((e) => e.id === id)?.label ?? id)
    .join(', ');

  const localReplacementVariants = useMemo(() => {
    if (!replaceTarget) return [];
    const targetNameNorm = replaceTarget.name.toLowerCase();
    return availableExercises
      .filter(
        (ex) =>
          ex.name.toLowerCase() !== targetNameNorm &&
          ex.primaryMuscles.some((pm) =>
            replaceTarget.primaryMuscles.includes(pm),
          ),
      )
      .slice(0, 6);
  }, [availableExercises, replaceTarget]);

  const recommendedRoutine =
    routines.find((r) => r.isRecommended) ?? routines[0];
  const otherRoutines = routines.filter(
    (r) => r.id !== recommendedRoutine?.id,
  );

  const sleepPulseAlert = useMemo(
    () => computeSleepPulseIntensityAlert(effectiveDatabase),
    [effectiveDatabase],
  );
  const recoveryIndex = useMemo(
    () => computeRecoveryIndex0To100(effectiveDatabase),
    [effectiveDatabase],
  );

  const formatPreviousSessionLine = (
    exerciseId: string,
    exerciseName: string,
  ): string => {
    const prev = getPreviousExerciseSets(workouts, exerciseId, exerciseName);
    if (!prev || prev.sets.length === 0) {
      return 'Última sesión: sin historial previo';
    }
    const working = prev.sets.filter((s) => s.setType !== 'warmup');
    const pool = working.length > 0 ? working : prev.sets;
    const setsCount = pool.length;
    const avgReps = Math.round(
      pool.reduce((acc, s) => acc + s.reps, 0) / Math.max(1, setsCount),
    );
    const bestWeightKg = Math.max(...pool.map((s) => s.weightKg));
    const bandLabel =
      prev.bandConfig?.label || pool.find((s) => s.bandLabel)?.bandLabel;
    const seriesWord = setsCount === 1 ? 'serie' : 'series';

    if (prev.loadMode === 'bands' && bandLabel) {
      return `Última sesión: ${setsCount} ${seriesWord} x ${avgReps} reps · ${bandLabel}`;
    }
    if (bandLabel) {
      return `Última sesión: ${setsCount} ${seriesWord} x ${avgReps} reps · ${bandLabel}`;
    }
    if (bestWeightKg > 0) {
      return `Última sesión: ${setsCount} ${seriesWord} x ${avgReps} reps · ${formatWeight(bestWeightKg, weightUnit)}`;
    }
    return `Última sesión: ${setsCount} ${seriesWord} x ${avgReps} reps · Peso corporal`;
  };

  return (
    <div className="space-y-6">
      {/* Sub-tab Selector (Fuerza | HIIT | Cardio GPS) + Quick KG/LB Unit Toggle */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
        <div className="flex-1 min-w-[240px] grid grid-cols-3 gap-1.5 rounded-2xl border border-[#222631] bg-[#111319] p-1.5">
          <button
            type="button"
            onClick={() => setSubTab('fuerza')}
            className={`min-h-[46px] rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-colors px-2 ${
              subTab === 'fuerza'
                ? 'bg-[#D4FF33] text-[#0A0B0D]'
                : 'text-zinc-300 hover:bg-[#191D26]'
            }`}
          >
            <Dumbbell className="w-4 h-4 shrink-0" />
            <span className="truncate">Fuerza</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('hiit')}
            className={`min-h-[46px] rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-colors px-2 ${
              subTab === 'hiit'
                ? 'bg-[#D4FF33] text-[#0A0B0D]'
                : 'text-zinc-300 hover:bg-[#191D26]'
            }`}
          >
            <Zap className="w-4 h-4 shrink-0" />
            <span className="truncate">HIIT</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('cardio')}
            className={`min-h-[46px] rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-colors px-2 ${
              subTab === 'cardio'
                ? 'bg-[#D4FF33] text-[#0A0B0D]'
                : 'text-zinc-300 hover:bg-[#191D26]'
            }`}
          >
            <MapPin className="w-4 h-4 shrink-0" />
            <span className="truncate">Cardio GPS</span>
          </button>
        </div>

        {/* Quick KG | LB Switch */}
        <div
          role="group"
          aria-label="Cambiar unidad de peso rápida"
          className="grid grid-cols-2 rounded-2xl border border-[#222631] bg-[#111319] p-1.5 shrink-0"
        >
          {(['kg', 'lb'] as WeightUnit[]).map((u) => {
            const active = weightUnit === u;
            return (
              <button
                key={u}
                type="button"
                onClick={() => {
                  setSetWeightDrafts({});
                  onUpdateProfile({ ...profile, weightUnit: u });
                }}
                className={`min-h-[46px] min-w-[42px] px-2.5 rounded-xl text-xs font-extrabold uppercase transition-colors ${
                  active
                    ? 'bg-[#D4FF33] text-[#0A0B0D]'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {u}
              </button>
            );
          })}
        </div>
      </div>

      {subTab === 'cardio' ? (
        <React.Suspense fallback={<DarkCardioSkeleton />}>
          <CardioTab
            profile={profile}
            cardioSessions={cardioSessions}
            shoes={shoes}
            initialActivityType={requestedCardioActivity}
            onClearInitialActivity={() => setRequestedCardioActivity(null)}
            onSaveCardioSession={(session) => {
              onSaveCardioSession(session);
              void notifyPushActivity('workout', session.date || getTodayIsoDate());
            }}
            onDeleteCardioSession={onDeleteCardioSession}
            onAddShoe={onAddShoe}
            onSetActiveShoe={onSetActiveShoe}
            onDeleteShoe={onDeleteShoe}
          />
        </React.Suspense>
      ) : subTab === 'hiit' ? (
        <HiitTimerSection
          profile={profile}
          hiitSessions={hiitSessions}
          onSaveHiitSession={(session) => {
            onSaveHiitSession(session);
            void notifyPushActivity('workout', session.date || getTodayIsoDate());
          }}
          onDeleteHiitSession={onDeleteHiitSession}
        />
      ) : (
        <>
          {/* Post-workout completion modal */}
          {lastCompletedSession && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="w-full max-w-md rounded-3xl border border-[#262B36] bg-[#13151A] p-6 shadow-2xl space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-[#D4FF33]">
                      Sesión guardada
                    </p>
                    <h3 className="mt-1 text-3xl font-extrabold font-display tracking-tight text-white">
                      Entrenamiento completado
                    </h3>
                    <p className="text-sm text-zinc-400 mt-1">
                      {lastCompletedSession.title}
                    </p>
                    {lastCompletedSession.isPR && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/60 bg-gradient-to-r from-amber-400/20 via-[#D4FF33]/20 to-amber-400/15 px-3 py-1 text-xs font-extrabold text-amber-200">
                        <Trophy className="w-3.5 h-3.5 text-[#D4FF33]" />
                        <span>¡Nuevo Récord Personal (PR)!</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={onDismissSummary}
                    aria-label="Cerrar resumen"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-[#1A1D24] p-3.5 text-center">
                    <p className="text-xs text-zinc-400">Duración</p>
                    <p className="mt-1 text-xl font-bold font-mono tabular-nums text-white">
                      {formatSeconds(lastCompletedSession.durationSec)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#1A1D24] p-3.5 text-center">
                    <p className="text-xs text-zinc-400">Series</p>
                    <p className="mt-1 text-xl font-bold font-mono tabular-nums text-[#D4FF33]">
                      {lastCompletedSession.completedSets}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#1A1D24] p-3.5 text-center">
                    <p className="text-xs text-zinc-400">Volumen</p>
                    <p className="mt-1 text-xl font-bold font-mono tabular-nums text-white">
                      {formatVolume(
                        lastCompletedSession.totalVolumeKg,
                        weightUnit,
                      )}
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-zinc-200 mb-2.5">
                    Impacto actualizado en recuperación muscular
                  </h4>
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {Object.entries(lastCompletedSession.fatigueImpact).map(
                      ([mKey, delta]) => {
                        const muscle = mKey as MuscleGroup;
                        const currentFatigue = decayedFatigue[muscle] ?? 0;
                        return (
                          <div
                            key={muscle}
                            className="flex items-center justify-between text-sm py-1.5 border-b border-white/5"
                          >
                            <span className="text-zinc-200">
                              {MUSCLE_LABELS[muscle]}
                            </span>
                            <span className="font-mono tabular-nums text-xs text-zinc-300">
                              +{delta}% · Fatiga actual{' '}
                              <strong className="text-[#D4FF33]">
                                {currentFatigue}%
                              </strong>
                            </span>
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>

                {workoutCardPreviewUrl && (
                  <div className="rounded-2xl border border-[#D4FF33]/35 bg-[#0D0F14] p-2.5 flex items-center gap-3">
                    <img
                      src={workoutCardPreviewUrl}
                      alt="Vista previa tarjeta resumen"
                      className="w-14 h-16 object-cover rounded-xl border border-white/10 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[#D4FF33]">
                        Tarjeta lista para compartir
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        {workoutCardFeedback ??
                          'Imagen PNG generada con tus métricas.'}
                      </p>
                    </div>
                  </div>
                )}

                {!workoutCardPreviewUrl && workoutCardFeedback && (
                  <p className="text-xs font-semibold text-[#D4FF33]">
                    {workoutCardFeedback}
                  </p>
                )}

                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleGenerateWorkoutCard()}
                    disabled={isGeneratingWorkoutCard}
                    className="w-full min-h-[48px] rounded-2xl border border-[#D4FF33]/45 bg-[#D4FF33]/12 px-4 text-sm font-extrabold text-[#D4FF33] inline-flex items-center justify-center gap-2 hover:bg-[#D4FF33]/20 active:scale-[0.98] transition-all disabled:opacity-60"
                  >
                    {isGeneratingWorkoutCard ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Share2 className="w-4 h-4" />
                    )}
                    {isGeneratingWorkoutCard
                      ? 'Generando tarjeta...'
                      : 'Generar Tarjeta Resumen'}
                  </button>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        onDismissSummary();
                        onNavigateTab('progreso');
                      }}
                      className="min-h-[48px] rounded-2xl border border-[#2B303C] bg-[#1A1D24] px-4 text-sm font-semibold text-white active:scale-[0.98] transition-transform"
                    >
                      Ver analítica
                    </button>
                    <button
                      type="button"
                      onClick={onDismissSummary}
                      className="min-h-[48px] rounded-2xl bg-[#D4FF33] px-4 text-sm font-bold text-[#0A0B0D] active:scale-[0.98] transition-transform"
                    >
                      Listo
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!activeWorkout ? (
            <RoutineManager
              effectiveDatabase={effectiveDatabase}
              profile={profile}
              weightUnit={weightUnit}
              equipmentLabels={equipmentLabels}
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
              workoutTemplates={workoutTemplates}
              availableExercises={availableExercises}
              recommendedRoutine={recommendedRoutine}
              otherRoutines={otherRoutines}
              freshestMuscles={freshestMuscles}
              decayedFatigue={decayedFatigue}
              recoveryIndex={recoveryIndex}
              sleepPulseAlert={sleepPulseAlert}
              aiRoutine={aiRoutine}
              isGeneratingAi={isGeneratingAi}
              aiError={aiError}
              rpeTrackingEnabled={rpeTrackingEnabled}
              formatPreviousSessionLine={formatPreviousSessionLine}
              onStartEmpty={handleStartEmpty}
              onStartBlueprint={handleStartBlueprint}
              onStartTemplate={handleStartTemplate}
              onSaveTemplate={onSaveTemplate}
              onDeleteTemplate={onDeleteTemplate}
              onGenerateAiRoutine={handleGenerateAiRoutine}
              onStartAiRoutine={handleStartAiRoutine}
              onOpenReplacePreview={(exIdx, name, primaryMuscles) =>
                openReplaceModal('preview', exIdx, name, primaryMuscles)
              }
              onInspectExercise={(info) => setInspectedExercise(info)}
              onUpdateProfile={onUpdateProfile}
              onSaveReadiness={onSaveReadiness}
              onNavigateTab={onNavigateTab}
              onOpenSleep={onOpenSleep}
              onOpenPulse={onOpenPulse}
            />
          ) : (
            <ActiveWorkoutSession
              activeWorkout={activeWorkout}
              profile={profile}
              workouts={workouts}
              weightUnit={weightUnit}
              elapsedSec={elapsedSec}
              wakeLockActive={hardware.wakeLockActive}
              hrBpm={hrBpm}
              hrDeviceName={hrDeviceName}
              hrError={hrError}
              isConnectingHr={isConnectingHr}
              onToggleHeartRate={handleToggleHeartRate}
              voiceCoachEnabled={voiceCoachEnabled}
              speechAvailable={speechAvailable}
              isAudioMuted={isAudioMuted}
              setIsAudioMuted={setIsAudioMuted}
              lastSpokenCue={lastSpokenCue}
              activeExerciseIdx={activeExerciseIdx}
              rpeTrackingEnabled={rpeTrackingEnabled}
              autoStartRest={autoStartRest}
              preferredRestSec={preferredRestSec}
              restRemaining={restRemaining}
              restTotal={restTotal}
              recoveryIndex={recoveryIndex}
              decayedFatigue={decayedFatigue}
              sleepPulseAlert={sleepPulseAlert}
              activeRpePrompt={activeRpePrompt}
              setActiveRpePrompt={setActiveRpePrompt}
              setWeightDrafts={setWeightDrafts}
              setSetWeightDrafts={setSetWeightDrafts}
              overloadAppliedNote={overloadAppliedNote}
              savedTemplateBanner={savedTemplateBanner}
              formatPreviousSessionLine={formatPreviousSessionLine}
              onUpdateProfile={onUpdateProfile}
              onUpdateActiveWorkout={onUpdateActiveWorkout}
              onCompleteWorkout={(wk) => {
                onCompleteWorkout(wk);
                void notifyPushActivity('workout', getTodayIsoDate());
              }}
              onSaveActiveAsTemplate={handleSaveActiveAsTemplate}
              onOpenExercisePicker={() => setShowExercisePicker(true)}
              onInspectExercise={(info) => setInspectedExercise(info)}
              onOpenReplaceActive={(exIdx, name, primaryMuscles) =>
                openReplaceModal('active', exIdx, name, primaryMuscles)
              }
              onAnnounceExerciseStart={announceExerciseStart}
              onSpeakAndRemember={speakAndRemember}
              onRepeatCue={handleRepeatCue}
              onStartRestTimer={startRestTimer}
              onAdjustRestTimer={adjustRestTimer}
              onRestartRestTimer={restartRestTimer}
              onSkipRest={handleSkipRest}
              onUpdateSetField={updateSetField}
              onSelectRpeOneTap={handleSelectRpeOneTap}
              onApplyProgressiveOverload={applyProgressiveOverloadToExercise}
              onSetExerciseLoadMode={setExerciseLoadMode}
              onApplyExerciseBandLevels={applyExerciseBandLevels}
              onAddSetToExercise={addSetToExercise}
              onRemoveSetFromExercise={removeSetFromExercise}
              onRemoveExercise={removeExercise}
              onToggleSupersetWithNext={toggleSupersetWithNext}
              onToggleWarmupItem={toggleWarmupItem}
            />
          )}

          {/* Replace Exercise Bottom Sheet (Gemini + Local Compatible Variants) */}
          {replaceTarget && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm">
              <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl border border-[#262B36] bg-[#13151A] max-h-[85dvh] flex flex-col">
                <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden" />
                <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#D4FF33]">
                      Reemplazar ejercicio
                    </p>
                    <h3 className="text-xl font-bold font-display text-white truncate">
                      {replaceTarget.name}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Músculo objetivo:{' '}
                      {replaceTarget.primaryMuscles
                        .map((m) => MUSCLE_LABELS[m])
                        .join(', ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplaceTarget(null)}
                    aria-label="Cerrar reemplazo"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white shrink-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  {/* Gemini Suggestions */}
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-[#D4FF33]">
                      <Sparkles className="w-4 h-4" />
                      Variantes sugeridas por Gemini para tu equipo
                    </div>

                    {isLoadingAlternatives ? (
                      <div className="rounded-2xl border border-[#222631] bg-[#0E1014] p-5 flex items-center justify-center gap-2.5 text-sm text-zinc-300">
                        <Loader2 className="w-4 h-4 animate-spin text-[#D4FF33]" />
                        Buscando variantes biomecánicas...
                      </div>
                    ) : alternativesError ? (
                      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-3.5 text-xs text-amber-200">
                        {alternativesError}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {aiAlternatives.map((alt, idx) => (
                          <div
                            key={`${alt.name}_${idx}`}
                            className="rounded-2xl border border-[#D4FF33]/35 bg-[#171B24] p-3 flex items-center justify-between gap-2"
                          >
                            <button
                              type="button"
                              onClick={() => applyReplacement(alt)}
                              className="flex-1 min-w-0 text-left px-1 py-1 hover:opacity-90"
                            >
                              <p className="text-sm font-bold text-white">
                                {alt.name}
                              </p>
                              <p className="text-xs text-zinc-400 mt-0.5">
                                {alt.reason}
                              </p>
                              <p className="text-xs font-mono text-[#D4FF33] mt-1">
                                {alt.suggestedWeightKg > 0
                                  ? formatWeight(
                                      alt.suggestedWeightKg,
                                      weightUnit,
                                    )
                                  : 'Peso corporal'}{' '}
                                · {alt.reps} reps · Descanso {alt.restSec}s
                              </p>
                            </button>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setInspectedExercise({
                                    name: alt.name,
                                    primaryMuscles: alt.primaryMuscles,
                                    secondaryMuscles: alt.secondaryMuscles,
                                    notes: alt.reason,
                                  })
                                }
                                aria-label={`Ver técnica y mapa muscular de ${alt.name}`}
                                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-[#2B303C] bg-[#11141B] text-zinc-200 hover:border-[#D4FF33] hover:text-[#D4FF33]"
                              >
                                <Info className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => applyReplacement(alt)}
                                aria-label={`Elegir ${alt.name}`}
                                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#D4FF33] text-[#0A0B0D]"
                              >
                                <ArrowLeftRight className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Local Compatible Variants */}
                  {localReplacementVariants.length > 0 && (
                    <div className="space-y-2.5">
                      <p className="text-xs font-bold text-zinc-400">
                        Alternativas del catálogo local
                      </p>
                      {localReplacementVariants.map((def) => (
                        <div
                          key={def.id}
                          className="rounded-2xl border border-[#222631] bg-[#181B23] p-3 flex items-center justify-between gap-2"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              applyReplacement({
                                exerciseId: def.id,
                                name: def.name,
                                primaryMuscles: def.primaryMuscles,
                                secondaryMuscles: def.secondaryMuscles,
                                suggestedWeightKg: def.suggestedWeightKg,
                                reps: def.defaultReps,
                                restSec: def.defaultRestSec,
                              })
                            }
                            className="flex-1 min-w-0 text-left px-1 py-1"
                          >
                            <p className="text-sm font-bold text-white truncate">
                              {def.name}
                            </p>
                            <p className="text-xs text-zinc-400 mt-0.5 truncate">
                              {def.primaryMuscles
                                .map((m) => MUSCLE_LABELS[m])
                                .join(' · ')}
                            </p>
                          </button>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setInspectedExercise({
                                  name: def.name,
                                  primaryMuscles: def.primaryMuscles,
                                  secondaryMuscles: def.secondaryMuscles,
                                  notes: def.instructions,
                                })
                              }
                              aria-label={`Ver técnica y mapa muscular de ${def.name}`}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-[#2B303C] bg-[#11141B] text-zinc-200 hover:border-[#D4FF33] hover:text-[#D4FF33]"
                            >
                              <Info className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                applyReplacement({
                                  exerciseId: def.id,
                                  name: def.name,
                                  primaryMuscles: def.primaryMuscles,
                                  secondaryMuscles: def.secondaryMuscles,
                                  suggestedWeightKg: def.suggestedWeightKg,
                                  reps: def.defaultReps,
                                  restSec: def.defaultRestSec,
                                })
                              }
                              aria-label={`Elegir ${def.name}`}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#242936] text-[#D4FF33]"
                            >
                              <ArrowLeftRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Exercise Catalog & Muscle/Equipment Filter Modal */}
          <ExerciseCatalogModal
            isOpen={showExercisePicker}
            userEquipment={profile.equipment}
            restRemaining={restRemaining}
            onClose={() => setShowExercisePicker(false)}
            onSelectExercise={addExerciseFromCatalog}
            onInspectExercise={(info) => setInspectedExercise(info)}
          />
        </>
      )}

      {/* Floating Rest Timer Bar */}
      {activeWorkout && restRemaining !== null && (
        <RestTimerBar
          restRemaining={restRemaining}
          restTotal={restTotal}
          targetEndTime={restTargetEndTime}
          isPaused={restPaused}
          nextExerciseLabel={restContextRef.current?.exerciseName}
          onAdjust={adjustRestTimer}
          onRestart={restartRestTimer}
          onSkip={handleSkipRest}
          onTogglePause={togglePauseRestTimer}
        />
      )}

      {/* Technique, Animated Demo & Anatomical Muscle Map Modal */}
      <ExerciseDemoModal
        exercise={inspectedExercise}
        onClose={() => setInspectedExercise(null)}
        restRemaining={restRemaining}
        onSyncDetectedMuscles={(primary, secondary) => {
          if (!inspectedExercise) return;
          if (inspectedExercise.activeIdx !== undefined && activeWorkout) {
            const target =
              activeWorkout.exercises[inspectedExercise.activeIdx];
            if (!target) return;
            const changed =
              primary.join(',') !== target.primaryMuscles.join(',') ||
              secondary.join(',') !== target.secondaryMuscles.join(',');
            if (!changed) return;
            onUpdateActiveWorkout({
              ...activeWorkout,
              exercises: activeWorkout.exercises.map((ex, i) =>
                i === inspectedExercise.activeIdx
                  ? {
                      ...ex,
                      primaryMuscles: primary,
                      secondaryMuscles: secondary,
                    }
                  : ex,
              ),
            });
          } else if (inspectedExercise.previewIdx !== undefined && aiRoutine) {
            const target = aiRoutine.exercises[inspectedExercise.previewIdx];
            if (!target) return;
            const changed =
              primary.join(',') !== target.primaryMuscles.join(',') ||
              secondary.join(',') !== target.secondaryMuscles.join(',');
            if (!changed) return;
            setAiRoutine({
              ...aiRoutine,
              exercises: aiRoutine.exercises.map((ex, i) =>
                i === inspectedExercise.previewIdx
                  ? {
                      ...ex,
                      primaryMuscles: primary,
                      secondaryMuscles: secondary,
                    }
                  : ex,
              ),
            });
          }
        }}
      />
    </div>
  );
};
