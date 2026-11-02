import { useId, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import ElegirHorarioPartido from './ElegirHorarioPartido';

export default function PartidosZonaManual({ partidos, children, ...editorProps }) {
  const [editorAbierto, setEditorAbierto] = useState(false);
  const seccionId = useId();
  const ordenados = [...partidos].sort((a, b) => a.posicionEnRonda - b.posicionEnRonda);
  const basesPendientes = ordenados.some((p) => p.posicionEnRonda <= 2 && p.estado !== 'FIJO' && !(p.fechaHora && p.canchaNumero));

  return (
    <section className="pc-manual-zone" aria-labelledby={`${seccionId}-titulo`}>
      <h4 id={`${seccionId}-titulo`} className="pc-manual-title">Armar a mano</h4>
      <ol className="pc-manual-partidos">
        {ordenados.map((partido) => (
          <li key={partido.posicionEnRonda} className="pc-manual-partido">
            <ElegirHorarioPartido {...editorProps} partido={partido}
              esperaBases={Boolean(partido.origen && !partido.pareja1Id && !partido.pareja2Id && partido.posicionEnRonda >= 3 && basesPendientes)} />
          </li>
        ))}
      </ol>
      <button type="button" className="pc-manual-button pc-manual-toggle" aria-expanded={editorAbierto}
        aria-controls={`${seccionId}-parejas`} disabled={Boolean(editorProps.abierto?.fijando)} onClick={() => setEditorAbierto((valor) => !valor)}>
        Editar horarios de una pareja
        {editorAbierto ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      <div id={`${seccionId}-parejas`} className="pc-manual-editor" hidden={!editorAbierto}>{children}</div>
    </section>
  );
}
