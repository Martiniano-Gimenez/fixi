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

### Desacople de Edición de Torneo y Especialización del Modal de Fecha (`TorneoDetail.jsx`)
- **Problema o necesidad que motivó el trabajo:** En la cabecera de `TorneoDetail.jsx`, existían dos mecanismos superpuestos para editar el nombre del torneo (la edición inline en el propio título `<h1>` y un botón redundante "Editar Torneo" en la botonera de acciones que abría un modal general de nombre y fecha). Esto generaba saturación visual en la barra de acciones, violaba la jerarquía de CTA único y mantenía un modal mixto innecesario.
- **Qué decidí y por qué:**
  1. Quitar el botón "Editar Torneo" de las acciones principales de la cabecera, preservando solo las acciones de navegación/compartir ("Copiar Link", "Ver Público", ⋮) y el CTA primario de alta jerarquía ("Día de Torneo" o "Iniciar Torneo").
  2. Especializar el modal abierto por el botón de fecha de la cabecera (ícono de calendario y lápiz) para que sea exclusivamente "Editar Fecha del Torneo", eliminando de raíz el campo de nombre del torneo, el estado `editNombre` y sus validaciones asociadas.
  3. Enviar en el submit del modal únicamente el payload `{ fecha: editFecha || null }` a `PUT /api/torneos/:id`, aprovechando que la función `updateTorneo` en el backend soporta actualizaciones parciales y preserva el nombre existente sin tocarlo.
  4. Retirar el `autoFocus` del selector de fecha para que en dispositivos móviles no se dispare invasivamente el datepicker o teclado nativo al abrir el modal.
  5. Asegurar un layout responsive mobile (≤ 480px y ≤ 376px) en la cabecera y el pie de botones del modal con `flexWrap: 'wrap'`.
- **Alternativas que consideré y descarté:** Se consideró implementar edición inline también para la fecha (con un input date directo en la línea de metadatos), pero se descartó para mantener intacto el modal con su texto de ayuda sobre slots de Viernes y Sábado y evitar problemas ergonómicos con selectores de fecha en línea.
- **Resultado final:** Cabecera limpia y minimalista, cero redundancias en la edición del nombre, modal de fecha específico y ergonómico, estado frontend 100% limpio (0 referencias a `editNombre`) y verificación estática con `oxlint -D no-undef` (0 errores).

### Blindaje y Guard de Fecha de Torneo Fuera de BORRADOR (`torneo.service.js` y `TorneoDetail.jsx`)
- **Problema o necesidad que motivó el trabajo:** `torneo.fecha` es la única fuente de verdad para el cálculo de slots horarios, las pestañas de días en Día de Torneo (`TorneoEnVivo.jsx`), la determinación de la jornada lógica en Modo Lluvia y el scheduler de eliminatorias del domingo. Si un organizador modificaba o vaciaba la fecha una vez que el torneo ya estaba en curso o finalizado, se desincronizaban los turnos, las fechas calculadas de los partidos y las jornadas operativas. Sin embargo, el botón/lápiz de fecha en la cabecera de `TorneoDetail.jsx` permanecía activo en cualquier estado y el endpoint de backend `PUT /api/torneos/:id` no validaba el estado del torneo al recibir `data.fecha`.
- **Qué decidí y por qué:**
  1. **Backend — Guard en `torneo.service.js`:** En la función `updateTorneo`, se implementó una validación estricta que lee el estado real del torneo desde la base de datos. Si `torneo.estado !== 'BORRADOR'` y `data.fecha !== undefined`, compara la fecha recibida con la actual normalizándolas mediante `parseFechaLocal`. Si la fecha cambia (o si se intenta vaciar a `null`), rechaza la petición con HTTP 400 y el mensaje claro: `"No se puede modificar la fecha de un torneo que ya inició. Reiniciá el torneo para poder cambiarla."`. Si la fecha enviada es igual a la existente, o si no se envía el campo `fecha` (como ocurre en la edición inline del nombre), la operación continúa sin bloqueos.
  2. **Frontend — Chip de fecha de solo lectura en `TorneoDetail.jsx`:** Cuando `torneo.estado !== 'BORRADOR'`, el botón interactivo de fecha (calendario + fecha + lápiz) se transforma en un elemento `<span>` de solo lectura que conserva exactamente el mismo aspecto visual y dimensiones (mismo padding, border y tipografía) para evitar saltos o shifts en la cabecera, omitiendo el ícono de lápiz y deshabilitando la apertura del modal. Se le añade el atributo accesorio `title="La fecha no se puede cambiar una vez iniciado el torneo"`. En estado `BORRADOR`, se mantiene el `<button>` interactivo con lápiz y modal.
  3. **Frontend — Defensa en profundidad:** Si por alguna razón el modal llegara a abrirse y el backend respondiera con HTTP 400, el manejador del modal captura el mensaje de error y lo muestra en pantalla sin cerrarse en silencio ni dejar inconsistente el estado local.
  4. **Suite de tests de regresión (`test-torneo-fecha-guard.js`):** Se creó un script de verificación automatizada que cubre exhaustivamente: torneo en `BORRADOR` (cambio y vaciado OK), torneo en `EN_CURSO` (cambio y vaciado bloqueados con 400, misma fecha y cambio solo de nombre OK), torneo en `FINALIZADO` (bloqueo 400), ciclo post-reinicio a `BORRADOR` (fecha vuelve a ser editable) y aislamiento multitenant (rechazo 403 a organizadores ajenos).
- **Alternativas que consideré y descarté:** Descarté bloquear todo el endpoint `updateTorneo` en `EN_CURSO`/`FINALIZADO` porque la edición inline del nombre del evento debe seguir permitida en cualquier estado del torneo. También descarté validar únicamente en el controller o confiar en el estado enviado por el cliente; la verificación en el service contra el registro persistido en la DB garantiza integridad absoluta.
- **Resultado final:** Inmutabilidad garantizada de la fecha de inicio una vez comenzada la competencia, preservando la coherencia de slots y schedulers, con una interfaz que comunica claramente la restricción sin alterar la experiencia en borrador ni la edición rápida del nombre.

### Pulido de Pantalla de Parejas por Categoría (`ParejasManager.jsx`)
- **Problema o necesidad que motivó el trabajo:** Al salir del estado `BORRADOR`, la pantalla de gestión de parejas (`ParejasManager.jsx`) exhibía un panel lateral izquierdo ancho ("Edición Bloqueada") con dos párrafos extensos y color de advertencia fuerte, reduciendo la lista de parejas a la mitad de la pantalla y mostrando textos con jerga técnica de desarrollo ("limitación conocida", enums en mayúsculas crudas como `EN_CURSO`). Además, el chip de disponibilidad mostraba turnos crudos de 15 minutos en lugar de horas legibles, sin advertir visualmente si la disponibilidad declarada era insuficiente para disputar al menos un partido reglamentario (75 min). En torneos en curso tampoco se visualizaba a qué zona pertenecía cada pareja ni el avance de sus partidos, y en categorías con muchas parejas no había buscador.
- **Qué decidí y por qué:**
  1. **Banner informativo fino y lista al 100%:** Reemplazar el panel izquierdo por un banner sobrio y compacto arriba de la lista (1 o 2 líneas) cuando la categoría no está en `BORRADOR`. Esto otorga todo el protagonismo a la lista de parejas a ancho completo, manteniendo el layout de 2 columnas solo en `BORRADOR` para el formulario de alta. Copy contextual diferenciado: para `EN_CURSO` orienta hacia *"Agregar pareja a zona"* en el detalle de la categoría; para `FINALIZADO` aclara que la nómina se encuentra cerrada.
  2. **Limpieza de jerga técnica y enums:** Erradicar expresiones internas y mapear los estados mediante `estadoLabel()` ("En curso", "Finalizado"), explicando las restricciones en términos del organizador (integridad de fixtures y estadísticas).
  3. **Métrica amigable de disponibilidad e indicador crítico:** Convertir los slots de 15 min a horas legibles mediante `formatHorasDisponibles` (ej. 20 turnos = "5 h", "1 h 15 min", "15 min"; 0 slots = "Sin restricción" fuera de borrador / "Sin cargar" en borrador). Si una pareja cargó disponibilidad pero la suma de turnos es inferior a la duración reglamentaria de un partido (`cantSlots > 0 && cantSlots < 5`, es decir, $<75$ min), el chip se resalta con estilo de advertencia (`var(--color-warning)`) e ícono `AlertTriangle`.
  4. **Zona y progreso de partidos:** En categorías fuera de `BORRADOR`, mostrar en cada fila un chip con la zona ("Zona A") y la fracción de partidos disputados ("1/3 jugados"), enriqueciendo la consulta de backend con un `include` quirúrgico en `pareja.service.js` con autorización multitenant estricta.
  5. **Buscador en tiempo real:** Implementar buscador insensible a mayúsculas y acentos (`normalizeText`) con botón de limpieza (X), contador dinámico ("3 de 23 inscriptas") y estado vacío contextual, activado cuando hay más de 8 parejas (`> 8`).
  6. **Jerarquía y mobile-first:** Subtítulo con el nombre del torneo bajo el título de categoría, conservación de numeración correlativa (`#1`, `#2`...), contenedores elásticos con `min-width: 0` y `flex-wrap` asegurando legibilidad perfecta sin scroll horizontal en anchos desde 320px hasta escritorio.
- **Alternativas que consideré y descarté:** Consideré mostrar el buscador siempre (incluso con 3 parejas), pero se descartó porque en nóminas cortas que caben en una sola pantalla agrega ruido visual innecesario (se estableció el umbral en $>8$ parejas). También evalué un endpoint separado para zonas y progreso, pero un include mínimo en `getParejasByCategoria` resultó mucho más eficiente y atómico.
- **Resultado final:** Pantalla de parejas jerárquica y deportiva, lista a ancho completo con datos ricos y útiles por fila (horas legibles, alerta crítica, zona y progreso), buscador instantáneo, cero vocabulario interno y responsive mobile blindado por código.

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

### Refinamiento de Modo Lluvia: Sincronización de Stepper, Chip Limpio por Jornada, Admisión de Dieciseisavos sin Parejas y Ciclo de Vida de `partidosSinSlot`
- **Problema o necesidad que motivó el trabajo:**
  1. *Desfase de UI al restaurar canchas en `TorneoEnVivo.jsx`:* Al bajar canchas (ej. de 6 a 4 en Sábado) y luego tocar "Restaurar todas (6)", los partidos se reprogramaban bien en el backend pero en el frontend el stepper numérico quedaba trabado en 4 (porque `userTouchedTarget` bloqueaba la sincronización reactiva) y el chip de Modo Lluvia no se actualizaba inmediatamente al faltar un refetch síncrono.
  2. *Chip con formato de hora confuso:* El badge de Modo Lluvia mostraba `Modo Lluvia (Sábado 12:00)`, donde la hora de activación (`12:00`) generaba confusión visual respecto a los horarios de los partidos. Se solicitó retirar el horario y mostrar únicamente la jornada (`Modo Lluvia (Sábado)`).
  3. *Exclusión indebida de dieciseisavos sin parejas en canchas inhabilitadas:* En Modo Lluvia (ej. 4 canchas activas), los dieciseisavos de sábado programados a las 20:45 hs en Canchas 5 y 6 que aún no tenían parejas físicas asignadas (`pareja1Id/pareja2Id: null`, esperando los clasificados de zona) eran ignorados por el scheduler MCF y quedaban varados en canchas fantasma con un mensaje erróneo de "horario anterior a la activación".
  4. *Ciclo de vida y aislamiento de `partidosSinSlot`:* Se requería garantizar que restaurar una jornada (`removeOverrideDia`) limpie por completo los motivos de partidos sin slot de esa jornada, que cada nueva reprogramación reemplace el mapa completo en vez de acumular registros obsoletos, y que en `getEstadoEnVivo` el motivo `"Sin cancha activa libre disponible en ese horario"` solo se asigne si el partido continúa `PENDIENTE` y en cancha inhabilitada (`canchaNumero > canchasMaxDia && esDelDiaLluvia`), evitando fugas de motivos viejos cuando el partido es reasignado, jugado o cuando se restauran las canchas.
- **Qué decidí y por qué:**
  1. *Sincronización robusta del stepper y refetch inmediato en `TorneoEnVivo.jsx`:*
     - En `handleRestaurar`, reseteo explícito de `setTargetCanchas(canchasClub)` y `setUserTouchedTarget(false)`.
     - Invocación de `fetchAndResetPolling()` tras la restauración para sincronizar `canchasPorDia` y el estado del torneo sin esperar al siguiente ciclo de polling.
     - Derivación estricta de `isTabBajoOverride` a partir de `diaInfoContextual.canchas < canchasClub`.
  2. *Chip limpio sin horario con `formatDiaNombre` (`dateUtils.js` y `TorneoEnVivo.jsx`):*
     - Creación de la función utilitaria `formatDiaNombre(fechaHora)` en `dateUtils.js` para extraer únicamente el nombre del día en español sin componente de tiempo.
     - Actualización del renderizado del chip para mostrar `Modo Lluvia (Sábado)` de forma limpia y concisa.
  3. *Admisión de cruces sin parejas en `asignarHorariosModoLluviaMCF` (`zona.service.js`):*
     - Admisión de partidos eliminatorios con horario en canchas inhabilitadas (`p.faseEliminatoriaId && p.fechaHora && !p.sinHorarioAsignado && p.canchaNumero > cantidadCanchas`), aun cuando sus parejas sean `null`.
     - Tratamiento especial para partidos sin parejas: no registrar claves `null` en los mapas de ocupación de parejas, permitiendo que cruces independientes jueguen simultáneamente en canchas distintas dentro del rango habilitado ($1 \dots N$).
     - Preservación no destructiva: si no existe slot libre antes del límite diario (`dayLimitMs`), el partido conserva su cancha y horario asignado (sin marcar `sinHorarioAsignado: true`), registrando el motivo explicativo `"Sin cancha activa libre disponible en ese horario"`.
  4. *Gestión limpia de `partidosSinSlot` (`canchasOverrides.service.js` y `organizador.service.js`):*
     - `removeOverrideDia(torneoId, diaKey)` elimina la clave de la jornada por completo, dejando `partidosSinSlot: {}`. En `reprogramarPorReduccionCanchas`, la restauración por jornada remueve el override específico y la restauración global limpia todo el torneo (`clearOverridesTorneo`).
     - `setOverrideDia` asigna `{ ...partidosSinSlot }`, reemplazando el mapa completo en cada corrida sin acumulaciones.
     - En `getEstadoEnVivo`, la asignación del motivo se resguarda bajo la condición estricta: `p.estado === 'PENDIENTE' && p.canchaNumero > canchasMaxDia && esDelDiaLluvia`.
  5. *Tests de integración y terminación limpia:*
     - Incorporación de tests automatizados para ambos casos en `test-modo-lluvia-eliminatorias.js`.
     - Inyección de `process.exit(0)` tras `prisma.$disconnect()` en las suites de test para evitar procesos colgados por conexiones en espera.
- **Resultado final:** UI de Día de Torneo 100% reactiva y limpia (stepper que vuelve a 6, chip sin horas confusas), reubicación automática de cruces sin parejas a canchas activas en paralelo, preservación no destructiva ante saturación de turnos, aislamiento estricto de motivos sin persistencia residual y 100% de tests aprobados en las 3 suites del proyecto.

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

### Sesión 37: Simplificación, Jerarquía Visual y Optimización Mobile en Partidos Pendientes

- **Objetivo:** Reducir texto redundante y eliminar alertas pasivas intermedias en el banner de partidos pendientes (`PartidosPendientesSection.jsx`), corregir la jerarquía visual elevando el botón de acción al verde primario deportivo del sistema (`var(--color-primary)`), alinear el chip de Zona al margen interior de la tarjeta, y resolver el problema de desborde y visualización en pantallas móviles estrechas ($\le 410$px).
- **Problema o necesidad que motivó el trabajo:**
  1. **Texto redundante en cabecera:** El banner exhibía un subtítulo largo (*"Cruces que iniciaron sin horario y deben coordinarse en las canchas libres del club"*) que recargaba la vista sin sumar información relevante frente al título con ícono de advertencia y conteo total.
  2. **Alertas pasivas y sobrecarga de datos en tarjetas:** Cada tarjeta mostraba textos intermedios (*"Turnos originales saturados (coordinar nuevo horario)"*, *"Sin coincidencia previa de horario"*) y el chip de *"N turnos viables"* que generaban ruido y fatiga de decisión innecesaria antes de ingresar al modal de asignación.
  3. **Jerarquía cromática confusa:** El botón *"Asignar horario y cancha"* utilizaba estilos ámbar/naranja de advertencia pasiva (`btn-secondary` con bordes anaranjados), compitiendo con los badges de alerta en lugar de destacar como la acción positiva principal.
  4. **Desborde en pantallas móviles ($\le 410$px):** La grilla usaba `grid-template-columns: repeat(auto-fill, minmax(310px, 1fr))`. Al restar el padding de la página (32px), del banner (35px) y del acordeón (24px), a partir de 410px hacia abajo el ancho disponible caía por debajo de 310px, provocando que la grilla forzara un ancho mínimo artificial y desbordara horizontalmente el contenedor. Además, el botón flotaba a la derecha dejando un espacio vacío asimétrico a la izquierda.
  5. **Desalineación del chip de Zona:** El texto "Zona E" se visualizaba con una sangría excesiva hacia la derecha (26px desde el borde), debido a que la clase `.badge` le imponía 12px de padding lateral sin borde visible, viéndose desfasado respecto al nombre de las parejas.
- **Qué decidí y por qué:**
  1. **Depuración de Cabecera y Tarjeta:** Se removió el subtítulo del banner y se eliminaron los textos de saturación y el chip de viables de cada tarjeta. La tarjeta quedó estrictamente focalizada en: Zona + Parejas + Botón de acción.
  2. **Acción Primaria en Verde Semántico:** Se migró el botón a `btn-primary`, aplicando el verde esmeralda institucional (`var(--color-primary)` = `#00d084`) con tipografía de alto contraste (`var(--bg-body)` = `#0a0c10`), distinguiendo nítidamente la acción resolutiva de cualquier señal pasiva del sistema.
  3. **Alineación Flush del Chip de Zona:** Se retiró la clase `.badge` y se definió un chip compacto (`padding: 1px 6px`, `borderRadius: 4px`, `border: 1px solid rgba(255, 255, 255, 0.08)`, `background: rgba(255, 255, 255, 0.05)`), eliminando los 12px de sangría lateral y logrando que el chip arranque exactamente nivelado con el margen izquierdo interior.
  4. **Borde Izquierdo sin Competencia Ámbar:** Se reservó el borde izquierdo rojo (`#ef4444`) únicamente para partidos críticos (`slotsViablesCount <= 1`), manteniendo borde neutro (`var(--color-border)`) en el resto para erradicar cualquier tono ámbar residual.
  5. **Ingeniería Responsive para Mobile ($\le 410$px):**
     - En `index.css`, se añadió `@media (max-width: 480px)` donde `.partidos-pendientes-grid` conmuta a `grid-template-columns: 1fr`, eliminando el piso de 310px y erradicando el desborde en teléfonos estrechos (320px–410px).
     - El botón de acción se expande al 100% de la tarjeta (`flex: 1; width: 100%; justify-content: center;`), convirtiéndose en un target táctil ergonómico y simétrico para uso con el pulgar.
     - Se redujo el padding perimetral del banner a `0.85rem 0.65rem` y la tipografía del título a `0.95rem`.
- **Validación y verificación:**
  - Build de producción frontend exitoso con `npm run build` (0 errores, 0 warnings).
  - Verificación visual con el subagent de navegador en múltiples anchos de pantalla (375px, 390px, 410px y desktop), confirmando alineación perfecta del chip de zona, tarjetas fluidas sin desborde horizontal, y botón verde centrado de alto impacto.
- **Resultado final:** Un banner de partidos pendientes limpio, libre de advertencias redundantes, con jerarquía cromática impecable donde la acción destaca en verde esmeralda y el layout responde con naturalidad en cualquier dispositivo móvil.

---

### Sesión 38: Auditoría y Normalización de Modal "Editar Cruce" en Cuadros Eliminatorios (`EditBracketMatchModal` y `EliminatoriaView`)

- **Objetivo:** Resolver el error crítico de posicionamiento y renderizado del modal de edición de cruces en eliminatorias (`EditBracketMatchModal.jsx`), migrándolo al patrón estándar de overlay flotante con centrado automático, soporte de cierre por backdrop y tecla/botón, limpieza de estilos huérfanos y armonización visual con el sistema de diseño.
- **Problema o necesidad que motivó el trabajo:**
  1. En la pestaña de Bracket de una categoría (fase eliminatoria), al pulsar el ícono de engranaje (`⚙️`) dentro de cualquier partido para editar el cruce de clasificados (Posición 1 / Posición 2), el modal no se visualizaba como un overlay centrado sobre el contenido sino que se renderizaba al final del documento (debajo del cuadro del bracket y fuera del viewport).
  2. *Diagnóstico y causa raíz:* Una auditoría del código e historial en Git reveló que `EditBracketMatchModal.jsx` fue concebido originariamente (commit `6ce33d9`, 3 de agosto) como un popover relativo anidado directamente dentro de cada tarjeta de partido (`position: absolute; top: 100%`). Al refactorizarse la vista para desacoplar el componente y extraerlo al pie de `EliminatoriaView.jsx` (commit `a8f7e8a`, 21 de agosto), nunca se le agregaron los estilos ni la estructura de modal estándar de la aplicación (`.modal-overlay` con `position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center;`). Como consecuencia, el componente se montaba en el DOM con `position: static`, quedando desplazado al fondo de la página por el flujo secuencial normal del documento. Adicionalmente, el componente ignoraba la prop `isOpen` que ya le enviaba `EliminatoriaView`, y en la tarjeta del partido habían quedado estilos inline huérfanos (`zIndex: editBracketModal?.id === partido.id ? 100 : 1`) heredados del antiguo popover.
- **Qué decidí y por qué:**
  1. **Envoltorio Estándar con `.modal-overlay` y `.modal-content`:** Se envolvió el componente en las clases globales predefinidas en `index.css`, con un ancho calibrado (`maxWidth: 400px`) acorde a formularios de configuración, garantizando centrado automático en el viewport, backdrop con desenfoque (`backdrop-filter: blur(6px)`) y animación suave de entrada.
  2. **Cierre Amigable y Soporte de `isOpen`:** Se incorporó el control de la prop `isOpen` (`if (!isOpen || !partido) return null;`) y el evento de cierre al hacer clic en el backdrop (`e.target === e.currentTarget && onClose()`), además del botón de cierre superior (`btn-link-action`) con el ícono `X` de `lucide-react`.
  3. **Limpieza de Estilos Huérfanos en `EliminatoriaView`:** Se removieron los inline styles de `zIndex` condicional tanto en `.bracket-match-wrapper` como en `.match-card`, dejando que el z-index nativo del CSS controle la jerarquía visual del bracket.
  4. **Preservación Estricta de Lógica de Negocio:** Se mantuvieron intactas las llamadas a la API (`PATCH /partidos/:id/bracket`), la validación de orígenes duplicados y los callbacks de notificación (`onSuccess`, `onSaved`, `onClose`).
- **Validación y verificación:**
  - Build de producción frontend con Vite (`npm run build`) completado exitosamente en 608ms sin errores ni advertencias.
  - Verificación de consistencia visual con los modales estándar del sistema (`AsignarHorarioModal`, `ResultadoModal` y `TorneoDetail`).
- **Resultado final:** El modal de edición de cruces en eliminatorias se renderiza centrado, responsive, accesible y visualmente alineado al lenguaje de diseño del resto del sistema.

---

### Sesión 39: Validación de Unicidad de Orígenes en Cuadros Eliminatorios (Frontend + Backend en `EditBracketMatchModal`, `EliminatoriaView` y `partido.service.js`)

- **Objetivo:** Erradicar la duplicación indebida de posiciones de origen de zonas en los cruces de playoffs mediante validación de unicidad en dos capas (backend como fuente de verdad y frontend proactivo), deshabilitando opciones ocupadas con indicación explícita del partido asignatario y preservando la reasignación en el propio partido.
- **Problema o necesidad que motivó el trabajo:**
  1. En `EditBracketMatchModal.jsx`, los selectores de "Posición 1" y "Posición 2" permitían elegir orígenes (ej. "1° Zona A") que ya estaban asignados en otro partido de la misma ronda, permitiendo que una misma pareja quedara duplicada en dos cruces simultáneos.
  2. *Auditoría técnica:*
     - El componente `EditBracketMatchModal` operaba aislado, recibiendo únicamente el `partido` en edición y la lista de `zonas`, sin visibilidad de los demás cruces de la fase.
     - En `EliminatoriaView.jsx`, la lista de partidos de todas las fases ya residía completa en memoria (`fases.partidos`), posibilitando pasar los partidos de la ronda directamente sin costo de red.
     - El alcance de la validación se delimitó estrictamente a la **misma ronda** (`faseEliminatoriaId`), ya que por diseño legítimo del torneo los orígenes se propagan a rondas subsiguientes (Cuartos, Semis, Final) al avanzar los ganadores o BYEs.
     - En el backend (`PATCH /partidos/:id/bracket`), `updateBracketMatch` carecía por completo de validaciones de unicidad, persistiendo duplicados sin rechazo.
- **Qué decidí y por qué:**
  1. **Blindaje en Backend (`partido.service.js`):**
     - Se implementó la verificación de unicidad interna (`nuevoOrigen1 !== nuevoOrigen2`) y externa contra los demás partidos de la misma ronda (`where: { faseEliminatoriaId, id: { not: partidoId } }`).
     - Ante colisiones, el backend responde HTTP 400 con mensaje preciso: `El origen "X" ya está asignado en el Partido #Y de esta ronda.`, manteniendo el guard estricto previo `if (!partido.faseEliminatoriaId)` para garantizar integridad del modelo.
  2. **Inyección de Contexto en `EliminatoriaView.jsx`:**
     - Se pasó `partidosRonda={fases.find(f => f.id === editBracketModal.faseEliminatoriaId)?.partidos || []}` como prop a `EditBracketMatchModal`.
  3. **UX Proactiva y Preservación del Propio Partido en `EditBracketMatchModal.jsx`:**
     - Se construyó el mapa `orígenesEnUsoOtrosPartidos` filtrando estrictamente `p.id !== partido?.id`.
     - En los `<select>`, las opciones ocupadas por otros partidos quedan deshabilitadas (`disabled={true}`) con etiqueta informativa: `${opt} (en uso en Partido #${posicionEnRonda})`.
     - Los orígenes asignados al propio partido no se bloquean, permitiendo re-guardar sin cambios o invertir Posición 1 y Posición 2 libremente sin autobloqueo.
     - Se añadió validación preventiva en `handleSubmit` antes de invocar a la API.
- **Validación y verificación:**
  - Build de producción frontend con Vite (`npm run build`) exitoso en 592ms.
  - Ejecución de la suite de tests de eliminatorias `test-eliminatoria-scheduler-completo.js` en backend con 100% de aserciones aprobadas.
- **Resultado final:** Cuadros eliminatorios blindados contra duplicaciones de parejas tanto en la interfaz de usuario como en la base de datos, con feedback claro y ergonómico para el organizador.

---

### Sesión 40: Reasignación e Intercambio Atómico de Orígenes en Cuadros Eliminatorios (Swap en Backend y Frontend)

- **Objetivo:** Permitir al organizador mover o hacer swap de orígenes de zona ("1° Zona A") entre partidos de la misma ronda de playoffs sin bloqueos estáticos, liberando atómicamente la posición en el partido original y transfiriendo la pareja física si ya estaba clasificada, con aviso reactivo consolidado en el modal y confirmación en un clic.
- **Problema o necesidad que motivó el trabajo:**
  1. Tras la validación de unicidad de la Sesión 39, los selectores de `EditBracketMatchModal.jsx` deshabilitaban por completo las opciones ya asignadas a otro partido de la ronda. En la operativa real de armar o ajustar un cuadro, los organizadores necesitan frecuentemente reasignar o mover un origen de un cruce a otro; el bloqueo total obligaba a un tedioso proceso manual de dos pasos (vaciar primero el cruce origen y recién entonces editar el cruce destino).
  2. Si el partido original ya tenía la pareja física asignada (`parejaXId` poblado porque concluyó la fase de grupos y se computó el clasificado), mover el origen sin transferir la pareja física creaba cruces inconsistentes o duplicados.
  3. Si un partido de la ronda ya se encontraba en estado `FINALIZADO`, cualquier intento de mover su origen debía rechazarse de plano para preservar la integridad histórica del torneo.
- **Qué decidí y por qué:**
  1. **Backend Transaccional y Atómico (`partido.service.js`):**
     - En `updateBracketMatch`, se incorporó el parámetro booleano `liberarEnOtros`.
     - Se detectan los partidos en conflicto de la ronda. Si alguno de ellos está `FINALIZADO`, se aborta inmediatamente con HTTP 400 (`"No se puede mover el origen porque el Partido #X ya está finalizado."`).
     - Si hay conflicto y `liberarEnOtros: true`, la operación se ejecuta dentro de un `prisma.$transaction`:
       - En cada partido en conflicto, se vacía el origen (`origenParejaX = null`) y, si tenía pareja física asignada (`parejaXId`), se transfiere al partido actual y se desvincula del original (`parejaXId = null`). El partido original retorna ordenadamente a estado `"Esperando..."`.
       - El partido actual se actualiza con los nuevos orígenes y las parejas físicas transferidas, garantizando consistencia y atomicidad sin estados intermedios inconsistentes.
     - Si hay conflicto y `liberarEnOtros` es `false`, se preserva el rechazo descriptivo HTTP 400 preexistente.
  2. **Frontend con Feedback Reactivo y Confirmación Unificada (`EditBracketMatchModal.jsx`):**
     - Se modificó la construcción de `orígenesEnUsoOtrosPartidos` para rastrear `{ posicionEnRonda, finalizado, partidoId }`.
     - En los `<select>`, las opciones ocupadas por otros partidos ya **no se deshabilitan**, excepto si el partido que las ocupa está `FINALIZADO` (`${opt} (Partido #${posicionEnRonda} finalizado)` con `disabled={true}`). Las demás permanecen seleccionables con la etiqueta explicativa `${opt} (en uso en Partido #${posicionEnRonda})`.
     - Se computa reactivamente el array `movimientos` con los orígenes seleccionados en Posición 1 y Posición 2 que requieren liberación en otros cruces.
     - Si `movimientos.length > 0`, se renderiza un banner visual de advertencia (`⚠️ Reasignación de cruces (Swap)`) que detalla con precisión cada reasignación ("*1° Zona A se moverá desde el Partido #2 a este partido (Posición 1)*").
     - El botón de guardado conmuta dinámicamente su texto a **"Confirmar y Guardar"** y envía `liberarEnOtros: true` al endpoint.
- **Validación y verificación:**
  - Creación y ejecución de script de test de integración transaccional dedicado (`test-bracket-swap.js`) verificando:
    1. Rechazo HTTP 400 descriptivo cuando `liberarEnOtros: false`.
    2. Swap atómico exitoso con transferencia de pareja física (`pareja1Id`) y vaciado a null en el partido anterior.
    3. Bloqueo estricto con HTTP 400 ante partidos colisionados en estado `FINALIZADO`.
  - Suite completa de eliminatorias en backend (`test-eliminatoria-scheduler-completo.js`) con 100% de aserciones aprobadas.
  - Build de producción con Vite (`npm run build`) en frontend exitoso en 902ms sin errores de tipado ni advertencias.
- **Resultado final:** Cuadros eliminatorios con flujo de reasignación ágil, intuitivo y 100% atómico, con blindaje transaccional en base de datos y total claridad visual para el organizador.

---

### Sesión 41: Reprogramación en Brackets, Adaptación Contextual de Asignación, Visualización de Horario Actual y Exclusión de Turno Idéntico (`EliminatoriaView`, `AsignarHorarioModal` e `index.css`)

- **Objetivo:** Incorporar la reprogramación horaria ágil y directa en tarjetas de cuadros eliminatorios para todos los partidos no finalizados (incluyendo cruces pendientes "Esperando..."), adaptar `AsignarHorarioModal` a eliminatorias con grilla plana directa de turnos válidos del día (omitiendo ranking y estiramientos artificiales de zonas), mostrar de forma destacada el horario y cancha actual al reprogramar, excluir de los turnos disponibles la combinación idéntica actual para evitar redundancias, y remover la jerarquía visual de terciles en los chips de turno.
- **Problema o necesidad que motivó el trabajo:**
  1. *Falta de acceso a reprogramación en brackets:* En `EliminatoriaView.jsx`, cada tarjeta de partido disponía del botón de engranaje (`Settings`) para editar cruces, pero carecía de un acceso uniforme para asignar o reprogramar horario y cancha; el botón de reloj antiguo estaba confinado a la fila `.match-time-row` y condicionado únicamente a que el partido fuera jugable (`isJugable`), impidiendo reprogramar turnos pregenerados antes del avance de parejas clasificadas.
  2. *Auditoría de `AsignarHorarioModal` en eliminatorias:* Al abrir el modal para un cruce de playoffs, el componente calculaba un ranking de disponibilidad de parejas pensado para zonas (`rankearSlotsParaPartido`), pero como en playoffs no rige la disponibilidad declarada ni existe la clave `'Domingo'` en la matriz de preferencias de parejas, devolvía distancias infinitas (`+16h 39m`) y forzaba un turno matutino ficticio (08:00 AM) como *"MEJOR OPCIÓN"*, además de mostrar nombres genéricos engañosos (*"Pareja 1 vs Pareja 2"*).
  3. *Invisibilidad del estado actual al reprogramar:* Cuando el modal se abría en modo reprogramación (`partido.fechaHora` existente), no mostraba en ningún lugar cuál era el horario y cancha que el partido tenía asignado actualmente, generando confusión sobre si convenía modificarlo.
  4. *Redundancia del horario actual:* En modo reprogramación, el endpoint backend excluía el propio partido (`?ignorePartidoId=...`), lo que provocaba que la cancha que el propio partido ya ocupaba fuera reportada como "libre". En consecuencia, el slot del horario actual volvía a ofrecerse como opción (e incluso como "MEJOR OPCIÓN" en zonas con 0 min de estiramiento), induciendo a reasignar lo mismo.
  5. *Jerarquía visual de terciles en chips de turno:* La aplicación de clases `.slot-chip.tier-high` y `.slot-chip.tier-low` atenuaba o resaltaba turnos según el volumen relativo de canchas libres, agregando ruido visual innecesario en la grilla horaria.
- **Qué decidí y por qué:**
  1. **Acceso Unificado en Cabecera de Tarjetas de Bracket (`EliminatoriaView.jsx`):**
     - Se añadió el botón con ícono `Clock` (`lucide-react`) en el header de la tarjeta junto al engranaje de edición de cruce, disponible de forma universal para todos los partidos no finalizados (`!isFinalizado`), permitiendo reprogramar cruces con parejas físicas o pendientes ("Esperando...").
     - Se eliminó el botón condicional duplicado que residía en `.match-time-row`.
  2. **Adaptación Contextual de `AsignarHorarioModal.jsx` para Playoffs:**
     - Se detectó el tipo de cruce (`esPartidoEliminatoria`). Para playoffs, se desactivó el ranking artificial (`rankedSlots = []`), suprimiendo los badges de coincidencia de zona, los textos de estiramiento y el bloque de *"MEJOR OPCIÓN"*.
     - Se desplegó directamente una grilla cronológica plana y limpia con los turnos que poseen al menos una cancha física libre, delimitada por contexto (Sábado noche para dieciseisavos y Domingo para playoffs regulares).
     - Fallbacks honestos para nombres de cruces: si no hay parejas físicas pero sí orígenes se muestra `"1° Zona A vs 2° Zona B"`, y si tampoco hay orígenes definidos se muestra `"Cruce pendiente de definir"` (erradicando el falso "Pareja 1 vs Pareja 2").
  3. **Visualización Destacada del Horario y Cancha Actual:**
     - Si `partido.fechaHora` es truthy, se renderiza bajo el nombre del cruce un badge destacado con ícono `Clock` neutral (`rgba(255, 255, 255, 0.04)` con borde `var(--color-border)`), formateando con precisión: `Actualmente: Sábado 11:30 · Cancha X` (utilizando `partido.canchaNumero` del modelo `Partido` de Prisma). Si no tiene horario asignado, el bloque se omite limpiamente.
  4. **Exclusión Dinámica del Slot Idéntico Actual:**
     - Se implementó `coincideConHorarioActual(s)` mediante comparación precisa por timestamp ISO (`diff < 60s`) y texto normalizado.
     - En la definición raíz de `slotsValidos`, para el slot coincidente con el horario actual se descuenta la cancha física actual (`partido.canchaNumero`). Si no quedan otras canchas libres en ese turno, el slot queda **100% excluido** de `slotsValidos` (desapareciendo tanto de la grilla plana de bracket como de las sugerencias y de "todos los turnos del club" en zona). Si hay otra cancha libre (ej. Cancha 2 libre), se mantiene pero ofreciendo únicamente la alternativa para cambio de pista a la misma hora.
  5. **Remoción de Terciles en Chips Horarios (`AsignarHorarioModal.jsx` e `index.css`):**
     - Se eliminaron las funciones y variables de terciles (`getDisponibilidadTier`, `allLibresCounts`, `maxLibres`, `minLibres`).
     - Todos los chips retornaron a la clase base unificada `className="slot-chip"` y se eliminaron las reglas CSS `.slot-chip.tier-high`, `.slot-chip.tier-low` y su `:hover`.
  6. **Configuración de Vite LAN (`vite.config.js`):**
     - Se habilitó `server: { host: true }` para permitir pruebas y auditorías en vivo desde teléfonos celulares conectados a la red local.
- **Validación y verificación:**
  - Build de producción frontend con Vite (`npm run build`) completado exitosamente en 615ms sin errores ni advertencias.
  - Validación de conectividad LAN y endpoints API en caliente (`http://192.168.200.16:5173`).
  - Suite de regresión automatizada de eliminatorias en backend (`test-eliminatoria-scheduler-completo.js`) con 100% de aserciones aprobadas.
- **Resultado final:** Flujo de reprogramación ágil, intuitivo y sin fricción en eliminatorias y zonas, con visibilidad clara del estado actual, eliminación de redundancias y diseño limpio y unificado en toda la grilla de turnos.

---

### Sesión 42: Auditoría de Integridad en Asignación Horaria, Optimización de Layout en Día de Torneo y Tarjetas Responsivas Mobile (`TorneoEnVivo.jsx`, `index.css`)

- **Objetivo:** Auditar y descartar un potencial bug de integridad en la asignación consecutiva de turnos de dieciseisavos (`AsignarHorarioModal`), optimizar el layout de "Día de Torneo — En Vivo" eliminando el desperdicio de espacio cuando no hay partidos en juego (expandiendo "Próximos Partidos" al 100% con heading colapsado), agregar labels de acción explícitos (`En juego`, `Resultado`) para evitar toques erróneos en mobile, limpiar mensajes pasivos de canchas normales y rediseñar la tarjeta de próximos partidos en 2 filas responsive para erradicar el truncamiento de nombres en celulares estrechos ($\le 390\text{px}$).
- **Problema o necesidad que motivó el trabajo:**
  1. *Reporte de colisión potencial en reprogramación secuencial:* Se reportó que al asignar un partido A a un turno (ej. Sábado 20:30 Cancha 1), al abrir inmediatamente después el modal para el partido B en la misma sesión, el turno parecía seguir disponible, amenazando la restricción física de una cancha por franja horaria.
  2. *Desperdicio espacial en "Partidos en Juego" vacío:* En `TorneoEnVivo.jsx`, cuando no había ningún partido en curso (0 partidos), se mostraba un placeholder gris enorme que ocupaba el 50% de la pantalla en desktop y empujaba innecesariamente la columna de "Próximos Partidos" en mobile.
  3. *Toques erróneos en mobile por falta de labels en botones de acción:* Los botones de acción de cada tarjeta en "Próximos Partidos" solo mostraban íconos (`Play` y `ClipboardList`) con tooltip, lo que en el uso apurado y en pantallas táctiles provocaba toques accidentales y falta de claridad de acción.
  4. *Texto pasivo redundante en estado normal:* En la cabecera de canchas, el texto `"Todas las canchas del club habilitadas."` se mostraba permanentemente aun cuando la operación era 100% estándar, agregando ruido visual innecesario.
  5. *Truncamiento severo de nombres de parejas en mobile ($\le 390\text{px}$):* Al agregar los labels de texto a los botones en la misma fila horizontal junto a la pastilla de Cancha y Horario, el bloque derecho ocupaba ~260px, dejando apenas ~100px para los nombres de las parejas y truncando nombres reales con puntos suspensivos (ej. `"Coria / Ga..."`, `"Barbieri / Lobos vs Al..."`).
- **Qué decidí y por qué:**
  1. **Auditoría Exhaustiva de Integridad en Asignación (`AsignarHorarioModal` / Backend):**
     - Se auditó el flujo de consulta (`cargarCanchasDisponibles` y `GET /api/partidos/canchas-disponibles`). Se demostró que el backend consulta la base de datos en tiempo real excluyendo solo el partido en edición (`?ignorePartidoId=...`).
     - Al asignar el partido A, la cancha queda reservada en base de datos. Cuando el partido B abre el modal, su `ignorePartidoId` es el de B (no el de A), por lo que la cancha del partido A ya figura ocupada y no se duplica. Se verificó con scripts de inspección y asignación secuencial real.
  2. **Layout Dinámico con Encabezado Compacto Colapsado (`TorneoEnVivo.jsx`):**
     - En lugar de ocultar completamente la sección de "Partidos en Juego" (lo cual privaría al organizador de la confirmación rápida de *"no hay nada en juego ahora mismo"* en los baches entre rondas), se mantuvo el encabezado `Partidos en Juego (0)` visible pero compacto en una sola línea (sin la tarjeta gris de placeholder).
     - El contenedor pasa a `display: flex; flex-direction: column; gap: 1rem;` expandiendo la sección de **`Próximos Partidos` al 100% del ancho disponible** tanto en desktop como en mobile.
     - En cuanto hay $\ge 1$ partidos en juego, la grilla conmuta dinámicamente al layout de 2 columnas paralelas (`gridTemplateColumns: repeat(auto-fit, minmax(320px, 1fr))`).
  3. **Labels de Acción Explícitos y Consistentes:**
     - En las tarjetas de "Próximos Partidos", se incorporó texto visible junto a los íconos: `<Play size={13} fill="currentColor" />` + `En juego` y `<ClipboardList size={14} />` + `Resultado`.
     - Tipografía `var(--font-size-xs)`, `fontWeight: 600`, padding compacto (`0.35rem 0.6rem`), `gap: 0.3rem` y `whiteSpace: 'nowrap'`.
  4. **Mensaje de Estado de Canchas Estrictamente Condicional:**
     - Se eliminó el texto redundante de club habilitado en condiciones normales.
     - El párrafo descriptivo solo se renderiza si hay Modo Lluvia activo en la solapa actual o si hay lluvia activa en otra jornada: `{(isTabBajoOverride || anyDayHasLluvia) && <p>...}`.
  5. **Diseño Responsive de Tarjetas de Próximos Partidos (`index.css` y `TorneoEnVivo.jsx`):**
     - Se introdujeron las clases utilitarias `.proximo-partido-card`, `.proximo-partido-main` y `.proximo-partido-actions`.
     - **En Mobile ($\le 640\text{px}$):** La tarjeta conmuta a un layout de **2 filas**:
       - *Fila 1 (`.proximo-partido-main`):* Nombres de las parejas a la izquierda con `lineHeight: 1.35`, `wordBreak: 'break-word'`, eliminando `whiteSpace: nowrap` y `textOverflow: ellipsis`. Dispone de más de 275px de ancho útil, compartiendo únicamente con la pastilla de Cancha y Horario a la derecha. Si los apellidos son largos, hace wrap fluido sin cortar texto.
       - *Fila 2 (`.proximo-partido-actions`):* Franja horizontal dedicada con borde superior sutil (`borderTop: 1px solid rgba(255, 255, 255, 0.05)`), alojando los botones `[▶ En juego]` y `[📋 Resultado]` alineados a la derecha (`justify-content: flex-end`), al alcance del pulgar.
     - **En Desktop ($> 640\text{px}$):** La tarjeta se mantiene en **1 sola fila horizontal compacta** (~65px de alto), agrupando la pastilla de cancha y ambos botones de acción a la derecha para rellenar armoniosamente el ancho disponible sin generar huecos centrales vacíos ni filas innecesarias.
- **Validación y verificación:**
  - Inspección y pruebas interactivas en navegador con subagente browser tanto en resolución desktop (1280x800) como mobile real (390x844).
  - Verificación del cambio de estado dinámico (`En juego` $\rightarrow$ 2 columnas $\rightarrow$ `Revertir` $\rightarrow$ 1 columna al 100%).
  - Confirmación visual de legibilidad completa de nombres de parejas reales (ej. `Coria / Giuliani vs Escobar / Longo`, `Barbieri / Lobos vs Amaya / Godoy`).
- **Resultado final:** Pantalla de "Día de Torneo — En Vivo" ultra optimizada para la operación ágil y bajo presión del organizador, con aprovechamiento inteligente del espacio en pantalla, prevención de errores táctiles en celular y legibilidad 100% garantizada de todos los cruces del torneo.

---

### Sesión 43: Rediseño integral de la Vista Pública (`TorneoPublic.jsx` e `index.css`), Cuadro Eliminatorio Dual (Mobile Tabs / Desktop Scroll), Buscador en Vivo y Tablas de Posiciones Deportivas sin Scroll Horizontal

- **Qué problema resolví:**
  1. *Sobrecarga de información innecesaria para el espectador:* Las tarjetas de partidos en la vista pública exhibían el número de cancha (`· Cancha X`), un dato irrelevante para el público y los jugadores en comparación con el día y horario del partido.
  2. *Navegación lenta y pesada en Fase de Grupos:* Todas las zonas se renderizaban apiladas en el DOM simultáneamente, exigiendo un scroll vertical excesivo y detectando la zona visible con `IntersectionObserver`.
  3. *Inaccesibilidad y desorientación entre fases:* La navegación entre Fase de Grupos y Cuadro Eliminatorio carecía de un mecanismo rápido y accesible para saltar de sección en mobile.
  4. *Cuadros eliminatorios poco intuitivos en torneos en progreso:* Las rondas vacías o sin parejas definidas competían visualmente con las rondas activas, sin indicar cuántos cruces estaban listos ni atenuar las fases futuras.
  5. *Dificultad para encontrar a una pareja puntual:* El espectador debía recorrer zona por zona para averiguar cuándo y contra quién jugaba una pareja específica.
  6. *Cuadros eliminatorios incómodos en mobile (scroll horizontal de 4-5 rondas):* En celulares ($\le 768\text{px}$), navegar un bracket completo con scroll horizontal largo resultaba torpe con el pulgar.
  7. *Ruptura de tablas de posiciones en mobile ($\le 393\text{px}$):* Nombres de parejas ("Ferraro / Peralta") y valores de sets/games ("0 - 0") quebraban en dos renglones por falta de clases y estilos `nowrap`. Un intento inicial con scroll horizontal obligaba al usuario a arrastrar con el dedo solo para ver sets/games, dejando inicialmente ocultas la mayoría de las columnas.
- **Qué decidí y por qué:**
  1. **Remoción Absoluta de Canchas en Vista Pública:** Eliminación total de `"· Cancha X"` en tarjetas de partidos (grupos y playoffs), exhibiendo únicamente día y horario (`Clock` + `formatDiaHorario`) para un diseño limpio y enfocado en el espectador.
  2. **Navegación por Pestañas de Zona (DOM Inteligente):** Reemplazo del scroll infinito por tabs de zona (`.public-zone-chip`). Solo la zona seleccionada se monta en el DOM, optimizando el rendimiento y eliminando saltos bruscos.
  3. **Stepper de Fases Accesible:** Stepper superior con botones nativos `<button>` (`role="tab"`, `aria-label`) para alternar con scroll suave entre Fase de Grupos y Cuadro Eliminatorio.
  4. **Atenuación Progresiva del Bracket y Badge de Progreso:** Incorporación de clases `.ronda-con-datos`, `.ronda-parcial` y `.ronda-vacia` junto a badges `${definidos}/${total} definidos` en desktop, compatible tanto con formatos tradicionales como con eliminación directa pura.
  5. **Buscador de Parejas en Tiempo Real:** Campo de búsqueda por texto normalizado (`normalize("NFD")`) e insensible a mayúsculas/acentos en la categoría activa. Deduplica por nombre y zona (`Set`), mostrando coincidencias instantáneas que al hacer clic conmutan la pestaña de la zona correspondiente sin desplazamientos molestos. Limpieza automática al cambiar de categoría.
  6. **Cuadro Eliminatorio Dual (Mobile Tabs / Desktop Scroll):**
     - *En Mobile ($\le 768\text{px}$):* Selector horizontal de tabs por ronda (`Octavos de Final`, `Cuartos de Final`, `Semifinal`, `Final`) sin números redundantes de partidos. La ronda activa se despliega en un stack vertical al 100% de ancho sin líneas SVG (`BracketLines`).
     - *Selección Automática Inteligente:* Conmuta por defecto a la ronda más avanzada con partidos definidos (`rondaMasAvanzadaConParejas`).
     - *Sincronización al cambiar de Categoría:* `useEffect` reactivo escuchando `activeCatId` que resetea `activeRoundId` a `null`, evitando que queden IDs huérfanos entre categorías con distinta cantidad de rondas.
     - *Sub-componente `PublicMatchCard`:* Extracción de tarjeta reutilizable con 100% de paridad visual y lógica (`isVacio`, `isFinalizado`, ganadores, marcadores de sets).
     - *En Desktop ($> 768\text{px}$):* Se preserva el cuadro horizontal completo con scroll tradicional y conectores SVG (`BracketLines`).
  7. **Limpieza de Footer:** Remoción del texto `"Actualización en vivo cada 15s · Última..."` y su spinner giratorio, manteniendo el polling de fondo activo y silencioso.
  8. **Posiciones de Grupo en Mobile tipo Filas Deportivas (Cero Scroll Horizontal):**
     - En lugar de forzar un scroll horizontal incómodo donde solo se leían `#`, `PAREJA` y `P`, en mobile ($\le 768\text{px}$) se adoptó un layout de filas deportivas estilo Flashscore/Sofascore (`.public-pos-card`):
       - *Izquierda:* Posición (`# 1`) con flecha `▲` verde y borde lateral esmeralda si clasifica.
       - *Centro:* Nombre de la pareja completo y legible en negrita, con línea secundaria de estadísticas en texto fino: `0 PJ · 0 PG · Sets 0-0 · Games 0-0`.
       - *Derecha:* Puntos destacados en tamaño grande (`0 PTS`).
     - Cero quiebres de línea erróneos, cero scroll horizontal y 100% de aprovechamiento del ancho de pantalla.
     - En desktop ($> 768\text{px}$), se mantiene la tabla clásica de 8 columnas (`Pos, Pareja, Pts, PJ, PG, PP, Sets, Games`).
- **Validación y verificación:**
  - Pruebas completas en navegador Chrome en resoluciones desktop (1536x730) y mobile real ($\le 393\text{px}$ / 502px).
  - Verificación del buscador con deduplicación y cambio de categoría.
  - Validación de compilación continua con `npm run build` (0 errores en ~500ms).
- **Resultado final:** Vista pública moderna, liviana y mobile-first con navegación fluida por fases y zonas, buscador instantáneo de parejas, bracket dual adaptativo y tablas de posiciones deportivas perfectamente legibles en cualquier celular sin necesidad de scroll horizontal.

---

### Sesión 44: Refinamiento de Nomenclatura, Reordenamiento de Buscador, Visualización Completa del Bracket en Pantallas de Escritorio y Limpieza Minimalista en "Día de Torneo"

- **Qué problema resolví:**
  1. *Sobrecarga de texto e inconsistencias en la Vista Pública:* Presencia de badges como `"0/4 definidos"` en las cabeceras del bracket desktop que recargaban visualmente sin aportar valor; uso de expresiones extensas o inconsistentes como `"Fase de grupos"` y `"Cuadro eliminatorio"`.
  2. *Flujo visual desordenado en cabecera pública:* El buscador de parejas (`"Buscar pareja o jugador..."`) se encontraba posicionado por encima de las pestañas de selección de zonas (`Zona A`, `Zona B`, etc.), rompiendo la jerarquía natural de navegación (Categoría $\rightarrow$ Zonas $\rightarrow$ Búsqueda puntual $\rightarrow$ Fases).
  3. *Cuadro eliminatorio cortado en escritorio (Final oculta con scroll horizontal forzado):* En pantallas de escritorio ($\ge 1024\text{px}$), la vista pública estaba encerrada artificialmente en un contenedor de `max-width: 1000px` con columnas rígidas de `280px` y `gap: 48px`, dejando grandes franjas vacías en los laterales de la pantalla y ocultando la Final detrás de una barra de scroll horizontal obligatoria.
  4. *Exceso de leyendas y redundancias en Día de Torneo (`TorneoEnVivo.jsx`):* El encabezado principal exhibía emojis y redundancias (`🏟️ Día de Torneo — En Vivo`), aviso técnico pasivo de polling (`• Actualización automática cada 30s`), sufijo innecesario en la solapa dominical (`Domingo (Playoffs)`), encabezado recargado con subtítulo largo (`Cuadros Eliminatorios — Definición del Domingo...`), y tarjetas de categorías en domingo con badges y textos explicativos excesivos (`Cuadro armado` y `Cruces iniciales definidos. Se completan automáticamente al finalizar zonas.`).
- **Qué decidí y por qué:**
  1. **Unificación Léxica Concisa en Vista Pública:**
     - Se reemplazó `"Fase de grupos"` por `"Zonas"` y `"Cuadro eliminatorio"` por `"Eliminatoria"` en el stepper superior y en los títulos de sección `<h2>` en `TorneoPublic.jsx`.
     - Se eliminó el badge de progreso de partidos definidos (`{definidos}/{total} definidos`) de las cabeceras de ronda en el bracket horizontal de escritorio.
  2. **Reubicación Jerárquica del Buscador de Parejas:**
     - Se movió el componente `.public-search-wrap` para posicionarse inmediatamente **debajo** de las pestañas de navegación rápida entre zonas (`.public-zone-chips`) y antes del stepper de fases.
     - Este orden permite que el usuario vea primero la estructura de zonas de la categoría y luego disponga de la barra de búsqueda para filtrar, saltando directamente a la pestaña de zona correspondiente con feedback visual instantáneo.
  3. **Visualización Completa del Bracket en Escritorio sin Scroll Forzado:**
     - En `index.css`, se amplió `.public-page` en pantallas de escritorio con `@media (min-width: 1024px) { max-width: 1440px; }` y `@media (min-width: 1600px) { max-width: 1560px; }`.
     - La sección de Zonas se protegió con `.public-zonas-section { max-width: 1000px; margin: 0 auto; }`, evitando que la tabla de posiciones se deforme en monitores panorámicos.
     - Para el bracket horizontal (`.public-bracket-desktop`), las columnas pasaron de un ancho estático a `flex: 1 1 0px; min-width: 185px; max-width: 280px;`, con separación fluida `gap: clamp(1rem, 1.8vw, 2.25rem);` y centrado en el contenedor (`justify-content: center;`).
     - Títulos de ronda con tipografía responsive (`clamp(0.75rem, 0.9vw, 0.9rem)`) y `text-overflow: ellipsis`, y padding interior optimizado en tarjetas (`0.75rem 0.85rem`).
     - Las líneas SVG conectoras de `BracketLines.jsx` recalculan con exactitud matemática las coordenadas relativas ante cualquier tamaño o redimensionamiento de ventana.
     - Resultado: En monitores de escritorio y notebooks (desde 1024px en adelante), **las 4 rondas completas (Octavos, Cuartos, Semifinal y Final) entran simultáneamente a la vista sin scroll horizontal**.
     - **Aislamiento absoluto de la vista móvil:** La vista móvil ($\le 768\text{px}$) no fue alterada en lo más mínimo, manteniendo su renderizado independiente basado en tabs horizontales (`.public-bracket-mobile`) y cards al 100% de ancho.
  4. **Limpieza Minimalista de Día de Torneo (`TorneoEnVivo.jsx`):**
     - Título principal simplificado a `"Día de Torneo"`, eliminando el emoji 🏟️ y la frase `— En Vivo` (que redundaba con el badge pulsante adyacente).
     - Supresión del texto `"• Actualización automática cada 30s"`.
     - En `jornadasDisponibles`, se eliminó `(Playoffs)` del label de Domingo, mostrando limpiamente la fecha correspondiente.
     - Encabezado de playoffs dominicales simplificado a `"Eliminatoria"` junto al trofeo, eliminando el subtítulo largo explicativo.
     - En las tarjetas de categorías, se suprimió el badge `<Clock /> Cuadro armado` y el párrafo explicativo `"Cruces iniciales definidos. Se completan automáticamente al finalizar zonas."` cuando el estado es `ESPERANDO_ZONAS`, eliminando ruido visual durante la fase de grupos.
- **Validación y verificación:**
  - Compilación exitosa en `npm run build` sin errores de bundle ni estilos.
  - Verificación responsive tanto en resoluciones de escritorio (1280px, 1440px, 1920px) como en teléfonos móviles ($\le 393\text{px}$).
- **Resultado final:** Interfaz pública y panel en vivo notablemente más pulidos, elegantes y profesionales, con terminología concisa, jerarquía visual equilibrada y visualización completa del cuadro eliminatorio en monitores de escritorio sin desplazamiento horizontal innecesario.

### Sesión 45: Header Compacto, Barra Sticky Nav y Control Segmentado de Fases en la Vista Pública Mobile (`feature/public-header-compacto`)

- **Qué problema resolví:**
  1. *Desperdicio de espacio vertical en el primer viewport móvil:* En celulares (que representan ~90% del tráfico de la vista pública), el usuario atravesaba una cascada de elementos antes de ver un solo resultado: título del torneo, organizador, fecha, 2 filas de chips de categoría, 2 filas de chips de zona, buscador y un stepper de fases. El contenido real (tabla de posiciones o cruces) aparecía recién tras scrollear.
  2. *Contenedores con wrap desordenado:* Las categorías y zonas hacían wrap en múltiples líneas, comiendo altura útil.
  3. *Inestabilidad con `scrollIntoView` y anclas:* El viejo stepper dependía de scroll-spy y `scrollIntoView`, causando saltos bruscos, problemas de `scroll-margin` con barras fijas y desfasajes al cambiar de sección.
  4. *Ruptura de `position: sticky` en el navegador:* Al intentar fijar la navegación, `body` tenía una regla `overflow-x: hidden`, lo que convertía al `body` en un scroll-container propio y rompía completamente el comportamiento `sticky` en el viewport.
- **Qué decidí y por qué:**
  1. **Chips con Scroll Horizontal y Guía Visual de Desplazamiento:**
     - Categorías y zonas pasaron a una sola fila horizontal sin wrap (`white-space: nowrap`), con scroll horizontal suave, barra de scroll oculta y un degradé visual a la derecha como pista intuitiva de que hay más opciones.
     - Se añadió `padding-right: 24px` a ambos contenedores para que el último chip no quede cubierto por el degradé al llegar al final del scroll, y `padding-top/bottom: 8px` para evitar que el glow del chip activo se recorte por `overflow-y: hidden`.
  2. **Barra Sticky Nav Contenida (`.public-sticky-nav`):**
     - Se agruparon el selector de categorías y el segmented control de fases en una barra con `position: sticky; top: 0; z-index: 100`, con altura acotada $\le 96\text{px}$ en celulares de 360px.
     - El buscador y los chips de zona se mantuvieron en el flujo normal (no-sticky) para no saturar el viewport.
  3. **Control Segmentado como Tabs Reales con Unmount:**
     - El stepper se reemplazó por un segmented control con estado `activePhase` (`'zonas'` | `'eliminatoria'`), renderizando únicamente la sección activa en el DOM.
     - Esto eliminó por completo `scrollIntoView`, scroll-spy y las colisiones con la barra fija.
     - Inicialización reactiva ligada a `[activeCategoria?.id]`, seleccionando la fase actual del torneo según el progreso de juego sin re-ejecuciones espurias por el polling de 15 segundos.
     - Responsive ultra-compacto: en pantallas $\le 360\text{px}$, el subtítulo del botón (`.public-segment-subtext`) se oculta automáticamente para evitar que el texto desborde.
  4. **Filtro de Zonas con "Todas" por Defecto:**
     - Los chips de zona solo se despliegan en la pestaña "Zonas".
     - Se incorporó la opción "Todas" como valor por defecto (`activeZoneId === null`), permitiendo inspeccionar todas las zonas juntas o filtrar una individualmente.
     - Auto-reseteo a null al cambiar de categoría o si una zona desaparece por polling.
  5. **Corrección Arquitectural de `overflow` en `body`:**
     - Se auditó el CSS y se reemplazó `overflow-x: hidden` por `overflow-x: clip` y `overflow-y: visible` en `body` (manteniendo `overflow-x: hidden` únicamente en `html` donde se propaga al viewport para evitar scroll lateral sin atrapar el contexto de sticky).
     - Verificación de que el panel de administración no dependía de dicho overflow.
  6. **Calibración de Contraste y Reducción de Glows:**
     - Ajuste de `--color-text-secondary` (`#9da5ae`) y `--color-text-muted` (`#7a8599`) para maximizar la legibilidad en pantallas móviles AMOLED.
     - Atenuación de box-shadows con glows exagerados para un look más sobrio y deportivo.
- **Validación y verificación:**
  - Pruebas en resoluciones móviles de 320px, 360px y 375px.
  - Validación del polling continuo de 15 segundos sin interrupciones ni parpadeos.
  - Verificación del comportamiento sticky al scrollear en el navegador.
- **Resultado final:** Contenido visible en el primer pantallazo sin scroll previo; navegación de categorías y fases siempre a mano en una barra compacta de menos de 96px de alto.

### Sesión 46: Rediseño de Tarjeta de Partido Compacta (Estilo Marcador Deportivo) y Unificación de Zonas y Eliminatoria (`feature/public-tarjeta-partido`)

- **Qué problema resolví:**
  1. *Tarjetas de partido apiladas y desarticuladas en zonas:* Cada partido mostraba apilados en vertical el horario, pareja 1, "vs" y pareja 2 con estilos inline, ocupando mucho espacio vertical y ofreciendo una experiencia poco deportiva.
  2. *Disparidad visual entre Zonas y Eliminatoria:* Mientras que el bracket eliminatorio usaba `PublicMatchCard`, las zonas renderizaban un bloque inline completamente diferente, fragmentando la experiencia visual del usuario.
  3. *Dependencia de zona horaria del cliente y comparación de nombres:* El horario dependía de la configuración regional del navegador y el ganador se determinaba por coincidencia de strings (riesgo de colisión o fallos por caracteres especiales). Además, partidos finalizados por W.O. o retiro sin sets registrados mostraban cajas vacías o falsos ceros.
- **Qué decidí y por qué:**
  1. **Unificación al 100% bajo el Componente `PublicMatchCard`:**
     - Se unificó la tarjeta de partido para Zonas y Eliminatoria (tanto mobile como desktop).
     - Admite la prop opcional `label` para mini-brackets en zonas (`"Ronda 1 — Partido 1"`, `"1° y 2° Puesto"`, etc.) y conserva la clase `.match-card` requerida por `BracketLines.jsx` para el trazado matemático de conectores SVG en el cuadro eliminatorio de escritorio.
  2. **Diseño Compacto Tipo Marcador Deportivo:**
     - *Encabezado:* Horario a la izquierda (calculado mediante `formatPartidoHorario` con `Intl.DateTimeFormat` forzado en timeZone `'America/Argentina/Cordoba'` con día abreviado y hora en `hourCycle: 'h23'`, ej. `"Vie · 19:30"`, omitiendo ícono si es nulo) y chip de estado a la derecha (`Pendiente`, `En juego` con punto verde pulsante que respeta `@media (prefers-reduced-motion: reduce)`, `Finalizado`, o `Esperando` si falta cualquiera de las dos parejas y no está finalizado).
     - *Cuerpo:* Dos filas compactas, una por pareja, eliminando definitivamente el "vs" del medio. Nombres elásticos con `-webkit-line-clamp: 2` de hasta dos líneas para admitir apellidos compuestos sin desbordar hacia los sets.
     - *Sets Alineados en Columnas:* Columnas de ancho fijo (`1.25rem`) con `font-variant-numeric: tabular-nums` perfectamente alineadas verticalmente entre filas. En cada set individual, el puntaje mayor se resalta y el menor se atenúa (`--color-text-muted`).
     - *Contraste y Estilos de Fila:* Pareja ganadora destacada en verde esmeralda y negrita (`var(--color-primary)`). Pareja perdedora con `--color-text-secondary` (sin `opacity` traslúcida para asegurar contraste óptimo y legible).
  3. **Identificación Robusta de Ganador y Manejo de W.O./Retiro:**
     - Se enriqueció la API pública (`GET /api/public/:slug`) para inyectar `pareja1Id`, `pareja2Id` y `ganadorId` tanto en zonas como en eliminatorias.
     - El frontend prioriza la comparación por ID (`ganadorId === pareja1Id`).
     - En partidos finalizados sin sets (W.O. o retiro), se estilizan ganador y perdedor de inmediato sin generar ceros artificiales ni columnas vacías.
  4. **Acotación Específica en Desktop Eliminatoria:**
     - Se quitó `width: 100%` general de `.pub-match-card`, acotándolo solo a `.partidos-public-grid` y `.public-bracket-mobile`.
     - De esta forma, en el cuadro de eliminatoria desktop el ancho es gobernado por las columnas `.bracket-section`, permitiendo que `BracketLines.jsx` conecte con exactitud milimétrica el centro vertical derecho de cada tarjeta con el centro izquierdo de la ronda siguiente.
  5. **Limpieza de Código y Lint:**
     - Se eliminaron imports en desuso (`formatDiaHorario` y `Layers`), logrando 0 warnings de variables huérfanas en `TorneoPublic.jsx` y compilación en `npm run build` en 334ms.
- **Validación y verificación:**
  - Validación con `npx oxlint` (36 warnings globales heredados, 0 errores, 0 warnings en `TorneoPublic.jsx`).
  - Validación de bundle de producción con `npm run build` exitoso.
  - Verificación matemática y de reglas de CSS para viewports móviles (320px, 360px, 375px) y escritorio ($\ge 769$px).
- **Resultado final:** Experiencia visual de alta gama estilo marcador deportivo profesional (Flashscore/Sofascore), lectura instantánea de resultados y consistencia estética absoluta en toda la vista pública.

### Sesión 47 (01/10/2026) — Vista Pública Mobile: Mini Tabla de Posiciones Semántica y Desanidado de Tarjeta de Zona
- **Objetivo:** Modernizar la visualización de posiciones de grupos en dispositivos móviles (≤768px), reemplazando las filas de texto plano por una mini tabla semántica con encabezados alineados de ancho fijo, y desanidar la tarjeta contenedora para que la información se despliegue a ancho completo sobre el fondo de la pantalla sin encajonamiento.
- **Implementación técnica:**
  1. **Mini Tabla de Posiciones Mobile Semántica (`.public-tabla-mobile`):**
     - Reemplazo de las tarjetas `.public-pos-card` por una estructura `<table>` con `table-layout: fixed`, `font-variant-numeric: tabular-nums` y ancho al 100%.
     - Encabezados concisos alineados: `#` (18px), `Pareja` (fluida, $\ge 140$px a 320px), `PJ` (22px), `PG` (22px), `DS` (27px), `DG` (27px) y `PTS` (32px).
     - Diferenciales de sets (`DS = sf - sc`) y games (`DG = gf - gc`) formateados con signo tipográfico explícito (`+3`, `−2`, `0` utilizando el carácter de signo menos verdadero `\u2212`).
     - Puntaje (`PTS`) destacado con peso visual de nivel 1 (`font-weight: 800`, `font-family: var(--font-display)` y color verde esmeralda `var(--color-primary)`).
     - Elemento interno `<span>` con clase `.public-tabla-nombre` aplicando `-webkit-line-clamp: 2`, `line-height: 1.25` y `word-break: break-word`, garantizando lectura completa de nombres compuestos sin desborde.
     - Filas clasificatorias con fondo verde sutil (`rgba(0, 208, 132, 0.05)`) y borde izquierdo inset (`box-shadow: inset 3px 0 0 var(--color-primary)` en `td:first-child`), compatible con `border-collapse: collapse` y erradicando el símbolo `▲`.
     - Leyenda discreta inferior al pie de la tabla: `"Clasifican N"` (`.public-clasifican-legend`).
  2. **Tratamiento Inteligente de Estado "Sin jugar":**
     - Detección reactiva a nivel de zona cuando todas las parejas tienen 0 partidos jugados (`zona.tabla.every(r => r.pj === 0)`).
     - Supresión total de columnas de ceros artificiales (`0 · 0 · 0 · 0 · 0`), mostrando en su lugar las columnas `#`, `Pareja` y una columna derecha `Estado` con el texto `"Sin jugar"` en itálica atenuada (`var(--color-text-muted)`).
  3. **Desanidado de Tarjeta Contenedora de Zonas (`.public-zona-mobile`):**
     - Conmutación dinámica del contenedor mediante ternario `isMobile ? 'public-zona-mobile' : 'torneo-card'`.
     - En mobile, se remueven el fondo con gradiente, los bordes, el padding de tarjeta y las sombras (`.public-zona-mobile`), integrando tablas y partidos directamente al ancho completo del viewport.
     - Supresión del chip redundante `"Clasifican N"` en el encabezado de la zona en vista móvil para evitar duplicidad con la leyenda inferior.
     - Separador horizontal tenue (`<hr className="public-zona-separator" />`) entre zonas consecutivas cuando se navega en la vista "Todas" (`activeZoneId === null && zIdx > 0`).
  4. **Protección Absoluta de Vista Desktop:**
     - En pantallas $\ge 769\text{px}$, el contenedor `.torneo-card`, el chip de cabecera `"Clasifican N"`, la flecha verde `▲` y la tabla tradicional de 8 columnas (`POS`, `PAREJA`, `PTS`, `PJ`, `PG`, `PP`, `SETS`, `GAMES`) permanecen 100% inalterados.
  5. **Script de Verificación y Datos de Prueba (`setup-test-mobile.js`):**
     - Script utilitario en backend para generar torneos con escenarios límite: estadísticas de dos dígitos (`DS +12`, `DG −15`, `PTS 12`), nombres largos (`Maximiliano / Maximiliano`), zonas con 0 PJ y mini-brackets en sus 3 etapas (sin jugar, ronda 1, finalizada).
- **Validación y verificación:**
  - Medición en navegador real: celda de nombre con ancho útil de **140px a 320px** y **213px a 393px**.
  - Verificación matemática y de layout: `0px` de scroll horizontal (`scrollWidth === innerWidth`).
  - Verificación en viewports 320px, 393px y desktop 1280px con capturas de pantalla archivadas en `capturas/`.
  - Validación con `npm run build` (609ms) y `npx oxlint` (0 errores, 0 warnings nuevos).
- **Resultado final:** Lectura deportiva profesional y ergonómica en pantallas móviles estrechas (320–393px), eliminación del encajonamiento visual y consistencia completa con el ecosistema de la app.

### Sesión 48 (02/10/2026) — Feature "Mi Pareja": Seguimiento Personalizado en Vista Pública, Bloque Próximo Partido y Resolución de Eliminatorias
- **Objetivo:** Implementar la experiencia de seguimiento personalizado "Mi Pareja" en la vista pública (`TorneoPublic.jsx`), permitiendo a los jugadores y espectadores marcar a su pareja favorita para acceder a un bloque destacado y persistente con su próximo partido en ambas fases (Zonas y Eliminatoria), con feedback inmediato de rival, horario y pase a playoffs, manteniendo las tablas de posiciones y la interfaz limpias y ergonómicas.
- **Implementación técnica:**
  1. **Selección Exclusiva y Ergonómica de Pareja Favorita:**
     - Botón de estrella (`Star` de `lucide-react`) ubicado **exclusivamente dentro del menú desplegable del buscador de parejas** (`.public-search-fav-btn`), alineado a la derecha de cada resultado.
     - Aislamiento estricto de eventos de pulsación (`e.stopPropagation()`): hacer clic sobre el texto de la fila enfoca y scrollea a la zona correspondiente sin alterar el favorito; pulsar la estrella activa o desactiva la pareja favorita.
     - Chip activo de "Mi Pareja" (`.public-search-active-chip`) visible debajo de la barra de búsqueda cuando existe un favorito seleccionado, con su nombre y botón para desmarcarlo en 1 toque (`X` de `lucide-react`).
     - Tablas limpias: se eliminaron las estrellas de las filas de las tablas mobile y desktop para priorizar una lectura deportiva pura sin interferencias visuales.
     - Persistencia desacoplada en `localStorage` con clave parametrizada por torneo (`padel_fav_pareja_${slug}`), garantizando que la selección sobreviva a recargas de página y cambios de categoría, sin colisionar entre torneos diferentes.
  2. **Bloque Destacado "Tu próximo partido" (`.public-next-match-card`):**
     - Renderizado prioritario y visible en ambas pestañas principales (`activePhase === 'zonas'` y `activePhase === 'eliminatoria'`), ubicado inmediatamente debajo del bloque de búsqueda.
     - Erradicación total de referencias a número de cancha (`canchaNumero` / "Cancha X"), respondiendo a la premisa de diseño de que a los jugadores les resulta indiferente la pista asignada y priorizan horario y rival.
     - Estados y badges del próximo partido:
       - **En Juego (`EN_CURSO`):** Badge `"Jugando ahora"` con punto pulsante en verde deportivo (`status-en-juego`), rival `vs. [Nombre]` y metadato con nombre de zona o fase.
       - **Pendiente en Zonas (`PENDIENTE`):** Badge de horario formateado en Córdoba (`Vie 19:30` o `"Horario por confirmar"`), rival `vs. [Nombre]` y metadato con nombre de zona.
       - **Clasificado a Eliminatorias / Pendiente en Playoffs (`status-clasificado`):** Badge destacado `"¡Clasificaste a eliminatorias!"` con ícono dorado de Trofeo (`Trophy` de `lucide-react` con `var(--color-warning)`), rival directo (`vs. [Nombre]`), proyectado (`vs. 2° Zona B` o similar a partir del origen del cruce) o `"Cruce por definirse"`, y metadatos con horario y fase (`Cuartos de Final`, `Semifinal`, etc.).
  3. **Algoritmo de Detección de Clasificación y Cruces de Eliminatoria:**
     - Resolución robusta en dos vías:
       - *Vía A (Partido de playoff asignado por ID):* Si la pareja favorita ya se encuentra asignada en `pareja1Id` o `pareja2Id` en un partido de eliminatorias con estado `PENDIENTE`, se activa de inmediato la tarjeta dorada de clasificación con trofeo, horario y rival. (Resolución del bug donde los partidos de eliminatorias caían prematuramente en la prioridad 2 estándar mostrando únicamente el horario en vez del estado de clasificación).
       - *Vía B (Cruce proyectado por origen semántico):* Si las zonas concluyeron y la pareja clasificó (`posicion <= zona.clasifican`), el algoritmo busca en el cuadro eliminatorio el partido donde `origenPareja1` u `origenPareja2` coincida con la posición ordinal de la pareja en su zona (`${posicion}° ${zonaNombre}`). Si el rival de la otra llave ya está asignado o tiene origen, se expone claramente (`vs. [Nombre]` o `vs. [Origen]`); si aún no está determinado, se indica honestamente `"Cruce por definirse"`.
     - Inyección de `parejaId` en el array de `tabla` de posiciones en el endpoint público (`GET /api/public/:slug` en `public.controller.js`), garantizando cruce por ID inmutable en lugar de emparejamiento por strings de texto.
  4. **Depuración Visual y Limpieza de Leyendas:**
     - Supresión del indicador de flecha `▲` en la tabla de posiciones desktop (`.pos-table`), sustituyéndolo por un fondo destacado sutil en la fila de clasificación consistente con el estándar mobile (`bd4c83a`).
     - Eliminación de la leyenda redundante `"Clasifican N"` debajo de la mini-tabla mobile (`.public-clasifican-legend`), maximizando la economía visual del viewport móvil (`31f202d`).
     - Memoización estricta de colecciones (`zonas`, `eliminatoria`) para estabilidad de hooks de React y cero warnings de linters.
  5. **Herramientas de Seed y Verificación Multi-Torneo:**
     - Script utilitario `backend/scripts/setup-test-mi-pareja.js` para simular torneos con zonas finalizadas, eliminatorias en borrador, cruces por orígenes y partidos en juego.
     - Verificación exhaustiva en torneos reales y sintéticos (`test-mi-pareja`, `pares-agosto-8d39c9`, `t1-51517b`, `torneo-auto-a26b86`).
- **Validación y verificación:**
  - Inspección en navegador real con subagente visual en viewports móviles (320px, 393px, 502px) y escritorio.
  - Validación con `npm run build` exitoso (1.17s) y `npx oxlint` (0 errores, 0 warnings nuevos).
- **Resultado final:** Experiencia sumamente ágil y personalizada para jugadores y seguidores del torneo, permitiéndoles identificar al instante cuándo juegan, contra quién y si clasificaron a la siguiente ronda, sin perderse en la inmensidad del cuadro general.

### Sesión 49 (02/10/2026) — Pestaña "Horarios" en Vista Pública y Búsqueda Interactiva por Pareja
- **Objetivo:** Incorporar una vista cronológica completa ("Horarios") en la vista pública (`TorneoPublic.jsx`) como tercera pestaña del control segmentado, respondiendo a la necesidad de jugadores y espectadores de conocer qué partidos están en juego y qué viene a continuación, con agrupamiento por día en la zona horaria de Córdoba, toggle persistente de partidos finalizados y filtro interactivo por pareja desde el buscador sin abandonar la vista cronológica.
- **Implementación técnica:**
  1. **Tercera Pestaña "Horarios" en Control Segmentado:** Incorporé una tercera pestaña al control segmentado sticky de la vista pública, disponible siempre que haya partidos programados en la categoría activa. Para evitar saturación en pantallas estrechas (320px–375px), el control oculta los subtextos de estado (`display: none`) mediante una media query ajustada a $\le 520\text{px}$, y se expande hasta `480px` en pantallas mayores, garantizando cero scroll horizontal o saltos de línea.
  2. **Agrupamiento y Orden Cronológico en Córdoba:** Implementé el helper `getDiaCalendarioCordoba(fechaHora)` en `dateUtils.js` utilizando `Intl.DateTimeFormat` configurado estrictamente con `timeZone: 'America/Argentina/Cordoba'`. Esto asegura que los partidos se agrupen por día de la semana (`"Viernes"`, `"Sábado"`, `"Domingo"`) sin fecha numérica y previene el bug de desfase UTC donde partidos nocturnos (ej. 23:30) caían en el día siguiente.
  3. **Partidos en Juego Destacados:** Los partidos con estado `EN_CURSO` se extraen y muestran con prioridad exclusiva al inicio de la pestaña en una sección destacada con dot pulsante verde y badge `"En juego"`, sin duplicarse en el listado del día.
  4. **Toggle de Finalizados Persistente:** Por defecto se listan partidos `EN_CURSO` y `PENDIENTE`. Un chip/toggle `"Ver finalizados"` permite incorporar los partidos concluidos, manteniendo su estado en React sin resetearse ante el ciclo de polling de 15 segundos.
  5. **Búsqueda y Filtro de Pareja en Horarios:** Al seleccionar una pareja desde el buscador mientras se está en la pestaña Horarios, la vista permanece en Horarios y aplica un filtro que muestra **todos los partidos de esa pareja** (zonas y eliminatorias, incluidos finalizados), ocultando el toggle general. Se incorpora un chip removible `"Mostrando: {Nombre} ✕"` con área táctil $\ge 40\text{px}$ y truncado elástico con ellipsis en 320px.
  6. **Coincidencia Estricta y Limpieza Determinista:** El emparejamiento compara prioritariamente por `pareja1Id` / `pareja2Id`, recurriendo al nombre solo como fallback si el partido no trae ID (sin operadores OR combinados). La limpieza del filtro se realiza de forma síncrona en los manejadores de eventos (cambio de tab o categoría), eliminando cualquier riesgo de condiciones de carrera con hooks de ciclo de vida.
  7. **Diseño Deportivo y Consistencia Visual:** Reutilización de `PublicMatchCard` con etiqueta corta de origen (`label`, ej. `"Zona A"`, `"Zona B · Ronda 1"`, `"Cuartos de final"`), acento dorado de favorito (`.fav-match`), sección `"Horario por confirmar"` para cruces pendientes sin hora pautada y supresión absoluta de números de cancha.
- **Validación y verificación:**
  - Build de producción con Vite (`npm run build`) validado exitosamente sin warnings.
  - Verificación estática con `oxlint` (0 errores).
  - Pruebas unitarias de zona horaria y cálculo de días en Node.js para casos borde de trasnoche (23:30 y 00:15).
  - Verificación de layout responsivo en viewports móviles de 320px, 360px, 375px y monitores de escritorio.
- **Resultado final:** Una vista cronológica impecable, fluida y mobile-first que responde al instante qué partidos están en juego y cuáles siguen a continuación, complementada con un filtro personalizado por pareja ágil y accesible.

### Sesión 50 (02/10/2026) — Skeleton de Carga Inicial e Indicador de Última Actualización en Vista Pública
- **Objetivo:** Mejorar la percepción de velocidad, estabilidad visual y confianza en la vista pública (`TorneoPublic.jsx` e `index.css`), reemplazando el estado de carga inicial por un skeleton idéntico a la estructura real (título, meta, chips de categoría, control segmentado y 3 tarjetas) con animación shimmer suave y soporte para `prefers-reduced-motion`, e incorporando un indicador discreto de última actualización en el header no-sticky ("Actualizado ahora" / "hace X s" / "Sin actualizar hace X s") con estado de advertencia a los 35 segundos, pausa de timer en segundo plano vía `document.visibilityState` y protección contra caídas de red sin romper la vista ni borrar los datos cargados.
- **Implementación técnica:**
  1. **Skeleton de Primera Carga (`TorneoPublicSkeleton`):** Sustitución del texto/spinner simple por un esqueleto visual que replica exactamente las alturas y proporciones del layout real (título centrado, fila de chips de categorías, barra segmentada y 3 tarjetas de partido con header y filas de jugadores). Ocupa la misma altura en viewport evitando saltos bruscos de maquetación (CLS) cuando los datos del servidor terminan de llegar.
  2. **Animación Shimmer y Accesibilidad:** Implementación de degradé lineal suave (`rgba(255, 255, 255, 0.03)` a `0.08`) animado en CSS (`public-skeleton-shimmer`). Soporte estricto para usuarios con reducción de movimiento activada (`@media (prefers-reduced-motion: reduce)`), congelando la animación a bloques planos neutros. Contenedor accesible con `role="status"`, `aria-busy="true"` y texto para lectores de pantalla mediante la clase utilitaria existente `.sr-only` ("Cargando torneo").
  3. **Aislamiento en Primera Carga:** El skeleton se muestra únicamente mientras `loading === true`. Gracias al bloque `finally` de `fetchData`, si la primera petición falla, `loading` pasa inmediatamente a `false` permitiendo que la interfaz renderice la pantalla de error ("Torneo no encontrado") sin quedar trabada en skeleton. En ciclos de polling posteriores, el skeleton nunca vuelve a renderizarse.
  4. **Componente Aislado de Contador (`UltimaActualizacion`):** Extracción de un micro-componente independiente con su propio estado local (`now`) y timer (`setInterval(1000)`), recibiendo únicamente el timestamp del último fetch exitoso (`lastUpdated`). Esto garantiza que el avance segundo a segundo del contador no dispare re-renders innecesarios sobre el componente raíz `TorneoPublic`.
  5. **Formateo y Estado Warning Determinista:**
     - `< 5 s`: `"Actualizado ahora"`
     - `5 a 34 s`: `"Actualizado hace ${diffSec} s"`
     - `≥ 35 s`: `"Sin actualizar hace ${diffSec} s"` (o `min` / `h`) con cambio de color al token semántico de advertencia existente (`--color-warning`).
     Punto de estado estático (`.public-update-dot`) verde (`--color-success`) cuando está al día y ámbar (`--color-warning`) cuando está desactualizado, sin pulsos que colisionen semánticamente con los partidos "En juego" y con `aria-hidden="true"`.
  6. **Pausa por Visibilidad y Sincronización Inmediata:** Escucha nativa del evento `visibilitychange`. Cuando la pestaña queda en segundo plano (`hidden`), el intervalo del contador se destruye evitando consumo de CPU. Al regresar (`visible`), se recalcula el contador al instante y se dispara un `fetchData()` único protegido con flag de exclusión mutua `inFlightRef`, previniendo peticiones duplicadas y actualizando el torneo sin alterar ni duplicar el intervalo periódico de 15 s.
  7. **Blindaje de Stale Closure con `dataRef`:** Detección y corrección de un error sutil en el manejo de fallos de red durante el polling: el `catch (err)` original evaluaba `if (!data) setError(...)`, cerrando sobre el `data = null` inicial del primer render. Al perder conexión, la app reemplazaba la vista completa con `"Failed to fetch"`. Se incorporó `dataRef = useRef(null)` para consultar el estado en memoria en tiempo real, garantizando que ante micro-cortes o caída del backend los datos ya cargados permanezcan 100% visibles mientras el indicador advierte la falta de conexión.
  8. **Diseño Mobile-First 320px sin Inline Styles:** Estilización completa mediante clases dedicadas en `index.css` utilizando tokens del sistema de diseño (`--color-success`, `--color-warning`, `--color-border`, `--color-text-secondary`, `--radius-md`, etc.). Cero estilos inline nuevos, ubicada en el header no-sticky para no saturar la barra sticky ($\le 96$px), y garantizando cero scroll horizontal en 320px.
- **Validación y verificación:**
  - Build de producción con Vite (`npm run build`) validado exitosamente (346 ms).
  - Verificación estática con `oxlint` (0 errores).
  - Validación de comportamiento offline y recuperación en navegador.
  - Verificación responsiva en 320px, 360px, 375px y desktop.
- **Resultado final:** Carga inicial inmediata y suave sin parpadeos ni brincos de layout, acompañada de un indicador confiable y transparente que brinda certeza al usuario sobre el estado de la información en tiempo real sin saturar la pantalla ni consumir recursos innecesarios.

### Sesión 51 (02/10/2026) — Rebranding del Sistema: Migración de Marca Visible a "Fixi" y Centralización de Constantes
- **Objetivo:** Renombrar la marca comercial visible de la aplicación de "Pádel Torneos" a "Fixi" (sin sufijos), centralizando el nombre y el lema en un módulo único reutilizable para evitar duplicaciones futuras, asegurando la consistencia en interfaces públicas, panel administrativo, autenticación, metadatos SEO/Open Graph y documentación de arquitectura, sin alterar el funcionamiento interno ni invalidar datos preexistentes.
- **Implementación técnica:**
  1. **Módulo Centralizado de Constantes (`app.js`):** Creación de `frontend/src/constants/app.js` exportando `APP_NAME = 'Fixi'` y `APP_TAGLINE = 'Torneos de pádel en vivo'`, permitiendo que cualquier componente consuma la marca como única fuente de verdad.
  2. **Metadatos HTML, PWA y Open Graph (`index.html`):**
     - Actualización del `<title>` por defecto a `Fixi — Torneos de pádel en vivo`.
     - Definición de `<meta name="apple-mobile-web-app-title" content="Fixi" />`.
     - Meta description concisa y limpia: `"Seguimiento en tiempo real de torneos de pádel amateur"`.
     - Etiquetas Open Graph para previsualización en redes y mensajería: `og:type = "website"`, `og:title`, `og:description` y `og:site_name = "Fixi"`.
  3. **Identidad en Panel de Administración (`AdminLayout.jsx`):** Reemplazo del texto estático en el logo del navbar por `{APP_NAME}`, manteniendo intacto el botón y ruta funcional "Mis Torneos".
  4. **Identidad en Autenticación (`Login.jsx` y `Register.jsx`):** Reemplazo de la marca en los encabezados principales `<h1>` por `{APP_NAME}` junto al ícono vectorial de `lucide-react`.
  5. **Footer Público (`PublicLayout.jsx`):** Reemplazo del pie de página por `{APP_NAME} — {APP_TAGLINE}` con ícono de `Award`.
  6. **Título Dinámico con Cleanup al Desmontar (`TorneoPublic.jsx`):**
     - Implementación de un `useEffect` reactivo a `data?.torneo?.nombre`.
     - Mientras carga o ante error: `document.title = APP_NAME` (`"Fixi"`).
     - Al cargar los datos del torneo: `document.title = `${data.torneo.nombre} · ${APP_NAME}`` (ej. `"Torneo Apertura · Fixi"`).
     - Función de limpieza (`cleanup`) al desmontar el componente: restaura inmediatamente el título genérico `${APP_NAME} — ${APP_TAGLINE}`, evitando que al navegar hacia el panel de administración o login persista el nombre del torneo en la pestaña.
  7. **Preservación Estricta de Datos y Rutas:** No se modificaron rutas de API (`/api/*`), modelos o tablas de base de datos, nombres de paquetes npm, carpetas de repositorio ni claves de `localStorage` (`padel_fav_pareja_${slug}` y `miPareja:${slug}:${catId}`), asegurando cero fricción para usuarios existentes.
  8. **Alineación de Documentación y Schema:** Actualización de títulos en `README.md`, `CONTEXT.md`, línea 1 de `PLAN.md` y comentario de cabecera en `backend/prisma/schema.prisma`.
- **Validación y verificación:**
  - Compilación de producción con Vite (`npm run build`) validada exitosamente en 387 ms.
  - Verificación estática con `oxlint` (0 errores).
  - Verificación exhaustiva de diff (`git diff main...HEAD`).
  - Verificación de no-regresión en almacenamiento local y navegación.
- **Resultado final:** Identidad moderna, limpia y profesional bajo la marca "Fixi", totalmente centralizada y libre de referencias residuales a la denominación anterior.

### Sesión 52 (02/10/2026) — Auditoría Integral de Código, Blindaje de Autorización (IDOR) y Limpieza Sistemática de Código Muerto
- **Objetivo:** Auditar exhaustivamente el repositorio completo (frontend y backend) para detectar y clasificar código muerto, componentes huérfanos, selectores CSS en desuso, dependencias residuales y vulnerabilidades de seguridad, blindando la autorización multitenant en endpoints desprotegidos y aplicando una limpieza quirúrgica de confianza Alta en commits atómicos sin alterar comportamientos del sistema.
- **Implementación técnica:**
  1. **Informe Exhaustivo de Auditoría (`AUDITORIA.md`):** Detección y catalogación con nivel de evidencia y confianza (Alta, Media, Baja) de código muerto en Frontend (componentes, hooks, variables, imports), CSS (`index.css`), dependencias (`package.json`), Backend (rutas, controllers, services, Prisma schema) y archivos fuera de lugar.
  2. **Blindaje de Autorización y Erradicación de IDOR:**
     - Endpoints de disponibilidad horaria (`disponibilidad.controller.js` y `disponibilidad.service.js`): validación estricta de pertenencia del organizador (`req.organizadorId`) en `getDisponibilidad`, `setDisponibilidad`, `setDisponibilidadDoble` y `removerDisponibilidadDoble`, verificando la cadena `pareja -> categoria -> torneo.organizadorId` con rechazo 403 ante recursos ajenos.
     - Endpoint de consulta de partidos (`categoria.controller.js` y `categoria.service.js`): validación en `GET /api/categorias/:id/partidos` verificando que la categoría pertenezca a un torneo del organizador solicitante (403 si es ajena).
     - Suite automatizada de pruebas de autorización (`test-authz-disponibilidad.js`) con verificación al 100% de aislamiento multitenant.
  3. **Seguridad en Entorno y Credenciales:**
     - Des-tracking del archivo sensible `backend/.env` del repositorio (`git rm --cached`), asegurando su exclusión en `.gitignore` y verificando `.env.example` con valores de ejemplo limpios.
     - Guardián en producción de `JWT_SECRET` (`backend/src/index.js`): bloqueo inmediato del arranque del servidor en `NODE_ENV === 'production'` si la clave es débil (< 32 caracteres) o utiliza el valor por defecto.
  4. **Punto de Restauración:** Creación de tag `pre-limpieza` sobre `main` previo a las modificaciones destructivas.
  5. **Limpieza Quirúrgica en Commits Atómicos (Confianza Alta):**
     - *Assets y Componentes Huérfanos:* Eliminación de `App.css`, `hero.png`, `react.svg`, `vite.svg`, `DateTimeInput.jsx` e `InicioDisponibilidadModal.jsx` (verificado 0 imports estáticos/dinámicos).
     - *Frontend Imports y Variables:* Limpieza de `useRef`, `useNavigate` y `navigate` sin uso en `CategoriaDetail.jsx`, `TorneoDetail.jsx` y `EliminatoriaView.jsx`; íconos `MoreVertical`, `Trophy`, `Edit2`, `Plus` y `Loader2`; parámetros `err` no utilizados en `catch` de `InlineDisponibilidadEditor.jsx`; eliminación de `ESTADO_CATEGORIA_LABELS` y privatización de exports en `estadoLabels.js`.
     - *Backend:* Retiro de rutas no consumidas `POST /organizador/iniciar-todos` y `/pre-check-inicio` con sus controladores y alias en `organizador.service.js`; eliminación de `calcularCasiEstrellas`, `PLAN_TTL_MS` y variable muerta en `eliminatoriaScheduler.service.js`; privatización de `SLOT_GRANULARIDAD_MIN` en `slots.service.js` y remoción de alias en `zona.service.js`.
     - *Scripts sueltos:* Eliminación de `backend/test-bracket.js`.
     - *CSS:* Depuración en `index.css` de selectores huérfanos (`.stub-message`, bloque `.sidebar-nav`, `.partidos-grid`, `.resultado-modal-grid`, `.disponibilidad-badge`, `.ronda-progress-badge`, `.match-card-empty`, `.public-bracket-tab-badge`, bloque de posiciones mobile viejas, `.public-tabla-pareja-wrap`, `.public-fav-btn` y `.public-clasifican-legend`), preservando al 100% selectores dinámicos y clases sospechosas.
  6. **Control de Regresiones e Identificadores Indefinidos:** Detección y corrección de la remoción de `useNavigate` en `TorneoEnVivo.jsx` (`0253dc2`), y verificación exhaustiva con `oxlint -D no-undef` sobre todo el código fuente frontend y backend (0 errores).
  7. **Merge y Sincronización:** Merge fast-forward de `chore/limpieza` a `main`, validación de suites de tests y push completo al repositorio remoto (`origin/main`, tags y ramas de respaldo).
- **Validación y verificación:**
  - `oxlint -D no-undef` en `frontend/src` y `backend/src`: 0 errores.
  - Build de producción con Vite: 0 errores.
  - Tests automatizados `test-authz-disponibilidad.js` y `test-precheck-snapshot.js`: 100% exitosos con servidor activo.
- **Resultado final:** Reducción de más de 770 líneas de código muerto, vulnerabilidades IDOR completamente selladas, guardián de JWT activo y base de código limpia y documentada.

### Sesión 53 (02/10/2026) — Desacople de Edición en Cabecera de Torneo y Especialización del Modal Exclusivo de Fecha
- **Objetivo:** Desacoplar la edición del nombre y la fecha del torneo en la cabecera de `TorneoDetail.jsx`, eliminando el botón redundante "Editar Torneo" para respetar la regla de CTA único primario y especializando el modal abierto por el chip de fecha para editar única y exclusivamente la fecha de inicio, retirando el campo de nombre y depurando código y estados no utilizados.
- **Implementación técnica:**
  1. **Remoción de Botón Redundante en Cabecera:** Eliminación del botón "Editar Torneo" (`Edit` + texto) de la barra de acciones superiores en `TorneoDetail.jsx`. Se preservan las acciones secundarias neutras (`btn-ghost`) y el CTA primario ("Día de Torneo" / "Iniciar Torneo"), dejando la edición del nombre canalizada a través de la edición inline rápida sobre el propio título `<h1>`.
  2. **Especialización del Modal de Fecha:** Modificación del modal interactivo a "Editar Fecha del Torneo", retirando el campo `<input>` de nombre, el label y el estado `editNombre`. El modal conserva exclusivamente el selector de fecha y su texto de ayuda sobre slots de Viernes y Sábado.
  3. **Payload Parcial en Submit:** En el envío del formulario se envía `{ fecha: editFecha || null }` al endpoint `PUT /api/torneos/:id`, aprovechando que `updateTorneo` en `torneo.service.js` soporta actualizaciones parciales y preserva el nombre existente sin alteraciones.
  4. **Prevención de Auto-Focus en Mobile:** Retiro del atributo `autoFocus` del selector de fecha para evitar la apertura intrusiva del teclado o picker nativo al desplegar el modal en dispositivos móviles.
  5. **Diseño Mobile-First en Acciones:** Ajuste de layout con `flexWrap: 'wrap'` en el pie de botones del modal (`Cancelar` / `Guardar Fecha`) y en la cabecera para pantallas $\le 480\text{px}$ y $\le 376\text{px}$.
- **Validación y verificación:**
  - Build de producción con Vite (`npm run build`) validado exitosamente.
  - Verificación estática con `oxlint -D no-undef` (0 errores).
  - Verificación visual en navegadores móviles (360px y 375px).
- **Resultado final:** Cabecera despejada sin acciones redundantes, modal de fecha específico y ergonómico, y código frontend limpio sin variables ni estados huérfanos.

### Sesión 54 (02/10/2026) — Blindaje y Guard de Fecha de Torneo Fuera de BORRADOR
- **Objetivo:** Impedir la modificación o vaciado de la fecha de inicio de un torneo (`torneo.fecha`) una vez que ha salido del estado `BORRADOR` (`EN_CURSO` o `FINALIZADO`), protegiendo la coherencia de slots horarios, tabs de días en Día de Torneo (`TorneoEnVivo.jsx`), determinación de jornada en Modo Lluvia y scheduling dominical de playoffs, manteniendo la editabilidad plena en `BORRADOR` y restaurándola tras un reinicio de torneo.
- **Implementación técnica:**
  1. **Guard en Backend (`torneo.service.js`):** En `updateTorneo`, validación que consulta el estado real en la base de datos. Si `torneo.estado !== 'BORRADOR'` y `data.fecha !== undefined`, compara la fecha enviada con la actual mediante normalización determinista con `parseFechaLocal`. Si la fecha difiere o se intenta vaciar a `null`, rechaza la petición con HTTP 400 (`"No se puede modificar la fecha de un torneo que ya inició. Reiniciá el torneo para poder cambiarla."`). Si se reenvía la misma fecha o solo se modifica el nombre, se permite sin bloqueos.
  2. **Chip de Solo Lectura en Frontend (`TorneoDetail.jsx`):** Cuando `torneo.estado !== 'BORRADOR'`, el botón interactivo de fecha se convierte en un `<span>` con dimensiones y estilos idénticos (mismo padding, border y tipografía), sin el ícono de lápiz, sin interacción de clic ni apertura de modal, y con tooltip descriptivo `title="La fecha no se puede cambiar una vez iniciado el torneo"`. En `BORRADOR` se mantiene el botón interactivo con lápiz.
  3. **Defensa en Profundidad en Modal:** Manejo de error en el submit del modal para desplegar el mensaje de error del backend en lugar de fallar silenciosamente.
  4. **Suite de Regresión Automatizada (`test-torneo-fecha-guard.js`):** Script de pruebas que valida exhaustivamente: `BORRADOR` (modificación y vaciado permitidos), `EN_CURSO` (bloqueo 400 ante modificación o vaciado, 200 ante misma fecha o cambio solo de nombre), `FINALIZADO` (bloqueo 400), post-reinicio a `BORRADOR` (fecha vuelve a ser editable) y multitenant (rechazo 403 a organizadores ajenos).
- **Validación y verificación:**
  - Ejecución de `node backend/scripts/test-torneo-fecha-guard.js` con 100% de tests aprobados.
  - Verificación estática con `oxlint -D no-undef` en backend y frontend (0 errores).
  - Inspección responsive en 360px y 375px sin desborde horizontal ni saltos de layout en cabecera.
- **Resultado final:** Blindaje total de la fuente de verdad temporal del torneo post-arranque, con interfaz intuitiva que previene errores operativos sin degradar la edición rápida del nombre.

### Sesión 55 (03/10/2026) — Bloqueo de Edición de Disponibilidad Horaria Post-Inicio y Vista de Solo Lectura
- **Objetivo:** Bloquear estrictamente la edición de disponibilidad horaria de las parejas una vez iniciada la categoría (`categoria.estado !== 'BORRADOR'`). Se revierte parcialmente la decisión técnica de la sesión 34 (que permitía editar en `EN_CURSO` y bloqueaba solo en `FINALIZADO`), estableciendo como regla de dominio que la disponibilidad es un dato de inscripción que se congela irrevocablemente al iniciar el torneo. Cualquier imprevisto u horario sobrevenido se resuelve exclusivamente reprogramando el partido correspondiente (`AsignarHorarioModal` / "Reprogramar"), que escribe directo en `Partido` (`fechaHora` y `canchaNumero`) sin tocar ni contaminar `SlotPareja`.
- **Implementación técnica:**
  1. **Auditoría Previa de Escritura de Disponibilidad:** Relevamiento exhaustivo de todos los puntos de mutación de `SlotPareja` en el backend. Se confirmó que ni el alta tardía (`agregarParejaAZona`), ni el traspaso de zonas (`moverParejaDeZona`), ni la reprogramación en vivo alteran `SlotPareja`, permitiendo blindar el ciclo de vida sin romper flujos legítimos post-inicio.
  2. **Guards de Ciclo de Vida en Backend (`disponibilidad.service.js`):** En `setDisponibilidad`, `setDisponibilidadDoble` y `removerDisponibilidadDoble`, rechazo con HTTP 400 (`"La disponibilidad no se puede modificar una vez iniciada la categoría. Para cambiar un horario, reprogramá el partido."`) ante cualquier categoría con `categoria.estado !== 'BORRADOR'` (leyendo el estado real de la base de datos). Se preserva la precedencia del guard multitenant (`403 Forbidden` ante parejas de organizadores ajenos).
  3. **Vista Unificada de Solo Lectura en Frontend (`DisponibilidadEditor.jsx`):** En categorías `EN_CURSO` y `FINALIZADO`, el chip "N turnos" en `ParejasManager.jsx` sigue siendo interactivo pero despliega una vista limpia de solo lectura con lo declarado en la inscripción, agrupando rangos contiguos legibles por día con el helper `agruparSlotsEnRangos` (ej. `"Viernes: sin horarios"`, `"Sábado: 13:30 a 19:15"`), total de turnos al pie, nota explicativa pedagógica y supresión total de sliders o botones de edición (`agregar`, `limpiar`, `día completo`, `eliminar`). Para parejas sin disponibilidad declarada o de alta tardía (0 slots), se reemplaza la lista de días por el mensaje explícito *"Sin disponibilidad declarada (se puede programar en cualquier horario)"* y pie *"Disponibilidad libre (0 restricciones)"*, erradicando interpretaciones erróneas de "no puede jugar nunca".
  4. **Guard de Seguridad Granular en Importador CLI (`actualizar-horarios-parejas.js`):** Blindaje del script administrativo de Excel validando el ciclo de vida por categoría. Si una categoría ya inició, se omite con advertencia y se mantiene congelada su disponibilidad; si todas las categorías del torneo ya iniciaron, se aborta la ejecución con mensaje informativo, permitiendo importar disponibilidad en categorías que sigan en `BORRADOR`.
  5. **Limpieza de Ramas Muertas y Tooltips:** Remoción de advertencias redundantes de `EN_CURSO` y `FINALIZADO`, depuración de variables no utilizadas en `ParejasManager.jsx` y actualización del tooltip del chip a `"Ver disponibilidad horaria (solo lectura)"` cuando no es borrador.
  6. **Suite de Regresión Automatizada y Demostración de Flujo Real (`test-disponibilidad-guard.js`, `test-authz-disponibilidad.js` y `test-alta-tardia-flujo.js`):** Pruebas integrales de servicio y API HTTP validando: `BORRADOR` (edición y endpoints dobles permitidos 200 OK), `EN_CURSO` y `FINALIZADO` (bloqueo 400 con mensaje pedagógico en `PUT`, `PUT doble` y `POST remover`, manteniendo `GET` en 200 OK para lectura), multitenant prioritario (403 Forbidden) y demostración de ciclo de vida completo de alta tardía (creación con 0 slots, scheduling automático adaptado a la pareja rival y asignación manual exitosa vía `asignarHorarioManual`).
- **Validación y verificación:**
  - Ejecución de `node backend/scripts/test-disponibilidad-guard.js`, `node backend/scripts/test-authz-disponibilidad.js` y `node backend/scripts/test-alta-tardia-flujo.js` con 100% de tests aprobados.
  - Verificación estática con `oxlint -D no-undef` en frontend y backend (0 errores).
  - Verificación de diseño responsive por análisis de código CSS sin interacción vía navegador (control de desbordes en 375px y 360px).
- **Resultado final:** Congelamiento robusto e inmutable de la disponibilidad declarada en inscripción una vez iniciada la competencia, interfaz de solo lectura clara y elegante, resolución transparente de parejas tardías con disponibilidad libre, blindaje de scripts CLI y delimitación inequívoca entre la disponibilidad histórica y la reprogramación operativa de partidos.

### Sesión 56 (03/10/2026) — Pulido de Pantalla de Parejas por Categoría (ParejasManager.jsx)
- **Objetivo:** Refinar integralmente la pantalla de Parejas de una categoría (`ParejasManager.jsx`), asegurando que la lista de parejas sea la protagonista absoluta a ancho completo cuando el torneo no está en borrador, eliminando cualquier texto técnico o enum crudo de la interfaz, exhibiendo disponibilidad en horas amigables con alerta crítica para turnos insuficientes (< 75 min), mostrando zona y partidos jugados en categorías iniciadas, integrando un buscador en tiempo real insensible a acentos/mayúsculas para nóminas de más de 8 parejas y garantizando un layout mobile-first impecable por código.
- **Implementación técnica:**
  1. **Banner fino informativo en lugar de panel lateral:** En categorías fuera de `BORRADOR`, se sustituyó el panel de advertencia lateral de 2 columnas por un banner sobrio y compacto arriba de la lista (`.card` informativa de 1 o 2 líneas), permitiendo que la lista ocupe el 100% del ancho disponible. En `BORRADOR` se preserva intacto el layout de dos columnas con el formulario de alta. Copy contextual: en `EN_CURSO` orienta hacia *"Agregar pareja a zona"* en el detalle de la categoría; en `FINALIZADO` aclara que la nómina está cerrada.
  2. **Limpieza de jerga técnica y vocabulario interno:** Erradicación de frases como `(limitación conocida)` y reemplazo de enums crudos (`EN_CURSO` $\rightarrow$ `estadoLabel()`), explicando los bloqueos en términos del organizador deportivo (integridad de zonas, partidos y estadísticas).
  3. **Chip de turnos en horas e indicador crítico:** Formateo amigable mediante `formatHorasDisponibles` (ej. 20 turnos = "5 h", "1 h 15 min", "15 min"; 0 turnos: "Sin restricción" fuera de borrador / "Sin cargar" en borrador; tooltip con el conteo exacto de slots). Indicador crítico con tokens de advertencia (`var(--color-warning)`, `var(--color-warning-bg)`, `var(--color-warning-border)`) e ícono `AlertTriangle` cuando la disponibilidad declarada es menor a la duración reglamentaria de un partido (`cantSlots > 0 && cantSlots < 5`, es decir, $<75$ min).
  4. **Zona y progreso de partidos por pareja:** En categorías fuera de `BORRADOR`, cada pareja exhibe su chip de zona ("Zona A") y progreso ("1/3 jugados"), obtenido mediante un `include` quirúrgico en `pareja.service.js` (`zonaParejas` $\rightarrow$ `zona` con `partidos` asociados) validado con pertenencia multitenant.
  5. **Buscador en tiempo real con normalización NFD:** Componente de búsqueda interactivo con ícono de lupa y botón para limpiar (`X`), filtrado reactivo insensible a mayúsculas y acentos (`normalizeText`), contador dinámico contextual ("3 de 23 inscriptas") y estado vacío personalizado ("Ninguna pareja coincide con la búsqueda"), activo para nóminas de más de 8 parejas (`> 8`).
  6. **Mobile-first en dos filas fijas por código:** Subtítulo con el nombre del torneo bajo el título de categoría, conservación de numeración correlativa (`#1`, `#2`...), estructuración de chips en dos filas estructurales en mobile ($\le 600\text{px}$) mediante `.pareja-chips-fila1` (Zona + Partidos jugados fuera de BORRADOR) y `.pareja-chips-fila2` (Horas disponibles y botón de eliminar en BORRADOR alineados a la izquierda), unificando la altura y disposición en todas las filas; disposición en una sola línea a la derecha preservada en desktop/tablet (> 600px), y resguardo con `flex-wrap` interno y `min-width: 0` sin scroll horizontal en 320px, 360px y 375px.
  7. **Suite de regresión automatizada (`test-parejas-categoria-zona.js`):** Script de verificación con datos aislados que comprueba: zonas vacías en borrador, zona y partidos (1/1 jugados) en categorías iniciadas, y respuesta HTTP 403 Forbidden ante organizadores ajenos, con limpieza automática en bloque `finally`.
- **Validación y verificación:**
  - Ejecución de `node backend/scripts/test-parejas-categoria-zona.js` con 100% de tests aprobados.
  - Verificación estática con `oxlint -D no-undef` en frontend y backend (0 errores).
  - Compilación exitosa de build de frontend con Vite (`npm run build`).
  - Verificación estricta por código de layout responsivo en 320px, 360px, 375px y desktop.
- **Resultado final:** Pantalla de parejas jerárquica, elegante y deportiva, lista a ancho completo con datos ricos y legibles por fila, búsqueda instantánea y experiencia responsiva fluida sin scroll horizontal.

### Sesión 57 (03/10/2026) — Navbar de Administración Responsiva en Una Sola Fila (AdminLayout.jsx)
- **Objetivo:** Resolver el quiebre y desborde de la navbar del panel de administración (`AdminLayout.jsx`) en pantallas móviles (≤ 440px y hasta 320px), donde los ítems "Mis Torneos" y "Mi Club" se partían en dos líneas y el botón "Cerrar sesión" caía a una segunda fila desarmando la barra, asegurando una fila única horizontal de altura consistente y fija, sin menú hamburguesa ni drawers y preservando intacto el comportamiento en tablet y desktop (> 440px).
- **Implementación técnica:**
  1. **Layout en una sola fila sin wrap (≤ 440px):** Sobreescritura en `@media (max-width: 440px)` para anular el `flex-wrap: wrap` y `width: 100%` heredados de la regla histórica de 768px, fijando `.admin-header` con `flex-wrap: nowrap`, altura fija consistente de `52px` (área táctil $\ge 40$px), padding compacto y `.admin-nav` con ancho automático `width: auto` y enlaces con `white-space: nowrap; flex-shrink: 0`.
  2. **Logout compacto en solo ícono (≤ 440px):** Eliminación del separador vertical izquierdo (`border-left: none; padding-left: 0; margin-left: 0;`), ocultamiento del texto `"Cerrar sesión"` con `.btn-logout-text { display: none; }` y preservación de accesibilidad con `aria-label="Cerrar sesión"`, `title="Cerrar sesión"`, ícono `LogOut` (16px) y área táctil de 40×40px con hover contextual rojo (`--color-danger`).
  3. **Reducción progresiva para pantallas ultra-angostas (≤ 360px):** En anchos de 360px a 320px, ocultamiento del texto "Fixi" del logo (`.admin-logo-text { display: none; }`) preservando el ícono `Award` con `aria-label`, y supresión de los íconos internos de los botones de navegación (`.admin-nav-icon { display: none; }`) dejando únicamente los textos directos y claros `"Mis Torneos"` y `"Mi Club"` (opción elegida por sobre íconos solos para erradicar cualquier ambigüedad cognitiva).
- **Validación y verificación:**
  - Verificación estricta por cálculo de código de anchos acumulados (padding + logo + gaps + nav + logout): 315px a 440px, 400px y 375px; 229px a 360px y 320px (dejando +91px de margen libre a 320px y +71px a 300px sin riesgo de desborde).
  - Verificación estática con `oxlint -D no-undef` en frontend con 0 errores.
  - Compilación exitosa de build de producción con Vite (`npm run build`).
  - *Nota:* Verificación realizada 100% por cálculo geométrico de código sin abrir el navegador.
- **Resultado final:** Barra de navegación administrativa sólida, simétrica y elegante que permanece en una única fila horizontal de 52px desde monitores de escritorio hasta celulares de 320px.

### Sesión 58 (03/10/2026) — Corrección de Desborde Horizontal en Detalle de Torneo Mobile (≤ 347px) y Renombrado a "Categorías"
- **Objetivo:** Resolver el desborde y corte horizontal en la vista de detalle de torneo (`TorneoDetail.jsx`) en dispositivos móviles de ancho $\le 347\text{px}$ (hasta $320\text{px}$), donde el encabezado de categorías y las tarjetas desbordaban el viewport generando scroll horizontal y corte del margen derecho, y simplificar el título de sección de *"Categorías del Torneo"* a solo *"Categorías"*.
- **Implementación técnica:**
  1. **Renombrado y Encabezado Responsivo (`TorneoDetail.jsx` e `index.css`):** Reemplazo de `"Categorías del Torneo"` por `"Categorías"` con `white-space: nowrap` en el `<h2>`. Creación de la clase `.torneo-section-header` con `flex-wrap: wrap` y gap responsivo, y `.torneo-nueva-cat-btn` con reseteo de márgenes y padding/fuente compactos en mobile, permitiendo que título y botón coexistan en una sola fila limpia sin partir palabras desde $320\text{px}$ para arriba.
  2. **Padding Adaptativo y Blindaje de Grilla en Mobile (`index.css`):**
     - `.torneos-grid`: uso de `grid-template-columns: minmax(0, 1fr)` en mobile para evitar que los elementos hijos ensanchen la columna más allá del viewport.
     - `.torneo-card`: adición de `min-width: 0; max-width: 100%;` y reducción de padding de $24\text{px}$ a $16\text{px}$ en $\le 480\text{px}$ y a $12\text{px}$ en $\le 360\text{px}$, recuperando hasta $24\text{px}$ de ancho interior para el contenido.
  3. **Acciones de Tarjeta Niveladas en Fila Única (`.torneo-card-actions`):** Extracción de estilos inline a clases dedicadas con reducción proporcional de padding y font-size (`var(--font-size-xs)`) en $\le 360\text{px}$, asegurando que `Administrar`, `Bracket` y el botón de eliminación entren con más de $60\text{px}$ de holgura en pantallas de $320\text{px}$ sin desbordar ni cortarse.
  4. **Blindaje de Elementos Clave:** Inyección de `maxWidth: '100%'` y `wordBreak: 'break-word'` en el título del torneo (`<h1>`) y botones principales de acción (`Día de Torneo`, `Iniciar Torneo`).
- **Validación y verificación:**
  - Verificación automatizada vía Chrome headless (CDP) evaluando `document.documentElement.scrollWidth === window.innerWidth` a 347px, 340px y 320px con 0 elementos desbordados y captura de screenshots.
  - Verificación estática con `oxlint -D no-undef` en frontend con 0 errores.
  - Compilación exitosa del bundle de producción con Vite (`npm run build`).
- **Resultado final:** Pantalla de detalle de torneo 100% responsiva, sin desborde horizontal ni scroll lateral desde 320px, con título simplificado y tarjetas compactas y legibles.

### Sesión 60 (08/10/2026) — Persistencia de Overrides de Modo Lluvia en Base de Datos Relacional, Consistencia Post-Commit y Baselining de Migraciones Prisma
- **Objetivo:** Auditar y migrar la persistencia de estado del Modo Lluvia (`canchasOverrides.service.js`), eliminando la dependencia de memoria volátil y archivos JSON locales (`canchasOverrides.json`) incompatibles con discos efímeros en hostings cloud (Render/Railway), establecer la tabla relacional `OverrideCanchasDia` como única fuente de verdad con consistencia estricta post-commit, y resolver el drift histórico de base de datos mediante baselining formal de migraciones de Prisma.
- **Implementación técnica:**
  1. **Baselining y Versionado de Migraciones Prisma (`backend/prisma/`):**
     - Se resguardaron las migraciones históricas desactualizadas en `backend/prisma/migrations_archive/`.
     - Generación de la línea base `0_init` vía `prisma migrate diff --from-empty --to-schema-datamodel` y registro con `prisma migrate resolve --applied 0_init`.
     - Creación del modelo relacional `OverrideCanchasDia` con clave única compuesta `@@unique([torneoId, diaKey])`, campo `partidosSinSlot Json?` y relación en cascada con `Torneo`.
     - Generación y aplicación de la migración formal `20261008023741_add_override_canchas_dia` vía `prisma migrate dev` con verificación de integridad de datos (cero pérdida de registros en tablas principales).
     - Documentación de gobernanza en `backend/prisma/README.md` estipulando el uso estricto de `prisma migrate dev` y prohibición de `prisma db push`.
  2. **Fuente Única de Verdad y Desacople de Fallbacks (`canchasOverrides.service.js` y `organizador.service.js`):**
     - Reemplazo de lectura/escritura en JSON local por queries asíncronas sobre `prisma.overrideCanchasDia`.
     - Supresión del fallback que leía columnas escalares en `getEstadoEnVivo` (`Torneo.canchasDisponiblesOverride`), preservando dichas columnas en `Torneo` únicamente para retrocompatibilidad pasiva.
  3. **Caché en Memoria Sincrónica e Hidratación Temprana Obligatoria:**
     - La caché en memoria local (`memoryCache`) se hidrata asincrónicamente al arrancar el backend con `await canchasOverridesService.loadFromDb()` en `index.js` **antes de `app.listen()`**.
     - Blindaje con `assertCacheLoaded()`: si la caché está en `null`, los getters (`getCanchasDia`, `getOverridesTorneo`) y mutadores (`applyCacheMutation`) lanzan un error explícito en lugar de generar estructuras vacías o silenciar fallos.
  4. **Regla de Oro de Consistencia: Mutación de Caché Estrictamente Post-Commit:**
     - Centralización absoluta de mutaciones en `applyCacheMutation('SET' | 'REMOVE' | 'CLEAR')`.
     - Dentro de `prisma.$transaction` (`reprogramarPorReduccionCanchas`), las operaciones de base de datos (`setOverrideDia`, `removeOverrideDia`, `clearOverridesTorneo`) no mutan la memoria; retornan descriptores de mutación que se aplican **estrictamente post-commit**. Si la transacción falla y hace rollback, la caché y la DB permanecen 100% inalteradas.
     - Fuera de transacciones, las operaciones en base de datos ejecutan el `await` a Prisma primero y aplican `applyCacheMutation` solo tras el éxito de la consulta.
  5. **Reinicio Seguro en `reiniciarTorneo` (`torneo.service.js`):**
     - Limpieza transaccional de `tx.overrideCanchasDia.deleteMany` y ejecución post-commit de `applyCacheMutation('CLEAR')`. Aislamiento del `require` en `try/catch` exclusivamente para tolerar ciclos de resolución en arranque temprano, sin enmascarar errores de caché no inicializada.
  6. **Script de Migración con Backup Automático (`migrate-canchas-overrides-json.js`):**
     - Script idempotente con copia de seguridad timestamped, soporte `--dry-run`, importación de torneos existentes y reporte dinámico de escalares sin diaKey unívoco.
  7. **Higiene de Repositorio (.gitignore y Git Index):**
     - `git rm --cached backend/src/data/canchasOverrides.json` preservando el archivo físico en disco.
     - Inclusión en `.gitignore` de `backend/src/data/canchasOverrides.json`, `canchasOverrides.backup.*.json` y `dev.backup.*.db`.
- **Validación y verificación:**
  - Suite dedicada `test-persistencia-overrides.js` aprobada al 100%: validación de error ante caché no hidratada, verificación de rollback en tx y fallos sin tx sin contaminación de memoria, persistencia y recuperación tras reinicio de proceso simulado (`clearMemoryCache()`), y reseteo en `reiniciarTorneo`.
  - Ejecución y aprobación de las 9 suites de pruebas del proyecto (`test-scheduling-domingo.js`, `test-mini-bracket-scheduling.js`, `test-eliminatoria-scheduler-completo.js`, `test-auto-asignar-eliminatoria.js`, `test-auditoria-fixes.js`, `test-persistencia-overrides.js`, `test-modo-dia-torneo.js`, `test-modo-lluvia-independiente.js`, `test-modo-lluvia-eliminatorias.js`).
  - Verificación de compilación de frontend (`npm run build`) exitosa en 719ms.
- **Resultado final:** Arquitectura de persistencia de Modo Lluvia resiliente, lista para entornos cloud efímeros (Railway/Render), con base de datos versionada bajo migraciones formales y consistencia atómica garantizada entre memoria y DB.

### 61. Aislamiento Total de Entorno de Tests (`test.db` / `test.template.db`), Guarda Fail-Safe, Blindaje de Herramientas de Desarrollo y Runner Secuencial Automatizado
- **Problema o necesidad que motivó el trabajo:** Históricamente, las suites de prueba ejecutaban directamente contra `prisma/dev.db`, generando proliferación de organizadores residuales (38 detectados) y torneos efímeros, con riesgo latente de sobreescritura accidental de datos reales del club piloto (`demo@padel.com` / "Impares Agosto"). Además, varios scripts de mantenimiento contaban con fallbacks ciegos y llamadas peligrosas (`deleteMany` sin filtro estricto).
- **Qué decidí y por qué:**
  1. **Aislamiento Total de Base de Datos de Prueba:** Creación de `prisma/test.db` como base descartable y `prisma/test.template.db` como plantilla pre-migrada. Creación de `reset-test-db.js` con regeneración automática mediante `prisma migrate deploy` sobre archivo temporal si la plantilla no existe o con `--rebuild-template`.
  2. **Guarda Fail-Safe de Dos Capas (`testEnvGuard.js`):** Inyección sincrónica de `.env.test` antes de requerir Prisma, y validación asincrónica obligatoria vía `PRAGMA database_list` comprobando que la base física conectada termine en `prisma/test.db`. Si no coincide, aborta inmediatamente.
  3. **Reorganización y Blindaje en `backend/scripts/dev-tools/`:** Reubicación de los 9 scripts de mantenimiento fuera de la raíz de scripts. Obligatoriedad de `--confirmar-dev`, backup automático fechado previo, argumentos explícitos (`--torneoId`, `--organizadorId`) erradicando fallbacks ciegos (`contains: 'Agosto'`), y deshabilitación permanente de `restaurar-torneo.js`.
  4. **Herramienta de Saneamiento (`limpiar-residuos-dev.js`):** Modo `--dry-run` por defecto, filtrado estricto en memoria en JavaScript para evitar comodines SQL, lista blanca con IDs y emails de los 3 organizadores legítimos y el torneo real "Impares Agosto", aserción de que tras la limpieza sobreviven exactamente 3 organizadores y 149 partidos, y borrado transaccional hijos-primero.
  5. **Runner Centralizado Secuencial (`run-all-tests.js`):** Lista explícita de las 19 suites oficiales `test-*.js`, validación estática previa de que cada suite importe la guarda en primer lugar, reseteo limpio de `test.db` antes de cada suite, y servidor Express efímero en puerto 0 (`testServer.js`) para suites HTTP.
  6. **Reescritura de `test-modo-lluvia-independiente.js` con Siembra Real:** Siembra de 24 parejas en 2 categorías sobre club de 6 canchas, generación de zonas y brackets, demostración de reducción de viernes con $N=16 > 0$ reprogramaciones y domingo con $N=14 > 0$, preservando días no afectados y verificando restauraciones.
- **Validación y verificación:**
  - Ejecución consecutiva dual de `npm test` (`run-all-tests.js`): 19/19 suites aprobadas en ambas corridas de forma idéntica (12.58s y 11.73s), certificando cero estado arrastrado.
  - Verificación de inmutabilidad de `dev.db` (SHA256 idéntico y 149 partidos preservados).
  - Verificación de arranque de `node src/index.js` y `npm run dev` con hidratación previa de caché.
  - Verificación de auto-regeneración de `test.template.db` mediante `reset-test-db.js --rebuild-template`.
- **Resultado final:** Infraestructura de testeo completamente profesional, desacoplada, reproducible y segura que protege al 100% la integridad de los datos de desarrollo y producción.

---

## ⏱️ Resumen de Tiempos y Esfuerzo Estimado

El desarrollo de la aplicación se gestionó mediante un ciclo iterativo de 61 sesiones de trabajo, sumando un aproximado total de entre 139 y 167 horas de programación, refactorización, depuración y testeo.

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
| **36** | ~2 a 2.5 horas | Rediseño UI/UX de `AsignarHorarioModal` (jerarquía visual, badge condicional `Sin coincidencia directa`, hero card simplificada, disclosure progresivo inline, terciles dynámicos para disponibilidad de canchas y separadores de bloque $> 90\text{m}$), filtrado contextual estricto por tipo de partido (zonas solo V/S vs eliminatorias D/S noche), orden cronológico continuo de trasnoche (`minutosCronologicosJornada`) y optimización responsive para celulares estrechos ($\le 373\text{px}$). |
| **37** | ~1.5 a 2 horas | Simplificación, jerarquía visual y optimización mobile en `PartidosPendientesSection`: eliminación de subtítulo del banner, erradicación de alertas pasivas de saturación y chip de viables, chip de zona alineado al margen sin sangría excesiva, botón primario verde deportivo (`btn-primary`), y layout responsive mobile para pantallas $\le 410\text{px}$ (grid a 1 columna y botón full-width táctil). |
| **38** | ~1 a 1.5 horas | Auditoría y normalización de modal "Editar Cruce" en cuadros eliminatorios (`EditBracketMatchModal.jsx` y `EliminatoriaView.jsx`): detección y corrección de bug de posicionamiento por residuo histórico de popover, migración a patrón estándar `.modal-overlay` + `.modal-content` (400px), soporte de prop `isOpen`, limpieza de estilos huérfanos de zIndex y armonización visual con tokens semánticos y `lucide-react`. |
| **39** | ~1 a 1.5 horas | Validación de unicidad de orígenes en eliminatorias (Frontend + Backend en `EditBracketMatchModal`, `EliminatoriaView` y `partido.service.js`): rechazo HTTP 400 con mensaje descriptivo de partido en uso, inyección de `partidosRonda`, opciones deshabilitadas con etiqueta `(en uso en Partido #X)`, preservación del propio partido (swap libre sin autobloqueo) y suite de regresión aprobada. |
| **40** | ~1 a 1.5 horas | Reasignación e intercambio atómico de orígenes (swap) en cuadros eliminatorios (Frontend + Backend): transacción atómica en Prisma (`liberarEnOtros: true`) con transferencia de pareja física clasificada, bloqueo en partidos finalizados, aviso reactivo consolidado de movimientos y confirmación en 1 clic. |
| **41** | ~2 a 2.5 horas | Reprogramación directa en tarjetas de cuadros eliminatorios (`EliminatoriaView.jsx`) con botón `Clock` unificado para todos los partidos no finalizados, adaptación contextual de `AsignarHorarioModal.jsx` para playoffs (grilla cronológica plana sin rankings artificiales ni estiramientos y fallbacks honestos de cruces), visualización destacada de horario y cancha actual (`Actualmente: Día HH:MM · Cancha X`), exclusión dinámica del turno idéntico actual para evitar sugerencias redundantes, remoción de jerarquía de terciles en chips de turno (`index.css`), y soporte LAN en Vite (`host: true`). |
| **42** | ~1.5 a 2 horas | Auditoría de integridad en asignación horaria (descarte de colisiones en dieciseisavos), layout dinámico en TorneoEnVivo (heading Partidos en Juego (0) colapsado y Próximos Partidos al 100%), labels visibles de acción (`En juego` / `Resultado`), estado de canchas condicional y tarjetas de partidos responsive en 2 filas sin truncamiento de nombres en celulares ($\le 390\text{px}$). |
| **43** | ~3 a 3.5 horas | Rediseño integral de la vista pública (`TorneoPublic.jsx` e `index.css`): remoción de número de cancha en tarjetas de partidos, navegación por pestañas de zona (unmount de zonas inactivas en DOM), stepper accesible de fases con `<button>`, atenuación progresiva de brackets con badge de definidos, buscador en tiempo real insensible a acentos/mayúsculas con deduplicación y navegación a zona, cuadro eliminatorio dual (tabs horizontales por ronda en mobile con stack vertical al 100% y bracket tradicional en desktop), sub-componente `PublicMatchCard`, remoción de footer redundante, y solución definitiva de tablas de posiciones en mobile (modo dual: tarjetas de posiciones estilo Flashscore/Sofascore en mobile al 100% de ancho sin scroll horizontal y tabla completa en desktop). |
| **44** | ~2 a 2.5 horas | Refinamiento de Nomenclatura y Layout en Vista Pública y Día de Torneo: unificación concisa "Fase de grupos" $\rightarrow$ "Zonas" y "Cuadro eliminatorio" $\rightarrow$ "Eliminatoria", eliminación de badges "0/4 definidos" en bracket desktop, reordenamiento de buscador debajo de las pestañas de zonas, visualización de ancho completo en monitores de escritorio (bracket responsive con columnas y gaps fluidos sin scroll forzado, preservando al 100% el modo mobile dual), simplificación del título "Día de Torneo" (sin emojis ni "— En Vivo"), supresión del aviso de polling a 30s, remoción de "(Playoffs)" en selector de domingo y limpieza total de badges y textos explicativos redundantes en eliminatorias dominicales. |
| **45** | ~2 a 2.5 horas | Header Compacto y Navegación Sticky en Vista Pública (`TorneoPublic.jsx` e `index.css`): visualización inmediata de posiciones o cruces en el primer pantallazo ($\le 96$px en 360px) sin scroll muerto previo, chips de categoría y zonas en una fila horizontal con scroll y degradé indicador, control segmentado de fases como tabs reales con unmount de la inactiva y selección ligada al estado de juego, filtro de zonas con "Todas" por defecto, y corrección de `overflow-x: clip` en `body` para habilitar `position: sticky` en el viewport móvil. |
| **46** | ~2.5 a 3 horas | Rediseño de Tarjeta de Partido Compacta (Estilo Marcador Deportivo) y Unificación Total (`TorneoPublic.jsx`, `public.controller.js`, `dateUtils.js` e `index.css`): componente unificado `PublicMatchCard` para Zonas y Eliminatoria, cabecera con horario en Córdoba (`hourCycle: 'h23'`) y chip de estado (`En juego` con punto pulsante accesible, `Pendiente`, `Esperando`, `Finalizado`), cuerpo en dos filas sin "vs", nombres con line-clamp de 2 líneas, sets alineados en columnas fijas `tabular-nums` con puntaje mayor resaltado, ganador destacado en verde bold y perdedor legible con `--color-text-secondary` sin opacidad, resolución por `ganadorId` con soporte de W.O./retiro sin ceros artificiales, y compatibilidad total con mini-brackets y conectores SVG de `BracketLines` en desktop. |
| **47** | ~2 a 2.5 horas | Vista Pública Mobile: mini tabla de posiciones semántica con encabezados alineados (`.public-tabla-mobile`), `tabular-nums`, diferenciales de sets/games con signo (`DS` y `DG`), estado "Sin jugar" atenuado sin ceros artificiales, eliminación de flechas ▲, leyenda inferior discreta "Clasifican N", y desanidado de tarjeta contenedora (`.public-zona-mobile`) con separador liviano en vista "Todas". |
| **48** | ~2.5 a 3 horas | Feature "Mi Pareja" en Vista Pública (`TorneoPublic.jsx`, `public.controller.js` e `index.css`): seguimiento personalizado de pareja favorita con persistencia en `localStorage`, bloque destacado "Tu próximo partido" persistente en Zonas y Eliminatoria sin número de cancha, estados En juego (`status-en-juego`), Pendiente en zonas y Clasificado a eliminatorias con badge dorado y trofeo (`status-clasificado` + `Trophy`), resolución de cruces por ID y proyección semántica por `origenPareja` (`${posicion}° ${zonaNombre}`), botón de estrella exclusivamente en el desplegable del buscador con chip activo de deselección, eliminación del indicador ▲ en tabla desktop y de la leyenda "Clasifican N" en mobile, inyección de `parejaId` en tabla de posiciones pública y script de prueba (`setup-test-mi-pareja.js`). |
| **49** | ~2.5 a 3 horas | Pestaña "Horarios" en Vista Pública y Búsqueda por Pareja (`TorneoPublic.jsx`, `dateUtils.js` e `index.css`): tercera pestaña en el control segmentado responsivo (subtextos ocultos $\le 520\text{px}$ para evitar desborde en 320px), cronograma agrupado por día en Córdoba (`America/Argentina/Cordoba`) sin bug UTC en 23:30, partidos `EN_CURSO` destacados exclusivamente en sección superior "En juego", toggle "Ver finalizados" persistente ante polling, sección "Horario por confirmar" al final, etiquetas cortas de origen en tarjetas, acento dorado de favorito, y filtro interactivo por pareja desde el buscador sin cambiar de vista con chip removible táctil ($\ge 40\text{px}$) y estado vacío contextual. |
| **50** | ~2 a 2.5 horas | Skeleton de Carga Inicial e Indicador de Última Actualización en Vista Pública (`TorneoPublic.jsx` e `index.css`): skeleton inicial que replica la estructura real (título, meta, categorías, control segmentado y 3 tarjetas) con shimmer CSS y respeto a `prefers-reduced-motion` para eliminar layout shifts (CLS), micro-componente aislado de contador (`UltimaActualizacion`) con formateo dinámico y estado warning a los 35s en punto estático y texto, pausa en segundo plano por `visibilitychange` con fetch inmediato sin re-crear polling y blindaje contra stale closures con `dataRef` para persistir datos ante caídas de red. |
| **51** | ~1 a 1.5 horas | Rebranding integral de la aplicación a "Fixi": módulo centralizado de constantes (`app.js` con `APP_NAME` y `APP_TAGLINE`), migración de marca en layouts (`AdminLayout`, `PublicLayout`), pantallas de autenticación (`Login`, `Register`), `document.title` dinámico en vista pública con cleanup al desmontar (`${APP_NAME} — ${APP_TAGLINE}`), metadatos HTML/Open Graph y documentación de arquitectura/schema, preservando intactos los identificadores internos, rutas de API y claves de `localStorage`. |
| **52** | ~3.5 a 4 horas | Auditoría Integral de Código, Blindaje de Autorización (IDOR) y Limpieza Sistemática de Código Muerto: auditoría exhaustiva en `AUDITORIA.md`, blindaje multitenant de pertenencia (`organizadorId`) en 4 endpoints de disponibilidad y en partidos por categoría, guardián de producción para `JWT_SECRET`, des-tracking seguro de `.env`, tag `pre-limpieza` y limpieza quirúrgica de confianza Alta (assets y componentes huérfanos, imports y variables sin uso, rutas y controladores backend obsoletos, script suelto y selectores CSS huérfanos en `index.css`) con verificación total `oxlint -D no-undef` (0 errores). |
| **53** | ~1 a 1.5 horas | Desacople de edición de torneo en `TorneoDetail.jsx`: remoción de botón redundante "Editar Torneo" en cabecera (preservación de CTA único y acciones secundarias), especialización del modal a "Editar Fecha del Torneo" con payload parcial `{ fecha }`, eliminación limpia de `editNombre` y validaciones muertas, prevención de auto-apertura de datepicker nativo en mobile (sin `autoFocus`) y responsive mobile verificado (≤ 480px y ≤ 376px). |
| **54** | ~1 a 1.5 horas | Blindaje y guard de fecha de torneo fuera de BORRADOR (`torneo.service.js` y `TorneoDetail.jsx`): validación estricta en backend (HTTP 400 si `estado !== 'BORRADOR'` y la fecha cambia o se vacía, permitiendo misma fecha o edición de solo nombre), chip de fecha de solo lectura en frontend en torneos iniciados sin lápiz ni modal y con tooltip descriptivo, defensa en profundidad con captura de errores, y suite de tests de regresión multitenant (`test-torneo-fecha-guard.js`). |
| **55** | ~1.5 a 2 horas | Bloqueo de Edición de Disponibilidad Horaria Post-Inicio y Vista de Solo Lectura: reversión de sesión 34 para congelar disponibilidad al iniciar torneo (`categoria.estado !== 'BORRADOR'`), guard HTTP 400 en `setDisponibilidad`, `setDisponibilidadDoble` y `removerDisponibilidadDoble`, preservación multitenant (403), vista de solo lectura unificada por día en frontend (`DisponibilidadEditor.jsx` y `ParejasManager.jsx`), suite de regresión (`test-disponibilidad-guard.js`) y verificación responsive por código (375px y 360px). |
| **56** | ~2 a 2.5 horas | Pulido de pantalla de Parejas por categoría (ParejasManager.jsx): reemplazo de panel lateral por banner fino informativo en categorías iniciadas (ancho completo para la lista), chip de disponibilidad en horas amigables (ej. "5 h", "1 h 15 min") con indicador crítico (< 75 min / < 5 slots), chip de zona ("Zona A") y progreso de partidos ("1/3 jugados") vía include mínimo en backend con multitenant, buscador instantáneo insensible a mayúsculas y acentos (NFD) con umbral > 8 parejas y contador contextual, subtítulo con nombre del torneo, limpieza de textos de desarrollo/enums crudos, y arquitectura mobile-first con chips en dos filas fijas (≤ 600px) verificada por código. |
| **57** | ~1 hora | Navbar de administración responsiva en una sola fila (AdminLayout.jsx): layout horizontal fijo sin wrap (≤ 440px), logout compacto en solo ícono con aria-label/title, reducción progresiva a logo-ícono y textos limpios sin íconos en ≤ 360px, y verificación por cálculo geométrico de código hasta 320px. |
| **58** | ~1 hora | Detalle de torneo responsivo en mobile (≤ 347px) y simplificación de título a "Categorías" (TorneoDetail.jsx e index.css): eliminación de corte horizontal y scroll lateral mediante padding adaptativo en tarjetas (16px en ≤480px, 12px en ≤360px), minmax(0, 1fr) en grilla, acciones de tarjeta en fila única con font/padding ajustado, encabezado responsivo .torneo-section-header con flex-wrap y verificación automatizada en Chrome headless hasta 320px. |
| **59** | ~2 a 2.5 horas | Refinamiento de Modo Lluvia en En Vivo (`TorneoEnVivo.jsx`, `zona.service.js`, `canchasOverrides.service.js`, `organizador.service.js` y `dateUtils.js`): reseteo explícito de stepper a total del club y refetch inmediato al restaurar canchas, chip de Modo Lluvia limpio por jornada sin horas confusas con `formatDiaNombre` (`Modo Lluvia (Sábado)`), admisión y reubicación de dieciseisavos sin parejas físicas en canchas inhabilitadas sin colisión de claves nulas, preservación en `dayLimitMs` con motivo "Sin cancha activa libre disponible en ese horario", ciclo de vida y eliminación de `partidosSinSlot` en `removeOverrideDia` y reemplazo total en `setOverrideDia` sin acumulación, condición restrictiva de motivo en `getEstadoEnVivo` (`PENDIENTE && canchaNumero > canchasMaxDia && esDelDiaLluvia`), suite automatizada y salida limpia con `process.exit(0)` en los 3 test suites aprobados al 100%. |
| **60** | ~3.5 a 4 horas | Persistencia de Overrides de Modo Lluvia en Base de Datos Relacional (`OverrideCanchasDia`), Consistencia de Caché Post-Commit y Baselining de Migraciones Prisma: baselining `0_init`, migración versionada `20261008023741_add_override_canchas_dia`, `canchasOverrides.service.js` con tabla como única fuente de verdad y desacople de JSON local, hidratación obligatoria en `index.js` antes de `app.listen()`, regla estricta de mutación de caché post-commit en transacciones atómicas (`prisma.$transaction`), blindaje de `reiniciarTorneo`, script de migración con backup y suite completa de tests de persistencia y concurrencia. |
| **61** | ~3 a 3.5 horas | Aislamiento Total de Base de Datos de Tests (`prisma/test.db` y `test.template.db`), Guarda Fail-Safe de Dos Capas (`testEnvGuard.js` con check estricto de ruta física vía `PRAGMA database_list`), Runner Secuencial Centralizado (`run-all-tests.js` con verificación estática de primer require y reset atómico por suite), Servidor HTTP Efímero en Puerto 0 (`testServer.js`), Reubicación y Blindaje de Scripts de Soporte en `dev-tools/` (flag obligatorio `--confirmar-dev`, backups automáticos fechados, remoción de fallbacks ciegos y deshabilitación segura de `restaurar-torneo.js`), Script de Saneamiento de Residuos (`limpiar-residuos-dev.js` con dry-run por defecto, whitelist exacta de 3 orgs y assert de 149 partidos de "Impares Agosto"), y Reescritura con Siembra Real y $N > 0$ en `test-modo-lluvia-independiente.js`. |
| **Total** | **~139 a 167 hrs** | Implementación Full-Stack integral con jerarquía de torneos y categorías, scheduling continuo en tres pasadas con prioridad manual y dependencias mini-bracket, pre-check transaccional con snapshot estable e incremental, asistente de resolución de cruces, modo día de torneo en vivo con reprogramación por lluvia aislada por día (Opción B) y protección causal de eliminatorias, brackets visualizables desde el minuto cero, scheduling completo de playoffs al inicio con descansos y sincronización universal de rondas dominicales, prioridad automática de playoffs por parejas clasificadas, backfill inteligente de eliminatorias con preservación de bloques sincronizados, modo lluvia independiente por día (V/S/D), refactor UI/UX deportivo de alta jerarquía en detalle de torneo y de categorías, tablas de posiciones responsivas sin scroll forzado, operaciones seguras post-inicio con modales ergonómicos, blindaje de ciclo de vida en parejas y disponibilidad, asignación directa de horarios en tarjetas de partidos con nivelación visual y optimización mobile-first sin desborde, rediseño de asignación/reprogramación con disclosure progresivo y consistencia de dominio, simplificación y elevación visual en partidos pendientes con diseño responsive adaptativo, normalización ergonómica de modales en cuadros eliminatorios con validación estricta de unicidad de cruces, intercambio atómico de orígenes (swap) con transferencia de parejas clasificadas, reprogramación directa y contextual de eliminatorias con exclusión de turnos redundantes, soporte LAN móvil, optimización ergonómica en vivo con tarjetas responsive sin truncamiento, rediseño completo mobile-first de la vista pública con bracket dual, buscador instantáneo, posiciones deportivas sin scroll horizontal, armonización visual integral en pantallas de escritorio con terminología minimalista, header compacto con barra sticky nav y control segmentado de fases, tarjetas de partido compactas estilo marcador deportivo unificadas al 100%, mini tabla de posiciones mobile semántica con encabezados alineados, feature "Mi Pareja" con bloque persistente de próximo partido y estados con trofeo, pestaña "Horarios" con cronograma cronológico por día, sección en juego, toggle de finalizados y filtro interactivo por pareja, skeleton de carga inicial con shimmer accesible e indicador discreto de última actualización con advertencia resiliente ante caídas de red, rebranding integral de la aplicación a "Fixi" con constantes centralizadas, metadatos Open Graph y título dinámico con cleanup al desmontar, auditoría integral con blindaje de autorización (IDOR) y limpieza quirúrgica de código muerto y deuda técnica, desacople ergonómico de edición en cabecera de torneo con modal exclusivo de fecha, blindaje de inmutabilidad de fecha de torneo fuera de borrador con chip de solo lectura y guard estricto en backend, bloqueo estricto de edición de disponibilidad horaria una vez iniciada la categoría con vista unificada de solo lectura, pulido de pantalla de parejas con banner superior fino, lista a ancho completo, chip de horas con indicador crítico, chip de zona/partidos, buscador instantáneo NFD y mobile-first con dos filas fijas de chips por código, navbar de administración responsiva en una sola fila fija hasta 320px con reducciones progresivas, detalle de torneo responsivo con blindaje contra cortes horizontales en ≤ 347px y simplificación de título a "Categorías", refinamiento integral de Modo Lluvia con sincronización reactiva de UI, chip limpio por jornada sin horas confusas, admisión de dieciseisavos sin parejas y gestión estricta de ciclo de vida para `partidosSinSlot`, persistencia relacional en `OverrideCanchasDia` con hidratación temprana y consistencia estricta de caché post-commit, e infraestructura aislada de pruebas con base de datos descartable `test.db`, guarda fail-safe física, runner estático, scripts de mantenimiento blindados con backup y saneamiento verificado. |

> **Nota:** esta tabla cubre únicamente las sesiones de codificación y depuración técnica. No incluye el tiempo dedicado a definición de producto, validación con usuarios, diseño UX/UI en wireframes, revisión de pantallas y planificación de alcance (secciones 6 a 8), que representan trabajo adicional real de la Práctica Profesional Supervisada.


