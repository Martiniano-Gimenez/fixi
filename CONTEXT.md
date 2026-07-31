# Contexto del proyecto — Pádel Torneos

## Qué es
App web de seguimiento de torneos de pádel amateur en tiempo real, para
organizadores que hoy llevan todo en papel.

## Usuarios
- Organizador: panel con login, carga torneo/parejas/resultados.
- Público: ve resultados y posiciones en tiempo real vía link, sin cuenta.

## Alcance del MVP (nada más que esto por ahora)
1. Crear torneo (tipo: zonas de 3 parejas, clasifican 2. luego eliminacion directa. puede haber zonas de 2 o de 4 si no quedan todas de 3)
2. Cargar parejas/jugadores
3. Cargar resultados de partidos
4. Tabla de posiciones o cuadro actualizado automáticamente
5. Vista pública en tiempo real (polling simple, sin WebSockets)
6. Deploy gratis/barato

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- DB: PostgreSQL + Prisma (ORM)

## Reglas de trabajo
- Trabajar en ramas por feature (`feature/nombre-ticket`), nunca directo a main.
- Commits chicos y descriptivos.
- No agregar funcionalidad fuera del alcance del MVP sin confirmar antes.
- Priorizar código simple y legible por sobre optimizaciones prematuras.
- Explicar brevemente cada decisión de arquitectura no trivial antes de implementarla.