import type {
  EquipmentType,
  ExerciseDefinition,
  Goal,
  MuscleGroup,
  UserProfile,
  WorkoutExercise,
} from '../types/fitness';

export const EQUIPMENT_OPTIONS: {
  id: EquipmentType;
  label: string;
  subtitle: string;
}[] = [
  {
    id: 'gimnasio_completo',
    label: 'Gimnasio completo',
    subtitle: 'Máquinas, poleas, barras y mancuernas',
  },
  {
    id: 'mancuernas',
    label: 'Mancuernas',
    subtitle: 'Entrenamiento libre con pares o ajustables',
  },
  {
    id: 'barra_discos',
    label: 'Barra y discos',
    subtitle: 'Básicos de fuerza y progresión con carga',
  },
  {
    id: 'ligas_resistencia',
    label: 'Ligas de resistencia',
    subtitle: 'Tensión progresiva en casa o viaje',
  },
  {
    id: 'peso_corporal',
    label: 'Peso corporal',
    subtitle: 'Calistenia sin equipo adicional',
  },
];

export const EXERCISE_CATALOG: ExerciseDefinition[] = [
  // PECHO
  {
    id: 'press_banca_barra',
    name: 'Press de banca con barra',
    equipment: ['gimnasio_completo', 'barra_discos'],
    primaryMuscles: ['pecho'],
    secondaryMuscles: ['triceps', 'hombros'],
    defaultSets: 4,
    defaultReps: 8,
    defaultRestSec: 120,
    suggestedWeightKg: 60,
    instructions: 'Escápulas retraídas, baja controlado al pecho medio y empuja explosivo.',
  },
  {
    id: 'press_inclinado_mancuernas',
    name: 'Press inclinado con mancuernas',
    equipment: ['gimnasio_completo', 'mancuernas'],
    primaryMuscles: ['pecho'],
    secondaryMuscles: ['hombros', 'triceps'],
    defaultSets: 3,
    defaultReps: 10,
    defaultRestSec: 90,
    suggestedWeightKg: 20,
    instructions: 'Banco a 30°, codos a 45° respecto al torso.',
  },
  {
    id: 'aperturas_polea',
    name: 'Cruces en polea alta',
    equipment: ['gimnasio_completo'],
    primaryMuscles: ['pecho'],
    secondaryMuscles: ['hombros'],
    defaultSets: 3,
    defaultReps: 12,
    defaultRestSec: 60,
    suggestedWeightKg: 15,
    instructions: 'Mantén ligera flexión de codos y junta manos frente al pecho.',
  },
  {
    id: 'aperturas_mancuernas',
    name: 'Aperturas con mancuernas',
    equipment: ['gimnasio_completo', 'mancuernas'],
    primaryMuscles: ['pecho'],
    secondaryMuscles: ['hombros'],
    defaultSets: 3,
    defaultReps: 12,
    defaultRestSec: 60,
    suggestedWeightKg: 12,
    instructions: 'Abre en arco amplio controlando el estiramiento.',
  },
  {
    id: 'press_pecho_liga',
    name: 'Press de pecho con liga',
    equipment: ['ligas_resistencia'],
    primaryMuscles: ['pecho'],
    secondaryMuscles: ['triceps', 'hombros'],
    defaultSets: 3,
    defaultReps: 15,
    defaultRestSec: 60,
    suggestedWeightKg: 0,
    instructions: 'Pasa la liga por la espalda alta y extiende los brazos al frente.',
  },
  {
    id: 'flexiones',
    name: 'Flexiones de pecho',
    equipment: ['peso_corporal', 'gimnasio_completo', 'mancuernas', 'ligas_resistencia'],
    primaryMuscles: ['pecho'],
    secondaryMuscles: ['triceps', 'hombros', 'abdomen'],
    defaultSets: 3,
    defaultReps: 15,
    defaultRestSec: 60,
    suggestedWeightKg: 0,
    instructions: 'Cuerpo recto como tabla, baja hasta rozar el suelo.',
  },

  // ESPALDA
  {
    id: 'jalon_pecho',
    name: 'Jalón al pecho en polea',
    equipment: ['gimnasio_completo'],
    primaryMuscles: ['espalda'],
    secondaryMuscles: ['biceps'],
    defaultSets: 4,
    defaultReps: 10,
    defaultRestSec: 90,
    suggestedWeightKg: 50,
    instructions: 'Lleva la barra a la clavícula sacando pecho, sin balancear el torso.',
  },
  {
    id: 'remo_barra',
    name: 'Remo con barra',
    equipment: ['gimnasio_completo', 'barra_discos'],
    primaryMuscles: ['espalda'],
    secondaryMuscles: ['biceps', 'hombros'],
    defaultSets: 4,
    defaultReps: 8,
    defaultRestSec: 120,
    suggestedWeightKg: 55,
    instructions: 'Torso a 45°, tira hacia el ombligo apretando dorsales.',
  },
  {
    id: 'remo_mancuerna',
    name: 'Remo a una mano con mancuerna',
    equipment: ['gimnasio_completo', 'mancuernas'],
    primaryMuscles: ['espalda'],
    secondaryMuscles: ['biceps'],
    defaultSets: 3,
    defaultReps: 10,
    defaultRestSec: 75,
    suggestedWeightKg: 22,
    instructions: 'Lleva el codo hacia la cadera manteniendo la espalda neutra.',
  },
  {
    id: 'remo_liga',
    name: 'Remo sentado con liga',
    equipment: ['ligas_resistencia'],
    primaryMuscles: ['espalda'],
    secondaryMuscles: ['biceps'],
    defaultSets: 4,
    defaultReps: 15,
    defaultRestSec: 60,
    suggestedWeightKg: 0,
    instructions: 'Ancla la liga en los pies y jala codos hacia atrás juntando escápulas.',
  },
  {
    id: 'dominadas_australianas',
    name: 'Dominadas / Remo invertido',
    equipment: ['peso_corporal', 'gimnasio_completo'],
    primaryMuscles: ['espalda'],
    secondaryMuscles: ['biceps', 'abdomen'],
    defaultSets: 3,
    defaultReps: 10,
    defaultRestSec: 90,
    suggestedWeightKg: 0,
    instructions: 'Sube el pecho hacia la barra controlando el descenso.',
  },

  // HOMBROS
  {
    id: 'press_militar_barra',
    name: 'Press militar con barra',
    equipment: ['gimnasio_completo', 'barra_discos'],
    primaryMuscles: ['hombros'],
    secondaryMuscles: ['triceps', 'abdomen'],
    defaultSets: 4,
    defaultReps: 8,
    defaultRestSec: 120,
    suggestedWeightKg: 40,
    instructions: 'Glúteos y abdomen firmes, empuja vertical sobre la cabeza.',
  },
  {
    id: 'press_hombro_mancuernas',
    name: 'Press de hombro con mancuernas',
    equipment: ['gimnasio_completo', 'mancuernas'],
    primaryMuscles: ['hombros'],
    secondaryMuscles: ['triceps'],
    defaultSets: 3,
    defaultReps: 10,
    defaultRestSec: 90,
    suggestedWeightKg: 16,
    instructions: 'Empuja sin arquear en exceso la zona lumbar.',
  },
  {
    id: 'elevaciones_laterales_mancuerna',
    name: 'Elevaciones laterales',
    equipment: ['gimnasio_completo', 'mancuernas'],
    primaryMuscles: ['hombros'],
    secondaryMuscles: [],
    defaultSets: 3,
    defaultReps: 15,
    defaultRestSec: 60,
    suggestedWeightKg: 8,
    instructions: 'Sube hasta la altura de los hombros liderando con el codo.',
  },
  {
    id: 'elevaciones_laterales_liga',
    name: 'Elevaciones laterales con liga',
    equipment: ['ligas_resistencia'],
    primaryMuscles: ['hombros'],
    secondaryMuscles: [],
    defaultSets: 3,
    defaultReps: 15,
    defaultRestSec: 60,
    suggestedWeightKg: 0,
    instructions: 'Pisa el centro de la liga y eleva los brazos lateralmente.',
  },
  {
    id: 'flexiones_pica',
    name: 'Flexiones en pica (Pike Push-up)',
    equipment: ['peso_corporal'],
    primaryMuscles: ['hombros'],
    secondaryMuscles: ['triceps', 'pecho'],
    defaultSets: 3,
    defaultReps: 10,
    defaultRestSec: 75,
    suggestedWeightKg: 0,
    instructions: 'Cadera alta en V invertida, baja la coronilla hacia el frente.',
  },

  // BÍCEPS Y TRÍCEPS
  {
    id: 'curl_biceps_barra',
    name: 'Curl de bíceps con barra',
    equipment: ['gimnasio_completo', 'barra_discos'],
    primaryMuscles: ['biceps'],
    secondaryMuscles: [],
    defaultSets: 3,
    defaultReps: 10,
    defaultRestSec: 60,
    suggestedWeightKg: 25,
    instructions: 'Codos pegados al costado, evita balancear la espalda.',
  },
  {
    id: 'curl_martillo_mancuernas',
    name: 'Curl martillo con mancuernas',
    equipment: ['gimnasio_completo', 'mancuernas'],
    primaryMuscles: ['biceps'],
    secondaryMuscles: [],
    defaultSets: 3,
    defaultReps: 12,
    defaultRestSec: 60,
    suggestedWeightKg: 12,
    instructions: 'Agarre neutro mirando hacia el cuerpo, subida controlada.',
  },
  {
    id: 'curl_biceps_liga',
    name: 'Curl de bíceps con liga',
    equipment: ['ligas_resistencia'],
    primaryMuscles: ['biceps'],
    secondaryMuscles: [],
    defaultSets: 3,
    defaultReps: 15,
    defaultRestSec: 60,
    suggestedWeightKg: 0,
    instructions: 'Pisa la liga y flexiona los codos apretando arriba 1 segundo.',
  },
  {
    id: 'extension_triceps_polea',
    name: 'Extensión de tríceps en polea',
    equipment: ['gimnasio_completo'],
    primaryMuscles: ['triceps'],
    secondaryMuscles: [],
    defaultSets: 3,
    defaultReps: 12,
    defaultRestSec: 60,
    suggestedWeightKg: 25,
    instructions: 'Codos fijos junto al torso, extiende completo abajo.',
  },
  {
    id: 'press_frances_mancuernas',
    name: 'Extensión sobre cabeza con mancuerna',
    equipment: ['gimnasio_completo', 'mancuernas'],
    primaryMuscles: ['triceps'],
    secondaryMuscles: [],
    defaultSets: 3,
    defaultReps: 12,
    defaultRestSec: 60,
    suggestedWeightKg: 16,
    instructions: 'Codos apuntando arriba, baja controlado detrás de la nuca.',
  },
  {
    id: 'fondos_banco',
    name: 'Fondos de tríceps en banco / silla',
    equipment: ['peso_corporal', 'ligas_resistencia'],
    primaryMuscles: ['triceps'],
    secondaryMuscles: ['pecho', 'hombros'],
    defaultSets: 3,
    defaultReps: 12,
    defaultRestSec: 60,
    suggestedWeightKg: 0,
    instructions: 'Mantén la espalda cerca del apoyo y empuja extendiendo codos.',
  },

  // PIERNAS (CUÁDRICEPS, ISQUIOS, GLÚTEOS, PANTORRILLAS)
  {
    id: 'sentadilla_barra',
    name: 'Sentadilla con barra',
    equipment: ['gimnasio_completo', 'barra_discos'],
    primaryMuscles: ['cuadriceps', 'gluteos'],
    secondaryMuscles: ['abdomen'],
    defaultSets: 4,
    defaultReps: 8,
    defaultRestSec: 150,
    suggestedWeightKg: 80,
    instructions: 'Rodillas alineadas con punteras, baja rompiendo paralelo.',
  },
  {
    id: 'prensa_piernas',
    name: 'Prensa de piernas 45°',
    equipment: ['gimnasio_completo'],
    primaryMuscles: ['cuadriceps', 'gluteos'],
    secondaryMuscles: ['isquiotibiales'],
    defaultSets: 4,
    defaultReps: 10,
    defaultRestSec: 120,
    suggestedWeightKg: 120,
    instructions: 'No bloquees rodillas arriba y apoya toda la planta del pie.',
  },
  {
    id: 'sentadilla_goblet',
    name: 'Sentadilla Goblet con mancuerna',
    equipment: ['gimnasio_completo', 'mancuernas'],
    primaryMuscles: ['cuadriceps', 'gluteos'],
    secondaryMuscles: ['abdomen'],
    defaultSets: 3,
    defaultReps: 12,
    defaultRestSec: 90,
    suggestedWeightKg: 20,
    instructions: 'Sujeta la mancuerna pegada al pecho y desciende vertical.',
  },
  {
    id: 'zancadas_mancuernas',
    name: 'Zancadas caminando / estáticas',
    equipment: ['gimnasio_completo', 'mancuernas', 'peso_corporal'],
    primaryMuscles: ['cuadriceps', 'gluteos'],
    secondaryMuscles: ['isquiotibiales'],
    defaultSets: 3,
    defaultReps: 12,
    defaultRestSec: 75,
    suggestedWeightKg: 14,
    instructions: 'Paso amplio, empuja con el talón de la pierna delantera.',
  },
  {
    id: 'sentadilla_liga',
    name: 'Sentadilla con liga de resistencia',
    equipment: ['ligas_resistencia'],
    primaryMuscles: ['cuadriceps', 'gluteos'],
    secondaryMuscles: ['abdomen'],
    defaultSets: 4,
    defaultReps: 15,
    defaultRestSec: 60,
    suggestedWeightKg: 0,
    instructions: 'Pisa la liga y sube los extremos sobre los hombros.',
  },
  {
    id: 'sentadilla_bulgara_bw',
    name: 'Sentadilla búlgara',
    equipment: ['peso_corporal', 'mancuernas', 'gimnasio_completo'],
    primaryMuscles: ['cuadriceps', 'gluteos'],
    secondaryMuscles: ['isquiotibiales'],
    defaultSets: 3,
    defaultReps: 10,
    defaultRestSec: 90,
    suggestedWeightKg: 0,
    instructions: 'Empeine trasero apoyado, inclina ligeramente el torso al frente.',
  },
  {
    id: 'peso_muerto_rumano_barra',
    name: 'Peso muerto rumano con barra',
    equipment: ['gimnasio_completo', 'barra_discos'],
    primaryMuscles: ['isquiotibiales', 'gluteos'],
    secondaryMuscles: ['espalda'],
    defaultSets: 4,
    defaultReps: 8,
    defaultRestSec: 120,
    suggestedWeightKg: 70,
    instructions: 'Empuja la cadera atrás rozando las piernas con la barra.',
  },
  {
    id: 'peso_muerto_rumano_mancuernas',
    name: 'Peso muerto rumano con mancuernas',
    equipment: ['gimnasio_completo', 'mancuernas'],
    primaryMuscles: ['isquiotibiales', 'gluteos'],
    secondaryMuscles: ['espalda'],
    defaultSets: 3,
    defaultReps: 10,
    defaultRestSec: 90,
    suggestedWeightKg: 20,
    instructions: 'Espalda recta, siente el estiramiento en la parte posterior del muslo.',
  },
  {
    id: 'curl_femoral_maquina',
    name: 'Curl femoral en máquina',
    equipment: ['gimnasio_completo'],
    primaryMuscles: ['isquiotibiales'],
    secondaryMuscles: ['pantorrillas'],
    defaultSets: 3,
    defaultReps: 12,
    defaultRestSec: 75,
    suggestedWeightKg: 35,
    instructions: 'Pega la cadera al asiento y controla el retorno.',
  },
  {
    id: 'puente_gluteo_liga',
    name: 'Puente de glúteo (Hip Thrust)',
    equipment: ['peso_corporal', 'ligas_resistencia', 'barra_discos', 'mancuernas', 'gimnasio_completo'],
    primaryMuscles: ['gluteos'],
    secondaryMuscles: ['isquiotibiales'],
    defaultSets: 3,
    defaultReps: 15,
    defaultRestSec: 60,
    suggestedWeightKg: 0,
    instructions: 'Aprieta glúteos arriba 2 segundos manteniendo costillas abajo.',
  },
  {
    id: 'elevacion_talones',
    name: 'Elevación de talones de pie',
    equipment: ['gimnasio_completo', 'mancuernas', 'barra_discos', 'ligas_resistencia', 'peso_corporal'],
    primaryMuscles: ['pantorrillas'],
    secondaryMuscles: [],
    defaultSets: 4,
    defaultReps: 15,
    defaultRestSec: 45,
    suggestedWeightKg: 20,
    instructions: 'Pausa de 1 segundo abajo y máxima extensión arriba.',
  },

  // ABDOMEN / CORE
  {
    id: 'crunch_polea',
    name: 'Crunch abdominal en polea',
    equipment: ['gimnasio_completo'],
    primaryMuscles: ['abdomen'],
    secondaryMuscles: [],
    defaultSets: 3,
    defaultReps: 15,
    defaultRestSec: 60,
    suggestedWeightKg: 25,
    instructions: 'Flexiona la columna llevando codos hacia las rodillas.',
  },
  {
    id: 'plancha_frontal',
    name: 'Plancha abdominal isométrica',
    equipment: ['peso_corporal', 'mancuernas', 'barra_discos', 'ligas_resistencia', 'gimnasio_completo'],
    primaryMuscles: ['abdomen'],
    secondaryMuscles: ['hombros'],
    defaultSets: 3,
    defaultReps: 45,
    defaultRestSec: 45,
    suggestedWeightKg: 0,
    instructions: 'Segundos de tensión continua apretando glúteos y abdomen.',
  },
  {
    id: 'elevacion_piernas',
    name: 'Elevación de piernas acostado',
    equipment: ['peso_corporal', 'mancuernas', 'ligas_resistencia', 'gimnasio_completo'],
    primaryMuscles: ['abdomen'],
    secondaryMuscles: [],
    defaultSets: 3,
    defaultReps: 15,
    defaultRestSec: 45,
    suggestedWeightKg: 0,
    instructions: 'Zona lumbar pegada al suelo al bajar las piernas.',
  },
];

export interface RoutineBlueprint {
  id: string;
  title: string;
  focusLabel: string;
  targetMuscles: MuscleGroup[];
  exercises: ExerciseDefinition[];
  readinessScore: number; // 0 to 100 (100 = completely fresh)
  isRecommended: boolean;
}

function getGoalSetRepParams(goal: Goal, def: ExerciseDefinition): { sets: number; reps: number; rest: number } {
  if (goal === 'perder_grasa') {
    return {
      sets: def.defaultSets,
      reps: Math.min(20, def.defaultReps + 2),
      rest: Math.max(45, def.defaultRestSec - 15),
    };
  }
  if (goal === 'ganar_musculo') {
    return {
      sets: def.defaultSets,
      reps: def.defaultReps,
      rest: def.defaultRestSec,
    };
  }
  return {
    sets: def.defaultSets,
    reps: def.defaultReps,
    rest: def.defaultRestSec,
  };
}

export function getFilteredExercises(userEquipment: EquipmentType[]): ExerciseDefinition[] {
  const eq = userEquipment.length > 0 ? userEquipment : ['peso_corporal'];
  if (eq.includes('gimnasio_completo')) {
    return EXERCISE_CATALOG;
  }
  return EXERCISE_CATALOG.filter((ex) => ex.equipment.some((e) => eq.includes(e)));
}

function pickBestExercises(
  available: ExerciseDefinition[],
  muscles: MuscleGroup[],
  limitPerMuscle: number,
  userEquipment: EquipmentType[],
): ExerciseDefinition[] {
  const picked = new Map<string, ExerciseDefinition>();
  const prioritizeSpecificEq = !userEquipment.includes('gimnasio_completo');

  for (const muscle of muscles) {
    const candidates = available
      .filter((ex) => ex.primaryMuscles.includes(muscle))
      .sort((a, b) => {
        if (!prioritizeSpecificEq) return 0;
        const aMatchesNonBw = a.equipment.some((e) => e !== 'peso_corporal' && userEquipment.includes(e)) ? 1 : 0;
        const bMatchesNonBw = b.equipment.some((e) => e !== 'peso_corporal' && userEquipment.includes(e)) ? 1 : 0;
        return bMatchesNonBw - aMatchesNonBw;
      });

    let count = 0;
    for (const c of candidates) {
      if (count >= limitPerMuscle) break;
      if (!picked.has(c.id)) {
        picked.set(c.id, c);
        count++;
      }
    }
  }
  return Array.from(picked.values());
}

export function generateRecommendedRoutines(
  profile: UserProfile,
  fatigueMap: Record<MuscleGroup, number>,
): RoutineBlueprint[] {
  const available = getFilteredExercises(profile.equipment);

  const templates: {
    id: string;
    title: string;
    focusLabel: string;
    muscles: MuscleGroup[];
    limitPerMuscle: number;
  }[] = [
    {
      id: 'empuje',
      title: 'Día de Empuje',
      focusLabel: 'Pecho · Hombros · Tríceps',
      muscles: ['pecho', 'hombros', 'triceps'],
      limitPerMuscle: 2,
    },
    {
      id: 'tiron',
      title: 'Día de Tirón',
      focusLabel: 'Espalda · Bíceps · Core',
      muscles: ['espalda', 'biceps', 'abdomen'],
      limitPerMuscle: 2,
    },
    {
      id: 'pierna',
      title: 'Pierna Completa',
      focusLabel: 'Cuádriceps · Isquios · Glúteos · Pantorrillas',
      muscles: ['cuadriceps', 'isquiotibiales', 'gluteos', 'pantorrillas'],
      limitPerMuscle: 1,
    },
    {
      id: 'full_body',
      title: 'Cuerpo Completo',
      focusLabel: 'Pecho · Espalda · Cuádriceps · Hombros · Core',
      muscles: ['pecho', 'espalda', 'cuadriceps', 'hombros', 'abdomen'],
      limitPerMuscle: 1,
    },
  ];

  const built = templates.map((tpl) => {
    const exercises = pickBestExercises(available, tpl.muscles, tpl.limitPerMuscle, profile.equipment);
    const avgFatigue =
      tpl.muscles.reduce((sum, m) => sum + (fatigueMap[m] ?? 0), 0) / tpl.muscles.length;
    const readinessScore = Math.max(0, Math.min(100, Math.round(100 - avgFatigue)));
    return {
      id: tpl.id,
      title: tpl.title,
      focusLabel: tpl.focusLabel,
      targetMuscles: tpl.muscles,
      exercises,
      readinessScore,
      isRecommended: false,
    };
  });

  // Recommend the routine whose target muscles are freshest (highest readinessScore)
  // If user trains <= 3 days/week and full_body ties, prefer full_body
  let bestIdx = 0;
  for (let i = 1; i < built.length; i++) {
    if (built[i].readinessScore > built[bestIdx].readinessScore) {
      bestIdx = i;
    } else if (
      built[i].readinessScore === built[bestIdx].readinessScore &&
      profile.trainingDaysPerWeek <= 3 &&
      built[i].id === 'full_body'
    ) {
      bestIdx = i;
    }
  }
  if (built[bestIdx]) {
    built[bestIdx].isRecommended = true;
  }

  return built;
}

export function instantiateWorkoutExercises(
  definitions: ExerciseDefinition[],
  profile: UserProfile,
): WorkoutExercise[] {
  const usesWeights = profile.equipment.some((e) => e !== 'peso_corporal' && e !== 'ligas_resistencia');
  return definitions.map((def, idx) => {
    const params = getGoalSetRepParams(profile.goal, def);
    const baseWeight = usesWeights ? def.suggestedWeightKg : 0;
    return {
      id: `we_${def.id}_${Date.now()}_${idx}`,
      exerciseId: def.id,
      name: def.name,
      primaryMuscles: def.primaryMuscles,
      secondaryMuscles: def.secondaryMuscles,
      restSec: params.rest,
      notes: def.instructions,
      sets: Array.from({ length: params.sets }, (_, sIdx) => ({
        id: `set_${def.id}_${sIdx}_${Date.now()}`,
        weightKg: baseWeight,
        reps: params.reps,
        completed: false,
      })),
    };
  });
}
