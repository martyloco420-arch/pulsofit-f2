import type {
  MuscleFatigueMap,
  MuscleGroup,
  WorkoutExercise,
  WorkoutSession,
} from '../types/fitness';

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  pecho: 'Pecho',
  espalda: 'Espalda',
  hombros: 'Hombros',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  cuadriceps: 'Cuádriceps',
  isquiotibiales: 'Isquiotibiales',
  gluteos: 'Glúteos',
  pantorrillas: 'Pantorrillas',
  abdomen: 'Abdomen y Core',
};

export const ALL_MUSCLES: MuscleGroup[] = [
  'pecho',
  'espalda',
  'hombros',
  'biceps',
  'triceps',
  'cuadriceps',
  'isquiotibiales',
  'gluteos',
  'pantorrillas',
  'abdomen',
];

// Natural recovery rate: ~1.85% per hour (~54h from 100% back to 0%)
const RECOVERY_RATE_PER_HOUR = 1.85;

export function createInitialMuscleFatigue(nowIso = new Date().toISOString()): MuscleFatigueMap {
  const map = {} as MuscleFatigueMap;
  for (const m of ALL_MUSCLES) {
    map[m] = { fatigue: 0, lastUpdatedAt: nowIso };
  }
  return map;
}

export function getCurrentFatigue(
  entry: { fatigue: number; lastUpdatedAt: string } | undefined,
  referenceMs = Date.now(),
): number {
  if (!entry) return 0;
  const lastMs = Date.parse(entry.lastUpdatedAt);
  if (Number.isNaN(lastMs)) return Math.max(0, Math.min(100, Math.round(entry.fatigue)));
  const elapsedHours = Math.max(0, (referenceMs - lastMs) / (1000 * 60 * 60));
  const recovered = elapsedHours * RECOVERY_RATE_PER_HOUR;
  return Math.max(0, Math.min(100, Math.round(entry.fatigue - recovered)));
}

export function getDecayedFatigueMap(
  map: MuscleFatigueMap,
  referenceMs = Date.now(),
): Record<MuscleGroup, number> {
  const result = {} as Record<MuscleGroup, number>;
  for (const m of ALL_MUSCLES) {
    result[m] = getCurrentFatigue(map[m], referenceMs);
  }
  return result;
}

export function computeWorkoutFatigueImpact(
  exercises: WorkoutExercise[],
): Partial<Record<MuscleGroup, number>> {
  const impact: Partial<Record<MuscleGroup, number>> = {};

  for (const ex of exercises) {
    const completedSets = ex.sets.filter((s) => s.completed);
    if (completedSets.length === 0) continue;

    // Weight & rep effort multiplier so heavier / higher-rep sets contribute slightly more fatigue
    const avgLoadFactor =
      completedSets.reduce((acc, s) => {
        const repFactor = Math.min(1.35, 0.75 + s.reps * 0.035);
        const weightBonus = s.weightKg > 0 ? Math.min(1.25, 0.95 + s.weightKg / 260) : 0.95;
        return acc + repFactor * weightBonus;
      }, 0) / completedSets.length;

    const primaryDelta = Math.round(completedSets.length * 14 * avgLoadFactor);
    const secondaryDelta = Math.round(completedSets.length * 6.5 * avgLoadFactor);

    for (const pm of ex.primaryMuscles) {
      impact[pm] = Math.min(100, (impact[pm] ?? 0) + primaryDelta);
    }
    for (const sm of ex.secondaryMuscles) {
      impact[sm] = Math.min(100, (impact[sm] ?? 0) + secondaryDelta);
    }
  }

  return impact;
}

export function applyWorkoutFatigue(
  currentMap: MuscleFatigueMap,
  exercises: WorkoutExercise[],
  nowIso = new Date().toISOString(),
): { updatedMap: MuscleFatigueMap; impact: Partial<Record<MuscleGroup, number>> } {
  const referenceMs = Date.parse(nowIso) || Date.now();
  const impact = computeWorkoutFatigueImpact(exercises);
  const updatedMap = { ...currentMap };

  for (const m of ALL_MUSCLES) {
    const base = getCurrentFatigue(currentMap[m], referenceMs);
    const added = impact[m] ?? 0;
    updatedMap[m] = {
      fatigue: Math.max(0, Math.min(100, Math.round(base + added))),
      lastUpdatedAt: nowIso,
    };
  }

  return { updatedMap, impact };
}

/**
 * Recalcula el mapa de fatiga muscular desde cero a partir de los entrenamientos
 * restantes en orden cronológico, garantizando consistencia al eliminar sesiones.
 */
export function recomputeMuscleFatigueFromWorkouts(
  workouts: WorkoutSession[],
  nowIso = new Date().toISOString(),
): MuscleFatigueMap {
  let map = createInitialMuscleFatigue(nowIso);
  if (!workouts || workouts.length === 0) {
    return map;
  }

  const chronological = [...workouts].sort((a, b) =>
    (a.completedAt || a.startedAt).localeCompare(b.completedAt || b.startedAt),
  );

  for (const w of chronological) {
    const atIso = w.completedAt || w.startedAt || nowIso;
    const { updatedMap } = applyWorkoutFatigue(map, w.exercises ?? [], atIso);
    map = updatedMap;
  }

  return map;
}

export function getRecoveryStatus(fatigue: number): {
  label: string;
  barClass: string;
  textClass: string;
} {
  if (fatigue < 30) {
    return {
      label: 'Recuperado',
      barClass: 'bg-[#D4FF33]',
      textClass: 'text-[#D4FF33]',
    };
  }
  if (fatigue < 65) {
    return {
      label: 'Carga moderada',
      barClass: 'bg-amber-400',
      textClass: 'text-amber-300',
    };
  }
  return {
    label: 'Fatiga alta',
    barClass: 'bg-rose-500',
    textClass: 'text-rose-400',
  };
}
