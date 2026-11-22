import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bluetooth,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShoppingCart,
  Sparkles,
  X,
} from 'lucide-react';
import { InlineDeleteConfirmButton } from './InlineDeleteConfirmButton';
import {
  FOOD_PRESETS,
  calculateNutritionTargets,
  type FoodPreset,
} from '../data/foods';
import {
  computeSmoothedWeightTrend,
  runWeeklyAdaptiveCheckIn,
} from '../lib/adaptiveNutrition';
import { estimateNutritionAi } from '../lib/aiClient';
import { computeDailyExerciseBurn } from '../lib/crossModuleIntelligence';
import { getTodayIsoDate } from '../lib/storage';
import {
  displayWeightToKg,
  formatWeight,
  getWeightUnit,
  kgToDisplayWeight,
} from '../lib/units';
import type {
  ActiveFastState,
  AdaptiveNutritionState,
  BodyCompositionScan,
  BodyWeightEntry,
  CardioSession,
  FastingHistoryEntry,
  FoodEntry,
  HiitSession,
  HydrationLogEntry,
  HydrationSettings,
  MealType,
  UserProfile,
  WeeklyMealPlan,
  WorkoutSession,
} from '../types/fitness';
import { FastingSection } from './FastingSection';
import {
  copyTextToClipboard,
  downloadShoppingListTxt,
  formatShoppingListAsText,
} from '../lib/shoppingListExport';

const PlateScannerModal = React.lazy(() =>
  import('./PlateScannerModal').then((m) => ({ default: m.PlateScannerModal })),
);
const WeeklyMealPlanModal = React.lazy(() =>
  import('./WeeklyMealPlanModal').then((m) => ({
    default: m.WeeklyMealPlanModal,
  })),
);

const DarkNutriModalFallback: React.FC = () => (
  <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="w-full max-w-lg h-72 rounded-3xl border border-[#222631] bg-[#12141A] animate-pulse" />
  </div>
);

interface NutricionTabProps {
  profile: UserProfile;
  bodyWeights: BodyWeightEntry[];
  bodyScans?: BodyCompositionScan[];
  workouts?: WorkoutSession[];
  cardioSessions?: CardioSession[];
  hiitSessions?: HiitSession[];
  foodLogs: FoodEntry[];
  hydrationByDate: Record<string, number>;
  hydrationLogsByDate?: Record<string, HydrationLogEntry[]>;
  hydrationSettings?: HydrationSettings;
  adaptiveNutrition?: AdaptiveNutritionState | null;
  activeFast?: ActiveFastState | null;
  fastingHistory?: FastingHistoryEntry[];
  weeklyMealPlan?: WeeklyMealPlan | null;
  onLogBodyWeight: (weightKg: number, date: string) => void;
  onAddFood: (entry: Omit<FoodEntry, 'id' | 'createdAt'>) => void;
  onDeleteFood: (id: string) => void;
  onAddWater: (date: string, deltaMl: number) => void;
  onUndoLastWater: (date: string) => void;
  onUpdateHydrationSettings: (next: HydrationSettings) => void;
  onSaveAdaptiveNutrition: (state: AdaptiveNutritionState | null) => void;
  onSaveWeeklyMealPlan?: (plan: WeeklyMealPlan | null) => void;
  onStartFast: (fast: ActiveFastState) => void;
  onUpdateActiveFast: (fast: ActiveFastState | null) => void;
  onCompleteFast: (entry: FastingHistoryEntry) => void;
  onOpenScale: () => void;
}

interface AiFoodItem {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

const MEAL_SECTIONS: { id: MealType; label: string }[] = [
  { id: 'desayuno', label: 'Desayuno' },
  { id: 'almuerzo', label: 'Almuerzo' },
  { id: 'cena', label: 'Cena' },
  { id: 'snack', label: 'Snacks y pre/post entreno' },
];

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

function formatDateLabel(isoDate: string): string {
  const today = getTodayIsoDate();
  if (isoDate === today) return 'Hoy';
  if (isoDate === shiftIsoDate(today, -1)) return 'Ayer';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export const NutricionTab: React.FC<NutricionTabProps> = ({
  profile,
  bodyWeights,
  bodyScans = [],
  workouts = [],
  cardioSessions = [],
  hiitSessions = [],
  foodLogs,
  adaptiveNutrition,
  activeFast = null,
  fastingHistory = [],
  weeklyMealPlan = null,
  onLogBodyWeight,
  onAddFood,
  onDeleteFood,
  onSaveAdaptiveNutrition,
  onSaveWeeklyMealPlan = () => {},
  onStartFast,
  onUpdateActiveFast,
  onCompleteFast,
  onOpenScale,
}) => {
  const weightUnit = getWeightUnit(profile.weightUnit);
  const [selectedDate, setSelectedDate] = useState(getTodayIsoDate());
  const [activeMealModal, setActiveMealModal] = useState<MealType | null>(null);
  const [modalMode, setModalMode] = useState<'ia' | 'manual' | 'rapido'>('ia');
  const [searchQuery, setSearchQuery] = useState('');
  const [feedingWindowBanner, setFeedingWindowBanner] = useState<FastingHistoryEntry | null>(null);
  const [isPlateScannerOpen, setIsPlateScannerOpen] = useState(false);
  const [scannerInitialMeal, setScannerInitialMeal] = useState<MealType>('almuerzo');
  const [isWeeklyPlanOpen, setIsWeeklyPlanOpen] = useState(false);
  const [weeklyPlanInitialView, setWeeklyPlanInitialView] = useState<'menu' | 'lista'>('menu');
  const [weeklyExportNotice, setWeeklyExportNotice] = useState<string | null>(null);
  const mealsSectionRef = useRef<HTMLDivElement | null>(null);

  // Fasting weight input for selectedDate
  const existingWeightForDate = useMemo(
    () => bodyWeights.find((w) => w.date === selectedDate)?.weightKg,
    [bodyWeights, selectedDate],
  );
  const [fastingWeightInput, setFastingWeightInput] = useState(
    String(kgToDisplayWeight(existingWeightForDate ?? profile.weightKg, weightUnit)),
  );
  const [weightSavedBanner, setWeightSavedBanner] = useState(false);

  useEffect(() => {
    setFastingWeightInput(
      String(kgToDisplayWeight(existingWeightForDate ?? profile.weightKg, weightUnit)),
    );
  }, [selectedDate, existingWeightForDate, profile.weightKg, weightUnit]);

  // AI food estimator state
  const [aiMealText, setAiMealText] = useState('');
  const [aiEstimatedItems, setAiEstimatedItems] = useState<AiFoodItem[]>([]);
  const [isEstimatingMacros, setIsEstimatingMacros] = useState(false);
  const [aiMacroError, setAiMacroError] = useState<string | null>(null);

  // Manual food form state
  const [customName, setCustomName] = useState('');
  const [customCalories, setCustomCalories] = useState('');
  const [customProtein, setCustomProtein] = useState('');
  const [customCarbs, setCustomCarbs] = useState('');
  const [customFat, setCustomFat] = useState('');

  // Weekly Check-in feedback
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [checkInDoneBanner, setCheckInDoneBanner] = useState(false);

  const baseTargets = useMemo(() => calculateNutritionTargets(profile), [profile]);
  const activeTargets = useMemo(() => {
    if (adaptiveNutrition) {
      return {
        calories: adaptiveNutrition.calorieTarget,
        proteinG: adaptiveNutrition.proteinG,
        carbsG: adaptiveNutrition.carbsG,
        fatG: adaptiveNutrition.fatG,
        waterMl: adaptiveNutrition.waterMl,
        tdee: adaptiveNutrition.estimatedTdee,
        isAdaptive: true,
      };
    }
    return {
      calories: baseTargets.calories,
      proteinG: baseTargets.proteinG,
      carbsG: baseTargets.carbsG,
      fatG: baseTargets.fatG,
      waterMl: baseTargets.waterMl,
      tdee: baseTargets.tdee,
      isAdaptive: false,
    };
  }, [adaptiveNutrition, baseTargets]);

  const smoothedTrend = useMemo(
    () => computeSmoothedWeightTrend(bodyWeights),
    [bodyWeights],
  );
  const latestTrendPoint = smoothedTrend[smoothedTrend.length - 1] ?? null;

  const dayFoods = useMemo(
    () => foodLogs.filter((f) => f.date === selectedDate),
    [foodLogs, selectedDate],
  );

  const totals = useMemo(
    () =>
      dayFoods.reduce(
        (acc, item) => ({
          calories: acc.calories + item.calories,
          proteinG: acc.proteinG + item.proteinG,
          carbsG: acc.carbsG + item.carbsG,
          fatG: acc.fatG + item.fatG,
        }),
        { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      ),
    [dayFoods],
  );

  // Last 7 days average calories preview
  const last7DaysStats = useMemo(() => {
    const startIso = shiftIsoDate(selectedDate, -6);
    const byDay = new Map<string, number>();
    for (const f of foodLogs) {
      if (f.date >= startIso && f.date <= selectedDate) {
        byDay.set(f.date, (byDay.get(f.date) ?? 0) + f.calories);
      }
    }
    const days = byDay.size;
    const sum = Array.from(byDay.values()).reduce((a, b) => a + b, 0);
    return {
      loggedDays: days,
      avgCalories: days > 0 ? Math.round(sum / days) : 0,
    };
  }, [foodLogs, selectedDate]);

  const dayExerciseBurn = useMemo(
    () =>
      computeDailyExerciseBurn(
        profile,
        workouts,
        cardioSessions,
        hiitSessions,
        selectedDate,
      ),
    [profile, workouts, cardioSessions, hiitSessions, selectedDate],
  );
  const dayExerciseCalories = dayExerciseBurn.totalExerciseKcal;
  const effectiveCalorieTarget = activeTargets.calories + dayExerciseCalories;

  const calPct = Math.min(
    100,
    Math.round((totals.calories / Math.max(1, effectiveCalorieTarget)) * 100),
  );
  const remainingCal = effectiveCalorieTarget - totals.calories;

  // Ring geometry
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (calPct / 100) * circumference;

  const filteredPresets = FOOD_PRESETS.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  const handleSaveFastingWeight = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(fastingWeightInput.replace(',', '.'));
    const minVal = weightUnit === 'lb' ? 66 : 30;
    const maxVal = weightUnit === 'lb' ? 550 : 250;
    if (Number.isNaN(val) || val < minVal || val > maxVal) return;
    const kg = Math.round(displayWeightToKg(val, weightUnit) * 10) / 10;
    onLogBodyWeight(kg, selectedDate);
    setWeightSavedBanner(true);
    window.setTimeout(() => setWeightSavedBanner(false), 2500);
  };

  const handleWeeklyCheckIn = () => {
    setCheckInError(null);
    setCheckInDoneBanner(false);
    const result = runWeeklyAdaptiveCheckIn(profile, bodyWeights, foodLogs, selectedDate);
    if (!result.ok || !result.adaptiveState) {
      setCheckInError(result.error ?? 'No se pudo completar el Check-in Semanal.');
      return;
    }
    onSaveAdaptiveNutrition(result.adaptiveState);
    setCheckInDoneBanner(true);
    window.setTimeout(() => setCheckInDoneBanner(false), 4000);
  };

  const handleEstimateWithAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiMealText.trim()) return;
    setIsEstimatingMacros(true);
    setAiMacroError(null);
    setAiEstimatedItems([]);
    try {
      const data = await estimateNutritionAi<{ items?: AiFoodItem[] }>(aiMealText.trim());
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length === 0) {
        throw new Error('No se identificaron alimentos en la descripción.');
      }
      setAiEstimatedItems(items);
    } catch (err) {
      setAiMacroError(
        err instanceof Error ? err.message : 'Error de conexión al calcular macros.',
      );
    } finally {
      setIsEstimatingMacros(false);
    }
  };

  const handleConfirmAiFoods = () => {
    if (!activeMealModal || aiEstimatedItems.length === 0) return;
    for (const item of aiEstimatedItems) {
      onAddFood({
        date: selectedDate,
        mealType: activeMealModal,
        name: item.name,
        calories: Math.max(0, Math.round(item.calories)),
        proteinG: Math.max(0, Math.round(item.proteinG)),
        carbsG: Math.max(0, Math.round(item.carbsG)),
        fatG: Math.max(0, Math.round(item.fatG)),
      });
    }
    setAiMealText('');
    setAiEstimatedItems([]);
    setActiveMealModal(null);
  };

  const handleSelectPreset = (preset: FoodPreset) => {
    if (!activeMealModal) return;
    onAddFood({
      date: selectedDate,
      mealType: activeMealModal,
      name: `${preset.name} (${preset.servingLabel})`,
      calories: preset.calories,
      proteinG: preset.proteinG,
      carbsG: preset.carbsG,
      fatG: preset.fatG,
    });
    setActiveMealModal(null);
    setSearchQuery('');
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMealModal || !customName.trim()) return;
    const calories = Math.max(0, Math.round(Number(customCalories) || 0));
    const proteinG = Math.max(0, Math.round(Number(customProtein) || 0));
    const carbsG = Math.max(0, Math.round(Number(customCarbs) || 0));
    const fatG = Math.max(0, Math.round(Number(customFat) || 0));

    onAddFood({
      date: selectedDate,
      mealType: activeMealModal,
      name: customName.trim(),
      calories: calories || proteinG * 4 + carbsG * 4 + fatG * 9,
      proteinG,
      carbsG,
      fatG,
    });

    setCustomName('');
    setCustomCalories('');
    setCustomProtein('');
    setCustomCarbs('');
    setCustomFat('');
    setActiveMealModal(null);
  };

  const goalLabel =
    profile.goal === 'perder_grasa'
      ? 'Perder grasa'
      : profile.goal === 'ganar_musculo'
        ? 'Ganar músculo'
        : 'Mantener peso';

  // Weight trend SVG chart (last 14 entries)
  const trendSlice = smoothedTrend.slice(-14);
  const allChartValues = [
    ...trendSlice.map((p) => p.rawWeightKg),
    ...trendSlice.map((p) => p.emaWeightKg),
    profile.targetWeightKg,
  ];
  const chartMin = Math.min(...allChartValues) - 1.0;
  const chartMax = Math.max(...allChartValues) + 1.0;
  const chartSpan = Math.max(1.5, chartMax - chartMin);

  return (
    <div className="space-y-6">
      {/* Header + Date Scroller */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">
            Nutrición adaptativa
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Objetivo: {goalLabel} · {activeTargets.isAdaptive ? 'TDEE real' : 'TDEE teórico'}{' '}
            <span className="font-mono text-zinc-200">{activeTargets.tdee} kcal</span>
          </p>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 rounded-2xl border border-[#222631] bg-[#12141A] p-1.5">
          <button
            type="button"
            aria-label="Día anterior"
            onClick={() => setSelectedDate((d) => shiftIsoDate(d, -1))}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-300 hover:bg-[#1C2029]"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="px-3 text-sm font-bold text-white min-w-[96px] text-center">
            {formatDateLabel(selectedDate)}
          </span>
          <button
            type="button"
            aria-label="Día siguiente"
            onClick={() => setSelectedDate((d) => shiftIsoDate(d, 1))}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-300 hover:bg-[#1C2029]"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Prominent Smart Scale & Body Composition Trigger */}
      {(() => {
        const latestScan =
          [...bodyScans].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0] ?? null;
        return (
          <button
            type="button"
            onClick={onOpenScale}
            className="w-full min-h-[68px] rounded-3xl border border-[#D4FF33]/40 bg-gradient-to-r from-[#14171F] to-[#181C26] hover:border-[#D4FF33] px-5 py-4 flex items-center justify-between gap-4 text-left active:scale-[0.99] transition-all"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-[#D4FF33] text-[#0A0B0D] flex items-center justify-center shrink-0">
                <Bluetooth className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-extrabold text-white truncate">
                  Báscula Inteligente y Composición Corporal
                </p>
                <p className="text-xs text-zinc-400 truncate mt-0.5">
                  {latestScan
                    ? `Último: ${formatWeight(latestScan.weightKg, weightUnit)} · Grasa ${latestScan.bodyFatPct}% · Músculo ${latestScan.totalMusclePct}% · 19 métricas`
                    : 'Bluetooth en vivo o captura IA · Sincroniza peso diario con tu TDEE'}
                </p>
              </div>
            </div>
            <span className="shrink-0 text-xs font-extrabold text-[#D4FF33] whitespace-nowrap">
              Pesar / Ver →
            </span>
          </button>
        );
      })()}

      {/* 1. Calorie Ring + Macros + Adaptive Check-in Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 flex items-center gap-5">
          <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
            <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke="#1F242F"
                strokeWidth="10"
              />
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={remainingCal < 0 ? '#F43F5E' : '#D4FF33'}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="transition-all duration-300"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xl font-extrabold font-mono tabular-nums text-white">
                {totals.calories}
              </span>
              <span className="text-[11px] text-zinc-400">
                / {effectiveCalorieTarget} kcal
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-3 min-w-0">
            <div>
              <p className="text-xs text-zinc-400">
                {remainingCal >= 0 ? 'Calorías disponibles' : 'Excedente calórico'}
              </p>
              <p
                className={`text-2xl font-extrabold font-mono tabular-nums ${
                  remainingCal >= 0 ? 'text-[#D4FF33]' : 'text-rose-400'
                }`}
              >
                {Math.abs(remainingCal).toLocaleString('es-ES')} kcal
              </p>
              {dayExerciseCalories > 0 && (
                <p className="text-[11px] font-mono text-amber-300 mt-0.5">
                  Base {activeTargets.calories} + {dayExerciseCalories} kcal (
                  {[
                    dayExerciseBurn.cardioKcal > 0
                      ? `${dayExerciseBurn.cardioKcal} cardio/GPS`
                      : null,
                    dayExerciseBurn.strengthKcal + dayExerciseBurn.hiitKcal > 0
                      ? `${dayExerciseBurn.strengthKcal + dayExerciseBurn.hiitKcal} rutinas`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  )
                </p>
              )}
            </div>

            <div className="space-y-2">
              {[
                {
                  label: 'Proteína',
                  current: totals.proteinG,
                  target: activeTargets.proteinG,
                  color: 'bg-[#D4FF33]',
                },
                {
                  label: 'Carbohidratos',
                  current: totals.carbsG,
                  target: activeTargets.carbsG,
                  color: 'bg-sky-400',
                },
                {
                  label: 'Grasas',
                  current: totals.fatG,
                  target: activeTargets.fatG,
                  color: 'bg-amber-400',
                },
              ].map((m) => {
                const pct = Math.min(
                  100,
                  Math.round((m.current / Math.max(1, m.target)) * 100),
                );
                return (
                  <div key={m.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-zinc-300 font-medium">{m.label}</span>
                      <span className="font-mono tabular-nums text-zinc-300">
                        {m.current} / {m.target} g
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[#1C2029] overflow-hidden">
                      <div className={`h-full ${m.color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 3. ALGORITMO SEMANAL ADAPTATIVO (Check-in Semanal) */}
        <section className="rounded-3xl border border-[#D4FF33]/35 bg-[#13161D] p-5 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-[#D4FF33]">
                Algoritmo semanal adaptativo
              </p>
              <h2 className="mt-0.5 text-2xl font-bold font-display text-white">
                Gasto energético real (TDEE)
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Últimos 7 días: {last7DaysStats.loggedDays} días registrados · Promedio{' '}
                <span className="font-mono text-white">
                  {last7DaysStats.avgCalories} kcal/día
                </span>
              </p>
            </div>
            <Activity className="w-5 h-5 text-[#D4FF33] shrink-0" />
          </div>

          {adaptiveNutrition ? (
            <div className="rounded-2xl bg-[#0D0F13] border border-[#222631] p-3.5 space-y-2">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <span className="text-[11px] text-zinc-400 block">TDEE Real</span>
                  <span className="text-base font-extrabold font-mono tabular-nums text-[#D4FF33]">
                    {adaptiveNutrition.estimatedTdee}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-400 block">Tendencia/sem</span>
                  <span className="text-base font-extrabold font-mono tabular-nums text-white">
                    {adaptiveNutrition.weeklyTrendChangeKg >= 0 ? '+' : '-'}
                    {kgToDisplayWeight(Math.abs(adaptiveNutrition.weeklyTrendChangeKg), weightUnit)} {weightUnit}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-400 block">Meta nueva</span>
                  <span className="text-base font-extrabold font-mono tabular-nums text-white">
                    {adaptiveNutrition.calorieTarget} kcal
                  </span>
                </div>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed pt-1 border-t border-white/5">
                {adaptiveNutrition.summaryNote}
              </p>
            </div>
          ) : (
            <p className="text-xs text-zinc-300 leading-relaxed">
              Registra tus comidas y peso en ayunas. Pulsa <strong>Check-in Semanal</strong> para calcular tu gasto real frente al cambio en tu tendencia suavizada y ajustar tus macros automáticamente.
            </p>
          )}

          {checkInError && (
            <p role="alert" className="text-xs font-semibold text-rose-400">
              {checkInError}
            </p>
          )}
          {checkInDoneBanner && (
            <p role="status" className="text-xs font-semibold text-[#D4FF33]">
              Check-in completado: metas diarias actualizadas para esta semana.
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleWeeklyCheckIn}
              className="flex-1 min-h-[50px] flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] px-4 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform"
            >
              <RefreshCw className="w-4 h-4" />
              Check-in Semanal
            </button>
            {adaptiveNutrition && (
              <button
                type="button"
                onClick={() => onSaveAdaptiveNutrition(null)}
                className="min-h-[50px] rounded-2xl border border-[#2B303C] bg-[#181B23] px-3.5 text-xs font-semibold text-zinc-300 hover:text-white"
              >
                Usar base
              </button>
            )}
          </div>
        </section>
      </div>

      {/* 2. PESO EN AYUNAS + TENDENCIA SUAVIZADA (EMA) */}
      <div>
        <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold font-display text-white">
                Peso en ayunas y tendencia suavizada
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Línea EMA filtra retención de líquidos y fluctuaciones diarias
              </p>
            </div>
            <Scale className="w-5 h-5 text-[#D4FF33] shrink-0" />
          </div>

          <form onSubmit={handleSaveFastingWeight} className="flex items-center gap-2.5">
            <input
              type="text"
              inputMode="decimal"
              value={fastingWeightInput}
              onChange={(e) => setFastingWeightInput(e.target.value)}
              aria-label={`Peso corporal en ayunas en ${weightUnit}`}
              className="flex-1 min-h-[48px] rounded-2xl border border-[#2B303C] bg-[#0B0C0F] px-4 text-base font-mono font-bold tabular-nums text-white focus:border-[#D4FF33] focus:outline-none"
            />
            <button
              type="submit"
              className="min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-2xl bg-[#1E222B] hover:bg-[#272D39] border border-[#D4FF33]/40 px-4 text-sm font-bold text-[#D4FF33] active:scale-[0.98] whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Guardar {weightUnit}
            </button>
          </form>

          {weightSavedBanner && (
            <p className="text-xs font-semibold text-[#D4FF33]">
              Peso en ayunas guardado para {formatDateLabel(selectedDate)}.
            </p>
          )}

          {latestTrendPoint && (
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[#0D0F13] p-3 text-center">
              <div>
                <span className="text-[11px] text-zinc-400 block">Último peso</span>
                <span className="text-sm font-bold font-mono tabular-nums text-white">
                  {formatWeight(latestTrendPoint.rawWeightKg, weightUnit)}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-zinc-400 block">Tendencia EMA</span>
                <span className="text-sm font-bold font-mono tabular-nums text-[#D4FF33]">
                  {formatWeight(latestTrendPoint.emaWeightKg, weightUnit, 1)}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-zinc-400 block">Fluctuación</span>
                <span className="text-sm font-bold font-mono tabular-nums text-zinc-300">
                  {latestTrendPoint.deltaFromTrend >= 0 ? '+' : '-'}
                  {kgToDisplayWeight(Math.abs(latestTrendPoint.deltaFromTrend), weightUnit).toFixed(1)} {weightUnit}
                </span>
              </div>
            </div>
          )}

          {/* Dual Line SVG: Raw Daily Weight vs Smoothed EMA Trend */}
          <div className="pt-1">
            <svg
              viewBox="0 0 320 125"
              className="w-full h-36 overflow-visible"
              role="img"
              aria-label="Comparativa de peso diario frente a línea de tendencia EMA"
            >
              {(() => {
                const targetY =
                  96 - ((profile.targetWeightKg - chartMin) / chartSpan) * 76;
                return (
                  <g>
                    <line
                      x1="14"
                      y1={targetY}
                      x2="306"
                      y2={targetY}
                      stroke="#3F4554"
                      strokeDasharray="4 4"
                      strokeWidth="1.2"
                    />
                    <text
                      x="16"
                      y={targetY - 4}
                      fill="#9CA3AF"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      Meta {formatWeight(profile.targetWeightKg, weightUnit)}
                    </text>
                  </g>
                );
              })()}

              {/* Daily raw weight dashed line */}
              {trendSlice.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#71717A"
                  strokeWidth="1.75"
                  strokeDasharray="3 3"
                  points={trendSlice
                    .map((pt, i) => {
                      const x = 16 + (i / (trendSlice.length - 1)) * 288;
                      const y = 96 - ((pt.rawWeightKg - chartMin) / chartSpan) * 76;
                      return `${x},${y}`;
                    })
                    .join(' ')}
                />
              )}

              {/* Smoothed EMA trend line */}
              {trendSlice.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#D4FF33"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={trendSlice
                    .map((pt, i) => {
                      const x = 16 + (i / (trendSlice.length - 1)) * 288;
                      const y = 96 - ((pt.emaWeightKg - chartMin) / chartSpan) * 76;
                      return `${x},${y}`;
                    })
                    .join(' ')}
                />
              )}

              {trendSlice.map((pt, i) => {
                const x =
                  trendSlice.length === 1
                    ? 160
                    : 16 + (i / (trendSlice.length - 1)) * 288;
                const rawY = 96 - ((pt.rawWeightKg - chartMin) / chartSpan) * 76;
                const emaY = 96 - ((pt.emaWeightKg - chartMin) / chartSpan) * 76;
                return (
                  <g key={pt.id}>
                    <circle cx={x} cy={rawY} r="3" fill="#A1A1AA" />
                    <circle
                      cx={x}
                      cy={emaY}
                      r="4"
                      fill="#D4FF33"
                      stroke="#0A0B0D"
                      strokeWidth="1.5"
                    />
                    {(i === 0 || i === trendSlice.length - 1) && (
                      <text
                        x={x}
                        y="116"
                        textAnchor="middle"
                        fill="#9CA3AF"
                        fontSize="9"
                        fontFamily="monospace"
                      >
                        {pt.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="flex items-center justify-center gap-5 text-[11px] text-zinc-400 pt-1">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-zinc-400 inline-block" />
                Peso diario
              </span>
              <span className="flex items-center gap-1.5 text-[#D4FF33] font-semibold">
                <span className="w-3 h-0.5 bg-[#D4FF33] inline-block" />
                Tendencia EMA
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* 2B. AYUNO INTERMITENTE Y OMAD */}
      <FastingSection
        activeFast={activeFast}
        fastingHistory={fastingHistory}
        remainingCalories={remainingCal}
        remainingProteinG={activeTargets.proteinG - totals.proteinG}
        calorieTarget={activeTargets.calories}
        proteinTargetG={activeTargets.proteinG}
        onStartFast={onStartFast}
        onUpdateActiveFast={onUpdateActiveFast}
        onCompleteFast={onCompleteFast}
        onFeedingWindowOpened={(completedEntry) => {
          setSelectedDate(getTodayIsoDate());
          setFeedingWindowBanner(completedEntry);
          const hour = new Date().getHours();
          const suggestedMeal: MealType =
            hour < 11 ? 'desayuno' : hour < 17 ? 'almuerzo' : 'cena';
          setModalMode('ia');
          setAiEstimatedItems([]);
          setAiMacroError(null);
          setActiveMealModal(suggestedMeal);
          mealsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }}
      />

      {feedingWindowBanner && (
        <div className="rounded-3xl border border-emerald-400/40 bg-emerald-500/10 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-emerald-300">
              Ventana de alimentación abierta tras {feedingWindowBanner.actualHours}h de ayuno
            </p>
            <p className="text-xs text-zinc-200 mt-0.5">
              Asegura tu meta hoy: te faltan{' '}
              <strong className="font-mono text-[#D4FF33]">
                {Math.max(0, activeTargets.proteinG - totals.proteinG)}g de proteína
              </strong>{' '}
              y{' '}
              <strong className="font-mono text-white">
                {Math.max(0, remainingCal)} kcal
              </strong>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFeedingWindowBanner(null)}
            className="min-h-[40px] rounded-xl bg-[#181B23] px-3 text-xs font-semibold text-zinc-300 hover:text-white"
          >
            Ocultar
          </button>
        </div>
      )}

      {/* 2C. PLAN SEMANAL CON GEMINI Y LISTA DE COMPRAS EXPORTABLE */}
      {(() => {
        const pendingItems = weeklyMealPlan
          ? weeklyMealPlan.shoppingList.filter((i) => !i.checked).length
          : 0;
        const previewDay = weeklyMealPlan?.days[0] ?? null;

        return (
          <section className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-[#D4FF33]">
                  Planificación semanal IA · Metas de tu perfil
                </p>
                <h2 className="text-2xl font-bold font-display text-white">
                  Plan de comidas semanal y lista de compras
                </h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Calculado según tu perfil:{' '}
                  <span className="font-mono text-zinc-200">
                    {baseTargets.calories} kcal · {baseTargets.proteinG}g proteína
                  </span>
                  {activeTargets.isAdaptive && (
                    <span className="text-emerald-300">
                      {' '}· Adaptativa activa ({activeTargets.calories} kcal · {activeTargets.proteinG}g)
                    </span>
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setWeeklyPlanInitialView('menu');
                  setIsWeeklyPlanOpen(true);
                }}
                className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] px-5 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform shrink-0"
              >
                <Sparkles className="w-4 h-4" />
                {weeklyMealPlan ? 'Abrir plan / Regenerar' : 'Generar plan semanal'}
              </button>
            </div>

            {weeklyMealPlan ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-white">
                        {weeklyMealPlan.days.length} días planificados
                      </span>
                      <span className="text-zinc-500">·</span>
                      <span className="font-mono text-[#D4FF33]">
                        {Math.round(weeklyMealPlan.calorieTarget)} kcal / {Math.round(weeklyMealPlan.proteinTargetG)}g prot
                      </span>
                    </div>
                    <span className="font-mono text-zinc-400">
                      {pendingItems} artículos por comprar
                    </span>
                  </div>

                  {previewDay && previewDay.meals.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {previewDay.meals.slice(0, 3).map((meal, idx) => (
                        <div
                          key={`${meal.title}_${idx}`}
                          className="rounded-xl border border-white/5 bg-[#13161E] p-2.5"
                        >
                          <p className="text-[10px] font-bold uppercase text-[#D4FF33]">
                            {previewDay.dayName} · {meal.mealType}
                          </p>
                          <p className="text-xs font-semibold text-white truncate mt-0.5">
                            {meal.title}
                          </p>
                          <p className="text-[11px] font-mono text-zinc-400 mt-0.5">
                            {Math.round(meal.calories)} kcal · P {Math.round(meal.proteinG)}g
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setWeeklyPlanInitialView('menu');
                      setIsWeeklyPlanOpen(true);
                    }}
                    className="min-h-[44px] rounded-2xl border border-[#2A2F3D] bg-[#171A23] hover:border-[#D4FF33]/60 px-3 text-xs font-bold text-white flex items-center justify-center gap-1.5"
                  >
                    <CalendarDays className="w-4 h-4 text-[#D4FF33]" />
                    Ver menú 7 días
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWeeklyPlanInitialView('lista');
                      setIsWeeklyPlanOpen(true);
                    }}
                    className="min-h-[44px] rounded-2xl border border-[#2A2F3D] bg-[#171A23] hover:border-[#D4FF33]/60 px-3 text-xs font-bold text-white flex items-center justify-center gap-1.5"
                  >
                    <ShoppingCart className="w-4 h-4 text-[#D4FF33]" />
                    Lista súper ({pendingItems})
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const txt = formatShoppingListAsText(weeklyMealPlan, false);
                      const ok = await copyTextToClipboard(txt);
                      setWeeklyExportNotice(
                        ok
                          ? 'Lista de compras copiada como texto.'
                          : 'Abre la lista para ver y copiar el texto.',
                      );
                      window.setTimeout(() => setWeeklyExportNotice(null), 3200);
                    }}
                    className="min-h-[44px] rounded-2xl border border-[#D4FF33]/35 bg-[#171B14] hover:border-[#D4FF33] px-3 text-xs font-bold text-[#D4FF33] flex items-center justify-center gap-1.5"
                  >
                    <Copy className="w-4 h-4" />
                    Copiar lista
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadShoppingListTxt(weeklyMealPlan, false);
                      setWeeklyExportNotice('Archivo .txt de lista de compras descargado.');
                      window.setTimeout(() => setWeeklyExportNotice(null), 3200);
                    }}
                    className="min-h-[44px] rounded-2xl border border-[#2A2F3D] bg-[#171A23] hover:border-emerald-400/60 px-3 text-xs font-bold text-emerald-300 flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    Exportar .txt
                  </button>
                </div>

                {weeklyExportNotice && (
                  <p role="status" className="text-xs font-semibold text-emerald-300">
                    {weeklyExportNotice}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#2B3140] bg-[#0D0F14] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Genera un menú de Lunes a Domingo ajustado a tus{' '}
                  <strong className="text-white font-mono">{baseTargets.calories} kcal</strong> y{' '}
                  <strong className="text-[#D4FF33] font-mono">{baseTargets.proteinG}g de proteína</strong>{' '}
                  del perfil, suma platillos directo a tu día y exporta tu lista de compras en texto o <span className="font-mono">.txt</span>.
                </p>
              </div>
            )}
          </section>
        );
      })()}

      {/* Prominent Photo Plate Scanner Trigger in Meal Logging Section */}
      <div ref={mealsSectionRef} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold font-display text-white">
              Registrar comida del día
            </h2>
            <p className="text-xs text-zinc-400">
              Analiza por foto o voz con el Nutriólogo IA, o registra por texto, manual o lista rápida
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const hour = new Date().getHours();
              const defaultMeal: MealType =
                hour < 11 ? 'desayuno' : hour < 17 ? 'almuerzo' : 'cena';
              setScannerInitialMeal(defaultMeal);
              setIsPlateScannerOpen(true);
            }}
            className="min-h-[52px] inline-flex items-center justify-center gap-2.5 rounded-2xl bg-[#D4FF33] px-5 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98] transition-transform shrink-0"
          >
            <Camera className="w-5 h-5" />
            Analizar Comida con Foto / Voz
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MEAL_SECTIONS.map((section) => {
          const items = dayFoods.filter((f) => f.mealType === section.id);
          const sectionKcal = items.reduce((sum, i) => sum + i.calories, 0);

          return (
            <section
              key={section.id}
              className="rounded-3xl border border-[#222631] bg-[#12141A] p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/5">
                  <h3 className="text-xl font-bold font-display text-white">
                    {section.label}
                  </h3>
                  <span className="font-mono tabular-nums text-sm font-bold text-zinc-300">
                    {sectionKcal} kcal
                  </span>
                </div>

                {items.length === 0 ? (
                  <p className="py-5 text-sm text-zinc-500">
                    Sin alimentos registrados aún.
                  </p>
                ) : (
                  <div className="divide-y divide-white/5">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="py-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">
                            {item.name}
                          </p>
                          <p className="text-xs font-mono tabular-nums text-zinc-400 mt-0.5">
                            {item.calories} kcal · P {item.proteinG}g · C {item.carbsG}g · G{' '}
                            {item.fatG}g
                          </p>
                        </div>
                        <InlineDeleteConfirmButton
                          onConfirm={() => onDeleteFood(item.id)}
                          ariaLabel={`Eliminar ${item.name}`}
                          size="md"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveMealModal(section.id);
                    setModalMode('ia');
                    setAiEstimatedItems([]);
                    setAiMacroError(null);
                  }}
                  className="flex-1 min-h-[48px] flex items-center justify-center gap-2 rounded-2xl bg-[#1C2029] hover:bg-[#252A36] text-sm font-bold text-[#D4FF33] active:scale-[0.98] transition-transform"
                >
                  <Plus className="w-4 h-4" />
                  Agregar alimento
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScannerInitialMeal(section.id);
                    setIsPlateScannerOpen(true);
                  }}
                  aria-label={`Escanear foto para ${section.label}`}
                  className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-2xl border border-[#D4FF33]/40 bg-[#181C26] text-[#D4FF33] hover:border-[#D4FF33] active:scale-[0.98]"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>
            </section>
          );
        })}
        </div>
      </div>

      {/* Add Food Bottom Sheet (AI Natural Text + Manual + Quick List) */}
      {activeMealModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl border border-[#262B36] bg-[#13151A] max-h-[88dvh] flex flex-col">
            <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden" />
            <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3">
              <h3 className="text-xl font-bold font-display text-white">
                Agregar a {MEAL_SECTIONS.find((m) => m.id === activeMealModal)?.label}
              </h3>
              <button
                type="button"
                onClick={() => setActiveMealModal(null)}
                aria-label="Cerrar"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 pt-4">
              <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-[#0B0C0F]">
                <button
                  type="button"
                  onClick={() => setModalMode('ia')}
                  className={`min-h-[44px] rounded-xl text-xs font-bold transition-colors ${
                    modalMode === 'ia'
                      ? 'bg-[#D4FF33] text-[#0A0B0D]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Texto IA
                </button>
                <button
                  type="button"
                  onClick={() => setModalMode('manual')}
                  className={`min-h-[44px] rounded-xl text-xs font-bold transition-colors ${
                    modalMode === 'manual'
                      ? 'bg-[#D4FF33] text-[#0A0B0D]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => setModalMode('rapido')}
                  className={`min-h-[44px] rounded-xl text-xs font-bold transition-colors ${
                    modalMode === 'rapido'
                      ? 'bg-[#D4FF33] text-[#0A0B0D]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Lista rápida
                </button>
              </div>
            </div>

            {modalMode === 'ia' ? (
              <div className="p-5 space-y-4 overflow-y-auto">
                <form onSubmit={handleEstimateWithAi} className="space-y-3">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Escribe lo que comiste y la IA calculará calorías y macros
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={aiMealText}
                    onChange={(e) => setAiMealText(e.target.value)}
                    placeholder="Ej. 200g de pechuga de pollo a la plancha, 1 taza de arroz cocido y medio aguacate"
                    className="w-full rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] p-3.5 text-sm text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isEstimatingMacros || !aiMealText.trim()}
                    className="w-full min-h-[50px] flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] disabled:opacity-60 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98]"
                  >
                    {isEstimatingMacros ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Calculando macros con Gemini...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Calcular macros con IA
                      </>
                    )}
                  </button>
                </form>

                {aiMacroError && (
                  <p role="alert" className="text-xs font-semibold text-rose-400">
                    {aiMacroError}
                  </p>
                )}

                {aiEstimatedItems.length > 0 && (
                  <div className="space-y-3 pt-2 border-t border-white/10">
                    <p className="text-xs font-bold text-[#D4FF33]">
                      Desglose estimado ({aiEstimatedItems.length} elementos)
                    </p>
                    <div className="space-y-2">
                      {aiEstimatedItems.map((item, idx) => (
                        <div
                          key={`${item.name}_${idx}`}
                          className="rounded-2xl border border-[#222631] bg-[#0E1014] p-3"
                        >
                          <p className="text-sm font-bold text-white">{item.name}</p>
                          <p className="text-xs font-mono tabular-nums text-zinc-400 mt-0.5">
                            {Math.round(item.calories)} kcal · P {Math.round(item.proteinG)}g · C{' '}
                            {Math.round(item.carbsG)}g · G {Math.round(item.fatG)}g
                          </p>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleConfirmAiFoods}
                      className="w-full min-h-[52px] rounded-2xl bg-white text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98]"
                    >
                      Agregar a mi registro
                    </button>
                  </div>
                )}
              </div>
            ) : modalMode === 'rapido' ? (
              <>
                <div className="p-5 pb-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Buscar alimento (pollo, arroz, huevo...)"
                      className="w-full min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] pl-10 pr-4 text-sm text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-2.5">
                  {filteredPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className="w-full min-h-[60px] rounded-2xl border border-[#222631] bg-[#181B23] hover:border-[#D4FF33]/60 px-4 py-3 text-left flex items-center justify-between gap-3 active:scale-[0.99]"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">
                          {preset.name}
                        </p>
                        <p className="text-xs font-mono tabular-nums text-zinc-400 mt-0.5">
                          {preset.servingLabel} · {preset.calories} kcal · P {preset.proteinG}g
                        </p>
                      </div>
                      <Plus className="w-5 h-5 text-[#D4FF33] shrink-0" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <form onSubmit={handleManualSubmit} className="p-5 space-y-4 overflow-y-auto">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Nombre del alimento o comida
                  </label>
                  <input
                    type="text"
                    required
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Ej. Tacos de bistec con frijoles"
                    className="w-full min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-sm text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                      Calorías (kcal)
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={customCalories}
                      onChange={(e) => setCustomCalories(e.target.value)}
                      placeholder="Auto si vacío"
                      className="w-full min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-sm font-mono text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                      Proteína (g)
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={customProtein}
                      onChange={(e) => setCustomProtein(e.target.value)}
                      placeholder="0"
                      className="w-full min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-sm font-mono text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                      Carbohidratos (g)
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={customCarbs}
                      onChange={(e) => setCustomCarbs(e.target.value)}
                      placeholder="0"
                      className="w-full min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-sm font-mono text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                      Grasas (g)
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={customFat}
                      onChange={(e) => setCustomFat(e.target.value)}
                      placeholder="0"
                      className="w-full min-h-[48px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] px-4 text-sm font-mono text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full min-h-[52px] rounded-2xl bg-[#D4FF33] text-sm font-extrabold text-[#0A0B0D] active:scale-[0.98]"
                >
                  Guardar alimento
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {isPlateScannerOpen && (
        <React.Suspense fallback={<DarkNutriModalFallback />}>
          <PlateScannerModal
            isOpen={isPlateScannerOpen}
            initialMealType={scannerInitialMeal}
            selectedDate={selectedDate}
            dailyContext={{
              calorieTarget: effectiveCalorieTarget,
              consumedCalories: totals.calories,
              proteinTargetG: activeTargets.proteinG,
              consumedProteinG: totals.proteinG,
              carbsTargetG: activeTargets.carbsG,
              consumedCarbsG: totals.carbsG,
              fatTargetG: activeTargets.fatG,
              consumedFatG: totals.fatG,
              goal: profile.goal,
            }}
            onClose={() => setIsPlateScannerOpen(false)}
            onSaveEntries={(entries) => {
              for (const entry of entries) {
                onAddFood(entry);
              }
            }}
          />
        </React.Suspense>
      )}

      {isWeeklyPlanOpen && (
        <React.Suspense fallback={<DarkNutriModalFallback />}>
          <WeeklyMealPlanModal
            isOpen={isWeeklyPlanOpen}
            initialView={weeklyPlanInitialView}
            selectedDate={selectedDate}
            profile={profile}
            calorieTarget={activeTargets.calories}
            proteinTargetG={activeTargets.proteinG}
            profileCalorieTarget={baseTargets.calories}
            profileProteinTargetG={baseTargets.proteinG}
            isAdaptiveTarget={activeTargets.isAdaptive}
            weeklyMealPlan={weeklyMealPlan}
            onClose={() => setIsWeeklyPlanOpen(false)}
            onSavePlan={onSaveWeeklyMealPlan}
            onAddFood={onAddFood}
          />
        </React.Suspense>
      )}
    </div>
  );
};
