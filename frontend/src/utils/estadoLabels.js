const ESTADO_TORNEO_LABELS = {
  BORRADOR: 'Borrador',
  EN_CURSO: 'En curso',
  FINALIZADO: 'Finalizado',
};

const ESTADO_PARTIDO_LABELS = {
  PENDIENTE: 'Pendiente',
  EN_CURSO: 'En curso',
  FINALIZADO: 'Finalizado',
};

export function estadoLabel(estado) {
  if (!estado) return '';
  const upper = String(estado).toUpperCase();
  return ESTADO_TORNEO_LABELS[upper] ?? ESTADO_PARTIDO_LABELS[upper] ?? estado;
}
