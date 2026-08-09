import DateTimeInput from './DateTimeInput';

export default function PartidoCard({ partido, onClick, onUpdateFechaHora }) {
  const isFinalizado = partido.estado === 'FINALIZADO';
  const isEnCurso = partido.estado === 'EN_CURSO';
  const hasScore = partido.sets && partido.sets.length > 0;

  const getParejaName = (parejaId, parejaObj, isGanador) => {
    if (!parejaId || !parejaObj) {
      return <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{isFinalizado ? 'BYE' : 'Por definirse'}</span>;
    }
    const name = `${parejaObj.jugador1} / ${parejaObj.jugador2}`;
    return isGanador ? (
      <span style={{ color: 'var(--color-primary)', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
        🏆 {name}
      </span>
    ) : name;
  };

  const p1Name = getParejaName(partido.pareja1Id, partido.pareja1, isFinalizado && partido.ganadorId === partido.pareja1Id);
  const p2Name = getParejaName(partido.pareja2Id, partido.pareja2, isFinalizado && partido.ganadorId === partido.pareja2Id);

  return (
    <div 
      onClick={onClick}
      style={{
        background: 'var(--color-bg-card)',
        border: `1px solid ${isFinalizado ? 'var(--color-primary)' : isEnCurso ? 'var(--color-success)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)',
        padding: '0.85rem 1rem',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        position: 'relative',
        transition: 'all 0.2s ease',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        animation: isEnCurso ? 'pulse-border 2s infinite' : 'none'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.35rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ 
            fontSize: '10px', 
            textTransform: 'uppercase', 
            color: isEnCurso ? 'var(--color-bg)' : 'var(--color-text-secondary)',
            background: isEnCurso ? 'var(--color-success)' : 'transparent',
            padding: isEnCurso ? '0.1rem 0.4rem' : '0',
            borderRadius: '4px',
            letterSpacing: '0.5px', 
            fontWeight: 700 
          }}>
            {isFinalizado ? 'Finalizado' : isEnCurso ? 'En juego' : 'Pendiente'}
          </span>
          {onUpdateFechaHora ? (
            <DateTimeInput
              value={partido.fechaHora ? new Date(new Date(partido.fechaHora).getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16) : ''}
              onUpdate={(val) => onUpdateFechaHora(partido.id, val)}
              title="Establecer horario"
              style={{
                fontSize: '9px',
                padding: '2px 4px',
                background: 'var(--color-bg-input)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                borderRadius: '4px'
              }}
            />
          ) : partido.fechaHora ? (
            <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', fontWeight: 'bold' }}>
              {new Date(partido.fechaHora).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
        </div>
        {onClick && (
          <button className="btn-small" style={{ fontSize: '10px' }}>
            {isFinalizado ? '✏️ Editar' : isEnCurso ? '➕ Set' : '▶️ Iniciar'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div style={{ fontSize: 'var(--font-size-sm)', textAlign: 'center' }}>
          {p1Name}
        </div>
        
        {hasScore ? (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', margin: '0.2rem 0' }}>
            {partido.sets.map((s, idx) => {
              const p1Won = s.gamesPareja1 > s.gamesPareja2;
              const p2Won = s.gamesPareja2 > s.gamesPareja1;
              return (
                <span key={idx} style={{
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border)',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: 'var(--font-size-xs)',
                  color: 'white'
                }}>
                  <span style={{ 
                    fontWeight: p1Won ? 'bold' : 'normal', 
                    color: p1Won ? 'var(--color-primary)' : 'inherit' 
                  }}>{s.gamesPareja1}</span>
                  {' - '}
                  <span style={{ 
                    fontWeight: p2Won ? 'bold' : 'normal', 
                    color: p2Won ? 'var(--color-primary)' : 'inherit' 
                  }}>{s.gamesPareja2}</span>
                </span>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'bold', color: 'var(--color-text-secondary)', textAlign: 'center', margin: '0.2rem 0' }}>
            vs
          </div>
        )}

        <div style={{ fontSize: 'var(--font-size-sm)', textAlign: 'center' }}>
          {p2Name}
        </div>
      </div>
    </div>
  );
}

