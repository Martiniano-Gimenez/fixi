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
- **Categoría (Cuadro de juego):** nombre (ej. "4ta", "6ta", "8va", "5ta Damas"), `ordenDomingo` (Int?, prioridad de arranque en domingo 1..N), estado (`BORRADOR` | `EN_CURSO` | `FINALIZADO`), torneoId → tiene múltiples `Parejas`, `Zonas`, `FasesEliminatorias` y `Partidos`.
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
- **Modo Día de Torneo y Reprogramación Dinámica por Cambio de Canchas ("Modo Lluvia"):**
  - Permite ajustar temporalmente las canchas activas del torneo (`Torneo.canchasDisponiblesOverride`), manteniendo `Club.cantidadCanchas` como techo físico real (`override <= club.cantidadCanchas`).
  - **Aislamiento Estricto por Día Lógico (Opción B):** La reprogramación (tanto en reducción como en restauración) opera exclusivamente sobre la jornada lógica en curso (`overrideDiaKey`), calculada a partir del momento de invocación con `getDiaCalendarioConTrasnoche`. Los partidos `PENDIENTE` de otras jornadas permanecen **100% inmutables** en horario y cancha asignada (se registran como ocupación fija `addInterval` en las timelines).
  - **Atomicidad Transaccional Todo-o-Nada (`prisma.$transaction`):** La ejecución del scheduler y la persistencia del nuevo estado del torneo (`canchasDisponiblesOverride` y `overrideActivoDesde`) se ejecutan en una transacción interactiva atómica `{ timeout: 15000, maxWait: 5000 }`, previniendo ventanas de inconsistencia ante caídas o reinicios. Se captura `overrideActivoDesde` en una variable local antes de cualquier escritura a la base de datos para blindar la restauración simétrica.
  - **Soporte Multi-Día Continuo y Determinismo por `diaKey`:** El frontend envía explícitamente el día de la solapa activa (`diaKey: activeTabDay`), permitiendo que el backend resuelva la fecha objetivo determinísticamente con `parseFechaLocal(diaKey)` sin depender del reloj del servidor (`new Date()`). En restauraciones se recupera el día de la jornada o el override previo. Si un torneo reduce canchas un viernes y luego se activa lluvia el sábado (incluso con la misma cantidad de canchas), el sistema detecta el cambio de día (`!esMismoDia`), actualiza limpiamente el override al sábado y reprograma únicamente los partidos del sábado.
  - **Validación de Partidos `EN_CURSO` Aislada por Jornada:** La verificación que impide reducir canchas si hay partidos en juego en las pistas a cerrar filtra exclusivamente por partidos de la jornada lógica bajo lluvia (`overrideDiaKey`), evitando bloqueos espurios por partidos colgados de días anteriores.
  - **Reprogramación Guiada 100% por Estado del Partido:** Los partidos `FINALIZADO` y `EN_CURSO` actúan como ocupación fija e inmutable en sus canchas y horarios específicos. Los partidos `PENDIENTE` con horario asignado de la jornada se reubican secuencialmente en las canchas activas ($1 \dots N$).
  - **Regla de Negocio de Emergencia (Sin Restricción de Disponibilidad de Pareja):** En Modo Lluvia **NO se filtra por la disponibilidad declarada por las parejas (`sharedWindows`)**. Al ser una contingencia operativa en vivo con los jugadores ya presentes en el club, la prioridad absoluta es que ningún partido quede sin jugar y que la jornada finalice lo más temprano posible. Los partidos se asignan en cualquier horario hábil del día lógico hasta el límite de trasnoche (`dayLimitMs`).
  - **Compactación Global Earliest-Fit con Cola Cronológica (FIFO):** Los partidos pendientes de la jornada se procesan en orden estricto de su horario original (`origStartMs` ASC $\rightarrow$ `origCancha` ASC $\rightarrow$ `id` ASC) para preservar la antigüedad del turno. En cada paso se evalúa toda la grilla de canchas activas ($1 \dots N$) y se selecciona el horario $T$ más temprano donde la cancha y ambas parejas estén libres.
  - **Reprogramación Bidireccional:** El algoritmo se ejecuta tanto al reducir canchas (compactando y demorando partidos en las canchas restantes) como al restaurarlas (adelantando partidos y redistribuyéndolos en las canchas liberadas).
  - **Backend como Única Fuente de Verdad (`overrideDiaKey`):** `getEstadoEnVivo` expone `overrideDiaKey` directamente en `torneo`, permitiendo que el frontend compare directamente (`activeTabDay === torneo.overrideDiaKey`) sin duplicar heurísticas ni depender de timezones locales.
  - **Slots de Trasnoche:** Los turnos de madrugada (`00:00` a `05:59`) se sitúan en la madrugada del día calendario siguiente (+1 día respecto al inicio de la jornada), garantizando una secuencia cronológica natural sin asignaciones erróneas al día anterior (Jueves).
  - **Filtrado Contextual de Canchas Fantasma:** Si existen partidos `PENDIENTE` asignados en canchas $> \text{canchasActivas}$, solo se reportan como "Canchas Fantasma" si pertenecen al día lógico bajo override. Los partidos de otras jornadas en canchas 5 o 6 se muestran con normalidad en su respectivo tab.
  - **Feedback Limpio y Contextual por Jornada:** El banner de resultados post-reprogramación solo se muestra en la solapa de la jornada afectada (`feedbackDiaKey` / `feedbackDiaNombre`). Al cerrarlo con la cruz (`X`), se descarta de forma permanente.
  - **Protección Temporal y Causal de Eliminatorias:**
    - Los partidos de eliminatorias sin horario asignado (`sinHorarioAsignado: true` o `fechaHora: null`, ej. dieciseisavos pendientes de asignación) quedan **expresamente excluidos** de la reprogramación automática de Modo Lluvia, manteniéndose en la sección de pendientes para su gestión manual controlada.
    - Para los partidos de eliminatorias con horario ya asignado (ej. dieciseisavos pautados el sábado a la tarde/noche), el scheduler impone un piso temporal estricto (`minSearchMs = Math.max(sessionDayStartMs, catZoneFloorMs, origStartMs)`): no pueden programarse antes de que termine el último partido de zona de su categoría (`catZoneFloorMs`), ni antes de su horario original ya fijado (`origStartMs`). Esto previene que al restaurar canchas (ej. de 4 a 6 canchas) las pistas liberadas provoquen un retroceso absurdo hacia la mañana (08:00 AM) de partidos de playoffs.

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
  - **Detección Automática y Asignación en 1 Clic:** Cuando finalizan todas las zonas de una categoría, la tarjeta se ilumina y destaca el botón *"Asignar Clasificados"*, poblando las parejas definitivas al cuadro existente, resolviendo BYEs y agendando la primera ronda del domingo.
  - **Orden de Prioridad del Domingo (`ordenDomingo` + `OrdenDomingoModal.jsx`):** Modal ágil accesible desde `TorneoDetail` y `TorneoEnVivo` con desplegables `1..N` para definir el orden de arranque de las categorías en domingo en cualquier momento del torneo (sin heurísticos frágiles ni esperar al fin de todas las zonas).
  - **Auto-Scheduling Liviano de Ronda 1 (Earliest-Fit Puro):** Servicio `eliminatoriaScheduler.service.js` que toma los partidos de Ronda 1 de domingo de las categorías listas en orden de `ordenDomingo ASC` y busca el primer slot y cancha libre dentro de la jornada (`domingoInicio` a `domingoFin`), validando colisiones de parejas y ocupación de canchas de todo el club. Si varias categorías entran en paralelo en canchas sobrantes, se aprovechan sin desperdicio.
  - **Tratamiento Diferenciado de Dieciseisavos (`esRondaDieciseisavos`):** Regla de negocio que estipula que dieciseisavos (`ronda >= 32`) se juegan sábado a la noche; sus partidos se crean con `sinHorarioAsignado: true` para asignación manual con `PartidosPendientesSection` integrada al pie de `TorneoEnVivo.jsx`. Las rondas menores (< 32) se auto-agendan para el domingo. En caso de contingencia por lluvia (Modo Lluvia), los dieciseisavos pendientes quedan protegidos sin ser auto-programados, y los que ya cuenten con horario asignado tienen garantizado que no retrocederán a la mañana al reabrir canchas.
- Numeración correlativa automática de parejas inscriptas: índice visual continuo (`#{index + 1}`) y re-secuenciación en base de datos al eliminar registros.
- Gestión manual de zonas post-sorteo (`ZoneEditorModal`).
- Carga y validación estricta de resultados y cálculo automático de tablas de posiciones.
- Fase eliminatoria por categoría con bracket SVG dinámico, manejo de BYEs, edición manual de cruces y propagación dinámica de orígenes.
- **Modelo de Fechas Determinista (`torneo.fecha` como Única Fuente de Verdad):** Los slots horarios de las parejas (ej. `"Viernes-18:00"`, `"Sabado-09:00"`) se convierten a fechas reales de forma 100% matemática y determinista a partir de `Torneo.fecha` (`parseFechaLocal` y `requireTorneoFecha`), sin depender del reloj del sistema (`new Date()`) ni requerir variables de simulación de fecha/hora.
- Sistema de diseño "Dark Premium Deportivo" aplicado globalmente con tokens semánticos e iconografía 100% vectorial con `lucide-react`.

## Reglas de trabajo
- Trabajar en ramas por feature (`feature/nombre-ticket`), nunca directo a main.
- Commits chicos y descriptivos (`feat:`, `fix:`, `chore:`, `docs:`).
- No agregar funcionalidad fuera del alcance definido sin confirmar antes.
- Priorizar código simple y legible por sobre optimizaciones prematuras.
- El 90% de los usuarios van a usar la app desde celular — priorizar mobile-first en cualquier UI nueva.
- Explicar brevemente cada decisión de arquitectura no trivial antes de implementarla.