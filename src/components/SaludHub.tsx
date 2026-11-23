import React, { Suspense, lazy } from 'react';
import { Droplets, HeartPulse, Moon, TrendingUp } from 'lucide-react';
import { triggerHaptic } from '../lib/haptics';
import type { RecordDeleteTarget } from '../lib/storage';
import type {
  AppDatabase,
  BloodPressureRecord,
  BodyCompositionScan,
  HydrationSettings,
  PulseHrvRecord,
  SleepSession,
  UserProfile,
} from '../types/fitness';

export type SaludHubSection = 'biometria' | 'progreso' | 'sueno' | 'hidratacion';

const SaludTab = lazy(() =>
  import('./SaludTab').then((m) => ({ default: m.SaludTab })),
);
const ProgresoTab = lazy(() =>
  import('./ProgresoTab').then((m) => ({ default: m.ProgresoTab })),
);
const SleepRecoverySection = lazy(() =>
  import('./SleepRecoverySection').then((m) => ({
    default: m.SleepRecoverySection,
  })),
);
const HidratacionTab = lazy(() =>
  import('./HidratacionTab').then((m) => ({
    default: m.HidratacionTab,
  })),
);

const SaludSectionSkeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Cargando sección de Salud">
    <div className="h-9 w-52 rounded-2xl bg-[#12141A] border border-[#222631]" />
    <div className="h-52 w-full rounded-3xl bg-[#12141A] border border-[#222631]" />
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="h-36 rounded-3xl bg-[#12141A] border border-[#222631]" />
      <div className="h-36 rounded-3xl bg-[#12141A] border border-[#222631]" />
    </div>
  </div>
);

const HUB_SECTIONS: {
  id: SaludHubSection;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'biometria', label: 'Biometría y HRV', Icon: HeartPulse },
  { id: 'progreso', label: 'Progreso', Icon: TrendingUp },
  { id: 'sueno', label: 'Sueño', Icon: Moon },
  { id: 'hidratacion', label: 'Hidratación', Icon: Droplets },
];

interface SaludHubProps {
  activeSection: SaludHubSection;
  onSelectSection: (section: SaludHubSection) => void;
  activeProfileId: string;
  database: AppDatabase;
  todayIso: string;
  recoveryIndex0To100: number;
  isHydrated: boolean;
  onUpdateProfile: (profile: UserProfile) => void;
  onSaveScan: (scan: BodyCompositionScan) => void;
  onOpenScale: () => void;
  onSavePulseRecord: (record: PulseHrvRecord) => void;
  onDeletePulseRecord: (id: string) => void;
  onSaveBloodPressureRecord: (record: BloodPressureRecord) => void;
  onDeleteBloodPressureRecord: (id: string) => void;
  onSaveSleepSession: (session: SleepSession) => void;
  onDeleteSleepSession: (id: string) => void;
  onAddWater: (date: string, deltaMl: number) => void;
  onUndoLastWater: (date: string) => void;
  onDeleteWaterLog: (date: string, target: RecordDeleteTarget | string) => void;
  onUpdateHydrationSettings: (next: HydrationSettings) => void;
  onUpdateElectrolytes: (date: string, delta: number) => void;
  onOpenPushSettings: () => void;
  onDeleteWorkout: (workoutId: string) => void;
  onDeleteHiitSession: (hiitId: string) => void;
  onDeleteCardioSession: (sessionId: string) => void;
  onDeleteBodyScan: (scanId: string) => void;
  onDeleteBodyWeight: (weightId: string) => void;
  onDeleteFood: (foodId: string) => void;
  onDeleteFastHistory: (fastId: string) => void;
  onClearDay: (dateIso: string, includePhotos: boolean) => Promise<void>;
}

export const SaludHub: React.FC<SaludHubProps> = ({
  activeSection,
  onSelectSection,
  activeProfileId,
  database,
  todayIso,
  recoveryIndex0To100,
  isHydrated,
  onUpdateProfile,
  onSaveScan,
  onOpenScale,
  onSavePulseRecord,
  onDeletePulseRecord,
  onSaveBloodPressureRecord,
  onDeleteBloodPressureRecord,
  onSaveSleepSession,
  onDeleteSleepSession,
  onAddWater,
  onUndoLastWater,
  onDeleteWaterLog,
  onUpdateHydrationSettings,
  onUpdateElectrolytes,
  onOpenPushSettings,
  onDeleteWorkout,
  onDeleteHiitSession,
  onDeleteCardioSession,
  onDeleteBodyScan,
  onDeleteBodyWeight,
  onDeleteFood,
  onDeleteFastHistory,
  onClearDay,
}) => {
  return (
    <div className="space-y-5">
      {/* Selector superior tipo píldora del Hub de Salud */}
      <div
        role="tablist"
        aria-label="Secciones de Salud"
        className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-2xl border border-zinc-800/80 bg-zinc-950/90 p-1.5"
      >
        {HUB_SECTIONS.map(({ id, label, Icon }) => {
          const active = activeSection === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (activeSection !== id) {
                  triggerHaptic('light');
                  onSelectSection(id);
                }
              }}
              className={`min-h-[40px] px-2.5 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${
                active
                  ? 'bg-lime-400 text-zinc-950 shadow-sm shadow-lime-400/20'
                  : 'text-zinc-300 hover:text-white hover:bg-zinc-900/80'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Contenido de la sub-pestaña activa */}
      <Suspense fallback={<SaludSectionSkeleton />}>
        {activeSection === 'biometria' && (
          <SaludTab
            profileId={activeProfileId}
            profile={database.profile}
            bodyScans={database.bodyScans}
            bodyWeights={database.bodyWeights}
            pulseRecords={database.pulseHrvRecords ?? []}
            bloodPressureRecords={database.bloodPressureRecords ?? []}
            todayReadiness={database.readinessByDate?.[todayIso] ?? null}
            recoveryIndex0To100={recoveryIndex0To100}
            isHydrated={isHydrated}
            onUpdateProfile={onUpdateProfile}
            onSaveScan={onSaveScan}
            onOpenScale={onOpenScale}
            onSavePulseRecord={onSavePulseRecord}
            onDeletePulseRecord={onDeletePulseRecord}
            onSaveBloodPressureRecord={onSaveBloodPressureRecord}
            onDeleteBloodPressureRecord={onDeleteBloodPressureRecord}
          />
        )}

        {activeSection === 'progreso' && (
          <ProgresoTab
            profileId={activeProfileId}
            database={database}
            profile={database.profile}
            onUpdateProfile={onUpdateProfile}
            onDeleteWorkout={onDeleteWorkout}
            onDeleteHiitSession={onDeleteHiitSession}
            onDeleteCardioSession={onDeleteCardioSession}
            onDeleteBodyScan={onDeleteBodyScan}
            onDeleteBodyWeight={onDeleteBodyWeight}
            onDeleteFood={onDeleteFood}
            onDeleteFastHistory={onDeleteFastHistory}
            onDeleteSleepSession={onDeleteSleepSession}
            onDeletePulseRecord={onDeletePulseRecord}
            onDeleteBloodPressureRecord={onDeleteBloodPressureRecord}
            onDeleteWaterLog={onDeleteWaterLog}
            onClearDay={onClearDay}
            onOpenScale={onOpenScale}
            onOpenSleep={() => onSelectSection('sueno')}
            onOpenPulse={() => onSelectSection('biometria')}
          />
        )}

        {activeSection === 'sueno' && (
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

            <SleepRecoverySection
              sleepSessions={database.sleepSessions ?? []}
              todayReadiness={database.readinessByDate?.[todayIso] ?? null}
              onSaveSleepSession={onSaveSleepSession}
              onDeleteSleepSession={onDeleteSleepSession}
            />
          </div>
        )}

        {activeSection === 'hidratacion' && (
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
            onUpdateProfile={onUpdateProfile}
            onAddWater={onAddWater}
            onUndoLastWater={onUndoLastWater}
            onDeleteWaterLog={onDeleteWaterLog}
            onUpdateHydrationSettings={onUpdateHydrationSettings}
            onUpdateElectrolytes={onUpdateElectrolytes}
            onOpenPushSettings={onOpenPushSettings}
          />
        )}
      </Suspense>
    </div>
  );
};
