import type { BodyCompositionScan, UserProfile } from '../types/fitness';
import { getScanTimeSlot, getTimeSlotLabel } from './bodyComposition';
import {
  cmToDisplayWaist,
  getWaistUnit,
  getWeightUnit,
  kgToDisplayWeight,
} from './units';

export interface ShareCardResult {
  status: 'shared' | 'downloaded';
  dataUrl: string;
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

export async function generateAndShareScaleCard(params: {
  latestScan: BodyCompositionScan;
  previousScan: BodyCompositionScan | null;
  best30DaysWeightKg: number | null;
  recentScansAsc: BodyCompositionScan[];
  profile: UserProfile;
}): Promise<ShareCardResult> {
  const {
    latestScan,
    previousScan,
    best30DaysWeightKg,
    recentScansAsc,
    profile,
  } = params;

  const weightUnit = getWeightUnit(profile.weightUnit);
  const waistUnit = getWaistUnit(profile);

  const width = 1080;
  const height = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el lienzo para generar la tarjeta.');
  }

  // Background
  ctx.fillStyle = '#0A0B0D';
  ctx.fillRect(0, 0, width, height);

  // Subtle top accent glow
  const glow = ctx.createRadialGradient(840, 140, 20, 840, 140, 560);
  glow.addColorStop(0, 'rgba(212, 255, 51, 0.14)');
  glow.addColorStop(1, 'rgba(10, 11, 13, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Outer card frame
  drawRoundedRect(ctx, 48, 48, width - 96, height - 96, 44);
  ctx.fillStyle = '#12151C';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#252A36';
  ctx.stroke();

  // Brand header
  ctx.font = '800 42px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('Pulso', 96, 132);
  const pulsoW = ctx.measureText('Pulso').width;
  ctx.fillStyle = '#D4FF33';
  ctx.fillText('Fit', 96 + pulsoW, 132);

  ctx.font = '600 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText('Resumen Báscula Inteligente', 96, 174);

  const dateFormatted = new Date(latestScan.recordedAt).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const slotLabel = getTimeSlotLabel(getScanTimeSlot(latestScan));
  ctx.textAlign = 'right';
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#D1D5DB';
  ctx.fillText(dateFormatted, width - 96, 128);
  ctx.fillStyle = '#D4FF33';
  ctx.fillText(slotLabel, width - 96, 164);
  ctx.textAlign = 'left';

  // Divider
  ctx.strokeStyle = '#242936';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 208);
  ctx.lineTo(width - 96, 208);
  ctx.stroke();

  // Hero Current Weight
  const currentWeightDisplay = kgToDisplayWeight(latestScan.weightKg, weightUnit);
  ctx.font = '700 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText('PESO ACTUAL', 96, 270);

  ctx.font = '800 116px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#FFFFFF';
  const weightStr = currentWeightDisplay.toFixed(weightUnit === 'lb' ? 1 : 1);
  ctx.fillText(weightStr, 96, 386);
  const weightNumWidth = ctx.measureText(weightStr).width;

  ctx.font = '700 40px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#D4FF33';
  ctx.fillText(weightUnit, 112 + weightNumWidth, 386);

  if (typeof latestScan.waistCm === 'number') {
    ctx.font = '600 26px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#D1D5DB';
    ctx.fillText(
      `Cintura registrada: ${cmToDisplayWaist(latestScan.waistCm, waistUnit)} ${waistUnit}`,
      96,
      436,
    );
  }

  // Two Highlight KPI Cards: Variación & Mejor Marca 30 días
  const cardTop = 472;
  const cardH = 148;
  const colW = (width - 192 - 24) / 2;

  // Card 1: Variación vs anterior
  drawRoundedRect(ctx, 96, cardTop, colW, cardH, 26);
  ctx.fillStyle = '#0B0D12';
  ctx.fill();
  ctx.strokeStyle = '#242936';
  ctx.stroke();

  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText('VARIACIÓN VS ANTERIOR', 128, cardTop + 48);

  let deltaStr = 'Primer registro';
  let deltaColor = '#E5E7EB';
  if (previousScan) {
    const diffKg = latestScan.weightKg - previousScan.weightKg;
    const absConverted = kgToDisplayWeight(Math.abs(diffKg), weightUnit);
    if (Math.abs(diffKg) < 0.05) {
      deltaStr = `0.0 ${weightUnit}`;
      deltaColor = '#E5E7EB';
    } else {
      const sign = diffKg > 0 ? '+' : '-';
      deltaStr = `${sign}${absConverted} ${weightUnit}`;
      deltaColor = diffKg < 0 ? '#D4FF33' : '#FBBF24';
    }
  }
  ctx.font = '800 44px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = deltaColor;
  ctx.fillText(deltaStr, 128, cardTop + 108);

  // Card 2: Mejor marca 30 días
  const col2X = 96 + colW + 24;
  drawRoundedRect(ctx, col2X, cardTop, colW, cardH, 26);
  ctx.fillStyle = '#0B0D12';
  ctx.fill();
  ctx.strokeStyle = '#242936';
  ctx.stroke();

  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText('MEJOR MARCA (30 DÍAS)', col2X + 32, cardTop + 48);

  const bestVal =
    best30DaysWeightKg !== null
      ? `${kgToDisplayWeight(best30DaysWeightKg, weightUnit)} ${weightUnit}`
      : `${currentWeightDisplay} ${weightUnit}`;
  ctx.font = '800 44px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#D4FF33';
  ctx.fillText(bestVal, col2X + 32, cardTop + 108);

  // Mini-Gráfica Box
  const chartBoxY = 656;
  const chartBoxH = 310;
  drawRoundedRect(ctx, 96, chartBoxY, width - 192, chartBoxH, 28);
  ctx.fillStyle = '#0B0D12';
  ctx.fill();
  ctx.strokeStyle = '#242936';
  ctx.stroke();

  ctx.font = '700 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('Tendencia reciente de peso', 128, chartBoxY + 46);

  const series = recentScansAsc.slice(-10);
  const chartLeft = 140;
  const chartRight = width - 140;
  const chartTop = chartBoxY + 86;
  const chartBottom = chartBoxY + chartBoxH - 54;
  const chartW = chartRight - chartLeft;
  const chartH = chartBottom - chartTop;

  const vals = series.map((s) => kgToDisplayWeight(s.weightKg, weightUnit));
  const minVal = vals.length > 0 ? Math.min(...vals) - 1 : currentWeightDisplay - 1;
  const maxVal = vals.length > 0 ? Math.max(...vals) + 1 : currentWeightDisplay + 1;
  const span = Math.max(1, maxVal - minVal);

  // Horizontal dashed grid lines
  ctx.save();
  ctx.strokeStyle = '#222631';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  for (let g = 0; g <= 2; g++) {
    const gy = chartTop + (chartH * g) / 2;
    ctx.beginPath();
    ctx.moveTo(chartLeft, gy);
    ctx.lineTo(chartRight, gy);
    ctx.stroke();
  }
  ctx.restore();

  if (vals.length === 1) {
    const cx = chartLeft + chartW / 2;
    const cy = chartTop + chartH / 2;
    ctx.fillStyle = '#D4FF33';
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '700 22px ui-monospace, monospace';
    ctx.fillStyle = '#E5E7EB';
    ctx.textAlign = 'center';
    ctx.fillText(`${vals[0]} ${weightUnit}`, cx, cy - 20);
    ctx.textAlign = 'left';
  } else if (vals.length > 1) {
    const points = vals.map((v, idx) => ({
      x: chartLeft + (idx / (vals.length - 1)) * chartW,
      y: chartBottom - ((v - minVal) / span) * chartH,
      val: v,
    }));

    // Gradient area
    const areaGrad = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
    areaGrad.addColorStop(0, 'rgba(212, 255, 51, 0.25)');
    areaGrad.addColorStop(1, 'rgba(212, 255, 51, 0)');
    ctx.beginPath();
    ctx.moveTo(points[0].x, chartBottom);
    for (const pt of points) {
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.lineTo(points[points.length - 1].x, chartBottom);
    ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = '#D4FF33';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Nodes
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, i === points.length - 1 ? 8 : 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#D4FF33';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0B0D12';
      ctx.stroke();

      if (i === 0 || i === points.length - 1) {
        ctx.font = '700 20px ui-monospace, monospace';
        ctx.fillStyle = '#E5E7EB';
        ctx.textAlign = i === 0 ? 'left' : 'right';
        ctx.fillText(`${pt.val}`, pt.x, pt.y - 14);
      }
    }
    ctx.textAlign = 'left';
  }

  ctx.font = '600 18px ui-monospace, monospace';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText(`${series.length} pesajes en ventana reciente`, 128, chartBoxY + chartBoxH - 18);

  // Key Composition Metrics Strip
  const metricsY = 1004;
  const metrics = [
    { label: 'IMC', val: latestScan.bmi.toFixed(1) },
    { label: 'GRASA', val: `${latestScan.bodyFatPct.toFixed(1)}%` },
    { label: 'MÚSCULO', val: `${latestScan.totalMusclePct.toFixed(1)}%` },
    { label: 'AGUA', val: `${latestScan.bodyWaterPct.toFixed(1)}%` },
    { label: 'VISCERAL', val: `Nv ${latestScan.visceralFatLevel}` },
  ];
  const mColW = (width - 192 - 48) / 5;
  metrics.forEach((m, idx) => {
    const mx = 96 + idx * (mColW + 12);
    drawRoundedRect(ctx, mx, metricsY, mColW, 136, 22);
    ctx.fillStyle = '#0B0D12';
    ctx.fill();
    ctx.strokeStyle = '#242936';
    ctx.stroke();

    ctx.font = '700 18px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#9CA3AF';
    ctx.textAlign = 'center';
    ctx.fillText(m.label, mx + mColW / 2, metricsY + 46);

    ctx.font = '800 32px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(m.val, mx + mColW / 2, metricsY + 98);
  });
  ctx.textAlign = 'left';

  // Footer
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#71717A';
  ctx.fillText('PulsoFit · Composición Corporal Estilo OKOK', 96, height - 102);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#D4FF33';
  ctx.fillText(`Edad metabólica: ${latestScan.bodyAge} años`, width - 96, height - 102);
  ctx.textAlign = 'left';

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('No se pudo exportar la imagen PNG.'));
    }, 'image/png');
  });

  const dataUrl = canvas.toDataURL('image/png');
  const fileName = `pulsofit-bascula-${latestScan.date}.png`;
  const file = new File([blob], fileName, { type: 'image/png' });

  // Prefer Web Share API with files on mobile if supported
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        title: 'Mi resumen en PulsoFit',
        text: `Peso actual: ${currentWeightDisplay} ${weightUnit} (${deltaStr})`,
        files: [file],
      });
      return { status: 'shared', dataUrl };
    } catch {
      // User cancelled share or share rejected -> fall through to direct download
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

  return { status: 'downloaded', dataUrl };
}
