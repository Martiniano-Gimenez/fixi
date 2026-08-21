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
- **Torneo (Evento):** nombre (ej. "Pares Agosto"), fecha, slug único (`slug`), estado (`BORRADOR` | `EN_CURSO` | `FINALIZADO`), organizadorId → tiene múltiples `Categorías`.
- **Categoría (Cuadro de juego):** nombre (ej. "4ta", "6ta", "8va", "5ta Damas"), estado (`BORRADOR` | `EN_CURSO` | `FINALIZADO`), torneoId → tiene múltiples `Parejas`, `Zonas`, `FasesEliminatorias` y `Partidos`.
- **Pareja:** jugador1, jugador2, orden, categoriaId → tiene múltiples `SlotPareja` seleccionados.
- **SlotPareja:** relación única `(parejaId, slotId)` donde `slotId` es un string plano (ej. `"Viernes-18:00"`, `"Viernes-00:15"`).
- **Zona:** categoriaId, nombre ("Zona A", "Zona B"), clasifican (int), formato (`ROUND_ROBIN` | `MINI_BRACKET`), requiereArmadoManual (boolean).
- **ZonaPareja:** tabla estadística por pareja en zona (posicion, pj, pg, pp, sf, sc, gf, gc, puntos).
- **FaseEliminatoria:** categoriaId, nombre ("Cuartos de Final", "Semifinal", "Final"), ronda (1=final, 2=semis, 4=cuartos, 8=octavos).
- **Partido:** categoriaId, zonaId?, faseEliminatoriaId?, posicionEnRonda, pareja1Id?, origenPareja1? (ej. "1°A"), pareja2Id?, origenPareja2? (ej. "2°B"), ganadorId?, estado (`PENDIENTE` | `EN_CURSO` | `FINALIZADO`), `fechaHora` (DateTime?), `canchaNumero` (Int?), `sinHorarioAsignado` (boolean).
- **SetPartido:** partidoId, numero (1, 2, 3), gamesPareja1, gamesPareja2.

## Constantes y Reglas del Dominio
- **Duración de Partido:** Fija en **75 minutos** (constante en código, no configurable).
- **Reglas de Pádel en Resultados:** Mínimo 6 games para ganar set, diferencia de 2 en 6-5 (se permiten 7-5 / 7-6).
- **Mini-Bracket (Zonas de 4):** 2 partidos iniciales (P1 vs P2, P3 vs P4) y 2 definitorios ("Ganador vs Ganador" para 1°/2° puesto y "Perdedor vs Perdedor" para 3° puesto). El orden se fija mediante el campo explícito `posicion`.
- **Compatibilidad Horaria:** Las parejas cargan disponibilidad en slots discretos (75 min) que se fusionan en ventanas continuas. La compatibilidad se calcula como la intersección de ventanas continuas entre parejas.
- **Scheduler Continuo en Dos Pasadas con Pool Multi-Categoría a nivel Torneo:** Cada cancha gestiona su propia línea de tiempo ordenada de intervalos ocupados (partidos del club de todas las categorías). La asignación masiva se realiza en dos fases para optimizar turnos:
  - *Pasada 1 Global:* Asigna primero en horarios de grilla estándar todos los partidos hiper-restringidos de todas las categorías juntas (1 sola opción día+franja válida).
  - *Pasada 2 Global:* Asigna todos los partidos flexibles de todas las categorías en una sola cola ordenada por escasez de opciones (MCF Global), pudiendo usar tanto turnos estándar como huecos irregulares de 15 min en cualquier cancha.
- **Prioridad de Scheduling ("Most Constrained First"):** Partidos y categorías se ordenan de menor a mayor cantidad de combinaciones día+franja válidas compartidas, reservando los recursos más escasos para los cruces con menos alternativas.

## Funcionalidades implementadas
- Jerarquía completa: Club $\rightarrow$ Torneo (Evento) $\rightarrow$ Categorías $\rightarrow$ Parejas/Zonas/Partidos/Eliminatorias.
- CRUD completo de torneos y categorías (crear, editar, eliminar y reiniciar a borrador).
- Gestión de Club / Organizador (`/admin/club`): edición de canchas totales y horarios de apertura con advertencia de impacto.
- Carga de disponibilidad por pareja con chips interactivos multi-select por día.
- Generación de zonas por sorteo aleatorio (Fisher-Yates) o por compatibilidad horaria por categoría.
- Asignación automática continua de horarios y canchas a nivel Torneo ("Iniciar Torneo y Asignar Horarios") con pool multi-categoría, detección de huecos, pre-verificación de compatibilidad (dry-run transaccional) y bloqueo ante solapamientos.
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