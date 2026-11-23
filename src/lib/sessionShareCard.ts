import type { CardioSession, UserProfile, WorkoutSession } from '../types/fitness';
import { formatCardioDuration, formatPaceMinKm, getActivityMeta } from './cardio';
import { MUSCLE_LABELS } from './recovery';
import {
  formatDistance,
  formatVolume,
  getDistanceUnit,
  getWeightUnit,
  kmToDisplayDistance,
  paceSecPerKmToUnit,
} from './units';

export interface SessionShareCardResult {
  status: 'shared' | 'downloaded';
  dataUrl: string;
  fileName: string;
}

const LIME_ACCENT = '#a3e635';
const GOLD_PR = '#fbbf24';

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

async function deliverCanvasPng(
  canvas: HTMLCanvasElement,
  fileName: string,
  shareTitle: string,
  shareText: string,
): Promise<SessionShareCardResult> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('No se pudo exportar la imagen PNG.'));
    }, 'image/png');
  });

  const dataUrl = canvas.toDataURL('image/png');
  const file = new File([blob], fileName, { type: 'image/png' });

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        title: shareTitle,
        text: shareText,
        files: [file],
      });
      return { status: 'shared', dataUrl, fileName };
    } catch {
      // User cancelled or Web Share declined; fall back to direct download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { status: 'downloaded', dataUrl, fileName };
}

function drawStravaHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  subtitle: string,
  dateIso: string,
  badgeText: string,
  athleteName?: string,
) {
  // Top electric lime speed bar
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
  ctx.fillText(subtitle.toUpperCase(), 96, 172);

  const dateFormatted = new Date(dateIso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  ctx.textAlign = 'right';
  ctx.font = '700 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#E4E4E7';
  ctx.fillText(
    athleteName ? `${athleteName.slice(0, 18)} · ${dateFormatted}` : dateFormatted,
    width - 96,
    126,
  );
  ctx.font = '700 21px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText(badgeText.toUpperCase(), width - 96, 166);
  ctx.textAlign = 'left';

  ctx.strokeStyle = '#27272A';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 202);
  ctx.lineTo(width - 96, 202);
  ctx.stroke();
}

function drawPrBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  maxWidth: number,
) {
  ctx.save();
  ctx.font = '800 22px system-ui, -apple-system, sans-serif';
  const text = `★ ${label}`.slice(0, 42);
  const textW = ctx.measureText(text).width;
  const pillW = Math.min(maxWidth, textW + 44);
  const pillH = 44;

  drawRoundedRect(ctx, x, y, pillW, pillH, 14);
  const grad = ctx.createLinearGradient(x, y, x + pillW, y + pillH);
  grad.addColorStop(0, 'rgba(251, 191, 36, 0.22)');
  grad.addColorStop(1, 'rgba(163, 230, 53, 0.18)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = GOLD_PR;
  ctx.stroke();

  ctx.fillStyle = '#FEF08A';
  ctx.fillText(text, x + 22, y + 30);
  ctx.restore();
}

function drawSignatureFooter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  leftText: string,
  rightText: string,
) {
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
  ctx.font = '600 21px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#71717A';
  ctx.fillText(`  ·  ${leftText}`, 96 + pw + fw, height - 88);

  ctx.textAlign = 'right';
  ctx.font = '800 22px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText(rightText, width - 96, height - 88);
  ctx.textAlign = 'left';
}

export async function generateAndShareCardioCard(params: {
  session: CardioSession;
  profile: UserProfile;
}): Promise<SessionShareCardResult> {
  const { session, profile } = params;
  const distanceUnit = getDistanceUnit(profile.distanceUnit);
  const meta = getActivityMeta(session.activityType);

  const width = 1080;
  const height = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el lienzo.');
  }

  // Deep high-contrast obsidian backdrop
  ctx.fillStyle = '#08090C';
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(880, 120, 20, 880, 120, 620);
  glow.addColorStop(0, 'rgba(163, 230, 53, 0.16)');
  glow.addColorStop(1, 'rgba(8, 9, 12, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  drawRoundedRect(ctx, 44, 44, width - 88, height - 88, 40);
  ctx.fillStyle = '#101218';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#27272A';
  ctx.stroke();

  drawStravaHeader(
    ctx,
    width,
    `Resumen ${meta.label}`,
    session.completedAt,
    session.shoeName ? session.shoeName.slice(0, 22) : 'Cardio GPS',
    profile.name,
  );

  // Hero Distance + Optional PR Badge
  const displayDist = kmToDisplayDistance(session.distanceKm, distanceUnit);
  ctx.font = '800 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#A1A1AA';
  ctx.fillText('DISTANCIA TOTAL', 96, 258);

  const hasPr = Boolean(session.isPR || (session.prLabels && session.prLabels.length > 0));
  if (hasPr) {
    const prText =
      session.prLabels && session.prLabels.length > 0
        ? `PR · ${session.prLabels.slice(0, 2).join(' · ')}`
        : 'RÉCORD PERSONAL (PR)';
    drawPrBadge(ctx, 96, 278, prText, width - 192);
  }

  const distBaseY = hasPr ? 426 : 386;
  ctx.font = '900 124px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#FFFFFF';
  const distStr = displayDist.toFixed(2);
  ctx.fillText(distStr, 96, distBaseY);
  const distW = ctx.measureText(distStr).width;

  ctx.font = '800 44px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText(distanceUnit.toUpperCase(), 118 + distW, distBaseY);

  // 4 High-Contrast Metrics Grid
  const paceDisplay = formatPaceMinKm(
    paceSecPerKmToUnit(session.avgPaceSecPerKm, distanceUnit),
  );
  const metrics = [
    {
      label: 'TIEMPO ACTIVO',
      val: formatCardioDuration(session.durationSec),
      color: '#FFFFFF',
    },
    {
      label: `RITMO MEDIO /${distanceUnit.toUpperCase()}`,
      val: paceDisplay,
      color: LIME_ACCENT,
    },
    {
      label: 'ENERGÍA QUEMADA',
      val: `${session.caloriesBurned} kcal`,
      color: '#FBBF24',
    },
    {
      label: 'PASOS ESTIMADOS',
      val:
        session.activityType === 'ciclismo'
          ? 'N/A'
          : (session.estimatedSteps ?? 0).toLocaleString('es-MX'),
      color: '#34D399',
    },
  ];
  const cardTop = hasPr ? 464 : 434;
  const colW = (width - 192 - 20) / 2;
  const cardH = 128;

  metrics.forEach((m, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 96 + col * (colW + 20);
    const y = cardTop + row * (cardH + 18);

    drawRoundedRect(ctx, x, y, colW, cardH, 24);
    ctx.fillStyle = '#090B0F';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#27272A';
    ctx.stroke();

    // Accent bar on left edge
    drawRoundedRect(ctx, x + 14, y + 26, 6, cardH - 52, 3);
    ctx.fillStyle = m.color;
    ctx.fill();

    ctx.font = '700 19px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#A1A1AA';
    ctx.fillText(m.label, x + 36, y + 46);

    ctx.font = '800 42px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = m.color;
    ctx.fillText(m.val, x + 36, y + 98);
  });

  // Route Silhouette Frame
  const routeBoxY = cardTop + cardH * 2 + 44;
  const routeBoxH = height - 166 - routeBoxY;
  drawRoundedRect(ctx, 96, routeBoxY, width - 192, routeBoxH, 28);
  ctx.fillStyle = '#090B0F';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#27272A';
  ctx.stroke();

  ctx.font = '800 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('TRAZO TELEMÉTRICO GPS', 128, routeBoxY + 46);

  ctx.textAlign = 'right';
  ctx.font = '700 20px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText(
    `${session.splits.length} parciales`,
    width - 128,
    routeBoxY + 46,
  );
  ctx.textAlign = 'left';

  // Subtle decorative grid lines inside route box
  ctx.save();
  ctx.strokeStyle = '#18181B';
  ctx.lineWidth = 1.5;
  for (let gx = 160; gx < width - 140; gx += 120) {
    ctx.beginPath();
    ctx.moveTo(gx, routeBoxY + 68);
    ctx.lineTo(gx, routeBoxY + routeBoxH - 42);
    ctx.stroke();
  }
  for (let gy = routeBoxY + 86; gy < routeBoxY + routeBoxH - 34; gy += 86) {
    ctx.beginPath();
    ctx.moveTo(128, gy);
    ctx.lineTo(width - 128, gy);
    ctx.stroke();
  }
  ctx.restore();

  const pts = session.routePoints ?? [];
  if (pts.length >= 2) {
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const midLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const cosLat = Math.max(0.25, Math.cos(midLatRad));
    const spanX = Math.max(0.0002, (maxLng - minLng) * cosLat);
    const spanY = Math.max(0.0002, maxLat - minLat);

    const padX = 168;
    const padTop = routeBoxY + 86;
    const drawW = width - padX * 2;
    const drawH = routeBoxH - 142;
    const scale = Math.min(drawW / spanX, drawH / spanY);
    const offsetX = padX + (drawW - spanX * scale) / 2;
    const offsetY = padTop + (drawH - spanY * scale) / 2;

    const toCanvasPt = (p: { lat: number; lng: number }) => ({
      x: offsetX + (p.lng - minLng) * cosLat * scale,
      y: offsetY + (maxLat - p.lat) * scale,
    });

    const mapped = pts.map(toCanvasPt);

    // Outer neon lime glow stroke
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(mapped[0].x, mapped[0].y);
    for (let i = 1; i < mapped.length; i += 1) {
      ctx.lineTo(mapped[i].x, mapped[i].y);
    }
    ctx.strokeStyle = 'rgba(163, 230, 53, 0.28)';
    ctx.lineWidth = 18;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Sharp electric lime route line
    ctx.strokeStyle = LIME_ACCENT;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.restore();

    // Start (Emerald) & End (Lime) markers
    const firstPt = mapped[0];
    const lastPt = mapped[mapped.length - 1];
    ctx.beginPath();
    ctx.arc(firstPt.x, firstPt.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#34D399';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#090B0F';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = LIME_ACCENT;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#090B0F';
    ctx.stroke();
  } else {
    ctx.font = '600 24px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#71717A';
    ctx.textAlign = 'center';
    ctx.fillText(
      'Sesión sin trazo GPS · Actividad registrada',
      width / 2,
      routeBoxY + routeBoxH / 2 + 8,
    );
    ctx.textAlign = 'left';
  }

  ctx.font = '600 19px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#A1A1AA';
  ctx.fillText(
    `${pts.length} puntos GPS filtrados · ${meta.label}`,
    128,
    routeBoxY + routeBoxH - 20,
  );

  drawSignatureFooter(
    ctx,
    width,
    height,
    'Cardio GPS & Telemetría',
    formatDistance(session.distanceKm, distanceUnit, 2),
  );

  const fileName = `pulsofit-ruta-${session.date}.png`;
  return deliverCanvasPng(
    canvas,
    fileName,
    `Mi ${meta.label} en PulsoFit`,
    `${formatDistance(session.distanceKm, distanceUnit, 2)} en ${formatCardioDuration(session.durationSec)} (${paceDisplay}/${distanceUnit})`,
  );
}

export async function generateAndShareWorkoutCard(params: {
  session: WorkoutSession;
  profile: UserProfile;
}): Promise<SessionShareCardResult> {
  const { session, profile } = params;
  const weightUnit = getWeightUnit(profile.weightUnit);

  const width = 1080;
  const height = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el lienzo.');
  }

  ctx.fillStyle = '#08090C';
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(880, 120, 20, 880, 120, 620);
  glow.addColorStop(0, 'rgba(163, 230, 53, 0.16)');
  glow.addColorStop(1, 'rgba(8, 9, 12, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  drawRoundedRect(ctx, 44, 44, width - 88, height - 88, 40);
  ctx.fillStyle = '#101218';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#27272A';
  ctx.stroke();

  const prSetsCount = session.exercises.reduce(
    (sum, ex) => sum + ex.sets.filter((s) => s.isPR).length,
    0,
  );
  const hasPr = Boolean(
    session.isPR || prSetsCount > 0 || (session.prLabels && session.prLabels.length > 0),
  );

  drawStravaHeader(
    ctx,
    width,
    'Entrenamiento de Fuerza',
    session.completedAt,
    hasPr ? 'Sesión con PR' : 'Sesión completada',
    profile.name,
  );

  // Workout Title + PR Badge
  ctx.font = '900 46px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(session.title.slice(0, 30), 96, 274);

  if (hasPr) {
    const topLabel =
      session.prLabels && session.prLabels.length > 0
        ? `${prSetsCount > 1 ? `${prSetsCount} PRs` : 'PR'} · ${session.prLabels[0]}`
        : `${prSetsCount > 1 ? `${prSetsCount} RÉCORDS` : 'RÉCORD PERSONAL'} (PR)`;
    drawPrBadge(ctx, 96, 294, topLabel, width - 192);
  }

  // 3 Hero KPI Cards
  const kpis = [
    {
      label: 'DURACIÓN',
      val: formatCardioDuration(session.durationSec),
      color: '#FFFFFF',
    },
    {
      label: 'SERIES',
      val: `${session.completedSets}`,
      color: LIME_ACCENT,
    },
    {
      label: 'VOLUMEN TOTAL',
      val: formatVolume(session.totalVolumeKg, weightUnit),
      color: '#34D399',
    },
  ];
  const cardTop = hasPr ? 360 : 318;
  const colW = (width - 192 - 32) / 3;
  const cardH = 138;

  kpis.forEach((k, idx) => {
    const x = 96 + idx * (colW + 16);
    drawRoundedRect(ctx, x, cardTop, colW, cardH, 24);
    ctx.fillStyle = '#090B0F';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#27272A';
    ctx.stroke();

    drawRoundedRect(ctx, x + 22, cardTop + 14, 42, 5, 3);
    ctx.fillStyle = k.color;
    ctx.fill();

    ctx.font = '700 18px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#A1A1AA';
    ctx.fillText(k.label, x + 22, cardTop + 50);

    ctx.font = '800 36px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = k.color;
    ctx.fillText(k.val, x + 22, cardTop + 104);
  });

  // Exercises Summary Box
  const exBoxY = cardTop + cardH + 28;
  const exBoxH = 390;
  drawRoundedRect(ctx, 96, exBoxY, width - 192, exBoxH, 28);
  ctx.fillStyle = '#090B0F';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#27272A';
  ctx.stroke();

  ctx.font = '800 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = LIME_ACCENT;
  ctx.fillText(
    `EJERCICIOS REALIZADOS (${session.exercises.length})`,
    128,
    exBoxY + 46,
  );

  session.exercises.slice(0, 5).forEach((ex, i) => {
    const y = exBoxY + 102 + i * 56;
    const doneSets = ex.sets.filter((s) => s.completed);
    const exHasPr = ex.sets.some((s) => s.isPR);
    const count = doneSets.length || ex.sets.length;
    const best = doneSets.reduce(
      (max, s) => (s.weightKg > max.weightKg ? s : max),
      doneSets[0] ?? ex.sets[0],
    );
    const loadDesc =
      ex.loadMode === 'bands' && ex.bandConfig
        ? ex.bandConfig.label
        : best && best.weightKg > 0
          ? formatVolume(best.weightKg, weightUnit)
          : 'Peso corporal';

    ctx.font = '700 23px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = exHasPr ? '#FEF08A' : '#FFFFFF';
    ctx.fillText(
      `${i + 1}. ${ex.name.slice(0, 26)}${exHasPr ? ' ★PR' : ''}`,
      128,
      y,
    );

    ctx.textAlign = 'right';
    ctx.font = '700 21px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = exHasPr ? LIME_ACCENT : '#D4D4D8';
    ctx.fillText(`${count} ser · ${loadDesc}`, width - 128, y);
    ctx.textAlign = 'left';
  });

  // Muscle Fatigue Impact Box
  const musBoxY = exBoxY + exBoxH + 26;
  const musBoxH = height - 164 - musBoxY;
  drawRoundedRect(ctx, 96, musBoxY, width - 192, musBoxH, 28);
  ctx.fillStyle = '#090B0F';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#27272A';
  ctx.stroke();

  ctx.font = '800 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('IMPACTO MUSCULAR', 128, musBoxY + 46);

  const muscles = Object.entries(session.fatigueImpact)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  muscles.forEach(([mKey, delta], idx) => {
    const rowY = musBoxY + 90 + idx * 38;
    const label = MUSCLE_LABELS[mKey as keyof typeof MUSCLE_LABELS] ?? mKey;
    ctx.font = '600 20px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#D4D4D8';
    ctx.fillText(label, 128, rowY);

    const barX = 360;
    const barW = 460;
    drawRoundedRect(ctx, barX, rowY - 16, barW, 18, 9);
    ctx.fillStyle = '#18181B';
    ctx.fill();

    const fillW = Math.max(24, Math.min(barW, Math.round((delta / 65) * barW)));
    drawRoundedRect(ctx, barX, rowY - 16, fillW, 18, 9);
    ctx.fillStyle = LIME_ACCENT;
    ctx.fill();

    ctx.textAlign = 'right';
    ctx.font = '700 20px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = LIME_ACCENT;
    ctx.fillText(`+${delta}%`, width - 128, rowY);
    ctx.textAlign = 'left';
  });

  drawSignatureFooter(
    ctx,
    width,
    height,
    'Sobrecarga Progresiva & PRs',
    formatVolume(session.totalVolumeKg, weightUnit),
  );

  const fileName = `pulsofit-rutina-${session.completedAt.slice(0, 10)}.png`;
  return deliverCanvasPng(
    canvas,
    fileName,
    `Mi rutina en PulsoFit: ${session.title}`,
    `${session.completedSets} series · ${formatVolume(session.totalVolumeKg, weightUnit)} en ${formatCardioDuration(session.durationSec)}`,
  );
}
