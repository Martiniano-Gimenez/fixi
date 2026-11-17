const MAX_NOMBRE = 60;

function normalizarEspacios(valor) {
  return valor.replace(/\s+/g, ' ').trim();
}

function validarNombre(valor, etiqueta, maximo) {
  const rechazar = (mensaje) => { throw Object.assign(new Error(mensaje), { statusCode: 400 }); };
  if (valor === undefined || valor === null) rechazar(`El nombre ${etiqueta} es obligatorio.`);
  if (typeof valor !== 'string') rechazar(`El nombre ${etiqueta} debe ser un texto.`);
  const nombre = normalizarEspacios(valor);
  if (!nombre) rechazar(`El nombre ${etiqueta} es obligatorio.`);
  if (nombre.length > maximo) rechazar(`El nombre ${etiqueta} puede tener hasta ${maximo} caracteres.`);
  return nombre;
}

function claveNombre(nombre) {
  return normalizarEspacios(nombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

module.exports = { MAX_NOMBRE, validarNombre, claveNombre };
