# Contexto del proyecto — Pádel Torneos

## Qué es
App web de seguimiento de torneos de pádel amateur en tiempo real, para
organizadores que hoy llevan todo en papel.

## Usuarios
- Organizador: panel con login, carga torneo/parejas/resultados.
- Público: ve resultados y posiciones en tiempo real vía link, sin cuenta.

## Stack
- Frontend: React 19 + Vite + React Router v7, estado local con hooks
  (sin Redux ni Context API), Vanilla CSS (index.css con variables/tokens)
- Backend: Node.js + Express
- DB: SQLite + Prisma como ORM (preparado para migrar a Postgres/MySQL
  en producción sin cambios de código, gracias al ORM)
- Auth: JWT + bcryptjs

## Modelo de datos (resumen)
- Organizador → múltiples Torneos (BORRADOR / EN_CURSO / FINALIZADO, con slug único)
- Pareja (2 jugadores) asociada a un Torneo
- Zona (ROUND_ROBIN o MINI_BRACKET) con tabla ZonaPareja (estadísticas:
  puntos, PJ, PG, PP, sets y games a favor/en contra)
- Partido (pertenece a Zona o FaseEliminatoria), con lógica de "origen"
  (ej. "1° Zona A") para armar brackets antes de conocer parejas exactas
- SetPartido (games por pareja en cada set)
- FaseEliminatoria (octavos/cuartos/semifinal/final), con manejo de BYEs
  y propagación dinámica de orígenes

## Funcionalidades ya implementadas
- CRUD de torneos y parejas
- Generación automática de zonas (Fisher-Yates) al iniciar torneo
- Carga de resultados con validación según reglas oficiales de pádel
  (mínimo 6 games, diferencia de 2 en 6-5, se permite 7-5/7-6)
- Cálculo automático de tabla de posiciones (con campo `posicion`
  explícito para desambiguar Mini-Bracket)
- Fase eliminatoria con manejo de BYEs y edición manual de cruces
- Asignación de fecha/hora por partido (input datetime-local)
- Gestión manual de zonas post-sorteo (ZoneEditorModal)
- Modales de confirmación propios para acciones destructivas
- Vista pública con polling cada 15s (actualiza a nivel de partido
  completo, no por set ni game)
- Sistema de diseño "Dark Premium Deportivo" aplicado globalmente

## Reglas de trabajo
- Trabajar en ramas por feature (`feature/nombre-ticket`), nunca directo a main.
- Commits chicos y descriptivos (`feat:`, `fix:`, `chore:`, `docs:`).
- No agregar funcionalidad fuera del alcance definido sin confirmar antes.
- Priorizar código simple y legible por sobre optimizaciones prematuras.
- El 90% de los usuarios van a usar la app desde celular — priorizar
  mobile-first en cualquier UI nueva.
- Explicar brevemente cada decisión de arquitectura no trivial antes de
  implementarla.

## En desarrollo / próximo
- Armado de zonas por disponibilidad horaria: cada pareja informa día(s)
  y franja(s) horarias en las que puede jugar. El sistema debe agrupar
  parejas por compatibilidad horaria en zonas, permitir ajuste manual del
  organizador, y asignar automáticamente el horario exacto de cada
  partido según cantidad de canchas disponibles (estimando 1:15hs por
  partido), evitando superposiciones de cancha/horario por pareja.