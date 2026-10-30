import { Edit2, Play, Plus, Clock, Trophy, AlertTriangle } from 'lucide-react';
import { formatDiaHorario } from '../utils/dateUtils';
import { sinResultado } from '../pages/public/publico/utilidades';

export default function PartidoCard({ partido, onClick, onCargarResultado, onReprogramar }) {
  if (!partido) return null;

  const isFinalizado = partido.estado === 'FINALIZADO';
  const isEnCurso = partido.estado === 'EN_CURSO';
  const hasScore = partido.sets && partido.sets.length > 0;
  const isJugable = Boolean(partido.pareja1Id && partido.pareja2Id);

  const handleClick = isJugable
    ? (onClick || (onCargarResultado ? () => onCargarResultado(partido) : null))
    : null;

  const getParejaName = (parejaId, parejaObj, isGanador, origenPareja) => {
    if (!parejaId || !parejaObj) {
      if (isFinalizado) {
        return <span className="cd-placeholder">BYE</span>;
      }
      if (origenPareja) {
        return (
          <span className="cd-placeholder">
            {origenPareja}
          </span>
        );
      }
      return (
        <span className="cd-placeholder">
          Por definirse
        </span>
      );
    }
    const name = `${parejaObj.jugador1} / ${parejaObj.jugador2}`;
    return isGanador ? (
      <span
        className="cd-match-winner"
      >
        <Trophy size={14} className="cd-trophy" /> {name}
      </span>
    ) : (
      name
    );
  };

  const p1Name = getParejaName(
    partido.pareja1Id,
    partido.pareja1,
    isFinalizado && partido.ganadorId === partido.pareja1Id,
    partido.origenPareja1
  );
  const p2Name = getParejaName(
    partido.pareja2Id,
    partido.pareja2,
    isFinalizado && partido.ganadorId === partido.pareja2Id,
    partido.origenPareja2
  );

  return (
    <div
      onClick={handleClick}
      className={`cd-match-card${handleClick ? ' is-clickable' : ''}`}
    >
      <div className={`cd-match-header ${handleClick || (partido.estado === 'PENDIENTE' && onReprogramar) ? 'has-actions' : ''}`}>
        <div className="cd-match-info">
          <span
            className={`cd-match-status${isEnCurso ? ' is-live' : ''}`}
          >
            {isFinalizado ? 'Finalizado' : isEnCurso ? 'En juego' : isJugable ? 'Pendiente' : 'Esperando'}
          </span>

          {partido.fechaHora ? (
            <span
              className="cd-match-time"
            >
              <Clock size={12} className="cd-brand-icon" />
              {formatDiaHorario(partido.fechaHora)}
            </span>
          ) : null}

          {(!partido.fechaHora || partido.sinHorarioAsignado) && (
            <span
              className="cd-match-alert"
            >
              <AlertTriangle size={10} /> Sin horario
            </span>
          )}
          {partido.canchaNumero && <span className="cd-match-court">Cancha {partido.canchaNumero}</span>}
        </div>

        {handleClick || (partido.estado === 'PENDIENTE' && onReprogramar) ? (
          <div className="cd-match-actions">
            {partido.estado === 'PENDIENTE' && onReprogramar && (
              <button
                type="button"

                onClick={(e) => {
                  e.stopPropagation();
                  onReprogramar(partido);
                }}
                title={partido.fechaHora ? "Reprogramar horario" : "Asignar horario"}
                className="pm-button cd-match-button"
              >
                <Clock size={11} /> {partido.fechaHora ? 'Reprogramar' : 'Asignar horario'}
              </button>
            )}
            {handleClick ? (
              <button
                type="button"

                onClick={(e) => {
                  e.stopPropagation();
                  handleClick();
                }}
                className="pm-button cd-match-button"
              >
                {isFinalizado ? (
                  <>
                    <Edit2 size={11} /> Editar
                  </>
                ) : isEnCurso ? (
                  <>
                    <Plus size={11} /> Cargar set
                  </>
                ) : (
                  <>
                    <Play size={11} /> Cargar resultado
                  </>
                )}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="cd-match-pairs">
        <div className={`cd-match-name${isFinalizado && partido.ganadorId !== partido.pareja1Id ? ' is-loser' : ''}`}>{p1Name}</div>
        <div className={`cd-match-name${isFinalizado && partido.ganadorId !== partido.pareja2Id ? ' is-loser' : ''}`}>{p2Name}</div>

        {hasScore ? (
          <div className="cd-match-sets">
            {partido.sets.map((s, idx) => {
              const p1Won = s.gamesPareja1 > s.gamesPareja2;
              const p2Won = s.gamesPareja2 > s.gamesPareja1;
              return (
                <span
                  key={idx}
                  className="cd-set-score"
                >
                  <span
                    className={`cd-game${p1Won ? ' is-winner' : ''}`}
                  >
                    {s.gamesPareja1}
                  </span>
                  {' - '}
                  <span
                    className={`cd-game${p2Won ? ' is-winner' : ''}`}
                  >
                    {s.gamesPareja2}
                  </span>
                </span>
              );
            })}
          </div>
        ) : sinResultado(partido) ? (
          <div
            className="cd-no-score"
          >
            Sin resultado cargado
          </div>
        ) : (
          <div className="cd-placeholder">vs</div>
        )}

      </div>
    </div>
  );
}
