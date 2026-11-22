import { getLocalDateKey } from './storage';
import type { ShoppingListItem, WeeklyMealPlan } from '../types/fitness';

export const SHOPPING_CATEGORIES: ShoppingListItem['category'][] = [
  'Proteínas',
  'Carbohidratos',
  'Verduras y Frutas',
  'Despensa y Grasas',
];

export function formatShoppingListAsText(
  plan: WeeklyMealPlan,
  onlyPending = false,
): string {
  const generatedLabel = (() => {
    try {
      return new Date(plan.generatedAt).toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return getLocalDateKey(plan.generatedAt);
    }
  })();

  const itemsPool = onlyPending
    ? plan.shoppingList.filter((i) => !i.checked)
    : plan.shoppingList;

  const lines: string[] = [
    'LISTA DE COMPRAS SEMANAL · PULSOFIT',
    `Meta diaria: ${Math.round(plan.calorieTarget)} kcal | ${Math.round(plan.proteinTargetG)} g proteína`,
    `Generado: ${generatedLabel}${onlyPending ? ' (Solo artículos pendientes)' : ''}`,
    '',
  ];

  if (itemsPool.length === 0) {
    lines.push('Todos los artículos están marcados como comprados.');
    return lines.join('\n');
  }

  for (const cat of SHOPPING_CATEGORIES) {
    const catItems = itemsPool.filter((i) => i.category === cat);
    if (catItems.length === 0) continue;
    lines.push(`[ ${cat.toUpperCase()} ]`);
    for (const item of catItems) {
      const box = item.checked ? '[x]' : '[ ]';
      lines.push(`${box} ${item.name} — ${item.quantity}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function downloadShoppingListTxt(
  plan: WeeklyMealPlan,
  onlyPending = false,
): void {
  if (typeof document === 'undefined') return;
  const content = formatShoppingListAsText(plan, onlyPending);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const datePart = getLocalDateKey(plan.generatedAt || new Date());
  const a = document.createElement('a');
  a.href = url;
  a.download = `pulsofit-lista-compras-${datePart}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
