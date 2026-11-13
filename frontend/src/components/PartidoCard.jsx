import { ClipboardList, Clock, AlertTriangle } from 'lucide-react';
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
        {name}
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
      <div className="cd-match-header">
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
      </div>

      <div className="cd-match-pairs">
        <div className="cd-match-pair">
          <div className={`cd-match-name${isFinalizado && partido.ganadorId !== partido.pareja1Id ? ' is-loser' : ''}`}>{p1Name}</div>
          {hasScore && (
            <div className="cd-match-games">
              {partido.sets.map((s, idx) => (
                <span
                  key={idx}
                  className={`cd-game${s.gamesPareja1 > s.gamesPareja2 ? ' is-winner' : ''}`}
                  title={`Set ${s.numero ?? idx + 1}: ${s.gamesPareja1} games`}
                >
                  {s.gamesPareja1}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="cd-match-pair">
          <div className={`cd-match-name${isFinalizado && partido.ganadorId !== partido.pareja2Id ? ' is-loser' : ''}`}>{p2Name}</div>
          {hasScore && (
            <div className="cd-match-games">
              {partido.sets.map((s, idx) => (
                <span
                  key={idx}
                  className={`cd-game${s.gamesPareja2 > s.gamesPareja1 ? ' is-winner' : ''}`}
                  title={`Set ${s.numero ?? idx + 1}: ${s.gamesPareja2} games`}
                >
                  {s.gamesPareja2}
                </span>
              ))}
            </div>
          )}
        </div>

        {!hasScore && (sinResultado(partido) ? (
          <div className="cd-no-score">Sin resultado cargado</div>
        ) : (
          <div className="cd-placeholder">vs</div>
        ))}
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
              title={partido.fechaHora ? 'Cambiar horario' : 'Asignar horario'}
              aria-label={partido.fechaHora ? 'Cambiar horario' : 'Asignar horario'}
              className="pm-button cd-match-button"
            >
              <Clock size={14} /> {partido.fechaHora ? 'Cambiar horario' : 'Asignar horario'}
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
              title={isFinalizado ? 'Editar resultado' : isEnCurso ? 'Actualizar resultado' : 'Cargar resultado'}
              aria-label={isFinalizado ? 'Editar resultado' : isEnCurso ? 'Actualizar resultado' : 'Cargar resultado'}
            >
              <ClipboardList size={14} />
              {isFinalizado ? 'Editar resultado' : isEnCurso ? 'Actualizar resultado' : 'Cargar resultado'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
