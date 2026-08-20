# Contexto del proyecto — Pádel Torneos

## Qué es
App web de seguimiento de torneos de pádel amateur en tiempo real, para
organizadores que hoy llevan todo en papel.

## Usuarios
- Organizador: panel con login, configura el club, carga torneos/parejas/disponibilidad y resultados.
- Público: ve resultados, fixture y posiciones en tiempo real vía link público (`/torneo/:slug`), sin cuenta ni login.

## Stack
- Frontend: React 19 + Vite + React Router v7, estado local con hooks
  (sin Redux ni Context API), Vanilla CSS (`index.css` con variables/tokens del sistema de diseño), `lucide-react` para iconografía vectorial consistente.
- Backend: Node.js + Express
- DB: SQLite + Prisma como ORM (preparado para migrar a Postgres/MySQL
  en producción sin cambios de código, gracias al ORM)
- Auth: JWT + bcryptjs

## Modelo de datos (resumen)
- **Organizador (Club):** nombre, email, passwordHash, `cantidadCanchas` (int), horarios de apertura (`viernesInicio`, `viernesFin`, `sabadoInicio`, `sabadoFin` — strings "HH:MM", soportan turnos de trasnoche pasada la medianoche) → tiene múltiples `Torneos`.
- **Torneo:** nombre, fecha, slug único, estado (`BORRADOR` | `EN_CURSO` | `FINALIZADO`), organizadorId.
- **Pareja:** jugador1, jugador2, orden, torneoId → tiene múltiples `SlotPareja` seleccionados.
- **SlotPareja:** relación única `(parejaId, slotId)` donde `slotId` es un string plano (ej. `"Viernes-18:00"`, `"Viernes-00:15"`).
- **Zona:** torneoId, nombre ("Zona A", "Zona B"), clasifican (int), formato (`ROUND_ROBIN` | `MINI_BRACKET`), requiereArmadoManual (boolean).
- **ZonaPareja:** tabla estadística por pareja en zona (posicion, pj, pg, pp, sf, sc, gf, gc, puntos).
- **FaseEliminatoria:** torneoId, nombre ("Cuartos de Final", "Semifinal", "Final"), ronda (1=final, 2=semis, 4=cuartos, 8=octavos).
- **Partido:** torneoId, zonaId?, faseEliminatoriaId?, posicionEnRonda, pareja1Id?, origenPareja1? (ej. "1°A"), pareja2Id?, origenPareja2? (ej. "2°B"), ganadorId?, estado (`PENDIENTE` | `EN_CURSO` | `FINALIZADO`), `fechaHora` (DateTime?), `canchaNumero` (Int?), `sinHorarioAsignado` (boolean).
- **SetPartido:** partidoId, numero (1, 2, 3), gamesPareja1, gamesPareja2.

## Constantes y Reglas del Dominio
- **Duración de Partido:** Fija en **75 minutos** (constante en código, no configurable).
- **Reglas de Pádel en Resultados:** Mínimo 6 games para ganar set, diferencia de 2 en 6-5 (se permiten 7-5 / 7-6).
- **Mini-Bracket (Zonas de 4):** 2 partidos iniciales (P1 vs P2, P3 vs P4) y 2 definitorios ("Ganador vs Ganador" para 1°/2° puesto y "Perdedor vs Perdedor" para 3° puesto). El orden se fija mediante el campo explícito `posicion`.
- **Compatibilidad Horaria:** Se calcula como la intersección de conjuntos de `slotId` entre parejas.
- **Scheduler Cross-Torneo:** Al programar turnos y canchas, verifica colisiones de intervalos de tiempo (`fechaHora` ± 75 min) contra todos los partidos asignados en los demás torneos del mismo club y en memoria del torneo actual.
- **Prioridad de Scheduling ("Most Constrained First"):** Al iniciar múltiples categorías a la vez, se ordenan de menor a mayor promedio de disponibilidad por pareja para asignar canchas primero a las más restringidas.

## Funcionalidades ya implementadas
- CRUD completo de torneos (crear, editar, eliminar con cascada y reiniciar a borrador) y parejas.
- Gestión de Club / Organizador (`/admin/club`): edición de canchas totales y horarios de apertura con advertencia y modal de impacto ante cambios que invaliden turnos.
- Carga de disponibilidad por pareja con chips interactivos multi-select por día.
- Generación de zonas por sorteo aleatorio (Fisher-Yates) o por compatibilidad horaria (greedy con backtracking acotado).
- Asignación automática inteligente de horarios y canchas por torneo y masiva ("Iniciar todos los torneos").
- Gestión manual de zonas post-sorteo (`ZoneEditorModal`).
- Carga y validación estricta de resultados y cálculo automático de tablas de posiciones.
- Fase eliminatoria con bracket SVG dinámico, manejo de BYEs, edición manual de cruces y propagación dinámica de orígenes ("1°A", "2°B").
- Modales de confirmación propios consistentes para todas las acciones destructivas y diálogos con overlay blur y animaciones fluidas.
- Vista pública (`/torneo/:slug`) con polling cada 15s (actualiza a nivel de partido completo).
- Sistema de diseño "Dark Premium Deportivo" aplicado globalmente con navegación activa (`useLocation`), tokens semánticos e iconografía 100% vectorial con `lucide-react`.

## Reglas de trabajo
- Trabajar en ramas por feature (`feature/nombre-ticket`), nunca directo a main.
- Commits chicos y descriptivos (`feat:`, `fix:`, `chore:`, `docs:`).
- No agregar funcionalidad fuera del alcance definido sin confirmar antes.
- Priorizar código simple y legible por sobre optimizaciones prematuras.
- El 90% de los usuarios van a usar la app desde celular — priorizar mobile-first en cualquier UI nueva.
- Explicar brevemente cada decisión de arquitectura no trivial antes de implementarla.

## En desarrollo / próximo
- Mejoras en la vista pública (filtros de búsqueda de parejas/partidos en vivo).