const categoriaService = require('../services/categoria.service');
const zonaService = require('../services/zona.service');

function getOrgId(req) {
  return req.organizadorId || req.organizador?.id;
}

async function createCategoria(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const { torneoId } = req.params;
    const { nombre } = req.body;

    const categoria = await categoriaService.createCategoria(organizadorId, torneoId, { nombre });
    res.status(201).json(categoria);
  } catch (err) {
    next(err);
  }
}

async function getCategorias(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const { torneoId } = req.params;

    const categorias = await categoriaService.getCategorias(organizadorId, torneoId);
    res.json(categorias);
  } catch (err) {
    next(err);
  }
}

async function getCategoriaById(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const { id } = req.params;

    const categoria = await categoriaService.getCategoriaById(organizadorId, id);
    res.json(categoria);
  } catch (err) {
    next(err);
  }
}

async function updateCategoria(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const { id } = req.params;

    const categoria = await categoriaService.updateCategoria(organizadorId, id, req.body);
    res.json(categoria);
  } catch (err) {
    next(err);
  }
}

async function deleteCategoria(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const { id } = req.params;

    const result = await categoriaService.deleteCategoria(organizadorId, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function reiniciarCategoria(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const { id } = req.params;

    const result = await categoriaService.reiniciarCategoria(organizadorId, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function sortearZonas(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const { id } = req.params;
    const { conDisponibilidad } = req.body;

    let result;
    if (conDisponibilidad) {
      result = await zonaService.iniciarCategoriaConDisponibilidad(organizadorId, id);
    } else {
      result = await zonaService.iniciarCategoria(organizadorId, id);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createCategoria,
  getCategorias,
  getCategoriaById,
  updateCategoria,
  deleteCategoria,
  reiniciarCategoria,
  sortearZonas,
};
