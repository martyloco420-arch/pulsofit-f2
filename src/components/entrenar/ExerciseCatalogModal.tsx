import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Info, Plus, Search, X } from 'lucide-react';
import { EQUIPMENT_OPTIONS, EXERCISE_CATALOG } from '../../data/exercises';
import { resolveDetailedAnatomy } from '../../lib/exerciseDemoDb';
import { ALL_MUSCLES, MUSCLE_LABELS } from '../../lib/recovery';
import type {
  EquipmentType,
  ExerciseDefinition,
  MuscleGroup,
} from '../../types/fitness';
import {
  ExerciseDemoModal,
  type InspectedExerciseInfo,
} from '../ExerciseDemoModal';
import { MuscleAnatomyMap } from '../MuscleAnatomyMap';

export interface ExerciseCatalogModalProps {
  isOpen: boolean;
  userEquipment: EquipmentType[];
  restRemaining?: number | null;
  onClose: () => void;
  onSelectExercise: (def: ExerciseDefinition) => void;
  onInspectExercise?: (info: InspectedExerciseInfo) => void;
}

export const ExerciseCatalogModal: React.FC<ExerciseCatalogModalProps> = ({
  isOpen,
  userEquipment,
  restRemaining = null,
  onClose,
  onSelectExercise,
  onInspectExercise,
}) => {
  const [search, setSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | 'todos'>(
    'todos',
  );
  const [selectedEquipment, setSelectedEquipment] = useState<
    'mi_equipo' | 'todos' | EquipmentType
  >('mi_equipo');
  const [expandedAnatomyId, setExpandedAnatomyId] = useState<string | null>(
    null,
  );
  const [localDemoExercise, setLocalDemoExercise] =
    useState<InspectedExerciseInfo | null>(null);

  const availableByUserEquipmentCount = useMemo(() => {
    if (!userEquipment || userEquipment.length === 0) {
      return EXERCISE_CATALOG.length;
    }
    return EXERCISE_CATALOG.filter((ex) =>
      ex.equipment.some((eq) => userEquipment.includes(eq)),
    ).length;
  }, [userEquipment]);

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();

    return EXERCISE_CATALOG.filter((ex) => {
      // Equipment filter
      if (selectedEquipment === 'mi_equipo') {
        if (
          userEquipment.length > 0 &&
          !ex.equipment.some((eq) => userEquipment.includes(eq))
        ) {
          return false;
        }
      } else if (selectedEquipment !== 'todos') {
        if (!ex.equipment.includes(selectedEquipment)) {
          return false;
        }
      }

      // Muscle filter
      if (selectedMuscle !== 'todos') {
        const hitsPrimary = ex.primaryMuscles.includes(selectedMuscle);
        const hitsSecondary = ex.secondaryMuscles.includes(selectedMuscle);
        if (!hitsPrimary && !hitsSecondary) {
          return false;
        }
      }

      // Text query filter
      if (!q) return true;
      const muscleMatch = [...ex.primaryMuscles, ...ex.secondaryMuscles].some(
        (m) => MUSCLE_LABELS[m].toLowerCase().includes(q),
      );
      const equipMatch = ex.equipment.some((eqId) => {
        const label =
          EQUIPMENT_OPTIONS.find((opt) => opt.id === eqId)?.label ?? eqId;
        return label.toLowerCase().includes(q);
      });
      return ex.name.toLowerCase().includes(q) || muscleMatch || equipMatch;
    });
  }, [search, selectedEquipment, selectedMuscle, userEquipment]);

  if (!isOpen) return null;

  const handleOpenDemo = (def: ExerciseDefinition) => {
    const info: InspectedExerciseInfo = {
      name: def.name,
      primaryMuscles: def.primaryMuscles,
      secondaryMuscles: def.secondaryMuscles,
      notes: def.instructions,
    };
    if (onInspectExercise) {
      onInspectExercise(info);
    } else {
      setLocalDemoExercise(info);
    }
  };

  const handleSelect = (def: ExerciseDefinition) => {
    setSearch('');
    setExpandedAnatomyId(null);
    onSelectExercise(def);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Catálogo y buscador de ejercicios"
      >
        <div className="w-full max-w-xl rounded-t-3xl sm:rounded-3xl border border-[#262B36] bg-[#13151A] max-h-[88dvh] flex flex-col shadow-2xl">
          <div className="w-10 h-1.5 bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden" />

          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold font-display text-white">
                Elegir ejercicio
              </h3>
              <p className="text-xs text-zinc-400">
                {selectedEquipment === 'mi_equipo'
                  ? `Filtrado por tu equipo en Perfil (${availableByUserEquipmentCount} disponibles)`
                  : `Mostrando ${filteredCatalog.length} ejercicios del catálogo`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar selector"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search + Filters */}
          <div className="p-4 border-b border-white/5 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, músculo o equipo..."
                className="w-full min-h-[46px] rounded-2xl border border-[#2A2F3D] bg-[#0B0C0F] pl-10 pr-4 text-sm text-white placeholder:text-zinc-500 focus:border-[#D4FF33] focus:outline-none"
              />
            </div>

            {/* Muscle Group Filter Pills */}
            <div className="space-y-1.5">
              <span className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                Grupo muscular
              </span>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedMuscle('todos')}
                  className={`min-h-[34px] px-3 rounded-xl text-xs font-bold shrink-0 border transition-colors ${
                    selectedMuscle === 'todos'
                      ? 'bg-[#D4FF33] border-[#D4FF33] text-[#0A0B0D]'
                      : 'bg-[#181B23] border-[#252A36] text-zinc-300 hover:text-white'
                  }`}
                >
                  Todos
                </button>
                {ALL_MUSCLES.map((m) => {
                  const active = selectedMuscle === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSelectedMuscle(m)}
                      className={`min-h-[34px] px-3 rounded-xl text-xs font-bold shrink-0 border transition-colors ${
                        active
                          ? 'bg-[#D4FF33] border-[#D4FF33] text-[#0A0B0D]'
                          : 'bg-[#181B23] border-[#252A36] text-zinc-300 hover:text-white'
                      }`}
                    >
                      {MUSCLE_LABELS[m]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Equipment Filter Pills */}
            <div className="space-y-1.5">
              <span className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                Equipamiento
              </span>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedEquipment('mi_equipo')}
                  className={`min-h-[34px] px-3 rounded-xl text-xs font-bold shrink-0 border transition-colors ${
                    selectedEquipment === 'mi_equipo'
                      ? 'bg-[#D4FF33] border-[#D4FF33] text-[#0A0B0D]'
                      : 'bg-[#181B23] border-[#252A36] text-zinc-300 hover:text-white'
                  }`}
                >
                  Mi equipo
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEquipment('todos')}
                  className={`min-h-[34px] px-3 rounded-xl text-xs font-bold shrink-0 border transition-colors ${
                    selectedEquipment === 'todos'
                      ? 'bg-[#D4FF33] border-[#D4FF33] text-[#0A0B0D]'
                      : 'bg-[#181B23] border-[#252A36] text-zinc-300 hover:text-white'
                  }`}
                >
                  Todo el catálogo
                </button>
                {EQUIPMENT_OPTIONS.map((eq) => {
                  const active = selectedEquipment === eq.id;
                  return (
                    <button
                      key={eq.id}
                      type="button"
                      onClick={() => setSelectedEquipment(eq.id)}
                      className={`min-h-[34px] px-3 rounded-xl text-xs font-bold shrink-0 border transition-colors ${
                        active
                          ? 'bg-[#D4FF33] border-[#D4FF33] text-[#0A0B0D]'
                          : 'bg-[#181B23] border-[#252A36] text-zinc-300 hover:text-white'
                      }`}
                    >
                      {eq.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Catalog List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {filteredCatalog.map((def) => {
              const isAnatomyExpanded = expandedAnatomyId === def.id;
              const anatomy = isAnatomyExpanded
                ? resolveDetailedAnatomy(
                    def.name,
                    def.primaryMuscles,
                    def.secondaryMuscles,
                  )
                : null;
              const equipmentNames = def.equipment
                .map(
                  (eqId) =>
                    EQUIPMENT_OPTIONS.find((opt) => opt.id === eqId)?.label ??
                    eqId,
                )
                .slice(0, 2)
                .join(' · ');

              return (
                <div
                  key={def.id}
                  className="rounded-2xl border border-[#222631] bg-[#181B23] hover:border-[#D4FF33]/50 px-3.5 py-2.5 space-y-2.5 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleSelect(def)}
                      className="flex-1 min-w-0 text-left py-1"
                    >
                      <p className="text-sm font-bold text-white truncate">
                        {def.name}
                      </p>
                      <p className="text-xs text-zinc-400 mt-0.5 truncate">
                        {def.primaryMuscles
                          .map((m) => MUSCLE_LABELS[m])
                          .join(' · ')}
                        {def.secondaryMuscles.length > 0 &&
                          ` · Sec: ${def.secondaryMuscles
                            .map((m) => MUSCLE_LABELS[m])
                            .join(', ')}`}
                      </p>
                      <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                        {equipmentNames}
                      </p>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedAnatomyId((prev) =>
                            prev === def.id ? null : def.id,
                          )
                        }
                        aria-label={`Alternar mapa muscular de ${def.name}`}
                        title="Vista rápida de mapa muscular"
                        className={`min-h-[42px] px-2.5 inline-flex items-center gap-1 rounded-xl border text-[11px] font-bold transition-colors ${
                          isAnatomyExpanded
                            ? 'border-[#D4FF33] bg-[#D4FF33]/15 text-[#D4FF33]'
                            : 'border-[#2B303C] bg-[#11141B] text-zinc-300 hover:border-[#D4FF33]'
                        }`}
                      >
                        Mapa
                        {isAnatomyExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenDemo(def)}
                        aria-label={`Ver técnica y mapa muscular de ${def.name}`}
                        className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-[#2B303C] bg-[#11141B] text-zinc-200 hover:border-[#D4FF33] hover:text-[#D4FF33]"
                      >
                        <Info className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelect(def)}
                        aria-label={`Agregar ${def.name}`}
                        className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-[#D4FF33] text-[#0A0B0D]"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {isAnatomyExpanded && anatomy && (
                    <div className="pt-2 border-t border-white/10 space-y-2">
                      <MuscleAnatomyMap activations={anatomy.activations} />
                      <button
                        type="button"
                        onClick={() => handleOpenDemo(def)}
                        className="w-full min-h-[40px] rounded-xl border border-[#D4FF33]/40 bg-[#D4FF33]/10 text-xs font-extrabold text-[#D4FF33] hover:bg-[#D4FF33]/20"
                      >
                        Abrir guía técnica animada completa
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredCatalog.length === 0 && (
              <div className="text-center py-8 space-y-2">
                <p className="text-sm text-zinc-400">
                  No se encontraron ejercicios con ese filtro.
                </p>
                {(selectedMuscle !== 'todos' ||
                  selectedEquipment !== 'todos' ||
                  search.trim()) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setSelectedMuscle('todos');
                      setSelectedEquipment('todos');
                    }}
                    className="min-h-[36px] px-4 rounded-xl border border-[#2A2F3D] bg-[#181B23] text-xs font-bold text-[#D4FF33]"
                  >
                    Ver todo el catálogo
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {!onInspectExercise && (
        <ExerciseDemoModal
          exercise={localDemoExercise}
          onClose={() => setLocalDemoExercise(null)}
          restRemaining={restRemaining}
        />
      )}
    </>
  );
};
