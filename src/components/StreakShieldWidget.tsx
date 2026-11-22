import React from 'react';
import { Award, CheckCircle2, Flame, Shield, ShieldCheck } from 'lucide-react';
import { useLowPowerMode } from '../lib/lowPowerMode';
import type { StreakSummary } from '../lib/streakEngine';

interface StreakShieldWidgetProps {
  streak: StreakSummary;
  onToggleScheduledRestToday: () => void;
}

export const StreakShieldWidget: React.FC<StreakShieldWidgetProps> = ({
  streak,
  onToggleScheduledRestToday,
}) => {
  const { isLowPower } = useLowPowerMode();

  const size = 112;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset =
    circumference - (circumference * Math.min(100, Math.max(0, streak.milestoneProgressPct))) / 100;

  const ringStroke = streak.isFrozenToday
    ? '#38bdf8'
    : streak.streakDays >= 30
      ? '#D4FF33'
      : streak.streakDays >= 7
        ? '#a3e635'
        : '#D4FF33';

  return (
    <section
      aria-label="Racha Activa y Escudo de Descanso"
      className="rounded-3xl border border-[#242936] bg-gradient-to-br from-[#141720] to-[#101218] p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Circular Progressive Ring + Streak Stats */}
        <div className="flex items-center gap-4">
          <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
            <svg
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              className="-rotate-90"
              aria-hidden="true"
            >
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="#1E2330"
                strokeWidth={strokeWidth}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={ringStroke}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{
                  transition: isLowPower ? 'none' : 'stroke-dashoffset 500ms ease-out',
                }}
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <div className="flex items-center gap-1">
                {streak.isFrozenToday ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                ) : (
                  <Flame className="w-3.5 h-3.5 text-[#D4FF33]" />
                )}
                <span className="text-2xl font-extrabold font-mono tabular-nums text-white leading-none">
                  {streak.streakDays}
                </span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mt-1">
                {streak.streakDays === 1 ? 'día' : 'días'}
              </span>
              <span className="text-[9px] font-mono font-bold text-[#D4FF33]">
                Meta {streak.nextMilestone}d
              </span>
            </div>
          </div>

          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-extrabold font-display text-white">
                Racha Activa
              </h2>
              {streak.isTodayTrained ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#D4FF33]/15 border border-[#D4FF33]/35 px-2 py-0.5 text-[10px] font-extrabold text-[#D4FF33]">
                  <CheckCircle2 className="w-3 h-3" />
                  Cumplida hoy
                </span>
              ) : streak.isTodayScheduledRest ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 border border-sky-400/40 px-2 py-0.5 text-[10px] font-extrabold text-sky-300">
                  <ShieldCheck className="w-3 h-3" />
                  Congelada hoy
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-400/35 px-2 py-0.5 text-[10px] font-extrabold text-amber-300">
                  En juego hoy
                </span>
              )}
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              {streak.streakDays >= 100
                ? '¡Hito máximo de 100 días desbloqueado! Mantén tu ritmo.'
                : `Te faltan ${streak.daysToNextMilestone} ${
                    streak.daysToNextMilestone === 1 ? 'día' : 'días'
                  } para el hito de ${streak.nextMilestone} días (${streak.milestoneProgressPct}%).`}
            </p>

            {/* Flexible Rest Shield Counter */}
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1 font-bold text-sky-300">
                <Shield className="w-3.5 h-3.5" />
                Escudo de Descanso: {streak.shieldUsedInCurrent7d}/{streak.shieldMaxPer7d} en 7d
              </span>
              <span className="text-zinc-500">·</span>
              <span className="text-zinc-400">
                {streak.shieldRemainingIn7d > 0
                  ? `${streak.shieldRemainingIn7d} ${
                      streak.shieldRemainingIn7d === 1 ? 'libre disponible' : 'libres disponibles'
                    }`
                  : 'Límite 2/7 usado'}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Quick Action Button for Rotating Work Shift Rest */}
        <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
          <button
            type="button"
            disabled={!streak.canActivateRestShieldToday}
            onClick={onToggleScheduledRestToday}
            className={`min-h-[42px] inline-flex items-center justify-center gap-2 rounded-2xl px-4 text-xs font-extrabold transition-colors active:scale-[0.98] ${
              streak.isTodayTrained
                ? 'border border-[#242936] bg-[#161A23] text-zinc-500 cursor-not-allowed'
                : streak.isTodayScheduledRest
                  ? 'border border-sky-400/50 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30'
                  : streak.shieldRemainingIn7d > 0
                    ? 'border border-sky-400/40 bg-[#131B26] text-sky-300 hover:border-sky-300 hover:text-white'
                    : 'border border-[#242936] bg-[#161A23] text-zinc-500 cursor-not-allowed'
            }`}
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
            {streak.isTodayTrained
              ? 'Ya entrenaste hoy'
              : streak.isTodayScheduledRest
                ? 'Escudo activo hoy (Quitar)'
                : 'Descanso programado hoy'}
          </button>
          <span className="text-[10px] text-zinc-500 text-center sm:text-right">
            Congela tu racha en turnos rotativos (máx. 2 días / 7d)
          </span>
        </div>
      </div>

      {/* Bottom Row: Unlockable Badges (7, 30, 100d) + 7-Day Rolling Window Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        {/* Badges 7 / 30 / 100 */}
        <div className="grid grid-cols-3 gap-2">
          {streak.badges.map((badge) => (
            <div
              key={badge.days}
              className={`rounded-2xl border px-2.5 py-2 flex flex-col justify-between transition-colors ${
                badge.unlocked
                  ? 'border-[#D4FF33]/45 bg-[#D4FF33]/10'
                  : 'border-[#222631] bg-[#0B0D12]'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={`text-xs font-extrabold font-mono tabular-nums ${
                    badge.unlocked ? 'text-[#D4FF33]' : 'text-zinc-500'
                  }`}
                >
                  {badge.days}D
                </span>
                <Award
                  className={`w-3.5 h-3.5 ${
                    badge.unlocked ? 'text-[#D4FF33]' : 'text-zinc-600'
                  }`}
                />
              </div>
              <p
                className={`mt-1 text-[11px] font-bold leading-tight truncate ${
                  badge.unlocked ? 'text-white' : 'text-zinc-500'
                }`}
              >
                {badge.title}
              </p>
            </div>
          ))}
        </div>

        {/* Rolling 7-Day Shield & Training Strip */}
        <div className="rounded-2xl border border-[#222631] bg-[#0B0D12] px-3 py-2 flex items-center justify-between gap-1.5">
          {streak.last7Days.map((day) => {
            const dotClass =
              day.status === 'trained'
                ? 'bg-[#D4FF33] text-[#0A0B0D] border-[#D4FF33]'
                : day.status === 'shielded_rest'
                  ? 'bg-sky-500/25 text-sky-300 border-sky-400/60'
                  : day.status === 'pending_today'
                    ? 'bg-amber-500/15 text-amber-300 border-amber-400/50 border-dashed'
                    : 'bg-[#171A23] text-zinc-500 border-[#262B38]';

            const titleText =
              day.status === 'trained'
                ? `${day.date}: Entrenado`
                : day.status === 'shielded_rest'
                  ? `${day.date}: Escudo de Descanso`
                  : day.status === 'pending_today'
                    ? `${day.date}: Hoy (por completar)`
                    : `${day.date}: Libre`;

            return (
              <div
                key={day.date}
                title={titleText}
                className="flex flex-col items-center gap-1 flex-1"
              >
                <span className="text-[10px] font-bold text-zinc-500">{day.letter}</span>
                <div
                  className={`w-7 h-7 rounded-full border flex items-center justify-center text-[10px] font-extrabold ${dotClass}`}
                >
                  {day.status === 'trained' ? (
                    '✓'
                  ) : day.status === 'shielded_rest' ? (
                    <Shield className="w-3 h-3" />
                  ) : day.status === 'pending_today' ? (
                    '•'
                  ) : (
                    '—'
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
