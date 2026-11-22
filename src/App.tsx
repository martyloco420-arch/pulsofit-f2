import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  BatteryLow,
  BellRing,
  Check,
  Droplets,
  Dumbbell,
  HeartPulse,
  LayoutGrid,
  Moon,
  Music2,
  Plus,
  TrendingUp,
  User,
  Users,
  Utensils,
  X,
} from 'lucide-react';
import { DashboardTab } from './components/DashboardTab';
import { InlineDeleteConfirmButton } from './components/InlineDeleteConfirmButton';
import { MusicPlayerBar } from './components/MusicPlayerBar';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { useHardwareManager } from './hooks/useHardwareManager';
import {
  computeRecoveryIndex0To100,
  recalculateNutritionAfterWeighIn,
} from './lib/crossModuleIntelligence';
import { applyWorkoutFatigue, createInitialMuscleFatigue } from './lib/recovery';

const SaludTab = lazy(() =>
  import('./components/SaludTab').then((m) => ({ default: m.SaludTab })),
);
const EntrenarTab = lazy(() =>
  import('./components/EntrenarTab').then((m) => ({ default: m.EntrenarTab })),
);
const NutricionTab = lazy(() =>
  import('./components/NutricionTab').then((m) => ({ default: m.NutricionTab })),
);
const HidratacionTab = lazy(() =>
  import('./components/HidratacionTab').then((m) => ({
    default: m.HidratacionTab,
  })),
);
const ProgresoTab = lazy(() =>
  import('./components/ProgresoTab').then((m) => ({ default: m.ProgresoTab })),
);
const PerfilTab = lazy(() =>
  import('./components/PerfilTab').then((m) => ({ default: m.PerfilTab })),
);
const SleepRecoverySection = lazy(() =>
  import('./components/SleepRecoverySection').then((m) => ({
    default: m.SleepRecoverySection,
  })),
);
const SmartScaleModal = lazy(() =>
  import('./components/SmartScaleModal').then((m) => ({
    default: m.SmartScaleModal,
  })),
);

const DarkTabSkeleton = () => (
  <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Cargando módulo">
    <div className="h-9 w-48 rounded-2xl bg-[#12141A] border border-[#222631]" />
    <div className="h-48 w-full rounded-3xl bg-[#12141A] border border-[#222631]" />
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="h-36 rounded-3xl bg-[#12141A] border border-[#222631]" />
      <div className="h-36 rounded-3xl bg-[#12141A] border border-[#222631]" />
    </div>
  </div>
);
import {
  setLowPowerPreference,
  useLowPowerMode,
} from './lib/lowPowerMode';
import {
  type CleanupCategoryId,
  DEFAULT_PROFILE_SLOTS,
  type DataModuleRecordType,
  type RecordDeleteTarget,
  clearCategoryInDb,
  clearProfileHistoryPreserveProfile,
  createInitialDatabase,
  deleteDayRecordsInDb,
  deleteModuleRecordInDb,
  deleteProfileStorage,
  flushPendingAppDatabaseSaves,
  getActiveProfileId,
  getTodayIsoDate,
  isDatabaseHydrated,
  loadAppDatabase,
  loadProfileRegistry,
  persistProfileDatabaseImmediate,
  saveAppDatabase,
  saveProfileRegistry,
  scheduleSaveAppDatabase,
  setActiveProfileId,
  wipeAllPulsoFitStorage,
} from './lib/storage';
import {
  clearAllProgressPhotoBlobs,
  deleteProgressPhotoBlobs,
} from './lib/photoStorage';
import {
  cancelCoachSpeech,
  setDefaultPreferredVoiceUri,
} from './lib/voiceCoach';
import {
  HYDRATION_IN_APP_ALERT_EVENT,
  type HydrationInAppAlertPayload,
  computeHydrationGoal,
  computeNextWakeTimestampMs,
  computeSmartHydrationPlan,
  dispatchLocalHydrationNotification,
  getNextHydrationReminderTimestamp,
  loadSmartHydrationReminderConfig,
  setNextHydrationReminderTimestamp,
} from './lib/hydration';
import { estimateDistanceKmFromSteps } from './lib/dailyActivity';
import { formatLiquid, getLiquidUnit } from './lib/units';
import { applyPulseToReadiness } from './lib/pulsePpgEngine';
import {
  notifyPushActivity,
  reconcilePushActivityState,
} from './lib/pushNotifications';
import { convertSleepToReadiness } from './lib/sleepEngine';
import type {
  ActiveFastState,
  ActiveWorkout,
  AdaptiveNutritionState,
  AppDatabase,
  BloodPressureRecord,
  BodyCompositionScan,
  CardioSession,
  CoachChatMessage,
  CoachPersonality,
  DailyReadinessEntry,
  FastingHistoryEntry,
  FoodEntry,
  HydrationSettings,
  ManualDailyActivity,
  ProfileSlot,
  PulseHrvRecord,
  ShoeGear,
  SleepSession,
  TabId,
  UserProfile,
  WeeklyMealPlan,
  WorkoutSession,
} from './types/fitness';

const TABS: {
  id: TabId;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutGrid },
  { id: 'salud', label: 'Salud', Icon: HeartPulse },
  { id: 'entrenar', label: 'Entrenar', Icon: Dumbbell },
  { id: 'nutricion', label: 'Nutrición', Icon: Utensils },
  { id: 'hidratacion', label: 'Hidratación', Icon: Droplets },
  { id: 'sueno', label: 'Sueño', Icon: Moon },
  { id: 'progreso', label: 'Progreso', Icon: TrendingUp },
  { id: 'perfil', label: 'Perfil', Icon: User },
];

const VALID_TAB_IDS = new Set<TabId>(TABS.map((t) => t.id));

function getInitialTabFromUrl(): TabId {
  if (typeof window === 'undefined') return 'entrenar';
  try {
    const raw = new URLSearchParams(window.location.search).get('tab');
    if (raw && VALID_TAB_IDS.has(raw as TabId)) {
      return raw as TabId;
    }
  } catch {
    // Ignore URL parsing errors
  }
  return 'entrenar';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>(() => getInitialTabFromUrl());
  const [profileSlots, setProfileSlots] = useState<ProfileSlot[]>(DEFAULT_PROFILE_SLOTS);
  const [activeProfileId, setActiveProfileIdState] = useState<string>(() =>
    getActiveProfileId(),
  );
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [database, setDatabase] = useState<AppDatabase>(() => createInitialDatabase());
  const [isLoaded, setIsLoaded] = useState(false);
  const [isScaleModalOpen, setIsScaleModalOpen] = useState(false);
  const [isMiniPlayerVisible, setIsMiniPlayerVisible] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [hasMusicTracks, setHasMusicTracks] = useState(false);
  const [openMusicModalTick, setOpenMusicModalTick] = useState(0);
  const [openCardioWalkTick, setOpenCardioWalkTick] = useState(0);
  const [openDatosTick, setOpenDatosTick] = useState(0);
  const [openSleepTick, setOpenSleepTick] = useState(0);
  const [openPulseTick, setOpenPulseTick] = useState(0);
  const [openPushTick, setOpenPushTick] = useState(0);
  const [lastCompletedSession, setLastCompletedSession] =
    useState<WorkoutSession | null>(null);
  const [inAppHydrationAlert, setInAppHydrationAlert] =
    useState<HydrationInAppAlertPayload | null>(null);

  const activeProfileIdRef = useRef(activeProfileId);
  activeProfileIdRef.current = activeProfileId;
  const loadGenRef = useRef(0);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const databaseRef = useRef(database);
  databaseRef.current = database;

  const activeProfileLabel = useMemo(
    () =>
      profileSlots.find((s) => s.id === activeProfileId)?.label ?? 'Principal',
    [profileSlots, activeProfileId],
  );

  const recoveryIndexSummary = useMemo(
    () => computeRecoveryIndex0To100(database),
    [database],
  );

  const lowPower = useLowPowerMode();
  const prevLowPowerRef = useRef(lowPower.isLowPower);
  const hardware = useHardwareManager();

  // Release inactive camera/mic tracks & non-cardio/sleep WakeLock immediately on tab changes
  useEffect(() => {
    hardware.notifyTabChange(activeTab);
  }, [activeTab, hardware]);

  // Listen for Service Worker deep-link navigation messages when tapping push notifications
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }
    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; tab?: unknown } | undefined;
      if (
        data?.type === 'NAVIGATE_TAB' &&
        typeof data.tab === 'string' &&
        VALID_TAB_IDS.has(data.tab as TabId)
      ) {
        setActiveTab(data.tab as TabId);
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, []);

  // Sync active profile's Low Power preference & flush batched IDB writes when returning to normal mode
  useEffect(() => {
    setLowPowerPreference(database.profile.lowPowerMode);
  }, [database.profile.lowPowerMode]);

  useEffect(() => {
    if (prevLowPowerRef.current && !lowPower.isLowPower) {
      void flushPendingAppDatabaseSaves();
    }
    prevLowPowerRef.current = lowPower.isLowPower;
  }, [lowPower.isLowPower]);

  // Sync Voice Coach default preferred voice with active profile
  useEffect(() => {
    setDefaultPreferredVoiceUri(database.profile.preferredVoiceUri);
  }, [database.profile.preferredVoiceUri]);

  // Listen for in-app hydration reminder banners & run persistent nextHydrationReminder scheduler
  useEffect(() => {
    const onAlert = (event: Event) => {
      const custom = event as CustomEvent<HydrationInAppAlertPayload>;
      if (custom.detail) {
        setInAppHydrationAlert(custom.detail);
      }
    };
    window.addEventListener(HYDRATION_IN_APP_ALERT_EVENT, onAlert);
    return () => window.removeEventListener(HYDRATION_IN_APP_ALERT_EVENT, onAlert);
  }, []);

  useEffect(() => {
    if (!isLoaded) return undefined;

    const checkReminder = () => {
      const db = databaseRef.current;
      const smartConfig = loadSmartHydrationReminderConfig(db.hydrationSettings);
      if (!smartConfig.enabled) return;

      const now = Date.now();
      const today = getTodayIsoDate();
      const todayConsumedMl = db.hydrationByDate[today] ?? 0;
      const settings: HydrationSettings = db.hydrationSettings ?? {
        mlPerKg: 35,
        containerMl: 500,
        wakeHour: 7,
        sleepHour: 23,
        hotDayByDate: {},
        remindersEnabled: smartConfig.enabled,
      };
      const goal = computeHydrationGoal(
        db.profile,
        db.bodyWeights,
        db.bodyScans,
        db.workouts,
        settings,
        today,
        db.cardioSessions ?? [],
        db.hiitSessions ?? [],
      );
      const plan = computeSmartHydrationPlan({
        targetMl: goal.totalTargetMl,
        consumedMl: todayConsumedMl,
        wakeTime: smartConfig.wakeTime,
        sleepTime: smartConfig.sleepTime,
        now: new Date(now),
      });

      const nextTs = getNextHydrationReminderTimestamp();
      if (!nextTs) {
        const initialNext =
          plan.isWithinActiveWindow && !plan.isGoalMet
            ? now + plan.intervalMinutes * 60 * 1000
            : computeNextWakeTimestampMs(smartConfig.wakeTime, smartConfig.sleepTime);
        setNextHydrationReminderTimestamp(initialNext);
        return;
      }

      if (now < nextTs) return;

      // Outside wake/sleep window or daily goal already met -> pause and schedule next wake
      if (!plan.isWithinActiveWindow || plan.isGoalMet) {
        const nextWake = computeNextWakeTimestampMs(
          smartConfig.wakeTime,
          smartConfig.sleepTime,
        );
        setNextHydrationReminderTimestamp(nextWake);
        return;
      }

      // Trigger local notification (SW -> Notification -> In-App banner/sound) and schedule next
      const liquidUnit = getLiquidUnit(db.profile.liquidUnit);
      const nextGlassText = formatLiquid(250, liquidUnit);
      const remainingText = formatLiquid(plan.remainingMl, liquidUnit);
      void dispatchLocalHydrationNotification(
        'PulsoFit · Hora de tomar agua',
        `Toma 1 vaso (${nextGlassText}). Te faltan ${remainingText} hoy · próximo aviso en ${plan.intervalMinutes} min.`,
        { triggerInAppAlert: true },
      );

      setNextHydrationReminderTimestamp(now + plan.intervalMinutes * 60 * 1000);
    };

    checkReminder();
    const intervalMs = lowPower.isLowPower ? 30_000 : 20_000;
    const id = window.setInterval(checkReminder, intervalMs);
    return () => window.clearInterval(id);
  }, [isLoaded, lowPower.isLowPower]);

  // Initial load: registry + active profile database
  useEffect(() => {
    let mounted = true;
    const reqId = ++loadGenRef.current;

    Promise.all([loadProfileRegistry(), loadAppDatabase(activeProfileIdRef.current)]).then(
      ([slots, loaded]) => {
        if (!mounted || reqId !== loadGenRef.current) return;
        setProfileSlots(slots);
        const validSlot = slots.some((s) => s.id === activeProfileIdRef.current);
        if (!validSlot) {
          setActiveProfileId('main');
          setActiveProfileIdState('main');
          activeProfileIdRef.current = 'main';
          loadAppDatabase('main').then((mainDb) => {
            if (!mounted) return;
            setDatabase(mainDb);
            setIsLoaded(true);
          });
          return;
        }
        setDatabase(loaded);
        setIsLoaded(true);
      },
    );

    return () => {
      mounted = false;
    };
  }, []);

  // Close profile menu on outside click
  useEffect(() => {
    if (!isProfileMenuOpen) return undefined;
    const handleOutside = (e: MouseEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target as Node)
      ) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isProfileMenuOpen]);

  const commitDatabase = (updater: (prev: AppDatabase) => AppDatabase) => {
    const targetProfileId = activeProfileIdRef.current;
    setDatabase((prev) => {
      const next = updater(prev);
      scheduleSaveAppDatabase(next, targetProfileId);
      return next;
    });
  };

  const commitImmediateDelete = async (
    moduleType: DataModuleRecordType,
    target: RecordDeleteTarget | string,
    options?: { reconcilePush?: boolean },
  ) => {
    const targetProfileId = activeProfileIdRef.current;
    if (!isLoaded || !isDatabaseHydrated(targetProfileId)) return;

    const currentDb = databaseRef.current;
    const { nextDb, deletedPhotoIds, changed } = deleteModuleRecordInDb(
      currentDb,
      moduleType,
      target,
    );
    if (!changed) return;

    databaseRef.current = nextDb;
    setDatabase(nextDb);

    if (moduleType === 'workouts' && lastCompletedSession) {
      const targetId = typeof target === 'string' ? target : target.id;
      if (targetId && lastCompletedSession.id === targetId) {
        setLastCompletedSession(null);
      }
    }

    if (deletedPhotoIds.length > 0) {
      await deleteProgressPhotoBlobs(deletedPhotoIds);
    }
    await persistProfileDatabaseImmediate(nextDb, targetProfileId);

    if (options?.reconcilePush) {
      void reconcilePushActivityState(nextDb);
    }
  };

  const handleSelectProfile = async (slotId: string) => {
    setIsProfileMenuOpen(false);
    if (slotId === activeProfileIdRef.current) return;

    await flushPendingAppDatabaseSaves(activeProfileIdRef.current);
    cancelCoachSpeech();
    setLastCompletedSession(null);
    setActiveProfileId(slotId);
    setActiveProfileIdState(slotId);
    activeProfileIdRef.current = slotId;
    setIsLoaded(false);

    const reqId = ++loadGenRef.current;
    const loaded = await loadAppDatabase(slotId);
    if (reqId !== loadGenRef.current) return;
    setDatabase(loaded);
    setIsLoaded(true);
  };

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const label = newProfileName.trim();
    if (!label) return;
    const id = `fam_${Date.now().toString(36)}`;
    const nextSlots = [...profileSlots, { id, label, isDefault: false }];
    setProfileSlots(nextSlots);
    setNewProfileName('');
    await saveProfileRegistry(nextSlots);

    const freshDb = createInitialDatabase(label);
    await saveAppDatabase(freshDb, id, { force: true });
    await handleSelectProfile(id);
  };

  const handleDeleteCustomProfile = async (slotId: string) => {
    const target = profileSlots.find((s) => s.id === slotId);
    if (!target || target.isDefault) return;
    const nextSlots = profileSlots.filter((s) => s.id !== slotId);
    setProfileSlots(nextSlots);
    await saveProfileRegistry(nextSlots);
    await deleteProfileStorage(slotId);
    if (activeProfileIdRef.current === slotId) {
      await handleSelectProfile('main');
    }
  };

  const handleStartWorkout = (workout: ActiveWorkout) => {
    commitDatabase((prev) => ({
      ...prev,
      activeWorkout: workout,
    }));
  };

  const handleUpdateActiveWorkout = (workout: ActiveWorkout | null) => {
    commitDatabase((prev) => ({
      ...prev,
      activeWorkout: workout,
    }));
  };

  const handleCompleteWorkout = (workout: ActiveWorkout) => {
    const completedAt = new Date().toISOString();
    const startMs = Date.parse(workout.startedAt);
    const durationSec = Number.isNaN(startMs)
      ? 0
      : Math.max(60, Math.floor((Date.now() - startMs) / 1000));

    let completedSets = 0;
    let totalVolumeKg = 0;
    for (const ex of workout.exercises) {
      for (const s of ex.sets) {
        if (s.completed) {
          completedSets += 1;
          totalVolumeKg += s.weightKg * s.reps;
        }
      }
    }

    const { updatedMap, impact } = applyWorkoutFatigue(
      database.muscleFatigue,
      workout.exercises,
      completedAt,
    );

    const session: WorkoutSession = {
      id: workout.id,
      title: workout.title,
      startedAt: workout.startedAt,
      completedAt,
      durationSec,
      totalVolumeKg: Math.round(totalVolumeKg),
      completedSets,
      exercises: workout.exercises,
      fatigueImpact: impact,
    };

    commitDatabase((prev) => ({
      ...prev,
      activeWorkout: null,
      muscleFatigue: updatedMap,
      workouts: [session, ...prev.workouts],
    }));

    void notifyPushActivity('workout', getTodayIsoDate());
    setLastCompletedSession(session);
  };

  const handleDeleteWorkout = (workoutId: string) => {
    void commitImmediateDelete('workouts', workoutId, { reconcilePush: true });
  };

  const handleLogBodyWeight = (weightKg: number, date: string) => {
    commitDatabase((prev) => {
      const nextWeights = [
        ...prev.bodyWeights.filter((b) => b.date !== date),
        { id: `bw_${Date.now()}`, date, weightKg },
      ].sort((a, b) => a.date.localeCompare(b.date));
      const latestWeight = nextWeights[nextWeights.length - 1]?.weightKg ?? weightKg;
      const nextWithNutrition = recalculateNutritionAfterWeighIn(prev, latestWeight);
      return {
        ...nextWithNutrition,
        bodyWeights: nextWeights,
      };
    });
  };

  const handleAddFood = (entry: Omit<FoodEntry, 'id' | 'createdAt'>) => {
    const newEntry: FoodEntry = {
      ...entry,
      id: `food_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    commitDatabase((prev) => ({
      ...prev,
      foodLogs: [newEntry, ...prev.foodLogs],
    }));
  };

  const handleDeleteFood = (id: string) => {
    void commitImmediateDelete('nutrition', id);
  };

  const handleAddWater = (date: string, deltaMl: number) => {
    const today = getTodayIsoDate();
    commitDatabase((prev) => {
      const current = prev.hydrationByDate[date] ?? 0;
      const nextVal = Math.max(0, current + deltaMl);
      const existingLogs = prev.hydrationLogsByDate?.[date] ?? [];
      const nextLogs =
        deltaMl > 0
          ? [
              ...existingLogs,
              {
                id: `hyd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                date,
                amountMl: deltaMl,
                recordedAt: new Date().toISOString(),
              },
            ]
          : existingLogs;

      const addedGlasses = deltaMl > 0 ? Math.max(1, Math.round(deltaMl / 250)) : 0;
      const nextActiveFast =
        prev.activeFast && date === today && addedGlasses > 0
          ? {
              ...prev.activeFast,
              waterGlassesCount: prev.activeFast.waterGlassesCount + addedGlasses,
            }
          : prev.activeFast;

      return {
        ...prev,
        activeFast: nextActiveFast,
        hydrationByDate: {
          ...prev.hydrationByDate,
          [date]: nextVal,
        },
        hydrationLogsByDate: {
          ...(prev.hydrationLogsByDate ?? {}),
          [date]: nextLogs,
        },
      };
    });
    if (deltaMl > 0) {
      void notifyPushActivity('water', date);
    }
  };

  const handleUndoLastWater = (date: string) => {
    const today = getTodayIsoDate();
    commitDatabase((prev) => {
      const current = prev.hydrationByDate[date] ?? 0;
      if (current <= 0) return prev;
      const existingLogs = prev.hydrationLogsByDate?.[date] ?? [];
      const lastEntry = existingLogs[existingLogs.length - 1];
      const undoMl = lastEntry ? lastEntry.amountMl : Math.min(current, 250);
      const nextVal = Math.max(0, current - undoMl);
      const nextLogs = lastEntry ? existingLogs.slice(0, -1) : existingLogs;

      const removedGlasses = Math.max(1, Math.round(undoMl / 250));
      const nextActiveFast =
        prev.activeFast && date === today
          ? {
              ...prev.activeFast,
              waterGlassesCount: Math.max(
                0,
                prev.activeFast.waterGlassesCount - removedGlasses,
              ),
            }
          : prev.activeFast;

      return {
        ...prev,
        activeFast: nextActiveFast,
        hydrationByDate: {
          ...prev.hydrationByDate,
          [date]: nextVal,
        },
        hydrationLogsByDate: {
          ...(prev.hydrationLogsByDate ?? {}),
          [date]: nextLogs,
        },
      };
    });
  };

  const handleDeleteWaterLog = (date: string, target: RecordDeleteTarget | string) => {
    const normalized: RecordDeleteTarget =
      typeof target === 'string'
        ? { id: target, date }
        : { ...target, date: target.date || date };
    void commitImmediateDelete('hydration', normalized, { reconcilePush: true });
  };

  const handleUpdateElectrolytes = (date: string, delta: number) => {
    const today = getTodayIsoDate();
    commitDatabase((prev) => {
      const prevCount = prev.electrolytesByDate?.[date] ?? 0;
      const baseCount =
        date === today && prev.activeFast
          ? Math.max(prevCount, prev.activeFast.electrolytesCount ?? 0)
          : prevCount;
      const nextCount = Math.max(0, baseCount + delta);

      const nextActiveFast =
        prev.activeFast && date === today
          ? {
              ...prev.activeFast,
              electrolytesCount: nextCount,
            }
          : prev.activeFast;

      return {
        ...prev,
        activeFast: nextActiveFast,
        electrolytesByDate: {
          ...(prev.electrolytesByDate ?? {}),
          [date]: nextCount,
        },
      };
    });
  };

  const handleUpdateHydrationSettings = (settings: HydrationSettings) => {
    commitDatabase((prev) => ({
      ...prev,
      hydrationSettings: settings,
    }));
  };

  const handleUpdateProfile = (profile: UserProfile) => {
    commitDatabase((prev) => ({
      ...prev,
      profile,
    }));
  };

  const handleResetMuscleFatigue = () => {
    commitDatabase((prev) => ({
      ...prev,
      muscleFatigue: createInitialMuscleFatigue(),
    }));
  };

  const handleImportDatabase = (nextDb: AppDatabase) => {
    commitDatabase(() => nextDb);
  };

  const handleSaveAdaptiveNutrition = (state: AdaptiveNutritionState | null) => {
    commitDatabase((prev) => ({
      ...prev,
      adaptiveNutrition: state,
    }));
  };

  const handleSaveWeeklyMealPlan = (plan: WeeklyMealPlan | null) => {
    commitDatabase((prev) => ({
      ...prev,
      weeklyMealPlan: plan,
    }));
  };

  const handleSaveBodyScan = (scan: BodyCompositionScan) => {
    if (!isLoaded || !isDatabaseHydrated(activeProfileIdRef.current)) return;
    commitDatabase((prev) => {
      const nextScans = [
        scan,
        ...prev.bodyScans.filter((s) => s.id !== scan.id),
      ].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

      const nextWeights = [
        ...prev.bodyWeights.filter((b) => b.date !== scan.date),
        { id: `bw_${Date.now()}`, date: scan.date, weightKg: scan.weightKg },
      ].sort((a, b) => a.date.localeCompare(b.date));

      const latestWeight = nextWeights[nextWeights.length - 1]?.weightKg ?? scan.weightKg;
      const nextWithNutrition = recalculateNutritionAfterWeighIn(prev, latestWeight);

      return {
        ...nextWithNutrition,
        bodyWeights: nextWeights,
        bodyScans: nextScans,
      };
    });
  };

  const handleDeleteBodyScan = (scanId: string) => {
    void commitImmediateDelete('body_scans', scanId);
  };

  const handleDeleteBodyWeight = (weightId: string) => {
    void commitImmediateDelete('body_weights', weightId);
  };

  const handleDeleteHiitSession = (hiitId: string) => {
    void commitImmediateDelete('hiit', hiitId, { reconcilePush: true });
  };

  const handleDeleteFastHistory = (fastId: string) => {
    void commitImmediateDelete('fasting', fastId);
  };

  const handleStartFast = (fast: ActiveFastState) => {
    commitDatabase((prev) => ({
      ...prev,
      activeFast: fast,
    }));
  };

  const handleUpdateActiveFast = (fast: ActiveFastState | null) => {
    const today = getTodayIsoDate();
    commitDatabase((prev) => {
      let nextElectrolytes = prev.electrolytesByDate ?? {};
      if (fast && prev.activeFast && fast.electrolytesCount !== prev.activeFast.electrolytesCount) {
        const diff = fast.electrolytesCount - prev.activeFast.electrolytesCount;
        const currentStored = nextElectrolytes[today] ?? 0;
        nextElectrolytes = {
          ...nextElectrolytes,
          [today]: Math.max(0, currentStored + diff),
        };
      }
      return {
        ...prev,
        activeFast: fast,
        electrolytesByDate: nextElectrolytes,
      };
    });
  };

  const handleCompleteFast = (entry: FastingHistoryEntry) => {
    commitDatabase((prev) => ({
      ...prev,
      activeFast: null,
      fastingHistory: [entry, ...(prev.fastingHistory ?? [])],
    }));
  };

  const handleSaveCardioSession = (session: CardioSession) => {
    commitDatabase((prev) => {
      const nextShoes = (prev.shoes ?? []).map((shoe) =>
        session.shoeId && shoe.id === session.shoeId
          ? {
              ...shoe,
              accumulatedKm: Math.round((shoe.accumulatedKm + session.distanceKm) * 100) / 100,
            }
          : shoe,
      );
      return {
        ...prev,
        cardioSessions: [session, ...(prev.cardioSessions ?? [])],
        shoes: nextShoes,
      };
    });
    void notifyPushActivity('workout', session.date || getTodayIsoDate());
  };

  const handleDeleteCardioSession = (id: string) => {
    void commitImmediateDelete('cardio', id, { reconcilePush: true });
  };

  const handleAddShoe = (name: string, brand?: string) => {
    commitDatabase((prev) => {
      const existing = prev.shoes ?? [];
      const newShoe: ShoeGear = {
        id: `shoe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        brand,
        accumulatedKm: 0,
        maxAlertKm: 650,
        isActive: existing.length === 0,
        createdAt: new Date().toISOString(),
      };
      return {
        ...prev,
        shoes: [newShoe, ...existing],
      };
    });
  };

  const handleSetActiveShoe = (id: string) => {
    commitDatabase((prev) => ({
      ...prev,
      shoes: (prev.shoes ?? []).map((s) => ({
        ...s,
        isActive: s.id === id,
      })),
    }));
  };

  const handleDeleteShoe = (id: string) => {
    void commitImmediateDelete('shoes', id);
  };

  const handleAddManualSteps = (date: string, deltaSteps: number) => {
    const safeSteps = Math.max(0, Math.round(deltaSteps));
    if (safeSteps <= 0) return;
    const hour = new Date().getHours();
    const estMin = Math.max(1, Math.round(safeSteps / 110));
    const estKcal = Math.max(1, Math.round(safeSteps * 0.04));

    commitDatabase((prev) => {
      const currentMap = prev.manualActivityByDate ?? {};
      const existing = currentMap[date];
      const nextHourly = { ...(existing?.hourlySteps ?? {}) };
      nextHourly[hour] = (nextHourly[hour] ?? 0) + safeSteps;
      const addedDistKm = estimateDistanceKmFromSteps(safeSteps, prev.profile.heightCm);
      const prevDistKm =
        typeof existing?.distanceKm === 'number'
          ? existing.distanceKm
          : estimateDistanceKmFromSteps(existing?.steps ?? 0, prev.profile.heightCm);

      return {
        ...prev,
        manualActivityByDate: {
          ...currentMap,
          [date]: {
            date,
            steps: (existing?.steps ?? 0) + safeSteps,
            activeMin: (existing?.activeMin ?? 0) + estMin,
            activeKcal: (existing?.activeKcal ?? 0) + estKcal,
            distanceKm: Math.round((prevDistKm + addedDistKm) * 100) / 100,
            source: existing?.source ?? 'manual',
            hourlySteps: nextHourly,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  };

  const handleImportManualActivity = (entries: ManualDailyActivity[]) => {
    if (entries.length === 0) return;
    commitDatabase((prev) => {
      const nextMap = { ...(prev.manualActivityByDate ?? {}) };
      for (const entry of entries) {
        if (!entry.date) continue;
        nextMap[entry.date] = {
          ...nextMap[entry.date],
          ...entry,
        };
      }
      return {
        ...prev,
        manualActivityByDate: nextMap,
      };
    });
  };

  const handleSaveReadiness = (entry: DailyReadinessEntry) => {
    commitDatabase((prev) => ({
      ...prev,
      readinessByDate: {
        ...(prev.readinessByDate ?? {}),
        [entry.date]: entry,
      },
    }));
  };

  const handleSaveSleepSession = (session: SleepSession) => {
    commitDatabase((prev) => {
      const existingReadiness = prev.readinessByDate?.[session.date] ?? null;
      const autoReadiness = convertSleepToReadiness(session, existingReadiness);
      return {
        ...prev,
        sleepSessions: [
          session,
          ...(prev.sleepSessions ?? []).filter((s) => s.id !== session.id),
        ],
        readinessByDate: {
          ...(prev.readinessByDate ?? {}),
          [session.date]: autoReadiness,
        },
      };
    });
  };

  const handleDeleteSleepSession = (id: string) => {
    void commitImmediateDelete('sleep', id);
  };

  const handleSavePulseRecord = (record: PulseHrvRecord) => {
    commitDatabase((prev) => {
      const existingReadiness = prev.readinessByDate?.[record.date] ?? null;
      const updatedReadiness = applyPulseToReadiness(record, existingReadiness);
      return {
        ...prev,
        pulseHrvRecords: [
          record,
          ...(prev.pulseHrvRecords ?? []).filter((p) => p.id !== record.id),
        ],
        readinessByDate: {
          ...(prev.readinessByDate ?? {}),
          [record.date]: updatedReadiness,
        },
      };
    });
  };

  const handleDeletePulseRecord = (id: string) => {
    void commitImmediateDelete('pulse', id);
  };

  const handleSaveBloodPressureRecord = (record: BloodPressureRecord) => {
    commitDatabase((prev) => ({
      ...prev,
      bloodPressureRecords: [
        record,
        ...(prev.bloodPressureRecords ?? []).filter((b) => b.id !== record.id),
      ],
    }));
  };

  const handleDeleteBloodPressureRecord = (id: string) => {
    void commitImmediateDelete('blood_pressure', id);
  };

  const handleClearDay = async (dateIso: string, includePhotos: boolean) => {
    const targetProfileId = activeProfileIdRef.current;
    if (!isLoaded || !isDatabaseHydrated(targetProfileId)) return;

    const { nextDb, deletedPhotoIds } = deleteDayRecordsInDb(
      databaseRef.current,
      dateIso,
      { includeProgressPhotos: includePhotos },
    );
    databaseRef.current = nextDb;
    setDatabase(nextDb);

    if (deletedPhotoIds.length > 0) {
      await deleteProgressPhotoBlobs(deletedPhotoIds);
    }
    await persistProfileDatabaseImmediate(nextDb, targetProfileId);
    void reconcilePushActivityState(nextDb);
  };

  const handleClearCategory = async (category: CleanupCategoryId) => {
    const targetProfileId = activeProfileIdRef.current;
    if (!isLoaded || !isDatabaseHydrated(targetProfileId)) return;

    const { nextDb, deletedPhotoIds } = clearCategoryInDb(
      databaseRef.current,
      category,
    );
    databaseRef.current = nextDb;
    setDatabase(nextDb);
    if (category === 'workouts') {
      setLastCompletedSession(null);
    }

    if (deletedPhotoIds.length > 0) {
      await deleteProgressPhotoBlobs(deletedPhotoIds);
    }
    await persistProfileDatabaseImmediate(nextDb, targetProfileId);
    if (
      category === 'workouts' ||
      category === 'hiit' ||
      category === 'cardio' ||
      category === 'hydration'
    ) {
      void reconcilePushActivityState(nextDb);
    }
  };

  const handleClearProfileHistory = async () => {
    const targetProfileId = activeProfileIdRef.current;
    if (!isLoaded || !isDatabaseHydrated(targetProfileId)) return;

    const { nextDb, deletedPhotoIds } = clearProfileHistoryPreserveProfile(
      databaseRef.current,
    );
    databaseRef.current = nextDb;
    setDatabase(nextDb);
    setLastCompletedSession(null);

    if (deletedPhotoIds.length > 0) {
      await deleteProgressPhotoBlobs(deletedPhotoIds);
    }
    await persistProfileDatabaseImmediate(nextDb, targetProfileId);
    void reconcilePushActivityState(nextDb);
  };

  const handleFactoryReset = async () => {
    cancelCoachSpeech();
    await clearAllProgressPhotoBlobs();
    const cleanDb = await wipeAllPulsoFitStorage();

    setProfileSlots(DEFAULT_PROFILE_SLOTS);
    setActiveProfileIdState('main');
    activeProfileIdRef.current = 'main';
    databaseRef.current = cleanDb;
    setDatabase(cleanDb);
    setLastCompletedSession(null);
    setIsProfileMenuOpen(false);
    setIsLoaded(true);
    void reconcilePushActivityState(cleanDb);
  };

  const handleUpdateCoachState = (
    personality: CoachPersonality,
    nextHistory: CoachChatMessage[],
  ) => {
    commitDatabase((prev) => ({
      ...prev,
      coachPersonality: personality,
      coachChatHistory: nextHistory.slice(-6),
    }));
  };

  const handleToggleScheduledRestToday = (dateIso: string) => {
    commitDatabase((prev) => {
      const existing = prev.scheduledRestDates ?? [];
      const hasDate = existing.includes(dateIso);
      const nextDates = hasDate
        ? existing.filter((d) => d !== dateIso)
        : [...existing, dateIso].sort();
      return {
        ...prev,
        scheduledRestDates: nextDates,
      };
    });
  };

  const handleAddElectrolytesAndWater = (dateIso: string) => {
    const today = getTodayIsoDate();
    const addedMl = 500;
    commitDatabase((prev) => {
      const currentWater = prev.hydrationByDate[dateIso] ?? 0;
      const existingLogs = prev.hydrationLogsByDate?.[dateIso] ?? [];
      const nextLogs = [
        ...existingLogs,
        {
          id: `hyd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          date: dateIso,
          amountMl: addedMl,
          recordedAt: new Date().toISOString(),
        },
      ];

      const prevCount = prev.electrolytesByDate?.[dateIso] ?? 0;
      const baseCount =
        dateIso === today && prev.activeFast
          ? Math.max(prevCount, prev.activeFast.electrolytesCount ?? 0)
          : prevCount;
      const nextCount = baseCount + 1;

      const nextActiveFast =
        prev.activeFast && dateIso === today
          ? {
              ...prev.activeFast,
              waterGlassesCount: prev.activeFast.waterGlassesCount + 2,
              electrolytesCount: nextCount,
            }
          : prev.activeFast;

      return {
        ...prev,
        activeFast: nextActiveFast,
        hydrationByDate: {
          ...prev.hydrationByDate,
          [dateIso]: currentWater + addedMl,
        },
        hydrationLogsByDate: {
          ...(prev.hydrationLogsByDate ?? {}),
          [dateIso]: nextLogs,
        },
        electrolytesByDate: {
          ...(prev.electrolytesByDate ?? {}),
          [dateIso]: nextCount,
        },
      };
    });
    void notifyPushActivity('water', dateIso);
  };

  const handleCompleteActivePause = (dateIso: string, minutesEarned: number) => {
    const safeMins = Math.max(1, Math.round(minutesEarned));
    const estKcal = Math.max(8, Math.round(safeMins * 4));
    const nowIso = new Date().toISOString();

    commitDatabase((prev) => {
      const currentMap = prev.manualActivityByDate ?? {};
      const existing = currentMap[dateIso];
      return {
        ...prev,
        manualActivityByDate: {
          ...currentMap,
          [dateIso]: {
            date: dateIso,
            steps: existing?.steps ?? 0,
            activeMin: (existing?.activeMin ?? 0) + safeMins,
            activeKcal: (existing?.activeKcal ?? 0) + estKcal,
            distanceKm: existing?.distanceKm,
            source: existing?.source ?? 'manual',
            hourlySteps: existing?.hourlySteps,
            pausaActivaCount: (existing?.pausaActivaCount ?? 0) + 1,
            lastPausaActivaAt: nowIso,
            updatedAt: nowIso,
          },
        },
      };
    });
  };

  return (
    <div className="min-h-[100dvh] bg-[#0A0B0D] text-[#F4F5F7] flex flex-col">
      <OfflineIndicator />

      {/* Compact Top Bar with Quick Profile Selector */}
      <header className="pt-safe border-b border-white/5 bg-[#0A0B0D] relative z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
          <span className="text-2xl font-extrabold font-display tracking-tight text-white whitespace-nowrap shrink-0">
            Pulso<span className="text-[#D4FF33]">Fit</span>
          </span>

          <div className="flex items-center gap-2 shrink-0">
            {lowPower.isLowPower && (
              <button
                type="button"
                onClick={() => setActiveTab('perfil')}
                title="Modo Bajo Consumo activo (toca para configurar)"
                aria-label="Modo Bajo Consumo activo"
                className="min-h-[34px] inline-flex items-center gap-1 rounded-xl border border-amber-400/40 bg-amber-500/12 px-2 text-[10px] font-extrabold text-amber-300 hover:border-amber-300/70 transition-colors"
              >
                <BatteryLow className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                <span className="hidden sm:inline">
                  {lowPower.battery.level !== null
                    ? `${Math.round(lowPower.battery.level * 100)}%`
                    : 'ECO'}
                </span>
              </button>
            )}

            {/* Quick 1-Tap Profile Pill Switcher + Custom Profile Manager */}
            <div ref={profileMenuRef} className="relative flex items-center gap-1">
              <div
                role="tablist"
                aria-label="Cambiar perfil activo en 1 toque"
                className="flex items-center gap-0.5 rounded-full border border-[#252A36] bg-[#13161F] p-0.5 max-w-[180px] sm:max-w-[300px] overflow-x-auto no-scrollbar"
              >
                {profileSlots.map((slot) => {
                  const active = slot.id === activeProfileId;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => void handleSelectProfile(slot.id)}
                      className={`min-h-[30px] px-2.5 rounded-full text-[11px] font-extrabold whitespace-nowrap shrink-0 transition-colors ${
                        active
                          ? 'bg-[#D4FF33] text-[#0A0B0D] shadow-sm'
                          : 'text-zinc-300 hover:text-white'
                      }`}
                    >
                      {slot.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setIsProfileMenuOpen((v) => !v)}
                aria-expanded={isProfileMenuOpen}
                aria-label="Administrar o agregar perfil"
                title="Administrar perfiles"
                className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-full border border-[#252A36] bg-[#13161F] hover:border-[#D4FF33]/50 text-[#D4FF33] transition-colors shrink-0"
              >
                <Users className="w-3.5 h-3.5" />
              </button>

              {isProfileMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-[#282D3B] bg-[#11141C] shadow-2xl p-3 space-y-2.5 z-50">
                  <div className="px-1">
                    <p className="text-xs font-bold text-white">
                      Perfiles rápidos (datos aislados)
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      Cada perfil guarda su propio historial, báscula y comidas en PulsoFitDB.
                    </p>
                  </div>

                  <div className="space-y-1 max-h-52 overflow-y-auto">
                    {profileSlots.map((slot) => {
                      const active = slot.id === activeProfileId;
                      return (
                        <div key={slot.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleSelectProfile(slot.id)}
                            className={`flex-1 min-h-[40px] rounded-xl px-3 text-left text-xs font-bold flex items-center justify-between gap-2 transition-colors ${
                              active
                                ? 'bg-[#D4FF33] text-[#0A0B0D]'
                                : 'bg-[#181C26] text-zinc-200 hover:bg-[#1E2330]'
                            }`}
                          >
                            <span className="truncate">{slot.label}</span>
                            {active && <Check className="w-4 h-4 shrink-0" />}
                          </button>
                          {!slot.isDefault && (
                            <InlineDeleteConfirmButton
                              onConfirm={() => void handleDeleteCustomProfile(slot.id)}
                              ariaLabel={`Eliminar perfil ${slot.label}`}
                              size="sm"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <form
                    onSubmit={handleCreateProfile}
                    className="pt-2 border-t border-white/10 flex items-center gap-1.5"
                  >
                    <input
                      type="text"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      placeholder="Nuevo familiar (ej. Ana)"
                      maxLength={24}
                      className="flex-1 min-w-0 min-h-[38px] rounded-xl border border-[#292E3C] bg-[#0B0C0F] px-2.5 text-xs text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!newProfileName.trim()}
                      aria-label="Agregar nuevo perfil"
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-[#D4FF33] text-[#0A0B0D] disabled:opacity-40"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </form>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setOpenMusicModalTick((t) => t + 1)}
              aria-label="Abrir reproductor offline y ecualizador"
              title="Reproductor de audio y EQ"
              className={`min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-full border transition-colors shrink-0 ${
                isMusicPlaying
                  ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-[#D4FF33]'
                  : hasMusicTracks
                    ? 'border-[#2E3546] bg-[#13161F] text-[#D4FF33] hover:border-[#D4FF33]/60'
                    : 'border-[#252A36] bg-[#13161F] text-zinc-300 hover:text-[#D4FF33]'
              }`}
            >
              <Music2 className="w-3.5 h-3.5" />
            </button>

            <PWAInstallButton variant="compact" />
          </div>
        </div>
      </header>

      {/* In-app Hydration Reminder Visual Banner */}
      {inAppHydrationAlert && (
        <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 pt-3">
          <div
            role="alert"
            className="rounded-2xl border border-sky-400/50 bg-[#101826] px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-lg"
          >
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              <BellRing className="w-5 h-5 text-sky-300 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-extrabold text-white">
                  {inAppHydrationAlert.title}
                </p>
                <p className="text-xs text-sky-200/90 mt-0.5">
                  {inAppHydrationAlert.body}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  handleAddWater(getTodayIsoDate(), 250);
                  setInAppHydrationAlert(null);
                }}
                className="min-h-[36px] rounded-xl bg-[#a3e635] px-3 text-xs font-extrabold text-[#0A0B0D] active:scale-[0.98]"
              >
                +250 ml
              </button>
              <button
                type="button"
                onClick={() => setInAppHydrationAlert(null)}
                aria-label="Cerrar recordatorio de agua"
                className="min-h-[36px] min-w-[36px] rounded-xl border border-white/10 bg-white/5 flex items-center justify-center text-zinc-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Scrollable Content */}
      <main
        className={`flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 pt-5 transition-[padding] duration-200 ${
          isMiniPlayerVisible ? 'pb-40' : 'pb-24'
        }`}
      >
        {!isLoaded ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-10 w-48 rounded-xl bg-[#151820]" />
            <div className="h-52 w-full rounded-3xl bg-[#151820]" />
            <div className="h-40 w-full rounded-3xl bg-[#151820]" />
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <DashboardTab
                database={database}
                profileSlots={profileSlots}
                activeProfileId={activeProfileId}
                onSelectProfile={(slotId) => void handleSelectProfile(slotId)}
                onUpdateProfile={handleUpdateProfile}
                onNavigateTab={setActiveTab}
                onOpenScale={() => setIsScaleModalOpen(true)}
                onAddManualSteps={handleAddManualSteps}
                onImportManualActivity={handleImportManualActivity}
                onUpdateCoachState={handleUpdateCoachState}
                onToggleScheduledRestToday={handleToggleScheduledRestToday}
                onOpenSleep={() => setActiveTab('sueno')}
                onOpenPulse={() => setActiveTab('salud')}
                onAddElectrolytesAndWater={handleAddElectrolytesAndWater}
                onCompleteActivePause={handleCompleteActivePause}
              />
            )}

            {activeTab === 'salud' && (
              <Suspense fallback={<DarkTabSkeleton />}>
                <SaludTab
                  profile={database.profile}
                  bodyScans={database.bodyScans}
                  bodyWeights={database.bodyWeights}
                  pulseRecords={database.pulseHrvRecords ?? []}
                  bloodPressureRecords={database.bloodPressureRecords ?? []}
                  todayReadiness={database.readinessByDate?.[getTodayIsoDate()] ?? null}
                  recoveryIndex0To100={recoveryIndexSummary.score}
                  isHydrated={isLoaded && isDatabaseHydrated(activeProfileId)}
                  onUpdateProfile={handleUpdateProfile}
                  onSaveScan={handleSaveBodyScan}
                  onOpenScale={() => setIsScaleModalOpen(true)}
                  onSavePulseRecord={handleSavePulseRecord}
                  onDeletePulseRecord={handleDeletePulseRecord}
                  onSaveBloodPressureRecord={handleSaveBloodPressureRecord}
                  onDeleteBloodPressureRecord={handleDeleteBloodPressureRecord}
                />
              </Suspense>
            )}

            {activeTab === 'entrenar' && (
              <Suspense fallback={<DarkTabSkeleton />}>
                <EntrenarTab
                  database={database}
                  profile={database.profile}
                  muscleFatigue={database.muscleFatigue}
                  workouts={database.workouts}
                  activeWorkout={database.activeWorkout}
                  lastCompletedSession={lastCompletedSession}
                  cardioSessions={database.cardioSessions ?? []}
                  shoes={database.shoes ?? []}
                  bodyWeights={database.bodyWeights}
                  bodyScans={database.bodyScans}
                  foodLogs={database.foodLogs}
                  hydrationByDate={database.hydrationByDate}
                  hydrationSettings={database.hydrationSettings}
                  adaptiveNutrition={database.adaptiveNutrition}
                  activeFast={database.activeFast ?? null}
                  readinessByDate={database.readinessByDate ?? {}}
                  workoutTemplates={database.workoutTemplates ?? []}
                  hiitSessions={database.hiitSessions ?? []}
                  onStartWorkout={handleStartWorkout}
                  onUpdateActiveWorkout={handleUpdateActiveWorkout}
                  onCompleteWorkout={handleCompleteWorkout}
                  onDismissSummary={() => setLastCompletedSession(null)}
                  onUpdateProfile={handleUpdateProfile}
                  onNavigateTab={setActiveTab}
                  onSaveCardioSession={handleSaveCardioSession}
                  onDeleteCardioSession={handleDeleteCardioSession}
                  onDeleteHiitSession={handleDeleteHiitSession}
                  onAddShoe={handleAddShoe}
                  onSetActiveShoe={handleSetActiveShoe}
                  onDeleteShoe={handleDeleteShoe}
                  onSaveReadiness={handleSaveReadiness}
                  onAddManualSteps={handleAddManualSteps}
                  openWalkSignal={openCardioWalkTick}
                  onOpenSleep={() => setActiveTab('sueno')}
                  onOpenPulse={() => setActiveTab('salud')}
                />
              </Suspense>
            )}

            {activeTab === 'nutricion' && (
              <Suspense fallback={<DarkTabSkeleton />}>
                <NutricionTab
                  profile={database.profile}
                  bodyWeights={database.bodyWeights}
                  bodyScans={database.bodyScans}
                  workouts={database.workouts}
                  cardioSessions={database.cardioSessions ?? []}
                  hiitSessions={database.hiitSessions ?? []}
                  foodLogs={database.foodLogs}
                  hydrationByDate={database.hydrationByDate}
                  hydrationLogsByDate={database.hydrationLogsByDate ?? {}}
                  hydrationSettings={database.hydrationSettings}
                  adaptiveNutrition={database.adaptiveNutrition}
                  activeFast={database.activeFast ?? null}
                  fastingHistory={database.fastingHistory ?? []}
                  weeklyMealPlan={database.weeklyMealPlan ?? null}
                  onLogBodyWeight={handleLogBodyWeight}
                  onAddFood={handleAddFood}
                  onDeleteFood={handleDeleteFood}
                  onAddWater={handleAddWater}
                  onUndoLastWater={handleUndoLastWater}
                  onUpdateHydrationSettings={handleUpdateHydrationSettings}
                  onSaveAdaptiveNutrition={handleSaveAdaptiveNutrition}
                  onSaveWeeklyMealPlan={handleSaveWeeklyMealPlan}
                  onStartFast={handleStartFast}
                  onUpdateActiveFast={handleUpdateActiveFast}
                  onCompleteFast={handleCompleteFast}
                  onOpenScale={() => setIsScaleModalOpen(true)}
                />
              </Suspense>
            )}

            {activeTab === 'hidratacion' && (
              <Suspense fallback={<DarkTabSkeleton />}>
                <HidratacionTab
                  profile={database.profile}
                  bodyWeights={database.bodyWeights}
                  bodyScans={database.bodyScans}
                  workouts={database.workouts}
                  cardioSessions={database.cardioSessions ?? []}
                  hiitSessions={database.hiitSessions ?? []}
                  hydrationByDate={database.hydrationByDate}
                  hydrationLogsByDate={database.hydrationLogsByDate ?? {}}
                  hydrationSettings={
                    database.hydrationSettings ?? {
                      mlPerKg: 35,
                      containerMl: 500,
                      wakeHour: 7,
                      sleepHour: 22,
                      hotDayByDate: {},
                      remindersEnabled: false,
                    }
                  }
                  electrolytesByDate={database.electrolytesByDate ?? {}}
                  activeFast={database.activeFast ?? null}
                  fastingHistory={database.fastingHistory ?? []}
                  onUpdateProfile={handleUpdateProfile}
                  onAddWater={handleAddWater}
                  onUndoLastWater={handleUndoLastWater}
                  onDeleteWaterLog={handleDeleteWaterLog}
                  onUpdateHydrationSettings={handleUpdateHydrationSettings}
                  onUpdateElectrolytes={handleUpdateElectrolytes}
                  onOpenPushSettings={() => {
                    setOpenPushTick((t) => t + 1);
                    setActiveTab('perfil');
                  }}
                />
              </Suspense>
            )}

            {activeTab === 'sueno' && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2">
                    <Moon className="w-6 h-6 text-[#D4FF33]" />
                    <h1 className="text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">
                      Sueño y Descanso
                    </h1>
                  </div>
                  <p className="mt-1 text-sm text-zinc-400">
                    Fases de sueño (Profundo, REM, Ligero, Despierto), ciclos de 90 min e hipnograma nocturno
                  </p>
                </div>

                <Suspense fallback={<DarkTabSkeleton />}>
                  <SleepRecoverySection
                    sleepSessions={database.sleepSessions ?? []}
                    todayReadiness={database.readinessByDate?.[getTodayIsoDate()] ?? null}
                    onSaveSleepSession={handleSaveSleepSession}
                    onDeleteSleepSession={handleDeleteSleepSession}
                  />
                </Suspense>
              </div>
            )}

            {activeTab === 'progreso' && (
              <Suspense fallback={<DarkTabSkeleton />}>
                <ProgresoTab
                  database={database}
                  profile={database.profile}
                  onUpdateProfile={handleUpdateProfile}
                  onDeleteWorkout={handleDeleteWorkout}
                  onDeleteHiitSession={handleDeleteHiitSession}
                  onDeleteCardioSession={handleDeleteCardioSession}
                  onDeleteBodyScan={handleDeleteBodyScan}
                  onDeleteBodyWeight={handleDeleteBodyWeight}
                  onDeleteFood={handleDeleteFood}
                  onDeleteFastHistory={handleDeleteFastHistory}
                  onDeleteSleepSession={handleDeleteSleepSession}
                  onDeletePulseRecord={handleDeletePulseRecord}
                  onDeleteBloodPressureRecord={handleDeleteBloodPressureRecord}
                  onDeleteWaterLog={handleDeleteWaterLog}
                  onClearDay={handleClearDay}
                  onOpenScale={() => setIsScaleModalOpen(true)}
                  onOpenSleep={() => setActiveTab('sueno')}
                  onOpenPulse={() => setActiveTab('salud')}
                />
              </Suspense>
            )}

            {activeTab === 'perfil' && (
              <Suspense fallback={<DarkTabSkeleton />}>
                <PerfilTab
                  database={database}
                  activeProfileLabel={activeProfileLabel}
                  onUpdateProfile={handleUpdateProfile}
                  onResetMuscleFatigue={handleResetMuscleFatigue}
                  onImportDatabase={handleImportDatabase}
                  openDatosSignal={openDatosTick}
                  openSleepSignal={openSleepTick}
                  openPulseSignal={openPulseTick}
                  onDeleteWorkout={handleDeleteWorkout}
                  onDeleteHiitSession={handleDeleteHiitSession}
                  onDeleteCardioSession={handleDeleteCardioSession}
                  onDeleteBodyScan={handleDeleteBodyScan}
                  onDeleteBodyWeight={handleDeleteBodyWeight}
                  onDeleteFood={handleDeleteFood}
                  onDeleteWaterLog={handleDeleteWaterLog}
                  onSaveSleepSession={handleSaveSleepSession}
                  onDeleteSleepSession={handleDeleteSleepSession}
                  onSavePulseRecord={handleSavePulseRecord}
                  onDeletePulseRecord={handleDeletePulseRecord}
                  onSaveBloodPressureRecord={handleSaveBloodPressureRecord}
                  onDeleteBloodPressureRecord={handleDeleteBloodPressureRecord}
                  onOpenScale={() => setIsScaleModalOpen(true)}
                  onClearCategory={handleClearCategory}
                  onClearProfileHistory={handleClearProfileHistory}
                  onFactoryReset={handleFactoryReset}
                  onUpdateHydrationSettings={handleUpdateHydrationSettings}
                  isHydrated={isLoaded && isDatabaseHydrated(activeProfileId)}
                  openPushSettingsSignal={openPushTick}
                />
              </Suspense>
            )}
          </>
        )}
      </main>

      {isScaleModalOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-lg h-72 rounded-3xl border border-[#222631] bg-[#12141A] animate-pulse" />
            </div>
          }
        >
          <SmartScaleModal
            isOpen={isScaleModalOpen}
            onClose={() => setIsScaleModalOpen(false)}
            profile={database.profile}
            bodyScans={database.bodyScans}
            onSaveScan={handleSaveBodyScan}
            onDeleteScan={handleDeleteBodyScan}
          />
        </Suspense>
      )}

      {/* Unified Fixed Bottom Dock: Mini-Player above 8-Tab Navigation */}
      <div className="fixed bottom-0 inset-x-0 z-40 flex flex-col pb-[env(safe-area-inset-bottom)] bg-[#0A0B0D]/95 backdrop-blur-md">
        <MusicPlayerBar
          openModalSignal={openMusicModalTick}
          onMiniPlayerVisibleChange={setIsMiniPlayerVisible}
          onPlayingStateChange={(playing, hasTracks) => {
            setIsMusicPlaying(playing);
            setHasMusicTracks(hasTracks);
          }}
        />

        {/* Scrollable 8-Tab Mobile Bottom Navigation */}
        <nav
          aria-label="Navegación principal"
          className="w-full border-t border-[#1E222B] bg-[#0A0B0D]/95"
        >
          <div className="max-w-4xl mx-auto flex items-center overflow-x-auto no-scrollbar w-full h-[70px] px-2 gap-1 sm:justify-around">
            {TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id;
              const hasWorkoutBadge = id === 'entrenar' && database.activeWorkout !== null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex flex-col items-center justify-center shrink-0 min-w-[74px] sm:min-w-0 sm:flex-1 h-14 px-1.5 rounded-xl transition-colors active:scale-95 ${
                    active ? 'text-[#D4FF33] bg-[#D4FF33]/10' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="relative">
                    <Icon className="w-[18px] h-[18px]" />
                    {hasWorkoutBadge && (
                      <span
                        aria-label="Entrenamiento activo"
                        className="absolute -top-1 -right-2.5 text-[8px] font-extrabold text-[#0A0B0D] bg-[#D4FF33] px-1 rounded"
                      >
                        ON
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] leading-none font-semibold tracking-tight mt-1 whitespace-nowrap text-center">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
