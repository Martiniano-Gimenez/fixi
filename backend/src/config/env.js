require('dotenv').config();

const requiredVars = ['DATABASE_URL', 'JWT_SECRET'];

for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`❌ Falta variable de entorno: ${varName}`);
    process.exit(1);
  }
}

// Guardián de seguridad en producción
if (process.env.NODE_ENV === 'production') {
  const DEFAULT_INSECURE_SECRETS = [
    'dev-secret-cambiar-en-produccion',
    'secret',
    'changeme',
    'default_secret',
    'jwt_secret',
  ];

  const currentSecret = (process.env.JWT_SECRET || '').trim();

  if (DEFAULT_INSECURE_SECRETS.includes(currentSecret) || currentSecret.length < 32) {
    console.error(
      '❌ ERROR CRÍTICO DE SEGURIDAD: El servidor no puede iniciar en producción con el JWT_SECRET por defecto o con longitud inferior a 32 caracteres.'
    );
    process.exit(1);
  }
}

module.exports = {
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  PORT: process.env.PORT || 3001,
};
