export const ESTADO_TORNEO_LABELS = {
  BORRADOR: 'Borrador',
  EN_CURSO: 'En curso',
  FINALIZADO: 'Finalizado',
};

export const ESTADO_CATEGORIA_LABELS = ESTADO_TORNEO_LABELS;

export const ESTADO_PARTIDO_LABELS = {
  PENDIENTE: 'Pendiente',
  EN_CURSO: 'En curso',
  FINALIZADO: 'Finalizado',
};

export function estadoLabel(estado) {
  if (!estado) return '';
  return ESTADO_TORNEO_LABELS[estado] ?? ESTADO_PARTIDO_LABELS[estado] ?? estado;
}
