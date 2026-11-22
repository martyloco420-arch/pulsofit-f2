import type {
  DistanceUnit,
  HydrationContainerMl,
  LengthUnit,
  LiquidUnit,
  UserProfile,
  WeightUnit,
} from '../types/fitness';

export const KG_TO_LB = 2.20462;
export const KM_TO_MI = 0.621371;
export const ML_PER_OZ = 29.5735;
export const CM_PER_INCH = 2.54;

export function getWeightUnit(unit?: WeightUnit): WeightUnit {
  return unit === 'lb' ? 'lb' : 'kg';
}

export function getDistanceUnit(unit?: DistanceUnit): DistanceUnit {
  return unit === 'mi' ? 'mi' : 'km';
}

export function getLiquidUnit(unit?: LiquidUnit): LiquidUnit {
  return unit === 'oz' ? 'oz' : 'ml';
}

export function getWaistUnit(profile?: Pick<UserProfile, 'waistUnit' | 'distanceUnit'>): LengthUnit {
  if (profile?.waistUnit === 'in') return 'in';
  if (profile?.waistUnit === 'cm') return 'cm';
  return profile?.distanceUnit === 'mi' ? 'in' : 'cm';
}

export function cmToDisplayWaist(cm: number, unit: LengthUnit): number {
  if (!Number.isFinite(cm)) return 0;
  return unit === 'in'
    ? Math.round((cm / CM_PER_INCH) * 10) / 10
    : Math.round(cm * 10) / 10;
}

export function displayWaistToCm(value: number, unit: LengthUnit): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return unit === 'in'
    ? Math.round(value * CM_PER_INCH * 10) / 10
    : Math.round(value * 10) / 10;
}

export function formatWaist(cm: number, unit: LengthUnit): string {
  return `${cmToDisplayWaist(cm, unit)} ${unit}`;
}

/**
 * Converts internal kg to display value.
 * In lb, rounds to nearest 0.5 lb for clean gym/scale increments.
 */
export function kgToDisplayWeight(kg: number, unit: WeightUnit): number {
  if (!Number.isFinite(kg)) return 0;
  if (unit === 'lb') {
    return Math.round(kg * KG_TO_LB * 2) / 2;
  }
  return Math.round(kg * 10) / 10;
}

/**
 * Converts user-entered weight back to internal metric kg.
 */
export function displayWeightToKg(value: number, unit: WeightUnit): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (unit === 'lb') {
    return Math.round((value / KG_TO_LB) * 100) / 100;
  }
  return Math.round(value * 100) / 100;
}

export function formatWeight(kg: number, unit: WeightUnit, decimals?: number): string {
  const converted = kgToDisplayWeight(kg, unit);
  const val =
    decimals !== undefined
      ? Number(converted.toFixed(decimals))
      : converted;
  return `${val} ${unit}`;
}

export function formatVolume(volumeKg: number, unit: WeightUnit): string {
  const val =
    unit === 'lb'
      ? Math.round(volumeKg * KG_TO_LB)
      : Math.round(volumeKg);
  return `${val.toLocaleString('es-ES')} ${unit}`;
}

export function formatWeightNumber(kg: number, unit: WeightUnit): number {
  return kgToDisplayWeight(kg, unit);
}

/**
 * Distance conversions (internal km <-> display km/mi)
 */
export function kmToDisplayDistance(km: number, unit: DistanceUnit): number {
  if (!Number.isFinite(km)) return 0;
  return unit === 'mi' ? km * KM_TO_MI : km;
}

export function displayDistanceToKm(value: number, unit: DistanceUnit): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return unit === 'mi' ? value / KM_TO_MI : value;
}

export function formatDistance(km: number, unit: DistanceUnit, decimals = 2): string {
  const converted = kmToDisplayDistance(km, unit);
  return `${converted.toFixed(decimals)} ${unit}`;
}

export function paceSecPerKmToUnit(secPerKm: number, unit: DistanceUnit): number {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return 0;
  return unit === 'mi' ? secPerKm / KM_TO_MI : secPerKm;
}

/**
 * Liquid conversions (internal ml <-> display ml/oz)
 */
export function mlToOz(ml: number): number {
  if (!Number.isFinite(ml)) return 0;
  return Math.round((ml / ML_PER_OZ) * 10) / 10;
}

export function ozToMl(oz: number): number {
  if (!Number.isFinite(oz) || oz < 0) return 0;
  return Math.round(oz * ML_PER_OZ);
}

export function formatLiquid(ml: number, unit: LiquidUnit): string {
  if (unit === 'oz') {
    return `${mlToOz(ml).toFixed(1)} oz`;
  }
  return `${Math.round(ml).toLocaleString('es-ES')} ml`;
}

export function formatLiquidPrimary(ml: number, unit: LiquidUnit): string {
  if (unit === 'oz') {
    return `${mlToOz(ml).toFixed(1)} oz`;
  }
  return `${(ml / 1000).toFixed(2)} L`;
}

export function formatContainerLabel(ml: HydrationContainerMl, unit: LiquidUnit): string {
  if (unit === 'oz') {
    const oz = Math.round(ml / ML_PER_OZ);
    switch (ml) {
      case 250:
        return `Vaso ${oz} oz`;
      case 500:
        return `Botella ${oz} oz`;
      case 750:
        return `Termo ${oz} oz`;
      case 1000:
        return `Termo ${oz} oz`;
    }
  }
  switch (ml) {
    case 250:
      return 'Vaso 250 ml';
    case 500:
      return 'Botella 500 ml';
    case 750:
      return 'Termo 750 ml';
    case 1000:
      return 'Termo 1 L';
  }
}

export interface ResistanceBandPreset {
  id: string;
  label: string;
  shortLabel: string;
  resistanceKg: number;
  colorHex: string;
  colorName: string;
}

export const RESISTANCE_BAND_PRESETS: ResistanceBandPreset[] = [
  {
    id: 'extra_ligera',
    label: 'Extra Ligera',
    shortLabel: 'Ex. Ligera',
    resistanceKg: 5,
    colorHex: '#FACC15',
    colorName: 'Amarilla',
  },
  {
    id: 'ligera',
    label: 'Ligera',
    shortLabel: 'Ligera',
    resistanceKg: 10,
    colorHex: '#EF4444',
    colorName: 'Roja',
  },
  {
    id: 'media',
    label: 'Media',
    shortLabel: 'Media',
    resistanceKg: 15,
    colorHex: '#3B82F6',
    colorName: 'Azul',
  },
  {
    id: 'fuerte',
    label: 'Fuerte',
    shortLabel: 'Fuerte',
    resistanceKg: 20,
    colorHex: '#22C55E',
    colorName: 'Verde',
  },
  {
    id: 'extra_fuerte',
    label: 'Extra Fuerte',
    shortLabel: 'Ex. Fuerte',
    resistanceKg: 30,
    colorHex: '#A855F7',
    colorName: 'Morada',
  },
];

export function describeBandSelection(
  levelIds: string[],
  unit: WeightUnit,
): { label: string; totalKg: number; displayResistance: string } {
  const matched = levelIds
    .map((id) => RESISTANCE_BAND_PRESETS.find((b) => b.id === id))
    .filter((b): b is ResistanceBandPreset => Boolean(b));

  const safeBands = matched.length > 0 ? matched : [RESISTANCE_BAND_PRESETS[2]];
  const totalKg = safeBands.reduce((acc, b) => acc + b.resistanceKg, 0);
  const label =
    safeBands.length === 1
      ? `Liga ${safeBands[0].label}`
      : `Combinada (${safeBands.map((b) => b.shortLabel).join(' + ')})`;
  const displayResistance = formatWeight(totalKg, unit, unit === 'lb' ? 0 : 0);

  return { label, totalKg, displayResistance };
}
