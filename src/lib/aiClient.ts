import type {
  BodyCompositionScan,
  CoachChatMessage,
  CoachPersonality,
  DailyReadinessEntry,
  EquipmentType,
  MuscleGroup,
  ShoppingListCategory,
  UserProfile,
  WeeklyMealPlanDay,
} from '../types/fitness';

async function callServerApi<T>(
  endpoint: string,
  payload: Record<string, unknown>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer =
    controller && options?.timeoutMs && typeof window !== 'undefined'
      ? window.setTimeout(() => controller.abort(), options.timeoutMs)
      : undefined;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      if (response.ok) {
        return data as T;
      }
      throw new Error(
        String(data?.error || `Error del servidor de IA (${response.status}).`),
      );
    }

    if (!response.ok) {
      throw new Error(`El servidor devolvió un error (${response.status}).`);
    }

    throw new Error('Respuesta inesperada del servidor al consultar Gemini.');
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al conectar con el servidor de IA.');
    }
    throw err instanceof Error
      ? err
      : new Error('No se pudo conectar con el servidor de Gemini.');
  } finally {
    if (timer !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(timer);
    }
  }
}

export async function testGeminiApiConnection(): Promise<{
  ok: true;
  model: string;
  source: 'server';
}> {
  const data = await callServerApi<{
    ok?: boolean;
    model?: string;
    source?: 'server';
    error?: string;
  }>('/api/ai/test', {});

  if (!data?.ok) {
    throw new Error(data?.error || 'No se pudo validar la conexión con Gemini.');
  }

  return {
    ok: true,
    model: data.model || 'gemini-4-hydrogen',
    source: 'server',
  };
}

export async function generateWorkoutAi<T>(payload: {
  profile: UserProfile;
  fatigueMap: Record<MuscleGroup, number>;
  recentLoads: Record<string, { weightKg: number; reps: number }>;
  readiness?: DailyReadinessEntry | null;
}): Promise<T> {
  return callServerApi<T>('/api/workout/generate', payload);
}

export async function fetchWorkoutAlternativesAi<T>(payload: {
  exerciseName: string;
  primaryMuscles: MuscleGroup[];
  equipment: EquipmentType[];
  weightUnit?: 'kg' | 'lb';
}): Promise<T> {
  return callServerApi<T>('/api/workout/alternatives', payload);
}

export async function estimateNutritionAi<T>(description: string): Promise<T> {
  return callServerApi<T>('/api/nutrition/estimate', { description });
}

export async function parseScaleScreenshotAi<T>(
  imageBase64: string,
  mimeType: string,
): Promise<T> {
  return callServerApi<T>('/api/scale/parse-screenshot', {
    imageBase64,
    mimeType,
  });
}

export async function interpretBodyScansAi<T>(
  profile: UserProfile,
  scans: BodyCompositionScan[],
): Promise<T> {
  return callServerApi<T>('/api/scale/interpret', { profile, scans });
}

export async function synthesizeVoiceCoachTtsAi(text: string): Promise<{
  audioBase64: string;
  mimeType: string;
}> {
  return callServerApi<{ audioBase64: string; mimeType: string }>(
    '/api/coach/tts',
    { text },
    { timeoutMs: 4500 },
  );
}

export type MealAnalysisScope =
  | 'desayuno'
  | 'almuerzo'
  | 'cena'
  | 'snack'
  | 'dia_completo';

export interface DailyNutritionContextForAi {
  calorieTarget: number;
  consumedCalories: number;
  proteinTargetG: number;
  consumedProteinG: number;
  carbsTargetG: number;
  consumedCarbsG: number;
  fatTargetG: number;
  consumedFatG: number;
  goal: string;
}

export interface ScannedPlateIngredient {
  name: string;
  grams: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  mealSlot?: 'desayuno' | 'almuerzo' | 'cena' | 'snack';
}

export interface SuggestedComplementFood {
  name: string;
  portion: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  reason: string;
}

export interface ScannedPlateResult {
  dishSummary: string;
  nutritionistFeedback?: string;
  items: ScannedPlateIngredient[];
  suggestedAdditions?: SuggestedComplementFood[];
}

export async function scanPlatePhotoAi(
  imageBase64: string,
  mimeType: string,
  contextText?: string,
  options?: {
    mealScope?: MealAnalysisScope;
    dailyContext?: DailyNutritionContextForAi;
  },
): Promise<ScannedPlateResult> {
  const hasImage = Boolean(imageBase64 && imageBase64.trim().length > 0);
  const cleanText = contextText?.trim() || '';
  const mealScope: MealAnalysisScope = options?.mealScope ?? 'almuerzo';
  const dailyContext = options?.dailyContext;

  return callServerApi<ScannedPlateResult>('/api/nutrition/scan-plate', {
    imageBase64: hasImage ? imageBase64 : '',
    mimeType,
    contextText: cleanText,
    mealScope,
    dailyContext,
  });
}

export interface BarcodeProductLookup {
  barcode: string;
  name: string;
  defaultGrams: number;
  per100g: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
}

export async function lookupFoodBarcode(code: string): Promise<BarcodeProductLookup> {
  const cleanCode = code.replace(/[^0-9A-Za-z]/g, '').trim();
  if (cleanCode.length < 4) {
    throw new Error('Ingresa un código de barras válido (mínimo 4 caracteres).');
  }

  const response = await fetch(
    `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(cleanCode)}.json`,
  );
  if (!response.ok) {
    throw new Error('No se pudo consultar OpenFoodFacts en este momento.');
  }

  const data = (await response.json()) as {
    status?: number;
    product?: {
      product_name_es?: string;
      product_name?: string;
      generic_name?: string;
      brands?: string;
      serving_quantity?: number | string;
      nutriments?: Record<string, number | string | undefined>;
    };
  };

  if (data.status !== 1 || !data.product) {
    throw new Error(`No se encontró el código ${cleanCode} en OpenFoodFacts.`);
  }

  const p = data.product;
  const n = p.nutriments ?? {};
  const toNum = (v: unknown): number => {
    const num = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(num) && num >= 0 ? num : 0;
  };

  const kcalDirect = toNum(n['energy-kcal_100g'] ?? n['energy-kcal']);
  const kjFallback = toNum(n['energy_100g']);
  const calories = Math.round(kcalDirect > 0 ? kcalDirect : kjFallback / 4.184);
  const proteinG = Math.round(toNum(n['proteins_100g'] ?? n['proteins']) * 10) / 10;
  const carbsG = Math.round(toNum(n['carbohydrates_100g'] ?? n['carbohydrates']) * 10) / 10;
  const fatG = Math.round(toNum(n['fat_100g'] ?? n['fat']) * 10) / 10;

  const baseName =
    p.product_name_es?.trim() ||
    p.product_name?.trim() ||
    p.generic_name?.trim() ||
    `Producto ${cleanCode}`;
  const brand = p.brands?.split(',')[0]?.trim();
  const fullName =
    brand && !baseName.toLowerCase().includes(brand.toLowerCase())
      ? `${baseName} (${brand})`
      : baseName;

  const servingQty = toNum(p.serving_quantity);
  const defaultGrams = servingQty >= 5 && servingQty <= 1500 ? Math.round(servingQty) : 100;

  return {
    barcode: cleanCode,
    name: fullName,
    defaultGrams,
    per100g: {
      calories,
      proteinG,
      carbsG,
      fatG,
    },
  };
}

export interface GeneratedWeeklyMealPlanResult {
  notes: string;
  days: WeeklyMealPlanDay[];
  shoppingList: {
    category: ShoppingListCategory;
    name: string;
    quantity: string;
  }[];
}

export async function generateWeeklyMealPlanAi(payload: {
  profile: UserProfile;
  calorieTarget: number;
  proteinTargetG: number;
  mealsPerDay: number;
  preferencesNote?: string;
}): Promise<GeneratedWeeklyMealPlanResult> {
  return callServerApi<GeneratedWeeklyMealPlanResult>(
    '/api/nutrition/weekly-plan',
    payload,
  );
}

export interface PersonalCoachContext {
  profileName: string;
  goal: string;
  weightUnit: 'kg' | 'lb';
  liquidUnit: 'ml' | 'oz';
  personality: CoachPersonality;
  daysSinceLastWorkout: number | null;
  workoutsLast7Days: number;
  trainedToday: boolean;
  lastWorkoutSummary?: string | null;
  latestWeightDisplay: string | null;
  weightDelta7dDisplay: string | null;
  weightDelta30dDisplay: string | null;
  bodyFatPct?: number | null;
  muscleMassPct?: number | null;
  todaySteps: number;
  stepsGoal: number;
  activeMinutesToday?: number;
  activeMinutesGoal?: number;
  activeKcalToday?: number;
  activeKcalGoal?: number;
  waterConsumedDisplay: string;
  waterTargetDisplay: string;
  waterPct: number;
  electrolytesToday?: number;
  pausaActivaDoneToday?: boolean;
  caloriesConsumed: number;
  caloriesTarget: number;
  proteinConsumedG: number;
  proteinTargetG: number;
  sleepQualityPct: number | null;
  sleepHours: number | null;
  pulseBpm: number | null;
  hrvMs: number | null;
  stressLabel: string;
  lastBpDisplay?: string | null;
  recoveryIndexScore: number;
  recoveryStatusLabel: string;
  streakDays: number;
  shieldUsedInCurrent7d: number;
  isTodayRestShield: boolean;
}

export interface PersonalCoachReply {
  headline: string;
  goodBullets: string[];
  weakBullets: string[];
  reply: string;
  actionTip: string;
  source: 'gemini' | 'offline';
}

function buildMultiTabCoachBullets(context: PersonalCoachContext): {
  goodBullets: string[];
  weakBullets: string[];
} {
  const good: string[] = [];
  const weak: string[] = [];

  if (context.trainedToday) {
    good.push(
      context.lastWorkoutSummary
        ? `Entrenamiento cumplido hoy (${context.lastWorkoutSummary}).`
        : 'Sesión de entrenamiento completada hoy.',
    );
  } else if (context.pausaActivaDoneToday) {
    good.push('Pausa Activa completada hoy: racha protegida.');
  } else if (context.isTodayRestShield) {
    good.push(`Escudo de Descanso activo (racha ${context.streakDays} días intacta).`);
  } else if ((context.daysSinceLastWorkout ?? 99) >= 2) {
    weak.push(`${context.daysSinceLastWorkout} días sin registrar entrenamiento.`);
  } else {
    weak.push('Sesión de entrenamiento o pausa activa pendiente hoy.');
  }

  if (context.waterPct >= 75) {
    good.push(
      `Hidratación sólida al ${context.waterPct}% (${context.waterConsumedDisplay}).`,
    );
  } else {
    weak.push(
      `Hidratación al ${context.waterPct}% (${context.waterConsumedDisplay} / ${context.waterTargetDisplay}).`,
    );
  }

  if (context.recoveryIndexScore >= 75) {
    good.push(`Recuperación alta (${context.recoveryIndexScore}/100 · ${context.stressLabel}).`);
  } else if (context.recoveryIndexScore < 55) {
    weak.push(`Recuperación baja (${context.recoveryIndexScore}/100): modera la carga.`);
  }

  if (context.sleepHours !== null) {
    if (context.sleepHours >= 7) {
      good.push(
        `Buen descanso: ${context.sleepHours.toFixed(1)}h${
          context.sleepQualityPct !== null ? ` (${context.sleepQualityPct}%)` : ''
        }.`,
      );
    } else if (context.sleepHours > 0) {
      weak.push(`Sueño corto (${context.sleepHours.toFixed(1)}h): prioriza acostarte antes.`);
    }
  } else {
    weak.push('Sin registro de sueño reciente para calibrar recuperación.');
  }

  const proteinGap = Math.max(0, Math.round(context.proteinTargetG - context.proteinConsumedG));
  const proteinPct =
    context.proteinTargetG > 0
      ? Math.round((context.proteinConsumedG / context.proteinTargetG) * 100)
      : 0;
  if (proteinPct >= 80) {
    good.push(`Proteína casi cubierta: ${Math.round(context.proteinConsumedG)}/${context.proteinTargetG}g.`);
  } else if (context.caloriesConsumed > 0 && proteinGap > 30) {
    weak.push(`Faltan ${proteinGap}g de proteína para tu meta diaria.`);
  } else if (context.caloriesConsumed === 0) {
    weak.push('Sin comidas registradas hoy en Nutrición.');
  }

  const stepsPct =
    context.stepsGoal > 0 ? Math.round((context.todaySteps / context.stepsGoal) * 100) : 0;
  if (stepsPct >= 70) {
    good.push(`Movimiento activo: ${context.todaySteps.toLocaleString('es-MX')} pasos hoy.`);
  } else if (stepsPct < 45 && !context.trainedToday) {
    weak.push(
      `Pasos bajos (${context.todaySteps.toLocaleString('es-MX')} / ${context.stepsGoal.toLocaleString('es-MX')}).`,
    );
  }

  if (good.length === 0) {
    good.push(
      context.streakDays > 0
        ? `Mantienes racha activa de ${context.streakDays} días en PulsoFit.`
        : 'Sistema listo para sumar tu primer registro completo hoy.',
    );
  }
  if (weak.length === 0) {
    weak.push('Mantén hidratación y descanso constantes hasta cerrar el día.');
  }

  return {
    goodBullets: good.slice(0, 3),
    weakBullets: weak.slice(0, 3),
  };
}

export function generateOfflinePersonalCoachReply(
  context: PersonalCoachContext,
  _history: CoachChatMessage[] = [],
  userMessage?: string,
): PersonalCoachReply {
  const isSargento = context.personality === 'sargento';
  const name = context.profileName?.split(' ')[0] || 'Atleta';
  const msgLower = (userMessage ?? '').toLowerCase();
  const { goodBullets, weakBullets } = buildMultiTabCoachBullets(context);

  if (
    msgLower.includes('turno') ||
    msgLower.includes('trabajo') ||
    msgLower.includes('guardia') ||
    msgLower.includes('chamba') ||
    msgLower.includes('horario')
  ) {
    if (isSargento) {
      return {
        headline: 'Turno pesado detectado · Cero pánico',
        goodBullets,
        weakBullets,
        reply: `Anotado, ${name}. La chamba manda y aquí no nos rajamos: activa el botón de "Pausa Activa (5 min)" o "+500 ml Electrolitos" en Modo Turno aquí abajo para blindar tu racha sin soltar el paso.`,
        actionTip:
          'Completa 1 Pausa Activa de 5 min o activa el Escudo de Descanso.',
        source: 'offline',
      };
    }
    return {
      headline: 'Plan ajustado a tu turno de hoy',
      goodBullets,
      weakBullets,
      reply: `Entendido, ${name}. En días de turno pesado usa el bloque "Modo Turno / Pausa Activa": suma +500 ml con electrolitos y 5 minutos de movilidad sin equipo para cuidar tu energía y tu racha de ${context.streakDays} días.`,
      actionTip: `Lleva tu botella para cubrir ${context.waterTargetDisplay} y realiza tu Pausa Activa.`,
      source: 'offline',
    };
  }

  if (
    msgLower.includes('cansad') ||
    msgLower.includes('agotad') ||
    msgLower.includes('desvel') ||
    msgLower.includes('sueño') ||
    msgLower.includes('dorm')
  ) {
    const recNote = `Tu Índice de Recuperación marca ${context.recoveryIndexScore}/100${
      context.sleepQualityPct !== null ? ` (sueño ${context.sleepQualityPct}%)` : ''
    }.`;
    if (isSargento) {
      return {
        headline: 'Batería baja · Entrena con cabeza',
        goodBullets,
        weakBullets,
        reply: `Órale ${name}, se vale estar fundido pero no tirado. ${recNote} Hoy baja pesos 15% o haz la Pausa Activa de 5 min, hidrátate (${context.waterPct}%) y vete a dormir temprano sin excusas.`,
        actionTip: 'Haz sesión técnica ligera o Pausa Activa y duerme +7h hoy.',
        source: 'offline',
      };
    }
    return {
      headline: 'Prioridad: bajar intensidad y recuperar',
      goodBullets,
      weakBullets,
      reply: `Gracias por avisarme, ${name}. ${recNote} Hoy conviene bajar carga 15–20% o elegir una caminata tranquila con estiramientos para proteger tu sistema nervioso.`,
      actionTip: 'Completa pasos suaves, cubre tu agua y programa tu alarma de sueño.',
      source: 'offline',
    };
  }

  if (
    msgLower.includes('dolor') ||
    msgLower.includes('lesion') ||
    msgLower.includes('lesión') ||
    msgLower.includes('molest')
  ) {
    return {
      headline: isSargento ? 'Cuidado con esa molestia, cero necedades' : 'Cuida esa articulación hoy',
      goodBullets,
      weakBullets,
      reply: isSargento
        ? `Aguas ${name}: disciplina no es tronarse. Suspende el ejercicio que pique o duela, trabaja movilidad sin dolor y dale descanso al grupo afectado.`
        : `Perfecto que lo menciones, ${name}. Evita movimientos con dolor agudo, reduce la carga o enfócate hoy en movilidad suave.`,
      actionTip: 'Sustituye el ejercicio molesto por una variante cómoda en Entrenar.',
      source: 'offline',
    };
  }

  const missingWorkoutDays = context.daysSinceLastWorkout ?? 99;
  const isSlackWorkout =
    !context.trainedToday &&
    !context.isTodayRestShield &&
    !context.pausaActivaDoneToday &&
    missingWorkoutDays >= 2;
  const localHour = new Date().getHours();
  const isLowWater = localHour >= 13 && context.waterPct < 45;
  const isDoingGreat =
    context.trainedToday ||
    context.pausaActivaDoneToday ||
    context.streakDays >= 5 ||
    context.isTodayRestShield;

  const weightPiece = context.latestWeightDisplay
    ? `Peso ${context.latestWeightDisplay}${
        context.weightDelta30dDisplay ? ` (${context.weightDelta30dDisplay} 30d)` : ''
      }.`
    : 'Falta pesaje en báscula.';

  const proteinGap = Math.max(0, Math.round(context.proteinTargetG - context.proteinConsumedG));

  if (context.isTodayRestShield) {
    return {
      headline: isSargento
        ? `Escudo activo · Racha congelada (${context.streakDays}d)`
        : `Descanso programado · Racha protegida (${context.streakDays}d)`,
      goodBullets,
      weakBullets,
      reply: isSargento
        ? `Bien jugado, ${name}: tu racha de ${context.streakDays} días está blindada hoy. No descuides lo básico: agua al ${context.waterPct}% y ${context.todaySteps.toLocaleString('es-MX')} pasos. ${weightPiece}`
        : `Tu racha de ${context.streakDays} días está protegida hoy. Aprovecha para recuperar energía (${context.recoveryIndexScore}/100), hidratarte (${context.waterPct}%) y cerrar tus ${context.proteinTargetG}g de proteína.`,
      actionTip:
        proteinGap > 15
          ? `Asegura ${proteinGap}g más de proteína hoy y cumple ${context.waterTargetDisplay}.`
          : `Mantén ${context.waterTargetDisplay} de agua y acuéstate temprano hoy.`,
      source: 'offline',
    };
  }

  if (isSargento) {
    if (isSlackWorkout) {
      return {
        headline: `${missingWorkoutDays} días sin darle · ¡Ponte las pilas!`,
        goodBullets,
        weakBullets,
        reply: `¿Qué onda campeón de sillón? Llevas ${missingWorkoutDays} días sin entrenar y vas en ${context.todaySteps.toLocaleString('es-MX')} pasos. ${weightPiece} Agua al ${context.waterPct}%. Si andas en turno dale a la Pausa Activa de 5 min; si no, ponte los tenis ya.`,
        actionTip: 'Saca 25 min en Entrenar o completa ya tu Pausa Activa de 5 min.',
        source: 'offline',
      };
    }

    if (isLowWater || proteinGap > 40) {
      return {
        headline: isLowWater
          ? '¡Ese garrafón está de adorno!'
          : 'Te falta gasolina proteica hoy',
        goodBullets,
        weakBullets,
        reply: `Órale ${name}, no descuides lo básico: llevas ${context.waterConsumedDisplay} de agua (${context.waterPct}%) y te faltan ${proteinGap}g de proteína. Recuperación ${context.recoveryIndexScore}/100. ¡Aprieta el cierre del día!`,
        actionTip: `Tómate 500 ml de agua ahorita y mete +30g de proteína.`,
        source: 'offline',
      };
    }

    if (isDoingGreat) {
      return {
        headline: `¡Eso chingón! Racha firme de ${context.streakDays} días`,
        goodBullets,
        weakBullets,
        reply: `Mis respetos, ${name}: sumas ${context.workoutsLast7Days} entrenos esta semana, recuperación ${context.recoveryIndexScore}/100 y agua al ${context.waterPct}%. ${weightPiece} Remata tus macros (${context.caloriesConsumed}/${context.caloriesTarget} kcal).`,
        actionTip:
          context.todaySteps < context.stepsGoal
            ? `Cierra tus ${(context.stepsGoal - context.todaySteps).toLocaleString('es-MX')} pasos restantes antes de dormir.`
            : 'Registra tu sueño esta noche y mantén la disciplina.',
        source: 'offline',
      };
    }

    return {
      headline: 'Reporte del Sargento · Toca chambear hoy',
      goodBullets,
      weakBullets,
      reply: `A ver ${name}, vamos al grano: llevas ${context.todaySteps.toLocaleString('es-MX')} pasos, agua al ${context.waterPct}% y recuperación ${context.recoveryIndexScore}/100. ${weightPiece} Defiende hoy tu racha de ${context.streakDays} días.`,
      actionTip: 'Completa tu rutina en Entrenar o haz la Pausa Activa de 5 min.',
      source: 'offline',
    };
  }

  if (isDoingGreat) {
    return {
      headline: `Excelente constancia · ${context.streakDays} días de racha`,
      goodBullets,
      weakBullets,
      reply: `Vas muy bien, ${name}. Sumas ${context.workoutsLast7Days} sesiones en 7 días, tu Recuperación marca ${context.recoveryIndexScore}/100 y llevas ${context.waterConsumedDisplay} de agua (${context.waterPct}%). ${weightPiece}`,
      actionTip:
        proteinGap > 20
          ? `Completa tus últimos ${proteinGap}g de proteína hoy para recuperar mejor.`
          : 'Cierra el día hidratado y con buen descanso nocturno.',
      source: 'offline',
    };
  }

  return {
    headline: 'Tu resumen multi-pestaña está listo',
    goodBullets,
    weakBullets,
    reply: `Hola ${name}: llevas ${context.todaySteps.toLocaleString('es-MX')} pasos, agua al ${context.waterPct}% y recuperación en ${context.recoveryIndexScore}/100. ${weightPiece} Un entrenamiento corto o tu Pausa Activa hoy mantiene el impulso vivo.`,
    actionTip:
      missingWorkoutDays >= 2
        ? 'Dedica 20 min a moverte o completa 1 Pausa Activa de 5 min.'
        : `Toma otro vaso de agua y apunta a tus ${context.proteinTargetG}g de proteína.`,
    source: 'offline',
  };
}

export async function askPersonalCoachAi(payload: {
  context: PersonalCoachContext;
  personality: CoachPersonality;
  history: CoachChatMessage[];
  userMessage?: string;
}): Promise<PersonalCoachReply> {
  const { context, personality, history, userMessage } = payload;
  const fallbackBullets = buildMultiTabCoachBullets(context);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return generateOfflinePersonalCoachReply(context, history, userMessage);
  }

  const res = await callServerApi<{
    headline: string;
    goodBullets?: string[];
    weakBullets?: string[];
    reply: string;
    actionTip: string;
  }>(
    '/api/coach/personal-chat',
    {
      context,
      personality,
      history: history.slice(-6).map((m) => ({
        role: m.role,
        text: m.text,
      })),
      userMessage,
    },
    { timeoutMs: 12000 },
  );

  if (!res || typeof res.reply !== 'string' || !res.reply.trim()) {
    throw new Error('El servidor de IA devolvió una respuesta vacía.');
  }

  const cleanGood = Array.isArray(res.goodBullets)
    ? res.goodBullets.filter((b) => typeof b === 'string' && b.trim()).slice(0, 3)
    : [];
  const cleanWeak = Array.isArray(res.weakBullets)
    ? res.weakBullets.filter((b) => typeof b === 'string' && b.trim()).slice(0, 3)
    : [];

  return {
    headline: res.headline?.trim() || 'Reporte del Coach',
    goodBullets: cleanGood.length > 0 ? cleanGood : fallbackBullets.goodBullets,
    weakBullets: cleanWeak.length > 0 ? cleanWeak : fallbackBullets.weakBullets,
    reply: res.reply.trim(),
    actionTip: res.actionTip?.trim() || 'Sigue registrando tu progreso diario.',
    source: 'gemini',
  };
}
