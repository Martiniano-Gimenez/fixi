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
  return ESTADO_TORNEO_LABELS[estado] ?? ESTADO_PARTIDO_LABELS[estado] ?? estado;
}
