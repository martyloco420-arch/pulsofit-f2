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

const LIME_ACCENT = '#a3e635';
const GOLD_PR = '#fbbf24';

export interface WeeklySummarySnapshot {
  startDateIso: string;
  endDateIso: string;
  dateRangeLabel: string;
  streakDays: number;
  sessionsCount: number;
  strengthCount: number;
  cardioCount: number;
  hiitCount: number;
  prsCount: number;
  topPrLabel: string | null;
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

  // Sessions count + PRs across workouts, cardio, HIIT
  const strengthIds = new Set<string>();
  let prsCount = 0;
  let topPrLabel: string | null = null;

  for (const w of db.workouts ?? []) {
    const key = getLocalDateKey(w.completedAt);
    if (weekSet.has(key)) {
      strengthIds.add(w.id || `${w.completedAt}_${w.title}`);
      let workoutPrSets = 0;
      for (const ex of w.exercises ?? []) {
        for (const s of ex.sets ?? []) {
          if (s.isPR) {
            workoutPrSets += 1;
            if (!topPrLabel) {
              topPrLabel = `${ex.name.slice(0, 18)}${s.prLabels?.[0] ? ` · ${s.prLabels[0]}` : ''}`;
            }
          }
        }
      }
      if (workoutPrSets > 0) {
        prsCount += workoutPrSets;
      } else if (w.isPR) {
        prsCount += 1;
        if (!topPrLabel) {
          topPrLabel = w.prLabels?.[0] || w.title.slice(0, 20);
        }
      }
    }
  }

  const cardioIds = new Set<string>();
  for (const c of db.cardioSessions ?? []) {
    const key = getLocalDateKey(c.date || c.completedAt);
    if (weekSet.has(key)) {
      cardioIds.add(c.id || `${c.completedAt}_${c.activityType}`);
      if (c.isPR) {
        prsCount += 1;
        if (!topPrLabel) {
          topPrLabel = c.prLabels?.[0] || 'PR en Cardio GPS';
        }
      }
    }
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
        readinessSleep.reduce((s, r) => s + (r.sleepQuality || 3) * 20, 0) /
          readinessSleep.length,
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
    prsCount,
    topPrLabel,
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

  // Deep high-contrast obsidian background
  ctx.fillStyle = '#08090C';
  ctx.fillRect(0, 0, width, height);

  // Subtle electric lime + emerald athletic atmosphere
  const glowTop = ctx.createRadialGradient(860, 130, 20, 860, 130, 580);
  glowTop.addColorStop(0, 'rgba(163, 230, 53, 0.16)');
  glowTop.addColorStop(1, 'rgba(8, 9, 12, 0)');
  ctx.fillStyle = glowTop;
  ctx.fillRect(0, 0, width, height);

  const glowBottom = ctx.createRadialGradient(220, 1140, 20, 220, 1140, 520);
  glowBottom.addColorStop(0, 'rgba(16, 185, 129, 0.14)');
  glowBottom.addColorStop(1, 'rgba(8, 9, 12, 0)');
  ctx.fillStyle = glowBottom;
  ctx.fillRect(0, 0, width, height);

  // Main obsidian frame
  drawRoundedRect(ctx, 44, 44, width - 88, height - 88, 40);
  ctx.fillStyle = '#101218';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#27272A';
  ctx.stroke();

  // Top speed accent bar
  drawRoundedRect(ctx, 96, 78, 72, 6, 3);
  ctx.fillStyle = LIME_ACCENT;
  ctx.fill();

  // Bold PULSOFIT wordmark
  ctx.font = '900 44px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('PULSO', 96, 134);
  const pulsoW = ctx.measureText('PULSO').width;
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText('FIT', 96 + pulsoW, 134);

  ctx.font = '700 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#A1A1AA';
  ctx.fillText('RESUMEN SEMANAL · 7 DÍAS', 96, 174);

  ctx.textAlign = 'right';
  ctx.font = '700 23px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#E4E4E7';
  ctx.fillText((profile.name || 'Atleta PulsoFit').slice(0, 24), width - 96, 130);
  ctx.font = '700 21px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText(snapshot.dateRangeLabel.toUpperCase(), width - 96, 170);
  ctx.textAlign = 'left';

  // Divider
  ctx.strokeStyle = '#27272A';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 206);
  ctx.lineTo(width - 96, 206);
  ctx.stroke();

  // Hero Streak + PR Badge Card
  drawRoundedRect(ctx, 96, 240, width - 192, 244, 32);
  const heroGrad = ctx.createLinearGradient(96, 240, width - 96, 484);
  heroGrad.addColorStop(0, '#131A12');
  heroGrad.addColorStop(1, '#090B0F');
  ctx.fillStyle = heroGrad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(163, 230, 53, 0.42)';
  ctx.stroke();

  // Streak Pill
  drawRoundedRect(ctx, 134, 274, 210, 36, 10);
  ctx.fillStyle = 'rgba(163, 230, 53, 0.16)';
  ctx.fill();
  ctx.font = '800 18px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText('⚡ RACHA ACTIVA', 152, 298);

  // Optional PR Pill next to streak pill
  if (snapshot.prsCount > 0) {
    const prPillX = 360;
    const prText = `★ ${snapshot.prsCount} ${snapshot.prsCount === 1 ? 'PR SEMANAL' : 'PRs SEMANALES'}`;
    ctx.font = '800 18px system-ui, -apple-system, sans-serif';
    const prW = ctx.measureText(prText).width + 36;
    drawRoundedRect(ctx, prPillX, 274, prW, 36, 10);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.2)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = GOLD_PR;
    ctx.stroke();
    ctx.fillStyle = '#FEF08A';
    ctx.fillText(prText, prPillX + 18, 298);
  }

  ctx.font = '900 112px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#FFFFFF';
  const streakStr = String(snapshot.streakDays);
  ctx.fillText(streakStr, 134, 418);
  const streakW = ctx.measureText(streakStr).width;

  ctx.font = '800 32px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText(
    snapshot.streakDays === 1 ? 'día activo' : 'días activos',
    154 + streakW,
    416,
  );

  if (snapshot.topPrLabel) {
    ctx.font = '600 19px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#FEF08A';
    ctx.fillText(`Mejor marca: ${snapshot.topPrLabel}`, 134, 456);
  }

  ctx.textAlign = 'right';
  ctx.font = '700 20px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#A1A1AA';
  ctx.fillText('SESIONES COMPLETADAS', width - 134, 304);
  ctx.font = '900 72px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText(String(snapshot.sessionsCount), width - 134, 392);
  ctx.font = '600 19px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#D4D4D8';
  ctx.fillText(
    `${snapshot.strengthCount} fuerza · ${snapshot.cardioCount} cardio · ${snapshot.hiitCount} HIIT`,
    width - 134,
    438,
  );
  ctx.textAlign = 'left';

  // Grid of 4 Primary KPI Cards (2x2)
  const colW = (width - 192 - 24) / 2;
  const rowH = 216;
  const gridTop = 516;

  let weightDisplayStr = 'Sin cambios';
  let weightColor = '#E4E4E7';
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
      weightColor = snapshot.netWeightDeltaKg < 0 ? LIME_ACCENT : GOLD_PR;
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
      color: LIME_ACCENT,
    },
    {
      title: 'PROMEDIO DE SUEÑO',
      value: sleepValueStr,
      sub: sleepSubStr,
      color: '#38BDF8',
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
    ctx.fillStyle = '#090B0F';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#27272A';
    ctx.stroke();

    drawRoundedRect(ctx, x + 32, y + 18, 48, 5, 3);
    ctx.fillStyle = kpi.color;
    ctx.fill();

    ctx.font = '700 19px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#A1A1AA';
    ctx.fillText(kpi.title, x + 32, y + 58);

    ctx.font = '900 54px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = kpi.color;
    ctx.fillText(kpi.value, x + 32, y + 134);

    ctx.font = '600 19px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#A1A1AA';
    ctx.fillText(kpi.sub, x + 32, y + 180);
  });

  // Bottom Weekly Highlights Strip (including PRs)
  const stripY = 998;
  drawRoundedRect(ctx, 96, stripY, width - 192, 178, 28);
  ctx.fillStyle = '#090B0F';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#27272A';
  ctx.stroke();

  ctx.font = '800 20px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText('BALANCE BIOMÉTRICO & RÉCORDS', 132, stripY + 46);

  const summaryCols = [
    {
      label: 'RÉCORDS (PR)',
      val: snapshot.prsCount > 0 ? `★ ${snapshot.prsCount}` : '0',
      color: snapshot.prsCount > 0 ? GOLD_PR : '#FFFFFF',
    },
    {
      label: 'CALIDAD SUEÑO',
      val: snapshot.avgSleepQualityPct !== null ? `${snapshot.avgSleepQualityPct}%` : '--',
      color: '#FFFFFF',
    },
    {
      label: 'RECUPERACIÓN',
      val: `${snapshot.avgRecoveryScore}/100`,
      color: LIME_ACCENT,
    },
    {
      label: 'PULSO MEDIO',
      val: snapshot.avgPulseBpm !== null ? `${snapshot.avgPulseBpm} BPM` : '--',
      color: '#34D399',
    },
  ];
  const sColW = (width - 192 - 64) / 4;
  summaryCols.forEach((c, i) => {
    const cx = 132 + i * sColW;
    ctx.font = '700 16px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#71717A';
    ctx.fillText(c.label, cx, stripY + 96);

    ctx.font = '800 32px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = c.color;
    ctx.fillText(c.val, cx, stripY + 142);
  });

  // Footer with PULSOFIT signature
  ctx.strokeStyle = '#27272A';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, height - 134);
  ctx.lineTo(width - 96, height - 134);
  ctx.stroke();

  ctx.font = '800 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('PULSO', 96, height - 88);
  const pw = ctx.measureText('PULSO').width;
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText('FIT', 96 + pw, height - 88);
  const fw = ctx.measureText('FIT').width;

  ctx.font = '600 20px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#71717A';
  ctx.fillText(
    `  ·  Ventana local ${snapshot.startDateIso} → ${snapshot.endDateIso}`,
    96 + pw + fw,
    height - 88,
  );
  ctx.textAlign = 'right';
  ctx.font = '800 22px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText('RENDIMIENTO & BIOMETRÍA', width - 96, height - 88);
  ctx.textAlign = 'left';

  const dataUrl = canvas.toDataURL('image/png');
  const fileName = `pulsofit-resumen-semanal-${snapshot.endDateIso}.png`;
  const summaryText = `Mi semana en PulsoFit (${snapshot.dateRangeLabel}): Racha ${snapshot.streakDays}d · ${snapshot.sessionsCount} sesiones · ${snapshot.prsCount} PRs · ${formatDistance(snapshot.totalDistanceKm, distanceUnit, 2)} · Cambio peso: ${weightDisplayStr}`;

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
