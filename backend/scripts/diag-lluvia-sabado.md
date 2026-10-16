# Diagnóstico: Partidos de Sábado marcados como "Sin horario disponible" al reducir canchas el Viernes

**Fecha de análisis:** 16 de Octubre de 2026  
**Base de datos analizada:** Copia exacta en `backend/prisma/dev.manual.db` (sin modificar `dev.db` ni código fuente).  
**Torneo ID:** `9b5c0e4b-90cf-432f-a9ec-0bdc2619b2af` ("Impares Agosto")  
**Club:** Px4 (6 canchas totales, Viernes 12:00-02:00, Sábado 08:00-02:00, Domingo 08:00-23:00)

---

## 1. Estado de los 3 Partidos Afectados y el P2 de su Misma Zona

Se analizaron las dos zonas de categoría 5ta involucradas: **Zona B** y **Zona H**, ambas con formato `MINI_BRACKET`.

### A. Zona B (`4dc3d876-0210-4df0-9b78-6a0c0bb38a6f`)
- **Categoría:** 5ta (`28e6dd51-a970-4a11-a2b0-cffd9d58b6d5`)
- **Formato:** `MINI_BRACKET`

| Campo | Partido Afectado (P4) | P2 de la Misma Zona |
| :--- | :--- | :--- |
| **ID** | `cf535357-0a62-45e1-b73f-ceaa05a98649` | `8d5d2317-d4b9-4e05-80d3-1b70cc3555cf` |
| **Parejas / Cruce** | Figueroa / Esquivel vs Zelaya / Frías | Escobar / Colombo vs Zelaya / Frías |
| **posicionEnRonda** | `4` (Ronda 2 - 3er Puesto) | `2` (Ronda 1 - Semifinal 2) |
| **Estado** | `PENDIENTE` | `FINALIZADO` |
| **fechaHora (Actual en dev.manual.db)** | `null` | `2026-09-05T17:30:00.000Z` |
| **fechaHora (Hora Bs. As. ART UTC-3)** | **Sin horario** (Original: Sábado 05/09/2026 09:45 hs) | **Sábado 05/09/2026 14:30 hs** |
| **canchaNumero** | `null` (Original: `5`) | `1` |
| **sinHorarioAsignado** | `true` (Original: `false`) | `false` |
| **zonaId** | `4dc3d876-0210-4df0-9b78-6a0c0bb38a6f` | `4dc3d876-0210-4df0-9b78-6a0c0bb38a6f` |
| **zona.formato** | `MINI_BRACKET` | `MINI_BRACKET` |

*(Nota de contexto en Zona B: P1 se jugó a las 08:30 hs ART y finalizó 09:45 hs ART. P2 se jugó a las 14:30 hs ART y finalizó 15:45 hs ART).*

---

### B. Zona H (`10218775-54f1-4334-860e-a2a816bd6710`)
- **Categoría:** 5ta (`28e6dd51-a970-4a11-a2b0-cffd9d58b6d5`)
- **Formato:** `MINI_BRACKET`

| Campo | Partido Afectado 1 (P3) | Partido Afectado 2 (P4) | P2 de la Misma Zona |
| :--- | :--- | :--- | :--- |
| **ID** | `acfb1242-871c-483e-a4d2-96a82df580c2` | `569fa39a-e0fe-48d4-ad12-4f4b194bf83c` | `70540f45-d748-46fc-8c0c-487dfa7326e8` |
| **Parejas / Cruce** | Ganador P1 vs Ganador P2 | Perdedor P1 vs Perdedor P2 | erer / erer vs Benegas / Benegas |
| **posicionEnRonda** | `3` (Ronda 2 - Final) | `4` (Ronda 2 - 3er Puesto) | `2` (Ronda 1 - Semifinal 2) |
| **Estado** | `PENDIENTE` | `PENDIENTE` | `PENDIENTE` |
| **fechaHora (Actual en dev.manual.db)** | `null` | `null` | `2026-09-05T17:30:00.000Z` |
| **fechaHora (Hora Bs. As. ART UTC-3)** | **Sin horario** (Original: Sáb 05/09 18:30 hs) | **Sin horario** (Original: Sáb 05/09 18:30 hs) | **Sábado 05/09/2026 14:30 hs** |
| **canchaNumero** | `null` (Original: `2`) | `null` (Original: `3`) | `6` |
| **sinHorarioAsignado** | `true` (Original: `false`) | `true` (Original: `false`) | `false` |
| **zonaId** | `10218775-54f1-4334-860e-a2a816bd6710` | `10218775-54f1-4334-860e-a2a816bd6710` | `10218775-54f1-4334-860e-a2a816bd6710` |
| **zona.formato** | `MINI_BRACKET` | `MINI_BRACKET` | `MINI_BRACKET` |

*(Nota de contexto en Zona H: P1 estaba agendado a las 17:30 hs ART con fin estimado 18:45 hs ART).*

---

## 2. Filas de `OverrideCanchasDia` del Torneo

Se consultó la tabla `OverrideCanchasDia` para el torneo `9b5c0e4b-90cf-432f-a9ec-0bdc2619b2af`.

Existe **únicamente 1 fila** registrada para este torneo:

- **ID:** `e36cebd7-59b8-411c-b50b-427336d9c180`
- **diaKey:** `"2026-09-04"` (Viernes)
- **canchas:** `4`
- **isLluvia:** `true`
- **activoDesde:** `2026-09-04T15:00:00.000Z`
- **createdAt / updatedAt:** `2026-10-16T22:20:32.364Z`
- **partidosSinSlot:**
  ```json
  {
    "cf535357-0a62-45e1-b73f-ceaa05a98649": "Desplazado porque el nuevo fin de P1/P2 supera su horario de inicio",
    "acfb1242-871c-483e-a4d2-96a82df580c2": "Desplazado porque el nuevo fin de P1/P2 supera su horario de inicio",
    "569fa39a-e0fe-48d4-ad12-4f4b194bf83c": "Desplazado porque el nuevo fin de P1/P2 supera su horario de inicio"
  }
  ```

### ¿Aparecen esos 3 IDs?
**Sí, aparecen exactamente los 3 IDs** en el mapa `partidosSinSlot` del override del Viernes `2026-09-04`.

### ¿Había overrides viejos (por ejemplo del sábado)?
**No.** No existía ningún override previo del sábado ni de ningún otro día en este torneo. Toda la tabla de la base de datos solo tiene 3 overrides históricos pertenecientes a distintos torneos aislados de testing; el torneo de la prueba sólo tenía este override recién creado en la reducción del viernes.

---

## 3. diaKey Usado en la Reducción vs getDiaCalendarioConTrasnoche de los 3 Partidos

- **diaKey usado en la reducción de hoy:** `"2026-09-04"` (Viernes).

- **Resultado de `getDiaCalendarioConTrasnoche` con sus horarios originales:**
  1. **Figueroa / Esquivel vs Zelaya / Frías** (`cf535357-0a62-45e1-b73f-ceaa05a98649`):
     - `fechaHora` original: `2026-09-05T12:45:00.000Z` (Sábado 09:45 hs ART).
     - Retorno de `getDiaCalendarioConTrasnoche`:
       `{ dia: 'sabado', fecha: '2026-09-05', key: '2026-09-05' }`
       **diaKey:** `"2026-09-05"`.
  2. **Ganador P1 vs Ganador P2** (`acfb1242-871c-483e-a4d2-96a82df580c2`):
     - `fechaHora` original: `2026-09-05T21:30:00.000Z` (Sábado 18:30 hs ART).
     - Retorno de `getDiaCalendarioConTrasnoche`:
       `{ dia: 'sabado', fecha: '2026-09-05', key: '2026-09-05' }`
       **diaKey:** `"2026-09-05"`.
  3. **Perdedor P1 vs Perdedor P2** (`569fa39a-e0fe-48d4-ad12-4f4b194bf83c`):
     - `fechaHora` original: `2026-09-05T21:30:00.000Z` (Sábado 18:30 hs ART).
     - Retorno de `getDiaCalendarioConTrasnoche`:
       `{ dia: 'sabado', fecha: '2026-09-05', key: '2026-09-05' }`
       **diaKey:** `"2026-09-05"`.

Los 3 partidos pertenecen inequívocamente al día sábado `"2026-09-05"`.

---

## 4. Análisis de Ramas en `asignarHorariosModoLluviaMCF`

En `backend/src/services/zona.service.js`:

### Paso 1: Bucle inicial de clasificación (líneas 1284–1317)
Al iterar sobre todos los partidos del torneo:
```javascript
const pDiaKey = getDiaCalendarioConTrasnoche(p.fechaHora, club).key;
const esMismaJornada = (pDiaKey === diaKey); // '2026-09-05' === '2026-09-04' => FALSE
```
- Para los 3 partidos, `esMismaJornada` evaluó como `false`.
- Por ende, entraron a la rama `else` (línea 1292):
  ```javascript
  if (isMiniBracketRonda2(p)) {
    partidosMiniBracketOtraJornada.push(p);
  }
  ```
- Dado que pertenecen a zonas `MINI_BRACKET` y tienen `posicionEnRonda === 3` o `4`, los 3 fueron añadidos al array `partidosMiniBracketOtraJornada`.
- En este punto, **ninguno entró en `partidosAAsignar`** (reservado exclusivamente para los partidos del viernes a reprogramar), y sus slots fueron bloqueados en `busyIntervalsPerCourt` para no ser pisados por la reprogramación del viernes.

### Paso 2: El Bucle de "Caso Cruzado" (líneas 1522–1540)
Tras resolver el MCF del viernes, el código ejecuta:
```javascript
// Caso cruzado: P3/P4 en otra jornada cuyos P1/P2 se movieron y ahora chocan con P3/P4
for (const pOtra of partidosMiniBracketOtraJornada) {
  if (!pOtra.fechaHora) continue;
  const pOtraStartMs = new Date(pOtra.fechaHora).getTime();
  const r1Info = getRonda1InfoZona(pOtra.zonaId, pOtra.id);
  if (r1Info.maxEndMs > pOtraStartMs) {
    updatesMap.set(pOtra.id, {
      id: pOtra.id,
      sinHorarioAsignado: true,
      fechaHora: null,
      canchaNumero: null,
    });
    partidosSinSlotMotivos.set(
      pOtra.id,
      'Desplazado porque el nuevo fin de P1/P2 supera su horario de inicio'
    );
  }
}
```

### ¿Por qué entraron en la condición de borrado?
El bucle fue concebido para detectar cuando P1/P2 estaban en Viernes y, al correrse por lluvia en Viernes, invadían el horario de P3/P4 que estaban en Sábado. **Sin embargo, el bucle NO filtra si la zona tenía partidos en la jornada del override (`diaKey`), ni verifica si P1 o P2 fueron realmente reprogramados por la lluvia.**

Al evaluar `getRonda1InfoZona(pOtra.zonaId, pOtra.id)`:
1. **En Zona B (P4: Figueroa/Esquivel vs Zelaya/Frías):**
   - P1 terminó a las 09:45 hs ART (12:45 UTC).
   - P2 terminó a las 15:45 hs ART (18:45 UTC).
   - `r1Info.maxEndMs` tomó el máximo de ambos: **18:45 UTC** (15:45 hs ART).
   - P4 estaba agendado a las **09:45 hs ART** (12:45 UTC).
   - La condición evaluó: `18:45 UTC > 12:45 UTC` (`r1Info.maxEndMs > pOtraStartMs`) $\rightarrow$ **`true`**.
   - Consecuencia: P4 fue borrado de su horario de sábado y catalogado como desplazado por lluvia de viernes.
   *(P3 de Zona B estaba agendado a las 15:45 hs ART, es decir 18:45 UTC, por lo que `18:45 > 18:45` fue `false` y sobrevivió).*

2. **En Zona H (P3 y P4):**
   - P1 estaba programado a las 17:30 hs ART y finalizaba a las **18:45 hs ART** (21:45 UTC).
   - P2 estaba programado a las 14:30 hs ART y finalizaba a las 15:45 hs ART (18:45 UTC).
   - `r1Info.maxEndMs` tomó el máximo: **21:45 UTC** (18:45 hs ART).
   - Tanto P3 como P4 estaban programados originalmente a las **18:30 hs ART** (21:30 UTC).
   - En la programación original de dev.db existía un desfase de 15 minutos (`18:45 > 18:30`).
   - La condición evaluó: `21:45 UTC > 21:30 UTC` $\rightarrow$ **`true`** tanto para P3 como para P4.
   - Consecuencia: Ambos partidos de sábado fueron borrados y asignados a `partidosSinSlot` del override del viernes.

---

## 5. Test Determinista Mínimo de Reproducción

Se implementó el script de test determinista en [backend/scripts/test-repro-lluvia-sabado.js](file:///c:/Users/marti/Desktop/padel-torneos/backend/scripts/test-repro-lluvia-sabado.js).

### Escenario del Test:
- Se crea un club con 6 canchas y las mismas franjas horarias que `dev.db`.
- Se crea una categoría 5ta con una Zona B en formato `MINI_BRACKET`.
- Todos los partidos de la zona se agendan en **SÁBADO** (05/09/2026), replicando exactamente los horarios de la Zona B en `dev.db`:
  - P1: Sábado 08:30 hs ART (Cancha 5)
  - P2: Sábado 14:30 hs ART (Cancha 1)
  - P4: Sábado 09:45 hs ART (Cancha 5)
- Se ejecuta la reducción de canchas del **VIERNES** (`2026-09-04`) a 4 canchas con `reprogramarPorReduccionCanchas`.

### Resultado de la Ejecución Actual (Falla Demostrada):
```text
$ node scripts/test-repro-lluvia-sabado.js
◇ injected env (3) from .env.test
--- Configurando club y torneo con configuración idéntica a dev.db ---
Estado antes de reducir Viernes:
   P4 sábado: fechaHora=2026-09-05T12:45:00.000Z, cancha=5, sinHorario=false

--- Ejecutando reducción de VIERNES (2026-09-04) a 4 canchas ---

Estado después de reducir Viernes:
   P4 sábado: fechaHora=NULL, cancha=null, sinHorario=true
   Overrides de Viernes (partidosSinSlot): {
  'ebaf8c14-1eaf-48ba-a82f-d17856b41fd5': 'Desplazado porque el nuevo fin de P1/P2 supera su horario de inicio'
}

❌ BUG REPRODUCIDO: P4 de SÁBADO quedó sinHorarioAsignado=true por una reducción del VIERNES

AssertionError [ERR_ASSERTION]: true !== false
    at testReproductorLluviaViernesAfectaSabado (c:\Users\marti\Desktop\padel-torneos\backend\scripts\test-repro-lluvia-sabado.js:137:12)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
```

### Datos de la Base Real Necesarios para que Ocurra:
1. Una zona con formato `MINI_BRACKET`.
2. Que P3 o P4 estén agendados en una jornada distinta (`otraJornada`) a la que se le aplica el override.
3. Que en la configuración preexistente de esa zona, `Math.max(fin(P1), fin(P2)) > inicio(P3 o P4)`:
   - Ya sea porque P4 se programó más temprano que P2 (como en Zona B, donde P4 era a las 09:45 hs y P2 a las 14:30 hs).
   - O porque P1 terminaba unos minutos después del inicio de P3/P4 (como en Zona H, donde P1 terminaba a las 18:45 hs y P3/P4 arrancaban a las 18:30 hs).
4. El desencadenante es que el bucle de caso cruzado asume que cualquier desfase entre Ronda 1 y Ronda 2 fue causado por la reprogramación del día del override, sin chequear si P1/P2 pertenecían a dicho día ni si fueron efectivamente modificados.
