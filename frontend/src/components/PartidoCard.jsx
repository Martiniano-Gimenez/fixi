export default function PartidoCard({ partido, onClick }) {
  const isFinalizado = partido.estado === 'FINALIZADO';
  
  // Formatear sets: ej "6-4, 4-6, 7-6"
  const renderSets = () => {
    if (!isFinalizado || !partido.sets || partido.sets.length === 0) return 'vs';
    return partido.sets.map(s => `${s.gamesPareja1}-${s.gamesPareja2}`).join(' | ');
  };

  const getParejaName = (parejaId, parejaObj, isGanador) => {
    if (!parejaId || !parejaObj) return 'Por definirse';
    const name = `${parejaObj.jugador1} / ${parejaObj.jugador2}`;
    return isGanador ? <strong style={{ color: 'var(--color-primary)' }}>{name}</strong> : name;
  };

  const p1Name = getParejaName(partido.pareja1Id, partido.pareja1, isFinalizado && partido.ganadorId === partido.pareja1Id);
  const p2Name = getParejaName(partido.pareja2Id, partido.pareja2, isFinalizado && partido.ganadorId === partido.pareja2Id);

  return (
    <div 
      onClick={onClick}
      style={{
        background: 'var(--color-bg-input)',
        border: `1px solid ${isFinalizado ? 'var(--color-primary)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)',
        padding: '0.75rem 1rem',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
        transition: 'border-color var(--transition-fast)',
        minWidth: '200px'
      }}
    >
      <div style={{ fontSize: 'var(--font-size-sm)', textAlign: 'center', width: '100%' }}>
        {p1Name}
      </div>
      <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'bold', color: 'var(--color-text-secondary)' }}>
        {renderSets()}
      </div>
      <div style={{ fontSize: 'var(--font-size-sm)', textAlign: 'center', width: '100%' }}>
        {p2Name}
      </div>
    </div>
  );
}
