import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  Plus,
  ShoppingCart,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { generateWeeklyMealPlanAi } from '../lib/aiClient';
import {
  SHOPPING_CATEGORIES,
  copyTextToClipboard,
  downloadShoppingListTxt,
  formatShoppingListAsText,
} from '../lib/shoppingListExport';
import type {
  FoodEntry,
  UserProfile,
  WeeklyMealPlan,
} from '../types/fitness';

export {
  SHOPPING_CATEGORIES,
  copyTextToClipboard,
  downloadShoppingListTxt,
  formatShoppingListAsText,
};

interface WeeklyMealPlanModalProps {
  isOpen: boolean;
  initialView?: 'menu' | 'lista';
  selectedDate: string;
  profile: UserProfile;
  calorieTarget: number;
  proteinTargetG: number;
  profileCalorieTarget?: number;
  profileProteinTargetG?: number;
  isAdaptiveTarget?: boolean;
  weeklyMealPlan: WeeklyMealPlan | null;
  onClose: () => void;
  onSavePlan: (plan: WeeklyMealPlan | null) => void;
  onAddFood: (entry: Omit<FoodEntry, 'id' | 'createdAt'>) => void;
}

export const WeeklyMealPlanModal: React.FC<WeeklyMealPlanModalProps> = ({
  isOpen,
  initialView = 'menu',
  selectedDate,
  profile,
  calorieTarget,
  proteinTargetG,
  profileCalorieTarget,
  profileProteinTargetG,
  isAdaptiveTarget = false,
  weeklyMealPlan,
  onClose,
  onSavePlan,
  onAddFood,
}) => {
  const baseProfileCal = profileCalorieTarget ?? calorieTarget;
  const baseProfileProt = profileProteinTargetG ?? proteinTargetG;
  const hasDistinctAdaptive =
    isAdaptiveTarget &&
    (baseProfileCal !== calorieTarget || baseProfileProt !== proteinTargetG);

  const [view, setView] = useState<'menu' | 'lista'>(initialView);
  const [targetSource, setTargetSource] = useState<'perfil' | 'adaptativa'>('perfil');
  const [mealsPerDay, setMealsPerDay] = useState(3);
  const [preferencesNote, setPreferencesNote] = useState('');
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loggedBanner, setLoggedBanner] = useState<string | null>(null);

  // Shopping list text export state
  const [exportOnlyPending, setExportOnlyPending] = useState(false);
  const [showPlainTextPreview, setShowPlainTextPreview] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setView(initialView);
      setError(null);
      setLoggedBanner(null);
      setExportFeedback(null);
    }
  }, [isOpen, initialView]);

  const effectiveGenCal =
    targetSource === 'adaptativa' && hasDistinctAdaptive ? calorieTarget : baseProfileCal;
  const effectiveGenProt =
    targetSource === 'adaptativa' && hasDistinctAdaptive ? proteinTargetG : baseProfileProt;

  const shoppingExportText = useMemo(
    () =>
      weeklyMealPlan
        ? formatShoppingListAsText(weeklyMealPlan, exportOnlyPending)
        : '',
    [weeklyMealPlan, exportOnlyPending],
  );

  if (!isOpen) return null;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    setError(null);
    setLoggedBanner(null);
    try {
      const raw = await generateWeeklyMealPlanAi({
        profile,
        calorieTarget: effectiveGenCal,
        proteinTargetG: effectiveGenProt,
        mealsPerDay,
        preferencesNote,
      });
      const plan: WeeklyMealPlan = {
        id: `plan_${Date.now()}`,
        generatedAt: new Date().toISOString(),
        calorieTarget: effectiveGenCal,
        proteinTargetG: effectiveGenProt,
        notes: raw.notes,
        days: raw.days,
        shoppingList: raw.shoppingList.map((item, idx) => ({
          id: `shop_${Date.now()}_${idx}`,
          category: item.category,
          name: item.name,
          quantity: item.quantity,
          checked: false,
        })),
      };
      onSavePlan(plan);
      setSelectedDayIdx(0);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo generar el menú semanal con Gemini.',
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleShoppingItem = (id: string) => {
    if (!weeklyMealPlan) return;
    onSavePlan({
      ...weeklyMealPlan,
      shoppingList: weeklyMealPlan.shoppingList.map((i) =>
        i.id === id ? { ...i, checked: !i.checked } : i,
      ),
    });
  };

  const handleToggleAllShopping = (checked: boolean) => {
    if (!weeklyMealPlan) return;
    onSavePlan({
      ...weeklyMealPlan,
      shoppingList: weeklyMealPlan.shoppingList.map((i) => ({ ...i, checked })),
    });
  };

  const handleCopyShoppingText = async () => {
    if (!shoppingExportText) return;
    const ok = await copyTextToClipboard(shoppingExportText);
    setExportFeedback(
      ok
        ? 'Lista de compras copiada al portapapeles.'
        : 'No se pudo copiar automático; abre "Ver texto" para seleccionarla.',
    );
    window.setTimeout(() => setExportFeedback(null), 3200);
  };

  const handleDownloadShoppingTxt = () => {
    if (!weeklyMealPlan) return;
    downloadShoppingListTxt(weeklyMealPlan, exportOnlyPending);
    setExportFeedback('Archivo .txt descargado.');
    window.setTimeout(() => setExportFeedback(null), 3200);
  };

  const activeDay = weeklyMealPlan?.days[selectedDayIdx] ?? null;
  const activeDayTotals = activeDay
    ? activeDay.meals.reduce(
        (acc, m) => ({
          calories: acc.calories + Math.round(m.calories || 0),
          proteinG: acc.proteinG + Math.round(m.proteinG || 0),
          carbsG: acc.carbsG + Math.round(m.carbsG || 0),
          fatG: acc.fatG + Math.round(m.fatG || 0),
        }),
        { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      )
    : null;

  const pendingCount = weeklyMealPlan
    ? weeklyMealPlan.shoppingList.filter((i) => !i.checked).length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-t-3xl sm:rounded-3xl border border-[#262B36] bg-[#13151A] max-h-[92dvh] flex flex-col">
        <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden" />
        <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-[#D4FF33]">Planificación Gemini · 7 días</p>
            <h3 className="text-xl font-bold font-display text-white">
              Menú semanal y lista de compras
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar planificador semanal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          <form
            onSubmit={handleGenerate}
            className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="space-y-1">
                <span className="text-zinc-300 block">
                  Meta de tu perfil:{' '}
                  <strong className="font-mono text-[#D4FF33]">
                    {effectiveGenCal} kcal · {effectiveGenProt}g proteína
                  </strong>
                </span>
                {hasDistinctAdaptive && (
                  <div className="inline-flex rounded-xl bg-[#161922] p-0.5 gap-1">
                    <button
                      type="button"
                      onClick={() => setTargetSource('perfil')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                        targetSource === 'perfil'
                          ? 'bg-[#D4FF33] text-[#0A0B0D]'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Perfil ({baseProfileCal} kcal · {baseProfileProt}g)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetSource('adaptativa')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                        targetSource === 'adaptativa'
                          ? 'bg-emerald-400 text-[#0A0B0D]'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Adaptativa ({calorieTarget} kcal · {proteinTargetG}g)
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 flex-wrap">
                {[1, 2, 3, 4].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setMealsPerDay(cnt)}
                    className={`min-h-[34px] px-2.5 rounded-lg text-xs font-bold ${
                      mealsPerDay === cnt
                        ? 'bg-[#D4FF33] text-[#0A0B0D]'
                        : 'bg-[#181B23] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {cnt === 1 ? 'OMAD (1)' : `${cnt} comidas`}
                  </button>
                ))}
              </div>
            </div>

            <input
              type="text"
              value={preferencesNote}
              onChange={(e) => setPreferencesNote(e.target.value)}
              placeholder="Opcional: sin lácteos, económico, alto en pollo/atún, preparación rápida..."
              className="w-full min-h-[44px] rounded-xl border border-[#2A2F3D] bg-[#13161E] px-3.5 text-sm text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
            />

            <button
              type="submit"
              disabled={isGenerating}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-2xl bg-[#D4FF33] disabled:opacity-60 text-sm font-extrabold text-[#0A0B0D] active:scale-[0.99] transition-transform"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generando menú semanal + súper con Gemini...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {weeklyMealPlan ? 'Regenerar menú semanal' : 'Generar menú semanal con Gemini'}
                </>
              )}
            </button>
          </form>

          {error && (
            <p role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">
              {error}
            </p>
          )}

          {loggedBanner && (
            <p role="status" className="rounded-2xl border border-[#D4FF33]/40 bg-[#D4FF33]/10 p-3 text-xs font-bold text-[#D4FF33]">
              {loggedBanner}
            </p>
          )}

          {weeklyMealPlan && (
            <div className="space-y-4">
              {weeklyMealPlan.notes && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100 leading-relaxed">
                  {weeklyMealPlan.notes}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#0B0C0F] p-1">
                <button
                  type="button"
                  onClick={() => setView('menu')}
                  className={`min-h-[44px] rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 ${
                    view === 'menu'
                      ? 'bg-[#D4FF33] text-[#0A0B0D]'
                      : 'text-zinc-300'
                  }`}
                >
                  <CalendarDays className="w-4 h-4" />
                  Menú 7 días
                </button>
                <button
                  type="button"
                  onClick={() => setView('lista')}
                  className={`min-h-[44px] rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 ${
                    view === 'lista'
                      ? 'bg-[#D4FF33] text-[#0A0B0D]'
                      : 'text-zinc-300'
                  }`}
                >
                  <ShoppingCart className="w-4 h-4" />
                  Lista de compras ({pendingCount})
                </button>
              </div>

              {view === 'menu' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {weeklyMealPlan.days.map((d, idx) => (
                      <button
                        key={`${d.dayName}_${idx}`}
                        type="button"
                        onClick={() => setSelectedDayIdx(idx)}
                        className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 ${
                          selectedDayIdx === idx
                            ? 'bg-[#D4FF33] text-[#0A0B0D]'
                            : 'bg-[#181B23] text-zinc-300 hover:text-white'
                        }`}
                      >
                        {d.dayName}
                      </button>
                    ))}
                  </div>

                  {activeDay && activeDayTotals && (
                    <div className="space-y-2.5">
                      <div className="rounded-2xl border border-[#222631] bg-[#0B0C0F] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs">
                          <span className="text-zinc-400">Total {activeDay.dayName}: </span>
                          <strong className="font-mono text-white">
                            {activeDayTotals.calories} kcal
                          </strong>
                          <span className="text-zinc-400"> · </span>
                          <strong className="font-mono text-[#D4FF33]">
                            P {activeDayTotals.proteinG}g
                          </strong>
                          <span className="font-mono text-zinc-400">
                            {' '}· C {activeDayTotals.carbsG}g · G {activeDayTotals.fatG}g
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            for (const meal of activeDay.meals) {
                              onAddFood({
                                date: selectedDate,
                                mealType: meal.mealType,
                                name: meal.title,
                                calories: Math.round(meal.calories),
                                proteinG: Math.round(meal.proteinG),
                                carbsG: Math.round(meal.carbsG),
                                fatG: Math.round(meal.fatG),
                              });
                            }
                            setLoggedBanner(
                              `Se agregaron las ${activeDay.meals.length} comidas de ${activeDay.dayName} al ${selectedDate}.`,
                            );
                          }}
                          className="min-h-[34px] px-2.5 rounded-lg bg-[#1A2212] border border-[#D4FF33]/40 text-[11px] font-bold text-[#D4FF33] hover:bg-[#D4FF33] hover:text-[#0A0B0D] transition-colors"
                        >
                          + Sumar día completo
                        </button>
                      </div>

                      {activeDay.meals.map((meal, mIdx) => (
                        <div
                          key={`${meal.title}_${mIdx}`}
                          className="rounded-2xl border border-[#222631] bg-[#0E1014] p-3.5 flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase text-[#D4FF33]">
                              {meal.mealType}
                            </p>
                            <p className="text-sm font-bold text-white">{meal.title}</p>
                            <p className="text-xs text-zinc-400 mt-0.5">{meal.description}</p>
                            <p className="text-xs font-mono tabular-nums text-zinc-300 mt-1">
                              {Math.round(meal.calories)} kcal · P {Math.round(meal.proteinG)}g · C{' '}
                              {Math.round(meal.carbsG)}g · G {Math.round(meal.fatG)}g
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              onAddFood({
                                date: selectedDate,
                                mealType: meal.mealType,
                                name: meal.title,
                                calories: Math.round(meal.calories),
                                proteinG: Math.round(meal.proteinG),
                                carbsG: Math.round(meal.carbsG),
                                fatG: Math.round(meal.fatG),
                              });
                              setLoggedBanner(`"${meal.title}" sumado al ${selectedDate}.`);
                            }}
                            className="min-h-[42px] px-3 rounded-xl bg-[#1C2029] hover:bg-[#D4FF33] hover:text-[#0A0B0D] text-xs font-bold text-[#D4FF33] flex items-center gap-1 shrink-0 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Sumar hoy
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Text Export Bar */}
                  <div className="rounded-2xl border border-[#222631] bg-[#0D0F14] p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">
                        Exportar lista de compras a texto
                      </span>
                      <div className="inline-flex rounded-xl bg-[#161922] p-0.5 gap-1">
                        <button
                          type="button"
                          onClick={() => setExportOnlyPending(false)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                            !exportOnlyPending
                              ? 'bg-[#D4FF33] text-[#0A0B0D]'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          Todos ({weeklyMealPlan.shoppingList.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setExportOnlyPending(true)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                            exportOnlyPending
                              ? 'bg-[#D4FF33] text-[#0A0B0D]'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          Pendientes ({pendingCount})
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopyShoppingText()}
                        className="min-h-[44px] rounded-xl bg-[#D4FF33] px-3 text-xs font-extrabold text-[#0A0B0D] flex items-center justify-center gap-1.5 active:scale-[0.98]"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copiar texto
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadShoppingTxt}
                        className="min-h-[44px] rounded-xl border border-[#D4FF33]/40 bg-[#181B23] hover:border-[#D4FF33] px-3 text-xs font-bold text-[#D4FF33] flex items-center justify-center gap-1.5 active:scale-[0.98]"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Descargar .txt
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPlainTextPreview((v) => !v)}
                        className="min-h-[44px] rounded-xl border border-[#2A2F3D] bg-[#161922] hover:text-white px-3 text-xs font-bold text-zinc-300 flex items-center justify-center gap-1.5"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {showPlainTextPreview ? 'Ocultar texto' : 'Ver texto'}
                      </button>
                    </div>

                    {exportFeedback && (
                      <p role="status" className="text-xs font-semibold text-emerald-300">
                        {exportFeedback}
                      </p>
                    )}

                    {showPlainTextPreview && (
                      <textarea
                        readOnly
                        rows={8}
                        value={shoppingExportText}
                        aria-label="Texto de la lista de compras"
                        onFocus={(e) => e.currentTarget.select()}
                        className="w-full rounded-xl border border-[#2A2F3D] bg-[#090A0D] p-3 font-mono text-xs text-zinc-200 focus:border-[#D4FF33] focus:outline-none"
                      />
                    )}
                  </div>

                  {/* Quick check/uncheck actions */}
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-zinc-400">
                      Toca cada artículo para marcarlo en el súper
                    </span>
                    <div className="flex items-center gap-2">
                      {pendingCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => handleToggleAllShopping(true)}
                          className="text-zinc-300 hover:text-[#D4FF33] font-semibold"
                        >
                          Marcar todo
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleAllShopping(false)}
                          className="text-zinc-300 hover:text-[#D4FF33] font-semibold"
                        >
                          Desmarcar todo
                        </button>
                      )}
                    </div>
                  </div>

                  {SHOPPING_CATEGORIES.map((cat) => {
                    const catItems = weeklyMealPlan.shoppingList.filter(
                      (i) => i.category === cat,
                    );
                    if (catItems.length === 0) return null;
                    return (
                      <div key={cat} className="space-y-2">
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#D4FF33]">
                          {cat}
                        </h4>
                        <div className="divide-y divide-white/5 rounded-2xl border border-[#222631] bg-[#0E1014] px-3.5">
                          {catItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => toggleShoppingItem(item.id)}
                              className="w-full min-h-[46px] py-2 flex items-center justify-between gap-3 text-left"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                                    item.checked
                                      ? 'bg-[#D4FF33] text-[#0A0B0D]'
                                      : 'border border-zinc-600'
                                  }`}
                                >
                                  {item.checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                </div>
                                <span
                                  className={`text-sm truncate ${
                                    item.checked ? 'line-through text-zinc-500' : 'text-white'
                                  }`}
                                >
                                  {item.name}
                                </span>
                              </div>
                              <span className="font-mono text-xs text-zinc-400 shrink-0">
                                {item.quantity}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  <div className="pt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onSavePlan(null)}
                      className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#2A2F3D] bg-[#161922] px-3 text-xs font-semibold text-zinc-400 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Borrar plan guardado
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
