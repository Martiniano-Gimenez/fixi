'use strict';

// Worker del optimizador del pre-check: corre HiGHS (WASM, monohilo y síncrono) fuera del hilo principal
// para no frenar a Express durante los ~10 s de la optimización.
const { parentPort, workerData } = require('node:worker_threads');
const loadHighs = require('highs');
const { optimizar } = require('./optimizadorPrecheck');

(async () => {
  const highs = await loadHighs();
  const resultado = await optimizar(workerData, { highs });
  parentPort.postMessage({ ok: true, resultado });
})().catch((e) => {
  parentPort.postMessage({ ok: false, error: String((e && e.stack) || e) });
});
