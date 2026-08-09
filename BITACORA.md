# Bitácora de Práctica Profesional Supervisada
**Proyecto:** Sistema de Gestión de Torneos de Pádel

A continuación se detalla el trabajo realizado, organizado por áreas temáticas de desarrollo.

---

## 1. Configuración Inicial y Base de Datos

### Configuración de Base de Datos y Entorno Local
- **Problema o necesidad que motivó el trabajo:** Durante la configuración del entorno local para probar el MVP, ocurrieron conflictos con la versión más reciente de Prisma (v7, que cambia drásticamente la configuración) y con el uso de SQL Server local (por bloqueos de TCP/IP y restricciones de cascada).
- **Qué decidí y por qué:** Decidí hacer un downgrade de Prisma a la versión 6, la cual es altamente estable y compatible con el estándar clásico de Node.js. Además, cambié temporalmente el motor de base de datos a **SQLite** para permitir desarrollo, prueba y validación inmediata sin requerir configuración compleja de puertos.
- **Alternativas que consideré y descarté:** Consideré mantener SQL Server e intentar forzar la activación de puertos o migrar a los nuevos adaptadores de Prisma 7. Se descartaron para priorizar tener el MVP corriendo de forma local rápida y sin fricciones de infraestructura.
- **Resultado final:** Archivo `schema.prisma` reescrito para eliminar `enums` nativos (incompatibles con algunos conectores) y reajuste de las reglas en cascada. Base de datos local `dev.db` sincronizada exitosamente.

---

## 2. Gestión de Torneos y Parejas

### CRUD Base de Torneos y Parejas
- **Problema o necesidad que motivó el trabajo:** Se requería la infraestructura básica para que el organizador pueda crear torneos, asignarles fecha/nombre, y gestionar (ABM) las parejas inscritas antes de iniciar la competencia.
- **Qué decidí y por qué:** Decidí implementar servicios y controladores REST en Node.js, validando a nivel backend que las parejas solo puedan ser agregadas o eliminadas mientras el torneo permanezca en estado `BORRADOR`. En el frontend, opté por vistas separadas para mantener el panel organizado.
- **Alternativas que consideré y descarté:** Consideré cargar las parejas en el mismo formulario de creación del torneo. Se descartó porque en la realidad los organizadores crean el torneo primero y van agregando parejas a lo largo de los días.
- **Resultado final:** ABM completo funcional. En el backend se implementaron rutas/controladores, y en el frontend vistas para listar torneos, crearlos y un dashboard (`ParejasManager`) para agregar/eliminar equipos.

### Gestión Manual de Zonas y Parejas
- **Problema o necesidad que motivó el trabajo:** Una vez iniciado el torneo, el sistema bloqueaba la gestión de parejas y zonas, impidiendo agregar equipos inscriptos de forma tardía o corregir errores manuales en el sorteo inicial.
- **Qué decidí y por qué:** Decidí desbloquear la pantalla de gestión de parejas y crear un componente nuevo llamado "Editor Manual de Zonas" (`ZoneEditorModal`). Utilicé menús desplegables (`<select>`) para reasignar parejas a las zonas por ser una solución intuitiva y rápida de implementar.
- **Alternativas que consideré y descarté:** Consideré permitir asignar parejas a dedo directamente en la fase eliminatoria, pero se descartó para mantener la trazabilidad. También descarté desarrollar una interfaz de "Drag and Drop" para evitar librerías externas pesadas.
- **Resultado final:** Se implementó un endpoint transaccional (`reestructurarZonas`) en el backend y el modal en el frontend. El administrador puede mover parejas o agregarlas. El sistema regenera los partidos automáticamente según el nuevo tamaño de la zona.

---

## 3. Fase de Grupos y Generación de Partidos

### Lógica de Generación de Zonas y Partidos
- **Problema o necesidad que motivó el trabajo:** Al "iniciar" un torneo, el sistema debía sortear automáticamente las parejas inscritas y agruparlas priorizando zonas de 3 parejas, resolviendo remanentes con zonas de 4 o 2.
- **Qué decidí y por qué:** Diseñé un algoritmo en el backend que utiliza Fisher-Yates para mezclar aleatoriamente las parejas y armar la estructura de zonas, pre-generando los registros de `Partido` vacíos. Todo se envolvió en una transacción (`prisma.$transaction`) para evitar estados inconsistentes si ocurre un error.
- **Alternativas que consideré y descarté:** Se descartó usar formato "Round Robin" (todos contra todos) para las zonas de 4, optando en su lugar por un formato "Mini-Bracket" (eliminación interna de 2 partidos) para no alargar demasiado la fase de grupos.
- **Resultado final:** Endpoint funcional. Las parejas quedan asignadas a sus zonas y se generan los cruces del fixture automáticamente.

### Gestión de Resultados y Tablas de Posiciones
- **Problema o necesidad que motivó el trabajo:** Proveer una forma para ingresar los resultados de los partidos y que el sistema actualice automáticamente las posiciones de la fase de grupos.
- **Qué decidí y por qué:** Decidí persistir las estadísticas (Puntos, PJ, PG, PP, Diferencia de Sets y Games) en la tabla `ZonaPareja`. Cada vez que se hace un `PUT` a un partido con el resultado, el backend dispara el cálculo `recalcularStatsZona` para actualizar a todos los integrantes.
- **Alternativas que consideré y descarté:** Calcular la tabla "al vuelo" en memoria en cada petición del frontend. Se descartó por razones de rendimiento; es más eficiente persistir el estado tras cada partido finalizado.
- **Resultado final:** Lógica de carga lista. En el frontend se implementaron componentes visuales robustos (`ZonaTable`, `ResultadoModal`) para facilitar la carga manual de sets.

### Lógica y Visualización de Zonas Mini-Bracket (4 equipos)
- **Problema o necesidad que motivó el trabajo:** En zonas de 4 equipos (Mini-Bracket), el ordenamiento basado en suma de puntos generaba empates en el 2do y 3er puesto, rompiendo la regla de eliminación directa. Además, faltaba mostrar indicadores de "Ganadores" o "Perdedores" tanto en el admin como en la vista pública.
- **Qué decidí y por qué:** Decidí restaurar la tabla estadística pero desacoplar su ordenamiento de los puntos clásicos. Opté por usar un campo `posicion` explícito que se actualiza forzosamente tras los cruces definitorios. Además, ajusté los controladores (`public.controller.js`) para enviar el estado completo de la posición de la ronda al frontend y mostrar los indicadores ("Ganador vs Ganador", "Por definirse").
- **Alternativas que consideré y descarté:** Asignar "puntos falsos exagerados" al ganador para forzar el ordenamiento. Se descartó porque esos números irreales se habrían visto en la tabla pública confundiendo a los jugadores.
- **Resultado final:** Zonas de 4 muestran correctamente tablas y partidos. Etiquetas claras en el frontend ("GANADOR VS GANADOR", etc.) y clasificación estricta de acuerdo a eliminación directa.

### Asignación de Día y Horario a Partidos
- **Problema o necesidad que motivó el trabajo:** El usuario administrador necesitaba la capacidad de establecer fecha y hora de los partidos para informar a los jugadores.
- **Qué decidí y por qué:** Usé un input nativo `type="datetime-local"` al lado de cada partido en el admin, conectado a la ruta `PUT /api/partidos/:id/fecha-hora`.
- **Alternativas que consideré y descarté:** Usar solo un input de horario (`type="time"`), pero se descartó porque los torneos abarcan fines de semana completos, siendo vital la fecha.
- **Resultado final:** Fechas visibles y renderizadas en la vista pública indicando día de la semana y hora (ej: "sáb. 18:30").

### Corrección de pérdida de foco en selectores de Fecha/Hora
- **Problema o necesidad que motivó el trabajo:** El `onChange` nativo en calendarios disparaba un guardado automático por cada número tocado, refrescando la interfaz y cerrando bruscamente el calendario.
- **Qué decidí y por qué:** Construir un componente `DateTimeInput` que maneja su propio estado local, permitiendo interacción libre y disparando la petición al servidor únicamente en el evento `onBlur`.
- **Alternativas que consideré y descarté:** Agregar un botón de "Guardar" individual (descartado por ensuciar la UI) o quitar la recarga general de datos (descartado por problemas de sincronización).
- **Resultado final:** Edición fluida de fechas sin interrupciones.

---

## 4. Fase Eliminatoria (Brackets)

### Implementación y Rediseño de Líneas Conectoras
- **Problema o necesidad que motivó el trabajo:** Las vistas del cuadro eliminatorio no tenían líneas conectando los cruces. Tras una primera implementación usando CSS (Flexbox), las líneas se renderizaban asimétricas o rotas al cambiar la altura de las tarjetas por el layout dinámico de distintos dispositivos.
- **Qué decidí y por qué:** Abandoné el uso de pseudo-elementos CSS para las conexiones y creé un componente `BracketLines.jsx` que dibuja trayectorias vectoriales (SVG). El componente calcula las posiciones absolutas (`getBoundingClientRect()`) de cada tarjeta en tiempo real, garantizando simetría perfecta a nivel de píxel sin importar cómo Flexbox estire las tarjetas.
- **Alternativas que consideré y descarté:** Intentar forzar el comportamiento nativo de CSS aplicando `height: 100%` y quitando los márgenes. Se descartó al romper la grilla y apilar tarjetas, demostrando que CSS puro es muy frágil para brackets complejos.
- **Resultado final:** Líneas vectoriales implementadas en ambas vistas (admin y pública), uniendo perfectamente el diagrama del torneo de forma responsiva.

### Propagación de Etiquetas de Origen ("1°A", "2°B")
- **Problema o necesidad que motivó el trabajo:** Las etiquetas que indican de qué zona clasificó un equipo solo se mostraban en el primer partido del cuadro.
- **Qué decidí y por qué:** Abordé el problema en el backend (`partido.service.js`). Al declarar el ganador de un partido, el sistema copia el ID de la pareja hacia el slot siguiente y arrastra consigo la etiqueta `origenPareja`.
- **Alternativas que consideré y descarté:** Hacer que el frontend "buscara hacia atrás" recursivamente en el bracket. Se descartó por ineficiencia.
- **Resultado final:** Las etiquetas avanzan automáticamente con las parejas vencedoras.

### Resolución de avance automático ("BYE") en llaves incompletas
- **Problema o necesidad que motivó el trabajo:** En torneos con número incompleto de parejas (ej: 13 sobre 16), algunos equipos quedaban sin rival en octavos. El sistema mostraba slots vacíos diciendo "Por definirse", generando confusión sobre si debían jugar.
- **Qué decidí y por qué:** Implementé la lógica de "BYE" directamente en el frontend. Los cruces vacíos se autogeneran con estado `FINALIZADO`; condicioné la interfaz para que si falta una pareja y el partido está finalizado, se renderice explícitamente "BYE".
- **Alternativas que consideré y descarté:** Enviar strings duros de "BYE" desde el backend, descartado para evitar refactorizar fuertemente la API.
- **Resultado final:** Los equipos sin rival ven "BYE" y pasan limpiamente de ronda visualmente.

---

## 5. Diseño UI/UX y Mejoras Generales

### Implementación de Sistema de Diseño Global (Dark Premium Deportivo)
- **Problema o necesidad que motivó el trabajo:** La interfaz original era básica, funcional pero carente de personalidad. Se requería una estética moderna, inmersiva y profesional.
- **Qué decidí y por qué:** Aplicar el tema "Dark Premium Deportivo" mediante CSS puro (`index.css`), definiendo un sistema de variables (custom properties) para la paleta de colores y las fuentes tipográficas (Space Grotesk e Inter).
- **Alternativas que consideré y descarté:** Migrar a un framework como Tailwind CSS o librerías pesadas (MUI). Fue descartado porque implicaba refactorizar casi todos los componentes de React y aumentaba el riesgo de romper lógica funcional existente.
- **Resultado final:** Interfaz estandarizada con fondos profundos, "glassmorphism", y brillos acentuados sutiles (glow) en botones primarios y etiquetas de éxito.

### Refactorización y Responsividad de Tablas de Posiciones
- **Problema o necesidad que motivó el trabajo:** Las tablas estadísticas tenían estilos incrustados (*inline styles*), no respetaban el nuevo diseño y desbordaban la pantalla en dispositivos móviles.
- **Qué decidí y por qué:** Unifiqué los estilos en `index.css` con clases semánticas y apliqué *media queries* (`@media (max-width: 768px)`) para reducir tamaños tipográficos, paddings y ocultar columnas de baja prioridad (Partidos Jugados, Partidos Perdidos) en móviles.
- **Alternativas que consideré y descarté:** Manejar el layout vía JavaScript. Se descartó porque CSS nativo es mucho más eficiente para flujos de presentación.
- **Resultado final:** Tablas limpias con hover dinámico y visualización perfecta en celulares sin *scroll* horizontal.

### Ajuste de Jerarquía Visual y Limpieza de Menú
- **Problema o necesidad que motivó el trabajo:** El menú lateral contenía botones redundantes ("Fase de Grupos"). Además, los botones "Limpiar Zonas" y "Reiniciar Torneo" (altamente destructivos) competían visualmente con la acción principal "Editar Zonas" al usar todos el estilo principal del sistema.
- **Qué decidí y por qué:** Eliminé el botón redundante del sidebar. A los botones destructivos les quité la clase principal y los convertí en estilo *ghost/outline* (borde sutil con baja opacidad). Mantuve "Editar Zonas" como único botón sólido (primary).
- **Alternativas que consideré y descarté:** Pintar los botones destructivos de color rojo sólido. Se descartó porque seguirían llamando demasiado la atención por sobre las tareas rutinarias.
- **Resultado final:** Interfaz segura y jerárquica. La acción principal resalta inmediatamente y las peligrosas son discretas, requiriendo intencionalidad del usuario.

### Corrección de Estado (Active Zona) al Reiniciar Torneo
- **Problema o necesidad que motivó el trabajo:** Al "Reiniciar Torneo" y volver a sortear zonas, la vista general se renderizaba en blanco porque el estado local retenía el ID de una zona antigua que ya no existía en la base de datos tras el reseteo.
- **Qué decidí y por qué:** Agregué validación reactiva dentro de un `useEffect`. Ante cualquier actualización del arreglo de zonas, verifica si el ID activo sigue presente; caso contrario, fuerza la selección de la primera zona del arreglo.
- **Alternativas que consideré y descarté:** Limpiar el estado manualmente justo antes del reseteo. Descartado por ser menos resiliente a futuro comparado con reaccionar nativamente al cambio de *props*.
- **Resultado final:** Al regenerar las zonas tras un reinicio masivo de torneo, el sistema recarga instantáneamente seleccionando por defecto la "Zona A", sin romperse.

---

## 6. Definición de Producto y Validación

### Idea de Proyecto y Modelo de Negocio
- **Problema o necesidad que motivó el trabajo:** Los organizadores de torneos de pádel amateur en mi ciudad (San Francisco, Córdoba) llevan resultados, cuadros y tablas de posiciones en papel. No existe ninguna solución digital local para este problema.
- **Qué decidí y por qué:** Definí dos tipos de usuario: el Organizador (panel con login para cargar el torneo y resultados) y el Público (jugadores/espectadores, que ven resultados en tiempo real desde un link, sin necesidad de cuenta). Decidí que el modelo de negocio apunte a cobrar un monto bajo a los clubes/organizadores, ofreciendo el primer torneo gratis o barato con un club piloto para validar la propuesta y conseguir un caso de referencia.
- **Alternativas que consideré y descarté:** Descarté lanzar el desarrollo completo sin validar antes con organizadores reales si pagarían y cuánto, para no invertir tiempo de desarrollo en una propuesta no validada comercialmente.
- **Resultado final:** Alcance de MVP definido (creación de torneo, carga de parejas, carga de resultados, tabla/cuadro automático, vista pública en tiempo real, deploy gratuito/barato) y plan de validación con un club piloto antes de escalar el proyecto.

### Configuración de Repositorio y Elección de Stack
- **Problema o necesidad que motivó el trabajo:** Antes de empezar a programar, era necesario definir el stack tecnológico y dejar el proyecto versionado y organizado siguiendo buenas prácticas, ya que el desarrollo se iba a apoyar fuertemente en programación agéntica (IA).
- **Qué decidí y por qué:** Elegí React + Vite para el frontend (por rapidez de iteración y porque ya lo conocía) y Node.js + Express para el backend (mismo lenguaje en toda la stack). Organicé el proyecto como monorepo (un solo repositorio con carpetas `backend/` y `frontend/`) en lugar de repos separados, dado que es un desarrollo individual y no un equipo con ciclos de release independientes.
- **Resultado final:** Repositorio `padeltorneos` creado en GitHub, con estructura `backend/` y `frontend/`, `.gitignore` y `README.md` documentando el problema que resuelve el proyecto, el stack y cómo correrlo localmente. Se armó además un archivo `CONTEXT.md` para darle contexto consistente a los distintos agentes de IA utilizados en el desarrollo.

### Estrategia de Trabajo con Agentes de IA
- **Problema o necesidad que motivó el trabajo:** Al desarrollar con programación agéntica (Antigravity y GitHub Copilot, con acceso a distintos modelos), era necesario definir un flujo de trabajo que fuera eficiente en el uso de créditos/tokens y a la vez mantuviera buenas prácticas de desarrollo.
- **Qué decidí y por qué:** Separé el flujo en dos fases: planeamiento (usando el modelo de mayor capacidad de razonamiento disponible, para diseñar arquitectura y detectar ambigüedades antes de escribir código) y ejecución de tickets acotados (usando modelos más livianos para tareas ya bien especificadas). Además, definí trabajar con tickets chicos y verificables en lugar de pedirle a la IA que resuelva el proyecto completo de una vez, para poder revisar cada cambio antes de continuar.
- **Alternativas que consideré y descarté:** Usar el modelo más potente disponible para todas las tareas. Lo descarté porque el consumo de créditos es mucho mayor y no aporta valor adicional en tareas mecánicas o ya bien especificadas.
- **Resultado final:** Flujo de trabajo definido: planeamiento con modelo de mayor razonamiento → tickets acotados ejecutados con modelos más livianos, escalando a un modelo más potente solo si un ticket puntual lo requiere.

---

## 7. Revisión y Mejora de UX/UI

### Revisión de Jerarquía Visual (Panel de Administración y Vista Pública)
- **Problema o necesidad que motivó el trabajo:** Una vez implementado el sistema de diseño base, era necesario revisar cada pantalla para identificar problemas de jerarquía visual y usabilidad antes de mostrar el producto a un club piloto.
- **Qué decidí y por qué:** Revisé pantalla por pantalla (tabla de posiciones, tarjetas de partidos, bracket de fase eliminatoria) identificando puntos de mejora: contraste y tamaño de botones para uso táctil en celular (dado que estimo que el 90% de los usuarios va a usar la app desde el celular), diferenciación visual entre acciones rutinarias y acciones destructivas, resaltado del partido "en juego" en la vista pública, e integración de elementos visuales sueltos (como los íconos de fecha) a sus tarjetas correspondientes.
- **Alternativas que consideré y descarté:** Descarté rediseñar la estructura completa de las pantallas; los problemas identificados eran de jerarquía y contraste, no de arquitectura de la información, que ya estaba bien planteada.
- **Resultado final:** Ajustes aplicados en varias iteraciones: separación de peso visual entre "Editar Zonas" (acción principal) y "Limpiar Zonas"/"Reiniciar Torneo" (acciones destructivas, en estilo outline), reemplazo de un diálogo nativo del navegador (`confirm()`) por un modal propio consistente con el diseño de la app, y mejoras de contraste en tarjetas de partidos y tabla de posiciones.

### Decisión sobre Granularidad de Actualización en Tiempo Real
- **Problema o necesidad que motivó el trabajo:** Definir con qué nivel de detalle se actualiza la vista pública en tiempo real (por partido completo, por set, o por game/punto).
- **Qué decidí y por qué:** Decidí que la vista pública actualice solamente a nivel de partido completo. Descarté actualizar por set o por game porque implicaría que el organizador tenga que cargar datos constantemente durante el partido, agregando fricción justo a la persona que la app busca ayudar (hoy anota todo en papel).
- **Alternativas que consideré y descarté:** Actualización por set (evaluada como mejora futura, ya que el modelo de datos ya soporta sets individuales) y por game (descartada, demasiada carga de trabajo para el organizador en vivo respecto al beneficio para el espectador).
- **Resultado final:** Vista pública con polling cada 15 segundos, mostrando el estado de cada partido (pendiente/en juego/finalizado) sin granularidad de sets parciales en esta versión.

### Exploración de Dirección Visual (Sistema de Diseño)
- **Problema o necesidad que motivó el trabajo:** El diseño inicial de la aplicación era funcional pero básico, y quería definir una dirección visual más profesional antes de aplicarla a todo el proyecto.
- **Qué decidí y por qué:** En lugar de iterar directamente sobre el código real, le pedí a un agente de IA que generara 3 variantes visuales independientes (HTML/CSS aislado, sin conectar a datos reales) explorando distintas direcciones de diseño dark (premium deportivo, minimalista editorial, vibrante gaming/esports), para poder elegir una dirección antes de invertir tiempo de desarrollo real.
- **Alternativas que consideré y descarté:** Iterar directamente sobre el CSS del proyecto real sin explorar variantes primero. Lo descarté porque hubiera implicado más idas y vueltas con el agente sobre código ya integrado, en lugar de decidir la dirección visual sobre un prototipo aislado y descartable.
- **Resultado final:** Elección de la dirección "Dark Premium Deportivo", aplicada luego como sistema de diseño global del proyecto (documentado en la sección 5).

---

## 8. Definición de Alcance para Práctica Profesional Supervisada

### Evaluación de Funcionalidades Faltantes
- **Problema o necesidad que motivó el trabajo:** Con el proyecto ya bastante avanzado, evalué si necesitaba sumar funcionalidades, tanto por completitud del producto como por la necesidad de cubrir aproximadamente 200 horas de trabajo para la Práctica Profesional Supervisada.
- **Qué decidí y por qué:** Descarté agregar manejo de walkover/abandono (WO) por no ser una prioridad para el MVP. En cambio, prioricé una funcionalidad con valor real tanto para el producto como para el peso académico del trabajo: el armado automático de zonas de la fase de grupos en base a la disponibilidad horaria que cada pareja informa al inscribirse (día y franja horaria en la que puede jugar), reemplazando el sorteo puramente aleatorio actual.
- **Alternativas que consideré y descarté:** Descarté agregar funcionalidades solo para completar horas sin que aportaran valor real al problema que resuelve la aplicación.
- **Resultado final:** Definición de una nueva funcionalidad a desarrollar: armado de zonas por compatibilidad horaria.

### Diseño de Alcance: Armado de Zonas y Asignación de Horarios por Disponibilidad
- **Problema o necesidad que motivó el trabajo:** En los torneos reales de mi ciudad, cada pareja informa al inscribirse en qué días y franjas horarias puede jugar la fase de grupos (ej. viernes de 15 a 19, sábado de 9 a 12). Hoy los organizadores arman las zonas cruzando estos horarios manualmente.
- **Qué decidí y por qué:** Definí el alcance de la funcionalidad: (1) el sistema arma las zonas agrupando parejas con compatibilidad horaria, permitiendo que el organizador ajuste manualmente el resultado del algoritmo; (2) el organizador puede definir la cantidad de canchas disponibles para el torneo (ej. 5), con una duración estimada de 1:15hs por partido; (3) el sistema asigna automáticamente el horario exacto de cada partido, respetando la disponibilidad de ambas parejas y evitando superposiciones de cancha u horario para una misma pareja.
- **Alternativas que consideré y descarté:** Evalué limitar el alcance solo al armado de zonas, dejando la asignación de horario exacto de cada partido a cargo del organizador. Decidí incluir también la asignación automática de horarios, ya que consideré que el nivel de complejidad (un problema de scheduling con restricciones) es apropiado para el volumen de horas que exige la Práctica Profesional Supervisada.
- **Resultado final:** Alcance definido, pendiente de diseño de algoritmo e implementación.

---

## ⏱️ Resumen de Tiempos y Esfuerzo Estimado

El desarrollo de la aplicación se gestionó mediante un ciclo iterativo de 5 sesiones de trabajo, sumando un aproximado total de entre 6 y 7 horas y media de programación, refactorización y depuración.

| Sesión | Tiempo estimado | Temas cubiertos |
|--------|-----------------|------------------|
| **1** | ~1 hora | CRUD Base, Generación algorítmica de Zonas, Tablas de Posiciones y persistencia, Setup de DB (SQLite). |
| **2** | ~30 minutos | Implementación base de Brackets (CSS), Inyección de selectores Fecha/Hora seguros, Propagación de Etiquetas ("1°A"). |
| **3** | 1.5 a 2 horas | Modificación transaccional (Gestión manual post-sorteo), Refactorización de Lógica de Clasificación en Mini-Bracket. |
| **4** | 1.5 a 2 horas | Algoritmia de avance ("BYE") en brackets incompletos, Reescritura del renderizado de Brackets mediante SVG dinámico. |
| **5** | 1.5 a 2 horas | Re-diseño Global UI (Dark Premium Deportivo), Fixes de UX (Jerarquías), Tablas Responsivas, State Management. |
| **Total** | **~6 a 7.5 hrs** | Implementación Full-Stack integral MVP (Frontend + Backend + DB). |

> **Nota:** esta tabla cubre únicamente las sesiones de codificación. No incluye el tiempo dedicado a definición de producto, validación, diseño UX/UI, revisión de pantallas y planificación de alcance (secciones 6 a 8), que representan trabajo adicional real de la Práctica Profesional Supervisada.