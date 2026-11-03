const identidad = (categoriaId, zonaId, posicionEnRonda) => JSON.stringify([categoriaId, zonaId, posicionEnRonda]);

export function listarPendientes(categorias) {
  const lista = new Map();
  for (const categoria of categorias) {
    const conflictos = [...categoria.partidosSinHorario].sort((a, b) =>
      (a.zona || '').localeCompare(b.zona || '', 'es', { numeric: true }) || (a.posicionEnRonda || 0) - (b.posicionEnRonda || 0));
    for (const conflicto of conflictos) {
      const partidos = conflicto.motivo === 'ZONA_MANUAL_INCOMPLETA' ? conflicto.partidosZona || [] : [{
        ...conflicto, origen: conflicto.motivo === 'PARTIDO_SIN_HORARIO' ? conflicto.pareja1 : undefined,
      }];
      for (const partido of [...partidos].sort((a, b) => a.posicionEnRonda - b.posicionEnRonda)) {
        if (partido.esBye || partido.estado === 'FIJO' || (partido.fechaHora && partido.canchaNumero) ||
            !conflicto.zonaId || !Number.isInteger(partido.posicionEnRonda)) continue;
        const clave = identidad(categoria.categoriaId, conflicto.zonaId, partido.posicionEnRonda);
        if (!lista.has(clave)) lista.set(clave, { clave, categoriaId: categoria.categoriaId, nombreCategoria: categoria.nombreCategoria,
          zonaId: conflicto.zonaId, zona: conflicto.zona, partido,
          parejas: conflicto.parejasManuales || [
            { id: conflicto.pareja1Id, nombre: conflicto.pareja1, slotIds: conflicto.pareja1SlotIds || [] },
            { id: conflicto.pareja2Id, nombre: conflicto.pareja2, slotIds: conflicto.pareja2SlotIds || [] },
          ] });
      }
    }
  }
  return [...lista.values()];
}

export function actualizarRecorrido(anterior, fuente) {
  if (anterior?.fuente === fuente) return anterior;
  const nuevos = new Map(fuente.map((p) => [p.clave, p]));
  const previos = anterior?.lista || [];
  const conocidos = new Set(previos.map((p) => p.clave));
  const agregados = fuente.filter((p) => !conocidos.has(p.clave));
  const lista = [...previos.filter((p) => nuevos.has(p.clave)).map((p) => nuevos.get(p.clave)), ...agregados];
  const indice = previos.findIndex((p) => p.clave === anterior?.actual);
  // Al desaparecer el actual, seguir por su próximo superviviente; luego volver al principio.
  const proximo = previos.slice(indice + 1).find((p) => nuevos.has(p.clave));
  const actual = nuevos.has(anterior?.actual) ? anterior.actual : proximo?.clave || agregados[0]?.clave || lista[0]?.clave || null;
  return { fuente, lista, actual };
}
