const faseEliminatoriaService = require('../services/faseEliminatoria.service');
const { asignarHorariosRondaUno } = require('../services/eliminatoriaScheduler.service');
const { getCategoriaById } = require('../services/categoria.service');
const { programarCuadroConDieciseisavos } = require('../services/partido.service');

function getOrgId(req) {
  return req.organizadorId || req.organizador?.id;
}

async function generarEliminatoria(req, res, next) {
  try {
    const categoriaId = req.params.categoriaId || req.params.id;
    const organizadorId = getOrgId(req);

    const categoria = await getCategoriaById(organizadorId, categoriaId);
    const torneoId = categoria.torneoId;

    const resultado = await faseEliminatoriaService.generarEliminatoria(
      organizadorId,
      categoriaId
    );

    let schedulingResult = null;
    if (resultado.esDieciseisavos) {
      schedulingResult = await programarCuadroConDieciseisavos(organizadorId, categoriaId, torneoId);
    } else {
      schedulingResult = await asignarHorariosRondaUno(organizadorId, torneoId, categoriaId);
    }

    res.status(201).json({
      ...resultado,
      schedulingResult,
    });
  } catch (error) {
    next(error);
  }
}

async function getFasesEliminatorias(req, res, next) {
  try {
    const categoriaId = req.params.categoriaId || req.params.id;
    const organizadorId = getOrgId(req);

    const fases = await faseEliminatoriaService.getFasesEliminatorias(
      organizadorId,
      categoriaId
    );

    res.status(200).json(fases);
  } catch (error) {
    next(error);
  }
}

async function deleteFasesEliminatorias(req, res, next) {
  try {
    const categoriaId = req.params.categoriaId || req.params.id;
    const organizadorId = getOrgId(req);

    const resultado = await faseEliminatoriaService.borrarEliminatoria(
      organizadorId,
      categoriaId
    );

    res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
}

async function getEstadoCuadro(req, res, next) {
  try {
    const categoriaId = req.params.categoriaId || req.params.id;
    const organizadorId = getOrgId(req);

    await getCategoriaById(organizadorId, categoriaId);
    const estado = await faseEliminatoriaService.estadoCuadro(categoriaId);

    res.status(200).json(estado);
  } catch (error) {
    next(error);
  }
}

async function sincronizarCuadro(req, res, next) {
  try {
    const categoriaId = req.params.categoriaId || req.params.id;
    const organizadorId = getOrgId(req);
    const simular = req.query.simular === 'true' || req.body?.simular === true;

    const resultado = await faseEliminatoriaService.sincronizarCuadro(
      organizadorId,
      categoriaId,
      { simular }
    );

    res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  generarEliminatoria,
  getFasesEliminatorias,
  deleteFasesEliminatorias,
  getEstadoCuadro,
  sincronizarCuadro,
};
