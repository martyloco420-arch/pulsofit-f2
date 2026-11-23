export type TabId =
  | 'dashboard'
  | 'salud'
  | 'entrenar'
  | 'nutricion'
  | 'hidratacion'
  | 'sueno'
  | 'progreso'
  | 'perfil';

export interface ProfileSlot {
  id: string;
  label: string;
  isDefault?: boolean;
}

export type Sex = 'hombre' | 'mujer' | 'otro';

export type Goal = 'perder_grasa' | 'mantener_peso' | 'ganar_musculo';

export type EquipmentType =
  | 'gimnasio_completo'
  | 'mancuernas'
  | 'ligas_resistencia'
  | 'barra_discos'
  | 'peso_corporal';

export type MuscleGroup =
  | 'pecho'
  | 'espalda'
  | 'hombros'
  | 'biceps'
  | 'triceps'
  | 'cuadriceps'
  | 'isquiotibiales'
  | 'gluteos'
  | 'pantorrillas'
  | 'abdomen';

export interface MuscleFatigueEntry {
  fatigue: number; // 0 to 100
  lastUpdatedAt: string; // ISO timestamp
}

export type MuscleFatigueMap = Record<MuscleGroup, MuscleFatigueEntry>;

export type WeightUnit = 'kg' | 'lb';
export type DistanceUnit = 'km' | 'mi';
export type LiquidUnit = 'ml' | 'oz';
export type LengthUnit = 'cm' | 'in';
export type LoadMode = 'weights' | 'bands';
export type LowPowerPreference = 'auto' | 'on' | 'off';

export interface UserProfile {
  name: string;
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  goal: Goal;
  equipment: EquipmentType[];
  trainingDaysPerWeek: number;
  targetWeightKg: number;
  preferredRestSec?: number;
  autoStartRest?: boolean;
  voiceCoachEnabled?: boolean;
  preferredVoiceUri?: string;
  weightUnit?: WeightUnit;
  distanceUnit?: DistanceUnit;
  liquidUnit?: LiquidUnit;
  waistUnit?: LengthUnit;
  lowPowerMode?: LowPowerPreference;
  dailyStepsGoal?: number;
  dailyActiveMinGoal?: number;
  dailyActiveKcalGoal?: number;
  rpeTrackingEnabled?: boolean;
  customGoal?: string;
  onboardingCompleted?: boolean;
}

export interface ExerciseDefinition {
  id: string;
  name: string;
  equipment: EquipmentType[];
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  defaultSets: number;
  defaultReps: number;
  defaultRestSec: number;
  suggestedWeightKg: number;
  instructions: string;
}

export type SetType = 'normal' | 'warmup' | 'dropset' | 'failure';

export interface WorkoutSet {
  id: string;
  weightKg: number;
  reps: number;
  durationSec?: number;
  rpe?: number; // 1 to 10
  setType?: SetType;
  completed: boolean;
  bandLabel?: string;
  isPR?: boolean;
  prLabels?: string[];
}

export interface BandConfig {
  levelIds: string[];
  label: string;
  totalKg: number;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  sets: WorkoutSet[];
  restSec: number;
  notes?: string;
  loadMode?: LoadMode;
  bandConfig?: BandConfig;
  supersetGroupId?: string | null;
}

export interface WorkoutTemplateExercise {
  id: string;
  exerciseId: string;
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  defaultSets: number;
  defaultReps: number;
  suggestedWeightKg: number;
  restSec: number;
  notes?: string;
  loadMode?: LoadMode;
  bandConfig?: BandConfig;
  supersetGroupId?: string | null;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  exercises: WorkoutTemplateExercise[];
  createdAt: string;
  updatedAt: string;
}

export interface DailyReadinessEntry {
  date: string; // YYYY-MM-DD
  sleepHours: number;
  sleepQuality: number;
  energyLevel: number;
  sorenessLevel: number;
  score: number;
  updatedAt: string;
  source?: 'manual' | 'sueno' | 'ppg';
  sleepSessionId?: string;
  physicalRecoveryPct?: number;
  mentalRecoveryPct?: number;
  sleepRecommendation?: string;
  deepSleepPct?: number;
  remSleepPct?: number;
  completedCycles90?: number;
  restingBpm?: number;
  hrvRmssdMs?: number;
  pulseRecordId?: string;
}

export interface HiitSession {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  workSec: number;
  restSec: number;
  rounds: number;
  cycles: number;
  totalDurationSec: number;
  caloriesBurned: number;
  completedAt: string;
}

export interface WarmupItem {
  id: string;
  name: string;
  durationOrReps: string;
  completed: boolean;
}

export interface ActiveWorkout {
  id: string;
  title: string;
  rationale?: string;
  warmup?: WarmupItem[];
  startedAt: string;
  exercises: WorkoutExercise[];
  isAiGenerated?: boolean;
}

export interface WorkoutSession {
  id: string;
  title: string;
  startedAt: string;
  completedAt: string;
  durationSec: number;
  totalVolumeKg: number;
  completedSets: number;
  exercises: WorkoutExercise[];
  fatigueImpact: Partial<Record<MuscleGroup, number>>;
  isPR?: boolean;
  prLabels?: string[];
}

export interface BodyWeightEntry {
  id: string;
  date: string; // YYYY-MM-DD
  weightKg: number;
}

export type MealType = 'desayuno' | 'almuerzo' | 'cena' | 'snack';

export interface FoodEntry {
  id: string;
  date: string; // YYYY-MM-DD
  mealType: MealType;
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  createdAt: string;
}

export interface FavoriteMeal {
  id: string;
  name: string;
  defaultMealType: MealType;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  createdAt: string;
}

export type ShoppingListCategory =
  | 'Proteínas'
  | 'Carbohidratos'
  | 'Verduras y Frutas'
  | 'Despensa y Grasas';

export interface ShoppingListItem {
  id: string;
  category: ShoppingListCategory;
  name: string;
  quantity: string;
  checked: boolean;
}

export interface WeeklyMealPlanItem {
  mealType: MealType;
  title: string;
  description: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface WeeklyMealPlanDay {
  dayName: string;
  meals: WeeklyMealPlanItem[];
}

export interface WeeklyMealPlan {
  id: string;
  generatedAt: string;
  calorieTarget: number;
  proteinTargetG: number;
  notes: string;
  days: WeeklyMealPlanDay[];
  shoppingList: ShoppingListItem[];
}

export interface AdaptiveNutritionState {
  estimatedTdee: number;
  theoreticalTdee: number;
  calorieTarget: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterMl: number;
  avgCaloriesLast7Days: number;
  loggedDaysCount: number;
  weeklyTrendChangeKg: number;
  lastCheckInAt: string;
  summaryNote: string;
}

export type MetricStatusLevel = 'Bajo' | 'Saludable' | 'Perfecto' | 'Alto' | 'Crítico';

export type ScaleSource = 'bluetooth' | 'captura_ia' | 'manual';

export type WeighInTimeSlot = 'manana' | 'tarde' | 'noche';

export interface BodyCompositionScan {
  id: string;
  date: string; // YYYY-MM-DD
  recordedAt: string; // ISO timestamp
  timeSlot?: WeighInTimeSlot;
  source: ScaleSource;
  impedanceOhm?: number;
  weightKg: number;
  waistCm?: number;
  leanMassKg: number;
  bmi: number;
  obesityDegreePct: number;
  bodyFatPct: number;
  bodyFatMassKg: number;
  skeletalMusclePct: number;
  skeletalMuscleMassKg: number;
  totalMusclePct: number;
  totalMuscleMassKg: number;
  bodyWaterPct: number;
  bodyWaterMassKg: number;
  visceralFatLevel: number;
  boneMassKg: number;
  bmrKcal: number;
  proteinPct: number;
  bodyAge: number;
  realAge: number;
  idealWeightKg: number;
}

export type FastingProtocol = '16:8' | '18:6' | '20:4' | 'omad_23_1' | 'custom';

export interface ActiveFastState {
  id: string;
  protocol: FastingProtocol;
  targetHours: number;
  startedAt: string; // ISO timestamp
  waterGlassesCount: number;
  electrolytesCount: number;
}

export interface FastingHistoryEntry {
  id: string;
  date: string; // YYYY-MM-DD (completion date)
  protocol: FastingProtocol;
  targetHours: number;
  startedAt: string;
  endedAt: string;
  actualHours: number;
  completedGoal: boolean;
  waterGlassesCount: number;
  electrolytesCount: number;
}

export type HydrationContainerMl = 250 | 500 | 750 | 1000;

export interface HydrationSettings {
  mlPerKg: number; // 30 to 40
  containerMl: HydrationContainerMl;
  wakeHour: number; // 4 to 12
  sleepHour: number; // 18 to 23
  hotDayByDate: Record<string, boolean>;
  remindersEnabled: boolean;
}

export interface HydrationLogEntry {
  id: string;
  date: string; // YYYY-MM-DD
  amountMl: number;
  recordedAt: string; // ISO timestamp
}

export type CardioActivityType = 'correr' | 'caminar' | 'ciclismo' | 'caminadora';

export interface GpsPoint {
  lat: number;
  lng: number;
  timestamp: number;
  accuracyM?: number;
}

export interface CardioSplit {
  kmNumber: number;
  splitTimeSec: number;
  paceSecPerKm: number;
  cumulativeSec: number;
}

export interface ShoeGear {
  id: string;
  name: string;
  brand?: string;
  accumulatedKm: number;
  maxAlertKm: number; // default 650
  isActive: boolean;
  createdAt: string;
}

export interface CardioSession {
  id: string;
  date: string; // YYYY-MM-DD
  activityType: CardioActivityType;
  startedAt: string;
  completedAt: string;
  durationSec: number; // active duration in seconds
  totalDurationSec?: number; // wall-clock duration including pauses
  pausedDurationSec?: number;
  distanceKm: number;
  avgPaceSecPerKm: number;
  avgSpeedKmh?: number;
  estimatedSteps?: number;
  caloriesBurned: number;
  targetDistanceKm?: number | null;
  pauseOnTargetReached?: boolean;
  routePoints: GpsPoint[];
  splits: CardioSplit[];
  shoeId?: string | null;
  shoeName?: string | null;
  isPR?: boolean;
  prLabels?: string[];
}

export interface ManualDailyActivity {
  date: string; // YYYY-MM-DD
  steps: number;
  activeMin: number;
  activeKcal: number;
  distanceKm?: number;
  source?: 'manual' | 'samsung_health';
  hourlySteps?: Record<number, number>;
  pausaActivaCount?: number;
  lastPausaActivaAt?: string;
  updatedAt: string;
}

export interface BodyMeasurementEntry {
  id: string;
  date: string; // YYYY-MM-DD
  waistCm?: number;
  chestCm?: number;
  armCm?: number;
  thighCm?: number;
  hipsCm?: number;
}

export type ProgressPhotoPose = 'frente' | 'perfil' | 'espalda';

export interface ProgressPhotoMeta {
  id: string;
  date: string; // YYYY-MM-DD
  pose: ProgressPhotoPose;
  weightKgAtCapture?: number;
  createdAt: string;
}

export type SleepPhase = 'despierto' | 'rem' | 'ligero' | 'profundo';

export type SleepSmartWindowMin = 15 | 30 | 45;

export type SleepSoundscapeType = 'ninguno' | 'lluvia' | 'ruido_marron' | 'frecuencia_432';

export interface SleepTimelinePoint {
  minuteOffset: number;
  timestamp: string;
  phase: SleepPhase;
  movementScore: number; // 0 to 100
  audioDbLevel: number; // 0 to 100 normalized amplitude
  audioVariability?: number; // 0 to 100 acoustic variability in 5-min window
  snoreOrNoiseEvent?: boolean;
}

export interface SleepNoiseEvent {
  id: string;
  timestamp: string;
  minuteOffset: number;
  type: 'ronquido' | 'ruido_ambiente' | 'movimiento';
  intensity: number; // 1 to 100
  label: string;
}

export interface SleepSession {
  id: string;
  date: string; // YYYY-MM-DD (wake-up date)
  bedtimeAt: string; // ISO
  wakeUpAt: string; // ISO
  targetWakeTime: string; // HH:MM
  smartWindowMin: SleepSmartWindowMin;
  triggeredBySmartAlarm: boolean;
  durationMinutes: number;
  sleepQualityPct: number; // 0 to 100
  deepSleepMin: number;
  lightRemSleepMin: number; // combined legacy field (lightSleepMin + remSleepMin)
  lightSleepMin?: number;
  remSleepMin?: number;
  awakeMin: number;
  completedCycles90?: number;
  physicalRecoveryPct?: number; // 0 to 100
  mentalRecoveryPct?: number; // 0 to 100
  recoveryRecommendation?: string;
  snoreEventsCount: number;
  noiseEventsCount: number;
  movementIndex: number; // 0 to 100
  soundscapeUsed: SleepSoundscapeType;
  micEnabled: boolean;
  motionEnabled: boolean;
  timeline: SleepTimelinePoint[];
  noiseEvents: SleepNoiseEvent[];
}

export interface PulseHrvRecord {
  id: string;
  date: string; // YYYY-MM-DD
  recordedAt: string; // ISO
  bpm: number;
  hrvRmssdMs: number;
  recoveryImpactScore: number; // 0 to 100
  signalQualityPct: number; // 0 to 100
  durationSec: number;
  source: 'ppg_camara' | 'manual';
  waveformPreview?: number[];
}

export type BloodPressureCategory =
  | 'Baja'
  | 'Normal'
  | 'Elevada'
  | 'Alta Nivel 1'
  | 'Alta Nivel 2';

export interface BloodPressureRecord {
  id: string;
  date: string; // YYYY-MM-DD
  recordedAt: string; // ISO
  systolic: number; // mmHg
  diastolic: number; // mmHg
  pulseBpm?: number;
  category: BloodPressureCategory;
  notes?: string;
}

export type CoachPersonality = 'sargento' | 'motivador';

export interface CoachChatMessage {
  id: string;
  role: 'user' | 'coach';
  text: string;
  headline?: string;
  goodBullets?: string[];
  weakBullets?: string[];
  actionTip?: string;
  personality: CoachPersonality;
  source?: 'gemini' | 'offline';
  createdAt: string;
}

export interface AppDatabase {
  schemaVersion: number;
  updatedAt: string;
  profile: UserProfile;
  muscleFatigue: MuscleFatigueMap;
  activeWorkout: ActiveWorkout | null;
  workouts: WorkoutSession[];
  workoutTemplates?: WorkoutTemplate[];
  hiitSessions?: HiitSession[];
  cardioSessions?: CardioSession[];
  shoes?: ShoeGear[];
  bodyWeights: BodyWeightEntry[];
  bodyScans: BodyCompositionScan[];
  bodyMeasurements?: BodyMeasurementEntry[];
  progressPhotos?: ProgressPhotoMeta[];
  readinessByDate?: Record<string, DailyReadinessEntry>;
  sleepSessions?: SleepSession[];
  pulseHrvRecords?: PulseHrvRecord[];
  bloodPressureRecords?: BloodPressureRecord[];
  foodLogs: FoodEntry[];
  favoriteMeals?: FavoriteMeal[];
  weeklyMealPlan?: WeeklyMealPlan | null;
  hydrationByDate: Record<string, number>; // ml
  hydrationLogsByDate?: Record<string, HydrationLogEntry[]>;
  hydrationSettings?: HydrationSettings;
  electrolytesByDate?: Record<string, number>;
  adaptiveNutrition?: AdaptiveNutritionState | null;
  activeFast?: ActiveFastState | null;
  fastingHistory?: FastingHistoryEntry[];
  manualActivityByDate?: Record<string, ManualDailyActivity>;
  coachPersonality?: CoachPersonality;
  coachChatHistory?: CoachChatMessage[];
  scheduledRestDates?: string[];
}
