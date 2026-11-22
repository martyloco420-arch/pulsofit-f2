import type { MuscleGroup } from '../types/fitness';

export type AnatomicalMuscleId =
  | 'pecho'
  | 'hombro_frontal'
  | 'hombro_lateral'
  | 'hombro_posterior'
  | 'biceps'
  | 'triceps'
  | 'antebrazos'
  | 'abdomen'
  | 'oblicuos'
  | 'cuadriceps'
  | 'isquiotibiales'
  | 'gluteos'
  | 'pantorrillas'
  | 'dorsal_ancho'
  | 'trapecio'
  | 'espalda_baja';

export const ANATOMICAL_MUSCLE_LABELS: Record<AnatomicalMuscleId, string> = {
  pecho: 'Pecho',
  hombro_frontal: 'Hombro frontal',
  hombro_lateral: 'Hombro lateral',
  hombro_posterior: 'Hombro posterior',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  antebrazos: 'Antebrazos',
  abdomen: 'Abdomen',
  oblicuos: 'Oblicuos',
  cuadriceps: 'Cuádriceps',
  isquiotibiales: 'Isquiotibiales',
  gluteos: 'Glúteos',
  pantorrillas: 'Pantorrillas',
  dorsal_ancho: 'Dorsal ancho',
  trapecio: 'Trapecio',
  espalda_baja: 'Espalda baja',
};

export interface FreeExerciseDbItem {
  id: string;
  name: string;
  equipment?: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions?: string[];
  images: string[];
}

export interface MuscleActivationItem {
  id: AnatomicalMuscleId;
  label: string;
  role: 'primary' | 'secondary';
  activationPct: number;
}

export interface ThreeStepGuide {
  startPosition: string;
  controlledExecution: string;
  commonMistake: string;
}

export type MovementPattern =
  | 'push'
  | 'pull'
  | 'squat'
  | 'hinge'
  | 'core'
  | 'curl'
  | 'raise';

const FREE_EXERCISE_DB_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const FREE_EXERCISE_IMG_BASE =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const DB_CACHE_KEY = 'pulsofit_free_exercise_db_v1';

let memoryDbCache: FreeExerciseDbItem[] | null = null;
let inflightDbPromise: Promise<FreeExerciseDbItem[]> | null = null;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Curated Spanish -> English search phrases for instant high-accuracy matching
const SPANISH_TO_ENGLISH_PHRASES: [string, string][] = [
  ['press de banca con barra', 'barbell bench press medium grip'],
  ['press banca', 'barbell bench press'],
  ['press inclinado con mancuernas', 'incline dumbbell press'],
  ['press inclinado barra', 'barbell incline bench press'],
  ['cruces en polea', 'cable crossover'],
  ['aperturas en polea', 'cable crossover'],
  ['aperturas con mancuernas', 'dumbbell flyes'],
  ['press de pecho con liga', 'band chest press'],
  ['flexiones en pica', 'pike pushup'],
  ['flexiones de pecho', 'pushups'],
  ['flexiones', 'pushups'],
  ['jalon al pecho', 'wide grip lat pulldown'],
  ['remo con barra', 'bent over barbell row'],
  ['remo a una mano con mancuerna', 'one arm dumbbell row'],
  ['remo con mancuerna', 'one arm dumbbell row'],
  ['remo sentado con liga', 'seated cable rows'],
  ['remo invertido', 'inverted row'],
  ['dominadas', 'pullups'],
  ['press militar con barra', 'standing military press'],
  ['press de hombro con mancuernas', 'dumbbell shoulder press'],
  ['elevaciones laterales', 'side lateral raise'],
  ['curl de biceps con barra', 'barbell curl'],
  ['curl martillo', 'hammer curls'],
  ['curl de biceps', 'dumbbell bicep curl'],
  ['extension de triceps en polea', 'triceps pushdown'],
  ['extension sobre cabeza', 'standing dumbbell triceps extension'],
  ['press frances', 'lying triceps press'],
  ['fondos de triceps', 'dips triceps version'],
  ['fondos en paralelas', 'dips chest version'],
  ['sentadilla con barra', 'barbell squat'],
  ['prensa de piernas', 'leg press'],
  ['sentadilla goblet', 'goblet squat'],
  ['zancadas', 'dumbbell lunges'],
  ['sentadilla bulgara', 'split squat with dumbbells'],
  ['peso muerto rumano con barra', 'romanian deadlift'],
  ['peso muerto rumano con mancuernas', 'stiff legged dumbbell deadlift'],
  ['peso muerto', 'barbell deadlift'],
  ['curl femoral', 'lying leg curls'],
  ['extension de cuadriceps', 'leg extensions'],
  ['puente de gluteo', 'barbell hip thrust'],
  ['hip thrust', 'barbell hip thrust'],
  ['elevacion de talones', 'standing calf raises'],
  ['crunch abdominal en polea', 'cable crunch'],
  ['plancha abdominal', 'plank'],
  ['elevacion de piernas', 'flat bench lying leg raise'],
  ['face pull', 'face pull'],
];

const TOKEN_TRANSLATION: Record<string, string[]> = {
  press: ['press'],
  banca: ['bench'],
  pecho: ['chest', 'bench', 'pectoral'],
  inclinado: ['incline'],
  declinado: ['decline'],
  barra: ['barbell'],
  mancuerna: ['dumbbell'],
  mancuernas: ['dumbbell'],
  polea: ['cable'],
  maquina: ['machine'],
  liga: ['band', 'cable'],
  ligas: ['band', 'cable'],
  aperturas: ['flyes', 'fly'],
  cruces: ['crossover', 'fly'],
  flexiones: ['pushups', 'push'],
  jalon: ['pulldown', 'lat'],
  remo: ['row'],
  dominadas: ['pullups', 'chin', 'lat'],
  militar: ['military', 'overhead', 'shoulder'],
  hombro: ['shoulder', 'deltoid'],
  hombros: ['shoulder'],
  elevaciones: ['raise', 'raises'],
  laterales: ['lateral', 'side'],
  frontales: ['front'],
  pajaros: ['rear', 'bent'],
  posteriores: ['rear'],
  curl: ['curl'],
  biceps: ['bicep', 'biceps'],
  martillo: ['hammer'],
  triceps: ['triceps', 'tricep'],
  extension: ['extension', 'pushdown'],
  frances: ['skullcrusher', 'lying', 'triceps'],
  fondos: ['dips'],
  sentadilla: ['squat'],
  bulgara: ['split', 'bulgarian'],
  goblet: ['goblet'],
  prensa: ['leg', 'press'],
  zancadas: ['lunge', 'lunges'],
  peso: ['deadlift'],
  muerto: ['deadlift'],
  rumano: ['romanian', 'stiff'],
  femoral: ['leg', 'curl', 'hamstring'],
  cuadriceps: ['leg', 'extension', 'quad'],
  gluteo: ['glute', 'hip', 'thrust', 'bridge'],
  gluteos: ['glute', 'hip', 'thrust'],
  puente: ['bridge', 'thrust'],
  talones: ['calf', 'raises'],
  pantorrillas: ['calf'],
  gemelos: ['calf'],
  crunch: ['crunch'],
  abdominal: ['ab', 'crunch'],
  abdomen: ['ab', 'abs'],
  plancha: ['plank'],
  piernas: ['leg', 'legs'],
  elevacion: ['raise'],
  una: ['one'],
  mano: ['arm'],
  sentado: ['seated'],
  pie: ['standing'],
  acostado: ['lying', 'flat'],
  invertido: ['inverted'],
  pica: ['pike'],
  alta: ['high'],
  baja: ['low'],
};

function translateSpanishQueryTokens(name: string): string[] {
  const norm = normalizeText(name);
  for (const [esPhrase, enPhrase] of SPANISH_TO_ENGLISH_PHRASES) {
    if (norm.includes(esPhrase)) {
      return normalizeText(enPhrase).split(' ');
    }
  }

  const tokens = norm.split(' ').filter((t) => t.length > 1);
  const translated: string[] = [];
  for (const tok of tokens) {
    if (TOKEN_TRANSLATION[tok]) {
      translated.push(...TOKEN_TRANSLATION[tok]);
    } else if (!['de', 'con', 'en', 'al', 'la', 'el', 'los', 'las', 'para'].includes(tok)) {
      translated.push(tok);
    }
  }
  return Array.from(new Set(translated));
}

export async function loadFreeExerciseDb(): Promise<FreeExerciseDbItem[]> {
  if (memoryDbCache && memoryDbCache.length > 0) {
    return memoryDbCache;
  }

  // Try localStorage slim cache first
  try {
    const rawCached = localStorage.getItem(DB_CACHE_KEY);
    if (rawCached) {
      const parsed = JSON.parse(rawCached) as {
        savedAt: number;
        items: FreeExerciseDbItem[];
      };
      if (
        Array.isArray(parsed?.items) &&
        parsed.items.length > 0 &&
        Date.now() - (parsed.savedAt ?? 0) < 1000 * 60 * 60 * 24 * 14
      ) {
        memoryDbCache = parsed.items;
        return parsed.items;
      }
    }
  } catch {
    // Ignore cache read error
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return [];
  }

  if (inflightDbPromise) return inflightDbPromise;

  inflightDbPromise = (async () => {
    try {
      const res = await fetch(FREE_EXERCISE_DB_URL, { cache: 'force-cache' });
      if (!res.ok) return [];
      const data = (await res.json()) as FreeExerciseDbItem[];
      if (!Array.isArray(data)) return [];

      const slim: FreeExerciseDbItem[] = data
        .filter((d) => d && d.id && d.name && Array.isArray(d.images) && d.images.length > 0)
        .map((d) => ({
          id: d.id,
          name: d.name,
          equipment: d.equipment ?? null,
          primaryMuscles: Array.isArray(d.primaryMuscles) ? d.primaryMuscles : [],
          secondaryMuscles: Array.isArray(d.secondaryMuscles) ? d.secondaryMuscles : [],
          instructions: Array.isArray(d.instructions) ? d.instructions : [],
          images: d.images.slice(0, 2),
        }));

      memoryDbCache = slim;
      try {
        localStorage.setItem(
          DB_CACHE_KEY,
          JSON.stringify({ savedAt: Date.now(), items: slim }),
        );
      } catch {
        // Ignore localStorage quota limits; memory cache stays populated
      }
      return slim;
    } catch {
      return [];
    } finally {
      inflightDbPromise = null;
    }
  })();

  return inflightDbPromise;
}

const MUSCLE_GROUP_TO_EN: Record<MuscleGroup, string[]> = {
  pecho: ['chest'],
  espalda: ['lats', 'middle back', 'lower back', 'traps'],
  hombros: ['shoulders'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  cuadriceps: ['quadriceps'],
  isquiotibiales: ['hamstrings'],
  gluteos: ['glutes'],
  pantorrillas: ['calves'],
  abdomen: ['abdominals'],
};

export function findBestFreeExerciseMatch(
  db: FreeExerciseDbItem[],
  exerciseName: string,
  primaryMuscles: MuscleGroup[],
): FreeExerciseDbItem | null {
  if (!db || db.length === 0) return null;

  const queryTokens = translateSpanishQueryTokens(exerciseName);
  if (queryTokens.length === 0) return null;

  const expectedEnMuscles = new Set(
    primaryMuscles.flatMap((m) => MUSCLE_GROUP_TO_EN[m] ?? []),
  );

  let bestItem: FreeExerciseDbItem | null = null;
  let bestScore = 0;

  for (const item of db) {
    const itemNorm = normalizeText(item.name);
    const itemTokens = new Set(itemNorm.split(' '));
    let score = 0;

    for (const qt of queryTokens) {
      if (itemTokens.has(qt)) {
        score += 3;
      } else if (itemNorm.includes(qt)) {
        score += 1.6;
      }
    }

    const itemPrimary = item.primaryMuscles.map((m) => m.toLowerCase());
    if (itemPrimary.some((m) => expectedEnMuscles.has(m))) {
      score += 2.5;
    }

    // Prefer exact-ish concise matches over complex variations unless requested
    if (itemNorm.split(' ').length <= queryTokens.length + 2) {
      score += 0.5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  return bestScore >= 4.2 ? bestItem : null;
}

export function getFreeExerciseImageUrls(item: FreeExerciseDbItem | null): [string, string] | null {
  if (!item) return null;
  if (item.images && item.images.length >= 2) {
    return [
      `${FREE_EXERCISE_IMG_BASE}${item.images[0]}`,
      `${FREE_EXERCISE_IMG_BASE}${item.images[1]}`,
    ];
  }
  return [
    `${FREE_EXERCISE_IMG_BASE}${item.id}/0.jpg`,
    `${FREE_EXERCISE_IMG_BASE}${item.id}/1.jpg`,
  ];
}

function mapDbMuscleStringToAnatomical(
  dbMuscle: string,
  normName: string,
): AnatomicalMuscleId[] {
  const m = dbMuscle.toLowerCase();
  if (m === 'chest') return ['pecho'];
  if (m === 'biceps') return ['biceps'];
  if (m === 'triceps') return ['triceps'];
  if (m === 'forearms') return ['antebrazos'];
  if (m === 'abdominals') {
    if (/oblicu|twist|lateral|side|giro|lenador/.test(normName)) {
      return ['oblicuos', 'abdomen'];
    }
    return ['abdomen'];
  }
  if (m === 'quadriceps') return ['cuadriceps'];
  if (m === 'hamstrings') return ['isquiotibiales'];
  if (m === 'glutes') return ['gluteos'];
  if (m === 'calves') return ['pantorrillas'];
  if (m === 'lats') return ['dorsal_ancho'];
  if (m === 'traps') return ['trapecio'];
  if (m === 'middle back') return ['dorsal_ancho', 'trapecio'];
  if (m === 'lower back') return ['espalda_baja'];
  if (m === 'shoulders') {
    if (/lateral|elevaciones laterales|upright/.test(normName)) {
      return ['hombro_lateral', 'hombro_frontal'];
    }
    if (/posterior|face pull|pajar|remo|jalon|dominada|reverse fly/.test(normName)) {
      return ['hombro_posterior'];
    }
    if (/militar|press|flexion|fondo/.test(normName)) {
      return ['hombro_frontal', 'hombro_lateral'];
    }
    return ['hombro_frontal', 'hombro_lateral'];
  }
  return [];
}

function mapAppMuscleToAnatomical(
  mg: MuscleGroup,
  normName: string,
  role: 'primary' | 'secondary',
): AnatomicalMuscleId[] {
  switch (mg) {
    case 'pecho':
      return ['pecho'];
    case 'biceps':
      return role === 'primary' ? ['biceps', 'antebrazos'] : ['biceps'];
    case 'triceps':
      return ['triceps'];
    case 'cuadriceps':
      return ['cuadriceps'];
    case 'isquiotibiales':
      return ['isquiotibiales'];
    case 'gluteos':
      return ['gluteos'];
    case 'pantorrillas':
      return ['pantorrillas'];
    case 'abdomen':
      if (/oblicu|twist|lateral|giro/.test(normName)) {
        return ['abdomen', 'oblicuos'];
      }
      return ['abdomen'];
    case 'hombros':
      if (/lateral/.test(normName)) {
        return role === 'primary' ? ['hombro_lateral', 'hombro_frontal'] : ['hombro_lateral'];
      }
      if (/posterior|face pull|pajar|remo|jalon|dominada/.test(normName)) {
        return ['hombro_posterior'];
      }
      if (/press|flexion|fondo|apertura|cruce/.test(normName)) {
        return role === 'primary'
          ? ['hombro_frontal', 'hombro_lateral']
          : ['hombro_frontal'];
      }
      return ['hombro_frontal', 'hombro_lateral'];
    case 'espalda':
      if (/peso muerto|rumano|lumbar|hiperext/.test(normName)) {
        return ['espalda_baja', 'trapecio'];
      }
      if (/encogimiento|trapecio|shrug/.test(normName)) {
        return ['trapecio'];
      }
      if (/remo/.test(normName)) {
        return ['dorsal_ancho', 'trapecio', 'hombro_posterior'];
      }
      return ['dorsal_ancho', 'trapecio'];
    default:
      return [];
  }
}

export function resolveDetailedAnatomy(
  exerciseName: string,
  primaryMuscles: MuscleGroup[],
  secondaryMuscles: MuscleGroup[],
  matchedDbItem?: FreeExerciseDbItem | null,
): {
  activations: MuscleActivationItem[];
  recoveredPrimary: MuscleGroup[];
  recoveredSecondary: MuscleGroup[];
} {
  const normName = normalizeText(exerciseName);
  const primarySet = new Set<AnatomicalMuscleId>();
  const secondarySet = new Set<AnatomicalMuscleId>();

  for (const pm of primaryMuscles) {
    for (const id of mapAppMuscleToAnatomical(pm, normName, 'primary')) {
      primarySet.add(id);
    }
  }
  for (const sm of secondaryMuscles) {
    for (const id of mapAppMuscleToAnatomical(sm, normName, 'secondary')) {
      if (!primarySet.has(id)) secondarySet.add(id);
    }
  }

  if (matchedDbItem) {
    for (const m of matchedDbItem.primaryMuscles) {
      for (const id of mapDbMuscleStringToAnatomical(m, normName)) {
        primarySet.add(id);
        secondarySet.delete(id);
      }
    }
    for (const m of matchedDbItem.secondaryMuscles) {
      for (const id of mapDbMuscleStringToAnatomical(m, normName)) {
        if (!primarySet.has(id)) secondarySet.add(id);
      }
    }
  }

  // Biomechanical grip/core stabilization enrichment
  if (/remo|jalon|dominada|peso muerto|martillo|curl/.test(normName)) {
    if (!primarySet.has('antebrazos')) secondarySet.add('antebrazos');
  }
  if (/sentadilla|peso muerto|militar|plancha/.test(normName)) {
    if (!primarySet.has('abdomen')) secondarySet.add('abdomen');
    if (/peso muerto|sentadilla/.test(normName) && !primarySet.has('espalda_baja')) {
      secondarySet.add('espalda_baja');
    }
  }

  if (primarySet.size === 0) {
    primarySet.add('pecho');
  }

  const primaryList = Array.from(primarySet);
  const secondaryList = Array.from(secondarySet);

  const activations: MuscleActivationItem[] = [
    ...primaryList.map((id, idx) => ({
      id,
      label: ANATOMICAL_MUSCLE_LABELS[id],
      role: 'primary' as const,
      activationPct: idx === 0 ? 90 : Math.max(70, 82 - idx * 8),
    })),
    ...secondaryList.map((id, idx) => ({
      id,
      label: ANATOMICAL_MUSCLE_LABELS[id],
      role: 'secondary' as const,
      activationPct: Math.max(20, 45 - idx * 7),
    })),
  ];

  // Also convert back into coarse MuscleGroup[] so Perfil fatigue tracking captures everything cleanly
  const toCoarse = (id: AnatomicalMuscleId): MuscleGroup => {
    switch (id) {
      case 'pecho':
        return 'pecho';
      case 'hombro_frontal':
      case 'hombro_lateral':
      case 'hombro_posterior':
        return 'hombros';
      case 'biceps':
      case 'antebrazos':
        return 'biceps';
      case 'triceps':
        return 'triceps';
      case 'abdomen':
      case 'oblicuos':
        return 'abdomen';
      case 'cuadriceps':
        return 'cuadriceps';
      case 'isquiotibiales':
        return 'isquiotibiales';
      case 'gluteos':
        return 'gluteos';
      case 'pantorrillas':
        return 'pantorrillas';
      case 'dorsal_ancho':
      case 'trapecio':
      case 'espalda_baja':
        return 'espalda';
    }
  };

  const recoveredPrimary = Array.from(
    new Set([...primaryMuscles, ...primaryList.map(toCoarse)]),
  );
  const recoveredSecondary = Array.from(
    new Set([...secondaryMuscles, ...secondaryList.map(toCoarse)]),
  ).filter((m) => !recoveredPrimary.includes(m));

  return {
    activations,
    recoveredPrimary,
    recoveredSecondary,
  };
}

export function getMovementPattern(
  exerciseName: string,
  primaryMuscles: MuscleGroup[],
): MovementPattern {
  const n = normalizeText(exerciseName);
  if (/sentadilla|prensa|zancada|bulgara/.test(n)) return 'squat';
  if (/peso muerto|rumano|puente|hip thrust|femoral/.test(n)) return 'hinge';
  if (/crunch|plancha|elevacion de piernas|abdom/.test(n)) return 'core';
  if (/curl|martillo/.test(n)) return 'curl';
  if (/elevacion|laterales|pajaros/.test(n)) return 'raise';
  if (/jalon|remo|dominada|face pull/.test(n)) return 'pull';
  if (/press|flexion|apertura|cruce|fondo|extension/.test(n)) return 'push';

  const first = primaryMuscles[0];
  if (first === 'cuadriceps' || first === 'pantorrillas') return 'squat';
  if (first === 'isquiotibiales' || first === 'gluteos') return 'hinge';
  if (first === 'espalda') return 'pull';
  if (first === 'biceps') return 'curl';
  if (first === 'abdomen') return 'core';
  return 'push';
}

export function getThreeStepGuide(
  exerciseName: string,
  primaryMuscles: MuscleGroup[],
  notes?: string,
): ThreeStepGuide {
  const n = normalizeText(exerciseName);
  const pattern = getMovementPattern(exerciseName, primaryMuscles);
  const customCue = notes?.trim();

  if (pattern === 'squat') {
    return {
      startPosition:
        'Pies al ancho de los hombros con punteras ligeramente hacia afuera, pecho erguido y core firme.',
      controlledExecution:
        customCue ||
        'Desciende en 2–3 segundos llevando cadera atrás y rodillas alineadas con los pies; empuja fuerte desde el centro del pie.',
      commonMistake:
        'Evita que las rodillas colapsen hacia adentro o despegar los talones del suelo al bajar.',
    };
  }

  if (pattern === 'hinge') {
    return {
      startPosition:
        'Pies al ancho de la cadera, rodillas semidesbloqueadas y espalda completamente neutra antes de iniciar.',
      controlledExecution:
        customCue ||
        'Empuja los glúteos hacia atrás manteniendo la carga pegada al cuerpo y contrae fuerte los glúteos al extender la cadera.',
      commonMistake:
        'Evita redondear la zona lumbar o hiperextender la espalda al terminar la repetición.',
    };
  }

  if (pattern === 'pull') {
    return {
      startPosition:
        'Agarre firme con hombros abajo (lejos de las orejas) y torso estable sin balanceo.',
      controlledExecution:
        customCue ||
        'Inicia retrayendo las escápulas, lleva los codos hacia la cadera o costillas y controla el retorno completo.',
      commonMistake:
        'Evita tirar usando impulso lumbar o encoger los trapecios hacia el cuello en cada jalón.',
    };
  }

  if (pattern === 'curl') {
    return {
      startPosition:
        'De pie o sentado con espalda recta y codos pegados a los costados del torso.',
      controlledExecution:
        customCue ||
        'Flexiona los codos elevando el peso sin mover los hombros, aprieta 1 segundo arriba y baja en 2 segundos.',
      commonMistake:
        'Evita balancear el torso o adelantar demasiado los codos para completar la subida.',
    };
  }

  if (pattern === 'raise') {
    return {
      startPosition:
        'Torso ligeramente inclinado al frente, escápulas estables y codos con una microflexión fija.',
      controlledExecution:
        customCue ||
        'Eleva liderando con el codo hasta la altura del hombro en arco amplio y desciende frenando el peso.',
      commonMistake:
        'Evita subir con impulso de piernas o elevar las muñecas por encima de los codos.',
    };
  }

  if (pattern === 'core') {
    return {
      startPosition:
        'Alinea pelvis y costillas apretando glúteos y abdomen desde el primer segundo.',
      controlledExecution:
        customCue ||
        'Mantén la tensión abdominal continua exhalando en la fase de mayor esfuerzo sin perder control postural.',
      commonMistake:
        'Evita arquear la zona lumbar o aguantar la respiración durante la serie.',
    };
  }

  // Push / Extension fallback
  const isOverhead = /militar|hombro|sobre cabeza/.test(n);
  const isTricepsIso = /polea|frances|triceps|fondo/.test(n);

  if (isTricepsIso) {
    return {
      startPosition:
        'Fija los codos junto al cuerpo o apuntando arriba antes de iniciar el movimiento.',
      controlledExecution:
        customCue ||
        'Extiende el antebrazo de forma completa apretando el tríceps y vuelve controlado estirando el músculo.',
      commonMistake:
        'Evita abrir los codos o mover los hombros hacia adelante para empujar más carga.',
    };
  }

  if (isOverhead) {
    return {
      startPosition:
        'Glúteos y abdomen bloqueados, muñecas neutras sobre los codos y carga a la altura de la clavícula.',
      controlledExecution:
        customCue ||
        'Empuja en línea recta por encima de la cabeza sin perder la vertical y baja controlado hasta la posición inicial.',
      commonMistake:
        'Evita arquear en exceso la espalda baja echando el pecho hacia adelante.',
    };
  }

  return {
    startPosition:
      'Retrae y desciende las escápulas apoyando firme la espalda y los pies en el suelo.',
    controlledExecution:
      customCue ||
      'Baja de forma controlada en 2 segundos manteniendo los codos a ~45° del torso y empuja explosivo sin perder tensión.',
    commonMistake:
      'Evita abrir los codos a 90° o rebotar la carga en el pecho al cambiar de dirección.',
  };
}
