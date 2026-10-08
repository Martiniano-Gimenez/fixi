/**
 * testServer.js
 * Inicia una instancia aislada del servidor Express en un puerto efímero (0)
 * para suites de test que prueban endpoints HTTP.
 * Garantiza que la caché de overrides esté hidratada y que las peticiones
 * operen contra la misma base de test (test.db) del proceso de prueba.
 */

const { app } = require('../../src/index');
const canchasOverridesService = require('../../src/services/canchasOverrides.service');

async function startTestServer() {
  await canchasOverridesService.loadFromDb();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, (err) => {
      if (err) return reject(err);
      const port = server.address().port;
      const baseUrl = `http://localhost:${port}/api`;
      resolve({ server, baseUrl, port });
    });
  });
}

module.exports = { startTestServer };
