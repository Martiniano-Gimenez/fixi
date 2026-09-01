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

### Eliminación de Torneos en Cascada
- **Problema o necesidad que motivó el trabajo:** El usuario administrador no disponía de una opción para borrar torneos de prueba o cancelados directamente desde la interfaz, quedando registros residuales en la base de datos.
- **Qué decidí y por qué:** Implementé el endpoint `DELETE /api/torneos/:id` con eliminación en cascada en la base de datos (borrando parejas, zonas, fases eliminatorias, partidos, sets y disponibilidad asociada). En el frontend, agregué botones de eliminación protegidos por modal de confirmación (`ConfirmModal`) tanto en las tarjetas del listado principal como en el menú lateral del detalle del torneo.
- **Alternativas que consideré y descarté:** Baja lógica (soft delete). Se descartó para mantener el modelo simple y evitar acumulación de datos innecesarios en la etapa actual del producto.
- **Resultado final:** Eliminación completa y segura de torneos accesible desde la lista y desde el detalle, con redirección y actualización automática del listado.

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
- **Qué decidí y por qué:** Definí el alcance de la funcionalidad: (1) el sistema arma las zonas agrupando parejas con compatibilidad horaria, permitiendo que el organizador ajuste manualmente el resultado del algoritmo; (2) el organizador define la capacidad de canchas y los horarios de apertura del club; (3) el sistema asigna automáticamente el horario exacto de cada partido, respetando la disponibilidad de ambas parejas y evitando superposiciones de cancha u horario para una misma pareja.
- **Alternativas que consideré y descarté:** Evalué limitar el alcance solo al armado de zonas, dejando la asignación de horario exacto de cada partido a cargo del organizador. Decidí incluir también la asignación automática de horarios, ya que consideré que el nivel de complejidad (un problema de scheduling con restricciones) es apropiado para el volumen de horas que exige la Práctica Profesional Supervisada.
- **Resultado final:** Alcance definido, pasando a la fase de diseño e implementación técnica.

---

## 9. Armado de Zonas por Disponibilidad Horaria y Asignación Automática de Canchas/Horarios

### Evolución de Enfoque: De Rangos Libres Continuos a Slots Discretos Fijos (75 min)
- **Problema o necesidad que motivó el trabajo:** La idea inicial de permitir que cada pareja cargue rangos libres de horas (ej. 14:30 a 18:15) generaba una complejidad matemática alta de solapamiento de intervalos y, más importante, no reflejaba la realidad de los clubes de pádel, donde los partidos se organizan en turnos discretos y estandarizados (75 minutos).
- **Qué decidí y por qué:** Rediseñé la funcionalidad desde cero basándola en **slots discretos fijos de 75 minutos**. A partir de las horas de apertura de Viernes y Sábado, el backend genera dinámicamente la grilla de turnos (ej. 13:00, 14:15, 15:30, etc., con soporte completo para turnos que cruzan la medianoche). Las parejas seleccionan los turnos que les sirven mediante chips interactivos multi-select. La compatibilidad entre parejas se simplificó de forma elegante a una **intersección de conjuntos**, haciendo el algoritmo más predecible, rápido y exacto.
- **Alternativas que consideré y descarté:** Mantener rangos continuos y redondear al turno más cercano. Se descartó porque introducía ambigüedad en los bordes y complicaba la interfaz de usuario en dispositivos móviles.
- **Resultado final:** Modelo `SlotPareja` en Prisma, servicio de cálculo puro `slots.service.js`, editor visual por chips en `DisponibilidadEditor.jsx` e inicio de torneo por compatibilidad con backtracking acotado (máx. 5.000 iteraciones).

### Centralización de Recursos a Nivel Club y Scheduler Cross-Torneo
- **Problema o necesidad que motivó el trabajo:** Los clubes suelen organizar simultáneamente 4 o 5 categorías distintas durante el mismo fin de semana, compartiendo el mismo conjunto total de canchas (ej. 6 canchas). Modelar las canchas y horarios de forma aislada por torneo no permitía coordinar la ocupación real del club.
- **Qué decidí y por qué:** Moví la configuración de `cantidadCanchas` y los horarios de apertura de Viernes/Sábado desde la entidad `Torneo` hacia la entidad `Organizador` (Club). Creé una pantalla centralizada de "Configuración del Club" (`/admin/club`) y reescribí el scheduler automático (`asignarHorariosAutomatico`) para que evalúe colisiones de canchas considerando los partidos programados en **todos los torneos simultáneos del club**, además de los partidos en memoria del torneo actual.
- **Alternativas que consideré y descarté:** Mantener las canchas por torneo y pedirle al organizador que reparta cupos fijos (ej. 2 canchas para 4ta, 2 para 5ta). Se descartó porque es rígido e ineficiente; un pool compartido permite que el scheduler aproveche huecos libres entre categorías de manera óptima.
### Inicio Masivo de Torneos y Algoritmo de Prioridad ("Most Constrained First")
- **Problema o necesidad que motivó el trabajo:** Iniciar y programar torneos categoría por categoría requería múltiples pasos manuales repetitivos para el organizador. Además, al compartir un mismo pool de canchas, el orden en que se asignaban los torneos afectaba directamente cuántos partidos quedaban sin horario compatible.
- **Qué decidí y por qué:** Implementé la funcionalidad de **"Iniciar todos los torneos"** desde el dashboard principal. El backend ejecuta un pipeline en dos etapas: primero genera las zonas de todos los torneos en borrador (por disponibilidad o sorteo); luego calcula un *score de flexibilidad* por categoría (promedio de turnos seleccionados por pareja) y programa los partidos en orden de menor a mayor disponibilidad (**Most Constrained First**). De esta forma, las categorías y parejas con menos opciones horarias ocupan las canchas primero, maximizando la cantidad total de partidos programados automáticamente y minimizando la necesidad de ajustes manuales posteriores.
- **Alternativas que consideré y descarté:** Programar los torneos por orden de creación o por tamaño de inscriptos. Se descartaron porque no contemplaban las restricciones horarias reales, lo que provocaba que torneos muy restrictivos se quedaran sin turnos libres al ejecutarse al final.
- **Resultado final:** Endpoint `POST /api/organizador/iniciar-todos`, modal con resumen interactivo de cobertura por torneo en `TorneosList.jsx` y ordenamiento heurístico cross-torneo.

---

## 10. Rediseño Premium de Navegación, Estados Activos e Iconografía Vectorial (`lucide-react`)

### Estandarización Visual, Jerarquías de Navegación y Tokenización
- **Problema o necesidad que motivó el trabajo:** La aplicación utilizaba emojis de texto plano dispersos en botones, títulos y badges, los cuales se renderizaban de forma inconsistente entre sistemas operativos y navegadores móviles. Asimismo, la barra superior (header) y el sidebar de torneos carecían de estados activos vinculados a la URL y de separación clara entre navegación principal y acciones destructivas (logout, eliminación de torneo, reinicio).
- **Qué decidí y por qué:** 
  1. Instalé la librería `lucide-react` para estandarizar toda la iconografía de la aplicación con trazos vectoriales uniformes y consistentes.
  2. Implementé detección de rutas activas mediante `useLocation()` de React Router, aplicando estilos sutiles con el color de acento (`var(--color-primary-light)` y `var(--color-primary)`).
  3. En el sidebar del torneo, diseñé el estado activo con borde izquierdo de acento y `border-radius: 0 var(--radius-md) var(--radius-md) 0` (radio asimétrico) para asegurar que el trazo quede alineado limpiamente con el contenedor sin el efecto visual de "borde flotante".
  4. Creé el token `--color-danger-bg` en `:root` para unificar los fondos hover de las acciones destructivas y de riesgo (logout, eliminar torneo, borrar bracket, eliminar parejas).
  5. Centralicé los estilos de `.modal-overlay` y `.modal-content` con `position: fixed`, `backdrop-filter: blur(6px)` y micro-animaciones fluidas, y extendí la limpieza de iconos y textos a todas las pantallas: Login, Registro, Administración (Torneos, Club, Parejas, Eliminatoria) y Vista Pública.
- **Alternativas que consideré y descarté:** Mantener emojis de texto o usar paquetes de fuentes pesados como FontAwesome. Se descartó para priorizar rendimiento, diseño moderno y uniformidad en dispositivos móviles.
- **Resultado final:** Rama `feature/nav-premium-redesign` con interfaz 100% pulida, navegación contextual y jerarquías visuales limpias en toda la aplicación.

---

## 11. Validación Pre-Inicio: Dry-Run Transaccional y Cache Determinista con Fingerprinting

### Bloqueo Estricto ante Incompatibilidades y Prevención de Partidos Flotantes
- **Problema o necesidad que motivó el trabajo:** Al iniciar múltiples categorías simultáneamente, si alguna pareja no contaba con horarios compatibles con sus rivales o si la capacidad de canchas saturaba los turnos, el sistema permitía iniciar de todos modos y reportaba los partidos "sin horario" post-facto. Esto generaba torneos activos con partidos flotantes que requerían solución manual compleja y sin un bloqueo preventivo claro.
- **Qué decidí y por qué:** 
  1. Diseñé un endpoint de pre-verificación `POST /api/organizador/pre-check-inicio` que ejecuta el pipeline real (`iniciarTorneo` / `iniciarTorneoConDisponibilidad` y `asignarHorariosAutomatico` con heurística MCF) dentro de una transacción `prisma.$transaction` que **siempre hace rollback**.
  2. Si el dry-run detecta cualquier partido con `sinHorarioAsignado: true` o zonas con `requiereArmadoManual: true`, el backend devuelve un reporte detallado con los cruces conflictivos y el frontend bloquea la confirmación, mostrando un modal explicativo sin botón de forzar.
  3. Para resolver el no-determinismo del sorteo aleatorio (Fisher-Yates) entre el pre-check y la confirmación, serialicé el plan completo validado en memoria (`planesCache`) con un identificador UUID (`planId`) y TTL de 5 minutos, guardando solo referencias lógicas (evitando IDs de autoincremento/UUIDs de la transacción revertida).
  4. Para prevenir que el plan se aplique si la configuración del club o la disponibilidad de las parejas fue modificada entre el pre-check y la confirmación, implementé un **fingerprint reactivo** (`JSON.stringify([clubConfig, ...parejasSlots])`). Si el fingerprint no coincide al momento de confirmar, se rechaza la operación con código HTTP 409 solicitando una nueva verificación.
- **Alternativas que consideré y descarté:** 
  - *Chequeo combinatorio estático de todos los pares posibles:* Descartado por generar falsos positivos (parejas que nunca se cruzaban en el sorteo) y duplicar la lógica del scheduler real.
  - *Seedear `Math.random()`:* Descartado por complejidad innecesaria en Node.js; el snapshot lógico en memoria garantiza 100% de reproducibilidad.
- **Resultado final:** Rama `feature/pre-check-inicio` con validación 100% robusta, prevención de partidos sin horario y feedback claro al organizador antes de confirmar.

---

## 12. Scheduler Continuo en Dos Pasadas: Línea de Tiempo Independiente por Cancha y Búsqueda de Huecos Libres

### Reemplazo de Turnos Sincronizados Globales por Timelines Continuas sin Canibalización de Franjas Pico
- **Problema o necesidad que motivó el trabajo:** El scheduler anterior sincronizaba todas las canchas a una grilla fija de turnos globales (ej. 13:00, 14:15, 15:30...). Si una cancha quedaba libre antes que las demás (por ejemplo, a las 14:00 por un partido de otro torneo que terminaba en horario desfasado) o si quedaban huecos libres intermedios entre partidos previamente fijados, el sistema no podía aprovecharlos, desperdiciando capacidad real y dejando partidos innecesariamente "sin horario".
- **Qué decidí y por qué:** 
  1. Diseñé una representación en memoria de **línea de tiempo independiente por cancha** (`courtTimelines: Map<canchaNum, {startMs, endMs}[]>`), inicializada con todos los partidos firmes de todos los torneos del club (cross-tournament) y del torneo actual.
  2. Implementé la fusión de slots contiguos de 75 min en **ventanas continuas de disponibilidad** por pareja e intersección continua entre rivales (`intersectOrderedWindows`).
  3. Creé el algoritmo `computeFreeGaps` que detecta cualquier espacio libre `>= 75 min` dentro de la jornada de apertura del club, permitiendo agendar partidos tanto en huecos intermedios (ej. entre 14:15 y 16:30) como al inicio o fin del día en la **grilla de 15 minutos**.
  4. Para evitar la canibalización de franjas escasas (donde partidos flexibles de torneos prioritarios consumían el viernes pico dejando sin horario a parejas de torneos posteriores que sólo podían viernes), implementé una **asignación en dos pasadas con pool global multi-torneo (MCF Global)**:
     - *Pasada 1 Global:* Recolecta y asigna primero en horarios de grilla estándar todos los partidos con una sola opción día+franja posible de todas las categorías simultáneamente (hiper-restringidos), protegiendo la capacidad pico a nivel club.
     - *Pasada 2 Global:* Asigna todos los partidos flexibles de todas las categorías en una sola cola ordenada por escasez de opciones (MCF), pudiendo utilizar tanto turnos estándar como huecos libres continuos de 15 min desfasados.
  5. Mantuve compatibilidad 100% con transacciones externas (`externalTx`), integrándose de forma transparente con el dry-run y fingerprinting de `pre-check-inicio`.
- **Alternativas que consideré y descarté:** 
  - *Heurística puramente voraz de menor timestamp global:* Descartada porque favorecía agresivamente al primer día del calendario (Viernes) sobre el segundo (Sábado), saturando el Viernes con parejas flexibles y dejando sin lugar a quienes sólo podían jugar Viernes.
  - *Procesamiento secuencial torneo por torneo:* Descartado porque permitía que partidos flexibles del primer torneo le ganaran el lugar a partidos hiper-restringidos del tercer o cuarto torneo.
  - *Mantener grilla fija de 75 min sin timelines continuas:* Descartada porque no permitía arranques desfasados (ej. 14:00) ni detección de gaps intermedios creados por partidos preexistentes.
- **Resultado final:** Rama `feature/scheduler-continuo` con scheduler continuo de alta eficiencia por cancha y pool global, 0 desperdicio de huecos, **73 partidos asignados** (superando el método anterior y reduciendo a 9 los sin horario por saturación física estricta), y 100% de éxito en todos los escenarios de validación (no-regresión, gaps de 14:00, huecos intermedios de 14:15, partidos pre-asignados y pre-check transaccional con plan cache).

---

## 13. Reestructuración de Dominio: Jerarquía Club → Torneo (Evento) → Categorías (Cuadros de Juego)

### Adaptación al Modelo Real de Clubes de Pádel
- **Problema o necesidad que motivó el trabajo:** Los clubes de pádel organizan eventos de fin de semana o mensuales (ej. "Pares Agosto", "Impares Agosto", "Torneo Aniversario") que contienen múltiples categorías compitiendo simultáneamente (4ta, 6ta, 8va, Damas 5ta, etc.). El sistema anterior modelaba cada categoría como un torneo separado, obligando al organizador a gestionar múltiples links públicos inconexos y dispersando la asignación de turnos.
- **Qué decidí y por qué:**
  1. **Evolución del Schema de Base de Datos:**
     - Se incorporó la entidad intermedia `Categoria` entre `Torneo` y las entidades de juego (`Pareja`, `Zona`, `FaseEliminatoria`, `Partido`).
     - `Torneo` conserva el `organizadorId`, `nombre`, `fecha` y `slug` público unificado.
     - `Categoria` almacena el nivel (`nombre`), `estado` (`BORRADOR`, `EN_CURSO`, `FINALIZADO`) y referencia a su `torneoId`.
  2. **Arquitectura Backend:**
     - Se crearon `categoria.service.js`, `categoria.controller.js` y `categoria.routes.js` con endpoints anidados (`/api/torneos/:torneoId/categorias` y `/api/categorias/:id/...`).
     - Se adaptaron los servicios de `zona`, `pareja`, `partido` y `faseEliminatoria` para operar sobre `categoriaId`.
     - El scheduler continuo con pool multi-categoría corre a nivel Torneo (`/api/torneos/:id/iniciar` y `/api/torneos/:id/pre-check-inicio`), optimizando los recursos de todas las categorías en paralelo.
  3. **Frontend y Experiencia de Usuario:**
     - `TorneosList.jsx`: Panel de eventos con métricas de categorías y parejas totales.
     - `TorneoDetail.jsx`: Hub central del torneo con link público unificado, gestión de categorías y asignación masiva de turnos.
     - `CategoriaDetail.jsx`: Vista de administración por categoría con soporte automático para Zonas Round Robin y Mini-Brackets de 4 parejas, tabla de posiciones y accesos directos.
     - `TorneoPublic.jsx`: Vista pública unificada con navegación fluida entre categorías mediante chips interactivos, brackets eliminatorios y actualización en vivo cada 15 segundos.
     - **Componentes y Modales Pulidos:** Integración de `ConfirmModal` con diseño *Dark Premium* para borrado de resultados, `MiniBracketView` con cruces definitorios ("Ganador vs Ganador", "Perdedor vs Perdedor") y `PartidoCard` con textos de origen claros y selector de horarios inline.
- **Resultado final:** Modelo de dominio 100% alineado con la operativa real de clubes de pádel, reduciendo la fricción administrativa y centralizando la experiencia para jugadores y espectadores.

### Centralización del Flujo de Sorteo/Inicio a Nivel Torneo (Consistencia de Estado y UX)
- **Problema o necesidad que motivó el trabajo:** Dentro de la vista de categoría en estado `BORRADOR` (`CategoriaDetail.jsx`), existían botones individuales para "Sortear Zonas" y "Zonas por Disponibilidad". Si el organizador sorteaba una sola categoría desde allí, el torneo quedaba en un estado mixto (`EN_CURSO` en unas categorías y `BORRADOR` en otras), entorpeciendo o bloqueando el flujo centralizado de inicio global del evento.
- **Qué decidí y por qué:** Decidí remover los botones de sorteo individual dentro del detalle de la categoría, dejando a nivel categoría únicamente la administración de parejas y disponibilidad. En el estado borrador, se incorporó un mensaje guía que explica que el armado de zonas e inicio se realiza para todas las categorías juntas desde la pantalla principal del Torneo, agregando un botón de retorno directo. Esto previene estados híbridos y guía naturalmente al usuario por el flujo correcto.
- **Alternativas que consideré y descarté:** Mantener los botones con advertencias modales. Se descartó porque añade pasos innecesarios y no resuelve la confusión de flujo en la interfaz.
- **Resultado final:** Flujo de inicio 100% consistente y centralizado a nivel Torneo, eliminando estados mixtos ambiguos y simplificando la interfaz de administración por categoría.

### Editor Rápido de Disponibilidad Inline en Modal de Bloqueo con Detección de Estrellas (`★`)
- **Problema o necesidad que motivó el trabajo:** Cuando el pre-check detectaba cruces sin cancha o sin franja común, el organizador tenía que salir del modal, recordar las parejas conflictivas, navegar hasta la categoría y editar la disponibilidad en "Gestionar Parejas", perdiendo contexto y agilidad durante la tarde del jueves previa al inicio.
- **Qué decidí y por qué:** Diseñé e integré un editor compacto inline (`InlineDisponibilidadEditor.jsx`) dentro de cada tarjeta de conflicto en el modal. El backend identifica automáticamente la pareja más restringida de cada cruce, filtra únicamente los slots viables (donde hay cancha libre en el club y ninguna pareja juega en simultáneo) y destaca con una estrella verde (`★`) aquellos turnos que coinciden directamente con la disponibilidad de la pareja rival, permitiendo destrabar el cruce en una sola llamada telefónica.
- **Alternativas que consideré y descarté:** Embeber el editor completo de disponibilidad en el modal. Se descartó por sobrecarga visual y porque mostraba turnos saturados que no eran viables.
- **Resultado final:** Resolución de conflictos en 1 clic directamente desde el modal, persistencia reactiva y recálculo automático del pre-check completo mediante el botón "Volver a verificar".

### Salida de Emergencia Condicional (Iniciar Torneo con Partidos Pendientes)
- **Problema o necesidad que motivó el trabajo:** Si la saturación física de canchas en franjas pico impide resolver el 100% de los partidos antes del jueves por la noche, el organizador podía quedar completamente bloqueado sin poder arrancar las categorías cuyos partidos ya estaban listos.
- **Qué decidí y por qué:** Implementé una salida de emergencia controlada que habilita el botón "Iniciar torneo dejando X partidos pendientes" únicamente cuando el organizador ya redujo al menos un conflicto respecto al inicio de la sesión. Esta acción transiciona las categorías y el torneo a `EN_CURSO` y marca los partidos no asignados con `sinHorarioAsignado: true` para su posterior programación manual.
- **Alternativas que consideré y descarté:** Permitir forzar el inicio desde el primer momento con todos los conflictos abiertos. Se descartó para evitar atajos negligentes que comprometan la calidad del fixture.
- **Resultado final:** Mecanismo de escape seguro para situaciones límite de saturación de infraestructura física, bloqueando estrictamente zonas manuales incompletas que no tienen partidos formados.

### Filtrado Estricto en AsignarHorarioModal Post-Inicio con Prevención de Colisiones Inter-Categoría
- **Problema o necesidad que motivó el trabajo:** En el modal de asignación manual de partidos post-inicio, se mostraban turnos donde las canchas ya estaban ocupadas por otras categorías o donde las parejas ya tenían partidos solapados, permitiendo selecciones inválidas que causaban colisiones posteriores en cascada.
- **Qué decidí y por qué:** Refactoricé el modal para consultar en tiempo real las canchas libres a nivel global del club, ocultando completamente las combinaciones inválidas y mostrando única y exclusivamente los turnos donde: 1) Hay cancha física libre en el torneo, 2) Ninguna de las dos parejas tiene otro partido en esa franja, y 3) Cae dentro de la disponibilidad mutua de ambas parejas.
- **Alternativas que consideré y descarté:** Mostrar todos los turnos deshabilitados con tooltips. Se descartó por saturación de pantalla en dispositivos móviles.
- **Resultado final:** Selección 100% segura e inmune a errores humanos, con actualización en vivo de la ocupación del club.

### Validación Matemática Exacta de Estrellas para Zonas Incompletas (`slotDestrabaZonaManual`)
- **Problema o necesidad que motivó el trabajo:** En categorías con zonas manuales incompletas (ej. 15 parejas en 7ma Damas con 3 parejas huérfanas disjuntas en horarios), aparecían estrellas en parejas intermedias que, al seleccionarse, no resolvían el grupo porque los dos extremos seguían sin compartir horarios entre sí.
- **Qué decidí y por qué:** Implementé el algoritmo `slotDestrabaZonaManual` en el backend, el cual simula la compatibilidad pairwise de todas las combinaciones del grupo. Un turno recibe estrella (`★`) única y exclusivamente si garantiza que el 100% de las parejas de la zona quedan con compatibilidad mutua. Además, se integró el editor inline para parejas manuales en el modal de bloqueo, permitiendo que el solver global re-optimice y agrupe toda la categoría automáticamente.
- **Alternativas que consideré y descarté:** Forzar la edición manual de zonas en estado borrador. Se descartó porque en borrador las zonas no existen físicamente en la base de datos hasta que el solver las calcula.
- **Resultado final:** Garantía matemática del 100% en las sugerencias de destrabe de zonas, eliminando falsos positivos.

### Numeración Correlativa Automática de Parejas Inscriptas
- **Problema o necesidad que motivó el trabajo:** En la lista de parejas inscriptas por categoría (`ParejasManager.jsx`), al eliminar una pareja intermedia (ej. la `#10`), la numeración visual quedaba con huecos (1... 9, 11, 12...).
- **Qué decidí y por qué:** Actualicé el frontend para renderizar el badge con el índice correlativo dinámico `#{index + 1}` y agregué en `pareja.service.js` la re-secuenciación automática del campo `orden` en la base de datos tras cada borrado.
- **Alternativas que consideré y descarté:** Mantener el orden histórico como identificador. Se descartó porque confundía al organizador al contabilizar el total de parejas.
- **Resultado final:** Secuencia numérica siempre continua y prolija (1 a N) en pantalla y en base de datos.

### Reprogramación de Partidos Asignados con Escritura Atómica
- **Problema o necesidad que motivó el trabajo:** Una vez que un partido tenía un horario asignado (automática o manualmente), el organizador no podía reasignar el partido a otro turno o cancha si surgía un imprevisto sin colisionar con la propia reserva previa del partido.
- **Qué decidí y por qué:** Reutilicé el endpoint `PUT /api/partidos/:id/asignar-horario-manual` e implementé un botón de "Reprogramar". Modifiqué la lectura de disponibilidad global para que reciba un parámetro opcional `ignorePartidoId`, lo que permite que el sistema evalúe la disponibilidad del club *excluyendo* el horario anterior de ese mismo partido. El guardado se realiza de forma 100% atómica mediante Prisma (`id: { not: partidoId }`), reescribiendo los valores sin pasar por estados intermedios vulnerables.
- **Alternativas que consideré y descarté:** Hacer un flujo de dos pasos (liberar el partido -> reasignarlo). Se descartó por riesgo de condición de carrera, donde otra categoría podría "robar" el turno liberado durante esos segundos intermedios.
- **Resultado final:** Reprogramación fluida desde el mismo modal de turnos, manteniendo la integridad referencial y detectando turnos óptimos (con estrella) incluso durante la reprogramación.

### Slider de Rango Horario (15 min) para Carga de Disponibilidad y Expansión de Datos Antiguos
- **Problema o necesidad que motivó el trabajo:** La carga de disponibilidad con chips rígidos de 75 min producía pérdida real de disponibilidad si una pareja podía jugar desde las 16:00 pero el chip más cercano era 16:45. Además, la grilla de chips requería demasiados clics individuales y no se sentía ergonómica en celulares.
- **Qué decidí y por qué:**
  1. Reduje la granularidad de generación de slots a **15 minutos** (`SLOT_GRANULARIDAD_MIN = 15`) manteniendo fija la duración del partido en 75 min (`DURACION_PARTIDO_MIN = 75`), permitiendo que el motor de fusión continua (`fusionarSlotsEnVentanas`) absorba la nueva precisión sin requerir cambios de esquema en la base de datos.
  2. Implementé componentes de UI dedicados (`RangeSliderDia`, `RangeSliderGroup` y actualización de `DisponibilidadEditor`): selectores de rango duales ("desde–hasta") con snap de 15 min, botón para agregar múltiples franjas independientes por día (gaps/huecos en el medio) y detección de trasnoche.
  3. **Protección de Retrocompatibilidad:** Al cargar parejas con slots viejos de 75 min aislados (ej. `"Viernes-16:45"`), el sistema los expande automáticamente a su ventana real de 5 slots de 15 min (`16:45` a `17:45`, o `16:45` a `19:00` si había contiguos) para evitar achicar accidentalmente la disponibilidad al reabrir el editor.
- **Alternativas que consideré y descarté:**
  - Slider multi-manija en una sola barra: se descartó por mala ergonomía táctil en pantallas móviles pequeñas.
  - Reconstruir slots viejos como ticks aislados de 15 min: se descartó porque causaba una reducción silenciosa de disponibilidad de 75 min a 15 min al guardar sin editar.
- **Resultado final:** Carga mucho más rápida, precisa e intuitiva (UI móvil premium), con verificación End-to-End en base de datos que confirmó pre-checks en ~60ms, asignación masiva sin colisiones, cálculo de estrellas pairwise en ~19ms y consultas de reprogramación en ~4ms.

### Coherencia en Tiempo Real de Sugerencias de Horario (Estrellas ★) y Acordeón Limpio de Partidos Pendientes
- **Problema o necesidad que motivó el trabajo:**
  1. En la lista de partidos pendientes tras iniciar un torneo con salida de emergencia (`PartidosPendientesSection`), la tarjeta mostraba una insignia verde con estrella (ej. `★ 16 turnos en común previos`) basada en la coincidencia teórica de inscripción, pero al abrir el modal de asignación no había ninguna estrella disponible porque todas las canchas de esa franja pico estaban 100% ocupadas por otros partidos. Esto resultaba contradictorio y engañoso para el organizador.
  2. Al ingresar a un torneo en curso, el acordeón de partidos pendientes abría automáticamente la primera categoría, generando desorden visual y obligando a hacer scroll innecesario.
- **Qué decidí y por qué:**
  1. Actualicé `getPartidosSinHorarioTorneo` en el backend para calcular `slotsValidosConEstrellaCount` en tiempo real (intersección entre slots viables con cancha libre real y los turnos originales de las parejas). En el frontend, la estrella verde (`★`) se renderiza única y exclusivamente si existen turnos compatibles con cancha libre disponible. Si las parejas coincidían pero las canchas están llenas, se muestra una advertencia explícita en amarillo (`⚠️ Turnos originales saturados`) tanto en la tarjeta como en el encabezado de `AsignarHorarioModal`.
  2. Modifiqué `PartidosPendientesSection.jsx` para que todas las categorías inicien colapsadas por defecto, permitiendo al organizador expandir solo la categoría que le interesa o usar el botón "Expandir todas".
- **Alternativas que consideré y descarté:** Mantener la estrella basada en la inscripción histórica. Se descartó porque inducía al error al prometer opciones que no existían físicamente en la grilla.
### Asistente Inteligente de Resolución de Cruces (CruceResolver), Jerarquía de Certeza y Deshacer Delta Atómico
- **Problema o necesidad que motivó el trabajo:**
  1. En el modal de bloqueo previo al inicio, todas las opciones que requerían estirar disponibilidad se mostraban genéricamente con "(+N min)" sin distinguir si una sola pareja debía estirar (estrella clásica, 1 sola llamada confirmatoria con certeza total) o si ambas debían estirar (casi-estrella doble, 2 llamadas simultáneas).
  2. El ordenamiento original priorizaba el esfuerzo total por sobre la certeza de resolución (mostrando opciones dobles de 40 min antes que clásicas de 45 min).
  3. No se indicaba si la pareja debía adelantar su inicio ($-Nm$) o extenderse después ($+Nm$), y los tiempos grandes en minutos (ej. $+120m$) resultaban poco legibles para el organizador al llamar por teléfono.
- **Qué decidí y por qué:**
  1. Refactoricé el motor de resolución (`calcularOpcionesResolucion` en `slots.service.js` y componente `CruceResolver.jsx`) invirtiendo la jerarquía de ordenamiento para priorizar **Certeza antes que Esfuerzo**: `cantidadPartesQueEstiran` (0 mutua > 1 clásica > 2 doble) $\rightarrow$ menor `distTotal` $\rightarrow$ balance.
  2. Implementé cálculo de distancia con **signo de dirección** ($+/-$) relativo al bloque más cercano declarado y una función utilitaria `formatAjusteTiempo` que convierte minutos $\ge 60$ a horas legibles (ej. `+1h`, `+1h 35m`, `-2h`).
  3. Integré resolución en **1 click** con actualización atómica doble (`PUT /api/parejas/disponibilidad-doble`) y un toast flotante de **Deshacer (Undo)** por 7 segundos con reversión precisa de delta (`removerDisponibilidadDoble`), garantizando que solo se remuevan los slots agregados sin alterar la disponibilidad previa de las parejas.
  4. Habilité acción en 1 click para los turnos viables libres del club en la sección "Detalles y opciones manuales".
- **Alternativas que consideré y descarté:**
  - Ordenar por menor distancia absoluta combinada en primer término: se descartó porque priorizaba casi-estrellas dobles inciertas sobre resoluciones de 1 sola parte ya confirmada.
  - Modificar snapshots completos de disponibilidad al deshacer: se descartó para evitar condiciones de carrera o sobreescritura accidental de cambios concurrentes.
- **Resultado final:** Asistente visual nítido y preciso para destrabar cruces en pre-check, con trazabilidad telefónica exacta y red de seguridad instantánea mediante Undo.

### Unificación de Asignar Horario Post-Inicio con Ranking de Cercanía y Asignación Directa a Partido
- **Problema o necesidad que motivó el trabajo:** Tras iniciar el torneo con salida de emergencia, el modal de asignación manual para partidos pendientes (`AsignarHorarioModal`) volvía al esquema antiguo de mostrar más de 60 botones planos desordenados sin ranking de cercanía ni sugerencia Hero, obligando al organizador a buscar a mano entre todas las canchas.
- **Qué decidí y por qué:**
  1. **Separación estricta de responsabilidades:** A diferencia del pre-check (que modifica `SlotPareja`), en el flujo post-inicio el partido ya existe con sus dos parejas fijas, por lo que resolver significa asignar `fechaHora` + `canchaNumero` directamente al `Partido` vía `PUT /api/partidos/:id/asignar-horario-manual` en una sola transacción atómica, sin tocar `SlotPareja`.
  2. Reutilicé la lógica de cálculo de distancias y jerarquía de certeza (`rankingSlots.js`) para rankear en tiempo real los turnos físicos devueltos por `getCanchasDisponiblesTorneo`.
  3. Rediseñé `AsignarHorarioModal` incorporando la opción **Hero destacada** (#1 del ranking), alternativas colapsadas (*"Ver X opciones más cercanas"*) y la grilla completa del club, todas **100% accionables en 1 click**.
  4. Criterio de cancha determinístico: el sistema adjudica automáticamente la primera cancha libre en orden numérico ascendente (`canchasLibres[0]`), eliminando selectores intermedios y manteniendo el badge `(N lib.)` puramente como dato informativo de contexto.
- **Alternativas que consideré y descarté:**
  - Reutilizar el endpoint `disponibilidad-doble` post-inicio: se descartó explícitamente porque hubiera fabricado disponibilidad artificial en `SlotPareja` que contaminaría otros cruces futuros de la misma pareja.
  - Mantener un selector manual de cancha: se descartó para optimizar la velocidad operativa del organizador (1 solo clic asigna horario y la primera cancha libre).
- **Resultado final:** Consistencia UX/UI total en toda la aplicación (antes y después de iniciar), reduciendo el tiempo de programación manual de minutos a un solo clic.

### Modo Día de Torneo — Reprogramación Dinámica por Reducción de Canchas ("Modo Lluvia")
- **Problema o necesidad que motivó el trabajo:** En situaciones climáticas adversas (ej. lluvia sobre canchas al aire libre de un club con 6 canchas donde 2 quedan inutilizadas), el organizador necesitaba reducir la cantidad de canchas activas del torneo en tiempo real. Esto exigía reacomodar automáticamente todos los partidos pendientes futuros dentro de las canchas remanentes (asumiendo fungibilidad total), sin alterar los partidos ya finalizados ni los que están en juego en ese instante, y permitiendo activar/desactivar el modo lluvia múltiples veces durante el fin de semana.
- **Qué decidí y por qué:**
  1. **Schema Prisma:** Agregué `canchasDisponiblesOverride Int?` (override temporal, null = usa las canchas del club) y `overrideActivoDesde DateTime?` en `Torneo`. Al activar o ajustar el override, se guarda el timestamp exacto del momento de la decisión.
  2. **Reglas de Reprogramación:**
     - Se seleccionan únicamente los partidos `PENDIENTE` con `fechaHora > overrideActivoDesde` (incluyendo eliminatorias pendientes asignadas).
     - **Extensión de jornada en modo lluvia:** Durante la reprogramación de emergencia, la búsqueda de slots en las canchas activas no se corta al llegar al horario formal de cierre del club (permite extender partidos de madrugada para no suspender el torneo), pero sí corta al cambiar la fecha calendario.
     - **Transaccionalidad:** Se ejecuta en una sola transacción Prisma (`prisma.$transaction`) actualizando tanto el torneo como los partidos reprogramados.
  3. **Seguridad y Visibilidad de Edge Cases:**
     - Bloqueo con error 400 si hay partidos `EN_CURSO` en canchas que quedarían inhabilitadas ($> \text{canchasOverride}$).
     - Bloqueo si el override excede la capacidad real del club (`cantidadCanchas`).
     - **Detección de Canchas Fantasma:** Si existen partidos `PENDIENTE` con horario anterior al override que habían quedado en canchas inhabilitadas, se devuelven en `partidosEnCanchaFantasma` y se muestran en una alerta destacada en el frontend para resolución manual con `AsignarHorarioModal`.
  4. **Vista Dedicada `/admin/torneos/:id/en-vivo` (`TorneoEnVivo.jsx`):**
     - Grilla visual en tiempo real de canchas (Libres, En Juego con tiempo transcurrido/fin estimado, Inhabilitadas).
     - Barra de control de modo lluvia con selector, confirmación modal y panel de feedback detallado post-reprogramación (partidos movidos, delta de horario).
- **Alternativas que consideré y descarté:**
  - Modificar permanentemente `Club.cantidadCanchas`: se descartó porque contaminaría la configuración base del club y afectaría a otros torneos o futuras fechas normales.
  - Reutilizar el solver MCF completo: se descartó porque en el fragor operativo del día del torneo lo primordial es la preservación cronológica y el corrimiento mínimo de turnos, no la re-optimización combinatoria global.
- **Resultado final:** Reprogramación masiva instantánea ante imprevistos climáticos con trazabilidad, seguridad transaccional y visualización en tiempo real.

### Carga Rápida de Resultados en Vivo y Acordeón Colapsable de Partidos Finalizados
- **Problema o necesidad que motivó el trabajo:**
  1. Durante la operación del torneo, tener que navegar a la pantalla de detalle de categoría para cargar el resultado de cada partido que finalizaba obligaba a salir de la vista operativa y perder el panorama general del club.
  2. En torneos grandes (80+ partidos), listar todos los partidos en una única pantalla generaba un scroll excesivo. Hacía falta mantener el foco en "qué sigue" (Próximos Partidos) sin perder la visibilidad para auditar resultados recién cargados.
- **Qué decidí y por qué:**
  1. **Acción Rápida de Carga de Resultado:** Reutilicé el componente modal existente `ResultadoModal` integrándolo directamente en la tarjeta de cada "Próximo Partido" mediante un botón de acción (`ClipboardList`). El endpoint `getEstadoEnVivo` expone los objetos crudos `pareja1Obj` y `pareja2Obj` para que el modal opere de forma nativa sin transformaciones frágiles.
  2. **Recálculo Inmediato y Polling con Reset (`intervalRef`):** Al guardar el resultado desde el modal, se dispara `fetchAndResetPolling()`, el cual ejecuta el re-fetch inmediato y resetea el temporizador de 30s del `setInterval` (`intervalRef`), eliminando solapamientos de peticiones y parpadeos visuales.
  3. **Sección "Partidos Finalizados" Colapsable:** Agregué un acordeón colapsado por defecto al final de la vista que lista todos los partidos en estado `FINALIZADO` con sus sets/games visibles (`6-3 / 7-5`), ordenados cronológicamente en orden descendente (más reciente arriba) y con botón para editar/corregir resultados con `ResultadoModal`.
- **Alternativas que consideré y descarté:**
  - Crear un modal simplificado específico para la vista en vivo: se descartó para mantener consistencia de validaciones de sets de pádel y evitar duplicación de código.
  - Esperar al ciclo natural de polling de 30s tras guardar: se descartó porque causaba una sensación de demora en el operador que necesitaba verificar que el partido ya no figuraba como pendiente.
- **Resultado final:** Flujo operativo ágil donde el organizador puede controlar canchas, reprogramar por lluvia, consultar próximos turnos y cargar resultados en 1 clic desde una única pantalla móvil/desktop.

### Tabs Dinámicos por Día Calendario con Trasnoche Real en "Próximos Partidos"
- **Problema o necesidad que motivó el trabajo:** En torneos de fin de semana, la lista de "Próximos Partidos" mostraba todos los turnos del fin de semana (Viernes y Sábado) en una sola columna continua con scroll vertical excesivo. Además, los turnos de madrugada (ej. Sábado 01:00 AM) se separaban erróneamente en el tab del sábado si se usaba la fecha nativa de JavaScript, rompiendo la continuidad lógica de la jornada del viernes.
- **Qué decidí y por qué:**
  1. Diseñé un sistema de tabs dinámicos interactivos (`Viernes 28 | Sábado 29`) en `TorneoEnVivo.jsx`, calculando los días mediante `getDiaCalendarioConTrasnoche` y los horarios reales de apertura y cierre configurados por el club (`horariosClub`).
  2. Implementé la selección inteligente por defecto: el componente detecta automáticamente el día actual de la jornada; si no hay partidos programados para hoy, activa por defecto el día más próximo con partidos pendientes.
- **Alternativas que consideré y descarté:** Agrupar con separadores estáticos dentro de la misma lista. Se descartó porque no reducía la longitud de la pantalla en dispositivos móviles.
- **Resultado final:** Navegación por jornadas limpia y contextual, con badge de conteo por día y soporte exacto para partidos de trasnoche.

### Eliminación del Efecto "Whack-A-Mole" en Scheduler MCF (Prioridad Grupo 0 por Resolución Manual)
- **Problema o necesidad que motivó el trabajo:** Al resolver un conflicto manualmente en `CruceResolver` (estirando la disponibilidad de una pareja con `setDisponibilidadDoble`), el pre-check global volvía a correr el scheduler completo desde cero. Al tener más slots disponibles, la pareja se volvía "más flexible" y el algoritmo *Most Constrained First* la degradaba a menor prioridad (`Grupo 2`). Otros partidos ocupaban el turno recién liberado, dejando la misma o más cantidad de partidos pendientes (efecto "golpea al topo").
- **Qué decidí y por qué:**
  1. **Schema Prisma:** Agregué el campo `resolucionManual Boolean @default(false)` en la entidad `Pareja`.
  2. **Trazabilidad del Flag:** Al aplicar una resolución en `CruceResolver`, se marca `resolucionManual = true`. Al usar el botón de Deshacer (`removerDisponibilidadDoble`), se resetea a `false`. Al reiniciar una categoría a `BORRADOR` (`reiniciarCategoria`), se limpia en lote a `false`.
  3. **Scheduler con Grupo 0 (Máxima Prioridad):** En `asignarHorariosAutomatico` (`zona.service.js`), creé el `Grupo 0` que procesa primero todos los partidos con parejas marcadas con `resolucionManual = true`, ordenados por heurística MCF (`numOptions`).
- **Alternativas que consideré y descarté:** Congelar toda la grilla y hacer re-scheduling incremental. Se descartó por una complejidad algorítmica desproporcionada que impedía optimizar huecos globales.
- **Resultado final:** Cada conflicto resuelto manualmente queda 100% protegido y garantizado en su slot, reduciendo de forma estrictamente monótona la cantidad de partidos pendientes tras cada acuerdo telefónico.

### Aislamiento por Día Calendario en Modo Lluvia y Helper Centralizado (`dateUtils.js`)
- **Problema o necesidad que motivó el trabajo:** `reprogramarPorReduccionCanchas` reprogramaba todos los partidos pendientes futuros sin límite superior. Si el modo lluvia se activaba un viernes, comprimía también los partidos del sábado, dejándolos atrapados en el pool reducido aunque el sábado hubiera dejado de llover.
- **Qué decidí y por qué:**
  1. Extraje y centralicé la función `getDiaCalendarioConTrasnoche` en `backend/src/utils/dateUtils.js` como única fuente de verdad para backend y frontend.
  2. Modifiqué `reprogramarPorReduccionCanchas` para que solo reprograme los partidos `PENDIENTE` que pertenezcan al mismo día calendario lógico que `overrideActivoDesde`, tratando a los partidos de otros días como ocupación fija intocable.
  3. Utilicé `dayLimitMs` provisto por el helper para delimitar la búsqueda de slots durante la trasnoche sin cortar a la medianoche pero sin desbordar al día siguiente.
- **Alternativas que consideré y descarté:** Mantener cálculos ad-hoc dispersos en `organizador.service.js`. Se descartó para evitar desincronizaciones de reglas de trasnoche entre módulos.
- **Resultado final:** Un evento de lluvia afecta estricta y únicamente a los partidos del día en que se declaró, con tests automatizados pasando en verde incluso para casos límites de madrugada.

### Cambio Rápido de Estado a "EN_CURSO" y "PENDIENTE" (1-Click en Vivo)
- **Problema o necesidad que motivó el trabajo:** Para que un partido pasara a estado `EN_CURSO`, el sistema requería obligatoriamente cargar al menos un set parcial desde `ResultadoModal`. En la práctica, los organizadores anotan los resultados al finalizar el partido y necesitaban marcar que una cancha entró en juego con un solo toque al ver entrar a los jugadores.
- **Qué decidí y por qué:**
  1. **Endpoint Atómico Dedicado:** Creé `PATCH /api/partidos/:id/estado` en `partido.service.js` que acepta `{ estado: 'EN_CURSO' | 'PENDIENTE' }`, validando estrictamente las transiciones permitidas y bloqueando modificaciones sobre partidos `FINALIZADO`. Si se revierte a `PENDIENTE`, elimina sets parciales residuales.
  2. **Interactividad en `TorneoEnVivo.jsx`:**
     - En cada tarjeta de "Próximos Partidos", agregué un botón con ícono de `Play` (`▶`) disponible libremente para iniciar el partido al instante.
     - En "Partidos en Juego", agregué un botón `Revertir` (`RotateCcw`) para devolverlo a `PENDIENTE` ante clics accidentales.
     - Disparo inmediato de re-fetch (`fetchAndResetPolling`), actualizando la grilla superior de canchas a `EN JUEGO` y los contadores en tiempo real.
- **Alternativas que consideré y descarté:** Sobrecargar `PUT /api/partidos/:id/resultado` permitiendo enviar arrays vacíos de sets. Se descartó para no mezclar la semántica de carga de score con la operación en vivo de canchas.
- **Resultado final:** Control de canchas ágil y en 1 clic, con test end-to-end automatizado que valida la transición de estado, el bloqueo de reducción de canchas si la cancha afectada está en juego y la reversión segura.

### Desacople de Fechas, Determinismo y Modo Lluvia de Emergencia (Global Earliest-Fit)
- **Problema o necesidad que motivó el trabajo:**
  1. El backend utilizaba la fecha/hora actual del sistema (`new Date()` / `getAhora()` / `DEBUG_NOW`) para calcular los días de los slots (ej. "Viernes" o "Sábado"). Esto provocaba cálculos no deterministas que cambiaban según el día en que se ejecutaba el código, requería variables de entorno artificiales para desarrollo (`DEBUG_NOW`) y sufría de desfasajes de zona horaria (UTC vs GMT-3) al parsear fechas `"YYYY-MM-DD"`.
  2. Los slots de madrugada (ej. `"Viernes-00:00"`) se seteaban a las 00:00 hs del viernes (la noche del jueves al viernes) en lugar de la madrugada del sábado (+1 día), haciendo que el helper de trasnoche los asignara erróneamente al jueves.
  3. El Modo Lluvia anterior utilizaba un bucle voraz con `startSearchMs = minSlotMs`: si una pareja había solicitado horario nocturno (ej. 21:00 hs), el bucle salteaba toda la tarde (14:00 a 20:45 hs) e iniciaba la búsqueda desde las 21:00 hs en adelante, empujando partidos innecesariamente a la madrugada (00:45 / 01:30 AM) mientras las canchas de la tarde quedaban vacías.
- **Qué decidí y por qué:**
  1. **`torneo.fecha` como Única Fuente de Verdad:** Establecí que la fecha de inicio del torneo es el único ancla temporal. Los slots de Viernes y Sábado se calculan de forma puramente matemática a partir de `Torneo.fecha`, sin consultar el reloj del sistema.
  2. **Eliminación Total de `DEBUG_NOW` y `getAhora()`:** Se eliminó la variable de entorno, el helper `getAhora()`, el script de prueba asociado y el banner de inicio de servidor.
  3. **Helper `parseFechaLocal`:** Parsea strings `"YYYY-MM-DD"` y objetos `Date` al mediodía local (`12:00`), garantizando que `getDay()` devuelva siempre el día de la semana correcto sin importar el huso horario del servidor.
  4. **Validación Centralizada `requireTorneoFecha`:** Helper único que valida que el torneo tenga fecha antes de operaciones de scheduling (`asignarHorariosAutomatico`, `preCheckInicio`, `asignarHorarioManual`, `getPartidosSinHorarioTorneo`, `getCanchasDisponiblesTorneo`), lanzando error HTTP 400 si falta.
  5. **Mapeo Exacto de Slots de Trasnoche (`parseSlotToDate`):** Los slots con horas de madrugada (`00:00` a `05:59`) se sitúan en la fecha base $+ 1$ día (madrugada del día siguiente), preservando la continuidad cronológica estricta tras las 23:45 y eliminando asignaciones accidentales al jueves.
  6. **Modo Lluvia 100% Guiado por Estados:** `reprogramarPorReduccionCanchas` considera a los partidos `FINALIZADO` y `EN_CURSO` como bloques fijos inmutables en sus canchas y horarios específicos.
  7. **Regla de Negocio de Emergencia (Sin Restricción de Disponibilidad):** En Modo Lluvia **NO se filtra por la disponibilidad declarada por las parejas (`sharedWindows`)**. Al ser una contingencia operativa en vivo con los jugadores ya presentes en el club, la prioridad absoluta es que ningún partido quede sin jugar y que la jornada finalice lo más temprano posible, ocupando cualquier horario hábil del día lógico hasta el límite de trasnoche (`dayLimitMs`).
  8. **Compactación Global Earliest-Fit con Cola Cronológica (FIFO):** Los partidos pendientes se ordenan por su horario original (`origStartMs` ASC $\rightarrow$ `origCancha` ASC $\rightarrow$ `id` ASC) para preservar la antigüedad del turno. En cada paso se evalúa toda la grilla de canchas activas ($1 \dots N$) y se selecciona el horario $T$ más temprano donde la cancha y ambas parejas estén libres, compactando las canchas en paralelo.
  9. **Benchmark Side-by-Side (`benchmark-voraz-vs-mcf.js`):** En un escenario con slots nocturnos y reducción de 6 a 4 canchas, el bucle anterior desbordaba hasta las **12:45 AM (00:45 hs)** dejando huecos muertos en la tarde, mientras que el nuevo Global Earliest-Fit finaliza a las **05:45 PM (17:45 hs)** (**7 horas antes**), con el 100% de los partidos asignados.
  10. **Reprogramación Bidireccional:** Al restaurar canchas (`override = null`) o aumentarlas, el sistema vuelve a ejecutar la redistribución de los partidos `PENDIENTE`, adelantándolos y reocupando las canchas liberadas.
  11. **Filtrado del Modal de Feedback:** El resumen de cambios en vivo lista y cuenta exclusivamente los partidos que sufrieron una modificación en su horario de inicio, excluyendo los que solo cambiaron de cancha.
  12. **Edición Interactiva de Torneo en Frontend (`TorneoDetail.jsx`):** Modal interactivo para modificar el nombre del torneo y seleccionar la fecha de inicio (`PUT /api/torneos/:id`) directamente desde la insignia de fecha del encabezado.
- **Alternativas que consideré y descarté:** Filtrar por `sharedWindows` durante Modo Lluvia. Se descartó porque en la práctica operativa de clubes, durante una contingencia climática en vivo, la disponibilidad horaria declarada antes del torneo queda suspendida en favor de la finalización compacta del torneo.
- **Resultado final:** Fixture 100% reproducible y determinista, Modo Lluvia de emergencia con compactación óptima y finalización hasta 7 horas antes, restauración fluida de canchas, tests unitarios (`test-date-parsing.js`), benchmarks (`benchmark-voraz-vs-mcf.js`) e integración (`test-modo-dia-torneo.js`) pasando al 100%.

---

## ⏱️ Resumen de Tiempos y Esfuerzo Estimado

El desarrollo de la aplicación se gestionó mediante un ciclo iterativo de 16 sesiones de trabajo, sumando un aproximado total de entre 45 y 51 horas de programación, refactorización, depuración y testeo.

| Sesión | Tiempo estimado | Temas cubiertos |
|--------|-----------------|------------------|
| **1** | ~2 horas | CRUD Base, Generación algorítmica de Zonas, Tablas de Posiciones y persistencia, Setup de DB (SQLite). |
| **2** | ~1.5 horas | Implementación base de Brackets (CSS), Inyección de selectores Fecha/Hora seguros, Propagación de Etiquetas ("1°A"). |
| **3** | ~2.5 a 3 horas | Modificación transaccional (Gestión manual post-sorteo), Refactorización de Lógica de Clasificación en Mini-Bracket. |
| **4** | ~2.5 a 3 horas | Algoritmia de avance ("BYE") en brackets incompletos, Reescritura del renderizado de Brackets mediante SVG dinámico. |
| **5** | ~2.5 a 3 horas | Re-diseño Global UI (Dark Premium Deportivo), Fixes de UX (Jerarquías), Tablas Responsivas, State Management. |
| **6** | ~3.5 a 4 horas | Módulo de disponibilidad horaria: slots discretos (75m), trasnoche, compatibilidad por intersección de conjuntos, centralización de canchas/jornada en Club y scheduler cross-torneo. |
| **7** | ~2.5 a 3 horas | Inicio masivo con prioridad *"Most Constrained First"*, eliminación en cascada, rediseño de navegación con `useLocation`, modales con blur y migración total a `lucide-react`. |
| **8** | ~1.5 a 2 horas | Validación pre-inicio simultáneo: pipeline en dry-run con rollback transaccional, plan cache determinista, fingerprinting de invalidación reactiva y modal de bloqueo. |
| **9** | ~2.5 a 3 horas | Scheduler continuo por cancha en dos pasadas: timelines independientes, ventanas fusionadas, detección de huecos intermedios (15m grid), protección de franjas pico y validación exhaustiva multiescenario. |
| **10** | ~3.5 a 4 horas | Reestructuración de Dominio: Jerarquía Club → Torneo (Evento) → Categorías (Cuadros), migración completa de Frontend y Backend, vista pública multicategoría y confirmación estilizada de resultados. |
| **11** | ~3.5 a 4 horas | Resilencia Operativa: Editor inline inteligente en modal de bloqueo (`★`), salida de emergencia condicional, asignación manual post-inicio con filtrado estricto, solver exacto de zonas incompletas y numeración correlativa. |
| **12** | ~2.5 a 3 horas | Carga de disponibilidad de alta precisión: Sliders de rango horario duales (15 min), retrocompatibilidad de datos, testeo End-to-End, acordeón colapsado y consistencia en tiempo real de sugerencias de horario (`★`). |
| **13** | ~3.5 a 4 horas | Asistente de resolución en pre-check (`CruceResolver`): jerarquía por certeza, dirección (+/-), formato horas ($\ge 60\text{m}$), Deshacer atómico y acordeón inteligente por urgencia. Unificación post-inicio (`AsignarHorarioModal` + `rankingSlots`): Hero óptimo y 1-click directo a `Partido`. |
| **14** | ~3.5 a 4 horas | Modo Día de Torneo (`/en-vivo`): reprogramación dinámica por reducción de canchas ("Modo Lluvia") con extensión de jornada, monitoreo visual de canchas, alerta de canchas fantasma, carga rápida de resultados (`ResultadoModal`), acordeón colapsable de partidos finalizados y polling con reset inteligente (`intervalRef`). |
| **15** | ~3.5 a 4 horas | Refinamiento Día de Torneo y Resiliencia del Scheduler: Tabs dinámicos por día con trasnoche real, eliminación del efecto *whack-a-mole* en scheduler MCF (Prioridad Grupo 0 y flag `resolucionManual`), aislamiento por día lógico en Modo Lluvia (`dateUtils.js`), y cambio rápido de estado a "EN_CURSO"/"PENDIENTE" en 1 clic (`PATCH /api/partidos/:id/estado`). |
| **16** | ~4.5 horas | Desacople de Fechas y Determinismo (`torneo.fecha` como única fuente de verdad), eliminación total de `DEBUG_NOW` y `getAhora()`, helper `parseFechaLocal`, validación `requireTorneoFecha`, corrección de slots trasnoche (+1 día), Modo Lluvia de emergencia 100% basado en estados (`FINALIZADO`/`EN_CURSO`/`PENDIENTE`), suspensión de disponibilidad de pareja en emergencia, motor Global Earliest-Fit con cola FIFO (cierre hasta 7 horas antes), reprogramación bidireccional al restaurar canchas, filtro de cambios solo de horario y modal interactivo de edición de torneo. |
| **Total** | **~45 a 51 hrs** | Implementación Full-Stack integral con jerarquía de torneos y categorías, scheduling continuo en tres pasadas con prioridad manual, pre-check transaccional, asistente de resolución de cruces, modo día de torneo en vivo con reprogramación por lluvia de emergencia (Global Earliest-Fit), brackets dinámicos, disponibilidad por sliders y diseño UI/UX premium. |

> **Nota:** esta tabla cubre únicamente las sesiones de codificación y depuración técnica. No incluye el tiempo dedicado a definición de producto, validación con usuarios, diseño UX/UI en wireframes, revisión de pantallas y planificación de alcance (secciones 6 a 8), que representan trabajo adicional real de la Práctica Profesional Supervisada.