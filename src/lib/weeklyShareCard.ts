import { shiftIsoDate } from './compareDates';
import { computeRecoveryIndex0To100 } from './crossModuleIntelligence';
import { computeDailyActivitySummary } from './dailyActivity';
import { getLocalDateKey, getTodayIsoDate } from './storage';
import { computeFlexibleStreakSummary } from './streakEngine';
import {
  formatDistance,
  getDistanceUnit,
  getWeightUnit,
  kgToDisplayWeight,
} from './units';
import type { AppDatabase, UserProfile } from '../types/fitness';

export interface WeeklySummarySnapshot {
  startDateIso: string;
  endDateIso: string;
  dateRangeLabel: string;
  streakDays: number;
  sessionsCount: number;
  strengthCount: number;
  cardioCount: number;
  hiitCount: number;
  totalDistanceKm: number;
  netWeightDeltaKg: number | null;
  latestWeightKg: number | null;
  avgSleepHours: number | null;
  avgSleepQualityPct: number | null;
  avgRecoveryScore: number;
  avgPulseBpm: number | null;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function formatDateSpanEs(startIso: string, endIso: string): string {
  const [sy, sm, sd] = startIso.split('-').map((n) => parseInt(n, 10));
  const [ey, em, ed] = endIso.split('-').map((n) => parseInt(n, 10));
  const sDt = new Date(sy, (sm || 1) - 1, sd || 1);
  const eDt = new Date(ey, (em || 1) - 1, ed || 1);
  if (Number.isNaN(sDt.getTime()) || Number.isNaN(eDt.getTime())) {
    return `${startIso} – ${endIso}`;
  }
  const sStr = sDt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const eStr = eDt.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${sStr} – ${eStr}`;
}

export function computeWeeklySummarySnapshot(
  db: AppDatabase,
  todayIso = getTodayIsoDate(),
): WeeklySummarySnapshot {
  const startDateIso = shiftIsoDate(todayIso, -6);
  const endDateIso = todayIso;

  const weekDates: string[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    weekDates.push(shiftIsoDate(todayIso, -i));
  }
  const weekSet = new Set(weekDates);

  const streak = computeFlexibleStreakSummary(db, todayIso);

  // Distance across 7 days from reconciled daily activity
  let totalDistanceKm = 0;
  for (const d of weekDates) {
    totalDistanceKm += computeDailyActivitySummary(db, d).activeDistanceKm;
  }
  totalDistanceKm = Math.round(totalDistanceKm * 100) / 100;

  // Sessions count across workouts, cardio, HIIT
  const strengthIds = new Set<string>();
  for (const w of db.workouts ?? []) {
    const key = getLocalDateKey(w.completedAt);
    if (weekSet.has(key)) strengthIds.add(w.id || `${w.completedAt}_${w.title}`);
  }
  const cardioIds = new Set<string>();
  for (const c of db.cardioSessions ?? []) {
    const key = getLocalDateKey(c.date || c.completedAt);
    if (weekSet.has(key)) cardioIds.add(c.id || `${c.completedAt}_${c.activityType}`);
  }
  const hiitIds = new Set<string>();
  for (const h of db.hiitSessions ?? []) {
    const key = getLocalDateKey(h.date || h.completedAt);
    if (weekSet.has(key)) hiitIds.add(h.id || `${h.completedAt}_${h.name}`);
  }

  const strengthCount = strengthIds.size;
  const cardioCount = cardioIds.size;
  const hiitCount = hiitIds.size;
  const sessionsCount = strengthCount + cardioCount + hiitCount;

  // Net weight change inside or anchored just before the 7-day window
  const weightByDate = new Map<string, number>();
  for (const bw of db.bodyWeights ?? []) {
    const k = getLocalDateKey(bw.date);
    if (k && Number.isFinite(bw.weightKg) && bw.weightKg > 0) {
      weightByDate.set(k, bw.weightKg);
    }
  }
  for (const sc of db.bodyScans ?? []) {
    const k = getLocalDateKey(sc.date || sc.recordedAt);
    if (k && Number.isFinite(sc.weightKg) && sc.weightKg > 0) {
      weightByDate.set(k, sc.weightKg);
    }
  }
  const allWeightsAsc = Array.from(weightByDate.entries())
    .map(([date, weightKg]) => ({ date, weightKg }))
    .filter((w) => w.date <= endDateIso)
    .sort((a, b) => a.date.localeCompare(b.date));

  const inWindowWeights = allWeightsAsc.filter(
    (w) => w.date >= startDateIso && w.date <= endDateIso,
  );
  const priorAnchor = [...allWeightsAsc]
    .reverse()
    .find((w) => w.date < startDateIso) ?? null;

  let netWeightDeltaKg: number | null = null;
  const latestWeightKg =
    inWindowWeights[inWindowWeights.length - 1]?.weightKg ??
    allWeightsAsc[allWeightsAsc.length - 1]?.weightKg ??
    null;

  if (inWindowWeights.length >= 2) {
    const first = inWindowWeights[0].weightKg;
    const last = inWindowWeights[inWindowWeights.length - 1].weightKg;
    netWeightDeltaKg = Math.round((last - first) * 10) / 10;
  } else if (inWindowWeights.length === 1 && priorAnchor) {
    netWeightDeltaKg =
      Math.round((inWindowWeights[0].weightKg - priorAnchor.weightKg) * 10) / 10;
  }

  // Sleep averages
  const weekSleep = (db.sleepSessions ?? []).filter((s) =>
    weekSet.has(getLocalDateKey(s.date || s.wakeUpAt)),
  );
  let avgSleepHours: number | null = null;
  let avgSleepQualityPct: number | null = null;
  if (weekSleep.length > 0) {
    const totalMin = weekSleep.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
    const totalQ = weekSleep.reduce((sum, s) => sum + (s.sleepQualityPct || 0), 0);
    avgSleepHours = Math.round((totalMin / weekSleep.length / 60) * 10) / 10;
    avgSleepQualityPct = Math.round(totalQ / weekSleep.length);
  } else {
    const readinessSleep = weekDates
      .map((d) => db.readinessByDate?.[d])
      .filter((r): r is NonNullable<typeof r> => Boolean(r && r.sleepHours > 0));
    if (readinessSleep.length > 0) {
      avgSleepHours =
        Math.round(
          (readinessSleep.reduce((s, r) => s + r.sleepHours, 0) / readinessSleep.length) *
            10,
        ) / 10;
      avgSleepQualityPct = Math.round(
        (readinessSleep.reduce((s, r) => s + (r.sleepQuality || 3) * 20, 0) /
          readinessSleep.length),
      );
    }
  }

  // Recovery average (0..100)
  const readinessScores = weekDates
    .map((d) => db.readinessByDate?.[d]?.score)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const currentRecovery = computeRecoveryIndex0To100(db).score;
  const avgRecoveryScore =
    readinessScores.length > 0
      ? Math.round(
          readinessScores.reduce((s, v) => s + v, 0) / readinessScores.length,
        )
      : currentRecovery;

  // Pulse BPM average
  const weekPulse = (db.pulseHrvRecords ?? []).filter((p) =>
    weekSet.has(getLocalDateKey(p.date || p.recordedAt)),
  );
  let avgPulseBpm: number | null = null;
  if (weekPulse.length > 0) {
    avgPulseBpm = Math.round(
      weekPulse.reduce((s, p) => s + p.bpm, 0) / weekPulse.length,
    );
  } else {
    const rBpm = weekDates
      .map((d) => db.readinessByDate?.[d]?.restingBpm)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    if (rBpm.length > 0) {
      avgPulseBpm = Math.round(rBpm.reduce((s, v) => s + v, 0) / rBpm.length);
    }
  }

  return {
    startDateIso,
    endDateIso,
    dateRangeLabel: formatDateSpanEs(startDateIso, endDateIso),
    streakDays: streak.streakDays,
    sessionsCount,
    strengthCount,
    cardioCount,
    hiitCount,
    totalDistanceKm,
    netWeightDeltaKg,
    latestWeightKg,
    avgSleepHours,
    avgSleepQualityPct,
    avgRecoveryScore,
    avgPulseBpm,
  };
}

export async function renderWeeklyShareCardDataUrl(
  snapshot: WeeklySummarySnapshot,
  profile: UserProfile,
): Promise<{
  dataUrl: string;
  fileName: string;
  summaryText: string;
}> {
  const weightUnit = getWeightUnit(profile.weightUnit);
  const distanceUnit = getDistanceUnit(profile.distanceUnit);

  const width = 1080;
  const height = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el lienzo de la Tarjeta Semanal.');
  }

  // Deep obsidian background
  ctx.fillStyle = '#090B0E';
  ctx.fillRect(0, 0, width, height);

  // Subtle emerald + lime glow accents (glassmorphism atmosphere)
  const glowTop = ctx.createRadialGradient(840, 140, 20, 840, 140, 560);
  glowTop.addColorStop(0, 'rgba(212, 255, 51, 0.16)');
  glowTop.addColorStop(1, 'rgba(9, 11, 14, 0)');
  ctx.fillStyle = glowTop;
  ctx.fillRect(0, 0, width, height);

  const glowBottom = ctx.createRadialGradient(220, 1140, 20, 220, 1140, 520);
  glowBottom.addColorStop(0, 'rgba(16, 185, 129, 0.14)');
  glowBottom.addColorStop(1, 'rgba(9, 11, 14, 0)');
  ctx.fillStyle = glowBottom;
  ctx.fillRect(0, 0, width, height);

  // Main glass container
  drawRoundedRect(ctx, 48, 48, width - 96, height - 96, 44);
  ctx.fillStyle = 'rgba(18, 21, 28, 0.94)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.stroke();

  // Header Brand
  ctx.font = '800 44px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('Pulso', 96, 134);
  const pulsoW = ctx.measureText('Pulso').width;
  ctx.fillStyle = '#D4FF33';
  ctx.fillText('Fit', 96 + pulsoW, 134);

  ctx.font = '600 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText('RESUMEN SEMANAL · 7 DÍAS', 96, 176);

  ctx.textAlign = 'right';
  ctx.font = '700 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#E5E7EB';
  ctx.fillText(profile.name || 'Atleta PulsoFit', width - 96, 132);
  ctx.font = '600 22px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#D4FF33';
  ctx.fillText(snapshot.dateRangeLabel, width - 96, 172);
  ctx.textAlign = 'left';

  // Divider
  ctx.strokeStyle = '#232836';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 210);
  ctx.lineTo(width - 96, 210);
  ctx.stroke();

  // Hero Streak Card
  drawRoundedRect(ctx, 96, 248, width - 192, 236, 32);
  const heroGrad = ctx.createLinearGradient(96, 248, width - 96, 484);
  heroGrad.addColorStop(0, '#141B14');
  heroGrad.addColorStop(1, '#0E1218');
  ctx.fillStyle = heroGrad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(212, 255, 51, 0.35)';
  ctx.stroke();

  ctx.font = '700 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#A3E635';
  ctx.fillText('RACHA ACTIVA', 136, 304);

  ctx.font = '800 108px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#FFFFFF';
  const streakStr = String(snapshot.streakDays);
  ctx.fillText(streakStr, 136, 418);
  const streakW = ctx.measureText(streakStr).width;

  ctx.font = '700 34px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#D4FF33';
  ctx.fillText(snapshot.streakDays === 1 ? 'día activo' : 'días activos', 158 + streakW, 416);

  ctx.textAlign = 'right';
  ctx.font = '700 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText('SESIONES EN LA SEMANA', width - 136, 316);
  ctx.font = '800 64px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#34D399';
  ctx.fillText(String(snapshot.sessionsCount), width - 136, 394);
  ctx.font = '600 20px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#D1D5DB';
  ctx.fillText(
    `${snapshot.strengthCount} fuerza · ${snapshot.cardioCount} cardio · ${snapshot.hiitCount} HIIT`,
    width - 136,
    438,
  );
  ctx.textAlign = 'left';

  // Grid of 4 Primary KPI Cards (2x2)
  const colW = (width - 192 - 24) / 2;
  const rowH = 220;
  const gridTop = 516;

  // Weight delta formatting
  let weightDisplayStr = 'Sin cambios';
  let weightColor = '#E5E7EB';
  if (snapshot.netWeightDeltaKg !== null) {
    const absConverted = kgToDisplayWeight(
      Math.abs(snapshot.netWeightDeltaKg),
      weightUnit,
    );
    if (Math.abs(snapshot.netWeightDeltaKg) < 0.05) {
      weightDisplayStr = `0.0 ${weightUnit}`;
    } else {
      const sign = snapshot.netWeightDeltaKg > 0 ? '+' : '-';
      weightDisplayStr = `${sign}${absConverted.toFixed(1)} ${weightUnit}`;
      weightColor = snapshot.netWeightDeltaKg < 0 ? '#D4FF33' : '#FBBF24';
    }
  } else if (snapshot.latestWeightKg !== null) {
    weightDisplayStr = `${kgToDisplayWeight(snapshot.latestWeightKg, weightUnit).toFixed(1)} ${weightUnit}`;
  }

  const sleepValueStr =
    snapshot.avgSleepHours !== null
      ? `${snapshot.avgSleepHours.toFixed(1)} h`
      : '-- h';
  const sleepSubStr =
    snapshot.avgSleepQualityPct !== null
      ? `Calidad media: ${snapshot.avgSleepQualityPct}%`
      : 'Sin registros de sueño esta semana';

  const kpis = [
    {
      title: 'CAMBIO NETO DE PESO',
      value: weightDisplayStr,
      sub:
        snapshot.latestWeightKg !== null
          ? `Último peso: ${kgToDisplayWeight(snapshot.latestWeightKg, weightUnit).toFixed(1)} ${weightUnit}`
          : 'Báscula / Registro manual',
      color: weightColor,
    },
    {
      title: 'DISTANCIA ACUMULADA',
      value: formatDistance(snapshot.totalDistanceKm, distanceUnit, 2),
      sub: 'Cardio GPS + Caminatas + Pasos',
      color: '#38BDF8',
    },
    {
      title: 'PROMEDIO DE SUEÑO',
      value: sleepValueStr,
      sub: sleepSubStr,
      color: '#A78BFA',
    },
    {
      title: 'RECUPERACIÓN Y PULSO',
      value: `${snapshot.avgRecoveryScore}/100`,
      sub:
        snapshot.avgPulseBpm !== null
          ? `Pulso medio: ${snapshot.avgPulseBpm} BPM`
          : 'Sin toma PPG semanal',
      color: '#34D399',
    },
  ];

  kpis.forEach((kpi, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 96 + col * (colW + 24);
    const y = gridTop + row * (rowH + 24);

    drawRoundedRect(ctx, x, y, colW, rowH, 28);
    ctx.fillStyle = '#0C0E13';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#232836';
    ctx.stroke();

    ctx.font = '700 20px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#9CA3AF';
    ctx.fillText(kpi.title, x + 32, y + 52);

    ctx.font = '800 54px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = kpi.color;
    ctx.fillText(kpi.value, x + 32, y + 132);

    ctx.font = '600 20px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#A1A1AA';
    ctx.fillText(kpi.sub, x + 32, y + 182);
  });

  // Bottom Weekly Highlights Strip
  const stripY = 1004;
  drawRoundedRect(ctx, 96, stripY, width - 192, 176, 28);
  ctx.fillStyle = '#0C0E13';
  ctx.fill();
  ctx.strokeStyle = '#232836';
  ctx.stroke();

  ctx.font = '700 21px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#D4FF33';
  ctx.fillText('RESUMEN BIOMÉTRICO SEMANAL', 132, stripY + 48);

  const summaryCols = [
    { label: 'SUEÑO', val: snapshot.avgSleepQualityPct !== null ? `${snapshot.avgSleepQualityPct}%` : '--' },
    { label: 'RECUPERACIÓN', val: `${snapshot.avgRecoveryScore}/100` },
    { label: 'PULSO MEDIO', val: snapshot.avgPulseBpm !== null ? `${snapshot.avgPulseBpm} BPM` : '--' },
  ];
  const sColW = (width - 192 - 64) / 3;
  summaryCols.forEach((c, i) => {
    const cx = 128 + i * sColW;
    ctx.font = '700 18px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#71717A';
    ctx.fillText(c.label, cx, stripY + 98);

    ctx.font = '800 34px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(c.val, cx, stripY + 144);
  });

  // Footer
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#71717A';
  ctx.fillText(
    `PulsoFit · Ventana local ${snapshot.startDateIso} a ${snapshot.endDateIso}`,
    96,
    height - 96,
  );
  ctx.textAlign = 'right';
  ctx.fillStyle = '#34D399';
  ctx.fillText('pulsofit.app', width - 96, height - 96);
  ctx.textAlign = 'left';

  const dataUrl = canvas.toDataURL('image/png');
  const fileName = `pulsofit-resumen-semanal-${snapshot.endDateIso}.png`;
  const summaryText = `Mi semana en PulsoFit (${snapshot.dateRangeLabel}): Racha ${snapshot.streakDays}d · ${snapshot.sessionsCount} sesiones · ${formatDistance(snapshot.totalDistanceKm, distanceUnit, 2)} · Cambio peso: ${weightDisplayStr}`;

  return { dataUrl, fileName, summaryText };
}

export async function shareOrDownloadWeeklyCard(
  dataUrl: string,
  fileName: string,
  summaryText: string,
  mode: 'share' | 'download',
): Promise<'shared' | 'downloaded'> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();

  if (
    mode === 'share' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: 'Resumen Semanal PulsoFit',
          text: summaryText,
          files: [file],
        });
        return 'shared';
      } catch {
        // User cancelled or share failed -> fallback download
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return 'downloaded';
}
