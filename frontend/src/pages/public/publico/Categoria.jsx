import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, Trophy, Users } from 'lucide-react';
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
const MAX_TARJETAS_ESCRITORIO = 4;
const consultaCelular = '(max-width: 767px)';
const esPantallaCelular = () => window.matchMedia(consultaCelular).matches;
const suscribirCelular = (onCambio) => {
  const media = window.matchMedia(consultaCelular);
  media.addEventListener('change', onCambio);
  return () => media.removeEventListener('change', onCambio);
};
const HASH_RONDA = { 32: 'dieciseisavos', 16: 'octavos', 8: 'cuartos', 4: 'semi', 2: 'final', 1: 'final' };
const porHoraAsignada = (a, b) => a.fechaHora && b.fechaHora ? porHorario(a, b)
  : a.fechaHora ? -1 : b.fechaHora ? 1 : (a.posicionEnRonda || 0) - (b.posicionEnRonda || 0);

function JornadaZona({ nombre, cantidad, abiertaInicial, children }) {
  const id = useId();
  const [abierta, setAbierta] = useState(abiertaInicial);
  return (
    <section className="pv-fase-jornada" aria-label={nombre}>
      <h3 className="pv-titulo-dia pv-jornada-titulo">
        <button type="button" className="pv-jornada-toggle" aria-expanded={abierta} aria-controls={`${id}-partidos`}
          onClick={() => setAbierta((valor) => !valor)}>
          <span>{nombre} <small>· {cantidad} {cantidad === 1 ? 'partido' : 'partidos'}</small></span>
          <ChevronDown size={20} aria-hidden="true" />
        </button>
      </h3>
      <div id={`${id}-partidos`} className="pv-jornada-contenido" hidden={!abierta}>{children}</div>
    </section>
  );
}

export default function Categoria({ categoria: cat, seguidaId, isMobile, rondaId, animar, actualizacion, seccionInicial, torneoEstado, torneoNombre }) {
  const id = useId();
  const esCelular = useSyncExternalStore(suscribirCelular, esPantallaCelular, () => false);
  const location = useLocation();
  const navigate = useNavigate();
  const recorridoRef = useRef(null);
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

  // Conservamos el scroll al navegar entre fases, también al usar atrás.
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
    if (caja.top < barra - 1 || caja.bottom > window.innerHeight + 1) {
      recorrido.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }, [activa]);

  const cambiarFase = (key) => {
    const fase = fases.find((f) => f.key === key);
    if (!fase || fase.key === activa) return;
    navigate({ pathname: location.pathname, search: location.search, hash: `#${fase.hash}` },
      { state: { ...location.state, desdeInicio: false }, preventScrollReset: true });
  };
  const c = (clase, i) => ({ className: `${clase}${animar ? ' pv-cascada' : ''}`, style: { '--i': i } });
  const abrirPareja = (pareja, boton) => {
    const params = new URLSearchParams(location.search);
    params.set('buscar', pareja.nombre);
    navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, {
      state: { ...location.state, busquedaDesdeApp: true,
        parejaBusqueda: { ...pareja, categoriaId: cat.id, focoOrigen: boton.id } },
      preventScrollReset: true,
    });
  };
  const tarjeta = (conDia) => (p) => (
    <TarjetaPartido partido={p} etiqueta={p.etiqueta} conDia={conDia} seguidaId={seguidaId} origenes={origenes} atrasado={sinResultado(p, ahora)} onAbrirPareja={abrirPareja} />
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
  const cupoProximos = esCelular ? 2 : Math.max(0, MAX_TARJETAS_ESCRITORIO - vivos.length);
  const proximos = partidos.filter((p) => p.estado === 'PENDIENTE' && p.fechaHora).sort(porHorario).slice(0, cupoProximos);
  const enJuego = [...vivos, ...proximos];

  const { jornadas, sinHora } = agruparPartidosPorJornada(partidos.filter((p) => p.zonaId), dias);
  const jornadasOrdenadas = torneoEstado === 'EN_CURSO' && hoy?.momento === 'durante'
    ? [...jornadas].sort((a, b) => Number(b.dia.key === hoy.key) - Number(a.dia.key === hoy.key)) : jornadas;
  const gruposZona = jornadasOrdenadas.map(({ dia, partidos }) => ({ key: dia.key, nombre: nombreJornada(dia), partidos }));
  if (sinHora.length) gruposZona.push({ key: 'sin-horario', nombre: 'Sin horario', partidos: sinHora });
  const jornadaInicial = (torneoEstado === 'EN_CURSO' && hoy?.momento === 'durante'
    && gruposZona.find((grupo) => grupo.key === hoy.key))
    || gruposZona.find((grupo) => grupo.partidos.some((p) => p.estado === 'PENDIENTE')) || gruposZona.at(-1);
  const vistaPartidosZona = (
    <div className="pv-jornadas">
      {gruposZona.map((grupo) => (
        <JornadaZona key={grupo.key} nombre={grupo.nombre} cantidad={grupo.partidos.length} abiertaInicial={grupo.key === jornadaInicial?.key}>
          <ListaAnimada items={grupo.partidos} clave={claveTarjeta} className="pv-lista grilla" render={tarjeta(false)} />
        </JornadaZona>
      ))}
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
            <div className="pv-zonas">{zonas.map((z) => <TablaZona key={z.id} zona={z} seguidaId={seguidaId} mostrarClasifican={!clasificacionUniforme} onAbrirPareja={abrirPareja} />)}</div>
          ) : vistaPartidosZona)}
        </div>
      ))}
    </>
  );

  const fase = eliminatoria.find((f) => f.id === activa);
  const fasesVisibles = useMemo(() => {
    const rondas = cat.eliminatoria || [];
    const indice = rondas.findIndex((f) => f.id === activa);
    const desde = Math.max(0, indice - (rondas[indice]?.ronda <= 2 ? 1 : 0));
    return rondas.slice(desde);
  }, [cat.eliminatoria, activa]);
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
  ) : <LlaveEscritorio fases={fasesVisibles} seguidaId={seguidaId} origenes={origenes} />);

  return (
    <div>
      {encabezado}
      <div className="pv-envolver pv-cat-cuerpo">
        {enJuego.length > 0 && <section className="pv-seccion pv-proximos" aria-labelledby="t-en-juego">
          <h2 id="t-en-juego">En juego y próximos</h2>
          <ListaAnimada items={enJuego} clave={claveTarjeta} className="pv-lista grilla" render={(p) => (
            <TarjetaPartido partido={p} etiqueta={p.etiqueta} conDia seguidaId={seguidaId} origenes={origenes} atrasado={false} onAbrirPareja={abrirPareja} />
          )} />
        </section>}
        {e.preparacion ? (
          <div className="pv-preparacion">
            <Users size={36} aria-hidden="true" />
            <h2>En preparación</h2>
            <p>{torneoEstado === 'BORRADOR'
              ? 'La lista de parejas y los partidos se publican cuando empiece el torneo.'
              : 'El organizador está cargando las parejas y armando las zonas. El fixture aparece acá cuando arranque.'}</p>
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
