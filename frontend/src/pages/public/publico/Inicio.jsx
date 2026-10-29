import { ChevronRight, Trophy } from 'lucide-react';
import { formatFechaTorneo } from '../../../utils/dateUtils';
import { Cancha } from './Barra';
import Recorrido from './Recorrido';
import { Estrella } from './TarjetaPartido';
import { DIAS_LARGOS, clasificadosPorOrigen, estadoDe, horaPartido, ladoDe, partidosDeCategoria, porHorario } from './utilidades';

// Próximo partido de una pareja seguida, en una frase ("próximo partido el domingo a las 10:30")
function fraseProximo(cat, parejaId, ahora) {
  const origenes = clasificadosPorOrigen(cat);
  const suyos = partidosDeCategoria(cat).filter(
    (p) => p.estado !== 'FINALIZADO' && [1, 2].some((l) => ladoDe(p, l, origenes).parejaId === parejaId)
  );
  if (suyos.some((p) => p.estado === 'EN_CURSO')) return 'jugando ahora';
  const conHora = suyos.filter((p) => p.fechaHora).sort(porHorario);
  const prox = conHora.find((p) => new Date(p.fechaHora).getTime() >= ahora) || conHora[0];
  if (prox) {
    const dia = DIAS_LARGOS[horaPartido(prox.fechaHora).slice(0, 3)];
    return <>próximo partido {dia ? `el ${dia} ` : ''}a las <b className="num">{horaPartido(prox.fechaHora, false)}</b></>;
  }
  return suyos.length ? 'próximo partido sin horario todavía' : 'sin partidos pendientes';
}

export default function Inicio({ torneo, categorias, fechas, seguidas, hrefCategoria, onAbrirCategoria, animar, actualizacion }) {
  const ahora = Date.now();
  const c = (clase, i) => ({ className: `${clase}${animar ? ' pv-cascada' : ''}`, style: { '--i': i } });

  return (
    <>
      <section className="pv-cabecera">
        <Cancha />
        <div className="pv-envolver">
          {torneo.organizador && <p {...c('pv-club', 0)}>{torneo.organizador}</p>}
          <h1 {...c('', 1)}>{torneo.nombre}</h1>
          {(fechas || torneo.fecha) && <p {...c('pv-fechas', 1)}>{fechas || formatFechaTorneo(torneo.fecha)}</p>}
          {actualizacion}
        </div>
      </section>

      <div className="pv-envolver pv-inicio">
        {seguidas.map((s) => (
          <div key={s.cat.id} {...c('pv-seguida', 3)}>
            <Estrella decorativa />
            <span>
              <b translate="no">{s.nombre}</b>: {fraseProximo(s.cat, s.parejaId, ahora)}
            </span>
            <a href={hrefCategoria(s.cat)} onClick={(e) => onAbrirCategoria(s.cat, e)} aria-label={`Ver ${s.cat.nombre}`}>
              Ver
            </a>
          </div>
        ))}

        {categorias.length === 0 ? (
          <p className="pv-vacio">Todavía no hay categorías cargadas en este torneo.</p>
        ) : (
          <div className="pv-cats">
            {categorias.map((cat, i) => {
              const e = estadoDe(cat, ahora);
              return (
                <a key={cat.id} href={hrefCategoria(cat)} onClick={(ev) => onAbrirCategoria(cat, ev)} {...c('pv-cat', 4 + i)}>
                  <div className="pv-cat-arriba">
                    <h2>{cat.nombre}</h2>
                    {e.terminada && <span className="pv-fase terminada">Terminada</span>}
                    <ChevronRight size={20} className="pv-cat-flecha" aria-hidden="true" />
                  </div>
                  {e.preparacion ? (
                    <p className="pv-recorrido-texto">En preparación: las zonas se arman cuando arranque el torneo.</p>
                  ) : (
                    <>
                      <Recorrido categoria={cat} />
                      {e.podio ? (
                        <div className="pv-campeon-linea">
                          <Trophy size={18} className="pv-trofeo-ico" aria-hidden="true" />
                          <span>Campeones: <b translate="no">{e.podio.campeones}</b></span>
                        </div>
                      ) : (
                        <p className="pv-recorrido-texto">
                          <b className="num">{e.jugados}</b> de {e.total} partidos jugados
                        </p>
                      )}
                      {!e.terminada && (
                        <div className="pv-cat-abajo">
                          {e.vivos > 0 && (
                            <span className="pv-en-vivo">
                              <span className="pv-punto-vivo" aria-hidden="true" />
                              {e.vivos} en juego
                            </span>
                          )}
                          {e.proximo ? (
                            <span>Próximo: <b className="num">{horaPartido(e.proximo.fechaHora).toLowerCase()}</b></span>
                          ) : (
                            <span>Sin partidos programados</span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
