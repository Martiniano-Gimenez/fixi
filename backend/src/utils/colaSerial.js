/**
 * Cola serial en el proceso: corre las funciones de a una, en orden de llegada.
 *
 * Para las altas de pareja en BORRADOR (inscripción por link y alta del organizador). Medido en la
 * sesión 88 con SQLite: 10 transacciones interactivas simultáneas dejan esperando a varias en
 * BEGIN IMMEDIATE con el busy_timeout de SQLite (5 s) y la que tiene el lock no avanza; 4 de 10
 * terminaban en P1008 "Socket timeout" a los ~5,6 s. Con la cola, 15 altas en paralelo tardan
 * ~90 ms. Además, en un solo proceso las altas ya no leen el mismo max(orden); el reintento ante
 * P2002 (conReintentoOrden) queda para varias instancias contra una misma base.
 */
function crearColaSerial() {
  let ultima = Promise.resolve();
  return function encolar(fn) {
    const resultado = ultima.then(() => fn());
    ultima = resultado.catch(() => {});
    return resultado;
  };
}

const colaAltasPareja = crearColaSerial();

module.exports = { crearColaSerial, colaAltasPareja };
