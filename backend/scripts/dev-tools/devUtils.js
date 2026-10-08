'use strict';

const path = require('path');
const fs = require('fs');

function requireConfirmarDev(scriptName) {
  const confirmed = process.argv.includes('--confirmar-dev');
  const dbUrl = process.env.DATABASE_URL || 'file:./dev.db (default)';

  if (!confirmed) {
    console.error(`\n❌ OPERACIÓN ABORTADA (${scriptName})`);
    console.error(`Este script modifica o prepara datos en el entorno de desarrollo.`);
    console.error(`Base de datos objetivo: "${dbUrl}"`);
    console.error(`Para ejecutarlo, debes pasar explícitamente el flag:`);
    console.error(`   node scripts/dev-tools/${scriptName} --confirmar-dev [opciones]\n`);
    process.exit(1);
  }
}

function crearBackupDevDb() {
  const devDbPath = path.resolve(__dirname, '../../prisma/dev.db');
  if (!fs.existsSync(devDbPath)) {
    console.warn(`⚠️ [devUtils] No se encontró dev.db en ${devDbPath} para generar backup.`);
    return null;
  }

  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const backupPath = path.resolve(__dirname, `../../prisma/dev.backup.${timestamp}.db`);

  fs.copyFileSync(devDbPath, backupPath);
  console.log(`💾 Backup automático de dev.db creado: ${path.basename(backupPath)}`);
  return backupPath;
}

module.exports = {
  requireConfirmarDev,
  crearBackupDevDb,
};
