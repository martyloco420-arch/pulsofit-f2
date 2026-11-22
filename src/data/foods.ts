import type { UserProfile } from '../types/fitness';

export interface FoodPreset {
  id: string;
  name: string;
  servingLabel: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export const FOOD_PRESETS: FoodPreset[] = [
  {
    id: 'pollo_150',
    name: 'Pechuga de pollo a la plancha',
    servingLabel: '150 g',
    calories: 248,
    proteinG: 46,
    carbsG: 0,
    fatG: 5,
  },
  {
    id: 'arroz_150',
    name: 'Arroz blanco cocido',
    servingLabel: '150 g',
    calories: 195,
    proteinG: 4,
    carbsG: 43,
    fatG: 0,
  },
  {
    id: 'huevos_3',
    name: 'Huevos enteros revueltos',
    servingLabel: '3 piezas',
    calories: 215,
    proteinG: 19,
    carbsG: 2,
    fatG: 15,
  },
  {
    id: 'avena_60',
    name: 'Avena en hojuelas',
    servingLabel: '60 g',
    calories: 228,
    proteinG: 8,
    carbsG: 40,
    fatG: 4,
  },
  {
    id: 'whey_1',
    name: 'Batido de proteína Whey',
    servingLabel: '1 scoop (30 g)',
    calories: 120,
    proteinG: 24,
    carbsG: 3,
    fatG: 1,
  },
  {
    id: 'salmon_150',
    name: 'Salmón a la plancha',
    servingLabel: '150 g',
    calories: 310,
    proteinG: 33,
    carbsG: 0,
    fatG: 19,
  },
  {
    id: 'platano_1',
    name: 'Plátano maduro',
    servingLabel: '1 pieza mediana',
    calories: 105,
    proteinG: 1,
    carbsG: 27,
    fatG: 0,
  },
  {
    id: 'atun_1',
    name: 'Lata de atún en agua',
    servingLabel: '1 lata (130 g)',
    calories: 130,
    proteinG: 29,
    carbsG: 0,
    fatG: 1,
  },
  {
    id: 'yogur_griego',
    name: 'Yogur griego natural',
    servingLabel: '170 g',
    calories: 115,
    proteinG: 17,
    carbsG: 7,
    fatG: 2,
  },
  {
    id: 'aguacate_medio',
    name: 'Aguacate Hass',
    servingLabel: '1/2 pieza',
    calories: 120,
    proteinG: 2,
    carbsG: 6,
    fatG: 11,
  },
  {
    id: 'carne_magra_150',
    name: 'Carne molida magra 90/10',
    servingLabel: '150 g',
    calories: 265,
    proteinG: 39,
    carbsG: 0,
    fatG: 11,
  },
  {
    id: 'papa_200',
    name: 'Papa / Patata cocida',
    servingLabel: '200 g',
    calories: 174,
    proteinG: 4,
    carbsG: 40,
    fatG: 0,
  },
  {
    id: 'pan_integral_2',
    name: 'Pan integral tostado',
    servingLabel: '2 rebanadas',
    calories: 160,
    proteinG: 7,
    carbsG: 28,
    fatG: 2,
  },
  {
    id: 'almendras_30',
    name: 'Almendras naturales',
    servingLabel: '30 g',
    calories: 175,
    proteinG: 6,
    carbsG: 6,
    fatG: 15,
  },
];

export interface NutritionTargets {
  bmr: number;
  tdee: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterMl: number;
}

export function calculateNutritionTargets(profile: UserProfile): NutritionTargets {
  const weight = Math.max(35, profile.weightKg || 75);
  const height = Math.max(120, profile.heightCm || 175);
  const age = Math.max(14, profile.age || 28);

  // Mifflin-St Jeor BMR
  const sexOffset = profile.sex === 'hombre' ? 5 : profile.sex === 'mujer' ? -161 : -78;
  const bmr = Math.round(10 * weight + 6.25 * height - 5 * age + sexOffset);

  // Activity factor scaled by training days per week
  const days = Math.max(1, Math.min(7, profile.trainingDaysPerWeek || 4));
  const activityMultiplier =
    days <= 2 ? 1.35 : days <= 4 ? 1.52 : days <= 5 ? 1.62 : 1.72;
  const tdee = Math.round(bmr * activityMultiplier);

  let calories = tdee;
  if (profile.goal === 'perder_grasa') {
    calories = Math.max(1300, Math.round(tdee - 420));
  } else if (profile.goal === 'ganar_musculo') {
    calories = Math.round(tdee + 300);
  }

  // Macro distribution
  const proteinPerKg = profile.goal === 'perder_grasa' ? 2.1 : profile.goal === 'ganar_musculo' ? 2.0 : 1.8;
  const proteinG = Math.round(weight * proteinPerKg);
  const fatG = Math.round((calories * 0.25) / 9);
  const remainingCalories = Math.max(200, calories - proteinG * 4 - fatG * 9);
  const carbsG = Math.round(remainingCalories / 4);
  const waterMl = Math.round(weight * 35 + days * 70);

  return {
    bmr,
    tdee,
    calories,
    proteinG,
    carbsG,
    fatG,
    waterMl,
  };
}
