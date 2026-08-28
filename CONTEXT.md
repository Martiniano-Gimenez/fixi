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
- **Organizador (Club):** nombre, email, passwordHash, `cantidadCanchas` (int), horarios de apertura (`viernesInicio`, `viernesFin`, `sabadoInicio`, `sabadoFin` — strings "HH:MM", soportan turnos de trasnoche pasada la medianoche) → tiene múltiples `Torneos`.
- **Torneo (Evento):** nombre (ej. "Pares Agosto"), fecha, slug único (`slug`), estado (`BORRADOR` | `EN_CURSO` | `FINALIZADO`), `canchasDisponiblesOverride` (Int?), `overrideActivoDesde` (DateTime?), organizadorId → tiene múltiples `Categorías`.
- **Categoría (Cuadro de juego):** nombre (ej. "4ta", "6ta", "8va", "5ta Damas"), estado (`BORRADOR` | `EN_CURSO` | `FINALIZADO`), torneoId → tiene múltiples `Parejas`, `Zonas`, `FasesEliminatorias` y `Partidos`.
- **Pareja:** jugador1, jugador2, orden, categoriaId → tiene múltiples `SlotPareja` seleccionados.
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
- **Mini-Bracket (Zonas de 4):** 2 partidos iniciales (P1 vs P2, P3 vs P4) y 2 definitorios ("Ganador vs Ganador" para 1°/2° puesto y "Perdedor vs Perdedor" para 3° puesto). El orden se fija mediante el campo explícito `posicion`.
- **Compatibilidad Horaria:** Las parejas cargan disponibilidad en rangos horarios (slots de 15 min) que se fusionan en ventanas continuas. La compatibilidad se calcula como la intersección de ventanas continuas entre parejas.
- **Jerarquía de Certeza y Resolución de Conflictos:** El ranking de opciones de resolución (previo y posterior al inicio) prioriza la certeza por sobre el esfuerzo nominal:
  1. *Certeza:* 0 partes que estiran (Estrella mutua) $\rightarrow$ 1 parte que estira (Estrella clásica / 1 sola llamada confirmatoria) $\rightarrow$ 2 partes que estiran (Casi-estrella doble).
  2. *Esfuerzo:* Menor distancia combinada absoluta en minutos (`distTotal`).
  3. *Balance:* Menor diferencia de estiramiento entre parejas.
  4. *Cronológico:* Viernes antes que Sábado, hora menor a mayor.
- **Ajuste Horario con Dirección y Formato Amigable:** Las distancias a la disponibilidad original se calculan con signo: negativo ($-Nm$) si la pareja debe arrancar antes del bloque más cercano, y positivo ($+Nm$) si debe extenderse después. Valores $\ge 60\text{ min}$ se formatean en horas (ej. `+1h`, `+1h 35m`, `-2h`).
- **Scheduler Continuo en Dos Pasadas con Pool Multi-Categoría a nivel Torneo:** Cada cancha gestiona su propia línea de tiempo ordenada de intervalos ocupados (partidos del club de todas las categorías). La asignación masiva se realiza en dos fases para optimizar turnos:
  - *Pasada 1 Global:* Asigna primero en horarios de grilla estándar todos los partidos hiper-restringidos de todas las categorías juntas (1 sola opción día+franja válida).
  - *Pasada 2 Global:* Asigna todos los partidos flexibles de todas las categorías en una sola cola ordenada por escasez de opciones (MCF Global), pudiendo usar tanto turnos estándar como huecos irregulares de 15 min en cualquier cancha.
- **Asignación Determinística de Cancha:** La asignación automática de cancha se realiza siempre por orden numérico ascendente (Cancha 1 $\rightarrow$ Cancha 2 $\rightarrow$ ... $\rightarrow$ Cancha N) seleccionando la primera disponible en la franja.
- **Prioridad de Scheduling ("Most Constrained First"):** Partidos y categorías se ordenan de menor a mayor cantidad de combinaciones día+franja válidas compartidas, reservando los recursos más escasos para los cruces con menos alternativas.
- **Modo Día de Torneo y Reprogramación Dinámica por Reducción de Canchas ("Modo Lluvia"):**
  - Permite ajustar temporalmente las canchas activas del torneo (`Torneo.canchasDisponiblesOverride`), manteniendo `Club.cantidadCanchas` como techo físico real (`override <= club.cantidadCanchas`).
  - Al reducir canchas, se registra `overrideActivoDesde = ahora` y se reprograman de forma cronológica y atómica todos los partidos en estado `PENDIENTE` con `fechaHora > overrideActivoDesde` (incluyendo eliminatorias pendientes con horario).
  - **Jornada extendida en modo lluvia:** Durante la reprogramación de emergencia por lluvia, el horario de cierre del club NO corta la búsqueda (los partidos pueden extenderse pasada la medianoche para completar la fecha del día), pero el cambio de fecha calendario sí interrumpe la búsqueda para no mezclar días.
  - **Bloqueo y Canchas Fantasma:** Si existen partidos `EN_CURSO` en canchas que se desean inhabilitar, la reducción se bloquea con error 400. Si existen partidos `PENDIENTE` con horario anterior al override que quedaron asignados en canchas $> \text{canchasActivas}$, se reportan como "Canchas Fantasma" con alerta visible en la vista en vivo para resolución manual.
  - Al restaurar canchas (`override = null`), se vuelven a habilitar todas las canchas del club sin mover automáticamente los partidos ya jugados o reprogramados.

## Funcionalidades implementadas
- Jerarquía completa: Club $\rightarrow$ Torneo (Evento) $\rightarrow$ Categorías $\rightarrow$ Parejas/Zonas/Partidos/Eliminatorias.
- CRUD completo de torneos y categorías (crear, editar, eliminar y reiniciar a borrador).
- Gestión de Club / Organizador (`/admin/club`): edición de canchas totales y horarios de apertura con advertencia de impacto.
- Carga de disponibilidad por pareja mediante **Slider de Rango Horario dual (15 min)** (`RangeSliderDia`, `RangeSliderGroup` y `DisponibilidadEditor`): selectores de manijas desde-hasta con snap de 15 min, soporte para múltiples rangos independientes por día (gaps/huecos en el medio), indicador de trasnoche y algoritmo de reconstrucción con expansión de slots de 75 min previos a ventanas continuas completas.
- Generación de zonas por sorteo aleatorio (Fisher-Yates) o por compatibilidad horaria por categoría.
- Asignación automática continua de horarios y canchas a nivel Torneo ("Iniciar Torneo y Asignar Horarios") con pool multi-categoría, detección de huecos, pre-verificación de compatibilidad (dry-run transaccional) y bloqueo ante solapamientos.
- **Asistente de Resolución de Cruces en Pre-Check (`CruceResolver` y Modal de Bloqueo):** Acordeón colapsable por categoría con apertura automática inteligente de la categoría más urgente (orden en 4 niveles). Identificación automática de la mejor opción Hero y alternativas ordenadas por certeza de resolución. Muestra el esfuerzo individual con dirección ($+/-$) y formato en horas. Resolución en **1 click** mediante actualización atómica doble (`setDisponibilidadDoble`) y toast flotante de **Deshacer (Undo)** por 7s con eliminación precisa de delta (`removerDisponibilidadDoble`).
- Salida de emergencia condicional y gestión de partidos sin horario (`PartidosPendientesSection`): acordeón categorizado con filtrado en tiempo real que evalúa canchas libres antes de renderizar insignias de estrella (`★`), diferenciando cruces con turnos compatibles libres de cruces con horarios originales saturados.
- **Asignar Horario Post-Inicio con Experiencia Unificada (`AsignarHorarioModal` + `rankingSlots`):** Presentación de sugerencia Hero recomendada y alternativas ordenadas por cercanía a lo declarado originalmente. Escritura directa a `Partido` (`fechaHora` + `canchaNumero`) sin contaminar `SlotPareja`, asignación en **1 click** a la primera cancha libre y grilla desplegable completa de turnos viables del club.
- Reprogramación de horarios de partidos asignados (`AsignarHorarioModal`): escritura atómica segura que excluye la ocupación anterior del propio partido al validar disponibilidad (`ignorePartidoId`), permitiendo reasignaciones limpias sin colisiones.
- **Modo Día de Torneo — En Vivo (`TorneoEnVivo.jsx`, `/admin/torneos/:id/en-vivo`):**
  - Panel operativo centralizado para el día del evento con grilla visual de canchas en tiempo real (Libre, En Juego, Inhabilitada).
  - Barra de control de Modo Lluvia (reducir/restaurar canchas activas) con feedback descriptivo de partidos corridos y minutos de delta.
  - Alerta destacada para partidos en canchas fantasma con acceso a reprogramación manual.
  - Tarjetas de "Partidos en Juego" y "Próximos Partidos" cronológicos.
  - **Carga Rápida de Resultados:** Botón de acción directa (`ClipboardList`) en cada partido próximo para abrir `ResultadoModal` en 1 clic y recalcular tablas sin salir de la vista operativa.
  - **Acordeón de Partidos Finalizados:** Sección colapsable que lista los partidos finalizados con sets/games visibles, ordenados de más reciente a más antiguo (DESC), con edición/borrado de resultado.
  - **Polling Inteligente con Reset:** Actualización reactiva cada 30s con reseteo inmediato del timer (`intervalRef`) ante cambios manuales o de override, evitando solapamientos o parpadeos.
- Numeración correlativa automática de parejas inscriptas: índice visual continuo (`#{index + 1}`) y re-secuenciación en base de datos al eliminar registros.
- Gestión manual de zonas post-sorteo (`ZoneEditorModal`).
- Carga y validación estricta de resultados y cálculo automático de tablas de posiciones.
- Fase eliminatoria por categoría con bracket SVG dinámico, manejo de BYEs, edición manual de cruces y propagación dinámica de orígenes.
- Vista pública (`/torneo/:slug`) con selector interactivo de Categorías y polling en vivo cada 15s.
- Sistema de diseño "Dark Premium Deportivo" aplicado globalmente con tokens semánticos e iconografía 100% vectorial con `lucide-react`.

## Reglas de trabajo
- Trabajar en ramas por feature (`feature/nombre-ticket`), nunca directo a main.
- Commits chicos y descriptivos (`feat:`, `fix:`, `chore:`, `docs:`).
- No agregar funcionalidad fuera del alcance definido sin confirmar antes.
- Priorizar código simple y legible por sobre optimizaciones prematuras.
- El 90% de los usuarios van a usar la app desde celular — priorizar mobile-first en cualquier UI nueva.
- Explicar brevemente cada decisión de arquitectura no trivial antes de implementarla.