import { Edit2, Play, Plus, Clock, Trophy } from 'lucide-react';
import DateTimeInput from './DateTimeInput';

export default function PartidoCard({ partido, onClick, onCargarResultado, onUpdateFechaHora }) {
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
        return <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>BYE</span>;
      }
      if (origenPareja) {
        return (
          <span style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic', fontWeight: 600 }}>
            {origenPareja}
          </span>
        );
      }
      return (
        <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Por definirse
        </span>
      );
    }
    const name = `${parejaObj.jugador1} / ${parejaObj.jugador2}`;
    return isGanador ? (
      <span
        style={{
          color: 'var(--color-primary)',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.3rem',
        }}
      >
        <Trophy size={14} style={{ color: 'var(--color-primary)' }} /> {name}
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
      style={{
        background: 'var(--color-bg-card)',
        border: `1px solid ${
          isFinalizado
            ? 'var(--color-primary)'
            : isEnCurso
            ? 'var(--color-success)'
            : 'var(--color-border)'
        }`,
        borderRadius: 'var(--radius-md)',
        padding: '0.85rem 1rem',
        cursor: handleClick ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        position: 'relative',
        transition: 'all 0.2s ease',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        animation: isEnCurso ? 'pulse-border 2s infinite' : 'none',
      }}
      onMouseEnter={(e) => {
        if (handleClick) {
          e.currentTarget.style.borderColor = 'var(--color-primary)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }
      }}
      onMouseLeave={(e) => {
        if (handleClick) {
          e.currentTarget.style.borderColor = isFinalizado
            ? 'var(--color-primary)'
            : isEnCurso
            ? 'var(--color-success)'
            : 'var(--color-border)';
          e.currentTarget.style.transform = 'none';
        }
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          paddingBottom: '0.4rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '10px',
              textTransform: 'uppercase',
              color: isEnCurso ? 'var(--color-bg)' : 'var(--color-text-secondary)',
              background: isEnCurso ? 'var(--color-success)' : 'transparent',
              padding: isEnCurso ? '0.1rem 0.4rem' : '0',
              borderRadius: '4px',
              letterSpacing: '0.5px',
              fontWeight: 700,
            }}
          >
            {isFinalizado ? 'Finalizado' : isEnCurso ? 'En juego' : isJugable ? 'Pendiente' : 'Esperando'}
          </span>

          {onUpdateFechaHora ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
              <DateTimeInput
                value={
                  partido.fechaHora
                    ? new Date(new Date(partido.fechaHora).getTime() - new Date().getTimezoneOffset() * 60000)
                        .toISOString()
                        .slice(0, 16)
                    : ''
                }
                onUpdate={(val) => onUpdateFechaHora(partido.id, val)}
                title="Establecer horario"
                style={{
                  fontSize: '9px',
                  padding: '2px 4px',
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  borderRadius: '4px',
                }}
              />
              {partido.canchaNumero ? (
                <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                  C{partido.canchaNumero}
                </span>
              ) : null}
            </div>
          ) : partido.fechaHora ? (
            <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', fontWeight: 'bold' }}>
              {new Date(partido.fechaHora).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
              {partido.canchaNumero ? (
                <span style={{ marginLeft: '4px', color: 'var(--color-text-secondary)' }}>
                  · Cancha {partido.canchaNumero}
                </span>
              ) : null}
            </span>
          ) : null}

          {partido.sinHorarioAsignado && (
            <span
              style={{
                fontSize: '9px',
                color: 'var(--color-warning)',
                fontWeight: 'bold',
                background: 'rgba(234,179,8,0.1)',
                padding: '1px 5px',
                borderRadius: '4px',
              }}
            >
              ⚠️ Sin horario
            </span>
          )}
        </div>

        {handleClick ? (
          <button
            type="button"
            className="btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              handleClick();
            }}
            style={{
              padding: '0.2rem 0.55rem',
              fontSize: '11px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              width: 'auto',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {isFinalizado ? (
              <>
                <Edit2 size={11} /> Editar
              </>
            ) : isEnCurso ? (
              <>
                <Plus size={11} /> Cargar Set
              </>
            ) : (
              <>
                <Play size={11} /> Cargar Resultado
              </>
            )}
          </button>
        ) : !isJugable ? (
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            Esperando cruces
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div style={{ fontSize: 'var(--font-size-sm)', textAlign: 'center' }}>{p1Name}</div>

        {hasScore ? (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', margin: '0.2rem 0' }}>
            {partido.sets.map((s, idx) => {
              const p1Won = s.gamesPareja1 > s.gamesPareja2;
              const p2Won = s.gamesPareja2 > s.gamesPareja1;
              return (
                <span
                  key={idx}
                  style={{
                    background: 'var(--color-bg-input)',
                    border: '1px solid var(--color-border)',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: 'var(--font-size-xs)',
                    color: 'white',
                  }}
                >
                  <span
                    style={{
                      fontWeight: p1Won ? 'bold' : 'normal',
                      color: p1Won ? 'var(--color-primary)' : 'inherit',
                    }}
                  >
                    {s.gamesPareja1}
                  </span>
                  {' - '}
                  <span
                    style={{
                      fontWeight: p2Won ? 'bold' : 'normal',
                      color: p2Won ? 'var(--color-primary)' : 'inherit',
                    }}
                  >
                    {s.gamesPareja2}
                  </span>
                </span>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'bold',
              color: 'var(--color-text-secondary)',
              textAlign: 'center',
              margin: '0.2rem 0',
            }}
          >
            vs
          </div>
        )}

        <div style={{ fontSize: 'var(--font-size-sm)', textAlign: 'center' }}>{p2Name}</div>
      </div>
    </div>
  );
}
