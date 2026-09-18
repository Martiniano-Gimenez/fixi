# Contexto del proyecto — Pádel Torneos

## Qué es
App web de seguimiento de torneos de pádel amateur en tiempo real, para
organizadores que hoy llevan todo en papel.

## Usuarios
- Organizador: panel con login, configura el club, administra eventos de torneos y sus categorías (parejas, disponibilidad, zonas, partidos, eliminatorias) y resultados.
- Público: ve resultados, fixture y posiciones en tiempo real con selector de categorías vía link público (`/torneo/:slug`), sin cuenta ni login.

## Stack
- Frontend: React 19 + Vite + React Router v7, estado local con hooks
  (sin Redux ni Context API), Vanilla CSS (`index.css` con variables/tokens del sistema de diseño), `lucide-react` para iconografía vectorial consistente.
- Backend: Node.js + Express
- DB: SQLite + Prisma como ORM (preparado para migrar a Postgres/MySQL
  en producción sin cambios de código, gracias al ORM)
- Auth: JWT + bcryptjs

## Modelo de datos (resumen)
- **Organizador (Club):** nombre, email, passwordHash, `cantidadCanchas` (int), horarios de apertura (`viernesInicio`, `viernesFin`, `sabadoInicio`, `sabadoFin`, `domingoInicio`, `domingoFin` — strings "HH:MM", soportan turnos de trasnoche pasada la medianoche) → tiene múltiples `Torneos`.
- **Torneo (Evento):** nombre (ej. "Pares Agosto"), fecha, slug único (`slug`), estado (`BORRADOR` | `EN_CURSO` | `FINALIZADO`), `canchasDisponiblesOverride` (Int?), `overrideActivoDesde` (DateTime?), organizadorId → tiene múltiples `Categorías`.
- **Categoría (Cuadro de juego):** nombre (ej. "4ta", "6ta", "8va", "5ta Damas"), estado (`BORRADOR` | `EN_CURSO` | `FINALIZADO`), torneoId → tiene múltiples `Parejas`, `Zonas`, `FasesEliminatorias` y `Partidos`.
- **Pareja:** jugador1, jugador2, orden, `resolucionManual` (boolean, default false), categoriaId → tiene múltiples `SlotPareja` seleccionados.
- **SlotPareja:** relación única `(parejaId, slotId)` donde `slotId` es un string plano a intervalos de 15 minutos (ej. `"Viernes-18:00"`, `"Viernes-18:15"`, `"Viernes-00:15"`).
- **Zona:** categoriaId, nombre ("Zona A", "Zona B"), clasifican (int), formato (`ROUND_ROBIN` | `MINI_BRACKET`), requiereArmadoManual (boolean).
- **ZonaPareja:** tabla estadística por pareja en zona (posicion, pj, pg, pp, sf, sc, gf, gc, puntos).
- **FaseEliminatoria:** categoriaId, nombre ("Cuartos de Final", "Semifinal", "Final"), ronda (1=final, 2=semis, 4=cuartos, 8=octavos).
- **Partido:** categoriaId, zonaId?, faseEliminatoriaId?, posicionEnRonda, pareja1Id?, origenPareja1? (ej. "1°A"), pareja2Id?, origenPareja2? (ej. "2°B"), ganadorId?, estado (`PENDIENTE` | `EN_CURSO` | `FINALIZADO`), `fechaHora` (DateTime?), `canchaNumero` (Int?), `sinHorarioAsignado` (boolean).
- **SetPartido:** partidoId, numero (1, 2, 3), gamesPareja1, gamesPareja2.

## Constantes y Reglas del Dominio
- **Duración de Partido:** Fija en **75 minutos** (`DURACION_PARTIDO_MIN = 75`, constante en código, no configurable).
- **Granularidad de Disponibilidad:** Grilla a intervalos de **15 minutos** (`SLOT_GRANULARIDAD_MIN = 15`) para máxima precisión horaria sin pérdida de disponibilidad en la carga.
- **Reglas de Pádel en Resultados:** Mínimo 6 games para ganar set, diferencia de 2 en 6-5 (se permiten 7-5 / 7-6).
- **Mini-Bracket (Zonas de 4) y Programación Anticipada:**
  - 2 partidos iniciales de Ronda 1 (P1 vs P2, P3 vs P4) con parejas definidas al sortear.
  - 2 partidos definitorios de Ronda 2 ("Ganador vs Ganador" para 1°/2° puesto y "Perdedor vs Perdedor" para 3° puesto).
  - **Programación Anticipada con Intersección Cuádruple:** Los partidos 3 y 4 se programan con horario y cancha fija de antemano evaluando la **intersección simultánea de las 4 parejas de la zona** (`interseccionVentanas(P1, P2, P3, P4)`), garantizando que cualquier combinación de clasificados pueda jugar la definición.
  - **Regla Estricta de Clasificación en Mini-Bracket:**
    - 1°: Ganador de P3 (gana ambos partidos).
    - 2°: Perdedor de P3 (gana P1/P2 y pierde P3). Ambos clasificados al cuadro principal.
    - 3°: Ganador de P4 (pierde P1/P2 y gana P4).
    - 4°: Perdedor de P4 (pierde ambos partidos).
    Tanto el 2° como el 3° quedan con 3 puntos y 1 partido ganado. La función unificada `ordenarZonaParejas` ordena estrictamente por `posicion ASC` (`1 -> 2 -> 3 -> 4`) en `MINI_BRACKET` (evitando que el 3° usurpe la clasificación del 2°), mientras que en `ROUND_ROBIN` aplica el desempate reglamentario (puntos, PG, dif sets, dif games, GF).
  - **Dependencia Temporal Estricta:** El scheduler procesa primero la Ronda 1 y exige que $\text{Inicio}(P3/P4) \ge \max(\text{Fin}(P1), \text{Fin}(P2))$, permitiendo que P3 y P4 se jueguen en simultáneo en dos canchas distintas o en turnos contiguos. El orden en la tabla se fija mediante el campo explícito `posicion`.
- **Compatibilidad Horaria:** Las parejas cargan disponibilidad en rangos horarios (slots de 15 min) que se fusionan en ventanas continuas. La compatibilidad se calcula como la intersección de ventanas continuas entre parejas. *(Nota importante: En Modo Lluvia / contingencia operativa en vivo, esta restricción queda expresamente suspendida para compactar la jornada lo máximo posible con las canchas restantes; ver detalle en Modo Día de Torneo).*
- **Jerarquía de Certeza y Resolución de Conflictos:** El ranking de opciones de resolución (previo y posterior al inicio) prioriza la certeza por sobre el esfuerzo nominal:
  1. *Certeza:* 0 partes que estiran (Estrella mutua) $\rightarrow$ 1 parte que estira (Estrella clásica / 1 sola llamada confirmatoria) $\rightarrow$ 2 partes que estiran (Casi-estrella doble).
  2. *Esfuerzo:* Menor distancia combinada absoluta en minutos (`distTotal`).
  3. *Balance:* Menor diferencia de estiramiento entre parejas.
  4. *Cronológico:* Viernes antes que Sábado, hora menor a mayor.
- **Ajuste Horario con Dirección y Formato Amigable:** Las distancias a la disponibilidad original se calculan con signo: negativo ($-Nm$) si la pareja debe arrancar antes del bloque más cercano, y positivo ($+Nm$) si debe extenderse después. Valores $\ge 60\text{ min}$ se formatean en horas (ej. `+1h`, `+1h 35m`, `-2h`).
- **Scheduler Continuo con Prioridad de Tres Pasadas y Dependencia Mini-Bracket (Pool Multi-Categoría a nivel Torneo):** Cada cancha gestiona su propia línea de tiempo ordenada de intervalos ocupados. La asignación se realiza en dos fases:
  - *Fase 1 (Partidos Base - MCF 3 Pasadas):*
    - *Pasada 0 (Máxima Prioridad - `resolucionManual: true`):* Asigna primero los partidos donde al menos una pareja fue destrabada manualmente en `CruceResolver`, ordenados por heurística MCF (`numOptions`), garantizando que ocupen sus turnos confirmados.
    - *Pasada 1 Global:* Asigna en horarios de grilla estándar todos los partidos hiper-restringidos de todas las categorías (1 sola opción día+franja válida).
    - *Pasada 2 Global:* Asigna todos los partidos flexibles en una cola ordenada por escasez de opciones (MCF Global), utilizando turnos estándar o huecos continuos de 15 min.
  - *Fase 2 (Partidos Derivados - Mini-Bracket Ronda 2):* Se ejecutan únicamente tras confirmar los horarios de P1 y P2 de cada zona, asignando P3 y P4 sobre la intersección cuádruple post-Ronda 1.
- **Asignación Determinística de Cancha:** La asignación automática de cancha se realiza siempre por orden numérico ascendente (Cancha 1 $\rightarrow$ Cancha 2 $\rightarrow$ ... $\rightarrow$ Cancha N) seleccionando la primera disponible en la franja.
- **Prioridad de Scheduling ("Most Constrained First"):** Partidos y categorías se ordenan de menor a mayor cantidad de combinaciones día+franja válidas compartidas, reservando los recursos más escasos para los cruces con menos alternativas.
- **Modo Día de Torneo y Reprogramación Dinámica por Cambio de Canchas ("Modo Lluvia Independiente por Día"):**
  - Permite ajustar temporalmente las canchas activas del torneo de forma **100% independiente para cada jornada (Viernes, Sábado y Domingo)**, manteniendo `Club.cantidadCanchas` como techo físico real (`override <= club.cantidadCanchas`).
  - **Servicio Desacoplado de Overrides (`canchasOverrides.service.js`):** Gestiona los overrides por día (`diaKey`) en cache en memoria con persistencia en `backend/src/data/canchasOverrides.json`, sincronizando `Torneo.canchasDisponiblesOverride` para retrocompatibilidad. `getEstadoEnVivo` expone `canchasPorDia: { [diaKey]: { canchas, isLluvia, activoDesde } }`.
  - **Aislamiento Estricto por Día Lógico (Opción B):** La reprogramación opera exclusivamente sobre la jornada lógica en curso (`diaKey`), calculada a partir de `parseFechaLocal(diaKey)` o el momento de invocación con `getDiaCalendarioConTrasnoche`. Los partidos de otras jornadas permanecen **100% inmutables** en horario y cancha asignada.
  - **Delegación a Scheduler de Eliminatorias en Domingo:** Si la reducción de canchas ocurre en Domingo (jornada exclusiva de playoffs), el sistema delega directamente en `programarHorariosEliminatorias` pasando el parámetro `canchasOverride`. Esto reacomoda todas las rondas dominicales en las canchas reducidas respetando partidos en curso/finalizados y preservando los descansos de 75 min y round-blocks.
  - **Atomicidad Transaccional Todo-o-Nada (`prisma.$transaction`):** La ejecución del scheduler y la persistencia del nuevo estado del torneo se ejecutan en una transacción interactiva atómica `{ timeout: 15000, maxWait: 5000 }`, previniendo inconsistencias.
  - **Validación de Partidos `EN_CURSO` Aislada por Jornada:** La verificación que impide reducir canchas si hay partidos en juego en las pistas a cerrar filtra exclusivamente por partidos de la jornada lógica bajo lluvia (`overrideDiaKey`), evitando bloqueos espurios por partidos de otros días.
  - **Reprogramación Guiada 100% por Estado del Partido:** Los partidos `FINALIZADO` y `EN_CURSO` actúan como ocupación fija e inmutable. Los partidos `PENDIENTE` de la jornada se reubican secuencialmente en las canchas activas ($1 \dots N$).
  - **Regla de Negocio de Emergencia (Sin Restricción de Disponibilidad de Pareja en Zonas):** En contingencia en vivo de zonas, la prioridad es jugar todos los partidos antes del límite de trasnoche (`dayLimitMs`).
  - **Compactación Global Earliest-Fit con Cola Cronológica (FIFO):** Los partidos pendientes de la jornada se procesan en orden estricto de su horario original (`origStartMs` ASC $\rightarrow$ `origCancha` ASC $\rightarrow$ `id` ASC) para preservar la antigüedad del turno.
  - **Reprogramación Bidireccional:** El algoritmo se ejecuta tanto al reducir canchas (compactando en las canchas restantes) como al restaurarlas (adelantando partidos en las canchas liberadas).
  - **Slots de Trasnoche:** Los turnos de madrugada (`00:00` a `05:59`) se sitúan en la madrugada del día calendario siguiente (+1 día respecto al inicio de la jornada), garantizando una secuencia cronológica natural.
  - **Filtrado Contextual de Canchas Fantasma:** Solo se reportan como "Canchas Fantasma" partidos `PENDIENTE` en canchas $> \text{canchasActivas}$ del día específico bajo lluvia.
  - **Feedback Limpio y Contextual por Jornada:** El banner de resultados post-reprogramación solo se muestra en la solapa de la jornada afectada (`feedbackDiaKey` / `feedbackDiaNombre`).
  - **Protección Temporal y Causal de Eliminatorias en Sábado:**
    - Los partidos de eliminatorias sin horario asignado quedan excluidos de la reprogramación automática.
    - Para los dieciseisavos de sábado noche con horario ya fijado, se impone un piso temporal estricto (`minSearchMs = Math.max(sessionDayStartMs, catZoneFloorMs, origStartMs)`): no pueden programarse antes del fin de zonas de su categoría ni antes de su horario original, impidiendo retrocesos absurdos a la mañana al reabrir canchas.

## Funcionalidades implementadas
- Jerarquía completa: Club $\rightarrow$ Torneo (Evento) $\rightarrow$ Categorías $\rightarrow$ Parejas/Zonas/Partidos/Eliminatorias.
- CRUD completo de torneos y categorías (crear, editar nombre/fecha vía modal interactivo, eliminar y reiniciar a borrador, reseteando flags de `resolucionManual` en `Pareja`, overrides de lluvia `canchasDisponiblesOverride`/`overrideActivoDesde` en `Torneo` y eliminando sesiones activas de pre-check).
- Gestión de Club / Organizador (`/admin/club`): edición de canchas totales y horarios de apertura con advertencia de impacto.
- Carga de disponibilidad por pareja mediante **Slider de Rango Horario dual (15 min)** (`RangeSliderDia`, `RangeSliderGroup` y `DisponibilidadEditor`): selectores de manijas desde-hasta con snap de 15 min, soporte para múltiples rangos independientes por día (gaps/huecos en el medio), indicador de trasnoche y algoritmo de reconstrucción con expansión de slots de 75 min previos a ventanas continuas completas.
- Generación de zonas por sorteo aleatorio (Fisher-Yates) o por compatibilidad horaria por categoría.
- Asignación automática continua de horarios y canchas a nivel Torneo ("Iniciar Torneo y Asignar Horarios") con pool multi-categoría, detección de huecos, pre-verificación de compatibilidad (dry-run transaccional) y bloqueo ante solapamientos.
- **Asistente de Resolución de Cruces en Pre-Check (`CruceResolver` y Modal de Bloqueo con Snapshot Estable):**
  - **Zonas y Asignaciones Congeladas:** El primer dry-run de pre-check genera un snapshot en memoria (`preCheckSessions`) donde la distribución de zonas y los partidos previamente asignados quedan **100% inmutables**.
  - **Detección Automática de Cambios en Parejas (`parejaIdsHash`):** Si el organizador agrega o elimina parejas de una categoría con un snapshot de pre-check activo, el sistema detecta la mutación de la nómina y re-genera automáticamente el sorteo para evitar inconsistencias.
  - **Resolución Incremental Monótona:** Cada resolución de cruce (`CruceResolver` o edición manual con 1-click auto-save) evalúa los partidos pendientes en los huecos libres restantes del timeline de canchas sin re-ejecutar las 3 pasadas globales sobre partidos ya resueltos, garantizando que el contador de conflictos disminuya estrictamente ($N \rightarrow N-1 \rightarrow 0$) y que ningún partido previo pierda su turno ni cambie de cancha.
  - **Sliding TTL (Touch-on-access) y Resiliencia:** Sesión con expiración renovable de 60 minutos con cada acción. Si el usuario cierra el modal y regresa, el progreso se mantiene intacto. En caso de reinicio de servidor, se notifica explícitamente (`sesionReiniciada`).
  - **Re-sorteo Explícito:** Botón y modal de advertencia pedagógica para *"Re-sortear zonas desde cero"* (`forceReset: true`) cuando el organizador desee barajar el torneo desde cero voluntariamente.
  - **Resolución en 1 click y Deshacer (Undo):** Identificación automática de Hero Option y casi-estrellas, actualización atómica doble (`setDisponibilidadDoble`) y toast flotante de deshacer por 7s (`removerDisponibilidadDoble`). Auto-guardado en 1 click para chips estrella en `InlineDisponibilidadEditor`.
- Salida de emergencia condicional y gestión de partidos sin horario (`PartidosPendientesSection`): acordeón categorizado con filtrado en tiempo real que evalúa canchas libres antes de renderizar insignias de estrella (`★`), diferenciando cruces con turnos compatibles libres de cruces con horarios originales saturados.
- **Asignar Horario Post-Inicio con Experiencia Unificada (`AsignarHorarioModal` + `rankingSlots`):** Presentación de sugerencia Hero recomendada y alternativas ordenadas por cercanía a lo declarado originalmente. Escritura directa a `Partido` (`fechaHora` + `canchaNumero`) sin contaminar `SlotPareja`, asignación en **1 click** a la primera cancha libre y grilla desplegable completa de turnos viables del club.
- Reprogramación de horarios de partidos asignados (`AsignarHorarioModal`): escritura atómica segura que excluye la ocupación anterior del propio partido al validar disponibilidad (`ignorePartidoId`), permitiendo reasignaciones limpias sin colisiones.
- **Modo Día de Torneo — En Vivo (`TorneoEnVivo.jsx`, `/admin/torneos/:id/en-vivo`):**
  - Panel operativo centralizado para el día del evento con foco directo en partidos activos y próximos en el primer viewport (sin grilla redundante de canchas individuales).
  - Barra de control de Modo Lluvia integrada en el flujo natural del documento (no-sticky) para evitar superposiciones al scrollear.
  - **Contador y Stepper Contextual por Solapa:** El contador (`4/6` vs `6/6`) y el selector `[ - X + ]` se sincronizan reactivamente con las canchas habilitadas en la solapa seleccionada (`canchasActivasContextuales`), protegiendo la selección del usuario contra sobrescrituras por polling de fondo (`userTouchedTarget`). En solapas sin lluvia el stepper arranca en el total del club y el botón "Restaurar todas" se oculta automáticamente.
  - Stepper numérico con posicionamiento estable tanto en desktop como en mobile (`@media (max-width: 640px)`): los botones de confirmación se despliegan a la izquierda manteniendo inmóvil el punto de clic/toque táctil para ajustes sucesivos.
  - Alerta destacada para partidos en canchas fantasma filtrada contextualmente a la jornada bajo lluvia.
  - **Próximos Partidos Separados por Tabs de Día:** Pestañas dinámicas (`Viernes 28 | Sábado 29`) calculadas con la lógica de trasnoche real del club, con selección inteligente por defecto del primer día con partidos disponibles.
  - **Cambio Rápido de Estado a "EN_CURSO" y "PENDIENTE" (1-Click):**
    - Botón `Play` (`▶`) en cada tarjeta de "Próximos Partidos" para iniciar partidos al instante sin necesidad de cargar un set previo (vía `PATCH /api/partidos/:id/estado`).
    - Botón `Revertir` (`RotateCcw`) en "Partidos en Juego" para devolver a `PENDIENTE` ante clics accidentales (limpiando sets parciales).
    - Actualización reactiva instantánea y re-fetch inmediato (`fetchAndResetPolling`).
  - **Carga Rápida de Resultados:** Botón de acción directa (`ClipboardList`) en cada partido para abrir `ResultadoModal` en 1 clic y recalcular tablas sin salir de la vista operativa.
  - **Acordeón de Partidos Finalizados:** Sección colapsable que lista los partidos finalizados con sets/games visibles, pareja ganadora destacada en verde, ordenados de más reciente a más antiguo (DESC), con edición/borrado de resultado.
  - **Polling Inteligente con Reset:** Actualización reactiva cada 30s con reseteo inmediato del timer (`intervalRef`) ante cambios manuales o de override, evitando solapamientos o parpadeos.
- **Edición Rápida del Nombre del Torneo (`TorneoDetail.jsx`):** Edición inline directa sobre el título del evento con icono discreto de lápiz (`Edit2`), foco y selección automática, guardado reactivo con feedback inmediato, soporte para teclado (<kbd>Enter</kbd> / <kbd>Escape</kbd>) y acceso alternativo mediante botón de cabecera.
- **Continuidad de Día de Torneo y Asignación de Cruces (`TorneoEnVivo.jsx`):**
  - **Generación Automática de Brackets Vacíos al Iniciar Torneo:** Al iniciar el torneo (`iniciarTorneoMultiCategoria`), el backend crea automáticamente el árbol eliminatorio para cada categoría con sus llaves visuales y etiquetas de origen ("1° Zona A" vs "2° Zona B", BYEs correspondientes) con parejas vacías (`parejaId: null`). Esto permite visualizar el cuadro completo desde el arranque tanto en el panel como en la vista pública.
  - **Monitoreo Permanente de Brackets en Día de Torneo:** Sección destacada *"Cuadros Eliminatorios (Brackets)"* en `TorneoEnVivo.jsx` con tarjetas por categoría que exhiben en tiempo real el estado (`ESPERANDO_ZONAS`, `LISTA_PARA_ASIGNAR`, `EN_CURSO`, `FINALIZADA`), progreso de zonas, orden de domingo y botón directo *"Ver Bracket"* (`/admin/torneos/:id/categorias/:catId/eliminatoria`).
  - **Navegación Fluida:** Botón de retorno directo *"🏟️ Ir a Día de Torneo"* en la cabecera de `EliminatoriaView.jsx` y botón *"Vista Pública"* en la cabecera de `TorneoEnVivo.jsx`.
  - **Detección Automática y Asignación en 1 Clic:** Cuando finalizan todas las zonas de una categoría, la tarjeta se ilumina y destaca el botón *"Asignar Clasificados"*, poblando las parejas definitivas al cuadro existente y resolviendo BYEs sin alterar el cronograma ya pautado.
  - **Prioridad Automática del Domingo por Clasificados:** La prioridad de las categorías en domingo se calcula de forma 100% automática y objetiva según la cantidad de parejas clasificadas a eliminatorias (`cantidadParejasClasificadas DESC`, suma de `zona.clasifican` por categoría, con desempate alfabético). El scheduler lo resuelve de manera autónoma sin requerir configuración manual, asegurando un criterio transparente y sin sesgos subjetivos.
  - **Scheduling Completo de Playoffs al Iniciar Torneo (`eliminatoriaScheduler.service.js`):**
    - Al iniciar el torneo se auto-asignan fecha, hora y cancha para el **100% de los cruces de todas las categorías (Dieciseisavos a Finales)**.
    - **Dieciseisavos (`ronda >= 32`):** Se programan el **Sábado por la tardecita/noche** (20:45 en adelante o post-cierre de zonas).
    - **Sincronización Universal por Ronda Decreciente en Domingo (`[16, 8, 4, 2]`):** Todas las categorías disputan primero sus Octavos (08:00 a 13:00), luego sus Cuartos (11:45 a 16:45), luego sus Semifinales en bloque (15:30 a 18:00) y finalmente sus Finales (18:00 a 21:45).
    - **Priorización de Debut en Cuartos de Final:** En Cuartos (`rondaTarget === 8`), las categorías que arrancan de cero ese día (sin Octavos matutinos, ej. cuadros de 8 parejas como Suma 7) se ordenan prioritariamente para agendarse primero con `targetEarliestMs = domDayStartMs + 3 * DURACION_MS` (11:45hs en clubes que inician a las 08:00). Al debutar en el primer turno disponible al mediodía en bloque unificado, aprovechan canchas libres matutinas, no saturan los turnos de la tarde con las categorías que vienen de Octavos (5ta y 7ma) y disponen de más de 3h 45m de descanso/almuerzo antes de sus Semifinales (16:45hs). El backfill protege estrictamente estos bloques unificados (`rondaTarget < 16`) para no fraccionar los cruces de Cuartos.
    - **Descansos Humanos y Round-Block Garantizados:** Turnos exactos de 75 min alineados a la apertura del club (`DURACION_MS`). Descansos de $\ge 75$ min entre rondas (1 turno completo libre de juego), 30 a 45 min previos a la final, y buffer de cierre nocturno (+150 min) para garantizar que el 100% de los campeonatos coronen con cancha asignada. Los BYEs no consumen canchas.
- Numeración correlativa automática de parejas inscriptas: índice visual continuo (`#{index + 1}`) y re-secuenciación en base de datos al eliminar registros.
- Gestión manual de zonas post-sorteo (`ZoneEditorModal`).
- Carga y validación estricta de resultados y cálculo automático de tablas de posiciones.
- Fase eliminatoria por categoría con bracket SVG dinámico, manejo de BYEs, edición manual de cruces y propagación dinámica de orígenes.
- **Modelo de Fechas Determinista (`torneo.fecha` como Única Fuente de Verdad):** Los slots horarios de las parejas (ej. `"Viernes-18:00"`, `"Sabado-09:00"`) se convierten a fechas reales de forma 100% matemática y determinista a partir de `Torneo.fecha` (`parseFechaLocal` y `requireTorneoFecha`), sin depender del reloj del sistema (`new Date()`) ni requerir variables de simulación de fecha/hora.
- **Refactor UI/UX y Jerarquía Visual en Detalle de Torneo (`TorneoDetail.jsx`):**
  - **Mapeo de Estados Legibles (`estadoLabels.js`):** Traducción de enums de Prisma (`BORRADOR`, `EN_CURSO`, `FINALIZADO`) a formato legible en sentence case ("Borrador", "En curso", "Finalizado") sin forzar transformaciones mayúsculas en CSS (`.badge`).
  - **Regla de CTA Único Primario:** Unificación de acciones de cabecera con un único botón primario sólido (`btn-primary`, ej. *"Día de Torneo"* o *"Iniciar Torneo"*), acciones secundarias neutras en estilo ghost (`btn-ghost`) y confinamiento de la acción destructiva *"Reiniciar Torneo"* a un menú overflow desplegable (`⋮`, `MoreVertical`) con click-outside y toque táctil seguro.
  - **Reducción de Ruido Visual en Categorías:** El chip de estado de la categoría se oculta si coincide con el estado global del torneo (`cat.estado !== torneo.estado`), reservando el badge verde únicamente para discrepancias relevantes. El botón destructivo de eliminar categoría permanece invisible (opacidad 0) hasta que el cursor hace hover o el foco de teclado entra a la tarjeta (`:focus-within` y mobile touch fallback), estandarizando su hit-area con borde sutil consistente.
  - **Estilo Outline y Micro-Progreso:** Botón *"Administrar"* estilizado en outline (`.btn-outline`) con saturación y borde verde desaturados para no rivalizar con el badge de estado ni con el CTA primario. Incorporación de mini barra de progreso deportiva (`.progress-bar-mini`, 4px verde esmeralda con glow) unida a la métrica de partidos jugados.
  - **Accesibilidad Global (`:focus-visible`):** Contorno de navegación por teclado accesible y visible sin alterar clics de mouse.
- **Blindaje y Soporte Dual de Vista Pública (`/torneo/:slug` y `/torneos/:slug`):**
  - Enrutamiento dual en `App.jsx` que atiende indistintamente rutas en singular o plural, evitando pantallas en blanco por errores tipográficos o enlaces compartidos desde *"Día de Torneo"*.
  - Inclusión de estilos de cuadros eliminatorios (`EliminatoriaView.css`) en `TorneoPublic.jsx`, garantizando que llaves, columnas y tarjetas se rendericen con su diseño premium completo en cualquier pestaña nueva o ventana privada.
  - Fallback visual para categorías vacías sin zonas ni eliminatorias y unificación de navegación vía `<Link>`.
- Sistema de diseño "Dark Premium Deportivo" aplicado globalmente con tokens semánticos e iconografía 100% vectorial con `lucide-react`.

## Reglas de trabajo
- Trabajar en ramas por feature (`feature/nombre-ticket`), nunca directo a main.
- Commits chicos y descriptivos (`feat:`, `fix:`, `chore:`, `docs:`).
- No agregar funcionalidad fuera del alcance definido sin confirmar antes.
- Priorizar código simple y legible por sobre optimizaciones prematuras.
- El 90% de los usuarios van a usar la app desde celular — priorizar mobile-first en cualquier UI nueva.
- Explicar brevemente cada decisión de arquitectura no trivial antes de implementarla.