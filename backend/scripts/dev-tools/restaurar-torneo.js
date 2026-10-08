'use strict';

/**
 * restaurar-torneo.js
 * 
 * DESHABILITADO POR SEGURIDAD:
 * Este script contenía deleteMany() incondicionales sin cláusula WHERE en 10 tablas,
 * lo que producía el vaciado completo de la base de datos dev.db.
 * Por directiva de arquitectura y protección de datos, ha sido deshabilitado permanentemente.
 */

console.error('\n❌ SCRIPT DESHABILITADO POR SEGURIDAD');
console.error('restaurar-torneo.js contenía operaciones deleteMany() globales sin filtro WHERE.');
console.error('Para poblar un torneo de prueba sin comprometer dev.db:');
console.error('1. Utilice el entorno de pruebas con "npm test" (que opera de forma aislada sobre test.db).');
console.error('2. O use una herramienta de seed específica por organizadorId (--organizadorId=<id> --confirmar-dev).\n');

process.exit(1);
