# Reporte de Fuzz Testing e Invariantes del Scheduler (`feature/fuzz-scheduler`)

## 1. Resumen de Resultados por Etapa (500 Semillas)

Comando ejecutado: `npm run test:fuzz` (`backend/scripts/test-fuzz-scheduler.js`)
Reproductor determinístico: `node scripts/test-scheduler-invariantes-repro.js` (`backend/scripts/test-scheduler-invariantes-repro.js`)

| # | Invariante | Etapa | Estado | Semillas con falla (de 500) | Semilla mínima |
| :-: | :--- | :--- | :---: | :---: | :---: |
| 0 | `cancha_sin_solapamiento` | `post-inicio` | **PASS** | 0 | `-` |
| 1 | `cancha_sin_solapamiento` | `post-reduccion` | **FAIL** | 55 | **18** |
| 2 | `cancha_sin_solapamiento` | `post-restauracion` | **FAIL** | 45 | **17** |
| 3 | `pareja_sin_solapamiento` | `post-inicio` | **PASS** | 0 | `-` |
| 4 | `pareja_sin_solapamiento` | `post-reduccion` | **PASS** | 0 | `-` |
| 5 | `pareja_sin_solapamiento` | `post-restauracion` | **PASS** | 0 | `-` |
| 6 | `grilla_15m_y_horario_club` | `post-inicio` | **PASS** | 0 | `-` |
| 7 | `grilla_15m_y_horario_club` | `post-reduccion` | **PASS** | 0 | `-` |
| 8 | `grilla_15m_y_horario_club` | `post-restauracion` | **PASS** | 0 | `-` |
| 9 | `sin_zonas_en_domingo` | `post-inicio` | **PASS** | 0 | `-` |
| 10 | `sin_zonas_en_domingo` | `post-reduccion` | **PASS** | 0 | `-` |
| 11 | `sin_zonas_en_domingo` | `post-restauracion` | **PASS** | 0 | `-` |
| 12 | `mini_bracket_orden_p3_p4` | `post-inicio` | **PASS** | 0 | `-` |
| 13 | `mini_bracket_orden_p3_p4` | `post-reduccion` | **FAIL** | 50 | **17** |
| 14 | `mini_bracket_orden_p3_p4` | `post-restauracion` | **FAIL** | 8 | **28** |
| 15 | `eliminatorias_descanso_y_post_zonas` | `post-inicio` | **FAIL** | 167 | **1** |
| 16 | `eliminatorias_descanso_y_post_zonas` | `post-reduccion` | **FAIL** | 149 | **2** |
| 17 | `eliminatorias_descanso_y_post_zonas` | `post-restauracion` | **FAIL** | 114 | **2** |
| 18 | `modo_lluvia` | `post-reduccion` | **FAIL** | 100 | **17** |
| 19 | `modo_lluvia` | `post-restauracion` | **FAIL** | 85 | **7** |
| 20 | `precheck_monotonia` | `post-inicio` | **FAIL** | 7 | **100** |
| 21 | `precheck_zona_manual_partidos` | `post-inicio` | **FAIL** | 121 | **3** |

---

## 2. Casos Mínimos Reducidos y Causa Raíz por Invariante

### 2.1. `precheck_zona_manual_partidos:post-inicio`
- **Semilla mínima**: `3` (falla en 121/500 semillas).
- **Caso mínimo reducido** (`test1_precheckZonaManualPartidos`):
  - **Configuración**: 1 cancha, 1 categoría, 3 parejas (1 zona de 3).
  - **Disponibilidad inicial**: Parejas 1 y 2 solo `Viernes-18:00`; Pareja 3 solo `Viernes-19:15`. La Pareja 3 no tiene intersección con P1 ni P2, por lo que la zona cae en `sinGrupo` (`requiereArmadoManual = true`, `partidos = []`).
  - **Acción**: Se resuelve el conflicto de la zona con `setDisponibilidadDoble(orgId, p1.id, ['Viernes-19:15'], p2.id, ['Viernes-19:15'])` y se invoca `preCheckInicioTorneo(..., { isReCheck: true })`.
  - **Resultado observado**: `z.requiereArmadoManual` pasa a `false` (100% de conflictos resueltos), pero `z.partidos.length === 0`.
- **Causa raíz**:
  - En `iniciarCategoriaConDisponibilidad` (`backend/src/services/zona.service.js`, líneas 361–394), cuando una zona tiene parejas en `sinGrupo`, se persiste con `requiereArmadoManual: true` y **no** se llama a `generarPartidosZonaHelper`.
  - Luego, en `evaluarAsignacionesIncrementales` (`backend/src/services/organizador.service.js`, líneas 564–568), cuando las parejas en conflicto logran intersección horaria con el resto de la zona, se actualiza `z.requiereArmadoManual = false` y se itera sobre `z.partidos || []`, pero nunca se crean los partidos faltantes de esa zona en la base de datos.

---

### 2.2. `precheck_monotonia:post-inicio`
- **Semilla mínima**: `100` (falla en 7/500 semillas).
- **Caso mínimo reducido** (`test2_precheckMonotonia`):
  - **Configuración**: 1 cancha, 1 categoría, 4 parejas (1 zona `MINI_BRACKET` de 4 parejas).
  - **Disponibilidad inicial**: Las 4 parejas tienen únicamente `Viernes-18:00`.
  - **Acción**:
    1. En el `preCheckInicioTorneo` inicial, `P1` toma `Viernes-18:00` en Cancha 1 y `P2` queda sin horario (`1` conflicto base; `P3` y `P4` están excluidos por ser derivados de `P2` sin horario).
    2. Se resuelve `P2` agregando `Viernes-19:15` a las dos parejas de `P2` via `setDisponibilidadDoble` y se ejecuta `preCheckInicioTorneo(..., { isReCheck: true })`.
  - **Resultado observado**: `P2` se agenda en `Viernes-19:15`, por lo que `P3` y `P4` pasan a ser conflictos base activos y ambos fallan al buscar intersección de las 4 parejas `>= 20:30`. El total de conflictos base **sube de 1 a 2**.
- **Causa raíz**:
  - En `evaluarAsignacionesIncrementales` (`backend/src/services/organizador.service.js`, líneas 364–476 y 759–837), los partidos `P3` y `P4` de una zona `MINI_BRACKET` exigen intersección horaria de las **4 parejas** de la zona en un slot posterior a `max(fin(P1), fin(P2))` y no tienen fallback en `preCheck`.
  - Como la resolución de un conflicto de primera ronda (`P1` o `P2`) mediante `setDisponibilidadDoble` solo amplía la disponibilidad de 2 de las 4 parejas de la zona, al destrabar `P2` se activan simultáneamente 2 conflictos nuevos (`P3` y `P4`).

---

### 2.3. `cancha_sin_solapamiento:post-reduccion`, `cancha_sin_solapamiento:post-restauracion`, `mini_bracket_orden_p3_p4:post-reduccion` y `modo_lluvia:post-reduccion`
- **Semillas mínimas**:
  - `cancha_sin_solapamiento:post-reduccion`: **18** (55/500 semillas)
  - `cancha_sin_solapamiento:post-restauracion`: **17** (45/500 semillas)
  - `mini_bracket_orden_p3_p4:post-reduccion`: **17** (50/500 semillas)
  - `modo_lluvia:post-reduccion`: **17** (100/500 semillas)
- **Caso mínimo reducido** (`test3_miniBracketLluvia`):
  - **Configuración**: 2 canchas, 1 categoría, 6 parejas (Zona A `MINI_BRACKET` de 4 parejas en `Viernes 18:00` y `19:15`; Zona B `ROUND_ROBIN` de 2 parejas en `Viernes 20:30`).
  - **Estado tras inicio**:
    - Zona A `P1` y `P2`: Viernes `18:00` (Canchas 1 y 2).
    - Zona A `P3` y `P4`: Viernes `19:15` (Canchas 1 y 2).
    - Zona B `P1`: Viernes `20:30` (Cancha 1).
  - **Acción**: Reducir Viernes (`2026-09-04`) de 2 canchas a 1 cancha (`reprogramarPorReduccionCanchas`) y luego restaurar a 2 canchas.
  - **Resultado observado**:
    1. **En `post-reduccion`**:
       - `P2` de Zona A se mueve a `19:15` en Cancha 1, **solapándose en la misma cancha y hora** con `P3` (`19:15` Cancha 1) → falla `cancha_sin_solapamiento:post-reduccion`.
       - `P2` termina a las `20:30`, pero `P3` y `P4` quedaron clavados a las `19:15` (`19:15 < 20:30`) → falla `mini_bracket_orden_p3_p4:post-reduccion`.
       - `P4` quedó `PENDIENTE` en `Cancha 2 > 1` sin estar reportado en `partidosSinSlot` → falla `modo_lluvia:post-reduccion`.
    2. **En `post-restauracion`**:
       - Al restaurar a 2 canchas, los partidos con parejas asignadas se compactan a `18:00` y `19:15`, volviendo a pisar a `P3`/`P4` en `19:15` → falla `cancha_sin_solapamiento:post-restauracion`.
- **Causa raíz**:
  - En `asignarHorariosModoLluviaMCF` (`backend/src/services/zona.service.js`, líneas 1228–1267), al clasificar los partidos `PENDIENTE` de la jornada:
    ```js
    if (p.pareja1Id && p.pareja2Id) {
        partidosReprogramables.push(p);
    } else if (p.faseEliminatoriaId) {
        partidosEliminatoriaPendientes.push(p);
    }
    ```
  - Los partidos `P3` y `P4` de `MINI_BRACKET` están en estado `PENDIENTE` pero tienen `pareja1Id: null, pareja2Id: null` (esperan el resultado de `P1` y `P2`) y `faseEliminatoriaId: null` (pertenecen a una zona).
  - Al no entrar en ningún `if`, **son completamente ignorados por el algoritmo de Modo Lluvia**:
    1. No se registran en `courtTimelines`, por lo que el solver asigna otros partidos encima de su cancha y horario (`cancha_sin_solapamiento`).
    2. No se desplazan cuando `P1` o `P2` se reprograman más tarde (`mini_bracket_orden_p3_p4`).
    3. No se reubican de canchas inactivas (`canchaNumero > canchasDisponibles`) ni se incluyen en `partidosSinSlot` (`modo_lluvia:post-reduccion`).

---

### 2.4. `modo_lluvia:post-restauracion` y `mini_bracket_orden_p3_p4:post-restauracion`
- **Semillas mínimas**:
  - `modo_lluvia:post-restauracion`: **7** (85/500 semillas)
  - `mini_bracket_orden_p3_p4:post-restauracion`: **28** (8/500 semillas)
- **Caso mínimo reducido** (`test4_perdidaSabadoPostRestauracion`):
  - **Configuración**: 2 canchas, 1 categoría, 19 parejas en Sábado (`10:00` a `02:00`, 5 zonas de 3 en `10:00..21:15` + 1 zona `MINI_BRACKET` de 4 en `22:30` y `23:45`).
  - **Acción**: Reducir Sábado (`2026-09-05`) de 2 canchas a 1 cancha (con `dayLimitMs` en `02:00`, varios partidos del sábado no entran en 1 sola cancha y pasan a `partidosSinSlot` con `fechaHora = null`), y luego restaurar Sábado (`2026-09-05`) a 2 canchas.
  - **Resultado observado**:
    - Al restaurar las 2 canchas del sábado, los partidos que habían quedado sin slot durante la reducción **siguen con `fechaHora = null`** (pérdida de partidos programados tras reducir + restaurar → falla `modo_lluvia:post-restauracion`).
    - Además, en la zona `MINI_BRACKET`, `P1` y `P2` pierden su horario (`fechaHora = null`) mientras que `P3` y `P4` (ignorados por modo lluvia) conservan su horario del sábado a las `23:45` (`mini_bracket_orden_p3_p4:post-restauracion`).
- **Causa raíz**:
  - En `asignarHorariosModoLluviaMCF` (`backend/src/services/zona.service.js`, líneas 1366–1371), cuando un partido no encuentra slot al reducir canchas, se actualiza en BD con `fechaHora: null, canchaNumero: null, sinHorarioAsignado: true`.
  - Al restaurar las canchas del sábado (`overrideDiaKey = '2026-09-05'`), el filtro de jornada (líneas 1223–1226) hace:
    ```js
    const diaP = p.fechaHora
        ? getDiaCalendarioConTrasnoche(p.fechaHora, organizador)
        : getDiaCalendarioConTrasnoche(parseFechaLocal(refFecha), organizador);
    const esMismaJornada = diaP === diaObjetivoKey;
    ```
  - Como `p.fechaHora` es `null`, usa `refFecha` (que es la fecha de inicio del torneo: **Viernes** `2026-09-04`), obteniendo `diaP = '2026-09-04' !== '2026-09-05'`. Así, todos los partidos del sábado que quedaron sin horario durante la reducción son descartados por `esMismaJornada === false` y jamás se reprograman al restaurar las canchas del sábado.

---

### 2.5. `eliminatorias_descanso_y_post_zonas:post-inicio`, `:post-reduccion` y `:post-restauracion`
- **Semillas mínimas**:
  - `eliminatorias_descanso_y_post_zonas:post-inicio`: **1** (167/500 semillas)
  - `eliminatorias_descanso_y_post_zonas:post-reduccion`: **2** (149/500 semillas)
  - `eliminatorias_descanso_y_post_zonas:post-restauracion`: **2** (114/500 semillas)
- **Caso mínimo reducido** (`test5_eliminatoriasAntesDeFinZonas`):
  - **Configuración**: 2 canchas, 1 categoría, 25 parejas (7 zonas de 3 y 1 zona de 4 → 17 clasificados → cuadro eliminatorio desde Ronda 32 / Dieciseisavos), con disponibilidad en `Sábado 22:00`.
  - **Acción**: Ejecutar `confirmarInicioTorneo`, luego reducir canchas y restaurar canchas.
  - **Resultado observado**: En las 3 etapas (`post-inicio`, `post-reduccion`, `post-restauracion`), el partido de Ronda 32 (`orden: 32`) se agenda el **Sábado a las `20:45`**, mientras que los partidos de zona de la misma categoría terminan recién el **Sábado a las `23:15`** (eliminatoria programada antes del fin de zonas de su categoría).
- **Causa raíz**:
  - En `programarHorariosEliminatorias` (`backend/src/services/eliminatoriaScheduler.service.js`, líneas 109–111 y 263–306), cuando existen partidos de `ronda === 32`, el scheduler los ubica en la noche del sábado buscando el primer slot libre a partir de `sabNightStartMs` (`20:45`).
  - A diferencia de lo que pudiera esperarse por dependencia de fase, `programarHorariosEliminatorias` **no consulta ni respeta el máximo `fechaHora + duracion` de los partidos de zona de esa categoría** (`maxZonaEnd`), permitiendo que la Ronda 32 se programe antes de que finalicen las zonas en sábado noche/trasnoche.
