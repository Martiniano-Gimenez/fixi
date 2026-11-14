import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Trophy, Users } from 'lucide-react';
import Recorrido from './Recorrido';
import Segmentado from './Segmentado';
import TarjetaPartido from './TarjetaPartido';
import TablaZona from './TablaZona';
import ListaAnimada from './ListaAnimada';
import LlaveEscritorio from './LlaveEscritorio';
import {
  agruparPartidosPorJornada, clasificadosPorOrigen, diaDeHoy, diasDelTorneo, estadoDe,
  etapasDe, fraseFase, ladoDe, nombreJornada, partidosDeCategoria, porHorario, sinResultado,
} from './utilidades';

const claveTarjeta = (p) => p.id;
const MAX_PROXIMOS = 4;
const HASH_RONDA = { 32: 'dieciseisavos', 16: 'octavos', 8: 'cuartos', 4: 'semi', 2: 'final', 1: 'final' };
const porHoraAsignada = (a, b) => a.fechaHora && b.fechaHora ? porHorario(a, b)
  : a.fechaHora ? -1 : b.fechaHora ? 1 : (a.posicionEnRonda || 0) - (b.posicionEnRonda || 0);

export default function Categoria({ categoria: cat, seguidaId, isMobile, rondaId, animar, actualizacion, seccionInicial, torneoEstado, torneoNombre }) {
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const recorridoRef = useRef(null);
  const alinearFase = useRef(false);
  const ahora = Date.now();
  const e = estadoDe(cat, ahora);
  const origenes = useMemo(() => clasificadosPorOrigen(cat), [cat]);
  const partidos = useMemo(() => partidosDeCategoria(cat), [cat]);
  const etapas = useMemo(() => etapasDe(cat), [cat]);
  const zonas = cat.zonas || [];
  const clasificacionUniforme = zonas.length > 0 && zonas.every((z) => z.clasifican === zonas[0].clasifican);
  const eliminatoria = cat.eliminatoria || [];
  const dias = useMemo(() => diasDelTorneo([cat]), [cat]);
  const hoy = diaDeHoy(dias, ahora);
  const [vistaZona, setVistaZona] = useState(seccionInicial === 'horarios' ? 1 : 0);
  const fases = etapas.map((etapa) => ({ ...etapa,
    hash: etapa.key === 'zonas' ? 'zonas' : HASH_RONDA[eliminatoria.find((f) => f.id === etapa.key)?.ronda]
      || `ronda-${eliminatoria.find((f) => f.id === etapa.key)?.ronda}`,
  }));
  const faseEnCurso = fases.find((f) => f.jugados < f.total) || fases.at(-1);
  const faseAnteriorUrl = rondaId || (seccionInicial === 'cuadro' ? eliminatoria[0]?.id : null);
  const faseElegida = fases.find((f) => f.hash === location.hash.slice(1))
    || (!location.hash && fases.find((f) => f.key === faseAnteriorUrl)) || faseEnCurso;
  const activa = faseElegida?.key;
  const hashElegido = faseElegida?.hash;
  const fasePrevia = useRef(activa);

  // El hash es navegación de presentación: conserva la categoría, la búsqueda y el historial.
  useEffect(() => {
    if (hashElegido && location.hash !== `#${hashElegido}`) {
      navigate({ pathname: location.pathname, search: location.search, hash: `#${hashElegido}` },
        { replace: true, state: location.state, preventScrollReset: true });
    }
  }, [hashElegido, location.hash, location.pathname, location.search, location.state, navigate]);

  // La navegación entre fases alinea su contenido; evitamos que atrás restaure otro scroll.
  useLayoutEffect(() => {
    const anterior = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = anterior; };
  }, []);

  useLayoutEffect(() => {
    const recorrido = recorridoRef.current;
    if (!recorrido) return;
    const medir = () => recorrido.parentElement.style.setProperty('--pv-fases-alto', `${recorrido.getBoundingClientRect().height}px`);
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(recorrido);
    return () => observer.disconnect();
  }, [e.preparacion]);

  useLayoutEffect(() => {
    if (fasePrevia.current === activa) return;
    fasePrevia.current = activa;
    const recorrido = recorridoRef.current;
    if (!recorrido) return;
    const caja = recorrido.getBoundingClientRect();
    const barra = document.querySelector('.pv-barra')?.getBoundingClientRect().bottom || 56;
    const pegado = alinearFase.current || caja.top <= barra + 1;
    alinearFase.current = false;
    const panel = document.getElementById(`${id}-panel-${activa}`);
    if (pegado && panel) {
      const separacion = parseFloat(getComputedStyle(recorrido).marginBottom) || 0;
      window.scrollBy({ top: panel.getBoundingClientRect().top - caja.bottom - separacion, behavior: 'instant' });
    } else if (caja.top < barra || caja.bottom > window.innerHeight) {
      recorrido.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }, [activa, id]);

  const cambiarFase = (key) => {
    const fase = fases.find((f) => f.key === key);
    if (!fase || fase.key === activa) return;
    const barra = document.querySelector('.pv-barra')?.getBoundingClientRect().bottom || 56;
    alinearFase.current = (recorridoRef.current?.getBoundingClientRect().top ?? Infinity) <= barra + 1;
    navigate({ pathname: location.pathname, search: location.search, hash: `#${fase.hash}` },
      { state: { ...location.state, desdeInicio: false }, preventScrollReset: true });
  };
  const c = (clase, i) => ({ className: `${clase}${animar ? ' pv-cascada' : ''}`, style: { '--i': i } });
  const tarjeta = (conDia) => (p) => (
    <TarjetaPartido partido={p} etiqueta={p.etiqueta} conDia={conDia} seguidaId={seguidaId} origenes={origenes} atrasado={sinResultado(p, ahora)} />
  );

  // ─── Encabezado ───
  const encabezado = (
    <div className="pv-envolver pv-cat-cab">
      <p {...c('pv-club', 0)}>{torneoNombre}</p>
      <h1 {...c('', 0)}>{cat.nombre}</h1>
      {!e.preparacion && (
        <>
          <p {...c('pv-cab-estado', 1)}>
            {e.terminada && <span className="pv-fase terminada">Terminada</span>}
            <span><b className="num">{e.jugados}</b> de {e.total} partidos jugados</span>
            {e.vivos > 0 && (
              <span className="pv-en-vivo">
                <span className="pv-punto-vivo" aria-hidden="true" />
                {e.vivos} en juego
              </span>
            )}
          </p>
        </>
      )}
      {actualizacion}
      {e.podio && (
        <section {...c('pv-podio', 2)} aria-labelledby="t-campeones">
          <h2 id="t-campeones" className="pv-sr">Campeones</h2>
          <div className="pv-podio-campeon">
            <span className="pv-trofeo"><Trophy size={24} aria-hidden="true" /></span>
            <div>
              <span>Campeones de {cat.nombre}</span>
              <b translate="no">{e.podio.campeones}</b>
            </div>
          </div>
          {e.podio.subcampeones && (
            <div className="pv-podio-sub">
              <span>Subcampeones</span>
              <b translate="no">{e.podio.subcampeones}</b>
            </div>
          )}
        </section>
      )}
    </div>
  );

  const vivos = partidos.filter((p) => p.estado === 'EN_CURSO').sort(porHorario);
  const proximos = partidos.filter((p) => p.estado === 'PENDIENTE' && p.fechaHora).sort(porHorario).slice(0, MAX_PROXIMOS);
  const enJuego = [...vivos, ...proximos];

  const { jornadas, sinHora } = agruparPartidosPorJornada(partidos.filter((p) => p.zonaId), dias);
  const jornadasOrdenadas = torneoEstado === 'EN_CURSO' && hoy?.momento === 'durante'
    ? [...jornadas].sort((a, b) => Number(b.dia.key === hoy.key) - Number(a.dia.key === hoy.key)) : jornadas;
  const vistaPartidosZona = (
    <div className="pv-jornadas">
      {jornadasOrdenadas.map(({ dia, partidos: ps }) => (
        <section key={dia.key} className="pv-fase-jornada" aria-label={nombreJornada(dia)}>
          <h3 className="pv-titulo-dia">{nombreJornada(dia)} <small>{ps.length} {ps.length === 1 ? 'partido' : 'partidos'}</small></h3>
          <ListaAnimada items={ps} clave={claveTarjeta} className="pv-lista grilla" render={tarjeta(false)} />
        </section>
      ))}
      {sinHora.length > 0 && <section className="pv-fase-jornada" aria-label="Sin horario">
        <h3 className="pv-titulo-dia">Sin horario</h3>
        <ListaAnimada items={sinHora} clave={claveTarjeta} className="pv-lista grilla" render={tarjeta(false)} />
      </section>}
      {!jornadas.length && !sinHora.length && <p className="pv-vacio">Todavía no hay partidos de zona.</p>}
    </div>
  );

  const vistaZonas = (
    <>
      <h2 className="pv-fase-titulo">Zonas <small>
        {zonas.length} {zonas.length === 1 ? 'zona' : 'zonas'}{cat.totalParejas ? `, ${cat.totalParejas} parejas` : ''}
        {clasificacionUniforme && <>{' · '}<span className="pv-clasif-ref"><i aria-hidden="true" />clasifican {zonas[0].clasifican} por zona</span></>}
      </small></h2>
      <Segmentado items={[{ key: 'posiciones', label: 'Posiciones' }, { key: 'partidos', label: 'Partidos' }]}
        activo={vistaZona} onCambiar={setVistaZona} etiqueta="Vista de zonas" idBase={`${id}-zonas`} />
      {['posiciones', 'partidos'].map((vista, i) => (
        <div key={vista} id={`${id}-zonas-panel-${vista}`} role="tabpanel" aria-labelledby={`${id}-zonas-tab-${vista}`}
          hidden={vistaZona !== i} tabIndex={0} className="pv-zonas-panel">
          {vistaZona === i && (i === 0 ? (
            <div className="pv-zonas">{zonas.map((z) => <TablaZona key={z.id} zona={z} seguidaId={seguidaId} mostrarClasifican={!clasificacionUniforme} />)}</div>
          ) : vistaPartidosZona)}
        </div>
      ))}
    </>
  );

  const fase = eliminatoria.find((f) => f.id === activa);
  const siguiente = eliminatoria[eliminatoria.findIndex((f) => f.id === activa) + 1];
  const reales = [...(fase?.partidos || [])].filter((p) => !p.esBye).sort(porHoraAsignada);
  const byes = (fase?.partidos || []).filter((p) => p.esBye);
  const vistaCuadro = fase && (isMobile ? (
    <>
      <h2 className="pv-fase-titulo">{fraseFase(fase.nombre)} <small>{reales.length} {reales.length === 1 ? 'partido' : 'partidos'}</small></h2>
      {reales.length ? <ListaAnimada items={reales} clave={claveTarjeta} render={tarjeta(true)} />
        : <p className="pv-vacio">Sin partidos en esta ronda.</p>}
      {byes.length > 0 && <div className="pv-directo">
        <p>Pasan directo a {siguiente ? fraseFase(siguiente.nombre).toLowerCase() : 'la ronda siguiente'}:</p>
        <div className="pv-chips">{byes.map((p) => {
          const lado = ladoDe(p, p.pareja2 && !p.pareja1 ? 2 : 1, origenes);
          return <span key={p.id} className={`pv-chip${seguidaId && lado.parejaId === seguidaId ? ' seguida' : ''}`} translate="no">
            {lado.nombre}{lado.origen && <small>{lado.origen}</small>}
          </span>;
        })}</div>
      </div>}
    </>
  ) : <LlaveEscritorio fases={eliminatoria} seguidaId={seguidaId} origenes={origenes} faseActivaId={activa} />);

  return (
    <div>
      {encabezado}
      <div className="pv-envolver pv-cat-cuerpo">
        <section className="pv-seccion pv-proximos" aria-labelledby="t-en-juego">
          <h2 id="t-en-juego">En juego y próximos</h2>
          {enJuego.length ? <ListaAnimada items={enJuego} clave={claveTarjeta} className="pv-lista grilla" render={(p) => (
            <TarjetaPartido partido={p} etiqueta={p.etiqueta} conDia seguidaId={seguidaId} origenes={origenes} atrasado={false} />
          )} /> : <p className="pv-vacio">No hay partidos en juego ni próximos.</p>}
        </section>
        {e.preparacion ? (
          <div className="pv-preparacion">
            <Users size={36} aria-hidden="true" />
            <h2>En preparación</h2>
            <p>El organizador está cargando las parejas y armando las zonas. El fixture aparece acá cuando arranque.</p>
          </div>
        ) : (
          <>
            <div className="pv-fases-navegacion" ref={recorridoRef}>
              <Recorrido categoria={cat} activa={activa} onCambiar={cambiarFase} idBase={id} />
            </div>
            {fases.map((f) => (
              <section key={f.key} id={`${id}-panel-${f.key}`} role="tabpanel" aria-labelledby={`${id}-tab-${f.key}`}
                hidden={activa !== f.key} tabIndex={0} className="pv-fase-panel">
                {activa === f.key && <div key={f.key} className="pv-fase-contenido">{f.key === 'zonas' ? vistaZonas : vistaCuadro}</div>}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
