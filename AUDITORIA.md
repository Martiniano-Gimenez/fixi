# Auditoría de Código Muerto, Duplicado y Seguridad

**Fecha de ejecución:** Octubre 2026  
**Rama de trabajo:** `audit/codigo-muerto` (creada a partir de `main`)  
**Alcance:** Frontend (`/frontend`) y Backend (`/backend`), análisis estático exhaustivo y en profundidad con herramientas automatizadas (`oxlint`, `knip`, `depcheck`, scripts de AST/regex y `ripgrep`).  
**Regla de aplicación:** Documento de **SOLO LECTURA** sobre el código existente. No se han modificado, renombrado ni eliminado archivos del proyecto.

---

## 1. Frontend

### 1.1 Archivos huérfanos (componentes, estilos y assets sin importaciones)

| Archivo | Evidencia | Confianza | Recomendación |
| :--- | :--- | :--- | :--- |
| [App.css](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/App.css#L1-L3) | Se buscó `App.css` en todo el repo. Solo existe el archivo mismo con comentarios de placeholder de Vite. No es importado en `App.jsx` ni en ningún otro archivo. | **Alta** | **Borrar** |
| [DateTimeInput.jsx](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/DateTimeInput.jsx#L1-L122) | Se analizó con `knip` y búsqueda cruzada en todos los `.jsx`/`.js`. Componente de 122 líneas de edición inline de fecha/hora reemplazado por `AsignarHorarioModal`. Cero importaciones en el código activo. | **Alta** | **Borrar** |
| [InicioDisponibilidadModal.jsx](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/InicioDisponibilidadModal.jsx#L1-L190) | Confirmado por `knip` y búsqueda en todo el workspace. Modal de 190 líneas para sorteo por disponibilidad, reemplazado por los diálogos internos de `TorneoDetail.jsx`. Cero importaciones en el frontend. | **Alta** | **Borrar** |
| [react.svg](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/assets/react.svg) | Icono default generado por `create-vite`. No se importa ni referencia en ningún JSX, CSS ni HTML. | **Alta** | **Borrar** |
| [vite.svg](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/assets/vite.svg) | Icono default generado por `create-vite`. `index.html` referencia directamente `/favicon.svg`. No se usa en ningún lado. | **Alta** | **Borrar** |
| [hero.png](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/assets/hero.png) | Imagen de 396 KB en `src/assets/`. Se buscó `hero.png` en todo el repositorio (código y markdown). Cero referencias. | **Alta** | **Borrar** |
| [icons.svg](file:///c:/Users/marti/Desktop/padel-torneos/frontend/public/icons.svg#L1-L25) | Sprite SVG en `public/` con símbolos de redes sociales (Bluesky, Discord, GitHub, X). Se buscó `icons.svg` en todo el proyecto; cero usos. | **Media** | **Revisar** (determinar si se prevé integrar login social o links institucionales en el footer público). |

---

### 1.2 Exports sin uso en frontend

| Archivo y Línea | Export | Evidencia | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| [estadoLabels.js:1](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/utils/estadoLabels.js#L1) | `ESTADO_TORNEO_LABELS` | Confirmado por `knip` y AST. Export nombrado no importado externamente; solo se consume internamente dentro de `estadoLabel()`. | **Alta** | **Borrar** (remover `export`, mantener como constante privada del módulo). |
| [estadoLabels.js:7](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/utils/estadoLabels.js#L7) | `ESTADO_CATEGORIA_LABELS` | Confirmado por `knip`. Es un alias duplicado (`ESTADO_TORNEO_LABELS`) no importado en ningún archivo. | **Alta** | **Borrar** |
| [estadoLabels.js:9](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/utils/estadoLabels.js#L9) | `ESTADO_PARTIDO_LABELS` | Confirmado por `knip`. Export nombrado no importado externamente; solo se consume internamente dentro de `estadoLabel()`. | **Alta** | **Borrar** (remover `export`, mantener como constante privada del módulo). |
| [AuthContext.jsx:33](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/context/AuthContext.jsx#L33) | `useAuth` junto con `AuthProvider` | Advertencia `react/only-export-components` de oxlint. Fast Refresh de Vite recomienda que un archivo solo exporte componentes o solo funciones. | **Baja** | **Dejar** (patrón idiomático en React Context; no es código muerto, solo sugerencia de HMR de Vite). |

---

### 1.3 Variables, estados y funciones no utilizadas

| Archivo y Línea | Elemento | Evidencia | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| [TorneoDetail.jsx:359](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/TorneoDetail.jsx#L359) | `resultadoInicio` (state) | Detectado por `oxlint`. Se inicializa `const [resultadoInicio, setResultadoInicio] = useState(null)`, pero nunca se invoca `setResultadoInicio` ni se lee `resultadoInicio`. | **Alta** | **Borrar** |
| [TorneoDetail.jsx:599](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/TorneoDetail.jsx#L599) | `handleSlotSaved` (function) | Detectado por `oxlint`. Función declarada para actualizar conflictos en memoria que nunca se pasa como prop a ningún componente hijo ni se invoca en el archivo. | **Alta** | **Borrar** |
| [CategoriaDetail.jsx:27](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/CategoriaDetail.jsx#L27) | `navigate` | Detectado por `oxlint`. `const navigate = useNavigate();` asignado pero nunca invocado en el componente. | **Alta** | **Borrar** |
| [EliminatoriaView.jsx:15](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/EliminatoriaView.jsx#L15) | `navigate` | Detectado por `oxlint`. `const navigate = useNavigate();` asignado pero nunca invocado en el componente. | **Alta** | **Borrar** |
| [TorneoDetail.jsx:313](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/TorneoDetail.jsx#L313) | `navigate` | Detectado por `oxlint`. `const navigate = useNavigate();` asignado pero nunca invocado en el componente. | **Alta** | **Borrar** |
| [TorneoEnVivo.jsx:439](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/TorneoEnVivo.jsx#L439) | `partidosEnCurso`, `proximosPartidos`, `resumenEstado` | Detectado por `oxlint`. En la destructuración `const { partidosEnCurso, ..., proximosPartidos, ..., resumenEstado } = data;` estas 3 variables no se leen (se usan las versiones filtradas con useMemo: `partidosEnCursoFiltrados`, `proximosFiltrados`, etc.). | **Alta** | **Borrar** (eliminar las 3 variables de la destructuración de línea 439). |
| [InlineDisponibilidadEditor.jsx:97, 135](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/InlineDisponibilidadEditor.jsx#L97) | `err` (catch parameter) | Detectado por `oxlint`. Los bloques `catch (err)` muestran un aviso fijo sin inspeccionar `err`. | **Alta** | **Borrar** (usar `catch` sin parámetro o `_err`). |
| [TorneoDetail.jsx:351](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/TorneoDetail.jsx#L351) | `permiteInicioEmergencia` (state) | Detectado por `oxlint`. Se actualiza con `setPermiteInicioEmergencia(...)` en la línea 558, pero la variable `permiteInicioEmergencia` nunca se lee en el renderizado ni en condicionales. | **Media** | **Revisar** (verificar si el botón de inicio de emergencia en modal debía condicionarse por este flag). |
| [CategoriaDetail.jsx:32](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/CategoriaDetail.jsx#L32) | `fasesEliminatorias` (state) | Detectado por `oxlint`. Estado inicializado y actualizado en líneas 76 y 120 (`setFasesEliminatorias(...)`), pero `fasesEliminatorias` nunca se renderiza en `CategoriaDetail.jsx`. | **Media** | **Revisar** (el cuadro de eliminatorias se visualiza en la página dedicada `EliminatoriaView.jsx`, por lo que este estado en `CategoriaDetail` es redundante). |
| [EliminatoriaView.jsx:54](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/EliminatoriaView.jsx#L54) | `handleBorrarEliminatoria` | Detectado por `oxlint`. Función que abre el modal de confirmación para eliminar la fase eliminatoria (`DELETE /fases-eliminatorias`). No está vinculada a ningún botón del JSX. | **Media** | **Revisar** (determinar si se debe agregar el botón "Eliminar Cuadro" en el header de `EliminatoriaView.jsx` o retirar la función). |
| [EliminatoriaView.jsx:77](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/EliminatoriaView.jsx#L77) | `handleUpdateFechaHora` | Detectado por `oxlint`. Función local para `PUT /partidos/:id/fecha-hora`. No se utiliza porque la edición de horarios se delega a `AsignarHorarioModal` / `EditBracketMatchModal`. | **Media** | **Revisar** |
| [PartidosPendientesSection.jsx:6](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/PartidosPendientesSection.jsx#L6) | Prop `torneoEstado` | Detectado por `oxlint`. Los padres (`TorneoDetail` y `TorneoEnVivo`) pasan `torneoEstado={torneo.estado}`, pero el componente hijo no lo consume. | **Media** | **Revisar** (si no se requiere para deshabilitar asignaciones en torneos finalizados, retirar la prop). |
| [PartidoCard.jsx:4](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/PartidoCard.jsx#L4) | Prop `onUpdateFechaHora` | Detectado por `oxlint`. Declarada en los argumentos del componente pero nunca ejecutada internamente. | **Media** | **Revisar** |

---

### 1.4 Imports sin uso (clasificación completa oxlint)

| Archivo y Línea | Identificador | Módulo origen | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| [CategoriaDetail.jsx:1](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/CategoriaDetail.jsx#L1) | `useRef` | `react` | **Alta** | **Borrar** |
| [EliminatoriaView.jsx:9](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/EliminatoriaView.jsx#L9) | `Trophy` | `lucide-react` | **Alta** | **Borrar** |
| [EliminatoriaView.jsx:9](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/EliminatoriaView.jsx#L9) | `Edit2` | `lucide-react` | **Alta** | **Borrar** |
| [EliminatoriaView.jsx:9](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/EliminatoriaView.jsx#L9) | `Plus` | `lucide-react` | **Alta** | **Borrar** |
| [RangeSliderGroup.jsx:1](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/RangeSliderGroup.jsx#L1) | `Check` | `lucide-react` | **Alta** | **Borrar** |
| [RangeSliderGroup.jsx:1](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/RangeSliderGroup.jsx#L1) | `X` | `lucide-react` | **Alta** | **Borrar** |
| [RangeSliderGroup.jsx:1](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/RangeSliderGroup.jsx#L1) | `RotateCcw` | `lucide-react` | **Alta** | **Borrar** |
| [TorneoDetail.jsx:30](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/TorneoDetail.jsx#L30) | `MoreVertical` | `lucide-react` | **Alta** | **Borrar** |
| [TorneoEnVivo.jsx:21](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/TorneoEnVivo.jsx#L21) | `Loader2` | `lucide-react` | **Alta** | **Borrar** |
| [InicioDisponibilidadModal.jsx:3](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/InicioDisponibilidadModal.jsx#L3) | `Clock` | `lucide-react` | **Alta** | **Borrar** (el archivo entero es código muerto). |

---

### 1.5 Advertencias de dependencias en Hooks (`react-hooks/exhaustive-deps`)

*Nota de auditoría: No son código muerto, sino advertencias de React sobre dependencias omitidas o recreadas en renders.*

| Archivo y Línea | Hook | Detalle | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| [BracketLines.jsx:72](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/BracketLines.jsx#L72) | `useCallback` | Dependencia innecesaria: `fases`. | **Media** | **Revisar** (remover `fases` del array de dependencias para evitar recálculos superfluos de líneas SVG). |
| [DisponibilidadEditor.jsx:86](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/DisponibilidadEditor.jsx#L86) | `useEffect` | Falta `cargarDatos` en array de dependencias. | **Baja** | **Dejar** (estabilizar con `useCallback` si se agrega). |
| [AsignarHorarioModal.jsx:22](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/AsignarHorarioModal.jsx#L22) | `useEffect` | Falta `cargarCanchasDisponibles`. | **Baja** | **Dejar** |
| [EliminatoriaView.jsx:29](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/admin/EliminatoriaView.jsx#L29) | `useEffect` | Falta `cargarDatos`. | **Baja** | **Dejar** |
| [TorneoPublic.jsx:440](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/public/TorneoPublic.jsx#L440) | `useEffect` | Falta `fetchData`. | **Baja** | **Dejar** |
| [TorneoPublic.jsx:489](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/pages/public/TorneoPublic.jsx#L489) | `useEffect` | Faltan `activePhase`, `activeCategoria.*`. | **Baja** | **Dejar** (evitar loops infinitos de actualización de tab activa). |

---

## 2. CSS (`index.css` y `EliminatoriaView.css`)

Se extrajeron las 280 clases únicas declaradas en `src/index.css` y las 30 clases de `src/pages/admin/EliminatoriaView.css` y se cruzaron contra todos los templates JSX.

### 2.1 Clases muertas confirmadas en `index.css` (Sin uso en JSX)

| Clase CSS | Líneas en `index.css` | Evidencia | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| `.stub-message` | [207](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L207) | Clase de mensaje temporal de prototipo. Cero menciones en JSX. | **Alta** | **Borrar** |
| `.btn-small` | [310, 320](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L310) | Estilo residual en la sección de login. El proyecto estandarizó `.btn-sm` (línea 546). | **Alta** | **Borrar** |
| `.sidebar-nav`, `.sidebar-nav-item`, `.sidebar-nav-divider` | [443, 450, 470, 476, 483, 488, 494, 498](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L443) | Restos de un diseño anterior con sidebar lateral. `AdminLayout.jsx` utiliza un header superior (`.admin-header`, `.admin-nav`, `.admin-nav-link`). | **Alta** | **Borrar** |
| `.info-row` | [717](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L717) y [1681](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L1681) | Regla duplicada dos veces en el mismo archivo. No es utilizada por ningún componente JSX activo. | **Alta** | **Borrar** |
| `.dashboard-grid` | [812, 818](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L812) | Grid declarado junto a `.manager-grid`; no se utiliza en ninguna vista. | **Alta** | **Borrar** |
| `.partidos-grid` | [836, 842](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L836) | Layout de grilla superseded por `.partidos-public-grid`. | **Alta** | **Borrar** |
| `.resultado-modal-grid` | [870, 882](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L870) | Resto de diseño de `ResultadoModal` en 4 columnas; el modal actual utiliza flexbox por Set. | **Alta** | **Borrar** |
| `.btn-chip` | [1231, 1242](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L1231) | Variante de botón de filtro no utilizada. | **Alta** | **Borrar** |
| `.disponibilidad-badge` | [1444](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L1444) | Estilo residual del selector discreto anterior de slots. | **Alta** | **Borrar** |
| `.slots-grid` | [1481](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L1481) | Reemplazado por los nuevos sliders de rango (`RangeSliderGroup`). | **Alta** | **Borrar** |
| `.alert-success` | [1701](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L1701) | Estilo residual definido junto a `.alert-warning`; ningún modal o vista lo referencia. | **Alta** | **Borrar** |
| `.zona-resumen-item`, `.zona-auto`, `.zona-manual`, `.zona-nombre`, `.zona-parejas` | [1710, 1718, 1722, 1727, 1731](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L1710) | Bloque completo de estilos para resumen de zonas automáticas/manuales que no está presente en ningún JSX. | **Alta** | **Borrar** |
| `.ronda-progress-badge` | [2390](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L2390) | Badge de progreso en rondas públicas; no se renderiza en `TorneoPublic.jsx`. | **Alta** | **Borrar** |
| `.match-card-empty` | [2420](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L2420) | Selector `.public-page .match-card.match-card-empty`. `TorneoPublic.jsx` utiliza la clase `.vacio` en su lugar (línea 3274). | **Alta** | **Borrar** |
| `.public-bracket-tab-badge` | [2761, 2767](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L2761) | Badge para solapas de cuadro; no utilizado en `TorneoPublic.jsx`. | **Alta** | **Borrar** |
| `.public-posiciones-list`, `.public-pos-card`, `.public-pos-rank`, `.public-pos-num`, `.public-pos-arrow`, `.public-pos-info`, `.public-pos-name`, `.public-pos-stats`, `.public-pos-dot`, `.public-pos-pts`, `.public-pos-pts-val`, `.public-pos-pts-lbl` | [2794-2898](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L2794-L2898) | Bloque completo de 105 líneas para tarjetas individuales de posiciones en mobile. Fue reemplazado por la tabla unificada `.public-tabla-mobile` (línea 1298 de `TorneoPublic.jsx`). | **Alta** | **Borrar** |
| `.public-tabla-pareja-wrap` | [2984](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L2984) | Contenedor no referenciado en la tabla pública actual. | **Alta** | **Borrar** |
| `.public-fav-btn` | [2991, 3007, 3024, 3028, 3033](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L2991) | Versión anterior del botón de favorito en tablas. La búsqueda pública utiliza `.public-search-fav-btn` (línea 1215 de `TorneoPublic.jsx`). | **Alta** | **Borrar** |
| `.public-search-fav-icon` | [3037](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L3037) | Clase redundante; el icono SVG usa `.public-fav-icon` directamente. | **Alta** | **Borrar** |
| `.public-clasifican-legend` | [3203](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L3203) | Leyenda de clasificación de grupos. El componente renderiza `<span className="badge badge-en_curso">Clasifican {zona.clasifican}</span>`. | **Alta** | **Borrar** |

---

### 2.2 Clases dinámicas en `index.css` (Falsos positivos de código muerto - ¡NO BORRAR!)

*Nota crítica: Estas clases no aparecen como literales estáticos en el JSX, pero se generan en tiempo de ejecución mediante template literals de estado.*

| Clase CSS | Líneas en `index.css` | Generación dinámica en JSX | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| `.badge-borrador` | [642](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L642) | Generada vía ``badge badge-${torneo.estado.toLowerCase()}`` en `CategoriaDetail.jsx:175`, `TorneoDetail.jsx:796, 1096`, `TorneosList.jsx:113`, `TorneoPublic.jsx:976`. | **Baja** (Riesgo alto de rotura visual) | **Dejar** |
| `.badge-finalizado` | [654](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L654) | Generada vía ``badge badge-${torneo.estado.toLowerCase()}`` cuando el estado es `FINALIZADO`. | **Baja** (Riesgo alto de rotura visual) | **Dejar** |
| `.status-en-curso` | [3062, 3141](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L3062) | Generada dinámicamente vía ``public-next-match-card status-${proximoPartidoInfo.tipo}`` en `TorneoPublic.jsx:1078` cuando `tipo === 'en-curso'`. Aplica el gradiente verde y el efecto de pulso del partido activo. | **Baja** (Riesgo alto de rotura visual) | **Dejar** |
| `.status-clasificado` | [3068, 3146](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L3068) | Generada dinámicamente vía ``status-${proximoPartidoInfo.tipo}`` en `TorneoPublic.jsx:1078` cuando `tipo === 'clasificado'`. Aplica el borde ambarino y el estilo del badge. | **Baja** (Riesgo alto de rotura visual) | **Dejar** |
| `.status-sin-horario` | [3150](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L3150) | Generada vía ``status-${proximoPartidoInfo.tipo}`` en `TorneoPublic.jsx:1078` cuando `tipo === 'sin-horario'`. Modifica el color del texto secundario del card. | **Baja** (Riesgo alto de rotura visual) | **Dejar** |
| `.status-esperando-rival` | [3151](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L3151) | Generada vía ``status-${proximoPartidoInfo.tipo}`` en `TorneoPublic.jsx:1078` cuando `tipo === 'esperando-rival'`. | **Baja** (Riesgo alto de rotura visual) | **Dejar** |
| `.admin-nav-link` | [417](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/index.css#L417) | Utilizada mediante concatenación dinámica ``admin-nav-link${isTorneos ? ' active' : ''}`` en `AdminLayout.jsx:34, 41`. | **Baja** (Riesgo alto de rotura visual) | **Dejar** |

---

### 2.3 Clases compartidas entre `EliminatoriaView.css` e `index.css`

Existe un conjunto de 10 clases de layout y estado de brackets compartidas entre el módulo de administración (`EliminatoriaView.css`) y los estilos globales (`index.css`):

1. `.bracket-scroll`
2. `.bracket-section`
3. `.ronda-title`
4. `.bracket-matches-column`
5. `.bracket-match-wrapper`
6. `.match-card-wrapper`
7. `.match-card`
8. `.finalizado`
9. `.pendiente`
10. `.esperando`

**Evidencia de coexistencia:**
- En `index.css` (líneas 754-775 y 2430-2470), estas clases estructuran las ramas del árbol SVG dibujadas por `BracketLines.jsx` tanto para la vista pública (`TorneoPublic.jsx`) como para el admin.
- En `EliminatoriaView.css` (líneas 72-198), se declaran las reglas específicas de la vista de gestión privada de eliminatorias (`EliminatoriaView.jsx`).
- **Confianza:** **Baja** para borrado (Riesgo muy alto de rotura de layout de cuadros).
- **Recomendación:** **Dejar**. No unificar ni eliminar de forma aislada; si en el futuro se desea refactorizar, debe consolidarse un componente de Bracket reutilizable.

---

## 3. Dependencias de `package.json`

### 3.1 Frontend (`frontend/package.json`)

| Dependencia | Tipo | Evidencia | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| `@types/react` | `devDependencies` | `depcheck` reporta sin uso. El proyecto es JavaScript estándar (`.jsx`/`.js`), no TypeScript. Solo provee intellisense en IDE. | **Media** | **Revisar** (se puede dejar como soporte de autocompletado en VS Code o retirar si se busca un `package.json` mínimo). |
| `@types/react-dom` | `devDependencies` | `depcheck` reporta sin uso. Mismo motivo que `@types/react`. | **Media** | **Revisar** |
| `lucide-react`, `react`, `react-dom`, `react-router-dom` | `dependencies` | Importadas y utilizadas en todas las páginas y componentes principales. | **Alta** | **Dejar** (Críticas). |
| `@vitejs/plugin-react`, `oxlint`, `vite` | `devDependencies` | Utilizadas en build, dev server y scripts de npm (`npm run lint`). | **Alta** | **Dejar** (Críticas). |

---

### 3.2 Backend (`backend/package.json`)

| Dependencia | Tipo | Evidencia | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| `xlsx` | `dependencies` | `depcheck` la detecta como usada, pero la búsqueda en el código reveló que **`xlsx` solo se importa en scripts de desarrollo y migración** (`scripts/actualizar-horarios-parejas.js`, `scripts/importar-parejas-test.js`, `scripts/restaurar-torneo.js`). Ningún controlador, servicio ni ruta de producción en `src/` la utiliza. | **Media** | **Revisar** (mover a `devDependencies` o mantener si se ejecutan scripts de carga masiva en producción). |
| `nodemon` | `devDependencies` | Usada en el script `npm run dev`. | **Alta** | **Dejar** |
| `@prisma/client`, `prisma`, `bcryptjs`, `cors`, `dotenv`, `express`, `jsonwebtoken` | `dependencies` / `devDependencies` | Todas en uso activo en la API y base de datos. | **Alta** | **Dejar** |

---

## 4. Backend

### 4.1 Rutas y controladores huérfanos o sin llamadas desde frontend

| Ruta y Método | Controlador / Servicio | Evidencia | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| `POST /api/organizador/iniciar-todos` | `organizadorController.iniciarTodos` / `organizadorService.iniciarTodosLosTorneos` | Se auditó todo el frontend (`/frontend/src`) y scripts de test. Ningún componente o vista invoca `/iniciar-todos`. Además, el controller pasa `req.organizadorId` a una función que internamente espera `torneoId` (falla con 404 si se invoca). Resto de feature descartado. | **Alta** | **Borrar** (eliminar la ruta en `organizador.routes.js:22` y su handler en `organizador.controller.js:48-55`). |
| `POST /api/organizador/pre-check-inicio` | `organizadorController.preCheckInicio` / `organizadorService.preCheckInicioTodos` | El frontend solo utiliza el pre-check por torneo individual: `POST /api/torneos/:id/pre-check-inicio` (`TorneoDetail.jsx:545`). La ruta global en `organizador.routes.js:19` no es llamada por ningún cliente. | **Alta** | **Borrar** (eliminar la ruta en `organizador.routes.js:19` y su handler en `organizador.controller.js:39-46`). |
| Alias `preCheckInicioTodos` e `iniciarTodosLosTorneos` | [organizador.service.js:2305-2306](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/organizador.service.js#L2305-L2306) | Alias exportados en `module.exports` que solo servían a las dos rutas huérfanas anteriores. | **Alta** | **Borrar** (remover del export). |

---

### 4.2 Funciones y exports de servicios sin invocaciones externas

| Archivo y Línea | Función / Export | Evidencia | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| [organizador.service.js:3](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/organizador.service.js#L3) | `calcularCasiEstrellas` | Detectado por `oxlint`. Importado desde `./slots.service` pero nunca utilizado en el archivo. | **Alta** | **Borrar** |
| [organizador.service.js:21](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/organizador.service.js#L21) | `const PLAN_TTL_MS` | Detectado por `oxlint`. Constante numérica de tiempo de vida declarada pero no leída en el archivo. | **Alta** | **Borrar** |
| [eliminatoriaScheduler.service.js:465](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/eliminatoriaScheduler.service.js#L465) | `const c = freeCourts[i];` | Detectado por `oxlint`. Variable local asignada en un bucle que no se utiliza en las comprobaciones subsecuentes. | **Alta** | **Borrar** |
| [zona.service.js:1855](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/zona.service.js#L1855) | `iniciarTorneoConDisponibilidad` | Alias en `module.exports` (`iniciarTorneoConDisponibilidad: iniciarCategoriaConDisponibilidad`). Ningún archivo del backend o frontend llama a este alias; los controladores llaman a `iniciarCategoriaConDisponibilidad` o a `organizadorService`. | **Alta** | **Borrar** (eliminar el alias del `module.exports`). |
| [slots.service.js:8](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/slots.service.js#L8) | `SLOT_GRANULARIDAD_MIN` | Constante exportada en `slots.service.js` pero no importada en ningún otro archivo de `src/`. | **Alta** | **Borrar** (mantener privada sin exportar). |
| [slots.service.js:264, 281](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/slots.service.js#L264) | `minutosAHora`, `generarSlotsDia` | Exportadas en `slots.service.js`. En `src/` no se usan; solo son importadas por dos scripts de desarrollo (`actualizar-horarios-parejas.js` e `importar-parejas-test.js`). | **Media** | **Revisar** (mantener exports si los scripts de migración siguen activos). |
| [zona.service.js:1865-1866](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/zona.service.js#L1865-L1866) | `evaluarCompatibilidadZona`, `regenerarPartidosZona` | Se usan internamente en `zona.service.js`, pero se exportan innecesariamente hacia afuera (nadie las importa externamente). | **Media** | **Revisar** (retirar de `module.exports` para encapsulamiento). |
| [partido.service.js:871, 875](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/partido.service.js#L871) | `propagarMiniBracket`, `verificarYAutoAsignarEliminatoria` | Se usan internamente en `partido.service.js`. `propagarMiniBracket` además es invocada por `test-auditoria-fixes.js`. | **Baja** | **Dejar** (código activo interno). |

---

### 4.3 Campos del Schema de Prisma sin lectura en código de aplicación

*Regla: Solo informativo. NO se proponen migraciones ni cambios de schema en esta etapa.*

| Modelo | Campo | Evidencia | Estado |
| :--- | :--- | :--- | :--- |
| `Torneo` | `updatedAt` (`DateTime @updatedAt`) | Se buscaron referencias en todo el código backend y frontend. Cero lecturas, filtros u `orderBy`. Prisma lo actualiza automáticamente en cada mutación de torneo. | **Informativo**: Campo estándar de auditoría de BD. Mantener. |
| `Categoria` | `updatedAt` (`DateTime @updatedAt`) | Mismo caso. Actualizado por Prisma en cada mutación; nunca leído por controladores ni frontend. | **Informativo**: Campo estándar de auditoría de BD. Mantener. |
| `Organizador` | `createdAt` (`DateTime @default(now())`) | Leído en `organizador.service.js:94` como proyección, pero no se muestra en la UI. | **Informativo**: Mantener. |
| `Zona` | `requiereArmadoManual` (`Boolean`) | Leído y escrito en `zona.service.js` y `organizador.service.js`. | **Informativo**: En uso. |
| `Pareja` | `resolucionManual` (`Boolean`) | Leído y escrito en `disponibilidad.service.js` y `categoria.service.js`. | **Informativo**: En uso. |
| `Partido` | `sinHorarioAsignado` (`Boolean`) | Leído en 16 archivos (filtros de turnos pendientes y badges). | **Informativo**: En uso crítico. |

---

## 5. Restos y Archivos Temporales

### 5.1 `console.log` en código fuente

| Archivo y Línea | Llamada | Contexto | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| [Frontend src/](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src) | Ninguna | **0 llamadas a `console.log` en todo el frontend.** | - | - |
| [index.js:27](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/index.js#L27) | `console.log(`[${new Date().toISOString()}] ...`)` | Logger HTTP de Express para registrar requests en desarrollo. | **Baja** | **Dejar** (reemplazar por logger estructurado si se pasa a prod). |
| [index.js:61](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/index.js#L61) | `console.log(`🏸 Backend corriendo en...`)` | Mensaje de arranque del servidor. | **Baja** | **Dejar** |

---

### 5.2 Comentarios `TODO` / `FIXME` y código comentado

- **TODO / FIXME:** Se auditó todo el árbol de código fuente (`frontend/src` y `backend/src`). **No existen comentarios `TODO`, `FIXME`, `HACK` ni `XXX` en el código fuente de aplicación.** Las únicas ocurrencias de "todo" correspondían a comentarios funcionales en español ("todo el torneo", "todos los partidos").
- **Código comentado:** No se encontraron bloques de código muertos o comentados con palabras clave (`const`, `let`, `import`, `function`, etc.).

---

### 5.3 Archivos temporales, de prueba o fuera de lugar

| Archivo | Ubicación | Descripción | Confianza | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| [test-bracket.js](file:///c:/Users/marti/Desktop/padel-torneos/backend/test-bracket.js#L1-L110) | `backend/test-bracket.js` | Script de prueba suelto en la raíz de `backend/` de 110 líneas. Es una copia aislada del algoritmo `getMatchSequence` de `faseEliminatoria.service.js`. No está registrado en `package.json`. | **Alta** | **Borrar** (o mover a `backend/scripts/` si se desea conservar como referencia). |
| [Inscripciones_Padel_Ordenado.xlsx](file:///c:/Users/marti/Desktop/padel-torneos/Inscripciones_Padel_Ordenado.xlsx) | Raíz del proyecto | Archivo Excel de 12 KB con datos de prueba de parejas. No pertenece al código fuente versionado. | **Media** | **Revisar** (mover a una carpeta `docs/` o excluir mediante `.gitignore`). |
| [chats.md](file:///c:/Users/marti/Desktop/padel-torneos/chats.md) | Raíz del proyecto | Bitácora de conversaciones y prompts (24 KB). | **Media** | **Revisar** (conservar si es documentación personal de trabajo). |
| [terminarChat.md](file:///c:/Users/marti/Desktop/padel-torneos/terminarChat.md) | Raíz del proyecto | Instrucción de cierre de sesión (691 bytes). | **Media** | **Revisar** |
| `backend/scripts/*.js` (21 scripts) | `backend/scripts/` | 21 scripts individuales de pruebas de stress, tests de algoritmos y migraciones ad-hoc (`test-modo-lluvia-*`, `test-mini-bracket-*`, `benchmark-*`). | **Media** | **Revisar** (organizar en una suite de testing con Jest/Vitest o mantener como scripts de utilería interna). |

---

## 6. Duplicación Notable

1. **Función `horaAMinutos` duplicada en 4 ubicaciones:**
   - [RangeSliderDia.jsx:4](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/RangeSliderDia.jsx#L4)
   - [RangeSliderGroup.jsx:4](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/components/RangeSliderGroup.jsx#L4)
   - [rankingSlots.js:10](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/utils/rankingSlots.js#L10)
   - [slots.service.js:4](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/slots.service.js#L4)
   *Recomendación:* En frontend, centralizar en `src/utils/dateUtils.js` donde ya residen las utilidades horarias.
2. **Algoritmo de seeding de brackets (`getMatchSequence`):**
   - [faseEliminatoria.service.js:235](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/faseEliminatoria.service.js#L235)
   - [test-bracket.js:15](file:///c:/Users/marti/Desktop/padel-torneos/backend/test-bracket.js#L15)
   *Recomendación:* `test-bracket.js` es un clon idéntico del servicio; eliminar `test-bracket.js`.
3. **Mapeo de etiquetas de estado (`estadoLabel`):**
   - En frontend existe [estadoLabels.js](file:///c:/Users/marti/Desktop/padel-torneos/frontend/src/utils/estadoLabels.js), pero varios componentes vuelven a definir mapeos manuales para badges o textos (`TorneoEnVivo.jsx`, `TorneoPublic.jsx`).
4. **Duplicación de pantallas masivas (`TorneoDetail.jsx` y `TorneoEnVivo.jsx`):**
   - Ambos componentes superan las 2.000 líneas de código y contienen lógica duplicada para el cálculo de partidos por día, modales de reprogramación de lluvia y llamadas al endpoint `en-vivo`.
   *Recomendación de arquitectura:* Extraer custom hooks para la gestión de jornada activa y reprogramación.

---

## 7. Revisión Rápida de Seguridad

### 7.1 Exposición en endpoint público `GET /api/public/:slug`

Se analizó la consulta y el serializador en [public.controller.js](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/controllers/public.controller.js#L8-L163):
- **Datos correctamente protegidos:**
  - El organizador se consulta exclusivamente con `select: { nombre: true }`. No se expone `email`, `passwordHash` ni tokens.
  - Las parejas devuelven `{ id, jugador1, jugador2, orden }`. **No se exponen** las disponibilidades horarias declaradas (`slotPareja`), resguardando la privacidad de horarios de los jugadores.
  - No se exponen los overrides internos de configuración de canchas.
- **Observación para revisión:**
  - Se devuelven los UUIDs internos de la base de datos (`torneo.id`, `categoria.id`, `pareja.id`, `partido.id`, `zona.id`). Esto no representa una vulnerabilidad crítica por sí mismo, siempre que los endpoints administrativos validen rigurosamente la autorización por organizador (ver sección 7.3).

---

### 7.2 Secretos y credenciales en el repositorio

1. **Vulnerabilidad: Archivo `.env` commiteado y trackeado en Git:**
   - **Evidencia:** `git ls-files backend/.env` retorna `backend/.env`.
   - El archivo contiene:
     ```env
     DATABASE_URL="file:./dev.db"
     JWT_SECRET="dev-secret-cambiar-en-produccion"
     PORT=3001
     ```
   - Aunque `.gitignore` incluye `.env`, Git continúa haciendo seguimiento de archivos que fueron comiteados antes de añadir la regla.
   - **Riesgo:** Alto si el repositorio se publica o comparte.
   - **Acción sugerida:** Ejecutar `git rm --cached backend/.env` y asegurar que `backend/.env.example` permanezca como única plantilla versionada.
2. **Contraseñas por defecto en Seeds:**
   - [seed.js:25](file:///c:/Users/marti/Desktop/padel-torneos/backend/prisma/seed.js#L25) crea el usuario `demo@padel.com` con contraseña `123456`. Aceptable para desarrollo local, pero debe evitarse ejecutar en entornos productivos.

---

### 7.3 Autenticación y Autorización en rutas administrativas (BOLA / IDOR)

1. **Autenticación general:**
   - Todas las rutas administrativas en `categoria.routes.js`, `organizador.routes.js`, `pareja.routes.js`, `partido.routes.js` y `torneo.routes.js` tienen aplicado `authMiddleware` a nivel de router (`router.use(authMiddleware)`).
2. **Vulnerabilidad de Autorización (IDOR) en `disponibilidad.controller.js`:**
   - En [disponibilidad.controller.js:3-50](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/controllers/disponibilidad.controller.js#L3-L50), los endpoints de disponibilidad horaria:
     - `GET /api/parejas/:id/disponibilidad`
     - `PUT /api/parejas/:id/disponibilidad`
     - `PUT /api/parejas/disponibilidad-doble`
     - `POST /api/parejas/disponibilidad-doble/remover`
   - **Falla detectada:** El controlador no pasa `req.organizadorId` al servicio, y [disponibilidad.service.js:13-30](file:///c:/Users/marti/Desktop/padel-torneos/backend/src/services/disponibilidad.service.js#L13-L30) busca la pareja por `parejaId` **sin validar que pertenezca al organizador autenticado**:
     ```js
     // disponibilidad.service.js
     const pareja = await prisma.pareja.findUnique({
       where: { id: parejaId },
       include: { categoria: { include: { torneo: { include: { organizador: true } } } } }
     });
     // FALTA: if (pareja.categoria.torneo.organizadorId !== organizadorId) throw 403;
     ```
   - **Impacto:** Cualquier organizador logueado puede consultar o alterar la disponibilidad horaria de parejas de otro club si conoce o adivina el `parejaId` (que además es visible en el endpoint público).

---

## 8. Resumen Cuantitativo por Categoría

| Categoría | Elementos a Borrar (Confianza Alta) | Elementos a Revisar (Confianza Media) | Elementos a Conservar / Falsos Positivos (Confianza Baja) | Total Hallazgos |
| :--- | :---: | :---: | :---: | :---: |
| **1. Frontend (Archivos y Código)** | 22 | 8 | 7 | 37 |
| **2. CSS (Estilos y Selectores)** | 20 | 0 | 17 | 37 |
| **3. Dependencias (`package.json`)** | 0 | 3 | 11 | 14 |
| **4. Backend (Rutas, Servicios y DB)** | 7 | 4 | 7 | 18 |
| **5. Restos (Logs, TODOs, Temporales)**| 1 | 4 | 2 | 7 |
| **6. Duplicación Notable** | 1 | 3 | 0 | 4 |
| **7. Seguridad y Permisos** | 1 (des-trackear .env) | 2 | 1 | 4 |
| **TOTAL GENERAL** | **52** | **24** | **45** | **121** |

---

## 9. Propuesta de Plan de Limpieza en Commits Pequeños

Para ejecutar la fase de saneamiento de forma controlada y sin riesgo de regresiones, se recomienda seguir el siguiente esquema de un commit específico por categoría:

- **Commit 1: `chore(assets): eliminar archivos y componentes huérfanos del frontend`**
  - Eliminar `App.css`, `DateTimeInput.jsx`, `InicioDisponibilidadModal.jsx`.
  - Eliminar assets no referenciados: `src/assets/hero.png`, `src/assets/react.svg`, `src/assets/vite.svg`.
- **Commit 2: `refactor(frontend): limpiar imports, variables y exports sin uso`**
  - Remover los 10 imports no utilizados señalados por oxlint (`useRef`, `Trophy`, `Edit2`, `Plus`, `Check`, `X`, `RotateCcw`, `MoreVertical`, `Loader2`).
  - Remover variables muertas: `resultadoInicio`, `handleSlotSaved`, instancias no usadas de `navigate`, y simplificar la destructuración de `TorneoEnVivo.jsx:439`.
  - Encapsular exports no usados de `estadoLabels.js`.
- **Commit 3: `style(css): remover clases muertas y selectores obsoletos de index.css`**
  - Eliminar los 20 bloques de clases huérfanas en `index.css` (sidebar legado, grids en desuso, tarjetas de posiciones obsoletas de mobile, etc.), preservando intactas las clases dinámicas de badges y status.
- **Commit 4: `refactor(backend): retirar rutas y exports huérfanos de organizador y zona`**
  - Remover las rutas no consumidas `/iniciar-todos` y `/pre-check-inicio` de `organizador.routes.js` y sus métodos en controller y service.
  - Limpiar imports y variables sin uso en `organizador.service.js` (`calcularCasiEstrellas`, `PLAN_TTL_MS`) y `eliminatoriaScheduler.service.js`.
  - Eliminar alias no utilizados en `module.exports` de `zona.service.js` y `slots.service.js`.
- **Commit 5: `chore(clean): eliminar scripts temporales sueltos y des-trackear .env`**
  - Eliminar `backend/test-bracket.js`.
  - Des-trackear `backend/.env` del índice de Git (`git rm --cached backend/.env`).
- **Commit 6: `security(auth): agregar validación de organizador en disponibilidad`**
  - Incorporar la verificación de `organizadorId` en `disponibilidad.service.js` para corregir la vulnerabilidad IDOR en la consulta y edición de disponibilidades de parejas.
