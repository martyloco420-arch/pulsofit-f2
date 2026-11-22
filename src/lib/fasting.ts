import type { FastingHistoryEntry, FastingProtocol } from '../types/fitness';
import { getTodayIsoDate } from './storage';

export interface ProtocolOption {
  id: FastingProtocol;
  label: string;
  shortLabel: string;
  fastHours: number;
  feedHours: number;
  desc: string;
}

export const FASTING_PROTOCOLS: ProtocolOption[] = [
  {
    id: '16:8',
    label: '16:8 Clásico',
    shortLabel: '16:8',
    fastHours: 16,
    feedHours: 8,
    desc: '16h ayuno · 8h comida',
  },
  {
    id: '18:6',
    label: '18:6 Avanzado',
    shortLabel: '18:6',
    fastHours: 18,
    feedHours: 6,
    desc: '18h ayuno · 6h comida',
  },
  {
    id: '20:4',
    label: '20:4 Guerrero',
    shortLabel: '20:4',
    fastHours: 20,
    feedHours: 4,
    desc: '20h ayuno · 4h comida',
  },
  {
    id: 'omad_23_1',
    label: 'OMAD 23:1',
    shortLabel: 'OMAD',
    fastHours: 23,
    feedHours: 1,
    desc: '1 comida al día (23h)',
  },
  {
    id: 'custom',
    label: 'Personalizado',
    shortLabel: 'Custom',
    fastHours: 14,
    feedHours: 10,
    desc: 'Elige duración libre',
  },
];

export interface FastingPhase {
  id:
    | 'digestion'
    | 'glucosa'
    | 'quema_grasa'
    | 'cetosis'
    | 'autofagia_inicial'
    | 'cetosis_profunda'
    | 'pico_hgh'
    | 'regeneracion_maxima';
  title: string;
  rangeLabel: string;
  minHours: number;
  maxHours: number;
  summary: string;
  accentColor: string;
}

export const FASTING_PHASES: FastingPhase[] = [
  {
    id: 'digestion',
    title: 'Digestión',
    rangeLabel: '0–4 h',
    minHours: 0,
    maxHours: 4,
    summary: 'Absorción de nutrientes e insulina aún elevada tras tu última comida.',
    accentColor: '#38BDF8',
  },
  {
    id: 'glucosa',
    title: 'Estabilización de glucosa',
    rangeLabel: '4–12 h',
    minHours: 4,
    maxHours: 12,
    summary: 'La insulina baja y el cuerpo moviliza glucógeno hepático como energía.',
    accentColor: '#A78BFA',
  },
  {
    id: 'quema_grasa',
    title: 'Quema de grasa',
    rangeLabel: '12–16 h',
    minHours: 12,
    maxHours: 16,
    summary: 'Aumenta la lipólisis y la oxidación de grasa corporal como combustible.',
    accentColor: '#F59E0B',
  },
  {
    id: 'cetosis',
    title: 'Cetosis',
    rangeLabel: '16–20 h',
    minHours: 16,
    maxHours: 20,
    summary: 'Producción activa de cuerpos cetónicos y mayor claridad mental.',
    accentColor: '#D4FF33',
  },
  {
    id: 'autofagia_inicial',
    title: 'Autofagia inicial',
    rangeLabel: '20–24 h',
    minHours: 20,
    maxHours: 24,
    summary: 'Arranca el reciclaje celular profundo y limpieza de proteínas dañadas.',
    accentColor: '#34D399',
  },
  {
    id: 'cetosis_profunda',
    title: 'Cetosis profunda',
    rangeLabel: '24–36 h',
    minHours: 24,
    maxHours: 36,
    summary: 'Vaciado total de glucógeno hepático; energía sostenida al 100% desde grasa.',
    accentColor: '#22D3EE',
  },
  {
    id: 'pico_hgh',
    title: 'Pico de HGH',
    rangeLabel: '36–48 h',
    minHours: 36,
    maxHours: 48,
    summary: 'Elevación de hormona de crecimiento que protege el músculo y repara tejidos.',
    accentColor: '#A3E635',
  },
  {
    id: 'regeneracion_maxima',
    title: 'Regeneración máxima',
    rangeLabel: '48–56 h',
    minHours: 48,
    maxHours: 56,
    summary: 'Renovación celular e inmunitaria profunda con máxima claridad mental.',
    accentColor: '#D4FF33',
  },
];

export function getFastingPhase(elapsedHours: number): FastingPhase {
  for (let i = FASTING_PHASES.length - 1; i >= 0; i -= 1) {
    if (elapsedHours >= FASTING_PHASES[i].minHours) {
      return FASTING_PHASES[i];
    }
  }
  return FASTING_PHASES[0];
}

export function formatDurationHms(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatWindowClock(timestampMs: number): string {
  const dt = new Date(timestampMs);
  const now = new Date();

  const dtDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((dtDay - todayDay) / (24 * 60 * 60 * 1000));

  const timeStr = dt.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (diffDays === 0) return `Hoy, ${timeStr}`;
  if (diffDays === 1) return `Mañana, ${timeStr}`;
  if (diffDays === -1) return `Ayer, ${timeStr}`;
  return `${dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}, ${timeStr}`;
}

export function toLocalDatetimeInputValue(isoOrMs: string | number): string {
  const d = new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function fromLocalDatetimeInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export interface FastingCalendarDay {
  date: string;
  dayNumber: number;
  weekdayShort: string;
  status: 'goal_met' | 'partial' | 'none';
  hours: number;
  isToday: boolean;
}

export interface FastingStats {
  currentStreakDays: number;
  weeklyAvgHours: number;
  weeklyCompletedCount: number;
  totalCompletedGoals: number;
  calendarDays: FastingCalendarDay[];
}

export function computeFastingStats(
  history: FastingHistoryEntry[],
  referenceDateIso = getTodayIsoDate(),
): FastingStats {
  const byDate = new Map<string, { goalMet: boolean; maxHours: number }>();

  let totalCompletedGoals = 0;
  for (const item of history) {
    if (item.completedGoal) totalCompletedGoals += 1;
    const prev = byDate.get(item.date);
    if (!prev) {
      byDate.set(item.date, {
        goalMet: item.completedGoal,
        maxHours: item.actualHours,
      });
    } else {
      byDate.set(item.date, {
        goalMet: prev.goalMet || item.completedGoal,
        maxHours: Math.max(prev.maxHours, item.actualHours),
      });
    }
  }

  // Consecutive goal streak ending today or yesterday
  let currentStreakDays = 0;
  let cursor = referenceDateIso;
  if (!byDate.get(cursor)?.goalMet) {
    const yesterday = shiftIsoDate(referenceDateIso, -1);
    if (byDate.get(yesterday)?.goalMet) {
      cursor = yesterday;
    }
  }
  while (byDate.get(cursor)?.goalMet) {
    currentStreakDays += 1;
    cursor = shiftIsoDate(cursor, -1);
  }

  // Last 7 days average fasting duration
  const weekStartIso = shiftIsoDate(referenceDateIso, -6);
  const last7Entries = history.filter(
    (h) => h.date >= weekStartIso && h.date <= referenceDateIso,
  );
  const weeklyAvgHours =
    last7Entries.length > 0
      ? Math.round(
          (last7Entries.reduce((sum, h) => sum + h.actualHours, 0) /
            last7Entries.length) *
            10,
        ) / 10
      : 0;
  const weeklyCompletedCount = last7Entries.filter((h) => h.completedGoal).length;

  // 14-day calendar grid ending today
  const calendarDays: FastingCalendarDay[] = [];
  for (let offset = -13; offset <= 0; offset += 1) {
    const date = shiftIsoDate(referenceDateIso, offset);
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const info = byDate.get(date);
    calendarDays.push({
      date,
      dayNumber: d,
      weekdayShort: dt
        .toLocaleDateString('es-ES', { weekday: 'short' })
        .replace('.', '')
        .slice(0, 2)
        .toUpperCase(),
      status: !info ? 'none' : info.goalMet ? 'goal_met' : 'partial',
      hours: info ? Math.round(info.maxHours * 10) / 10 : 0,
      isToday: date === referenceDateIso,
    });
  }

  return {
    currentStreakDays,
    weeklyAvgHours,
    weeklyCompletedCount,
    totalCompletedGoals,
    calendarDays,
  };
}
