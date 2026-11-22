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

function drawBrandHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  subtitle: string,
  dateIso: string,
  badgeText: string,
) {
  ctx.font = '800 44px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('Pulso', 96, 134);
  const pulsoW = ctx.measureText('Pulso').width;
  ctx.fillStyle = '#D4FF33';
  ctx.fillText('Fit', 96 + pulsoW, 134);

  ctx.font = '600 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText(subtitle, 96, 174);

  const dateFormatted = new Date(dateIso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  ctx.textAlign = 'right';
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#D1D5DB';
  ctx.fillText(dateFormatted, width - 96, 128);
  ctx.fillStyle = '#D4FF33';
  ctx.fillText(badgeText, width - 96, 166);
  ctx.textAlign = 'left';

  ctx.strokeStyle = '#242936';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 208);
  ctx.lineTo(width - 96, 208);
  ctx.stroke();
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

  // Dark canvas backdrop
  ctx.fillStyle = '#0A0B0D';
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(840, 140, 20, 840, 140, 560);
  glow.addColorStop(0, 'rgba(212, 255, 51, 0.14)');
  glow.addColorStop(1, 'rgba(10, 11, 13, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  drawRoundedRect(ctx, 48, 48, width - 96, height - 96, 44);
  ctx.fillStyle = '#12151C';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#252A36';
  ctx.stroke();

  drawBrandHeader(
    ctx,
    width,
    `Resumen ${meta.label}`,
    session.completedAt,
    session.shoeName ? session.shoeName.slice(0, 24) : 'Cardio GPS',
  );

  // Hero Distance
  const displayDist = kmToDisplayDistance(session.distanceKm, distanceUnit);
  ctx.font = '700 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText('DISTANCIA TOTAL', 96, 272);

  ctx.font = '800 118px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#FFFFFF';
  const distStr = displayDist.toFixed(2);
  ctx.fillText(distStr, 96, 390);
  const distW = ctx.measureText(distStr).width;

  ctx.font = '700 42px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#D4FF33';
  ctx.fillText(distanceUnit, 116 + distW, 390);

  // 4 Metrics Grid
  const paceDisplay = formatPaceMinKm(
    paceSecPerKmToUnit(session.avgPaceSecPerKm, distanceUnit),
  );
  const metrics = [
    { label: 'TIEMPO ACTIVO', val: formatCardioDuration(session.durationSec), color: '#FFFFFF' },
    { label: `RITMO /${distanceUnit.toUpperCase()}`, val: paceDisplay, color: '#38BDF8' },
    { label: 'CALORÍAS', val: `${session.caloriesBurned} kcal`, color: '#FBBF24' },
    {
      label: 'PASOS EST.',
      val:
        session.activityType === 'ciclismo'
          ? 'N/A'
          : (session.estimatedSteps ?? 0).toLocaleString('es-MX'),
      color: '#34D399',
    },
  ];
  const cardTop = 438;
  const colW = (width - 192 - 20) / 2;
  const cardH = 130;

  metrics.forEach((m, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 96 + col * (colW + 20);
    const y = cardTop + row * (cardH + 18);

    drawRoundedRect(ctx, x, y, colW, cardH, 24);
    ctx.fillStyle = '#0B0D12';
    ctx.fill();
    ctx.strokeStyle = '#242936';
    ctx.stroke();

    ctx.font = '700 20px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#9CA3AF';
    ctx.fillText(m.label, x + 28, y + 46);

    ctx.font = '800 42px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = m.color;
    ctx.fillText(m.val, x + 28, y + 100);
  });

  // Route Silhouette Frame
  const routeBoxY = 748;
  const routeBoxH = 440;
  drawRoundedRect(ctx, 96, routeBoxY, width - 192, routeBoxH, 28);
  ctx.fillStyle = '#0B0D12';
  ctx.fill();
  ctx.strokeStyle = '#242936';
  ctx.stroke();

  ctx.font = '700 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('Silueta de ruta GPS', 128, routeBoxY + 46);

  // Subtle decorative grid lines inside route box
  ctx.save();
  ctx.strokeStyle = '#181C26';
  ctx.lineWidth = 1.5;
  for (let gx = 160; gx < width - 140; gx += 120) {
    ctx.beginPath();
    ctx.moveTo(gx, routeBoxY + 70);
    ctx.lineTo(gx, routeBoxY + routeBoxH - 36);
    ctx.stroke();
  }
  for (let gy = routeBoxY + 90; gy < routeBoxY + routeBoxH - 30; gy += 90) {
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

    const padX = 165;
    const padTop = routeBoxY + 92;
    const drawW = width - padX * 2;
    const drawH = routeBoxH - 148;
    const scale = Math.min(drawW / spanX, drawH / spanY);
    const offsetX = padX + (drawW - spanX * scale) / 2;
    const offsetY = padTop + (drawH - spanY * scale) / 2;

    const toCanvasPt = (p: { lat: number; lng: number }) => ({
      x: offsetX + (p.lng - minLng) * cosLat * scale,
      y: offsetY + (maxLat - p.lat) * scale,
    });

    const mapped = pts.map(toCanvasPt);

    // Outer glow stroke
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(mapped[0].x, mapped[0].y);
    for (let i = 1; i < mapped.length; i += 1) {
      ctx.lineTo(mapped[i].x, mapped[i].y);
    }
    ctx.strokeStyle = 'rgba(212, 255, 51, 0.25)';
    ctx.lineWidth = 18;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Sharp lime route line
    ctx.strokeStyle = '#D4FF33';
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
    ctx.strokeStyle = '#0B0D12';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#D4FF33';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#0B0D12';
    ctx.stroke();
  } else {
    // Indoor / single-point fallback visual
    ctx.font = '600 24px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#71717A';
    ctx.textAlign = 'center';
    ctx.fillText(
      'Sesión sin trazo GPS · Resumen de actividad registrado',
      width / 2,
      routeBoxY + routeBoxH / 2 + 8,
    );
    ctx.textAlign = 'left';
  }

  ctx.font = '600 20px ui-monospace, monospace';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText(
    `${pts.length} puntos GPS · ${session.splits.length} vueltas registradas`,
    128,
    routeBoxY + routeBoxH - 22,
  );

  // Footer
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#71717A';
  ctx.fillText('PulsoFit · Cardio GPS & Voice Coach', 96, height - 96);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#34D399';
  ctx.fillText(formatDistance(session.distanceKm, distanceUnit, 2), width - 96, height - 96);
  ctx.textAlign = 'left';

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

  ctx.fillStyle = '#0A0B0D';
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(840, 140, 20, 840, 140, 560);
  glow.addColorStop(0, 'rgba(52, 211, 153, 0.14)');
  glow.addColorStop(1, 'rgba(10, 11, 13, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  drawRoundedRect(ctx, 48, 48, width - 96, height - 96, 44);
  ctx.fillStyle = '#12151C';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#252A36';
  ctx.stroke();

  drawBrandHeader(ctx, width, 'Rutina de Fuerza / Ligas', session.completedAt, 'Sesión completada');

  // Workout Title
  ctx.font = '800 46px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(session.title.slice(0, 32), 96, 286);

  // 3 Hero KPI Cards
  const kpis = [
    { label: 'DURACIÓN', val: formatCardioDuration(session.durationSec), color: '#FFFFFF' },
    { label: 'SERIES', val: `${session.completedSets}`, color: '#D4FF33' },
    {
      label: 'VOLUMEN',
      val: formatVolume(session.totalVolumeKg, weightUnit),
      color: '#34D399',
    },
  ];
  const cardTop = 334;
  const colW = (width - 192 - 32) / 3;
  const cardH = 140;

  kpis.forEach((k, idx) => {
    const x = 96 + idx * (colW + 16);
    drawRoundedRect(ctx, x, cardTop, colW, cardH, 24);
    ctx.fillStyle = '#0B0D12';
    ctx.fill();
    ctx.strokeStyle = '#242936';
    ctx.stroke();

    ctx.font = '700 19px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#9CA3AF';
    ctx.fillText(k.label, x + 24, cardTop + 46);

    ctx.font = '800 36px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = k.color;
    ctx.fillText(k.val, x + 24, cardTop + 104);
  });

  // Exercises Summary Box
  const exBoxY = 510;
  const exBoxH = 400;
  drawRoundedRect(ctx, 96, exBoxY, width - 192, exBoxH, 28);
  ctx.fillStyle = '#0B0D12';
  ctx.fill();
  ctx.strokeStyle = '#242936';
  ctx.stroke();

  ctx.font = '700 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#D4FF33';
  ctx.fillText(`Ejercicios realizados (${session.exercises.length})`, 128, exBoxY + 48);

  session.exercises.slice(0, 5).forEach((ex, i) => {
    const y = exBoxY + 104 + i * 58;
    const doneSets = ex.sets.filter((s) => s.completed);
    const count = doneSets.length || ex.sets.length;
    const best = doneSets.reduce((max, s) => (s.weightKg > max.weightKg ? s : max), doneSets[0] ?? ex.sets[0]);
    const loadDesc =
      ex.loadMode === 'bands' && ex.bandConfig
        ? ex.bandConfig.label
        : best && best.weightKg > 0
          ? formatVolume(best.weightKg, weightUnit)
          : 'Peso corporal';

    ctx.font = '700 24px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`${i + 1}. ${ex.name.slice(0, 28)}`, 128, y);

    ctx.textAlign = 'right';
    ctx.font = '700 22px ui-monospace, monospace';
    ctx.fillStyle = '#D1D5DB';
    ctx.fillText(`${count} ser · ${loadDesc}`, width - 128, y);
    ctx.textAlign = 'left';
  });

  // Muscle Fatigue Impact Box
  const musBoxY = 942;
  const musBoxH = 250;
  drawRoundedRect(ctx, 96, musBoxY, width - 192, musBoxH, 28);
  ctx.fillStyle = '#0B0D12';
  ctx.fill();
  ctx.strokeStyle = '#242936';
  ctx.stroke();

  ctx.font = '700 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('Grupos musculares trabajados', 128, musBoxY + 46);

  const muscles = Object.entries(session.fatigueImpact)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  muscles.forEach(([mKey, delta], idx) => {
    const rowY = musBoxY + 90 + idx * 38;
    const label = MUSCLE_LABELS[mKey as keyof typeof MUSCLE_LABELS] ?? mKey;
    ctx.font = '600 20px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#D1D5DB';
    ctx.fillText(label, 128, rowY);

    const barX = 360;
    const barW = 460;
    drawRoundedRect(ctx, barX, rowY - 16, barW, 18, 9);
    ctx.fillStyle = '#181C26';
    ctx.fill();

    const fillW = Math.max(24, Math.min(barW, Math.round((delta / 65) * barW)));
    drawRoundedRect(ctx, barX, rowY - 16, fillW, 18, 9);
    ctx.fillStyle = '#D4FF33';
    ctx.fill();

    ctx.textAlign = 'right';
    ctx.font = '700 20px ui-monospace, monospace';
    ctx.fillStyle = '#D4FF33';
    ctx.fillText(`+${delta}%`, width - 128, rowY);
    ctx.textAlign = 'left';
  });

  // Footer
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#71717A';
  ctx.fillText('PulsoFit · Entrenamiento Inteligente', 96, height - 96);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#D4FF33';
  ctx.fillText(formatVolume(session.totalVolumeKg, weightUnit), width - 96, height - 96);
  ctx.textAlign = 'left';

  const fileName = `pulsofit-rutina-${session.completedAt.slice(0, 10)}.png`;
  return deliverCanvasPng(
    canvas,
    fileName,
    `Mi rutina en PulsoFit: ${session.title}`,
    `${session.completedSets} series · ${formatVolume(session.totalVolumeKg, weightUnit)} en ${formatCardioDuration(session.durationSec)}`,
  );
}
