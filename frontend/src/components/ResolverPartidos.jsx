import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import ElegirHorarioPartido from './ElegirHorarioPartido';
import { actualizarRecorrido, listarPendientes } from '../pages/admin/recorridoPartidos';

export default function ResolverPartidos({ categorias, torneoId, revision, abierto, onAbiertoChange, onSaved, onRecheck, onCerrar, ocupado }) {
  const partidos = useMemo(() => listarPendientes(categorias), [categorias]);
  const [recorrido, setRecorrido] = useState(() => actualizarRecorrido(null, partidos));
  const [mensaje, setMensaje] = useState('');
  const tituloRef = useRef(null);
  // Conservar la identidad y el orden aun cuando el re-check reordene categorías.
  const vigente = actualizarRecorrido(recorrido, partidos);
  if (vigente !== recorrido) setRecorrido(vigente);
  const indice = vigente.lista.findIndex((p) => p.clave === vigente.actual);
  const actual = vigente.lista[indice];
  const clave = actual?.clave;
  useEffect(() => { tituloRef.current?.focus(); }, [clave]);

  const identidad = actual && { categoriaId: actual.categoriaId, zonaId: actual.zonaId, posicionEnRonda: actual.partido.posicionEnRonda };
  const esActual = (editor) => editor?.categoriaId === identidad?.categoriaId && editor?.zonaId === identidad?.zonaId &&
    editor?.posicionEnRonda === identidad?.posicionEnRonda;
  const cambiarEditor = (cambio) => onAbiertoChange((prev) => {
    const base = esActual(prev) ? prev : identidad;
    return typeof cambio === 'function' ? cambio(base) : cambio;
  });
  const navegar = (paso) => {
    if (ocupado) return;
    onAbiertoChange(null); setMensaje('');
    setRecorrido({ ...vigente, actual: vigente.lista[indice + paso].clave });
  };

  return (
    <section className="pc-resolver" aria-label="Resolver de a uno">
      <div className="pc-resolver-cabecera">
        <h2 ref={tituloRef} tabIndex={-1} className="pc-resolver-titulo">{actual ? 'Resolver de a uno' : 'No quedan partidos sin horario'}</h2>
        <button type="button" className="pc-manual-button" onClick={onCerrar} disabled={ocupado}>
          <X size={16} aria-hidden="true" /> Volver a los conflictos
        </button>
      </div>
      {actual && (
        <>
          <div className="pc-resolver-navegacion">
            <button type="button" className="pc-manual-button" aria-label="Partido anterior" disabled={ocupado || indice === 0} onClick={() => navegar(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
            <p className="pc-manual-copy" role="status" aria-atomic="true">{mensaje && `${mensaje} `}{indice + 1} de {vigente.lista.length} pendientes</p>
            <button type="button" className="pc-manual-button" aria-label="Partido siguiente" disabled={ocupado || indice === vigente.lista.length - 1} onClick={() => navegar(1)}><ChevronRight size={18} aria-hidden="true" /></button>
          </div>
          <p className="pc-resolver-contexto">{actual.nombreCategoria} · {actual.zona} · Partido {actual.partido.posicionEnRonda}</p>
          <ElegirHorarioPartido key={actual.clave} torneoId={torneoId} categoriaId={actual.categoriaId} zonaId={actual.zonaId}
            revision={revision} partido={actual.partido} parejas={actual.parejas} mostrarBoton={false}
            partidosZona={actual.partidosZona} parejasZona={actual.parejasZona}
            abierto={esActual(abierto) ? abierto : identidad} onAbiertoChange={cambiarEditor}
            onSaved={(res) => { setMensaje('Horario confirmado.'); onSaved(res); }} onRecheck={onRecheck} />
        </>
      )}
      {!actual && <p className="pc-manual-copy" role="status">Todos los pendientes de este recorrido tienen horario. Volvé a la lista para revisar el torneo.</p>}
    </section>
  );
}
