/**
 * Normaliza texto para búsqueda: minúsculas, sin acentos (NFD) ni caracteres diacríticos, trimmed.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}
