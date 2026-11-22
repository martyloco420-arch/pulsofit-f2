import React, { useMemo } from 'react';

// Smooth symmetric heart path centered around (100, 96) inside a 200x200 viewBox
const HEART_PATH =
  'M 100 56 C 85 32, 42 36, 42 74 C 42 108, 78 134, 100 156 C 122 134, 158 108, 158 74 C 158 36, 115 32, 100 56 Z';

export interface DailyActivityRingsProps {
  steps: number;
  stepsGoal: number;
  activeMinutes: number;
  activeMinutesGoal: number;
  activeCalories: number;
  activeCaloriesGoal: number;
}

interface ComputedRingStroke {
  key: 'steps' | 'activeMin' | 'activeKcal';
  transform: string;
  color: string;
  track: string;
  localStroke: number;
  strokeDasharray: string;
  strokeDashoffset: number;
  opacity: number;
}

function areDailyActivityRingsPropsEqual(
  prev: DailyActivityRingsProps,
  next: DailyActivityRingsProps,
): boolean {
  return (
    prev.steps === next.steps &&
    prev.stepsGoal === next.stepsGoal &&
    prev.activeMinutes === next.activeMinutes &&
    prev.activeMinutesGoal === next.activeMinutesGoal &&
    prev.activeCalories === next.activeCalories &&
    prev.activeCaloriesGoal === next.activeCaloriesGoal
  );
}

const DailyActivityRingsBase: React.FC<DailyActivityRingsProps> = ({
  steps,
  stepsGoal,
  activeMinutes,
  activeMinutesGoal,
  activeCalories,
  activeCaloriesGoal,
}) => {
  const { rings, closedCount } = useMemo(() => {
    const safeStepsGoal = Math.max(1, stepsGoal);
    const safeMinGoal = Math.max(1, activeMinutesGoal);
    const safeKcalGoal = Math.max(1, activeCaloriesGoal);

    const stepsPct = Math.max(0, Math.min(100, Math.round((steps / safeStepsGoal) * 100)));
    const activeMinPct = Math.max(
      0,
      Math.min(100, Math.round((activeMinutes / safeMinGoal) * 100)),
    );
    const activeKcalPct = Math.max(
      0,
      Math.min(100, Math.round((activeCalories / safeKcalGoal) * 100)),
    );

    const closed =
      (steps >= safeStepsGoal ? 1 : 0) +
      (activeMinutes >= safeMinGoal ? 1 : 0) +
      (activeCalories >= safeKcalGoal ? 1 : 0);

    const visualStrokePx = 11.5;
    const specs: Array<{
      key: 'steps' | 'activeMin' | 'activeKcal';
      scale: number;
      color: string;
      track: string;
      pct: number;
    }> = [
      { key: 'steps', scale: 1.18, color: '#22C55E', track: '#19291E', pct: stepsPct },
      { key: 'activeMin', scale: 0.87, color: '#38BDF8', track: '#152534', pct: activeMinPct },
      { key: 'activeKcal', scale: 0.56, color: '#EC4899', track: '#2E1725', pct: activeKcalPct },
    ];

    const computedRings: ComputedRingStroke[] = specs.map((spec) => {
      const clamped = Math.max(0, Math.min(100, spec.pct));
      const visiblePct = clamped > 0 ? Math.max(3, clamped) : 0;
      return {
        key: spec.key,
        transform: `translate(100 98) scale(${spec.scale}) translate(-100 -96)`,
        color: spec.color,
        track: spec.track,
        localStroke: visualStrokePx / spec.scale,
        strokeDasharray: '100',
        strokeDashoffset: 100 - visiblePct,
        opacity: clamped > 0 ? 1 : 0,
      };
    });

    return { rings: computedRings, closedCount: closed };
  }, [steps, stepsGoal, activeMinutes, activeMinutesGoal, activeCalories, activeCaloriesGoal]);

  return (
    <div className="relative w-[156px] h-[156px] sm:w-[168px] sm:h-[168px] shrink-0 mx-auto sm:mx-0">
      <svg
        viewBox="0 0 200 200"
        className="w-full h-full"
        role="img"
        aria-label={`Corazón de actividad diaria: ${closedCount} de 3 metas completadas`}
      >
        {rings.map((ring) => (
          <g key={ring.key} transform={ring.transform}>
            <path
              d={HEART_PATH}
              fill="none"
              stroke={ring.track}
              strokeWidth={ring.localStroke}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={HEART_PATH}
              pathLength={100}
              fill="none"
              stroke={ring.color}
              strokeWidth={ring.localStroke}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={ring.strokeDasharray}
              strokeDashoffset={ring.strokeDashoffset}
              className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
              style={{ opacity: ring.opacity }}
            />
          </g>
        ))}
      </svg>
    </div>
  );
};

export const DailyActivityRings = React.memo(
  DailyActivityRingsBase,
  areDailyActivityRingsPropsEqual,
);

export interface MiniHeartRingsProps {
  stepsPct: number;
  activeMinPct: number;
  activeKcalPct: number;
}

function areMiniHeartPropsEqual(
  prev: MiniHeartRingsProps,
  next: MiniHeartRingsProps,
): boolean {
  return (
    prev.stepsPct === next.stepsPct &&
    prev.activeMinPct === next.activeMinPct &&
    prev.activeKcalPct === next.activeKcalPct
  );
}

const MiniHeartRingsBase: React.FC<MiniHeartRingsProps> = ({
  stepsPct,
  activeMinPct,
  activeKcalPct,
}) => {
  const rings = useMemo(() => {
    const visualStrokePx = 2.15;
    const specs = [
      { key: 's', scale: 0.165, color: '#22C55E', track: '#1C2620', pct: stepsPct },
      { key: 'm', scale: 0.116, color: '#38BDF8', track: '#182430', pct: activeMinPct },
      { key: 'k', scale: 0.068, color: '#EC4899', track: '#281823', pct: activeKcalPct },
    ];
    return specs.map((spec) => {
      const clamped = Math.max(0, Math.min(100, spec.pct));
      const visiblePct = clamped > 0 ? Math.max(6, clamped) : 0;
      return {
        key: spec.key,
        transform: `translate(16 15.5) scale(${spec.scale}) translate(-100 -96)`,
        color: spec.color,
        track: spec.track,
        localStroke: visualStrokePx / spec.scale,
        strokeDasharray: '100',
        strokeDashoffset: 100 - visiblePct,
        hasFill: clamped > 0,
      };
    });
  }, [stepsPct, activeMinPct, activeKcalPct]);

  return (
    <svg viewBox="0 0 32 32" className="w-7 h-7" aria-hidden="true">
      {rings.map((ring) => (
        <g key={ring.key} transform={ring.transform}>
          <path
            d={HEART_PATH}
            fill="none"
            stroke={ring.track}
            strokeWidth={ring.localStroke}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {ring.hasFill && (
            <path
              d={HEART_PATH}
              pathLength={100}
              fill="none"
              stroke={ring.color}
              strokeWidth={ring.localStroke}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={ring.strokeDasharray}
              strokeDashoffset={ring.strokeDashoffset}
            />
          )}
        </g>
      ))}
    </svg>
  );
};

export const MiniHeartRings = React.memo(MiniHeartRingsBase, areMiniHeartPropsEqual);
