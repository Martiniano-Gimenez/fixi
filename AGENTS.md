# Reglas para trabajar en Fixi

Fixi es una app para organizar torneos de pádel. Frontend: React 19 + Vite con CSS propio (`frontend/`). Backend: Node + Prisma (`backend/`).
Antes de tocar nada, leé `CONTEXT.md` (estado del proyecto) y las últimas entradas de `BITACORA.md`.

## Git
- Nunca trabajes directo en `main`. Cada etapa nueva arranca su propia rama desde `main`, con un nombre que diga qué es (`feature/...` o `fix/...`); el pedido la indica. Si no la indica, preguntá antes de crearla.
- Nunca hagas merge a `main` ni `push` si no te lo piden.
- Un commit por tarea, con mensaje en español: `feat: ...`, `fix: ...`, `chore: ...`.
- No subas la carpeta `.claude/`. Las capturas van en `capturas/` (no entra en git).

## Alcance
- El panel del organizador y la vista pública ya están rediseñados. Cada pedido aclara qué archivos se pueden tocar; respetá ese alcance.
- Mismo sistema que la vista pública: tokens v3 de index.css. Los estilos nuevos van en frontend/src/pages/admin/panel.css, siempre dentro de `.panel`. ActionsMenu se monta en body con un portal: dale la clase `.panel` a su contenedor.
- No cambies las clases globales que quedan en index.css (.btn-*, .alert-*, .error-message, .disponibilidad-editor, .range-slider-*): las usan la inscripción pública y los componentes compartidos. Si hace falta cambiar una, frená y preguntá.
- Componentes compartidos con la vista pública: DisponibilidadEditor, RangeSliderGroup, RangeSliderDia y BracketLines. Si los tocás, revisá Inscripción y el cuadro público, y avisalo en el informe.
- Solo cambiás JSX de presentación y CSS. No toques el backend ni la lógica de negocio (handlers, llamadas a la API, cálculos, validaciones y estados), salvo que el pedido lo autorice. Si hace falta y no está autorizado, frená y preguntá.
- El número de cancha no se muestra en ninguna pantalla del panel (ni en la vista pública). Se sigue guardando y validando internamente.
- No modifiques datos de la base de desarrollo. Para probar envíos de formularios, interceptá la petición en el navegador.

## Estructura de la vista pública
- Inicio: una tarjeta por categoría (recorrido de fases, partidos jugados, "N en juego", próximo partido, campeones si terminó).
- Página de categoría: encabezado con el torneo, campeones si terminó y "En juego y próximos" siempre visibles. Debajo, el recorrido de fases (Zonas, 8vos… Final) es la navegación: abre en la fase en curso y la fase va en el hash. Zonas tiene "Posiciones | Partidos" (los partidos por jornada reemplazan la sección Horarios); cada ronda muestra sus partidos en celular y el cuadro completo con la ronda destacada en escritorio. Sin índice de chips ni pestañas Zonas/Llave/Horarios.
- Sin barra inferior de navegación, sin sección "Hoy" y sin número de cancha en el público.
- La estructura **no debe copiar a Pádel Set** (padelset.com.ar): ni su orden de secciones, ni su paleta.

## Colores (tema claro)
Usá siempre los tokens por función de `index.css` / `publico.css` (`--marca`, `--vivo`, `--progreso`, `--alerta`, `--oro`, etc.). No pongas colores sueltos.
- Fondo `#F8FAFC`; tarjetas blancas con sombra suave azulada, sin bordes marcados.
- Azul eléctrico `#2563EB` + azul marino `#172554`: identidad, links, botón principal, textos.
- Naranja `#FF8A3D`: **solo** "En juego". Ningún otro uso.
- Celeste `#38BDF8`: progreso de fases y posiciones que clasifican.
- Rojo: alertas y errores ("Sin resultado cargado").
- Dorado: solo el trofeo y la estrella de la pareja seguida.
- Celeste y naranja **no se usan como color de texto** sobre blanco. Para texto: `#0369A1` y `#C2410C`.
- Todo par texto/fondo debe pasar contraste 4,5:1.
- Un solo botón principal por pantalla.
- Prohibido: bordes de color a la izquierda en tarjetas, emojis, gradientes decorativos.

## Reglas de dominio (no las cambies)
- **Jornada:** los partidos de madrugada (hasta las 6) cuentan para el día anterior.
- Los "pasa directo" (`esBye`) no cuentan como partidos.
- Una zona está terminada cuando todos sus partidos están `FINALIZADO`. Si hay empate exacto en todos los criterios, no adivines quién es primero.
- En cada partido, la pareja 1 va arriba; el ganador en negrita y el perdedor en gris.
- Una pareja favorita se guarda por categoría (como ya funciona).
- **Cierre:** automático, sin botón ni reapertura. La categoría pasa a FINALIZADO cuando todos sus partidos reales terminaron, final incluida; el torneo, cuando todas sus categorías jugables terminaron (nunca desde BORRADOR). Todo lo que cambie partidos recalcula ambos estados. Con el torneo finalizado solo se corrigen resultados o se reinicia el torneo. No se cambia el ganador de una ronda si el partido siguiente está en juego o terminado.
- **Lluvia:** al reducir canchas, ningún partido se adelanta; jornada sin empezar desde la apertura y empezada desde el próximo pendiente, nunca desde la hora real. El viernes, el inicio de disponibilidad solo cuenta para partidos sin horario; lo que no entra pasa al sábado y lo que no entra el sábado queda sin horario. Restaurar devuelve los pendientes al horario previo a la lluvia (también los cambiados a mano) o al más cercano libre, sin atrasarlos ni dejarlos sin horario. El domingo se reprograma la eliminatoria con descansos entre rondas.

## Textos
- Español rioplatense (voseo: "escribí", "elegí").
- Mayúscula solo al principio de frases y títulos. Los días van en minúscula en medio de una frase ("no juega el viernes").
- Revisá tildes y ortografía.

## Móvil y animaciones
- Sin scroll horizontal a 320, 375 y 1440 px.
- Botones y áreas táctiles de al menos 44 px. Campos de texto a 16 px en pantallas táctiles. El zoom debe seguir habilitado.
- Animá solo `transform` y `opacity`, con `cubic-bezier(.16, 1, .3, 1)`. Respetá `prefers-reduced-motion`.
- Tipografía Geist; números con `font-variant-numeric: tabular-nums`.

## Antes de dar una tarea por terminada
1. `npm run build` compila sin errores y `npm test` en frontend pasa completo (si tocaste backend, también `npm test` en backend).
2. `npm run lint`: sin avisos nuevos (hoy hay 7, ninguno de la vista pública).
3. `git diff --stat`: confirmá que no tocaste archivos fuera del alcance.
4. No hace falta sacar capturas: las toma otra persona. Decí en qué pantalla y con qué pasos se ve lo que cambiaste.
5. Revisá en el código que no haya anchos fijos que puedan causar scroll horizontal a 320 px.
6. Informá en pocas líneas: qué hiciste, qué decidiste por tu cuenta y qué quedó pendiente.

Hacé una sola tarea por pedido y frená al terminarla.
