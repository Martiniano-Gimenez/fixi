import { useState, useMemo } from 'react';
import { api } from '../../api/client';
import { armarAvisoDestrabe } from '../../utils/precheckDestrabe';

function calcularMetricasCategoria(c) {
  const partidos = c.partidosSinHorario || [];
  let minOpciones = 999;
  let criticosCount = 0;

  for (const p of partidos) {
    let opcionesCount = 999;
    if (p.motivo === 'ZONA_MANUAL_INCOMPLETA') {
      opcionesCount = 0;
    } else if (Array.isArray(p.opcionesResolucion)) {
      opcionesCount = p.opcionesResolucion.length;
    } else if (Array.isArray(p.slotsViables)) {
      opcionesCount = p.slotsViables.length;
    }

    if (opcionesCount < minOpciones) {
      minOpciones = opcionesCount;
    }
    if (opcionesCount <= 1 || p.motivo === 'ZONA_MANUAL_INCOMPLETA') {
      criticosCount++;
    }
  }

  return {
    ...c,
    minOpciones,
    criticosCount,
    tieneCriticos: criticosCount > 0,
    totalConflictos: partidos.length,
  };
}

function ordenarCategoriasPorUrgencia(conflictos) {
  const procesados = (conflictos || []).map(calcularMetricasCategoria);

  return procesados.sort((a, b) => {
    // 1. Menor cantidad de opciones mínimas (más restringido primero)
    if (a.minOpciones !== b.minOpciones) {
      return a.minOpciones - b.minOpciones;
    }
    // 2. Mayor cantidad de partidos críticos (<=1 opción o manual)
    if (a.criticosCount !== b.criticosCount) {
      return b.criticosCount - a.criticosCount;
    }
    // 3. Mayor cantidad total de conflictos pendientes
    if (a.totalConflictos !== b.totalConflictos) {
      return b.totalConflictos - a.totalConflictos;
    }
    // 4. Orden alfabético
    return (a.nombreCategoria || '').localeCompare(b.nombreCategoria || '');
  });
}

export default function usePreCheckInicio(id, fetchData) {
  // Iniciar Torneo Multi-categoría
  const [verificandoInicio, setVerificandoInicio] = useState(false);
  const [iniciarModalOpen, setIniciarModalOpen] = useState(false);
  const [iniciandoTorneo, setIniciandoTorneo] = useState(false);
  const [planId, setPlanId] = useState(null);
  const [planEmergenciaId, setPlanEmergenciaId] = useState(null);
  const [permiteInicioEmergencia, setPermiteInicioEmergencia] = useState(false);
  const [conteoInicialConflictos, setConteoInicialConflictos] = useState(null);
  const [confirmarEmergenciaModalOpen, setConfirmarEmergenciaModalOpen] = useState(false);
  const [conflictosBloqueo, setConflictosBloqueo] = useState(null);
  const [expandedCategoriasConflictos, setExpandedCategoriasConflictos] = useState(new Set());
  const [grillaOrganizador, setGrillaOrganizador] = useState({ viernes: [], sabado: [] });
  const [preCheckAprobado, setPreCheckAprobado] = useState(false);
  const [revisionPreCheck, setRevisionPreCheck] = useState(null);
  const [partidoManualAbierto, setPartidoManualAbierto] = useState(null);
  const [hayCambiosGuardados, setHayCambiosGuardados] = useState(false);
  const [resultadoInicio, setResultadoInicio] = useState(null);
  const [confirmarResorteoModalOpen, setConfirmarResorteoModalOpen] = useState(false);
  const [avisoSesionReiniciada, setAvisoSesionReiniciada] = useState(false);
  const [avisoDestrabe, setAvisoDestrabe] = useState(null);

  const categoriasConflictosOrdenadas = useMemo(() => {
    if (!conflictosBloqueo || conflictosBloqueo.length === 0) return [];
    return ordenarCategoriasPorUrgencia(conflictosBloqueo);
  }, [conflictosBloqueo]);

  const allConflictosExpanded =
    categoriasConflictosOrdenadas.length > 0 &&
    expandedCategoriasConflictos.size === categoriasConflictosOrdenadas.length;

  const toggleCategoriaConflicto = (categoriaId) => {
    setExpandedCategoriasConflictos((prev) => {
      const next = new Set(prev);
      if (next.has(categoriaId)) {
        next.delete(categoriaId);
      } else {
        next.add(categoriaId);
      }
      return next;
    });
  };

  const handleToggleAllConflictos = () => {
    if (allConflictosExpanded) {
      setExpandedCategoriasConflictos(new Set());
    } else {
      setExpandedCategoriasConflictos(new Set(categoriasConflictosOrdenadas.map((c) => c.categoriaId)));
    }
  };

  const handlePreCheckInicio = async (isReCheck = false, forceReset = false) => {
    const isReCheckBool = isReCheck === true;
    const forceResetBool = forceReset === true;
    setVerificandoInicio(true);
    setHayCambiosGuardados(false);
    try {
      const res = await api.post(`/torneos/${id}/pre-check-inicio`, {
        isReCheck: isReCheckBool,
        forceReset: forceResetBool,
      });
      setRevisionPreCheck(res.revision || null);
      setAvisoSesionReiniciada(Boolean(res.sesionReiniciada));

      if (res.grillaOrganizador) {
        setGrillaOrganizador(res.grillaOrganizador);
      }
      if (res.bloqueado) {
        const conflictos = res.conflictos || [];
        const total = conflictos.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0);
        // En un re-check, explicar si destrabar una zona manual dejó partidos sin cancha
        // (el contador cuenta partidos y puede subir).
        setAvisoDestrabe(
          isReCheckBool && !forceResetBool && !res.sesionReiniciada
            ? armarAvisoDestrabe(conflictosBloqueo, conflictos)
            : null
        );
        setConflictosBloqueo(conflictos);
        setPermiteInicioEmergencia(Boolean(res.permiteInicioEmergencia));
        setPlanEmergenciaId(res.planEmergenciaId || null);
        setPreCheckAprobado(false);
        setPlanId(null);
        if (conteoInicialConflictos === null || !isReCheck || forceReset) {
          setConteoInicialConflictos(total);
        }

        // Actualizar acordeón de categorías con preservación de estado
        const ordenadas = ordenarCategoriasPorUrgencia(conflictos);
        setExpandedCategoriasConflictos((prev) => {
          const categoriasRestantesIds = new Set(ordenadas.map((c) => c.categoriaId));
          const activas = new Set(Array.from(prev).filter((id) => categoriasRestantesIds.has(id)));
          if (activas.size > 0) {
            return activas;
          }
          if (ordenadas.length > 0) {
            return new Set([ordenadas[0].categoriaId]);
          }
          return new Set();
        });
      } else {
        setAvisoDestrabe(null);
        setPlanId(res.planId);
        setPlanEmergenciaId(null);
        setExpandedCategoriasConflictos(new Set());
        if (conflictosBloqueo !== null || isReCheck) {
          setConflictosBloqueo([]);
          setPreCheckAprobado(true);
        } else {
          setConflictosBloqueo(null);
          setPreCheckAprobado(false);
          setIniciarModalOpen(true);
        }
      }
    } catch (err) {
      alert(err.message || 'Error al verificar la disponibilidad de las categorías.');
    } finally {
      setVerificandoInicio(false);
    }
  };

  const handleSlotSaved = async (categoriaId, partidoId, parejaId, newSlots) => {
    setHayCambiosGuardados(true);
    setConflictosBloqueo((prev) => {
      if (!prev) return prev;
      return prev.map((cat) => {
        if (cat.categoriaId !== categoriaId) return cat;
        return {
          ...cat,
          partidosSinHorario: cat.partidosSinHorario.map((p) => {
            if (p.partidoId !== partidoId) return p;
            return {
              ...p,
              parejaMasRestringidaSlotIds: newSlots,
              parejaMasRestringidaSlots: newSlots.length,
            };
          }),
        };
      });
    });

    // Re-verificación reactiva automática en background
    await handlePreCheckInicio(true);
  };

  const executeIniciarTorneo = async () => {
    setIniciandoTorneo(true);
    try {
      const res = await api.post(`/torneos/${id}/iniciar`, { planId });
      setIniciarModalOpen(false);
      setConflictosBloqueo(null);
      setPreCheckAprobado(false);
      setPlanId(null);
      setPlanEmergenciaId(null);
      setConteoInicialConflictos(null);
      setResultadoInicio(res);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al iniciar el torneo.');
      setIniciarModalOpen(false);
      setConflictosBloqueo(null);
      setPreCheckAprobado(false);
      setPlanId(null);
      fetchData();
    } finally {
      setIniciandoTorneo(false);
    }
  };

  const executeIniciarTorneoEmergencia = async () => {
    if (!planEmergenciaId) return;
    setIniciandoTorneo(true);
    try {
      const res = await api.post(`/torneos/${id}/iniciar`, { planId: planEmergenciaId });
      setConfirmarEmergenciaModalOpen(false);
      setConflictosBloqueo(null);
      setPreCheckAprobado(false);
      setPlanId(null);
      setPlanEmergenciaId(null);
      setConteoInicialConflictos(null);
      setResultadoInicio(res);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al iniciar el torneo con partidos pendientes.');
      setConfirmarEmergenciaModalOpen(false);
      fetchData();
    } finally {
      setIniciandoTorneo(false);
    }
  };

  return {
    verificandoInicio,
    setVerificandoInicio,
    iniciarModalOpen,
    setIniciarModalOpen,
    iniciandoTorneo,
    setIniciandoTorneo,
    planId,
    setPlanId,
    planEmergenciaId,
    setPlanEmergenciaId,
    permiteInicioEmergencia,
    setPermiteInicioEmergencia,
    conteoInicialConflictos,
    setConteoInicialConflictos,
    confirmarEmergenciaModalOpen,
    setConfirmarEmergenciaModalOpen,
    conflictosBloqueo,
    setConflictosBloqueo,
    expandedCategoriasConflictos,
    setExpandedCategoriasConflictos,
    grillaOrganizador,
    setGrillaOrganizador,
    preCheckAprobado,
    setPreCheckAprobado,
    revisionPreCheck,
    setRevisionPreCheck,
    partidoManualAbierto,
    setPartidoManualAbierto,
    hayCambiosGuardados,
    setHayCambiosGuardados,
    resultadoInicio,
    setResultadoInicio,
    confirmarResorteoModalOpen,
    setConfirmarResorteoModalOpen,
    avisoSesionReiniciada,
    setAvisoSesionReiniciada,
    avisoDestrabe,
    setAvisoDestrabe,
    categoriasConflictosOrdenadas,
    allConflictosExpanded,
    toggleCategoriaConflicto,
    handleToggleAllConflictos,
    handlePreCheckInicio,
    handleSlotSaved,
    executeIniciarTorneo,
    executeIniciarTorneoEmergencia,
  };
}
