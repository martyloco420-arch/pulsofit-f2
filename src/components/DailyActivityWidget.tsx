import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Clock,
  Flame,
  Footprints,
  Plus,
  Upload,
} from 'lucide-react';
import { parseSamsungHealthPedometerCsv } from '../lib/dailyActivity';
import { formatDistance } from '../lib/units';
import type { DistanceUnit, ManualDailyActivity } from '../types/fitness';
import { DailyActivityRings, MiniHeartRings } from './DailyActivityRings';

export interface DailyActivityWidgetProps {
  steps: number;
  stepsGoal: number;
  activeMinutes: number;
  activeMinutesGoal: number;
  activeCalories: number;
  activeCaloriesGoal: number;
  totalCalories: number;
  distanceKm: number;
  selectedDayKey: string;
  todayKey: string;
  distanceUnit: DistanceUnit;
  profileHeightCm: number;
  weekDaysSerialized: string;
  canQuickAddSteps: boolean;
  canImportCsv: boolean;
  onOpenStepsDetail: () => void;
  onSelectDay: (dateIso: string) => void;
  onQuickAddSteps: (dateIso: string, deltaSteps: number) => void;
  onImportManualActivity?: (entries: ManualDailyActivity[]) => void;
}

interface ParsedWeekStripDay {
  date: string;
  letter: string;
  dayNumber: number;
  isToday: boolean;
  isFuture: boolean;
  stepsPct: number;
  activeMinPct: number;
  activeKcalPct: number;
}

function parseWeekDaysSerialized(serialized: string): ParsedWeekStripDay[] {
  if (!serialized) return [];
  return serialized
    .split(';')
    .filter(Boolean)
    .map((chunk) => {
      const [
        date = '',
        letter = '',
        dayNumStr = '0',
        isTodayFlag = '0',
        isFutureFlag = '0',
        stepsPctStr = '0',
        minPctStr = '0',
        kcalPctStr = '0',
      ] = chunk.split('|');

      return {
        date,
        letter,
        dayNumber: parseInt(dayNumStr, 10) || 0,
        isToday: isTodayFlag === '1',
        isFuture: isFutureFlag === '1',
        stepsPct: parseInt(stepsPctStr, 10) || 0,
        activeMinPct: parseInt(minPctStr, 10) || 0,
        activeKcalPct: parseInt(kcalPctStr, 10) || 0,
      };
    });
}

function arePropsEqual(
  prev: DailyActivityWidgetProps,
  next: DailyActivityWidgetProps,
): boolean {
  return (
    prev.steps === next.steps &&
    prev.stepsGoal === next.stepsGoal &&
    prev.activeMinutes === next.activeMinutes &&
    prev.activeMinutesGoal === next.activeMinutesGoal &&
    prev.activeCalories === next.activeCalories &&
    prev.activeCaloriesGoal === next.activeCaloriesGoal &&
    prev.totalCalories === next.totalCalories &&
    prev.distanceKm === next.distanceKm &&
    prev.selectedDayKey === next.selectedDayKey &&
    prev.todayKey === next.todayKey &&
    prev.distanceUnit === next.distanceUnit &&
    prev.profileHeightCm === next.profileHeightCm &&
    prev.weekDaysSerialized === next.weekDaysSerialized &&
    prev.canQuickAddSteps === next.canQuickAddSteps &&
    prev.canImportCsv === next.canImportCsv &&
    prev.onOpenStepsDetail === next.onOpenStepsDetail &&
    prev.onSelectDay === next.onSelectDay &&
    prev.onQuickAddSteps === next.onQuickAddSteps &&
    prev.onImportManualActivity === next.onImportManualActivity
  );
}

const DailyActivityWidgetBase: React.FC<DailyActivityWidgetProps> = ({
  steps,
  stepsGoal,
  activeMinutes,
  activeMinutesGoal,
  activeCalories,
  activeCaloriesGoal,
  totalCalories,
  distanceKm,
  selectedDayKey,
  todayKey,
  distanceUnit,
  profileHeightCm,
  weekDaysSerialized,
  canQuickAddSteps,
  canImportCsv,
  onOpenStepsDetail,
  onSelectDay,
  onQuickAddSteps,
  onImportManualActivity,
}) => {
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const [showQuickSteps, setShowQuickSteps] = useState(false);
  const [customStepsInput, setCustomStepsInput] = useState('');
  const [csvFeedback, setCsvFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const weekStrip = useMemo(
    () => parseWeekDaysSerialized(weekDaysSerialized),
    [weekDaysSerialized],
  );

  const formattedDistance = useMemo(
    () => formatDistance(distanceKm, distanceUnit),
    [distanceKm, distanceUnit],
  );

  const handleCustomStepsSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!canQuickAddSteps) return;
      const parsed = parseInt(customStepsInput.replace(/[^\d]/g, ''), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      onQuickAddSteps(selectedDayKey, Math.min(80000, parsed));
      setCustomStepsInput('');
      setShowQuickSteps(false);
    },
    [canQuickAddSteps, customStepsInput, onQuickAddSteps, selectedDayKey],
  );

  const handleCsvFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !onImportManualActivity) return;

      try {
        const text = await file.text();
        const parsed = parseSamsungHealthPedometerCsv(text, profileHeightCm);
        if (parsed.entries.length === 0) {
          setCsvFeedback({
            type: 'err',
            text: 'No se encontraron filas válidas (usa pedometer_day_summary CSV de Samsung Health).',
          });
          return;
        }
        onImportManualActivity(parsed.entries);
        setCsvFeedback({
          type: 'ok',
          text: `Samsung Health: ${parsed.importedCount} ${
            parsed.importedCount === 1 ? 'día importado' : 'días importados'
          }.`,
        });
      } catch {
        setCsvFeedback({
          type: 'err',
          text: 'No se pudo leer el archivo CSV seleccionado.',
        });
      }
    },
    [onImportManualActivity, profileHeightCm],
  );

  return (
    <section
      onClick={onOpenStepsDetail}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenStepsDetail();
        }
      }}
      aria-label="Abrir desglose de pasos y actividad diaria"
      className="rounded-3xl border border-white/10 bg-[#12141A]/85 backdrop-blur-md p-4 sm:p-5 space-y-4 shadow-xl cursor-pointer hover:border-[#a3e635]/35 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a3e635]"
    >
      {/* Card Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-[#a3e635]">
            Actividad Diaria · {selectedDayKey === todayKey ? 'Hoy' : selectedDayKey}
          </p>
          <h2 className="text-lg sm:text-xl font-extrabold font-display text-white">
            Corazón de movimiento
          </h2>
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {selectedDayKey !== todayKey && (
            <button
              type="button"
              onClick={() => onSelectDay(todayKey)}
              className="min-h-[36px] rounded-xl border border-[#2B3140] bg-[#0D0F14] px-2.5 text-xs font-bold text-zinc-200 hover:text-white"
            >
              Hoy
            </button>
          )}

          {canQuickAddSteps && (
            <button
              type="button"
              onClick={() => setShowQuickSteps((v) => !v)}
              className="min-h-[36px] inline-flex items-center gap-1 rounded-xl border border-[#a3e635]/40 bg-[#171C14] px-2.5 text-xs font-bold text-[#a3e635] hover:bg-[#1E261A] whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              Registrar pasos
            </button>
          )}

          {canImportCsv && onImportManualActivity && (
            <>
              <button
                type="button"
                onClick={() => csvInputRef.current?.click()}
                title="Importar com.samsung.shealth.tracker.pedometer_day_summary CSV"
                className="min-h-[36px] inline-flex items-center gap-1 rounded-xl border border-[#293040] bg-[#0D0F14] px-2.5 text-xs font-bold text-zinc-200 hover:border-sky-400/50 hover:text-white whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="hidden sm:inline">Importar CSV</span>
                <span className="sm:hidden">CSV</span>
              </button>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvFileChange}
                className="hidden"
              />
            </>
          )}

          <button
            type="button"
            onClick={onOpenStepsDetail}
            className="min-h-[36px] inline-flex items-center gap-0.5 rounded-xl border border-[#293040] bg-[#0D0F14] px-2.5 text-xs font-bold text-zinc-300 hover:text-white whitespace-nowrap"
          >
            Desglose
            <ChevronRight className="w-3.5 h-3.5 text-[#a3e635]" />
          </button>
        </div>
      </div>

      {/* Inline Quick Steps Entry */}
      {showQuickSteps && canQuickAddSteps && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="rounded-2xl border border-[#28303E] bg-[#0B0D12] p-3.5 space-y-2.5"
        >
          <p className="text-xs font-semibold text-zinc-300">
            Sumar pasos al {selectedDayKey === todayKey ? 'día de hoy' : selectedDayKey}
          </p>
          <div className="flex flex-wrap gap-2">
            {[1000, 2500, 5000].map((qty) => (
              <button
                key={qty}
                type="button"
                onClick={() => {
                  onQuickAddSteps(selectedDayKey, qty);
                  setShowQuickSteps(false);
                }}
                className="min-h-[38px] rounded-xl border border-[#2C3428] bg-[#141A12] hover:border-[#a3e635] px-3 text-xs font-mono font-bold text-[#a3e635]"
              >
                +{qty.toLocaleString('es-MX')}
              </button>
            ))}
          </div>
          <form onSubmit={handleCustomStepsSubmit} className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={customStepsInput}
              onChange={(e) => setCustomStepsInput(e.target.value)}
              placeholder="Ej. 3500 pasos"
              className="flex-1 min-h-[40px] rounded-xl border border-[#272D3B] bg-[#12151D] px-3 text-xs font-mono text-white placeholder:text-zinc-500 focus:border-[#a3e635] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!customStepsInput.trim()}
              className="min-h-[40px] rounded-xl bg-[#a3e635] disabled:opacity-40 px-4 text-xs font-extrabold text-[#0A0B0D]"
            >
              Guardar
            </button>
          </form>
        </div>
      )}

      {csvFeedback && (
        <div
          onClick={(e) => e.stopPropagation()}
          role="status"
          className={`rounded-xl border px-3 py-2 text-xs font-semibold flex items-center justify-between gap-2 ${
            csvFeedback.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
              : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
          }`}
        >
          <span>{csvFeedback.text}</span>
          <button
            type="button"
            onClick={() => setCsvFeedback(null)}
            className="text-[11px] underline opacity-80 hover:opacity-100"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Main Split: Left 3-Ring Heart SVG, Right Stacked Metrics + Total Burn/Distance */}
      <div className="flex flex-col sm:flex-row items-center gap-5">
        <DailyActivityRings
          steps={steps}
          stepsGoal={stepsGoal}
          activeMinutes={activeMinutes}
          activeMinutesGoal={activeMinutesGoal}
          activeCalories={activeCalories}
          activeCaloriesGoal={activeCaloriesGoal}
        />

        <div className="flex-1 w-full space-y-3">
          <div className="space-y-2.5">
            {/* Steps (Green) */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                  <Footprints className="w-4 h-4 text-[#22C55E]" />
                </span>
                <span className="text-xs sm:text-sm font-semibold text-zinc-200">
                  Pasos
                </span>
              </div>
              <p className="text-sm sm:text-base font-extrabold font-mono tabular-nums text-white">
                {steps.toLocaleString('es-MX')}{' '}
                <span className="text-xs font-semibold text-zinc-400">
                  / {stepsGoal.toLocaleString('es-MX')}
                </span>
              </p>
            </div>

            {/* Active Time (Blue) */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-xl bg-sky-500/15 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4 text-[#38BDF8]" />
                </span>
                <span className="text-xs sm:text-sm font-semibold text-zinc-200">
                  Tiempo activo
                </span>
              </div>
              <p className="text-sm sm:text-base font-extrabold font-mono tabular-nums text-white">
                {activeMinutes}{' '}
                <span className="text-xs font-semibold text-zinc-400">
                  / {activeMinutesGoal} mins
                </span>
              </p>
            </div>

            {/* Active Calories (Pink/Magenta) */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-xl bg-pink-500/15 flex items-center justify-center shrink-0">
                  <Flame className="w-4 h-4 text-[#EC4899]" />
                </span>
                <span className="text-xs sm:text-sm font-semibold text-zinc-200">
                  Calorías activas
                </span>
              </div>
              <p className="text-sm sm:text-base font-extrabold font-mono tabular-nums text-white">
                {activeCalories}{' '}
                <span className="text-xs font-semibold text-zinc-400">
                  / {activeCaloriesGoal} Cal
                </span>
              </p>
            </div>
          </div>

          {/* Bottom totals row: Calorías totales + Distancia activa */}
          <div className="pt-2.5 border-t border-white/10 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] text-zinc-400">Calorías totales</p>
              <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-white">
                {totalCalories.toLocaleString('es-MX')} Cal
              </p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-400">Distancia activa</p>
              <p className="mt-0.5 text-sm font-extrabold font-mono tabular-nums text-[#a3e635]">
                {formattedDistance}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 7-Day Weekly Strip (D L M M J V S) with Memoized Mini 3-Ring Hearts */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="pt-3 border-t border-white/10"
      >
        <div className="grid grid-cols-7 gap-1">
          {weekStrip.map((day) => {
            const isSelected = day.date === selectedDayKey;
            return (
              <button
                key={day.date}
                type="button"
                disabled={day.isFuture}
                onClick={() => onSelectDay(day.date)}
                aria-label={`Inspeccionar actividad del ${day.date}`}
                aria-pressed={isSelected}
                className={`min-h-[60px] rounded-2xl py-1.5 px-1 flex flex-col items-center justify-center gap-1 transition-colors ${
                  day.isFuture
                    ? 'opacity-35 cursor-not-allowed'
                    : isSelected
                      ? 'bg-[#a3e635]/15 border border-[#a3e635]/60'
                      : day.isToday
                        ? 'bg-white/[0.04] border border-white/15 hover:bg-white/[0.08]'
                        : 'border border-transparent hover:bg-white/[0.05]'
                }`}
              >
                <span
                  className={`text-[10px] font-extrabold leading-none ${
                    isSelected
                      ? 'text-[#a3e635]'
                      : day.isToday
                        ? 'text-white'
                        : 'text-zinc-400'
                  }`}
                >
                  {day.letter}
                </span>
                <MiniHeartRings
                  stepsPct={day.stepsPct}
                  activeMinPct={day.activeMinPct}
                  activeKcalPct={day.activeKcalPct}
                />
                <span className="text-[10px] font-mono tabular-nums leading-none text-zinc-400">
                  {day.dayNumber}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export const DailyActivityWidget = React.memo(
  DailyActivityWidgetBase,
  arePropsEqual,
);
