import React from 'react';
import type {
  AnatomicalMuscleId,
  MuscleActivationItem,
} from '../lib/exerciseDemoDb';

interface MuscleAnatomyMapProps {
  activations: MuscleActivationItem[];
}

export const MuscleAnatomyMap: React.FC<MuscleAnatomyMapProps> = ({
  activations,
}) => {
  const roleByMuscle = new Map<AnatomicalMuscleId, 'primary' | 'secondary'>();
  for (const item of activations) {
    roleByMuscle.set(item.id, item.role);
  }

  const getFill = (id: AnatomicalMuscleId): string => {
    const role = roleByMuscle.get(id);
    if (role === 'primary') return '#EF4444';
    if (role === 'secondary') return '#F59E0B';
    return '#252B37';
  };

  const getStroke = (id: AnatomicalMuscleId): string => {
    const role = roleByMuscle.get(id);
    if (role === 'primary') return '#FCA5A5';
    if (role === 'secondary') return '#FCD34D';
    return '#363E50';
  };

  const primaryItems = activations.filter((a) => a.role === 'primary');
  const secondaryItems = activations.filter((a) => a.role === 'secondary');

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-bold text-white">Mapa anatómico muscular</span>
        <div className="flex items-center gap-4 text-zinc-300">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#EF4444] inline-block" />
            Primarios
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#F59E0B] inline-block" />
            Secundarios
          </span>
        </div>
      </div>

      {/* Side-by-side Front & Back Anatomical SVG */}
      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-[#222631] bg-[#0D0F14] p-3 sm:p-4">
        {/* VISTA FRONTAL */}
        <div className="flex flex-col items-center">
          <span className="text-[11px] font-semibold text-zinc-400 mb-1.5">
            Vista frontal
          </span>
          <svg
            viewBox="0 0 200 320"
            className="w-full max-w-[175px] h-auto"
            role="img"
            aria-label="Mapa muscular vista frontal"
          >
            {/* Base silhouette: Head, Neck, Hands, Pelvis, Knees, Feet */}
            <g fill="#171B24" stroke="#2D3446" strokeWidth="1.2">
              <circle cx="100" cy="24" r="14" />
              <path d="M92 37 L108 37 L111 49 L89 49 Z" />
              {/* Pelvis / Hip base */}
              <path d="M77 148 L123 148 L119 170 L100 176 L81 170 Z" />
              {/* Hands */}
              <ellipse cx="38" cy="176" rx="6" ry="9" />
              <ellipse cx="162" cy="176" rx="6" ry="9" />
              {/* Knees */}
              <ellipse cx="83" cy="233" rx="8" ry="6" />
              <ellipse cx="117" cy="233" rx="8" ry="6" />
              {/* Feet */}
              <path d="M73 300 L90 300 L91 312 L71 312 Z" />
              <path d="M110 300 L127 300 L129 312 L109 312 Z" />
            </g>

            {/* Trapecio (Frontal) */}
            <g fill={getFill('trapecio')} stroke={getStroke('trapecio')} strokeWidth="1.1">
              <path d="M89 47 L67 57 L83 60 L93 50 Z" />
              <path d="M111 47 L133 57 L117 60 L107 50 Z" />
            </g>

            {/* Hombro lateral (Frontal outer cap) */}
            <g
              fill={getFill('hombro_lateral')}
              stroke={getStroke('hombro_lateral')}
              strokeWidth="1.1"
            >
              <path d="M67 57 C57 60 54 71 56 83 L63 81 C63 71 65 64 71 61 Z" />
              <path d="M133 57 C143 60 146 71 144 83 L137 81 C137 71 135 64 129 61 Z" />
            </g>

            {/* Hombro frontal */}
            <g
              fill={getFill('hombro_frontal')}
              stroke={getStroke('hombro_frontal')}
              strokeWidth="1.1"
            >
              <path d="M71 60 L82 62 L76 84 L63 81 C63 71 65 64 71 60 Z" />
              <path d="M129 60 L118 62 L124 84 L137 81 C137 71 135 64 129 60 Z" />
            </g>

            {/* Pecho */}
            <g fill={getFill('pecho')} stroke={getStroke('pecho')} strokeWidth="1.2">
              <path d="M82 61 L99 63 L99 91 C90 93 78 90 74 82 Z" />
              <path d="M118 61 L101 63 L101 91 C110 93 122 90 126 82 Z" />
            </g>

            {/* Bíceps */}
            <g fill={getFill('biceps')} stroke={getStroke('biceps')} strokeWidth="1.1">
              <path d="M56 84 L67 84 L63 120 L51 118 C51 106 52 94 56 84 Z" />
              <path d="M144 84 L133 84 L137 120 L149 118 C149 106 148 94 144 84 Z" />
            </g>

            {/* Antebrazos (Frontal) */}
            <g
              fill={getFill('antebrazos')}
              stroke={getStroke('antebrazos')}
              strokeWidth="1.1"
            >
              <path d="M51 121 L62 122 L45 166 L36 164 C40 148 45 133 51 121 Z" />
              <path d="M149 121 L138 122 L155 166 L164 164 C160 148 155 133 149 121 Z" />
            </g>

            {/* Oblicuos */}
            <g fill={getFill('oblicuos')} stroke={getStroke('oblicuos')} strokeWidth="1.1">
              <path d="M74 92 L85 95 L84 147 L75 144 C73 126 73 108 74 92 Z" />
              <path d="M126 92 L115 95 L116 147 L125 144 C127 126 127 108 126 92 Z" />
            </g>

            {/* Abdomen */}
            <g fill={getFill('abdomen')} stroke={getStroke('abdomen')} strokeWidth="1.1">
              <rect x="87" y="94" width="12" height="14" rx="3" />
              <rect x="101" y="94" width="12" height="14" rx="3" />
              <rect x="87" y="111" width="12" height="14" rx="3" />
              <rect x="101" y="111" width="12" height="14" rx="3" />
              <path d="M87 128 L99 128 L99 149 L89 147 Z" />
              <path d="M101 128 L113 128 L111 147 L101 149 Z" />
            </g>

            {/* Cuádriceps */}
            <g
              fill={getFill('cuadriceps')}
              stroke={getStroke('cuadriceps')}
              strokeWidth="1.2"
            >
              <path d="M74 166 L95 174 L92 225 L74 225 C69 205 70 184 74 166 Z" />
              <path d="M126 166 L105 174 L108 225 L126 225 C131 205 130 184 126 166 Z" />
            </g>

            {/* Pantorrillas (Frontal lateral/tibial) */}
            <g
              fill={getFill('pantorrillas')}
              stroke={getStroke('pantorrillas')}
              strokeWidth="1.1"
            >
              <path d="M74 241 L90 241 L88 296 L75 296 C70 278 70 258 74 241 Z" />
              <path d="M126 241 L110 241 L112 296 L125 296 C130 278 130 258 126 241 Z" />
            </g>
          </svg>
        </div>

        {/* VISTA TRASERA */}
        <div className="flex flex-col items-center">
          <span className="text-[11px] font-semibold text-zinc-400 mb-1.5">
            Vista trasera
          </span>
          <svg
            viewBox="0 0 200 320"
            className="w-full max-w-[175px] h-auto"
            role="img"
            aria-label="Mapa muscular vista trasera"
          >
            {/* Base silhouette: Head, Neck, Hands, Feet */}
            <g fill="#171B24" stroke="#2D3446" strokeWidth="1.2">
              <circle cx="100" cy="24" r="14" />
              <path d="M92 37 L108 37 L110 47 L90 47 Z" />
              <ellipse cx="38" cy="176" rx="6" ry="9" />
              <ellipse cx="162" cy="176" rx="6" ry="9" />
              <path d="M73 300 L90 300 L91 312 L71 312 Z" />
              <path d="M110 300 L127 300 L129 312 L109 312 Z" />
            </g>

            {/* Trapecio (Trasero completo) */}
            <path
              d="M90 47 L110 47 L131 61 L100 94 L69 61 Z"
              fill={getFill('trapecio')}
              stroke={getStroke('trapecio')}
              strokeWidth="1.2"
            />

            {/* Hombro lateral (Trasero borde externo) */}
            <g
              fill={getFill('hombro_lateral')}
              stroke={getStroke('hombro_lateral')}
              strokeWidth="1.1"
            >
              <path d="M67 57 C57 60 54 71 56 83 L63 81 C63 71 65 64 71 61 Z" />
              <path d="M133 57 C143 60 146 71 144 83 L137 81 C137 71 135 64 129 61 Z" />
            </g>

            {/* Hombro posterior */}
            <g
              fill={getFill('hombro_posterior')}
              stroke={getStroke('hombro_posterior')}
              strokeWidth="1.1"
            >
              <path d="M69 61 L83 68 L74 84 L63 81 Z" />
              <path d="M131 61 L117 68 L126 84 L137 81 Z" />
            </g>

            {/* Dorsal ancho */}
            <g
              fill={getFill('dorsal_ancho')}
              stroke={getStroke('dorsal_ancho')}
              strokeWidth="1.2"
            >
              <path d="M72 82 L99 95 L98 128 L78 124 C73 110 71 96 72 82 Z" />
              <path d="M128 82 L101 95 L102 128 L122 124 C127 110 129 96 128 82 Z" />
            </g>

            {/* Espalda baja */}
            <path
              d="M80 124 L100 128 L120 124 L117 151 L83 151 Z"
              fill={getFill('espalda_baja')}
              stroke={getStroke('espalda_baja')}
              strokeWidth="1.2"
            />

            {/* Tríceps */}
            <g fill={getFill('triceps')} stroke={getStroke('triceps')} strokeWidth="1.1">
              <path d="M56 84 L67 84 L63 120 L51 118 C51 106 52 94 56 84 Z" />
              <path d="M144 84 L133 84 L137 120 L149 118 C149 106 148 94 144 84 Z" />
            </g>

            {/* Antebrazos (Trasero) */}
            <g
              fill={getFill('antebrazos')}
              stroke={getStroke('antebrazos')}
              strokeWidth="1.1"
            >
              <path d="M51 121 L62 122 L45 166 L36 164 C40 148 45 133 51 121 Z" />
              <path d="M149 121 L138 122 L155 166 L164 164 C160 148 155 133 149 121 Z" />
            </g>

            {/* Glúteos */}
            <g fill={getFill('gluteos')} stroke={getStroke('gluteos')} strokeWidth="1.2">
              <path d="M77 150 L99 152 L98 184 C85 186 74 179 73 166 Z" />
              <path d="M123 150 L101 152 L102 184 C115 186 126 179 127 166 Z" />
            </g>

            {/* Isquiotibiales */}
            <g
              fill={getFill('isquiotibiales')}
              stroke={getStroke('isquiotibiales')}
              strokeWidth="1.2"
            >
              <path d="M74 180 L96 184 L92 232 L74 232 C70 214 70 196 74 180 Z" />
              <path d="M126 180 L104 184 L108 232 L126 232 C130 214 130 196 126 180 Z" />
            </g>

            {/* Pantorrillas (Trasero) */}
            <g
              fill={getFill('pantorrillas')}
              stroke={getStroke('pantorrillas')}
              strokeWidth="1.2"
            >
              <path d="M74 240 L91 240 C93 256 91 274 87 296 L75 296 C69 276 69 258 74 240 Z" />
              <path d="M126 240 L109 240 C107 256 109 274 113 296 L125 296 C131 276 131 258 126 240 Z" />
            </g>
          </svg>
        </div>
      </div>

      {/* Activation Summary & Percentage Readout */}
      <div className="space-y-2.5">
        <p className="text-xs text-zinc-300 leading-relaxed">
          <span className="font-bold text-rose-400">
            Primario{primaryItems.length > 1 ? 's' : ''}:
          </span>{' '}
          {primaryItems.map((m) => `${m.label} (${m.activationPct}%)`).join(', ')}
          {secondaryItems.length > 0 && (
            <>
              <span className="mx-2 text-zinc-600">•</span>
              <span className="font-bold text-amber-400">
                Secundario{secondaryItems.length > 1 ? 's' : ''}:
              </span>{' '}
              {secondaryItems
                .map((m) => `${m.label} (${m.activationPct}%)`)
                .join(', ')}
            </>
          )}
        </p>

        <div className="flex flex-wrap gap-2">
          {activations.map((item) => (
            <span
              key={item.id}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-mono tabular-nums font-bold border ${
                item.role === 'primary'
                  ? 'border-[#EF4444]/45 bg-[#EF4444]/15 text-rose-200'
                  : 'border-[#F59E0B]/45 bg-[#F59E0B]/15 text-amber-200'
              }`}
            >
              {item.label} · {item.activationPct}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
