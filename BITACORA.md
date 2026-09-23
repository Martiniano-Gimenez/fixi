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

### Eliminación del Editor Manual de Zonas (`ZoneEditorModal`)
- **Problema o necesidad que motivó el trabajo:** El "Editor Manual de Zonas" (creado al principio del proyecto, ver entrada "Gestión Manual de Zonas y Parejas") nunca se actualizó a medida que se construyeron el scheduler continuo, la fase eliminatoria automática y el sistema de pre-check con snapshot congelado. Se sospechó que había quedado desacoplado de esas features y se decidió auditarlo antes de seguir confiando en él.
- **Qué decidí y por qué:** Diseñé un test de integración contra la API real (sin navegador) para inspeccionar la base de datos antes/después de invocar el endpoint `reestructurarZonas`, y luego pedí una auditoría del código fuente para confirmar la causa raíz de cada síntoma. Se confirmó que el endpoint no validaba el estado del torneo ni de los partidos individuales: borraba físicamente partidos `FINALIZADO`/`EN_CURSO` junto con sus sets, eliminaba en cascada toda la fase eliminatoria ya programada por el scheduler (incluyendo cruces con fecha/hora/cancha confirmados para el fin de semana), dejaba los partidos nuevos con `sinHorarioAsignado: false` a pesar de tener `fechaHora: null` (por lo que quedaban invisibles en `PartidosPendientesSection`), y apagaba `requiereArmadoManual` sin validar compatibilidad horaria real entre las parejas reasignadas. Decidí eliminar el componente por completo (frontend, service, controller y ruta) en lugar de parchearlo, porque arreglarlo bien implicaba reescribirlo con la misma lógica incremental y seguro que ya tiene `CruceResolver`, que cubre el mismo caso de uso (reasignar parejas en zonas post-inicio) sin destruir datos.
- **Alternativas que consideré y descarté:** Consideré agregar validaciones puntuales (bloquear si hay partidos `FINALIZADO`, arreglar el default de `sinHorarioAsignado`, reevaluar `requiereArmadoManual` correctamente) en lugar de eliminarlo. Se descartó porque hubiera significado duplicar la lógica que `CruceResolver` ya resuelve de forma segura, con snapshot congelado, resolución incremental monótona y undo — mantener dos caminos distintos para el mismo problema agregaba complejidad sin necesidad.
- **Resultado final:** Se eliminaron `ZoneEditorModal.jsx`, la función `reestructurarZonas` en `zona.service.js`, el método correspondiente en `zona.controller.js` y la ruta `PUT /categorias/:id/zonas/reestructurar`, junto con el botón "Modificar Zonas" en `CategoriaDetail.jsx`. La reasignación manual de parejas entre zonas post-inicio queda cubierta exclusivamente por `CruceResolver`.

### Eliminación de Torneos en Cascada
- **Problema o necesidad que motivó el trabajo:** El usuario administrador no disponía de una opción para borrar torneos de prueba o cancelados directamente desde la interfaz, quedando registros residuales en la base de datos.
- **Qué decidí y por qué:** Implementé el endpoint `DELETE /api/torneos/:id` con eliminación en cascada en la base de datos (borrando parejas, zonas, fases eliminatorias, partidos, sets y disponibilidad asociada). En el frontend, agregué botones de eliminación protegidos por modal de confirmación (`ConfirmModal`) tanto en las tarjetas del listado principal como en el menú lateral del detalle del torneo.
- **Alternativas que consideré y descarté:** Baja lógica (soft delete). Se descartó para mantener el modelo simple y evitar acumulación de datos innecesarios en la etapa actual del producto.
- **Resultado final:** Eliminación completa y segura de torneos accesible desde la lista y desde el detalle, con redirección y actualización automática del listado.

### Edición Directa del Nombre del Torneo desde el Detalle
- **Problema o necesidad que motivó el trabajo:** Al entrar a la pantalla/pestaña de un torneo (`TorneoDetail`), el organizador no contaba con una forma directa ni visible para cambiarle el nombre al evento; la opción de edición estaba oculta detrás del selector de fecha en la cabecera sin un indicador claro en el título.
- **Qué decidí y por qué:** Decidí implementar soporte dual de edición en el frontend:
  1. **Edición rápida inline directamente en el título:** El título `<h1>` del torneo ahora es interactivo con hover sutil (`editable-title-hover`) y está acompañado de un botón discreto con ícono de lápiz (`Edit2`). Al hacer click, el título se transforma en un campo de texto con auto-foco y selección automática, con botones de confirmación rápida (`✓ Guardar` / `✕ Cancelar`) y soporte para teclado (`Enter` para guardar, `Escape` para cancelar), actualizando de forma reactiva el estado del torneo tras persistir en `PUT /api/torneos/:id`.
  2. **Acceso directo en la barra de acciones:** Agregué el botón `"Editar Torneo"` en el grupo de acciones principales de la cabecera para abrir el modal completo de edición de nombre y fecha de inicio, con foco automático en el nombre.
- **Alternativas que consideré y descarté:** Consideré abrir únicamente el modal al hacer click en el título, pero se priorizó la edición inline por ofrecer una experiencia más fluida, moderna y sin fricción visual para el organizador.
- **Resultado final:** Experiencia intuitiva y mobile-first para cambiar el nombre del torneo en cualquier momento, con feedback inmediato y sin recargas de página.

### Auditoría y Bloqueo de Estado en Alta/Baja de Parejas (`ParejasManager` y `pareja.service.js`)
- **Problema o necesidad que motivó el trabajo:** La pantalla de gestión de parejas previa al sorteo (`ParejasManager.jsx`) y sus endpoints base (`POST /api/categorias/:id/parejas` y `DELETE /api/parejas/:id`) permitían dar de alta y baja parejas sin validar `categoria.estado`. Al auditar el comportamiento en estado `EN_CURSO` sobre SQLite, se evidenció que dar de alta una pareja en competencia la dejaba huérfana (sin `ZonaPareja` ni partidos generados), mientras que eliminarla provocaba que la fila en `ZonaPareja` se borrara en cascada pero los partidos permanecieran como registros zombies con `pareja1Id: null` / `ganadorId: null` (`onDelete: SetNull`), corrompiendo las estadísticas de los rivales restantes y alterando el orden/seeding del resto de las parejas.
- **Qué decidí y por qué:**
  1. **Auditoría de consistencia de la base real:** Previo a cualquier cambio, se auditó exhaustivamente la base de datos de producción/piloto ("Impares Agosto"), confirmando que afortunadamente no existían datos corruptos ni partidos zombies (0 parejas flotando y 100% de coherencia matemática en estadísticas de zona).
  2. **Bloqueo estricto en backend:** En `pareja.service.js`, se implementó validación de `categoria.estado === 'BORRADOR'` en `createPareja`, `deletePareja` y `updatePareja`, respondiendo con HTTP 400 y mensaje pedagógico claro indicando que con el torneo en curso debe utilizarse el flujo formal "Agregar Pareja a Zona" desde el detalle de la categoría.
  3. **Ocultamiento completo en frontend:** En `ParejasManager.jsx`, cuando `categoria.estado !== 'BORRADOR'`, se eliminó del DOM el formulario de alta y los botones de borrado por fila (`Trash2`). En su lugar, se renderizó una tarjeta informativa con borde de advertencia y badge `AlertCircle` explicando por qué la edición libre está bloqueada y detallando las opciones disponibles.
- **Alternativas que consideré y descarté:** Solo deshabilitar los campos con `disabled`. Se descartó a favor del ocultamiento total porque mostrar formularios interactivos deshabilitados genera frustración en el usuario y ocupa espacio innecesario en pantalla móvil.
- **Resultado final:** Endpoints y vistas de parejas blindados contra operaciones fuera de ciclo de vida, preservando la integridad de zonas, fixtures y estadísticas del torneo.

### Guard de Estado y Helper Text en Disponibilidad Horaria (`disponibilidad.service.js` y `DisponibilidadEditor.jsx`)
- **Problema o necesidad que motivó el trabajo:** Se identificó que el endpoint de actualización de franjas horarias (`PUT /api/parejas/:id/disponibilidad`) y su componente editor asociado (`DisponibilidadEditor.jsx`) carecían de validación de ciclo de vida por estado de categoría. A diferencia de las altas/bajas de parejas en `ParejasManager` (que creaban parejas huérfanas o partidos zombies con nulos), la mutación de disponibilidad opera exclusivamente sobre la tabla `SlotPareja` sin disparar automáticamente recálculos de compatibilidad ni reprogramación forzada de partidos ya fijados. Posee un caso de uso operativo legítimo durante la competencia en vivo (`EN_CURSO`): permitir que una pareja notifique un cambio sobrevenido en sus franjas disponibles para que el organizador luego reprograme su próximo cruce de forma manual e informada vía `AsignarHorarioModal`. Por consiguiente, un bloqueo ciego en `EN_CURSO` rompería la flexibilidad operativa del club.
- **Qué decidí y por qué:**
  1. **Backend — Bloqueo enfocado únicamente en `FINALIZADO`:** En `disponibilidad.service.js`, se implementó en `setDisponibilidad` (y preventivamente en `setDisponibilidadDoble`) una validación que rechaza peticiones con HTTP 400 y mensaje `"No se puede modificar la disponibilidad de una categoría finalizada."` si `pareja.categoria.estado === 'FINALIZADO'`, manteniendo la edición plenamente permitida en `BORRADOR` y `EN_CURSO`.
  2. **Frontend — Aclaración pedagógica no bloqueante en `EN_CURSO`:** En `DisponibilidadEditor.jsx`, se agregó la prop `categoriaEstado` y un texto auxiliar discreto (`11.5px`, color de texto secundario) acompañado de `<Info size={13} />`, visible exclusivamente en `EN_CURSO`: *"Actualizar esto no reprograma automáticamente los partidos ya asignados. Si la pareja necesita otro horario, usá 'Asignar Horario' en el partido pendiente después de guardar el cambio."* Se evitó un banner grande de advertencia para no sobrecargar visualmente al organizador en una acción de rutina.
  3. **Frontend — Deshabilitación completa en `FINALIZADO`:** Cuando `categoriaEstado === 'FINALIZADO'`, `DisponibilidadEditor.jsx` cancela de raíz la carga innecesaria de turnos del organizador y los sliders de arrastre, renderizando en su lugar una tarjeta informativa limpia con el mensaje *"La categoría ya finalizó. No se puede modificar la disponibilidad horaria."*. Asimismo, en `ParejasManager.jsx` el botón de reloj refleja en su tooltip *"Categoría finalizada — disponibilidad no editable"*.
- **Alternativas que consideré y descarté:** Bloquear también en `EN_CURSO` como en los endpoints de zonas/parejas. Se descartó expresamente porque en torneos reales de fin de semana las parejas sufren imprevistos laborales/personales y necesitan avisar al organizador su nuevo rango horario antes de que se programe la siguiente ronda.
- **Resultado final:** Endpoint protegido contra modificaciones anacrónicas en torneos concluidos, interfaz clara y transparente sobre el alcance de los cambios en vivo, y verificación HTTP automatizada de los 3 estados del ciclo de vida (`BORRADOR`: 200, `EN_CURSO`: 200, `FINALIZADO`: 400).

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

### Operaciones Seguras de Zonas Post-Inicio (`moverParejaDeZona` y `agregarParejaAZona`)
- **Problema o necesidad que motivó el trabajo:** Tras auditar y eliminar el antiguo "Editor Manual de Zonas" (`reestructurarZonas`) por considerarlo destructivo (borraba sin control el cuadro eliminatorio completo, partidos finalizados y sets), persistía la necesidad real de permitir al organizador realizar ajustes acotados con el torneo en curso:
  1. Corregir una asignación errónea de zona (mover una pareja de una zona a otra).
  2. Registrar un alta tardía (una pareja que llega el día del torneo y debe sumarse a una zona existente).
- **Qué decidí y por qué:** Diseñé una arquitectura transaccional segura y atómica basada en dos endpoints separados y especializados:
  1. `POST /api/categorias/:id/zonas/mover-pareja` (`parejaId`, `zonaOrigenId`, `zonaDestinoId`).
  2. `POST /api/categorias/:id/zonas/agregar-pareja` (`jugador1`, `jugador2`, `zonaDestinoId`), que crea la pareja y la asigna en un único paso sin requerir estados intermedios.
  - **Guard de estado y defensa TOCTOU:** Ambas operaciones verifican que la categoría y el torneo se encuentren en `EN_CURSO`, y que **todos los partidos de las zonas involucradas estén en `PENDIENTE`**. Si existe al menos un partido `FINALIZADO` o `EN_CURSO`, la operación se rechaza inmediatamente (HTTP 400). Esta verificación se ejecuta antes de la transacción y se repite de forma atómica como primera consulta dentro de `prisma.$transaction` para cerrar cualquier ventana de condición de carrera.
  - **Invariantes estructurales:** Se valida estrictamente que la zona origen no quede con menos de 2 parejas (lo que rompería el sistema al dejarla sin partidos) y que la zona destino no exceda el máximo de 4 parejas.
  - **Blindaje absoluto de fase eliminatoria y zonas testigo:** Ninguna operación toca partidos con `faseEliminatoriaId != null` ni partidos pertenecientes a otras zonas no involucradas.
  - **Recálculo de formato y scheduling automático:** Las zonas afectadas recalculan su formato (`ROUND_ROBIN` para 2 o 3 parejas, `MINI_BRACKET` para 4 parejas) y cupos de clasificación (2 o 3). Sus partidos se regeneran y se integran al scheduler `asignarHorariosAutomatico(..., tx)`, que se ejecuta dentro de la misma transacción externa (`externalTx`) garantizando atomicidad y consistencia sin deadlocks.
  - **Frontend amigable:** Se desarrollaron los componentes `MoverParejaModal.jsx` y `AgregarParejaModal.jsx`, accesibles desde el menú `⋮` de `CategoriaDetail.jsx`, con validaciones en tiempo real y deshabilitación inteligente de opciones inválidas.
- **Alternativas que consideré y descarté:**
  - *Mantener un modal libre de drag-and-drop de todas las zonas:* Descartado porque permitía reestructuraciones globales masivas e inconsistentes que comprometían el cronograma del club.
  - *Requerir que la pareja exista previamente antes de agregarla a la zona:* Descartado porque la regla del ABM original prohibía crear parejas fuera de BORRADOR; recibir los nombres en el payload simplifica el flujo operativo del organizador en un solo paso seguro.
- **Resultado final:** Operaciones seguras, auditables y validadas mediante tests de integración automatizados (`test-operaciones-zonas.js`) que confirman la preservación del 100% de los fixtures eliminatorios y la correcta reprogramación de las zonas afectadas.

### Rediseño Mobile Responsive de Modales de Zonas y Blindaje Safari iOS
- **Problema o necesidad que motivó el trabajo:** En dispositivos móviles, la primera versión de `MoverParejaModal` y `AgregarParejaModal` presentaba problemas ergonómicos: el contenedor desbordaba verticalmente contra los bordes superior e inferior del viewport, el título quedaba cortado y el botón de confirmación se apretaba contra la barra del navegador con el texto quebrado en dos líneas ("Confirmar Reubicación"). Además, el botón submit vivía en un footer separado usando el atributo HTML5 `form="id"`, una técnica que presenta fallas silenciosas de envío en versiones de WebKit/Safari iOS antiguo y WebViews incrustados. Por último, dentro de un formulario nativo, los botones secundarios sin `type="button"` explícito disparan por defecto el submit al clickearse (ej. cancelar la operación).
- **Qué decidí y por qué:**
  1. **Layout móvil acotado:** Implementé `maxHeight: min(90vh, calc(100dvh - 2rem))` con scroll vertical interno (`overflow-y: auto`) en el cuerpo del formulario, manteniendo fijos el header y el footer y añadiendo `paddingBottom: max(0.85rem, env(safe-area-inset-bottom, 0px))` para despegar las acciones de la barra del celular.
  2. **Acciones en una línea y feedback progresivo:** Reduje los textos a `[ ⇄ Mover Pareja ]` y `[ + Agregar Pareja ]`, asegurando convivencia holgada junto a `Cancelar` en una sola línea horizontal; diseñé badges secuenciales con 3 estados (`completado` con tilde verde, `activo` con glow esmeralda, `pendiente` atenuado) y selects con borde reactivo (neutro en placeholder, verde con glow al seleccionar).
  3. **Blindaje universal Safari iOS:** Convertí el contenedor `.card` completo en el propio elemento `<form onSubmit={handleSubmit} className="card">` con reseteo explícito (`padding: 0; margin: 0; boxSizing: 'border-box'`), alojando al botón de confirmación nativamente dentro del árbol DOM del formulario sin requerir el atributo `form="id"`.
  4. **Seguridad estricta en botones secundarios:** Se aseguró y auditó que tanto los botones "Cancelar" como los botones de cierre "✕" de cabecera declaren explícitamente `type="button"`, previniendo que cierres voluntarios ejecuten mutaciones en el servidor.
- **Resultado final:** Modales 100% responsivos y ergonómicos en móviles (verificados en 375×667), inmunes a problemas de compatibilidad en iPhones y sin riesgo de submits espurios.

### Menú de Acciones Flotante con Clamping de Viewport (`ActionsMenu`)
- **Problema o necesidad que motivó el trabajo:** En viewports angostos entre ~332px y 376px en `CategoriaDetail.jsx`, al hacer click en el botón `⋮`, el panel desplegable (`.actions-menu-panel`) aparecía renderizado casi totalmente fuera de la pantalla hacia la izquierda (solo se veía un fragmento de ~65px con el texto cortado). La causa raíz era que los botones precedentes ocupaban la primera fila y forzaban al botón `⋮` a hacer flex-wrap al inicio de la segunda fila (`left: ~16px`); al tener una regla CSS estática `right: 0`, el panel alineaba su borde derecho al botón y se extendía 195px hacia la izquierda en coordenadas negativas (`left = 52px - 195px = -143px`).
- **Qué decidí y por qué:** Desarrollé un componente reutilizable `ActionsMenu.jsx` que unifica el menú desplegable en `CategoriaDetail.jsx` y `TorneoDetail.jsx`. El panel se monta directamente en el body mediante `createPortal(..., document.body)`, independizándose de cualquier recorte `overflow` o transform de tarjetas padre. Su posición se calcula sincrónicamente en `useLayoutEffect` con clamping bidireccional contra los bordes del viewport: alinea a la derecha por defecto, pero si detecta que desborda a la izquierda (`left < 8px`), conmuta y alinea al borde izquierdo del botón (`Math.max(8, btnRect.left)`), impidiendo cualquier corte. También incorpora detección vertical (flip hacia arriba si no entra abajo) y autocierre al scrollear, redimensionar la ventana o clickear fuera.
### Asignación Directa de Horario en Tarjetas de Partido y Optimización Visual Mobile-First (`PartidoCard.jsx`, `EliminatoriaView.jsx` y `index.css`)
- **Problema o necesidad que motivó el trabajo:**
  1. En la pestaña de detalle de una categoría (`CategoriaDetail.jsx`), los partidos pendientes que no contaban con horario asignado (etiquetados como "Sin horario") no ofrecían un botón directo para asignarles fecha y hora, a diferencia de los partidos programados que sí mostraban el botón "Reprogramar".
  2. Los botones de acción de la tarjeta ("Reprogramar" / "Asignar horario" y "Cargar Resultado") presentaban un desnivel visual vertical apreciable, causado por una regla global de CSS en `.btn-primary` (`margin-top: var(--space-2)` = 8px) que empujaba hacia abajo el botón verde de resultado respecto al botón secundario.
  3. En vista móvil (pantallas $\le 600\text{px}$), el ancho de los dos botones sumado al badge de estado, la fecha, hora y el número de cancha no cabía en una sola fila. Esto provocaba que el texto se rompiera verticalmente de forma desordenada (el horario colisionaba con el texto de la cancha, partiéndose en varias líneas) y que los botones desbordaran lateralmente, generando un molesto desplazamiento horizontal en toda la página. Asimismo, el organizador manifestó que el número de cancha en esa vista no le resultaba de utilidad.
- **Qué decidí y por qué:**
  1. **Asignación directa desde la tarjeta:** En `PartidoCard.jsx`, se condicionó el botón secundario a `isJugable && partido.estado === 'PENDIENTE' && onReprogramar`, mostrando `<Clock size={11} /> Asignar horario` si no tiene fecha/hora o `Reprogramar` si ya está fijada. Se enriquecieron las consultas en backend (`getPartidosByCategoria` y `getFasesEliminatorias`) incluyendo `categoria`, `zona`/`faseEliminatoria` y `slotsSeleccionados` de ambas parejas para que `AsignarHorarioModal` compute su ranking inteligente de sugerencias al instante. Se habilitó soporte idéntico en `MiniBracketView.jsx` y en cruces de llaves eliminatorias (`EliminatoriaView.jsx`).
  2. **Nivelación y alineación geométrica de botones:** Se anuló el margen (`margin: 0`) y se fijó una altura estandarizada de `24px` con `boxSizing: 'border-box'`, `lineHeight: 1`, `display: 'inline-flex'` y centrado vertical en ambos botones, garantizando que queden exactamente a la misma altura pixel a pixel.
  3. **Remoción de cancha y arquitectura responsive mobile-first:** Se eliminó la visualización de la cancha (`· Cancha X`) tanto en `PartidoCard.jsx` como en `EliminatoriaView.jsx`, asegurando el día y horario con `whiteSpace: 'nowrap'`. Para pantallas móviles ($\le 600\text{px}$), se reestructuró la cabecera de la tarjeta en 2 filas limpias: la fila superior (`.partido-card-info`) separa con `justify-content: space-between` el badge de estado a la izquierda y el horario a la derecha ocupando el ancho completo; la fila inferior (`.partido-card-actions`) distribuye los botones con `flex: 1` a lo ancho de la tarjeta, ofreciendo áreas táctiles cómodas y suprimiendo cualquier desborde. Se blindó el viewport global con `overflow-x: hidden` en `html, body`.
- **Resultado final:** Tarjetas de partido 100% operativas, niveladas visualmente, con acceso directo a programación y navegación móvil limpia y sin scroll horizontal.

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

### Continuidad de Día de Torneo: Generación de Cruces, Orden del Domingo y Auto-Scheduling de Ronda 1
- **Problema o necesidad que motivó el trabajo:** Al completar todos los partidos de zonas (viernes y sábado) en la vista operativa "Día de Torneo" (`TorneoEnVivo.jsx`), la pantalla quedaba sin opciones ni próximos pasos. Para avanzar a la fase eliminatoria (domingo), el organizador debía abandonar esa vista, navegar categoría por categoría (`CategoriaDetail.jsx` → "Fase Eliminatoria" → `EliminatoriaView.jsx` → botón "Generar Eliminatoria" / "Asignar Clasificados") para resolver los placeholders ("1°A vs 2°B"). Además, una vez resueltos los cruces, los partidos de Ronda 1 quedaban todos sin horario (`fechaHora = null`, `canchaNumero = null`), obligando a una tediosa asignación manual o a un proceso desconectado.
- **Qué decidí y por qué:**
  1. **Detección y Disparo Centralizado en `TorneoEnVivo.jsx`:** Expuse la lista de categorías con fase de grupos concluida (`categoriasListasParaEliminatoria`) en una sección destacada *"Fase de Grupos Completada"*, permitiendo generar y asignar clasificados a los cruces en 1 clic directamente desde la pantalla operativa sin cambiar de vista ni perder el contexto del evento.
  2. **Prioridad Persistida del Domingo (`ordenDomingo` en `Categoria`):** Agregué el campo `ordenDomingo Int?` a `Categoria` y desarrollé un modal ágil (`OrdenDomingoModal.jsx`) con selectores desplegables `1..N`, accesible tanto desde `TorneoDetail` como desde `TorneoEnVivo`. Esto permite definir el orden de arranque de las categorías en domingo de forma limpia, determinista y editable en cualquier momento previo o durante el torneo, descartando heurísticas frágiles de parseo de strings de nombres o interfaces complejas de reordenamiento drag-and-drop.
  3. **Horarios de Domingo en el Club:** Añadí `domingoInicio` y `domingoFin` a `Organizador`, con edición en `ConfiguracionClub.jsx` y validación estricta en backend (rechaza con error 400 si faltan configurarse, sin fallbacks silenciosos no consensuados).
  4. **Auto-Scheduler Liviano de Ronda 1 (`eliminatoriaScheduler.service.js`):** Diseñé un motor *earliest-fit* puro que toma los partidos de Ronda 1 de domingo en orden de `ordenDomingo ASC` (fallback a `categoria.id ASC`), busca la cancha libre más temprana respetando la grilla del club (`domingoInicio` a `domingoFin`, slots de 75 min con granularidad de 15 min), y valida colisiones simultáneas de las parejas y ocupación de canchas de todo el club. Si la categoría de prioridad 1 ocupa menos canchas que las disponibles en el club, las categorías siguientes entran en paralelo en las canchas restantes sin esperar ni desperdiciar turnos.
  5. **Tratamiento Diferenciado para Dieciseisavos (`esRondaDieciseisavos`):** Regla de negocio que establece que los dieciseisavos de final (`ronda >= 32`) se juegan el sábado a la noche; sus partidos se crean con `sinHorarioAsignado: true` para asignación manual mediante `PartidosPendientesSection` embebida al pie de `TorneoEnVivo.jsx`. Las rondas menores (< 32, ej. octavos o cuartos) se auto-agendan directamente para el domingo.
  6. **Soporte de Domingo en Utilidades:** Extendí `dateUtils.js` (backend y frontend), `slots.service.js` y `zona.service.js` para reconocer "Domingo" en la generación de slots y cálculo de fechas deterministas.
- **Alternativas que consideré y descarté:**
  - Heurístico de ordenamiento automático por parseo de nombres de categoría ("4ta", "5ta Damas") + drag-and-drop manual en el momento de generar cruces: se descartó por frágil ante nombres atípicos y por forzar al usuario a ordenar en el momento de presión operativa del torneo.
  - Fallback silencioso de horario dominical (ej. 08:00 a 22:00): se descartó para evitar decisiones de negocio no explícitas; el sistema exige configuración obligatoria en el club.
  - Asignación manual total de los partidos de domingo: se descartó porque requería abrir modales individuales para decenas de partidos, rompiendo la agilidad del día de torneo.
- **Resultado final:** Flujo continuo de punta a punta: al terminar las zonas, el organizador ve las categorías listas en "Día de Torneo", genera cruces en 1 clic y los partidos de Ronda 1 de domingo se auto-programan en las canchas del club respetando la prioridad definida, listos para jugarse el domingo. Dieciseisavos quedan disponibles para acomodo manual el sábado noche. Suite de tests automatizados (`test-scheduling-domingo.js`) con 100% de cobertura y validación de regresión exitosa.

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
### Resolución Incremental de Conflictos en Pre-Check con Snapshot Estable de Zonas y Asignaciones Inmutables
- **Problema o necesidad que motivó el trabajo:**
  Al iniciar un torneo con incompatibilidades horarias entre parejas y utilizar el asistente `CruceResolver` o la edición manual de disponibilidad, ocurría frecuentemente un **efecto dominó destructivo**: en lugar de reducir el contador de conflictos ($N \rightarrow N-1$), el contador aumentaba o permanecía igual, y partidos que ya tenían horario asignado perdían su turno o cambiaban de hora/cancha.
  - *Diagnóstico Forense:* Cada llamada a `preCheckInicioTorneo` ejecutaba un dry-run completo desde cero. Al aplicar un slot para resolver el cruce entre dos parejas, la función `armarGruposPorCompatibilidad` recalculaba la matriz de compatibilidad global y **desarmaba todas las zonas del torneo**, re-agrupando a las parejas con nuevos rivales con los que volvían a ser incompatibles.
- **Qué decidí y por qué:**
  1. **Sesión de Snapshot Congelado en Memoria (`preCheckSessions`):** El primer dry-run de pre-check genera un snapshot en memoria (`preCheckSessions = new Map()`) indexado por `torneoId`. La distribución de zonas calculada inicialmente queda **100% congelada e inmutable** durante toda la sesión de resolución de cruces.
  2. **Asignaciones Inmutables de Partidos Previos:** Los partidos que obtuvieron `{ fechaHora, canchaNumero }` en el primer dry-run quedan fijados en los mapas de ocupación de canchas (`courtTimelines`) y parejas (`parejaAssignments`). El scheduler incremental nunca vuelve a ejecutar las 3 pasadas globales sobre partidos ya resueltos.
  3. **Evaluación Incremental Monótona (`evaluarAsignacionesIncrementales`):** En cada re-check (`isReCheck: true`), el backend evalúa únicamente los partidos pendientes (`sinHorarioAsignado: true`) contra los huecos libres restantes del timeline (`slotsViables`), garantizando de forma determinista y matemática que el conteo de conflictos disminuya monótonamente ($N \rightarrow N-1 \rightarrow 0$) sin romper ningún partido previo.
  4. **Sliding TTL (Touch-on-Access de 60 min):** Cada interacción con el modal de pre-check o el asistente renueva la expiración de la sesión a 60 minutos, permitiendo al organizador tomarse el tiempo necesario para resolver cruces complejos o comunicarse con las parejas sin perder su progreso si cierra el modal.
  5. **Manejo Seguro de Concurrencia (Node.js Single-Threaded Atomicidade):** En `preCheckInicioTorneo`, la lectura a base de datos se realiza previamente y toda la evaluación incremental sobre el mapa de sesión en memoria se ejecuta de forma **estrictamente síncrona sin ningún `await` intermedio**, eliminando cualquier ventana de carrera entre lectura y escritura del snapshot.
  6. **Resiliencia ante Reinicio de Servidor:** Si el servidor se reinicia o el TTL expira, el backend retorna `sesionReiniciada: true`, y el frontend muestra un banner informativo pedagógico indicando que la vista previa se recalculó con los horarios guardados.
  7. **Re-sorteo Explícito de Zonas (`forceReset: true`):** Se incorporó en el modal un botón secundario discreto *"Re-sortear zonas desde cero"* acompañado de un modal de confirmación pedagógico con advertencia destructiva, permitiendo al usuario barajar de nuevo el fixture completo únicamente cuando lo decida explícitamente.
  8. **Limpieza de Sesión al Iniciar Torneo:** Al invocar `iniciarTorneoMultiCategoria`, el snapshot se elimina de memoria tras persistir las asignaciones en base de datos.
  9. **Suite de Regresión Permanente (`test-precheck-snapshot.js`):** Script permanente que testea y aserta 6 invariantes fundamentales: Snapshot en memoria, Zonas congeladas, Inmutabilidad de partidos asignados, Monotonía decreciente de conflictos ($2 \rightarrow 1 \rightarrow 0$), Preservación al reabrir modal sin `forceReset`, Sliding TTL y Limpieza al iniciar.
  10. **Sanitización de Eventos y Prevención de Estructuras Circulares:** Se envolvieron los handlers de botón en arrow functions (`() => handlePreCheckInicio()`) y se añadió conversión booleana estricta (`=== true`) en frontend y backend, evitando que `SyntheticBaseEvent` de React contamine los parámetros de la petición HTTP y cause excepciones de serialización JSON (`Converting circular structure to JSON`).
- **Alternativas que consideré y descarté:** Volver a correr el scheduler completo con flag `resolucionManual: true` en cada re-check. Se descartó porque `armarGruposPorCompatibilidad` seguía reordenando las zonas y cambiando los rivales de los grupos.
- **Resultado final:** Resolución de conflictos 100% estable, fluida y predecible. Cero efecto dominó, zonas congeladas, tests unitarios y de integración pasando al 100% (`test-precheck-snapshot.js`, `test-modo-dia-torneo.js`, `test-date-parsing.js`).

### Programación Anticipada de Zonas de 4 (Mini-Bracket), Auto-Guardado 1-Click y Refinamiento en Vivo
- **Problema o necesidad que motivó el trabajo:**
  1. En zonas de 4 parejas (formato `MINI_BRACKET`), los partidos 1 (P1 vs P2) y 2 (P3 vs P4) se programaban correctamente, pero los partidos 3 (Ganador vs Ganador) y 4 (Perdedor vs Perdedor) quedaban con `fechaHora: null` y sin cancha asignada, reportándose como "Sin Horario" en el dashboard en vivo. En la operativa real del club, los organizadores necesitan fijar y comunicar el horario de estos partidos de antemano para que las parejas conozcan cuándo juegan según ganen o pierdan.
  2. Al destrabar zonas manuales en el pre-check tocando opciones sugeridas, el flag `requiereArmadoManual` quedaba congelado en el snapshot inicial y nunca se re-evaluaba, impidiendo que la zona se marcara como resuelta.
  3. En `InlineDisponibilidadEditor.jsx`, al tocar un chip de horario estrella ($\bigstar$) se requería un clic secundario en "Guardar", generando fricción respecto a la experiencia de 1-clic del asistente `CruceResolver`.
  4. En la vista `TorneoEnVivo.jsx`, la sección "Estado de Canchas" (grilla de cards individuales Cancha 1, Cancha 2...) resultaba redundante dado que las canchas son operativamente intercambiables en vivo, ocupando espacio vertical valioso y empujando los bloques de "Partidos en Juego" y "Próximos Partidos" fuera del primer viewport.
- **Qué decidí y por qué:**
  1. **Intersección Cuádruple Simultánea de Disponibilidad:** Para los partidos 3 y 4 de mini-bracket, el cálculo de disponibilidad horaria evalúa la intersección simultánea de las 4 parejas de la zona (`interseccionVentanas(P1, P2, P3, P4)`), garantizando que cualquiera de los clasificados pueda jugar la definición sin incompatibilidades sobre la marcha.
  2. **Orden de Dependencia Temporal Estricto en Scheduler:** Se estructuró la asignación en 2 fases consecutivas:
     - *Fase 1:* Se procesan y confirman primero los partidos base (Round Robin y P1/P2 de mini-bracket) mediante el optimizador MCF en 3 pasadas.
     - *Fase 2:* Los partidos 3 y 4 se programan únicamente después de que P1 y P2 de su misma zona tienen horario confirmado, exigiendo que el inicio de P3/P4 sea estrictamente posterior a $\max(\text{Fin}(P1), \text{Fin}(P2))$.
  3. **Reserva Fija de Horario y Cancha:** A P3 y P4 se les reserva cancha y franja horaria fija de antemano (pudiendo jugarse en simultáneo en dos canchas o en turnos contiguos), protegiendo la capacidad global del club.
  4. **Integración con Snapshot Incremental y Pre-Check:** Si la intersección de las 4 parejas no tiene hueco libre post-P1/P2, el pre-check lo reporta limpiamente como `ZONA_MANUAL_INCOMPLETA` con las opciones $\bigstar$ que destraban el grupo. Al agregar disponibilidad, el re-check incremental destraba la zona sin regenerar zonas ni alterar partidos ya asignados.
  5. **Auto-Guardado en 1-Click para Chips Estrella (`InlineDisponibilidadEditor.jsx`):** Se añadió el handler `handleQuickSaveEstrella` que aplica el slot seleccionado, guarda atómicamente en base de datos y dispara el re-check automático en un solo toque.
  6. **Re-evaluación Dinámica de Zonas Manuales (`organizador.service.js`):** `evaluarAsignacionesIncrementales` evalúa en memoria la compatibilidad pairwise de todas las parejas de la zona tras cada cambio. Al comprobar que todas comparten slots, desactiva `requiereArmadoManual = false` y asigna sus partidos en los huecos libres.
  7. **Limpieza Visual y Flujo Natural de `TorneoEnVivo.jsx`:** Se removió la grilla individual de canchas, manteniendo el contador agregado ("Canchas activas: X/Y") en la barra de control superior y preservando intacta la alerta flotante de Canchas Fantasma. Asimismo, se quitó el posicionamiento `sticky` de la barra de canchas activas para que permanezca fija en su lugar natural dentro del flujo del documento y no tape la cabecera ni los partidos al hacer scroll vertical.
  8. **Sincronizador Masivo desde Excel (`actualizar-horarios-parejas.js`):** Script automatizado para importar y actualizar disponibilidades de las 83 parejas del torneo "Pares Agosto" desde `Inscripciones_Padel_Ordenado.xlsx`, reseteando flags de `resolucionManual`.
  9. **Suite de Regresión Dedicada (`test-mini-bracket-scheduling.js`):** Valida dependencias temporales, simultaneidad, incompatibilidades cuádruples y resolución incremental con 100% de éxito.
- **Resultado final:** Zonas de 4 parejas 100% programadas con horario y cancha desde el inicio, UI en vivo enfocada en el juego y resolución de pre-check inmediata y fluida.

### Estabilización Ergonómica de Controles y Edición de Nombre en Día de Torneo (Desktop y Mobile)
- **Problema o necesidad que motivó el trabajo:**
  1. En `TorneoDetail.jsx`, el usuario necesitaba poder renombrar el torneo directamente desde la pestaña del torneo sin buscar opciones secundarias.
  2. En `TorneoEnVivo.jsx`, al desplazarse verticalmente por la página, la barra de canchas activas permanecía fija en la parte superior (`position: sticky`), bloqueando la visibilidad del encabezado y de los partidos al hacer scroll.
  3. Al reducir canchas activas en desktop, la aparición del botón de confirmación alteraba el flujo flex empujando el selector numérico `[- X +]` hacia la izquierda, lo que obligaba al usuario a mover el mouse para volver a pulsar `−`.
  4. En dispositivos móviles (< 640px), debido a `flex-wrap: wrap`, el selector inicial se posicionaba a la izquierda; al presionar `−`, el botón `[ Reducir a 5 canchas ]` se insertaba a su izquierda empujando el control `[- 5 +]` unos ~180px hacia la derecha, sacándolo de debajo del pulgar del usuario.
- **Qué decidí y por qué:**
  1. **Edición en Título con Ícono Discreto:** Integración de edición inline sobre el título `<h1>` de `TorneoDetail.jsx` con ícono de lápiz (`Edit2`), foco y selección automática, confirmación con <kbd>Enter</kbd> y cancelación con <kbd>Escape</kbd>.
  2. **Remoción de `position: sticky`:** La barra de control de canchas activas se integró en el flujo natural del documento (`position: relative`), garantizando un scroll limpio y sin solapamientos.
  3. **Anclaje Fijo del Stepper en Desktop:** Se ajustó el orden visual en `.canchas-control-actions`: el selector `[- X +]` queda anclado en el extremo derecho (`flex-end`), mientras que los botones de acción (`Reducir a X canchas`, `Restaurar todas`) se posicionan a su izquierda, manteniendo el botón `−` exactamente bajo el puntero del mouse.
  4. **Layout Responsivo en Dos Filas en Mobile (`@media (max-width: 640px)`):** Se estructuró `.canchas-control-layout` en dirección columna (`flex-direction: column; align-items: stretch;`). La primera fila contiene la información de estado al 100%, y la segunda fila (`.canchas-control-actions`) ocupa el 100% de ancho con `justify-content: flex-end`. El botón de acción se expande flexiblemente (`flex: 1`) a la izquierda, mientras que el selector `[- X +]` mantiene sus coordenadas $X$ e $Y$ 100% invariables al alternar entre 6, 5 y 4 canchas.
- **Resultado final:** Experiencia táctil y de escritorio óptima y sin fricción, con cero desplazamiento espacial del cursor o pulgar al interactuar con el control de canchas en vivo.

### Modo Lluvia Aislado por Día Lógico (Opción B), Atomicidad Transaccional y UI Contextual
- **Problema o necesidad que motivó el trabajo:**
  1. Al activar el Modo Lluvia un viernes, el scheduler `asignarHorariosModoLluviaMCF` reprogramaba todos los partidos pendientes del torneo completo (incluyendo sábado y domingo), provocando cambios innecesarios y confusión en jornadas futuras que podían jugarse con clima normal.
  2. Al restaurar canchas, existía el riesgo simétrico de redistribuir partidos de jornadas no afectadas o de leer `overrideActivoDesde` post-update reseteado a `null`, rompiendo silenciosamente el alcance del día y reprogramando todo el torneo.
  3. Había una ventana de inconsistencia entre la reprogramación de partidos y la persistencia del override en `Torneo`, en caso de fallas o reinicios intermedios.
  4. En `TorneoEnVivo.jsx`, el contador "Canchas activas: X/Y" y las alertas de canchas fantasma eran globales e indiscriminadas por día, mostrando falsas alarmas sobre partidos del sábado programados en canchas 5/6 mientras el organizador navegaba ese tab.
  5. La tarjeta de feedback de reprogramación persistía al cambiar a solapas de otros días (mostrando cambios del viernes en el sábado); además, el stepper numérico `[- X +]` quedaba trabado en el valor reducido (4) en vez de sincronizarse con las canchas habilitadas de la jornada consultada (6), y el botón "Restaurar todas" aparecía de manera redundante en días donde ya estaban todas las canchas disponibles.
  6. Se produjo una pantalla negra completa al cargar `/en-vivo` debido a la presencia de hooks de React (`useMemo`) ubicados después de retornos condicionales (`if (loading && !data)`), violando las Rules of Hooks.
  7. Al intentar activar el Modo Lluvia en jornadas consecutivas (ej. reducir a 4 canchas el viernes y luego intentar reducir a 4 canchas el sábado), el backend dependía de `new Date()` para inferir la jornada. Al coincidir la fecha real del servidor, el backend interpretaba erróneamente que ambas solicitudes correspondían al mismo día (`esMismoDia: true`), y al ver que `canchasDisponiblesOverride` ya era 4, descartaba la reprogramación del sábado como innecesaria. Como consecuencia, el sábado nunca se reprogramaba y el stepper volvía automáticamente a 6 canchas (agravado porque el polling reseteaba `targetCanchas` mientras el usuario interactuaba con el selector).
- **Qué decidí y por qué:**
  1. **Aislamiento por Día Lógico (Opción B):** El Modo Lluvia afecta únicamente a la jornada lógica en curso calculada determinísticamente con `getDiaCalendarioConTrasnoche` a partir de `overrideActivoDesde`. Los partidos de otras jornadas se tratan como ocupación inmutable (`addInterval`), permaneciendo 100% inalterados en horarios y canchas asignadas.
  2. **Captura Previa y Atomicidad Transaccional Todo-o-Nada:** Se captura `overrideActivoDesde` en variable local antes de cualquier operación y se envuelve la ejecución del scheduler + `tx.torneo.update` en una única transacción atómica `prisma.$transaction(..., { timeout: 15000, maxWait: 5000 })`, garantizando rollback total ante cualquier excepción.
  3. **Backend como Única Fuente de Verdad (`overrideDiaKey`):** `getEstadoEnVivo` calcula y expone `overrideDiaKey` directamente en `torneo`. De este modo, el frontend sólo compara strings simples (`activeTabDay === torneo.overrideDiaKey`) sin duplicar lógica de trasnoche ni arriesgar divergencias por timezone del navegador cliente.
  4. **Filtro Contextual de Canchas Fantasma:** `getEstadoEnVivo` solo califica como "cancha fantasma" a los partidos que pertenecen a la jornada bajo lluvia, permitiendo que los partidos de otras jornadas en canchas 5 y 6 aparezcan normalmente en "Próximos Partidos".
  5. **Contador y Badges Contextuales en `TorneoEnVivo.jsx`:** La UI adapta dinámicamente el contador al tab de día seleccionado (ej: "4/6" en el tab del viernes y "6/6" en el tab del sábado), aclarando el alcance contextual en los modales de confirmación.
  6. **Sincronización Contextual del Stepper y Aislamiento de Acciones:**
     - El selector `[- X +]` se sincroniza automáticamente mediante un `useEffect` con `canchasActivasContextuales`: en el sábado arranca en 6 y en el viernes en 4.
     - El botón "Restaurar todas" se restringe a `isTabBajoOverride`, ocultándose en días donde todas las canchas ya están operativas.
     - El botón de reducción se condiciona contra `canchasActivasContextuales`, permitiendo reducciones independientes por día.
     - La tarjeta de feedback solo se renderiza si el día activo coincide con `feedbackDiaKey` (con backend retornando `overrideDiaKey` y `diaNombre`), y al cerrarla con la `X` se elimina definitivamente (`null`).
  7. **Corrección de Ciclo de Vida y Rules of Hooks:** Se eliminaron llamadas a hooks posteriores a retornos tempranos condicionales, resolviendo las derivaciones de feedback de forma síncrona directa y garantizando que la pantalla nunca se caiga en blanco o negro.
  8. **Determinismo por `diaKey` y Protección del Stepper ante Polling:**
     - El frontend envía explícitamente `diaKey: activeTabDay` tanto en `handleReducir` como en `handleRestaurar`.
     - El backend resuelve el timestamp determinísticamente con `parseFechaLocal(diaKey)`, independizándose del reloj del servidor (`new Date()`).
     - Al comparar `diaAnteriorKey` contra `diaNuevoKey`, el backend detecta el cambio de día (`!esMismoDia`), actualiza `overrideActivoDesde` a la fecha del sábado y ejecuta la reprogramación de los partidos de esa jornada sin ser bloqueado por el override previo del viernes.
     - En el frontend, se protegió la sincronización del stepper contra refrescos por polling: si el usuario está manipulando el selector (`userTouchedTarget === true`), el valor seleccionado no es sobreescrito hasta que cambie de solapa o confirme la acción.
  9. **Suite de Regresión Automatizada (Tests A, B, C, D, E y Concurrencia):** Validación en `test-modo-dia-torneo.js` de inmutabilidad estricta de la jornada siguiente ante reducción y restauración, determinismo contractual del fallback de partidos sin horario contra `torneo.fecha`, desacople estricto entre `timestampOverride` y `diaOverrideTs`, soporte para `diaKey` de frontend (Test D), aislamiento por jornada en validación de partidos `EN_CURSO` (Test E), y ejecución concurrente sin bloqueos de SQLite.
- **Resultado final:** Reducción y restauración de canchas con aislamiento estricto por jornada, persistencia atómica garantizada, soporte multi-día continuo y robusto ante activaciones consecutivas mediante `diaKey`, cero falsas alertas de canchas fantasma, stepper protegido contra polling y reactivo por jornada, y total estabilidad de renderizado en React.

### Protección Temporal y Causal de Eliminatorias en Modo Lluvia (Prevención de Retrocesos de Horario al Restaurar Canchas)
- **Problema o necesidad que motivó el trabajo:**
  Al completar los partidos de la fase de grupos de una categoría y generarse los cruces eliminatorios (por ejemplo, dieciseisavos de final a jugarse el sábado a las 18:00 hs), si el club se encontraba operando bajo Modo Lluvia con capacidad reducida (ej. 4 de 6 canchas) y el organizador restauraba la capacidad a 6 canchas, el horario del primer partido de dieciseisavos se actualizaba abruptamente a las 08:00 AM del sábado.
  - *Diagnóstico Forense:*
    1. En `asignarHorariosModoLluviaMCF` (`zona.service.js`), la búsqueda de turnos comenzaba en `sessionDayStartMs` (08:00 AM). Al restaurar a 6 canchas, las canchas 5 y 6 (que habían estado inactivas y sin partidos asignados durante la mañana) aparecían completamente libres desde las 08:00 AM.
    2. El algoritmo no imponía ninguna restricción causal entre el fin de los grupos y el inicio de los playoffs, ni respetaba el piso temporal del horario ya asignado al partido de eliminatoria. Al evaluar el primer partido de dieciseisavos, el scheduler encontraba Cancha 5 libre a las 08:00 AM y lo reubicaba allí, 10 horas antes de que concluyeran los grupos.
    3. Adicionalmente, los partidos de eliminatorias recién creados sin horario (`faseEliminatoriaId != null` y `sinHorarioAsignado: true` o `fechaHora: null`) eran erróneamente incorporados a la cola de reprogramación automática en lugar de permanecer en la sección de pendientes para asignación manual controlada.
- **Qué decidí y por qué:**
  1. **Exclusión de Eliminatorias No Asignadas:** Modifiqué la recolección de `partidosAAsignar` para omitir explícitamente cualquier partido de eliminatoria sin horario (`p.faseEliminatoriaId && (p.sinHorarioAsignado || !p.fechaHora)`). Estos partidos permanecen como pendientes en `TorneoEnVivo` para su programación deliberada por el organizador.
  2. **Cálculo de Piso Causal de Fin de Zonas (`catZoneFloorMs`):** El scheduler computa dinámicamente el timestamp máximo de finalización de todos los partidos de zona de la categoría (`maxEndPorCategoriaZona = Map<categoriaId, maxEndMs>`). Un partido eliminatorio jamás puede comenzar antes de que termine el último partido de su fase de grupos.
  3. **Piso Temporal No Regresivo (`origStartMs`):** Para partidos de eliminatoria con horario ya asignado, el inicio de búsqueda `minSearchMs` exige como piso: `Math.max(sessionDayStartMs, catZoneFloorMs, origStartMs)`. Esto asegura que al restaurar canchas, un cruce fijado para las 18:00 hs se mantenga a las 18:00 hs (o se mueva a otra cancha libre en esa misma franja), impidiendo cualquier salto hacia el pasado.
  4. **Preservación Estricta de la Compactación en Fase de Grupos:** Para los partidos de zona, la búsqueda continúa iniciando en `sessionDayStartMs`, garantizando que la compactación normal del Modo Lluvia (re-adelanto de partidos de zona a las canchas reabiertas) funcione con total eficacia y sin regresiones en las suites existentes.
- **Alternativas que consideré y descarté:**
  - Imponer un piso global continuo (`getLatestPairEndMs`) para todos los partidos: descartado porque provocaba un efecto de empuje en cascada donde los partidos de zonas se postergaban indefinidamente y desbordaban el límite de la jornada en el Test A.
  - Excluir a todos los partidos de eliminatorias del Modo Lluvia: descartado porque si una cancha asignada a una eliminatoria se desactiva por lluvia, el partido sí debe poder reubicarse dentro de las canchas activas en su franja horaria.
- **Resultado final:** Causalidad temporal 100% protegida. Los partidos de dieciseisavos y eliminatorias conservan su horario de tarde/noche al restaurar canchas y nunca retroceden al pasado. Suite de pruebas dedicada (`test-modo-lluvia-eliminatorias.js`) y 100% de pase en todas las suites de regresión (`test-modo-dia-torneo.js`, `test-scheduling-domingo.js`, `test-mini-bracket-scheduling.js`).

### Auditoría Integral de Lógica de Negocio y Corrección de Casos Borde (Clasificación de Mini-Bracket, Reseteo de Torneo, Invalidación de Pre-Check y Prioridad de Schedulers)
- **Problema o necesidad que motivó el trabajo:**
  En el marco de una auditoría exhaustiva de extremo a extremo sobre la lógica de negocio, coherencia algorítmica e integridad de datos de todo el sistema (backend + frontend), se identificaron 5 inconsistencias sutiles pero de impacto crítico en la experiencia operativa y los resultados deportivos:
  1. **Clasificación en Zonas de 4 (Mini-Bracket):** En `generarEliminatoria`, la selección de clasificados se realizaba tomando `slice(0, zona.clasifican)` sobre la consulta cruda de `zonaPareja` sin ordenar explícitamente por `posicion`. Como en el formato Mini-Bracket tanto el 2° (perdedor del partido de ganadores) como el 3° (ganador del partido de perdedores) finalizan con exactamente 3 puntos y 1 partido ganado, Prisma retornaba los registros en orden arbitrario por inserción, provocando que en ocasiones la pareja que finalizó 3° clasificara al cuadro eliminatorio en lugar de la que finalizó 2°.
  2. **Incompletitud en `reiniciarTorneo`:** Al reiniciar un torneo a estado `BORRADOR`, las parejas mantenían encendido el flag `resolucionManual: true` (a diferencia de `reiniciarCategoria` que sí lo reseteaba), los overrides de Modo Lluvia (`canchasDisponiblesOverride` y `overrideActivoDesde`) no se reseteaban a `null`, y las sesiones en memoria de pre-check (`preCheckSessions`) permanecían huérfanas en el servidor.
  3. **Ausencia de Invalidación Reactiva de Snapshot ante Altas/Bajas de Parejas:** Si el organizador ejecutaba el pre-check, dejaba el modal abierto y simultáneamente agregaba o eliminaba parejas de una categoría, la clave de sesión solo chequeaba `parejasCount`. Al no chequear la identidad de las parejas, el snapshot congelado en memoria intentaba procesar zonas con parejas inexistentes o ignoraba a las recién inscriptas.
  4. **Filtro de `categoriaId` en `eliminatoriaScheduler.service.js`:** `asignarHorariosRondaUno` recibía opcionalmente `categoriaId`, pero al iterar `categoriasListas` para agrupar partidos de Ronda 1 no filtraba por dicho ID, pudiendo reprogramar partidos de domingo de categorías ajenas a la que se estaba resolviendo en ese momento. Asimismo, en Modo Lluvia faltaban las claves `domingoInicio`/`domingoFin` en `horariosClubObj`.
  5. **Prioridad Cronológica de Partidos sin Horario en Modo Lluvia:** En la cola de ordenamiento de `partidosAAsignar`, los partidos con `fechaHora: null` tenían como fallback un timestamp de `0`, colocándose artificialmente al inicio de la cola y compitiendo de forma indebida con partidos previamente pautados en las primeras horas del día (08:00 AM).
- **Qué decidí y por qué:**
  1. **Función Centralizada `ordenarZonaParejas`:**
     - Creada y exportada desde `faseEliminatoria.service.js`, y reutilizada idénticamente en `zona.controller.js` y `public.controller.js`.
     - Para zonas `MINI_BRACKET`, ordena estrictamente por `posicion ASC` (`1 -> 2 -> 3 -> 4`), garantizando que los clasificados sean matemáticamente el 1° (ganó ambos partidos) y el 2° (ganó el primero y perdió el segundo).
     - Para zonas `ROUND_ROBIN`, aplica el desempate oficial de la reglamentación: puntos $\rightarrow$ partidos ganados $\rightarrow$ diferencia de sets $\rightarrow$ diferencia de games $\rightarrow$ games a favor $\rightarrow$ id.
  2. **Limpieza Exhaustiva en `reiniciarTorneo`:** En la transacción interactiva de reseteo del torneo, se añadió:
     - `tx.pareja.updateMany({ where: { categoria: { torneoId } }, data: { resolucionManual: false } })`.
     - Reseteo en `tx.torneo.update` de `canchasDisponiblesOverride: null` y `overrideActivoDesde: null`.
     - Eliminación de la sesión en memoria: `preCheckSessions.delete(torneoId)`.
  3. **Invalidación por Hash de Parejas en Pre-Check:** En `organizador.service.js`, se incorporó `parejaIdsHash = crypto.createHash('md5').update(parejas.map(p => p.id).sort().join(',')).digest('hex')`, almacenándolo en la sesión. Si la nómina de IDs de parejas cambia, la sesión se invalida automáticamente forzando un re-sorteo limpio.
  4. **Filtrado Estricto de Categoría en Scheduler de Eliminatorias:** Se aplicó `if (categoriaId && cat.id !== categoriaId) continue;` al armar los partidos de Ronda 1 a programar para el domingo, y se pasaron `domingoInicio` y `domingoFin` en `reprogramarPorReduccionCanchas`.
  5. **Prioridad Cronológica `Infinity` para Partidos sin Horario:** En `zona.service.js`, se cambió el fallback de ordenamiento de `0` a `Infinity` (`(b.fechaHora ? new Date(b.fechaHora).getTime() : Infinity)`), garantizando que los partidos con horario asignado previo mantengan su turno ganado y no sean desbancados a primera hora de la mañana.
  6. **Suite de Verificación Integral (`test-auditoria-fixes.js`):** Script automatizado con 5 pruebas dedicadas cubriendo cada corrección con aserciones estrictas, logrando el 100% de éxito en ejecución conjunta con todas las suites de regresión existentes.
- **Resultado final:** Cero ambigüedades en clasificación deportiva, reseteos atómicos limpios sin estado residual, resiliencia total ante mutaciones de parejas en pre-check, y schedulers de playoffs y contingencia climática 100% deterministas y seguros.

---

## 24. Brackets Vacíos al Iniciar Torneo y Monitoreo Integral en Día de Torneo

### Visibilidad Temprana de Llaves y Experiencia de Usuario Centralizada en En Vivo
- **Problema o necesidad que motivó el trabajo:** Originalmente, los cruces eliminatorios solo se generaban una vez que todas las zonas de una categoría habían finalizado todos sus partidos. Esto impedía a organizadores y jugadores visualizar el cuadro eliminatorio con sus llaves proyectadas ("1° Zona A" vs "2° Zona B") desde el inicio del torneo. Asimismo, una vez generado, en el panel operativo central de *Día de Torneo* (`TorneoEnVivo.jsx`) no existía ningún enlace ni sección para consultar el cuadro eliminatorio de las categorías, obligando al usuario a salir de la pantalla operativa, navegar al detalle del torneo y entrar a cada categoría individual para ver el bracket.
- **Qué decidí y por qué:**
  1. **Generación Automática de Brackets Vacíos al Iniciar (`organizador.service.js`):**
     - En `iniciarTorneoMultiCategoria`, tras persistir el inicio de las categorías y el sorteo de zonas, se invoca automáticamente `generarEliminatoria(organizadorId, cat.categoriaId)` para cada categoría iniciada.
     - `generarEliminatoria` crea todas las rondas y partidos de la eliminatoria con `pareja1Id: null` y `pareja2Id: null`, asignando etiquetas semánticas de origen (`origenPareja1: "1° Zona A"`, `origenPareja2: "2° Zona B"`, etc.) y marcando BYEs correspondientes.
     - Los BYEs no se marcan como `FINALIZADO` mientras las zonas estén activas (ya que aún no se conoce quién avanza).
     - Al terminar las zonas, la re-ejecución de `generarEliminatoria` detecta las fases existentes y **puebla** las parejas reales sobre las llaves ya armadas, resolviendo automáticamente los BYEs y agendando la primera ronda del domingo.
  2. **Enriquecimiento del Estado en Vivo (`getEstadoEnVivo`):**
     - Se incorporó la colección completa de `categorias` con métricas de zonas y eliminatorias: `estadoEliminatoria` (`ESPERANDO_ZONAS`, `LISTA_PARA_ASIGNAR`, `EN_CURSO`, `FINALIZADA`), progreso de partidos de zona y eliminatoria, y orden de domingo.
     - Se ajustó el conteo de `pendientesSinHorarioCount` para que los partidos futuros de eliminatorias no agendados todavía no disparen falsas alertas rojas de "Sin Horario".
  3. **Sección Permanente "Cuadros Eliminatorios (Brackets)" en `TorneoEnVivo.jsx`:**
     - Reemplazo del bloque condicional aislado por una tarjeta integrada con visualización de todas las categorías.
     - Badges de estado contextuales (`¡Zonas listas!`, `Cuadro armado`, `En disputa`, `🏆 Definido`), barras de progreso de zonas y botón directo *"Ver Bracket"* (`<Link to="...">` con icono `GitBranch`).
     - Alerta visual destacada cuando alguna categoría completa su fase de grupos con botón prioritario *"Asignar Clasificados"*.
  4. **Navegación Fluida Bidireccional:**
     - En `EliminatoriaView.jsx`: Se añadió el botón de retorno rápido *"🏟️ Ir a Día de Torneo"* en la cabecera cuando el torneo está en curso.
     - En `TorneoEnVivo.jsx`: Se añadió el botón *"Vista Pública"* para acceder directamente al link de jugadores en nueva pestaña.
     - En `TorneoDetail.jsx`: Se añadió acceso directo *"Bracket"* en cada tarjeta de categoría junto a *"Administrar"*.
  5. **División Global de Día de Torneo por Jornadas (`TorneoEnVivo.jsx`):**
     - Reestructuración de la vista operativa mediante **Solapas Globales de Jornada** en la cabecera: `[ 📅 Viernes ] [ 📅 Sábado ] [ 🏆 Domingo (Playoffs) ] [ 📊 Todo el Torneo ]`.
     - Cálculo de días canónicos asegurando la disponibilidad de las 3 jornadas (Viernes, Sábado y Domingo) a partir de `torneo.fecha`, con conteos de partidos e indicador visual de partidos en juego (pulsing dot).
     - Selección inteligente por defecto según el estado del torneo (apertura automática en la jornada activa de juego).
     - Filtrado integral contextual por día para: canchas activas y Modo Lluvia, resumen estadístico (total, en juego, programados, finalizados, sin horario), lista de partidos en juego, grilla de próximos partidos y acordeón de partidos finalizados.
     - Enfoque temático: Se retiraron los cuadros eliminatorios de las solapas de **Viernes** y **Sábado** para mantener esas jornadas enfocadas al 100% en la fase de grupos (zonas), reservando los **Cuadros Eliminatorios** de forma estelar para el **Domingo (Playoffs)** y para la vista panorámica **Todo el Torneo**.
     - Banner de alerta cruzada con salto en 1 clic cuando hay partidos disputándose en una jornada diferente a la activa.
  6. **Asignación y Programación 100% Autónoma de Clasificados a Playoffs:**
     - En `partido.service.js`: Implementación de `verificarYAutoAsignarEliminatoria(organizadorId, categoriaId)` disparada en el instante en que el último partido de zona de una categoría pasa a `FINALIZADO`.
     - Inyección inmediata y transparente de parejas clasificadas (`1° Zona A`, `2° Zona B`, etc.) en el bracket eliminatorio generado al inicio del torneo.
     - Disparo autónomo de `asignarHorariosRondaUno` para auto-programar los horarios y canchas del domingo respetando `ordenDomingo` y evitando superposiciones.
     - En `faseEliminatoria.service.js`: Salvaguarda para asegurar que solo los partidos en estado `PENDIENTE` actualicen sus parejas, protegiendo llaves ya iniciadas. Corrección de soporte de seeding cuando clasifican únicamente 1ros de zona (`primeros.slice(M)` en `restoClasificados`).
     - En `TorneoEnVivo.jsx` y `EliminatoriaView.jsx`: Se eliminaron por completo todos los botones manuales de asignación de clasificados (incluido re-sincronizar) y el destructivo botón *"Borrar Bracket"*, blindando el torneo contra accidentes y dejando la UI 100% libre de botones imperativos y centrada exclusivamente en la visualización fluida de llaves (`Ver Bracket`).
- **Resultado final:** Cuadros eliminatorios visualizables desde el minuto cero en vistas públicas y privadas, traspaso y programación automática de playoffs en tiempo real con cero intervención manual, experiencia operativa en Día de Torneo 100% limpia y enfocada por jornada, y cero fricción de navegación.

---

## 25. Scheduling Completo de Eliminatorias al Iniciar Torneo, Inmutabilidad de Orden de Domingo y Tratamiento de BYEs

### Programación Integral de Playoffs desde el Inicio y Blindaje del Cronograma
- **Problema o necesidad que motivó el trabajo:** 
  1. En los cuadros eliminatorios, gran parte de los partidos (Octavos, Cuartos, Semifinales y Finales) permanecían sin horario ni cancha asignados (`fechaHora: null, canchaNumero: null`), postergando la asignación hasta etapas avanzadas del fin de semana. El usuario organizador solicitó expresamente que **desde el primer momento se asignen los horarios y canchas de todos los cruces eliminatorios** para brindar certeza total a los jugadores y al club.
  2. Se estableció como regla de negocio estricta que los **Dieciseisavos de final (`ronda >= 32`) se juegan siempre el sábado por la tardecita/noche**, mientras que el domingo se reserva para las rondas desde Octavos de final hasta las Finales.
  3. El orden de prioridad de arranque del domingo (`ordenDomingo`) podía ser editado durante el transcurso del torneo en vivo, lo que abría la puerta a modificaciones tardías que rompían la planificación de turnos y turnos en disputa. Se solicitó que dicho orden quede fijado e inmutable antes del inicio.
  4. Los partidos con avance libre (BYE) consumían turnos y canchas reales innecesariamente en la grilla del club; adicionalmente, se detectó un desfasaje donde pasar `'Sábado'` con tilde a `proximaFechaPorDia` caía en el fallback de viernes.
- **Qué decidí y por qué:**
  1. **Motor de Scheduling Completo Multi-Ronda (`eliminatoriaScheduler.service.js`):**
     - Diseñé la función unificada `programarHorariosEliminatorias(organizadorId, torneoId, categoriaId, externalTx)`.
     - **Sábado (Dieciseisavos, Ronda $\ge 32$):** Se programa exclusivamente en la franja nocturna del sábado (desde las 18:00hs hasta el cierre del club, post-zonas).
     - **Domingo (Octavos a Finales, Rondas $< 32$):** Se programa mediante un recorrido topológico por niveles jerárquicos (Nivel 0 = primera ronda dominical de cada categoría, Nivel 1 = siguiente ronda, etc.). Las categorías se ordenan por su prioridad `ordenDomingo ASC`, ocupando las canchas más tempranas (ej. 08:00 AM). Las rondas posteriores se calculan garantizando un descanso mínimo de 30 minutos (`MIN_REST_MS`) respecto a los partidos precedentes (padres), con fallback a descanso cero si la jornada se encuentra saturada.
  2. **Detección y Tratamiento Transparente de BYEs (`esPartidoBye`):**
     - Las llaves donde un equipo no tiene oponente (BYE) se identifican de inmediato y se excluyen del timeline de canchas (`fechaHora: null, canchaNumero: null, sinHorarioAsignado: false`), evitando el consumo de turnos ficticios.
     - Su tiempo de finalización computa como 0, permitiendo que la llave subsiguiente avance sin retrasos artificiales de descanso.
  3. **Inmutabilidad Estricta de `ordenDomingo`:**
     - En `categoria.service.js`: `actualizarOrdenDomingoTorneo` valida que `torneo.estado === 'BORRADOR'`, arrojando error HTTP 400 si se intenta alterar con el torneo `EN_CURSO`.
     - En `TorneoDetail.jsx`: El botón *"Orden del Domingo"* solo se visualiza cuando el torneo está en estado `BORRADOR`.
     - En `TorneoEnVivo.jsx`: Se eliminó el botón *"Configurar Orden del Domingo"* y su modal asociado, manteniendo únicamente la lectura informativa de prioridad en las tarjetas.
     - En `OrdenDomingoModal.jsx`: Se explicitó en el texto explicativo que la configuración define la grilla fija de domingo antes de iniciar el torneo.
  4. **Corrección en Soporte de Días con Acento (`zona.service.js`):**
     - Se añadió `'Sábado': 6` al mapa de días canónicos de `proximaFechaPorDia`, asegurando que tanto strings acentuados como sin acento resuelvan con precisión matemática.
  5. **Integración al Inicio Multi-Categoría (`organizador.service.js`):**
     - En `iniciarTorneoMultiCategoria`, inmediatamente después de generar las llaves con `generarEliminatoria`, se ejecuta `programarHorariosEliminatorias(organizadorId, torneoId)` para todas las categorías del torneo en lote.
  6. **Migración en Caliente de Torneos en Curso (`reprogramar-eliminatorias-existentes.js`):**
     - Se ejecutó el script sobre la base de datos local, logrando que el 100% de los cruces de todos los torneos activos (incluido *"Impares Agosto"*) queden con su horario, cancha y secuencia de descanso asignados.
  7. **Suite de Pruebas Automatizadas (`test-eliminatoria-scheduler-completo.js`):**
     - Verificación exhaustiva de 5 puntos clave: edición en borrador, bloqueo 400 en torneo iniciado, 100% de partidos con horario y cancha, respeto de secuencias temporales entre rondas (padres vs hijos con descanso), y limpieza atómica.
- **Resultado final:** Llaves eliminatorias con cronograma 100% definido y predecible desde el minuto uno del torneo, Dieciseisavos estrictamente el sábado noche, orden dominical blindado e inmutable una vez comenzado el torneo, cero canchas desperdiciadas en BYEs, y suite de tests ejecutada al 100% sin regresiones.

---

## 26. Modo Lluvia Independiente por Día (Viernes, Sábado y Domingo) y Eliminatorias con Descansos Reales y Round-Block

### Descansos Humanos en Playoffs, Round-Block y Aislamiento Diario en Modo Lluvia
- **Problema o necesidad que motivó el trabajo:**
  1. **Descansos y sincronización en Playoffs:** A partir de imágenes y fixtures de torneos reales de pádel (categorías pares e impares de circuitos locales provistas por el organizador), se evidenció que en los clubes los brackets no se programan con simple "earliest-fit" partido a partido con descansos marginales de 30 minutos. En la realidad, todos los cruces de una misma fase (ej. los 4 partidos de Cuartos de final) se juegan **en bloque en el mismo horario** ("round-block") o turnos adyacentes si las canchas no alcanzan. Asimismo, entre fases de eliminación directa se requieren **descansos reales y saludables** ($\ge 75$ a 150 minutos entre Octavos y Cuartos, y entre Cuartos y Semis; 30 a 45 minutos antes de la Final).
  2. **Distribución natural del Domingo:** Las categorías con cuadros de 8 parejas que inician directamente en Cuartos de final no deben empezar a las 08:00 AM; su inicio natural de club es al mediodía o primeras horas de la tarde (11:45 a 13:00hs), reservando la mañana para Octavos (08:00hs a 11:30hs), la tardecita para Semis (16:30hs a 18:30hs) y la noche para las Finales (19:00hs a 20:30hs).
  3. **Modo Lluvia Independiente por Día:** En el esquema previo, el modo lluvia operaba como un flag global con un solo campo en la entidad `Torneo`, lo que provocaba que una reducción el viernes afectara la percepción de canchas del sábado o domingo, o requiriera restauraciones forzadas. El organizador requería que el Modo Lluvia sea **100% independiente para cada día: viernes, sábado y domingo**. Si llueve el viernes, se reduce el viernes y el sábado/domingo permanecen intactos al 100% de canchas del club; si llueve el domingo (día 100% de eliminatorias), el sistema debe reprogramar los cruces dominicales sobre las canchas reducidas, preservando partidos en juego/finalizados y garantizando descansos mínimos.
- **Qué decidí y por qué:**
  1. **Servicio desacoplado de persistencia de overrides (`canchasOverrides.service.js`):**
     - Para evitar bloqueos de DLL o errores `EPERM` en el generador de Prisma con el servidor de desarrollo activo, se diseñó un servicio con cache en memoria y persistencia JSON (`canchasOverrides.json`).
     - Permite consultar y mutar overrides de forma independiente por día (`diaKey`), manteniendo sincronizado `Torneo.canchasDisponiblesOverride` en la base de datos para retrocompatibilidad.
  2. **Algoritmo Round-Block con Descansos Reales (`eliminatoriaScheduler.service.js`):**
     - Se implementó la heurística de asignación por lotes de ronda (`tryScheduleBatch`). Todos los partidos pendientes de una misma fase y categoría intentan asignarse simultáneamente en el mismo slot temporal a través de distintas canchas libres.
     - Descansos mínimos humanos garantizados: $\ge 75$ min entre Octavos y Cuartos, $\ge 75$ min entre Cuartos y Semis, y 30 a 45 min previos a la Final.
     - Ventanas dominicales naturales: Octavos a la mañana, Cuartos a partir de las 11:45/12:30hs, Semifinales $\ge 16:15\text{hs}$ y Finales $\ge 19:00\text{hs}$.
     - Soporte para parámetro explícito `canchasOverride` que permite reprogramar el domingo ante reducciones por lluvia.
  3. **Bifurcación en `organizador.service.js` (`reprogramarPorReduccionCanchas`):**
     - Si la jornada lógica corresponde al Domingo (`getDay() === 0`), delega directamente en `programarHorariosEliminatorias(organizadorId, torneoId, null, tx, overrideNum)`. Esto reacomoda los cruces de playoffs en las canchas reducidas respetando partidos en juego y finalizados.
     - Si corresponde a Viernes o Sábado, ejecuta el Scheduler Continuo MCF (`asignarHorariosModoLluviaMCF`).
     - Si no se pasa `diaKey` en una restauración, se ejecutan `clearOverridesTorneo` y reseteo total de overrides.
     - `getEstadoEnVivo` ahora genera y expone `canchasPorDia: { [diaKey]: { canchas, isLluvia, activoDesde } }`, permitiendo que el frontend conozca el estado exacto de cada solapa.
     - La detección de canchas fantasma se aisló estrictamente para que solo evalúe el límite de canchas del día específico del partido, eliminando falsos positivos cruzados.
  4. **Frontend Contextual por Día en `TorneoEnVivo.jsx`:**
     - El selector y stepper `[- X +]` sincronizan dinámicamente con `canchasActivasContextuales` del día activo (`activeTabDay`).
     - Los botones de selección de jornada muestran un badge/icono con nube de lluvia (`CloudRain`) si ese día específico tiene un override activo.
     - La tarjeta de Modo Lluvia y los botones de acción (`Restaurar todas` / `Reducir`) discriminan si la jornada activa está bajo lluvia, si la lluvia está en otra jornada, o si el torneo está en estado normal.
  5. **Suite de Pruebas y Validación:**
     - Se creó `test-modo-lluvia-independiente.js`, validando la reducción aislada de Viernes (2 canchas) sin alterar Sábado ni Domingo (6 canchas), la posterior reducción de Domingo (2 canchas) verificando que ningún cruce dominical supere la Cancha 2, y las restauraciones independientes.
     - Se revalidaron exitosamente al 100%: `test-eliminatoria-scheduler-completo.js`, `test-auto-asignar-eliminatoria.js`, `test-modo-dia-torneo.js` y `test-auditoria-fixes.js`.
     - Build de producción verificado con `npm run build` en frontend (0 advertencias/errores).
- **Resultado final:** Playoffs de domingo con distribución natural, round-block y descansos saludables equiparables a torneos reales de clubes, y Modo Lluvia totalmente independiente y modular para viernes, sábado y domingo.

---

## 27. Diagnóstico y Corrección de Finales sin Horario en Reducción de Canchas Dominical

### Sincronización Decreciente por Rondas y Protección de Cierre de Finales
- **Problema o necesidad que motivó el trabajo:** Al realizar pruebas de Modo Lluvia reduciendo a 4 canchas en torneos con 4 categorías activas (como *"Impares Agosto"*, que totaliza 47 partidos el domingo), se detectó que algunas finales (específicamente la Final de 7ma Damas) quedaban con `sinHorarioAsignado: true` / `fechaHora: null`.
- **Diagnóstico técnico de causa raíz:**
  1. **Desfasaje en el bucle jerárquico por nivel:** El algoritmo iteraba sobre el índice ordinal `level` dentro del arreglo `sundayFases` de cada categoría. Dado que categorías con 8 parejas (como Suma 7) arrancan directamente en Cuartos de Final (Ronda 8), su índice `level = 1` correspondía a Semifinales y `level = 2` a su Final. En cambio, para categorías con Octavos (Ronda 16), `level = 2` correspondía a sus Semifinales y `level = 3` a su Final. Esto provocaba que Suma 7 programara su Final antes de que 7ma Damas programara sus Semifinales, ocupando las canchas del turno 21:45.
  2. **Descanso deseado sobredimensionado:** `DESIRED_REST_CUARTOS_SEMIS_MS` estaba fijado en 150 minutos (2.5 horas, 2 turnos completos de descanso). Cuando los Cuartos de 7ma Damas concluían a las 19:15, el objetivo de búsqueda arrancaba a las 21:45, omitiendo por completo el turno de las 20:30 a pesar de que las Canchas 3 y 4 estaban 100% libres (habiendo ya un descanso completo de 75 minutos). Al saltar a las 21:45, sus Semifinales terminaban a las 23:00, empujando la Final fuera del horario diurno.
  3. **Límite de jornada estricto para Finales:** La condición de corte del día domingo (`T + DURACION_MS <= maxEndAllowedMs`) evaluaba `domDayEndMs` (23:00) o un buffer estrecho de +75m, impidiendo que finales que requieren iniciar a las 23:00 o 23:30 puedan alojarse en la grilla.
- **Qué decidí y por qué:**
  1. **Sincronización Decreciente Universal por Rondas (`allSundayRondas`):** Se transformó el bucle exterior para iterar sobre rondas deportivas unificadas en orden decreciente: `[16, 8, 4, 2]`. Todas las categorías programan primero sus Octavos (08:00 a 13:00), luego todos sus Cuartos (14:15 a 18:00), luego todas sus Semifinales en bloque (19:15 y 20:30) y finalmente todas sus Finales (21:45 y 23:00).
  2. **Detección Dinámica de Padres por Categoría (`hasParentRonda`):** Se reemplazó el check `level > 0` por `hasParentRonda = cat.fasesEliminatorias.some(f => f.ronda === fase.ronda * 2)`. Si una categoría arranca en Cuartos (como Suma 7), no tiene fase previa y se programa naturalmente en el bloque de Cuartos sin violar dependencias ni saltarse turnos.
  3. **Alineación de Descanso Deseado a 75 Minutos:** Tanto el descanso mínimo como el deseado entre Cuartos y Semis se fijaron en 75 minutos (1 turno de juego completo libre), permitiendo que la categoría use canchas libres tempranas (20:30) y no se demore hasta altas horas de la noche.
  4. **Extensión Garantizada para Finales de Campeonato:** Para partidos de Final (`fase.ronda === 2`), se amplió la tolerancia máxima a `domDayEndMs + 2 * DURACION_MS` (+150 min), garantizando que el 100% de los cruces de coronación tengan horario y cancha confirmados.
  5. **Tolerancia de Alineación Temporal:** Se incorporó un margen de tolerancia de 1 segundo (`alignedStartMs < startSearchMs - 1000`) para erradicar saltos indebidos de 75 minutos provocados por diferencias sub-segundo de timestamps.
  6. **Priorización de Debut en Cuartos de Final:** En la ronda de Cuartos de final, se priorizan las categorías que no jugaron Octavos ese día (como Suma 7). Al debutar en el primer turno de Cuartos (14:15), no tienen que esperar hasta las 18:00hs para su primer partido de domingo y, al mismo tiempo, se les otorga un descanso más holgado y reparador (más de 3 a 5 horas) para almorzar a las categorías que disputaron Octavos durante la mañana.
- **Resultado final:** 100% de los partidos del domingo agendados (`partidosSinHorario: 0` en 68 cruces de eliminatorias), debut inmediato de Suma 7 en Cuartos a las 14:15, descansos ideales para todas las categorías y coronaciones garantizadas.

---

## 28. Refactor UI/UX de Detalle de Torneo, Jerarquía Visual y Blindaje de Vista Pública

### Refactorización de Jerarquía Visual en Panel de Torneo y Robustecimiento de Vista Pública
- **Problema o necesidad que motivó el trabajo:**
  1. **Sobrecarga y competencia de jerarquías en `TorneoDetail.jsx`:** La cabecera del torneo presentaba múltiples botones con estilos llamativos compitiendo por atención; la acción destructiva *"Reiniciar Torneo"* estaba expuesta directamente en la barra principal; cada tarjeta de categoría repetía un botón primario sólido *"Administrar"*, badges de estado redundantes (aunque coincidieran con el torneo) y un botón de eliminación de categoría permanentemente visible con riesgo de clic accidental.
  2. **Valores crudos de enum en UI:** Los valores `BORRADOR`, `EN_CURSO` y `FINALIZADO` se mostraban en mayúsculas sin formato amigable para el usuario.
  3. **Fallas en la Vista Pública:** Al ingresar a la vista pública desde *"Día de Torneo"* o ingresando la URL en plural (`/torneos/:slug`), la aplicación renderizaba una pantalla en blanco debido a una discrepancia de rutas con `App.jsx`. Asimismo, la vista pública no importaba la hoja de estilos de llaves (`EliminatoriaView.css`), provocando que los cuadros eliminatorios se vieran deformados, sin columnas y con líneas SVG cruzadas al abrir el enlace público en pestañas nuevas.
- **Qué decidí y por qué:**
  1. **Helper de Mapeo de Estados Legibles (`estadoLabels.js`):** Se creó un helper centralizado para transformar enums a *sentence case* ("Borrador", "En curso", "Finalizado") y se removió la regla CSS `text-transform: uppercase` de `.badge` para respetar el diseño editorial.
  2. **Regla de CTA Único Primario:** Se reservó el estilo sólido `btn-primary` para la única acción principal de avance del torneo (*"Día de Torneo"* o *"Iniciar Torneo"*). Las acciones complementarias pasaron a estilo `btn-ghost`.
  3. **Menú Overflow `⋮` para Acciones Destructivas:** Se confinó la acción *"Reiniciar Torneo"* dentro de un menú desplegable contextual (`MoreVertical`) con cierre automático al hacer clic afuera (click-outside tanto con `mousedown` como con `touchstart` para soporte móvil táctil). Se descartó abstraerlo prematuramente a un componente genérico para no violar el principio YAGNI.
  4. **Badge de Categoría Condicional:** El chip de estado de cada categoría solo se renderiza si difiere del estado global del torneo (`cat.estado !== torneo.estado`), eliminando repeticiones visuales innecesarias.
  5. **Revelado Progresivo del Botón Eliminar:** Se ocultó por defecto (`opacity: 0`) el botón de eliminar categoría, haciéndolo visible mediante CSS puro en `:hover`, en foco de teclado (`:focus-within`) y fallback en dispositivos táctiles (`@media (hover: none)`), con un área de clic y borde consistentes con el botón *"Bracket"*.
  6. **Calibración de Estilo Outline y Micro-Progreso:** Se rediseñó el botón *"Administrar"* en estilo outline (`.btn-outline`) con borde y texto en verde desaturado (`rgba(0, 208, 132, 0.4)` / `0.85`), evitando que 4 botones compitan con el chip de estado ni con el CTA primario. Se agregó una mini barra de progreso (`.progress-bar-mini`, 4px verde esmeralda con glow) vinculada directamente a la métrica de partidos jugados con un espaciado compacto (`3px`).
  7. **Elevación Sutil y Accesibilidad:** Se reemplazó el borde verde llamativo en el hover de las tarjetas por un borde de acero sutil (`rgba(255, 255, 255, 0.18)`), y se incorporó la regla `:focus-visible` global para navegación por teclado.
  8. **Blindaje de Vista Pública:**
     - Se añadió la ruta alias `/torneos/:slug` en `App.jsx` en paralelo a `/torneo/:slug`, garantizando que tanto enlaces singulares como plurales resuelvan la vista pública.
     - Se unificaron los enlaces de navegación usando `<Link>` en `TorneoDetail.jsx` y `TorneoEnVivo.jsx`.
     - Se importó `EliminatoriaView.css` dentro de `TorneoPublic.jsx`, asegurando la carga de layout, columnas y estilos de brackets en cualquier pestaña nueva o ventana privada.
     - Se generalizó el fallback visual *"En Preparación"* para cualquier categoría que no posea zonas ni eliminatorias cargadas.
- **Alternativas consideradas y descartadas:**
  - *Extraer un componente genérico de Dropdown en `components/`:* Descartado para esta etapa por principio YAGNI; implementarlo localmente en `TorneoDetail.jsx` resuelve la necesidad actual sin inventar abstracciones prematuras con un solo caso de uso.
  - *Menú ⋮ por cada tarjeta de categoría:* Descartado para no sobrecargar de menús la pantalla; el revelado progresivo del botón eliminar por CSS puro resultó más liviano y limpio.
  - *Redirección HTTP 301/Navigate para `/torneos/:slug`:* Descartado en favor de registrar ambas rutas con el mismo componente en `App.jsx`, logrando renderizado inmediato sin saltos de URL ni redirecciones intermedias.
- **Resultado final:** Pantalla de detalle de torneo con jerarquía visual de nivel profesional ("Dark Premium Deportivo"), navegación clara orientada a un único botón de acción primario, cero ruido redundante en categorías, y vista pública 100% blindada y estilizada en fixtures y cuadros eliminatorios.

### Sesión 29: Prioridad Automática de Eliminatorias por Clasificados (Reemplazo de `ordenDomingo`)

- **Objetivo:** Reemplazar el orden de prioridad manual del domingo (`ordenDomingo`) por un criterio objetivo, automático y justo basado en la cantidad de parejas clasificadas a eliminatorias por categoría (`cantidadParejasClasificadas DESC`, desempate alfabético).
- **Decisiones de diseño:**
  - A partir del feedback de la dueña del club (quien consideró subjetivo e injusto el orden manual anterior de categorías de menor nivel primero), se evaluaron dos caminos técnicos:
    - *Opción A:* Mantener `ordenDomingo` persistido con recálculo automático y flag `ordenDomingoManual` para overrides manuales.
    - *Opción B (elegida):* Reemplazo 100% automático on-the-fly en el scheduler (`sum(zona.clasifican)` DESC por categoría) y eliminación completa de `ordenDomingo`, `OrdenDomingoModal.jsx`, rutas y campos de base de datos.
  - La Opción B fue elegida por eliminar complejidad innecesaria (sin estado mixto automático vs manual, sin código muerto, sin necesidad de hooks de recálculo al crear o editar zonas, y con ~226 LOC menos en frontend).
- **Implementación técnica:**
  1. **Scheduler de Eliminatorias (`eliminatoriaScheduler.service.js`):**
     - Se añadió `zonas: { select: { clasifican: true } }` a la consulta de categorías del torneo.
     - Se reemplazó la ordenación por `ordenDomingo` por la suma de clasificados `(a.zonas || []).reduce((s, z) => s + (z.clasifican || 0), 0)` en orden descendente, desempatando alfabéticamente por nombre de categoría y por ID.
  2. **Esquema de Base de Datos (`schema.prisma`):**
     - Se removió el campo `ordenDomingo Int?` de la tabla `Categoria`.
     - Se sincronizó la base de datos con `prisma db push --accept-data-loss`.
  3. **Backend Cleanups (`torneo.routes.js`, `torneo.controller.js`, `categoria.service.js`, `organizador.service.js`):**
     - Se eliminó la ruta `PUT /:id/orden-domingo` y el método `actualizarOrdenDomingo` del controller.
     - Se removió la función `actualizarOrdenDomingoTorneo` y la lectura de `ordenDomingo` en `updateCategoria` (evitando campos fantasmas en payloads).
     - Se eliminó `ordenDomingo` de las proyecciones de `getEstadoEnVivo` en `organizador.service.js`.
  4. **Frontend Cleanups (`OrdenDomingoModal.jsx`, `TorneoDetail.jsx`, `TorneoEnVivo.jsx`):**
     - Se eliminó el componente modal `OrdenDomingoModal.jsx` (226 líneas).
     - Se removieron los botones y badges "Dom #N" en `TorneoDetail.jsx`.
     - Se removió la sección "Prioridad Domingo" en `TorneoEnVivo.jsx`.
  5. **Scripts y Tests Actualizados:**
     - Se actualizaron `test-eliminatoria-scheduler-completo.js`, `test-auto-asignar-eliminatoria.js`, `test-auditoria-fixes.js`, `test-scheduling-domingo.js`, `reprogramar-eliminatorias-existentes.js` y `check-impares.js` para operar sin `ordenDomingo`.
     - Todas las suites de tests pasaron al 100%.
- **Resultado final:** Un sistema de asignación de turnos dominicales matemáticamente justo, libre de sesgos de género o nivel, sin configuración manual requerida por el organizador y con una base de código más limpia y mantenible.

### Sesión 30: Backfill Dirigido en Eliminatorias Dominicales y Preservación de Bloques Sincronizados

- **Objetivo:** Resolver canchas vacías en turnos matutinos de eliminatorias dominicales (ej. Cancha 6 a las 09:15hs) sin romper la sincronización por bloques ni generar disparidad de descansos en las rondas de la tarde.
- **Problema o necesidad que motivó el trabajo:**
  1. En torneos con múltiples categorías y 6 canchas (ej. *"Impares Agosto"*), a las 09:15 quedaba la Cancha 6 vacía debido a la distribución natural de partidos (7ma ocupaba 2 canchas y 7ma Damas ocupaba 3), mientras que a las 10:30 y 11:45 había cruces de Octavos de 5ta disponibles para adelantarse.
  2. Surgió el dilema de diseño entre compactar agresivamente la tarde para llenar canchas (ej. fraccionar los Cuartos de 7ma Damas entre 13:00 y 14:15) vs. preservar la equidad deportiva de bloques sincronizados.
  3. Se requirió auditar el flujo de asignación automática de clasificados (`verificarYAutoAsignarEliminatoria`) y clarificar la fórmula horaria de debut en Cuartos de categorías sin Octavos (Suma 7 a las 11:45hs).
- **Qué decidí y por qué:**
  1. **Backfill Dirigido dentro de la misma ronda (Paso 5.b en `eliminatoriaScheduler.service.js`):**
     - Se incorporó un algoritmo determinístico de llenado de huecos tempranos que opera dentro de cada ronda dominical (`for (const rondaTarget of allSundayRondas)`).
     - Si una cancha queda libre en un turno previo (ej. Cancha 6 a las 09:15), busca partidos candidatos de esa misma ronda en turnos posteriores y los adelanta validando descanso individual de parejas ($\ge 75$ min), dependencias parentales y disponibilidad real en la grilla del club.
  2. **Protección Estricta de Bloques Sincronizados (`rondaTarget < 16`):**
     - Para Cuartos de Final, Semifinales y Finales, el backfill prohíbe mover partidos si la categoría juega en un bloque único unificado (`turnosCat.size <= 1`).
     - Se definió como principio de diseño innegociable priorizar el descanso equitativo de los jugadores por sobre la ocupación artificial de canchas intermedias.
  3. **Aclaración y Documentación de Debut en Cuartos (`domDayStartMs + 3 * DURACION_MS`):**
     - Se documentó formalmente que las categorías sin Octavos (Suma 7) abren Cuartos a las 11:45hs (`08:00 + 225 min`), aprovechando 4 canchas libres matutinas y gozando de 3h 45m de almuerzo/descanso antes de sus Semifinales (16:45hs), evitando el choque con 5ta a las 14:15hs.
  4. **Suite de Regresión Permanente (`test-scheduler-backfill-regression.js`):**
     - Validación automatizada de ocupación 6/6 a las 08:00, 09:15 y 10:30, cascada hacia Cancha 6 y prueba de idempotencia en re-ejecución.
- **Resultado final:** Erradicación del hueco matutino en eliminatorias con ocupación perfecta al 100% en los 3 primeros turnos (08:00, 09:15 y 10:30 a 6/6 canchas), bloques de Cuartos de Damas y Suma 7 100% sincronizados y preservados, y sistema de pruebas automatizado.

---

### Sesión 31: Refactor UI/UX de Detalle de Categoría y Tabla de Posiciones Deportiva Responsive

- **Objetivo:** Elevar la jerarquía visual y la usabilidad de la pantalla de detalle de categoría (`CategoriaDetail.jsx`) y su tabla de posiciones (`ZonaTable.jsx`), resolviendo problemas funcionales de responsive (scroll horizontal forzado en tablets de 848px a 1192px y desborde en mobile), eliminando textos redundantes, ordenando acciones en menú overflow y aplicando el sistema de diseño "Dark Premium Deportivo" con jerarquía de 3 niveles en estadísticas deportivas.
- **Problema o necesidad que motivó el trabajo:**
  1. **Problemas funcionales y responsive en la tabla de posiciones:**
     - En dispositivos móviles ($\le 480\text{px}$), la tabla con 8 columnas numéricas se cortaba abruptamente forzando scroll sin indicación visual clara, con encabezados de columnas demasiado anchos para pantallas de 320px–375px.
     - En tablets e interfaces intermedias (rango medido empíricamente de 848px a 1192px, ej. iPad mini y pantallas con layout dividido), `.zona-grid` mantenía forzadamente 2 columnas (`repeat(auto-fit, minmax(380px, 1fr))`), comprimiendo el contenedor de la tabla a menos de 500px y forzando un scroll horizontal antiestético innecesario.
  2. **Regresión visual de truncado y quiebre de línea (post commit 02708f2):** Al intentar fijar anchos de columna rígidos con `table-layout: fixed` y `text-overflow: ellipsis`, los nombres de las parejas ("Barbieri / Lobos", "Amaya / Godoy") se truncaban con "..." incluso en pantallas de escritorio donde sobraban más de 800px libres, y valores de dos dígitos en GAMES ("16 - 14") se partían en dos renglones verticales debido a un padding horizontal residual de 1rem (32px totales por celda).
  3. **Ruido visual y redundancia en cabecera:**
     - Textos repetitivos *"Posiciones — Zona {letra}"* y *"Partidos — Zona {letra}"* que duplicaban la información ya expuesta por los tabs superiores y el título de la tarjeta.
     - Chip huérfano *"Clasifican N"* flotando en la cabecera de la tarjeta sin conexión visual con las parejas que efectivamente avanzaban.
     - Botones de acciones secundarias/destructivas (*"Limpiar Resultados"*, *"Reiniciar Categoría"*) compitiendo por atención con las acciones principales.
     - Badge de estado con valor de enum crudo (`EN_CURSO` en mayúsculas).
  4. **Falta de jerarquía visual en estadísticas:** Puntos (PTS), partidos jugados (PJ), ganados (PG), perdidos (PP), sets y games compartían idéntico peso y color visual, dificultando la lectura y el escaneo ágil que caracteriza a las tablas deportivas profesionales.
- **Qué decidí y por qué:**
  1. **Ingeniería Responsive en Tabla de Posiciones (`ZonaTable.jsx` + `index.css`):**
     - En mobile ($\le 480\text{px}$), se implementaron encabezados duales accesibles: texto completo oculto visualmente con `.sr-only` para lectores de pantalla (`clip`/`absolute`) y abreviaturas visibles de 1 carácter (`.th-short`, ej. `P`, `J`, `G`, `S`).
     - Contenedor con `ResizeObserver` dinámico que activa un gradiente *fade* a la derecha (`.zona-table-container.has-overflow::after`) únicamente cuando existe desborde real.
     - Reducción de la columna de posición `POS` a 32px con padding lateral de 0.25rem.
     - Colapso del layout `.zona-grid` a 1 columna a partir de $\le 1200\text{px}$ (medición empírica confirmada en el rango 848px–1192px), permitiendo que en tablets ambas tarjetas respiren a ancho completo sin scroll, restaurando las 2 columnas únicamente cuando hay $\ge 1201\text{px}$ de ancho disponible.
  2. **Resolución de la Regresión de Truncado y Quiebres:**
     - Se ajustó el padding general de celdas a `0.85rem 0.45rem` (9px laterales en lugar de 32px), liberando más de 180px netos de ancho para la tabla.
     - La columna `col-pareja` se configuró elástica (`width: auto`, sin truncado artificial `ellipsis`), garantizando que los nombres completos se lean sin cortes en desktop y tablets.
     - Se añadió `white-space: nowrap` estricto en celdas y encabezados de `SETS` y `GAMES`, impidiendo fracturas de renglón en marcadores compuestos.
  3. **Jerarquía Visual Deportiva de Tres Niveles:**
     - **Nivel 1 (PTS):** Verde esmeralda vibrante (`var(--color-primary)`), tipografía destacada de `1.1rem` y peso `700`.
     - **Nivel 2 (PG):** Blanco puro de alto contraste (`var(--color-text)`), peso `700`, facilitando identificar inmediatamente a los ganadores.
     - **Nivel 3 (PJ, PP, Sets, Games):** PJ y PP en gris secundario suave (`var(--color-text-secondary)`), y Sets/Games en texto neutro (`font-weight: 500`), logrando una jerarquía visual clara sin fatiga cognitiva.
  4. **Filas Clasificatorias Sutiles:**
     - Reemplazo del chip aislado "Clasifican N" por fondos sutiles `--color-classify-bg` (`rgba(0, 208, 132, 0.05)`) y borde izquierdo distintivo `--color-classify-border` (`rgba(0, 208, 132, 0.6)`) directamente en las filas que clasifican (`posicion <= clasifican`), comunicando el avance de fase de forma orgánica y contextual.
  5. **Despeje de Cabecera y Menú Overflow `⋮` (`CategoriaDetail.jsx`):**
     - Remoción de los títulos redundantes "Posiciones —" y "Partidos —", alineando la vista superior directamente con los tabs de zona.
     - Mapeo de estado mediante `estadoLabel()` para renderizar "Borrador", "En curso", "Finalizado".
     - Reorganización de acciones destructivas ("Limpiar Resultados", "Reiniciar Categoría") en menú contextual desplegable `⋮` (`MoreVertical`) con detector click-outside y touchstart para mobile, despejando la barra superior y previniendo clics accidentales.
- **Validación y verificación visual:**
  - Verificación visual exhaustiva en múltiples viewports (320px, 375px, 820px, 1000px, 1280px) confirmando cero scroll horizontal indeseado, ausencia de truncados prematuros en nombres, perfecta alineación de dos dígitos en games, jerarquía de colores nítida y contraste accesible.
  - Build de producción verificado con `npm run build` en frontend (0 errores, 0 advertencias).
- **Resultado final:** Una pantalla de detalle de categoría y tabla de posiciones 100% pulida, responsive, accesible y visualmente imponente bajo el estándar "Dark Premium Deportivo", sin scroll forzado en tablets, con jerarquía visual clara y navegación intuitiva.

---

### Sesión 32: Operaciones Seguras de Zonas Post-Inicio, Rediseño Mobile y Menú Flotante Clampeado

- **Objetivo:** Construir el reemplazo seguro y no destructivo del antiguo editor manual de zonas para soporte operativo con torneo en curso (mover parejas y altas tardías), rediseñar integralmente la experiencia móvil de los modales bajo estándares de usabilidad táctil y compatibilidad universal en Safari iOS, y resolver el bug de posicionamiento del menú contextual `⋮` mediante clamping bidireccional contra los bordes del viewport.
- **Problema o necesidad que motivó el trabajo:**
  1. La auditoría y eliminación de `ZoneEditorModal` dejó vacante la necesidad real de corregir asignaciones erróneas o incorporar parejas de último momento sin reiniciar el torneo ni destruir el cuadro eliminatorio ni los resultados existentes.
  2. En pantallas de celular, los modales `MoverParejaModal` y `AgregarParejaModal` presentaban desbordes verticales, títulos cortados, textos que se partían en dos líneas y el riesgo latente de fallas silenciosas en Safari iOS/WebViews por usar el atributo externo HTML5 `form="id"`. Además, los botones secundarios sin `type="button"` explícito arriesgaban submits accidentales al cancelar.
  3. En viewports angostos (332px–376px), el botón `⋮` hacía flex-wrap al inicio de la segunda fila y su regla CSS fija `right: 0` arrojaba el 75% del panel fuera de la pantalla hacia la izquierda en coordenadas negativas.
- **Qué decidí y por qué:**
  1. **Endpoints transaccionales especializados:** Implementé `POST /api/categorias/:id/zonas/mover-pareja` y `POST /api/categorias/:id/zonas/agregar-pareja` con guards de estado duplicados dentro de `prisma.$transaction` (bloqueo si hay partidos `FINALIZADO` o `EN_CURSO`), límites estrictos (mínimo 2 y máximo 4 parejas por zona), recálculo automático de formato y cupos, reevaluación de compatibilidad pairwise real para `requiereArmadoManual` y scheduling automático de partidos afectados reutilizando la transacción externa (`externalTx`).
  2. **Arquitectura responsive y blindaje universal Safari iOS:** Modal con `maxHeight: min(90vh, calc(100dvh - 2rem))` y scroll vertical interno, cabecera y pie fijos con `safe-area-inset-bottom`, botones concisos en una línea (`⇄ Mover Pareja`, `+ Agregar Pareja`), badges secuenciales de 3 estados (completado, activo, pendiente), selects con borde reactivo y conversión del card en `<form onSubmit={handleSubmit} className="card">` con `padding: 0; margin: 0; boxSizing: 'border-box'`, conteniendo nativamente al botón submit y asegurando `type="button"` en botones secundarios.
  3. **Componente `ActionsMenu` con React Portal y Clamping de Viewport:** Desacople del dropdown a un componente compartido que renderiza el panel flotante directamente en `document.body` vía `createPortal`, con cálculo sincrónico en `useLayoutEffect` y clamping horizontal (`left = Math.max(8, btnRect.left)` al detectar desborde izquierdo) y vertical, eliminando la duplicación en `CategoriaDetail.jsx` y `TorneoDetail.jsx`.
- **Validación y verificación:**
  - Tests automatizados contra SQLite real (`test-operaciones-zonas.js` y verificación de `requiereArmadoManual`).
  - Smoke tests visuales automatizados en navegador en viewports 320px, 350px (rango problemático), 360px, 375px confirmando panel 100% visible, y validación funcional de apertura fluida de modales destructivos ("Reiniciar Torneo", "Reiniciar Categoría", "Limpiar Resultados").
- **Resultado final:** Un flujo post-inicio 100% robusto, transaccional y seguro, modales táctiles ergonómicos adaptados a cualquier teléfono y menú contextual impecablemente ubicado en cualquier ancho de pantalla.

---

### Sesión 33: Auditoría de Consistencia y Blindaje de Ciclo de Vida en Gestión de Parejas

- **Objetivo:** Auditar la base de datos real del club piloto ("Impares Agosto") para detectar posibles inconsistencias o datos corruptos derivados del uso previo de la pantalla de parejas fuera de borrador, e implementar el blindaje integral del ciclo de vida en backend y frontend para impedir altas o bajas en categorías iniciadas o finalizadas.
- **Problema o necesidad que motivó el trabajo:**
  1. Se detectó que la pantalla de alta/baja de parejas (`ParejasManager.jsx`) y sus endpoints base (`POST /api/categorias/:id/parejas` y `DELETE /api/parejas/:id`) no validaban `categoria.estado`.
  2. Si se creaba una pareja con el torneo en curso, quedaba flotando sin registro en `ZonaPareja` ni partidos asociados.
  3. Si se eliminaba una pareja con el torneo en curso, la cascada de Prisma borraba su registro en `ZonaPareja`, pero dejaba los partidos jugados o programados con `pareja1Id: null` / `ganadorId: null` por la regla `onDelete: SetNull`, corrompiendo la tabla de posiciones y estadísticas de la zona.
- **Qué decidí y por qué:**
  1. **Auditoría profunda de la base real:** Se corrieron consultas de diagnóstico sobre SQLite confirmando que afortunadamente no existían registros zombies ni inconsistencias matemáticas en el torneo del club piloto.
  2. **Bloqueo estricto en backend:** En `pareja.service.js`, se condicionó `createPareja`, `deletePareja` y `updatePareja` a `categoria.estado === 'BORRADOR'`, respondiendo con HTTP 400 y mensaje explicativo claro indicando que con el torneo en curso debe utilizarse "Agregar Pareja a Zona".
  3. **Ocultamiento completo en UI:** En `ParejasManager.jsx`, cuando la categoría no está en `BORRADOR`, se remueve por completo el formulario de carga y los botones de tacho de basura (`Trash2`), sustituyéndolos por un panel informativo destacado (`AlertCircle`) que orienta al organizador hacia las opciones permitidas.
- **Validación y verificación:**
  - Verificación de consultas SQL/Prisma en frío sobre la base de datos de producción.
  - Test HTTP comprobando rechazo 400 al intentar mutar parejas fuera de `BORRADOR`.
  - Verificación visual de la pantalla con categoría `EN_CURSO` confirmando el panel informativo y la ausencia de controles destructivos.
- **Resultado final:** Cierre definitivo del vector de corrupción de datos en altas y bajas de parejas, preservando la integridad del fixture y las tablas estadísticas.

---

### Sesión 34: Guard de Estado y Helper Text en Disponibilidad Horaria

- **Objetivo:** Auditar y blindar el endpoint de actualización de franjas horarias (`PUT /api/parejas/:id/disponibilidad`) y su editor frontend (`DisponibilidadEditor.jsx`), equilibrando la integridad de datos con la flexibilidad operativa que exige la gestión en vivo de un torneo de pádel.
- **Problema o necesidad que motivó el trabajo:**
  1. `PUT /api/parejas/:id/disponibilidad` no validaba `categoria.estado`, permitiendo mutar franjas horarias incluso en categorías concluidas (`FINALIZADO`).
  2. A diferencia de las altas/bajas de parejas, la edición de disponibilidad solo altera la tabla `SlotPareja` y no dispara en automático recálculos de compatibilidad ni reprogramación forzada de partidos ya fijados.
  3. En estado `EN_CURSO` existe un caso de uso operativo legítimo: permitir que una pareja notifique un cambio de disponibilidad de último momento para que el organizador luego reprograme su próximo partido de forma controlada mediante `AsignarHorarioModal`. Bloquearlo en `EN_CURSO` hubiera sido perjudicial para la operativa del club.
- **Qué decidí y por qué:**
  1. **Backend — Bloqueo enfocado únicamente en `FINALIZADO`:** En `disponibilidad.service.js`, se validó que si `pareja.categoria.estado === 'FINALIZADO'`, la petición sea rechazada con HTTP 400 y mensaje `"No se puede modificar la disponibilidad de una categoría finalizada."`, manteniendo la edición permitida en `BORRADOR` y `EN_CURSO`.
  2. **Frontend — Aclaración pedagógica en `EN_CURSO`:** En `DisponibilidadEditor.jsx`, se incorporó un helper text sutil y no intrusivo (`11.5px`) con ícono `<Info size={13} />`: *"Actualizar esto no reprograma automáticamente los partidos ya asignados. Si la pareja necesita otro horario, usá 'Asignar Horario' en el partido pendiente después de guardar el cambio."*
  3. **Frontend — Deshabilitación total en `FINALIZADO`:** En `FINALIZADO`, `DisponibilidadEditor.jsx` no carga grillas ni renderiza sliders interactivos, mostrando una tarjeta informativa limpia indicando que la categoría finalizó y no es modificable.
- **Validación y verificación:**
  - Test HTTP automatizado contra el servidor real verificando código 200 en `BORRADOR`, 200 en `EN_CURSO` y 400 con mensaje de error en `FINALIZADO`.
  - Build de producción frontend verificado (`npm run build`, 0 errores).
  - Verificación visual de los estados condicionales en el componente.
- **Resultado final:** Módulo de disponibilidad seguro contra modificaciones extemporáneas en torneos terminados y con comunicación transparente para el organizador durante la competencia en vivo.

---

### Sesión 35: Asignación de Horario en Tarjetas de Partido, Nivelación Visual y Optimización Mobile-First

- **Objetivo:** Permitir asignar horario directamente desde las tarjetas de partidos sin fecha fija en el detalle de categoría y llaves eliminatorias, corregir la nivelación vertical entre botones de acción, y adaptar el layout del encabezado para eliminar el desplazamiento horizontal y la colisión de textos en dispositivos móviles.
- **Problema o necesidad que motivó el trabajo:**
  1. En `CategoriaDetail.jsx`, los partidos pendientes sin horario solo mostraban el botón "Cargar Resultado"; no había forma directa de agendarlos desde la tarjeta como sí permitía el botón "Reprogramar" en los partidos con horario asignado.
  2. Los botones "Reprogramar" y "Cargar Resultado" aparecían desnivelados verticalmente por un `margin-top: var(--space-2)` (8px) residual heredado de la clase global `.btn-primary`.
  3. En pantallas móviles ($\le 600\text{px}$), el ancho conjunto de los botones, el badge de estado, el horario y el número de cancha excedía el ancho de la tarjeta. El horario colisionaba y se partía en varias líneas ("Viernes", "18:00", "Cancha", "1"), los botones desbordaban lateralmente provocando scroll horizontal en toda la vista y el organizador señaló que la indicación de cancha no le aportaba valor en ese contexto.
- **Qué decidí y por qué:**
  1. **Acción directa de asignación:** En `PartidoCard.jsx`, se habilitó el botón secundario en partidos jugables pendientes sin fecha fija con la leyenda `<Clock size={11} /> Asignar horario`, abriendo `AsignarHorarioModal` en 1 clic. Se enriquecieron las consultas en backend (`getPartidosByCategoria` y `getFasesEliminatorias`) con `categoria`, `zona`/`faseEliminatoria` y `slotsSeleccionados` de ambas parejas para alimentar el ranking inteligente de turnos. Se integró la misma capacidad en `MiniBracketView.jsx` y `EliminatoriaView.jsx`.
  2. **Nivelación geométrica:** Se fijó `margin: 0`, altura idéntica de `24px`, `boxSizing: 'border-box'`, `lineHeight: 1` y centrado vertical flex en ambos botones.
  3. **Remoción de cancha y diseño responsive en dos filas:** Se retiró la indicación de cancha en `PartidoCard.jsx` y `EliminatoriaView.jsx`, asegurando `whiteSpace: 'nowrap'` en el horario. En pantallas $\le 600\text{px}$, el encabezado conmuta a un layout de 2 filas: la fila superior distribuye el badge a la izquierda y el horario a la derecha con `justify-content: space-between`; la fila inferior expande los botones con `flex: 1` a lo ancho de la tarjeta sin desbordar. Se reforzó `overflow-x: hidden` en `html, body`.
- **Validación y verificación:**
  - Build de producción frontend verificado exitosamente (`npm run build`, 0 errores).
  - Inspección de comportamiento en desktop (1 sola fila alineada) y mobile (2 filas fluidas sin scroll horizontal).
- **Resultado final:** Tarjetas de partido consistentes y operativas para asignar y reprogramar turnos en 1 clic, visualmente ordenadas y 100% responsivas en celulares.

---

### Sesión 36: Rediseño UX/UI de Asignar Horario, Jerarquía Visual Dinámica, Fixes de Dominio y Optimización Mobile (≤ 373px)

- **Objetivo:** Rediseñar la experiencia visual y cognitiva del modal de asignación y reprogramación de horarios (`AsignarHorarioModal.jsx`), reducir la densidad de texto y jerarquizar la información bajo el sistema "Dark Premium Deportivo", resolver dos bugs de dominio reportados (turnos de domingo visibles en partidos de zona y orden erróneo de trasnoche) y optimizar el layout para dispositivos móviles estrechos ($\le 373$px).
- **Problema o necesidad que motivó el trabajo:**
  1. **Sobrecarga de texto y baja jerarquía visual en sugerencias:** El modal exhibía párrafos explicativos largos (*"Ambas parejas no tienen ninguna ventana horaria en común..."*), encabezados extensos en mayúsculas fijas (*"SUGERENCIA ÓPTIMA RECOMENDADA"*) y listaba todas las alternativas coordinables desplegadas por defecto, compitiendo con la opción principal e incrementando la fatiga cognitiva del organizador.
  2. **Umbrales estáticos y falta de estructura en la grilla del club:** En "Mostrar todos los turnos del club", el badge de canchas libres utilizaba un umbral fijo ("4+ lib.") que en categorías con pocas canchas dejaba todos los chips en gris opaco sin jerarquía. Asimismo, turnos de mañana, tarde y noche se mostraban amontonados sin separadores entre franjas horarias discontinuas.
  3. **Bugs de dominio en generación y ordenamiento de turnos:**
     - Al asignar horario a un partido de ZONA (Viernes/Sábado), la grilla y alternativas mostraban turnos de Domingo, día reservado exclusivamente para la fase eliminatoria.
     - Los turnos de trasnoche `00:00–00:45` aparecían agrupados al comienzo del Sábado debido a un ordenamiento ingenuo por `hh * 60 + mm` que interpretaba las 00:00 como minuto 0 del día, ubicándolos antes de la apertura matutina (08:00).
  4. **Problemas de visualización en pantallas estrechas ($\le 373$px):** El padding fijo del modal (`1.5rem` = 24px) y del overlay consumía 80px laterales, provocando que los encabezados de día y hora ("Viernes 28 ·", "18:00") se partieran en dos líneas verticales y los chips de canchas se deformaran.
- **Qué decidí y por qué:**
  1. **Jerarquía Visual y Revelado Progresivo en Sugerencias (Sección A):**
     - Se reemplazó el párrafo explicativo por un badge contextual `Sin coincidencia horaria directa`, mostrado condicionalmente únicamente cuando no existe coincidencia de estrella mutua (evitando falsos positivos).
     - Se sintetizó el header en `★ MEJOR OPCIÓN` (o `MEJOR OPCIÓN DISPONIBLE` cuando requiere adaptación), con tarjeta Hero limpia y botón destacado *"Asignar este turno"*.
     - Se implementó revelado progresivo (*progressive disclosure*) con un botón sutil *"Ver detalle"* (`ChevronDown`/`ChevronUp`) para consultar bajo demanda los minutos de ajuste por pareja ($\pm Nm$), manteniendo ocultas por defecto las opciones alternativas en un acordeón secundario colapsado.
  2. **Segmentación Dinámica por Terciles y Divisores de Bloque (Sección B):**
     - Se eliminó el texto en cursiva redundante bajo el toggle de turnos del club.
     - Se implementó cálculo relativo por terciles sobre la libertad real presente (`maxLibertad`), clasificando turnos en alto contraste (tercil superior), contraste medio y bajo contraste. Se contemplaron casos borde para sets pequeños ($\le 2$ valores únicos) con fallback a 2 niveles o contraste completo uniforme.
     - Se añadieron divisores tenues con guiones (`.slot-block-divider`) ante discontinuidades $> 90$ minutos entre turnos consecutivos para diferenciar visualmente la mañana, la tarde y la noche.
  3. **Blindaje de Dominio por Contexto de Partido y Orden Continuo de Trasnoche:**
     - En `slotsValidos`, se discriminó estrictamente el contexto: partidos de zona (`partido.zonaId || partido.zona`) solo admiten Viernes y Sábado (Domingo 100% prohibido); partidos de eliminatoria (`partido.faseEliminatoriaId || partido.faseEliminatoria`) se acotan a Domingo, salvo Dieciseisavos (`ronda >= 32` o nombre conteniendo "dieciseisavos"), que habilitan Sábado noche ($\ge 18:00$) y Domingo.
     - Se implementó `minutosCronologicosJornada(hora)` en `dateUtils.js`: si la hora es menor a 6, suma 24 horas (1440 min), posicionando la madrugada (`00:00–05:59`) cronológicamente después de las 23:45 de la jornada, eliminando la aparición prematura a la mañana y los falsos divisores de bloque.
  4. **Optimización Responsive Mobile-First ($\le 373$px):**
     - En `index.css`, se incorporaron media queries para `@media (max-width: 480px)` (`padding: 1rem 0.75rem`) y `@media (max-width: 380px)` (`padding: 0.85rem 0.55rem`), recuperando hasta 45px de ancho útil.
     - Se aplicó `white-space: nowrap` estricto en días, horarios y botones, y `flex-shrink: 0` en chips de slots, garantizando lectura fluida sin quiebres de línea en dispositivos móviles ultracompactos.
- **Validación y verificación:**
  - Build de producción frontend verificado exitosamente con `npm run build` (0 errores, 0 advertencias).
  - Verificación de suites de tests de regresión del scheduler (`test-scheduler-backfill-regression.js`, 100% pasados).
  - Inspección exhaustiva en emulación móvil (viewports 320px, 360px, 373px, 390px y desktop) confirmando adaptación perfecta sin scroll horizontal, badges condicionales precisos y orden cronológico impecable de trasnoche.
- **Resultado final:** Un modal de asignación y reprogramación de turnos ágil, visualmente limpio y jerarquizado, con lógica de negocio y días de juego 100% consistentes con las reglas del torneo y optimizado para su uso táctil en celulares.

---

## ⏱️ Resumen de Tiempos y Esfuerzo Estimado

El desarrollo de la aplicación se gestionó mediante un ciclo iterativo de 36 sesiones de trabajo, sumando un aproximado total de entre 92 y 108.5 horas de programación, refactorización, depuración y testeo.

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
| **17** | ~3.5 a 4 horas | Resolución Incremental de Conflictos en Pre-Check con Snapshot Estable de Zonas y Asignaciones Inmutables (`preCheckSessions`), eliminación total del efecto dominó en resolución de cruces, monotonía decreciente estricta ($N \rightarrow N-1 \rightarrow 0$), sliding TTL (60 min), mitigación de reinicio de server (`sesionReiniciada`), concurrencia síncrona segura sin `await` intercalado, botón y modal pedagógico de re-sorteo explícito (`forceReset: true`) y suite de regresión permanente (`test-precheck-snapshot.js`). |
| **18** | ~3 a 3.5 horas | Programación anticipada de zonas de 4 (Mini-Bracket: P3 Ganadores y P4 Perdedores) con intersección cuádruple simultánea, orden de dependencia estricto (P1/P2 antes de P3/P4), integración con snapshot incremental y pre-check, 1-click auto-save en chips estrella (`InlineDisponibilidadEditor.jsx`), importador/actualizador desde Excel y suite de regresión dedicada (`test-mini-bracket-scheduling.js`). |
| **19** | ~2 a 2.5 horas | Edición rápida de nombre del torneo en título (ícono lápiz, shortcuts Enter/Esc, acción cabecera), remoción de sticky en barra de canchas en TorneoEnVivo, y estabilización ergonómica espacial del stepper de canchas [- X +] en desktop y mobile (layout flex-end en 2 filas, cero desplazamiento de cursor/touch al reducir canchas). |
| **20** | ~2.5 a 3 horas | Modo Lluvia Aislado por Día Lógico (Opción B): reprogramación estricta solo sobre la jornada afectada, inmutabilidad de partidos de otras jornadas, captura previa de `overrideActivoDesde` en variable local, desacople estricto entre `timestampOverride` y `diaOverrideTs` para soporte multi-día robusto (Test D), validación de partidos `EN_CURSO` scopeada por jornada (Test E), atomicidad todo-o-nada en `prisma.$transaction`, exposición de `overrideDiaKey` en backend como única fuente de verdad, filtrado contextual de canchas fantasma y feedback visual contextual por solapa en `TorneoEnVivo.jsx` con sincronización reactiva del stepper `[- X +]` y cumplimiento de Rules of Hooks. Suite de regresión automatizada (Tests A, B, C, D, E y concurrencia). |
| **21** | ~3 a 3.5 horas | Continuidad de Día de Torneo: detección de categorías listas y generación de cruces en 1 clic (`TorneoEnVivo.jsx`), orden de prioridad del domingo persistido (`ordenDomingo` + `OrdenDomingoModal.jsx`), horarios dominicales en club (`domingoInicio`/`domingoFin`), auto-scheduler earliest-fit de Ronda 1 multi-cancha en paralelo (`eliminatoriaScheduler.service.js`), tratamiento de dieciseisavos sábado noche (`esRondaDieciseisavos`) con `PartidosPendientesSection` y suite de tests automatizada (`test-scheduling-domingo.js`). |
| **22** | ~1.5 a 2 horas | Protección temporal y causal de eliminatorias en Modo Lluvia: exclusión de eliminatorias sin horario de la reprogramación automática, piso temporal estricto (no antes de fin de zonas de la categoría ni antes del horario original pautado), prevención de retrocesos hacia la mañana (08:00 AM) al restaurar canchas y suite de regresión (`test-modo-lluvia-eliminatorias.js`). |
| **23** | ~2.5 a 3 horas | Auditoría Integral de Lógica de Negocio y Corrección de Casos Borde: orden unificado `ordenarZonaParejas` (respeto estricto de `posicion` en Mini-Bracket para clasificar 1° y 2° vs desempate oficial en Round Robin), reseteo atómico en `reiniciarTorneo` (`resolucionManual = false`, overrides de lluvia a `null`, limpieza de snapshot de pre-check), invalidación reactiva por hash de parejas (`parejaIdsHash`), filtrado estricto por `categoriaId` y horas de domingo en schedulers, y prioridad cronológica `Infinity` en colas de Modo Lluvia. Suite de verificación (`test-auditoria-fixes.js`). |
| **24** | ~2 a 2.5 horas | Brackets vacíos al iniciar torneo y monitoreo integral en Día de Torneo: auto-generación de llaves eliminatorias con orígenes semánticos ("1°A vs 2°B") en `iniciarTorneoMultiCategoria`, sección permanente "Cuadros Eliminatorios (Brackets)" en `TorneoEnVivo.jsx` con progreso en tiempo real y botón "Ver Bracket" por categoría, navegación fluida bidireccional ("🏟️ Ir a Día de Torneo" y "Vista Pública"), ajuste de métricas para evitar alertas rojas prematuras en partidos futuros de eliminatorias, y enlace directo a bracket en `TorneoDetail.jsx`. |
| **25** | ~2.5 a 3 horas | Scheduling completo de playoffs al iniciar torneo: auto-asignación de fecha, hora y cancha para todas las rondas (Octavos a Finales) en domingo con descansos de 30 min y prioridad `ordenDomingo`, Dieciseisavos estrictamente sábado por la tardecita/noche, bypass de canchas para BYEs, corrección de `'Sábado'` acentuado, inmutabilidad de orden del domingo tras iniciar torneo (bloqueo 400 y remoción de edición en vivo), reprogramación de torneos existentes en DB y suite de test automatizada (`test-eliminatoria-scheduler-completo.js`). |
| **26** | ~3 a 3.5 horas | Modo Lluvia independiente por día (Viernes, Sábado y Domingo) con persistencia desacoplada (`canchasOverrides.service.js`), playoffs de domingo con descansos humanos saludables ($\ge 75$ min entre rondas tempranas, 30 a 45 min pre-final), asignación sincronizada en bloque de ronda ("round-block"), ventanas dominicales naturales (Octavos mañana, Cuartos mediodía, Semis tarde, Finales noche), delegación de lluvia de domingo a scheduler de eliminatorias y suite de tests (`test-modo-lluvia-independiente.js`). |
| **27** | ~2 a 2.5 horas | Sincronización universal por ronda decreciente en Domingo (`[16, 8, 4, 2]`), resolución de finales huérfanas en reducción de canchas, desacople de fases para categorías directas en Cuartos (Suma 7), calibración de descanso Cuartos-Semis a 75 min (1 turno completo de club), buffer de extensión nocturna para finales de campeonato y tolerancia sub-segundo en grilla horaria. |
| **28** | ~2.5 a 3 horas | Refactor UI/UX Detalle de Torneo (Jerarquía visual, CTA único, menú overflow ⋮, badges condicionales, progreso mini, estilos outline, focus-visible) y Blindaje Vista Pública (soporte dual de rutas `/torneo` y `/torneos`, bracket CSS en vista pública). |
| **29** | ~2 a 2.5 horas | Prioridad Automática de Eliminatorias: reemplazo de orden manual del domingo (`ordenDomingo` y `OrdenDomingoModal.jsx`) por cálculo on-the-fly objetivo (`cantidadParejasClasificadas DESC`, desempate alfabético), remoción de columna en Prisma, limpieza de endpoints y actualización de suite de tests. |
| **30** | ~2.5 a 3 horas | Backfill Dirigido en Eliminatorias Dominicales (Paso 5.b en `eliminatoriaScheduler.service.js`), erradicación del hueco de Cancha 6 a las 09:15hs (6/6 canchas llenas a 08:00, 09:15 y 10:30), protección estricta de bloques sincronizados en Cuartos/Semis/Finales (`rondaTarget < 16`), clarificación y verificación de debut en Cuartos de cuadros sin Octavos (Suma 7 a las 11:45hs) y suite de regresión (`test-scheduler-backfill-regression.js`). |
| **31** | ~3.5 a 4 horas | Refactor UI/UX de Detalle de Categoría: tabla de posiciones responsive (table-layout fixed, columna pareja elástica, nowrap en sets/games, mobile .sr-only/.th-short), colapso de grid a 1 columna en $\le 1200\text{px}$ (rango 848–1192px sin scroll), jerarquía visual de estadísticas (PTS verde esmeralda, PG blanco, PJ/PP gris secundario), filas clasificatorias estilizadas sin chip huérfano, menú overflow ⋮ para acciones secundarias y remoción de encabezados redundantes. |
| **32** | ~3.5 a 4 horas | Operaciones seguras de zonas post-inicio (`mover-pareja` y `agregar-pareja` atómicas y transaccionales), rediseño responsive mobile de modales con blindaje universal Safari iOS (`<form>` contenedor nativo y `type="button"` en botones no-submit) y componente `ActionsMenu` flotante con clamping de viewport via Portal (resolución definitiva de corte en pantallas $\le 376\text{px}$). |
| **33** | ~1 a 1.5 horas | Auditoría de consistencia en base de datos SQLite real y blindaje del ciclo de vida de parejas: bloqueo backend 400 por `categoria.estado !== 'BORRADOR'`, ocultamiento total de formulario de alta y botones de borrado en `ParejasManager.jsx` con panel informativo pedagógico. |
| **34** | ~1 a 1.5 horas | Guard de estado en disponibilidad horaria (`PUT /api/parejas/:id/disponibilidad` y `DisponibilidadEditor.jsx`): bloqueo HTTP 400 exclusivo en `FINALIZADO`, helper text pedagógico para reprogramación manual en `EN_CURSO` y deshabilitación total en `FINALIZADO`. |
| **35** | ~1 a 1.5 horas | Asignación directa de horario en tarjetas de partidos pendientes (zonas y brackets), eliminación de indicador de cancha, nivelación visual de botones de acción y diseño responsive en 2 filas sin desborde horizontal para mobile ($\le 600\text{px}$). |
| **36** | ~2 a 2.5 horas | Rediseño UI/UX de `AsignarHorarioModal` (jerarquía visual, badge condicional `Sin coincidencia directa`, hero card simplificada, disclosure progresivo inline, terciles dinámicos para disponibilidad de canchas y separadores de bloque $> 90\text{m}$), filtrado contextual estricto por tipo de partido (zonas solo V/S vs eliminatorias D/S noche), orden cronológico continuo de trasnoche (`minutosCronologicosJornada`) y optimización responsive para celulares estrechos ($\le 373\text{px}$). |
| **Total** | **~92 a 108.5 hrs** | Implementación Full-Stack integral con jerarquía de torneos y categorías, scheduling continuo en tres pasadas con prioridad manual y dependencias mini-bracket, pre-check transaccional con snapshot estable e incremental, asistente de resolución de cruces, modo día de torneo en vivo con reprogramación por lluvia aislada por día (Opción B) y protección causal de eliminatorias, brackets visualizables desde el minuto cero, scheduling completo de playoffs al inicio con descansos y sincronización universal de rondas dominicales, prioridad automática de playoffs por parejas clasificadas, backfill inteligente de eliminatorias con preservación de bloques sincronizados, modo lluvia independiente por día (V/S/D), refactor UI/UX deportivo de alta jerarquía en detalle de torneo y de categorías, tablas de posiciones responsivas sin scroll forzado, operaciones seguras post-inicio con modales ergonómicos, blindaje de ciclo de vida en parejas y disponibilidad, asignación directa de horarios en tarjetas de partidos con nivelación visual y optimización mobile-first sin desborde, rediseño de asignación/reprogramación con disclosure progresivo, terciles dinámicos, consistencia de dominio en días y trasnoche, y menús móviles universales. |

> **Nota:** esta tabla cubre únicamente las sesiones de codificación y depuración técnica. No incluye el tiempo dedicado a definición de producto, validación con usuarios, diseño UX/UI en wireframes, revisión de pantallas y planificación de alcance (secciones 6 a 8), que representan trabajo adicional real de la Práctica Profesional Supervisada.