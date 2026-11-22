# PulsoFit V2 Fase 2 — Ecosistema Integral de Entrenamiento, Nutrición Rápida, Progreso Físico y Sincronización

Actualización integral de PulsoFit que incorpora el resumen diario unificado «Hoy», entrenamiento avanzado (plantillas, superseries, progresión por RPE, temporizador HIIT/Tabata y pulso cardíaco Bluetooth), registro nutricional ultrarrápido con código de barras y menús semanales IA, seguimiento físico completo (medidas, fotos comparativas y recuperación diaria) y respaldo híbrido con exportación CSV/PDF y sincronización opcional en la nube.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Sincronización en la nube opcional (Firebase) frente a modo 100 % offline:**
> Como confirmaste agregar todo el paquete completo, se propone una arquitectura **local-first sin barrera de inicio de sesión** (IndexedDB sigue siendo la fuente principal instantánea y offline) más un botón opcional **"Conectar cuenta y sincronizar en la nube"** dentro de Perfil (Firebase Auth con Google + Firestore). Al ejecutar la implementación de Firebase se te mostrará el diálogo estándar para confirmar el aprovisionamiento del proyecto; si en ese momento prefieres no activar la nube, el resto de funciones y la exportación CSV/PDF seguirán operando al 100 % en el dispositivo.

> [!NOTE]
> **Regla estricta de retrocompatibilidad:**
> Ninguna clave previa en `localStorage` ni en IndexedDB (`pulsofit_gemini_api_key`, `pulsofit_backup_state_v1`, `pulsofit_db`, `pulsofit_music_db`) será eliminada ni renombrada. Todos los pesos, distancias, medidas y líquidos seguirán almacenándose internamente en sistema métrico base (`kg`, `km`, `cm`, `ml`).

- **Decisión confirmada 1 — Alcance completo V2 Fase 2**: Inclusión coordinada de las 4 áreas solicitadas (Resumen diario unificado, Entrenamiento avanzado, Nutrición rápida + planificador semanal, Progreso físico + recuperación) conservando la navegación inferior de 4 pestañas para no saturar la barra táctil móvil.
- **Decisión confirmada 2 — Unidades granulares heredadas**: Todas las nuevas métricas (objetivos de sobrecarga, medidas corporales, listas de compras y reportes) respetarán automáticamente la configuración de `kg`/`lb`, `km`/`mi` y `ml`/`oz` elegida en Perfil.

---

## 1. Overview & Core Concept

- **Qué resuelve**: Hoy PulsoFit ya cubre entrenamiento básico, báscula BIA, ayuno, hidratación, cardio GPS y música offline, pero todavía exige fricción manual al repetir desayunos, armar splits semanales propios, cronometrar intervalos HIIT, registrar medidas/fotos corporales o consolidar cómo amaneció el cuerpo antes de entrenar.
- **Usuario objetivo**: Atleta híbrido y practicante de fuerza/recomposición corporal que entrena en gimnasio o en casa (con pesas o ligas), usa su teléfono como herramienta única offline en el gym y busca velocidad en el registro diario.
- **Valor central**: Un solo vistazo al abrir la app indica estado de recuperación, calorías/agua restantes y rutina del día; registrar comida o avanzar una rutina toma un par de toques, y el progreso visual combina báscula, medidas, fotos y récords exportables o respaldados en la nube.

---

## 2. User Experience & Visual Design

### Flujos clave de usuario

1. **Resumen diario unificado («Hoy en PulsoFit»)**
   - Al abrir la pestaña principal (`Entrenar`) o tocar el acceso superior compacto «Hoy», se despliega un panel resumen sin saturar la pantalla con: estado de recuperación (check-in de sueño/energía/dolor), progreso del día (calorías + proteína restantes, agua tomada y ayuno activo) y acceso en 1 toque a la rutina recomendada o plantilla del día.
   - Respeta estrictamente la regla de mantener 4 pestañas en la barra inferior fija (`Entrenar`, `Progreso`, `Nutrición`, `Perfil`) y el tope de altura fija móvil ≤ 15 % junto con el mini-reproductor musical.

2. **Entrenamiento avanzado (`Entrenar`)**
   - **Selector de modo ampliado**: `Fuerza` | `HIIT / Tabata` | `Cardio GPS`.
   - **Plantillas propias y editor visual**: Guardar cualquier rutina activa o IA como plantilla reutilizable, o crear/reordenar un split semanal (`Push`, `Pull`, `Pierna`, `Full Body`) con arrastrar/subir/bajar ejercicios y series predefinidas.
   - **Superseries y tipo de serie**: Botón para enlazar dos ejercicios consecutivos bajo un agrupador visual limpio (`Superserie A`), y selector discreto por fila de serie: `C` (Calentamiento), `N` (Normal), `D` (Drop-set) o `F` (Al fallo). Las series `C` se distinguen del volumen efectivo principal.
   - **Sugerencia automática de sobrecarga progresiva**: Junto a la referencia «Última vez», si en la sesión previa lograste tus repeticiones objetivo con `RPE ≤ 8`, aparece una recomendación directa (por ejemplo, `Sugerido: +2.5 kg` o `+5 lb`, o `+1 rep`) aplicable en 1 toque.
   - **Temporizador HIIT / Tabata**: Configurador rápido de intervalos (`Trabajo`, `Descanso`, `Rondas`, `Series`) con presets (`Tabata 20/10`, `EMOM 60s`, `30/30`), pantalla de alto contraste para el suelo del gimnasio, avisos sonoros/voz, vibración háptica y Wake Lock activo.
   - **Banda de frecuencia cardíaca Bluetooth (`0x180D`)**: Botón opcional para vincular bandas/relojes BLE estándar (`heart_rate`), mostrando BPM en vivo y zona de esfuerzo (`Z1`–`Z5` según edad del perfil) tanto en Fuerza como en Cardio/HIIT.

3. **Nutrición rápida y planificación (`Nutrición`)**
   - **Copiar comidas de ayer y Favoritos**: Cada comida (`Desayuno`, `Almuerzo`, `Cena`, `Snacks`) incorpora botones de «Copiar de ayer» y «Guardar/Elegir favorito» (combina alimentos frecuentes o recetas propias en 1 toque).
   - **Escáner de código de barras**: En «Registrar comida», botón junto al escáner de plato que abre la cámara (`BarcodeDetector` nativo con respaldo manual de código EAN/UPC) y consulta en tiempo real la base abierta de OpenFoodFacts para precargar nombre, porción, calorías y macros editables por gramos.
   - **Planificador semanal de menús con IA + Lista de compras**: Modal/sección para generar un menú de 7 días alineado a tu TDEE adaptativo y meta proteica (respetando días de ayuno/ventana OMAD o comidas habituales), generando automáticamente una lista de compras agrupada por categoría (`Proteínas`, `Carbohidratos`, `Verduras/Frutas`, `Despensa`) con casillas marcables.

4. **Progreso físico, recuperación y reportes (`Progreso` y `Perfil`)**
   - **Check-in diario de recuperación (Readiness)**: Control rápido de 10 segundos (horas de sueño, energía 1–5, dolor muscular 1–5) que calcula un índice de preparación y ajusta el tono/volumen sugerido al generar rutinas con IA.
   - **Medidas corporales**: Registro y minigráficas para cintura, cadera, pecho, brazo y muslo (almacenadas en `cm`, visualizadas en `cm` o `in` según preferencia).
   - **Fotos de progreso privadas offline**: Galería por fecha/pose (`Frente`, `Perfil`, `Espalda`) almacenada como blobs optimizados en una base IndexedDB dedicada (`pulsofit_photos_db`) con visor comparativo lado a lado y deslizador «Antes / Después».
   - **Exportación CSV/PDF y Nube opcional (`Perfil`)**: Descarga directa de reportes en `.csv` (sesiones, nutrición, báscula, cardio) o reporte `.pdf` limpio listo para imprimir/compartir, junto con el bloque opcional de sincronización Firebase para llevar tus datos a otro teléfono sin perder el modo offline.

### Identidad visual y diseño

- **Aesthetic Direction**: Utilitario atlético oscuro de alto contraste diseñado para lectura rápida bajo luz de gimnasio y operación con una sola mano (`min-h-[44px]` a `48px` en controles interactivos).
- **Color Palette & Mood**:
  - Lienzo base `#0A0B0D` (60 %), superficies estructurales `#12141A` / `#161922` con bordes sutiles `#222631` (30 %), y acento volt-lima `#D4FF33` reservado exclusivamente a acciones primarias y progreso activo (10 %).
  - Colores semánticos acompañados siempre de texto o ícono (`#38BDF8` hidratación/calentamiento, `#FB7185` fallo/alerta, `#34D399` recuperación óptima).
- **Typography & Hierarchy**:
  - Display: `Barlow Condensed` (600–800) con `text-wrap: balance` para encabezados sin palabras huérfanas.
  - Cuerpo: `Plus Jakarta Sans` (400–700).
  - Métricas/Tablas: `JetBrains Mono` con `tabular-nums` obligatorio en pesos, tiempos, BPM y macros.
- **Disciplina de interfaz**: Cero cápsulas/pills decorativas en metadatos estáticos (separadores limpios con `·`), cero puntos decorativos parpadeantes y cero bordes laterales gruesos tipo Bootstrap (`border-l-4`).

---

## 3. Key Product Decisions & Trade-Offs

- **Decisión 1 — Almacenamiento de fotos en IndexedDB separado (`pulsofit_photos_db`)**
  - *Enfoque elegido*: Guardar los blobs de fotos de progreso en una base IndexedDB independiente (análoga a `pulsofit_music_db`), guardando solo referencias ligeras en `pulsofit_db`.
  - *Por qué*: Evita exceder la cuota de `localStorage` (5–10 MB) y mantiene instantánea la serialización/respaldo del historial numérico principal. Además, respeta el límite de 1 MB por documento si el usuario activa la sincronización Firestore (sincronizando datos estructurados y manteniendo fotos locales privadas).
  - *Alternativa descartada*: Guardar imágenes Base64 dentro de `AppDatabase`, lo que congelaría los backups JSON.

- **Decisión 2 — Código de barras con `BarcodeDetector` + búsqueda directa a OpenFoodFacts**
  - *Enfoque elegido*: Utilizar la API nativa del navegador `BarcodeDetector` (disponible en Android Chrome/PWA) con vista de cámara y un campo numérico manual de respaldo + consulta `fetch` a OpenFoodFacts desde el cliente/proxy del servidor.
  - *Por qué*: Cero dependencias pesadas que inflen el bundle PWA, respuesta instantánea en Android APK/Chrome y funcionamiento claro con entrada manual en navegadores iOS/desktop sin `BarcodeDetector`.

- **Decisión 3 — Nube opcional (Firebase) sobre base Local-First**
  - *Enfoque elegido*: PulsoFit arranca siempre en modo local offline. En `Perfil` el usuario puede iniciar sesión con Google para respaldar/sincronizar su `AppDatabase` en Firestore por `uid`, resolviendo conflictos por marca temporal (`updatedAt`).
  - *Por qué*: Garantiza privacidad y uso en sótanos de gimnasio sin señal, mientras cumple la necesidad de cambiar de teléfono sin perder historiales.

- **Decisión 4 — Resumen «Hoy» dentro del flujo actual sin 5.ª pestaña inferior**
  - *Enfoque elegido*: Mantener la barra inferior de 4 pestañas y ubicar «Hoy» como tarjeta/panel colapsable superior en la vista inicial (y accesible desde un botón rápido en cabecera/Entrenar).
  - *Por qué*: Preserva las proporciones táctiles móviles (`44px+`), evita aglomeración en pantallas de `375px` y mantiene el presupuesto de elementos fijos debajo del 15 %.

---

## 4. Technical Architecture & Data Strategy

### Diagrama de arquitectura del sistema

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                         CAPA DE PERSISTENCIA HÍBRIDA                      │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌──────────────────┐  │
│  │  pulsofit_db (IDB)   │  │ pulsofit_music_db   │  │ pulsofit_photos  │  │
│  │  + localStorage v1   │  │ (Audio Blobs + EQ)  │  │ (Blobs privados) │  │
│  └──────────┬───────────┘  └──────────┬──────────┘  └────────┬─────────┘  │
│             └─────────────────────────┼──────────────────────┘            │
│                                       ▼                                   │
│                 [ Sincronización Opcional Firebase Firestore ]            │
└───────────────────────────────────────┬───────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      NÚCLEO REACT + CONTROLADORES                         │
│  ┌─────────────────────────┐   ┌───────────────────────────────────────┐  │
│  │  Resumen "Hoy"          │   │  Motores de Hardware y Media          │  │
│  │  Readiness + Macros +   │   │  · Web Bluetooth (Báscula + HR 0x180D)│  │
│  │  Entreno del día        │   │  · Geolocation + WakeLock + Haptics   │  │
│  └─────────────────────────┘   │  · BarcodeDetector + OpenFoodFacts    │  │
│                                │  · Web Audio EQ + MediaSession        │  │
│  ┌──────────────┐ ┌──────────┐ └───────────────────────────────────────┘  │
│  │ Entrenar     │ │ Nutrición│ ┌───────────────────┐ ┌─────────────────┐  │
│  │ · Fuerza+SS  │ │ · Barras │ │ Progreso          │ │ Perfil          │  │
│  │ · Plantillas │ │ · Ayer   │ │ · 1RM / Volumen   │ │ · Unidades      │  │
│  │ · HIIT/Tabata│ │ · Menú IA│ │ · Medidas + Fotos │ │ · CSV / PDF     │  │
│  └──────┬───────┘ └────┬─────┘ └─────────┬─────────┘ │ · Nube / IA Key │  │
│         └──────────────┴─────────────────┴───────────┴────────┬────────┘  │
└───────────────────────────────────────────────────────────────┼───────────┘
                                                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                   SERVIDOR EXPRESS + GEMINI API (/api/*)                  │
│  · /api/workout/generate (con Readiness + Plantillas)                     │
│  · /api/nutrition/meal-plan (Menú semanal 7 días + Lista de compras)      │
│  · /api/food/barcode/:code (Proxy OpenFoodFacts seguro)                   │
│  · /api/scale/* & /api/nutrition/* (Existentes con respaldo local API Key)│
└───────────────────────────────────────────────────────────────────────────┘
```

### Modelo de datos extendido (100 % retrocompatible)

Todas las nuevas propiedades se añaden como campos opcionales en `AppDatabase` con valores por defecto seguros durante la normalización:

- **Entrenamiento**:
  - `WorkoutSet.setType?: 'warmup' | 'normal' | 'dropset' | 'failure'`
  - `WorkoutExercise.supersetGroupId?: string | null`
  - `WorkoutTemplate`: `{ id, name, focus, exercises[], createdAt, updatedAt }` almacenado en `workoutTemplates?: WorkoutTemplate[]`
  - `HiitSession`: historial/presets opcionales (`workSec`, `restSec`, `rounds`, `cycles`, `completedAt`, `caloriesBurned`)
- **Nutrición rápida y Menú**:
  - `FavoriteMeal`: `{ id, name, defaultMealType, items[], totalCalories, proteinG, carbsG, fatG }` en `favoriteMeals?: FavoriteMeal[]`
  - `WeeklyMealPlan`: `{ id, generatedAt, calorieTarget, days[], shoppingList[] }` en `weeklyMealPlan?: WeeklyMealPlan | null`
- **Progreso físico y Recuperación**:
  - `DailyReadinessEntry`: `{ date, sleepHours, sleepQuality, energyLevel, sorenessLevel, score, notes? }` en `readinessByDate?: Record<string, DailyReadinessEntry>`
  - `BodyMeasurementEntry`: `{ id, date, waistCm?, hipsCm?, chestCm?, armCm?, thighCm?, neckCm? }` en `bodyMeasurements?: BodyMeasurementEntry[]`
  - `ProgressPhotoMeta`: `{ id, date, pose: 'frente' | 'perfil' | 'espalda', weightKgAtCapture?, note? }` en `progressPhotos?: ProgressPhotoMeta[]` (con imagen guardada por `id` en `pulsofit_photos_db`)

### Mapeo interactivo y secuencia clave

1. **Sobrecarga progresiva y superseries**: Al iniciar una rutina o plantilla, el calculador de progresión inspecciona la última aparición del ejercicio en `workouts`. Si todas las series previas completaron las repeticiones meta con `rpe <= 8`, muestra la sugerencia accionable (`Aplicar +2.5 kg` o `+5 lb` según `weightUnit`). Las superseries agrupan tarjetas adyacentes con navegación rápida al siguiente ejercicio del bloque antes de disparar el descanso completo.
2. **Escaneo de código de barras y favoritos**: Al leer un código por cámara (`BarcodeDetector`) o teclado, la ruta `/api/food/barcode/:code` consulta OpenFoodFacts y devuelve los nutrientes por `100g` y por porción; el usuario ajusta gramos en la pantalla de revisión antes de añadirlo a `foodLogs` (y puede marcarlo como Favorito en 1 toque).
3. **Exportación CSV/PDF y Sincronización**: El generador CSV construye archivos UTF-8 con BOM para compatibilidad directa en Excel/Google Sheets; el reporte PDF abre una vista de impresión estilizada (`window.print()`) con métricas semanales limpias. La sincronización Firebase solo se activa cuando el usuario inicia sesión explícitamente desde Perfil, manteniendo su estado local intacto en todo momento.
