import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { copiarTexto } from '../../utils/portapapeles';
import ConfirmModal from '../../components/ConfirmModal';
import ActionsMenu from '../../components/ActionsMenu';
import {
  ChevronLeft,
  Plus,
  Play,
  Calendar,
  RotateCcw,
  Copy,
  Check,
  CheckCircle,
  Trash2,
  Layers,
  Users,
  AlertTriangle,
  RefreshCw,
  Eye,
  Settings,
  Info,
  ChevronDown,
  ChevronUp,
  Loader2,
  Activity,
  Edit2,
  X,
  GitBranch,
} from 'lucide-react';
import InlineDisponibilidadEditor from '../../components/InlineDisponibilidadEditor';
import PropuestasZona from '../../components/PropuestasZona';
import InscripcionLinkPanel from '../../components/InscripcionLinkPanel';
import CruceResolver from '../../components/CruceResolver';
import PartidosPendientesSection from '../../components/PartidosPendientesSection';
import { estadoLabel } from '../../utils/estadoLabels';
import { armarAvisoDestrabe } from '../../utils/precheckDestrabe';
import { formatFechaTorneo, getZonedParts, isViernes } from '../../utils/dateUtils';
import { agruparSlotsEnRangos, formatearMinutos, minutosDeJuego } from '../../utils/disponibilidadUtils';

function CruceDetalles({ partido, categoriaId, categoriaNombre, torneoId, onApplied }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [applyingSlotId, setApplyingSlotId] = useState(null);
  const [error, setError] = useState('');
  const p = partido;

  const slotsViables = p.slotsViables || [];
  const viernesViables = slotsViables.filter((s) => s.startsWith('Viernes'));
  const sabadoViables = slotsViables.filter((s) => s.startsWith('Sabado'));
  const slotsParejaRestringida = p.parejaMasRestringidaId && p.parejaMasRestringidaId === p.pareja1Id
    ? p.pareja1SlotIds
    : p.parejaMasRestringidaId && p.parejaMasRestringidaId === p.pareja2Id
      ? p.pareja2SlotIds
      : null;

  const handleApplySlot = async (slotId) => {
    if (!p.pareja1Id || !p.pareja2Id || applyingSlotId) return;
    setApplyingSlotId(slotId);
    setError('');

    const [dia, hora] = slotId.split('-');
    const p1AlreadyHas = (p.pareja1SlotIds || []).includes(slotId);
    const p2AlreadyHas = (p.pareja2SlotIds || []).includes(slotId);

    const slotsToAdd1 = p1AlreadyHas ? [] : [slotId];
    const slotsToAdd2 = p2AlreadyHas ? [] : [slotId];

    try {
      await api.put('/parejas/disponibilidad-doble', {
        parejaId1: p.pareja1Id,
        slotsToAdd1,
        parejaId2: p.pareja2Id,
        slotsToAdd2,
      });

      if (onApplied) {
        await onApplied({
          pareja1Id: p.pareja1Id,
          pareja2Id: p.pareja2Id,
          slotId,
          distP1: p1AlreadyHas ? 0 : 999,
          distP2: p2AlreadyHas ? 0 : 999,
          addToP1: !p1AlreadyHas,
          addToP2: !p2AlreadyHas,
          label: `${dia} ${hora}`,
        });
      }
    } catch (err) {
      setError(err.message || 'Error al asignar horario.');
    } finally {
      setApplyingSlotId(null);
    }
  };

  return (
    <div className="pc-details-content">
      <button
        type="button"
        className="pc-link"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <Info size={12} />
        <span>{isOpen ? 'Ocultar' : 'Elegir otro horario'}</span>
        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {isOpen && (
        <div className="pc-details-body">
          <div className="pc-muted">
            {p.motivo === 'SIN_FRANJA_COMUN'
              ? 'Ambas parejas no tienen ninguna ventana horaria en común.'
              : 'Coinciden en disponibilidad pero las canchas están 100% ocupadas en esa franja.'}
          </div>

          {p.parejaMasRestringidaNombre && (
            <div className="pc-restricted-pair">
              <span className="pc-muted">Pareja más restringida: </span>
              <strong className="pc-details-name">{p.parejaMasRestringidaNombre}</strong>{' '}
              {Array.isArray(slotsParejaRestringida) && (
                <span className="pc-muted">
                  ({formatearMinutos(minutosDeJuego(slotsParejaRestringida))} disponibles)
                </span>
              )}
            </div>
          )}

          <div className="pc-time-picker">
            <label className="pc-time-field">
              <span className="pc-muted">Horario</span>
              <select
                className="pc-time-select"
                aria-label="Horario"
                value={selectedSlotId}
                onChange={(e) => setSelectedSlotId(e.target.value)}
                disabled={Boolean(applyingSlotId) || slotsViables.length === 0}
              >
                <option value="">Elegí un horario</option>
                {viernesViables.length > 0 && (
                  <optgroup label="Viernes">
                    {viernesViables.map((slotId) => <option key={slotId} value={slotId}>{slotId.split('-')[1]}</option>)}
                  </optgroup>
                )}
                {sabadoViables.length > 0 && (
                  <optgroup label="Sábado">
                    {sabadoViables.map((slotId) => <option key={slotId} value={slotId}>{slotId.split('-')[1]}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
            <button
              type="button"
              className="pc-button"
              onClick={() => handleApplySlot(selectedSlotId)}
              disabled={!slotsViables.includes(selectedSlotId) || Boolean(applyingSlotId)}
            >
              {applyingSlotId ? <><Loader2 size={11} className="pc-spin" /> Asignando…</> : 'Asignar'}
            </button>
          </div>

          {error && <div className="pc-notice pc-danger-notice">{error}</div>}

          {p.parejaMasRestringidaId && (
            <div className="pc-spaced">
              <Link
                to={`/admin/torneos/${torneoId}/categorias/${categoriaId}/parejas?parejaId=${p.parejaMasRestringidaId}`}
                className="pc-manage-link"
              >
                Ver parejas de {categoriaNombre}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

export default function TorneoDetail() {
  const { id } = useParams();

  const [torneo, setTorneo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modales y estados
  const [copiado, setCopiado] = useState(false);
  const [errorCopia, setErrorCopia] = useState(false);
  const copiaTimeoutRef = useRef(null);
  const [nuevaCatModalOpen, setNuevaCatModalOpen] = useState(false);
  const [nombreNuevaCat, setNombreNuevaCat] = useState('');
  const [creandoCat, setCreandoCat] = useState(false);

  const [categoriaAEliminar, setCategoriaAEliminar] = useState(null);
  const [eliminandoCat, setEliminandoCat] = useState(false);

  const [reiniciarModalOpen, setReiniciarModalOpen] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);

  // Editar Fecha del Torneo
  const [editTorneoModalOpen, setEditTorneoModalOpen] = useState(false);
  const [editFecha, setEditFecha] = useState('');
  const [guardandoTorneo, setGuardandoTorneo] = useState(false);
  const [editTorneoError, setEditTorneoError] = useState('');

  // Edición rápida / inline del nombre del torneo
  const [isEditingNombre, setIsEditingNombre] = useState(false);
  const [nombreInline, setNombreInline] = useState('');
  const [guardandoNombreInline, setGuardandoNombreInline] = useState(false);
  const [nombreInlineError, setNombreInlineError] = useState('');
  const inlineNombreInputRef = useRef(null);

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
  const [hayCambiosGuardados, setHayCambiosGuardados] = useState(false);
  const [resultadoInicio, setResultadoInicio] = useState(null);
  const [undoAction, setUndoAction] = useState(null);
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

  const fetchData = useCallback(async () => {
    try {
      const data = await api.get(`/torneos/${id}`);
      setTorneo(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCopyLink = async () => {
    if (!torneo?.slug) return;
    const url = `${window.location.origin}/torneo/${torneo.slug}`;
    const resultado = await copiarTexto(url);
    setCopiado(resultado);
    setErrorCopia(!resultado);
    clearTimeout(copiaTimeoutRef.current);
    copiaTimeoutRef.current = setTimeout(() => {
      setCopiado(false);
      setErrorCopia(false);
    }, 2000);
  };

  useEffect(() => {
    if (isEditingNombre && inlineNombreInputRef.current) {
      inlineNombreInputRef.current.focus();
      inlineNombreInputRef.current.select();
    }
  }, [isEditingNombre]);

  const handleStartEditingNombre = () => {
    if (!torneo) return;
    setNombreInline(torneo.nombre || '');
    setNombreInlineError('');
    setIsEditingNombre(true);
  };

  const handleCancelEditingNombre = () => {
    setIsEditingNombre(false);
    setNombreInline(torneo?.nombre || '');
    setNombreInlineError('');
  };

  const handleSaveNombreInline = async (e) => {
    if (e) e.preventDefault();
    const trimmed = nombreInline.trim();
    if (!trimmed) {
      setNombreInlineError('El nombre no puede estar vacío.');
      return;
    }
    if (trimmed === torneo.nombre) {
      setIsEditingNombre(false);
      return;
    }
    setGuardandoNombreInline(true);
    setNombreInlineError('');
    try {
      const updated = await api.put(`/torneos/${torneo.id}`, {
        nombre: trimmed,
      });
      setTorneo((prev) => ({ ...prev, ...updated }));
      setIsEditingNombre(false);
    } catch (err) {
      setNombreInlineError(err.message || 'Error al actualizar el nombre.');
    } finally {
      setGuardandoNombreInline(false);
    }
  };

  const handleOpenEditTorneo = () => {
    if (!torneo || torneo.estado !== 'BORRADOR') return;
    if (torneo.fecha) {
      const match = typeof torneo.fecha === 'string' && torneo.fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        setEditFecha(`${match[1]}-${match[2]}-${match[3]}`);
      } else {
        const parts = getZonedParts(torneo.fecha);
        if (parts) {
          const yyyy = parts.year;
          const mm = String(parts.month).padStart(2, '0');
          const dd = String(parts.day).padStart(2, '0');
          setEditFecha(`${yyyy}-${mm}-${dd}`);
        } else {
          setEditFecha('');
        }
      }
    } else {
      setEditFecha('');
    }
    setEditTorneoError('');
    setEditTorneoModalOpen(true);
  };

  const handleGuardarTorneo = async (e) => {
    e.preventDefault();
    if (!editFecha) {
      setEditTorneoError('La fecha de inicio del torneo es obligatoria.');
      return;
    }
    if (!isViernes(editFecha)) {
      setEditTorneoError('La fecha de inicio debe ser un viernes.');
      return;
    }
    setGuardandoTorneo(true);
    setEditTorneoError('');
    try {
      const updated = await api.put(`/torneos/${torneo.id}`, {
        fecha: editFecha,
      });
      setTorneo((prev) => ({ ...prev, ...updated }));
      setEditTorneoModalOpen(false);
    } catch (err) {
      setEditTorneoError(err.message || 'Error al actualizar la fecha del torneo.');
    } finally {
      setGuardandoTorneo(false);
    }
  };

  const handleCrearCategoria = async (e) => {
    e.preventDefault();
    if (!nombreNuevaCat.trim()) return;
    setCreandoCat(true);
    try {
      await api.post(`/torneos/${id}/categorias`, { nombre: nombreNuevaCat.trim() });
      setNombreNuevaCat('');
      setNuevaCatModalOpen(false);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al crear la categoría.');
    } finally {
      setCreandoCat(false);
    }
  };

  const executeEliminarCategoria = async () => {
    if (!categoriaAEliminar) return;
    setEliminandoCat(true);
    try {
      await api.delete(`/categorias/${categoriaAEliminar.id}`);
      setCategoriaAEliminar(null);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al eliminar categoría.');
    } finally {
      setEliminandoCat(false);
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

  const handleCasiEstrellaApplied = async ({ pareja1Id, pareja2Id, slotId, distP1, distP2, addToP1, addToP2, label }) => {
    setHayCambiosGuardados(true);

    const slotsToRemove1 = addToP1 ? [slotId] : (Math.abs(distP1 || 0) > 0 ? [slotId] : []);
    const slotsToRemove2 = addToP2 ? [slotId] : (Math.abs(distP2 || 0) > 0 ? [slotId] : []);

    if (undoAction?.timeoutId) {
      clearTimeout(undoAction.timeoutId);
    }

    const timeoutId = setTimeout(() => {
      setUndoAction(null);
    }, 7000);

    setUndoAction({
      pareja1Id,
      pareja2Id,
      slotsToRemove1,
      slotsToRemove2,
      label,
      timeoutId,
    });

    // Re-verificación reactiva automática en background
    await handlePreCheckInicio(true);
  };

  const handleUndo = async () => {
    if (!undoAction) return;
    const { pareja1Id, pareja2Id, slotsToRemove1, slotsToRemove2, timeoutId } = undoAction;
    if (timeoutId) clearTimeout(timeoutId);
    setUndoAction(null);

    try {
      await api.post('/parejas/disponibilidad-doble/remover', {
        parejaId1: pareja1Id,
        slotsToRemove1,
        parejaId2: pareja2Id,
        slotsToRemove2,
      });
      await handlePreCheckInicio(true);
    } catch (err) {
      alert(err.message || 'Error al deshacer la acción.');
    }
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

  const executeReiniciarTorneo = async () => {
    setReiniciando(true);
    try {
      await api.post(`/torneos/${id}/reiniciar`);
      setReiniciarModalOpen(false);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al reiniciar el torneo.');
    } finally {
      setReiniciando(false);
    }
  };

  if (loading) return <div className="td-loading">Cargando torneo…</div>;
  if (error || !torneo) return <div className="td-error td-load-error">{error || 'Torneo no encontrado'}</div>;

  const categoriasBorrador = (torneo.categorias || []).filter((c) => c.estado === 'BORRADOR');
  const puedeIniciar = categoriasBorrador.length > 0 && categoriasBorrador.some((c) => c.parejas?.length >= 2);

  return (
    <div className="page td-screen">
      {/* Volver */}
      <div className="td-back-row">
        <Link
          to="/admin"
          className="panel-back"
        >
          <ChevronLeft size={16} /> Volver a mis torneos
        </Link>
      </div>

      {/* Header del Torneo */}
      <div className="td-card td-header">
        <div className="td-header-layout">
          <div>
            <div className="td-title-row">
              {!isEditingNombre ? (
                <div className="td-name-row">
                  <h1
                    className="td-name"
                    onClick={handleStartEditingNombre}
                    title="Hacé click para cambiar el nombre del torneo"
                  >
                    <span>{torneo.nombre}</span>
                  </h1>
                  <button
                    type="button"
                    onClick={handleStartEditingNombre}
                    className="td-button td-edit-name"
                    title="Cambiar nombre del torneo"
                    aria-label="Cambiar nombre del torneo"
                  >
                    <Edit2 size={14} className="td-brand-icon" />
                  </button>
                  <span className={`td-state td-state-${torneo.estado.toLowerCase()}`}>{estadoLabel(torneo.estado)}</span>
                </div>
              ) : (
                <form
                  onSubmit={handleSaveNombreInline}
                  className="td-name-form"
                >
                  <input
                    aria-label="Nombre del torneo"
                    ref={inlineNombreInputRef}
                    type="text"
                    value={nombreInline}
                    onChange={(e) => {
                      setNombreInline(e.target.value);
                      if (nombreInlineError) setNombreInlineError('');
                    }}
                    disabled={guardandoNombreInline}
                    placeholder="Nombre del torneo…"
                    className="td-input td-name-input"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        handleCancelEditingNombre();
                      }
                    }}
                  />
                  <div className="td-inline-actions">
                    <button
                      type="submit"
                      disabled={guardandoNombreInline || !nombreInline.trim() || nombreInline.trim() === torneo.nombre}
                      title="Guardar nombre (Enter)"
                      className="td-button"
                    >
                      {guardandoNombreInline ? (
                        <RefreshCw size={14} className="td-spin" />
                      ) : (
                        <Check size={15} strokeWidth={2.5} />
                      )}
                      <span>Guardar</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEditingNombre}
                      disabled={guardandoNombreInline}
                      title="Cancelar (Esc)"
                      className="td-button"
                    >
                      <X size={15} />
                      <span>Cancelar</span>
                    </button>
                  </div>
                  {nombreInlineError && (
                    <div className="td-error td-name-error">
                      {nombreInlineError}
                    </div>
                  )}
                </form>
              )}
            </div>

            <div className="td-meta">
              {torneo.estado === 'BORRADOR' ? (
                <button
                  type="button"
                  onClick={handleOpenEditTorneo}
                  className="td-button td-date-button"
                  title="Click para cambiar la fecha del torneo"
                >
                  <Calendar size={15} className="td-brand-icon" />
                  <span>
                    {torneo.fecha ? formatFechaTorneo(torneo.fecha) : 'Fecha a confirmar'}
                  </span>
                  <Edit2 size={12} className="td-date-edit-icon" />
                </button>
              ) : (
                <span className="td-meta-item">
                  <Calendar size={15} />
                  <span>
                    {torneo.fecha ? formatFechaTorneo(torneo.fecha) : 'Fecha a confirmar'}
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Acciones principales */}
          <div className="td-actions">
            <button
              type="button"
              className="td-button"
              onClick={handleCopyLink}
              title="Copiar link público para compartir con jugadores"
            >
              {copiado ? <Check size={16} className="td-brand-icon" /> : <Copy size={16} />}
              {copiado ? 'Link copiado' : errorCopia ? 'No se pudo copiar' : 'Copiar link público'}
            </button>

            <Link
              to={`/torneo/${torneo.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="td-button"
              title="Abrir vista pública en nueva pestaña"
            >
              <Eye size={16} /> Ver público
            </Link>

            {torneo.estado !== 'BORRADOR' && (
              <ActionsMenu>
                <button
                  type="button"
                  className="actions-menu-item danger"
                  role="menuitem"
                  onClick={() => setReiniciarModalOpen(true)}
                >
                  <RotateCcw size={15} /> Reiniciar torneo
                </button>
              </ActionsMenu>
            )}

            {torneo.estado === 'EN_CURSO' && (
              <Link
                to={`/admin/torneos/${torneo.id}/en-vivo`}
                className="td-button td-primary"
                title="Abrir panel de control en vivo y reprogramación por lluvia"
              >
                <Activity size={16} /> Día de Torneo
              </Link>
            )}

            {puedeIniciar && (
              <button
                type="button"
                onClick={() => handlePreCheckInicio()}
                disabled={verificandoInicio}
                className={`td-button${torneo.estado === 'EN_CURSO' ? '' : ' td-primary'}`}
              >
                {verificandoInicio ? (
                  <>
                    <RefreshCw size={16} className="td-spin" /> Verificando turnos…
                  </>
                ) : (
                  <>
                    <Play size={16} /> Iniciar torneo
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>


      {/* Inscripción de parejas por link (solo en borrador) */}
      {torneo.estado === 'BORRADOR' && (torneo.categorias?.length > 0 || torneo.inscripcionAbierta) && (
        <InscripcionLinkPanel
          torneo={torneo}
          onCambio={(inscripcionAbierta) => setTorneo((prev) => ({ ...prev, inscripcionAbierta }))}
        />
      )}

      {/* Sección de partidos pendientes de horario si el torneo está en curso */}
      {torneo.estado === 'EN_CURSO' && (
        <PartidosPendientesSection
          torneoId={torneo.id}
          torneoEstado={torneo.estado}
          onPartidosActualizados={fetchData}
        />
      )}

      {/* Listado de Categorías */}
      <div className="td-section-heading">
        <div>
          <h2 className="td-section-title">
            <Layers size={22} className="td-brand-icon" />
            Categorías
            {torneo.categorias?.length > 0 && (
              <span className="td-category-count">{torneo.categorias.length}</span>
            )}
          </h2>
        </div>

        {torneo.categorias?.length > 0 && (
          <div className="td-category-tools">
            <button
              type="button"
              className="td-button"
              onClick={() => setNuevaCatModalOpen(true)}
            >
              <Plus size={16} /> Nueva categoría
            </button>
          </div>
        )}
      </div>

      {(!torneo.categorias || torneo.categorias.length === 0) ? (
        <div className="td-card td-empty">
          <Layers size={44} className="td-empty-icon" />
          <h3 className="td-empty-title">No hay categorías cargadas</h3>
          <p className="td-empty-copy">
            Agregá las categorías que se juegan en este torneo.
          </p>
          <button
            type="button"
            onClick={() => setNuevaCatModalOpen(true)}
            className="td-button td-primary"
          >
            <Plus size={16} /> Agregar categoría
          </button>
        </div>
      ) : (
        <div className="td-category-grid">
          {torneo.categorias.map((cat) => {
            const totalParejas = cat.parejas?.length || 0;
            const totalZonas = cat.zonas?.length || 0;
            // Los "pasa directo" (esBye) de la llave no se juegan: no cuentan como partidos
            const partidosReales = (cat.partidos || []).filter((p) => !p.esBye);
            const totalPartidos = partidosReales.length;
            const partidosFinalizados = partidosReales.filter((p) => p.estado === 'FINALIZADO').length;

            return (
              <div
                key={cat.id}
                className="td-card td-category"
              >
                <div>
                  <div className="td-category-heading">
                    <h3 className="td-category-title">{cat.nombre}</h3>
                    <div className="td-category-state">
                      {cat.estado !== torneo.estado && (
                        <span className={`td-state td-state-${cat.estado.toLowerCase()}`}>{estadoLabel(cat.estado)}</span>
                      )}
                    </div>
                  </div>

                  <div className="td-category-meta">
                    <span className="td-meta-item">
                      <Users size={15} className="td-brand-icon" />
                      <strong className="td-strong">{totalParejas}</strong> parejas
                    </span>
                    {totalZonas > 0 && (
                      <span className="td-meta-item">
                        <Layers size={15} />
                        <strong className="td-strong">{totalZonas}</strong> zonas
                      </span>
                    )}
                    {totalPartidos > 0 && (
                      <div className="td-progress">
                        <span className="td-progress-label">
                          <strong className="td-strong">{partidosFinalizados}</strong>/{totalPartidos} jugados
                        </span>
                        <div className="td-progress-track">
                          <div
                            className="td-progress-fill"
                            style={{
                              width: `${Math.round((partidosFinalizados / totalPartidos) * 100)}%`,
                            }}
                            role="progressbar"
                            aria-valuenow={partidosFinalizados}
                            aria-valuemin={0}
                            aria-valuemax={totalPartidos}
                            aria-label={`${partidosFinalizados} de ${totalPartidos} partidos jugados`}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="td-card-actions">
                  <Link
                    to={`/admin/torneos/${torneo.id}/categorias/${cat.id}`}
                    className="td-button td-category-action"
                  >
                    <Settings size={15} /> Administrar
                  </Link>

                  {cat.estado !== 'BORRADOR' && (
                    <Link
                      to={`/admin/torneos/${torneo.id}/categorias/${cat.id}/eliminatoria`}
                      className="td-button td-category-action"
                      title="Ver cuadro eliminatorio"
                    >
                      <GitBranch size={15} /> Cuadro
                    </Link>
                  )}

                  <button
                    type="button"
                    className="td-button td-delete"
                    title="Eliminar categoría"
                    aria-label={`Eliminar categoría ${cat.nombre}`}
                    onClick={() => setCategoriaAEliminar(cat)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal para editar fecha del torneo */}
      {editTorneoModalOpen && (
        <div className="pm-overlay">
          <div className="pm-modal td-date-modal" role="dialog" aria-modal="true" aria-labelledby="td-date-title">
            <div className="pm-header">
              <h2 id="td-date-title" className="pm-title td-modal-title">
                <Calendar size={20} className="td-brand-icon" /> Editar fecha del torneo
              </h2>
            </div>

            <form onSubmit={handleGuardarTorneo} className="td-modal-form">
              <div className="pm-body">
                {editTorneoError && (
                  <div className="pm-alert td-modal-alert" role="alert">
                    {editTorneoError}
                  </div>
                )}
                <div className="td-field">
                  <label className="td-label" htmlFor="td-edit-date">
                    Fecha de inicio (viernes)
                  </label>
                  <input
                    id="td-edit-date"
                    type="date"
                    value={editFecha}
                    onChange={(e) => setEditFecha(e.target.value)}
                    required
                    className="td-input"
                  />
                </div>
              </div>
              <div className="pm-footer">
                <button
                  type="button"
                  className="pm-button"
                  onClick={() => setEditTorneoModalOpen(false)}
                  disabled={guardandoTorneo}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="pm-button pm-primary"
                  disabled={guardandoTorneo}
                >
                  {guardandoTorneo ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal para crear categoría */}
      {nuevaCatModalOpen && (
        <div className="pm-overlay">
          <div className="pm-modal td-category-modal" role="dialog" aria-modal="true" aria-labelledby="td-category-title">
            <div className="pm-header">
              <h2 id="td-category-title" className="pm-title td-modal-title">
                <Plus size={20} className="td-brand-icon" /> Nueva categoría
              </h2>
            </div>

            <form onSubmit={handleCrearCategoria} className="td-modal-form">
              <div className="pm-body">
                <div className="td-field">
                  <label className="td-label" htmlFor="td-new-category">
                    Nombre de la categoría:
                  </label>
                  <input
                    id="td-new-category"
                    type="text"
                    required
                    value={nombreNuevaCat}
                    onChange={(e) => setNombreNuevaCat(e.target.value)}
                    autoFocus
                    className="td-input"
                  />
                </div>
              </div>
              <div className="pm-footer">
                <button
                  type="button"
                  className="pm-button"
                  onClick={() => {
                    setNuevaCatModalOpen(false);
                    setNombreNuevaCat('');
                  }}
                  disabled={creandoCat}
                >
                  Cancelar
                </button>
                <button type="submit" className="pm-button pm-primary" disabled={creandoCat || !nombreNuevaCat.trim()}>
                  {creandoCat ? 'Creando…' : 'Crear categoría'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de confirmación para eliminar categoría */}
      <ConfirmModal
        isOpen={Boolean(categoriaAEliminar)}
        title="Eliminar Categoría"
        message={
          <>
            ¿Estás seguro de que querés eliminar la categoría{' '}
            <strong>"{categoriaAEliminar?.nombre}"</strong>?
            <br />
            <br />
            Se eliminarán sus parejas inscriptas, zonas y partidos.
          </>
        }
        confirmText="Eliminar Categoría"
        isDanger={true}
        isLoading={eliminandoCat}
        onConfirm={executeEliminarCategoria}
        onCancel={() => setCategoriaAEliminar(null)}
      />

      {/* Modal de confirmación para reiniciar torneo */}
      <ConfirmModal
        isOpen={reiniciarModalOpen}
        title="Reiniciar Torneo a Borrador"
        message={
          <>
            ¿Estás seguro de que querés reiniciar el torneo a <strong>BORRADOR</strong>?
            <br />
            <br />
            Se resetearán todas las zonas, partidos, llaves eliminatorias y horarios de todas las categorías. Las parejas y sus disponibilidades se mantendrán intactas.
          </>
        }
        confirmText="Sí, reiniciar torneo"
        isDanger={true}
        isLoading={reiniciando}
        onConfirm={executeReiniciarTorneo}
        onCancel={() => setReiniciarModalOpen(false)}
      />

      {/* Modal de confirmación para Iniciar Torneo Multi-categoría */}
      <ConfirmModal
        isOpen={iniciarModalOpen}
        title="Iniciar Torneo y Asignar Horarios"
        message={
          <>
            Se generarán las zonas para todas las categorías en borrador y se asignarán los turnos y canchas optimizados sin solapamientos.
            <br />
            <br />
            ¿Deseas continuar?
          </>
        }
        confirmText="Confirmar e Iniciar"
        isLoading={iniciandoTorneo}
        onConfirm={executeIniciarTorneo}
        onCancel={() => {
          setIniciarModalOpen(false);
          setPlanId(null);
        }}
      />

      {/* Modal de conflictos de bloqueo o éxito en pre-check */}
      {(conflictosBloqueo !== null || preCheckAprobado) && (
        <div className="pm-overlay">
          {preCheckAprobado ? (
            <div className="pm-modal pc-modal pc-success" role="dialog" aria-modal="true" aria-labelledby="pc-ready-title">
              <div className="pm-header pc-success-header">
                <CheckCircle size={28} className="pc-brand" />
                <div>
                  <h3 id="pc-ready-title" className="pm-title pc-title">
                    ¡Listo para iniciar! 0 conflictos
                  </h3>
                  <span className="pc-muted">
                    Todos los cruces y horarios son 100% compatibles
                  </span>
                </div>
              </div>

              <div className="pm-body">
                <div className="pc-success-note">
                  Se verificó la asignación global de todas las categorías en borrador. No existen colisiones de cancha ni incompatibilidades horarias.
                </div>

                <p className="pc-copy">
                  Al confirmar, se guardarán las zonas y los horarios de cada partido de forma definitiva en el torneo.
                </p>

              </div>
              <div className="pm-footer">
                <button
                  type="button"
                  className="pm-button"
                  onClick={() => {
                    setConflictosBloqueo(null);
                    setPreCheckAprobado(false);
                    setPlanId(null);
                  }}
                  disabled={iniciandoTorneo}
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={executeIniciarTorneo}
                  disabled={iniciandoTorneo}
                  className="pm-button pm-primary"
                >
                  <Play size={16} />
                  {iniciandoTorneo ? 'Iniciando torneo…' : 'Iniciar torneo'}
                </button>
              </div>
            </div>
          ) : (
            <div
              className="pm-modal pc-modal pc-conflicts" role="dialog" aria-modal="true" aria-labelledby="pc-conflicts-title"
            >
              <div className="pm-header pc-header">
                <div>
                  <h3 id="pc-conflicts-title" className="pm-title pc-title pc-danger">
                    <AlertTriangle size={22} /> Incompatibilidades detectadas
                  </h3>
                  {conteoInicialConflictos !== null &&
                    conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) < conteoInicialConflictos && (
                      <span className="pc-resolved">
                        <CheckCircle size={15} className="pc-brand" aria-hidden="true" />
                        <span>Resolviste {conteoInicialConflictos - conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)} {conteoInicialConflictos - conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) === 1 ? 'conflicto' : 'conflictos'}</span>
                      </span>
                    )}
                </div>

                <div className="pc-header-tools">
                  {categoriasConflictosOrdenadas.length > 1 && (
                    <button
                      type="button"
                      className="pm-button pc-compact"
                      onClick={handleToggleAllConflictos}
                    >
                      {allConflictosExpanded ? 'Colapsar todas' : 'Expandir todas'}
                    </button>
                  )}
                  <span className="pc-badge pc-danger-badge">
                    {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)}{' '}
                    {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) === 1 ? 'conflicto' : 'conflictos'}
                  </span>
                </div>
              </div>

              <div className="pm-body pc-body">
                {avisoSesionReiniciada && (
                  <div className="pc-notice pc-session-notice">
                    <Info size={16} className="pc-icon" />
                    <span>
                      El servidor se reinició o la sesión expiró. Se recalculó la vista previa con los horarios guardados.
                    </span>
                  </div>
                )}

                {avisoDestrabe && (
                  <div
                    role="status"
                    className="pc-notice pc-danger-notice"
                  >
                    <Info size={16} className="pc-icon" />
                    <div className="pc-notice-lines">
                      {avisoDestrabe.lineas.map((linea) => (
                        <p key={linea} className="pc-notice-line">
                          {linea}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pc-conflict-list">
                  {categoriasConflictosOrdenadas.map((c) => {
                    const isExpanded = expandedCategoriasConflictos.has(c.categoriaId);

                    return (
                      <div
                        key={c.categoriaId}
                        className="pc-category"
                      >
                        {/* Header del acordeón */}
                        <button
                          type="button"
                          className={`pc-category-toggle${isExpanded ? ' is-expanded' : ''}`}
                          onClick={() => toggleCategoriaConflicto(c.categoriaId)}
                          aria-expanded={isExpanded}
                        >
                          <div className="pc-category-label">
                            <Layers size={16} className="pc-brand" />
                            <strong className="pc-category-name">
                              {c.nombreCategoria}
                            </strong>
                            <span className="pc-badge pc-danger-badge">
                              {c.partidosSinHorario.length} {c.partidosSinHorario.length === 1 ? 'conflicto' : 'conflictos'}
                            </span>
                          </div>

                          <div className="pc-expand-label">
                            <span className="pc-muted">
                              {isExpanded ? 'Ocultar' : 'Ver conflictos'}
                            </span>
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </div>
                        </button>

                        {/* Cuerpo expandido */}
                        {isExpanded && (
                          <div className="pc-category-body">
                            {c.partidosSinHorario.map((p, idx) => (
                              <div
                                key={idx}
                                className="pc-conflict"
                              >
                                <div className="pc-conflict-heading">
                                  <span className="pc-zone-label">
                                    {p.zona}
                                  </span>
                                  <span className="pc-badge pc-danger-badge">
                                    {p.motivo === 'SIN_FRANJA_COMUN'
                                      ? 'Sin franja común'
                                      : p.motivo === 'ZONA_MANUAL_INCOMPLETA'
                                      ? 'Sin horarios en común'
                                      : 'Canchas saturadas'}
                                  </span>
                                </div>

                                {p.motivo === 'ZONA_MANUAL_INCOMPLETA' ? (
                                  <div>
                                    {p.crucesIncompatibles && p.crucesIncompatibles.length > 0 && (
                                      <ul className="pc-incompatible-list">
                                        {p.crucesIncompatibles.map((ci, idx) => (
                                          <li key={idx}>
                                            <strong>{ci.p1}</strong> y <strong>{ci.p2}</strong> no coinciden en ningún horario.
                                          </li>
                                        ))}
                                      </ul>
                                    )}

                                    {revisionPreCheck && (
                                      <PropuestasZona
                                        key={`${c.categoriaId}:${p.zonaId}`}
                                        torneoId={id}
                                        categoriaId={c.categoriaId}
                                        zonaId={p.zonaId}
                                        revision={revisionPreCheck}
                                        parejas={p.parejasManuales || []}
                                        onApplied={async () => {
                                          setHayCambiosGuardados(true);
                                          await handlePreCheckInicio(true);
                                        }}
                                        onRecheck={() => handlePreCheckInicio(true)}
                                      />
                                    )}

                                    <div className="pc-manual-pairs">
                                      {(p.parejasManuales || []).map((pm) => (
                                        <div
                                          key={pm.id}
                                          className="pc-manual-pair"
                                        >
                                          <div className="pc-manual-name pc-option-info">
                                            <strong>{pm.nombre}</strong>
                                            <span className="pc-muted">
                                              · {pm.slotIds?.length
                                                ? [
                                                  { key: 'Viernes', label: 'Vie', grilla: grillaOrganizador.viernes || [] },
                                                  { key: 'Sabado', label: 'Sáb', grilla: grillaOrganizador.sabado || [] },
                                                ].filter((dia) => pm.slotIds.some((slotId) => slotId.startsWith(`${dia.key}-`)))
                                                  .map((dia) => `${dia.label} ${agruparSlotsEnRangos(pm.slotIds.filter((slotId) => slotId.startsWith(`${dia.key}-`)), dia.grilla)}`)
                                                  .join(' · ')
                                                : 'Sin horarios cargados'}
                                            </span>
                                          </div>
                                          <InlineDisponibilidadEditor
                                            parejaId={pm.id}
                                            parejaNombre={pm.nombre}
                                            initialSlotIds={pm.slotIds || []}
                                            slotsViables={pm.slotsViables || []}
                                            slotsQueDestraban={pm.slotsQueDestraban || []}
                                            esZonaManual={true}
                                            grilla={grillaOrganizador}
                                            onSaved={async () => {
                                              setHayCambiosGuardados(true);
                                              await handlePreCheckInicio(true);
                                            }}
                                          />
                                        </div>
                                      ))}
                                    </div>

                                    <div className="pc-manage-row">
                                      <Link
                                        to={`/admin/torneos/${id}/categorias/${c.categoriaId}/parejas`}
                                        className="pc-manage-link"
                                      >
                                        Ver parejas de {c.nombreCategoria}
                                      </Link>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    {/* Título del cruce */}
                                    <div className="pc-match-names">
                                      <strong>{p.pareja1}</strong> vs <strong>{p.pareja2}</strong>
                                    </div>

                                    {/* Opción hero con [Resolver] y toggle de alternativas */}
                                    <CruceResolver
                                      opcionesResolucion={p.opcionesResolucion || []}
                                      pareja1Id={p.pareja1Id}
                                      pareja2Id={p.pareja2Id}
                                      pareja1Nombre={p.pareja1}
                                      pareja2Nombre={p.pareja2}
                                      onApplied={handleCasiEstrellaApplied}
                                    />

                                    {/* Toggle: Detalles y opciones manuales */}
                                    <div className="pc-details">
                                      <CruceDetalles
                                        partido={p}
                                        categoriaId={c.categoriaId}
                                      categoriaNombre={c.nombreCategoria}
                                        torneoId={id}
                                        onApplied={handleCasiEstrellaApplied}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {hayCambiosGuardados && (
                  <span className="pc-notice pc-danger-notice">
                    <AlertTriangle size={13} />
                    Hay cambios guardados. Hacé clic en "Volver a verificar".
                  </span>
                )}

                {/* Toast flotante de Deshacer (Undo) */}
                {undoAction && (
                  <div className="pc-undo">
                    <div className="pc-undo-copy">
                      <CheckCircle size={15} className="pc-brand" />
                      <span>
                        Se aplicó <strong>{undoAction.label}</strong> a ambas parejas.
                      </span>
                    </div>
                    <div className="pc-undo-actions">
                      <button
                        type="button"
                        className="pm-button pc-compact"
                        onClick={handleUndo}
                      >
                        <RotateCcw size={12} /> Deshacer
                      </button>
                      <button
                        type="button"
                        className="pm-button pm-close"
                        onClick={() => {
                          if (undoAction.timeoutId) clearTimeout(undoAction.timeoutId);
                          setUndoAction(null);
                        }}
                        title="Cerrar aviso"
                        aria-label="Cerrar aviso"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                )}

              </div>
              <div className="pm-footer pc-footer">
                <div>
                  <button
                    type="button"
                    className="pm-button pm-danger-secondary pc-redraw"
                    onClick={() => setConfirmarResorteoModalOpen(true)}
                    disabled={verificandoInicio || iniciandoTorneo}
                  >
                    Rearmar zonas desde cero
                  </button>
                </div>

                <div className="pc-footer-actions">
                  {/* Botón de salida de emergencia (disponible siempre que haya plan de emergencia y no haya zonas manuales) */}
                  {!conflictosBloqueo.some((c) => c.partidosSinHorario.some((p) => p.motivo === 'ZONA_MANUAL_INCOMPLETA')) &&
                    Boolean(planEmergenciaId) && (
                      <button
                        type="button"
                        className="pm-button pm-danger-secondary pc-emergency-action"
                        onClick={() => setConfirmarEmergenciaModalOpen(true)}
                        disabled={verificandoInicio || iniciandoTorneo}
                      >
                        Iniciar dejando {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)} pendientes
                      </button>
                    )}

                  <button
                    type="button"
                    className="pm-button"
                    onClick={() => {
                      setConflictosBloqueo(null);
                      setPreCheckAprobado(false);
                    }}
                    disabled={verificandoInicio || iniciandoTorneo}
                  >
                    Cerrar
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePreCheckInicio(true)}
                    disabled={verificandoInicio || iniciandoTorneo}
                    className="pm-button pm-primary"
                  >
                    <RefreshCw size={14} className={verificandoInicio ? 'pc-spin' : ''} />
                    {verificandoInicio ? 'Verificando…' : 'Volver a verificar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal de confirmación de Inicio de Emergencia */}
      {confirmarEmergenciaModalOpen && conflictosBloqueo && (
        <div className="pm-overlay pm-confirm-overlay">
          <div className="pm-modal pc-modal pc-emergency" role="dialog" aria-modal="true" aria-labelledby="pc-emergency-title">
            <div className="pm-header pc-danger-header">
              <AlertTriangle size={24} />
              <h3 id="pc-emergency-title" className="pm-title pc-title">
                ¿Iniciar torneo con partidos pendientes?
              </h3>
            </div>

            <div className="pm-body">
              <p className="pc-copy">
                Estás por iniciar el torneo dejando{' '}
                <strong className="pc-danger">
                  {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)}{' '}
                  {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) === 1
                    ? 'partido sin cancha ni horario asignado'
                    : 'partidos sin cancha ni horario asignado'}
                </strong>{' '}
                en las siguientes categorías:
              </p>

              <div className="pc-notice pc-danger-notice">
                <ul className="pc-summary-list">
                  {conflictosBloqueo
                    .filter((c) => c.partidosSinHorario?.length > 0)
                    .map((c) => (
                      <li key={c.categoriaId}>
                        <strong>{c.nombreCategoria}:</strong> {c.partidosSinHorario.length}{' '}
                        {c.partidosSinHorario.length === 1 ? 'partido' : 'partidos'}
                      </li>
                    ))}
                </ul>
              </div>

              <p className="pc-muted pc-spaced">
                Las zonas y cuadros se generarán normalmente y el torneo pasará a estado <strong>EN CURSO</strong>. Podrás asignarles cancha y horario a estos partidos en cualquier momento desde el panel de administración en tiempo real.
              </p>

            </div>
            <div className="pm-footer">
              <button
                type="button"
                className="pm-button"
                onClick={() => setConfirmarEmergenciaModalOpen(false)}
                disabled={iniciandoTorneo}
              >
                Volver a intentar resolver
              </button>
              <button
                type="button"
                className="pm-button pm-primary pm-destructive"
                onClick={executeIniciarTorneoEmergencia}
                disabled={iniciandoTorneo}
              >
                {iniciandoTorneo ? 'Iniciando torneo…' : 'Iniciar de todas formas'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal de confirmación para rearmar zonas desde cero */}
      {confirmarResorteoModalOpen && (
        <div className="pm-overlay pm-confirm-overlay">
          <div className="pm-modal pc-modal pc-redraw-modal" role="dialog" aria-modal="true" aria-labelledby="pc-redraw-title">
            <div className="pm-header pc-danger-header">
              <AlertTriangle size={24} />
              <h3 id="pc-redraw-title" className="pm-title pc-title">
                ¿Rearmar todas las zonas?
              </h3>
            </div>
            <div className="pm-body">
              <p className="pc-copy">
                Se descartan las zonas actuales y se vuelven a armar con las parejas y los horarios cargados ahora. Si no cambiaste nada, vas a obtener las mismas zonas.
              </p>
            </div>
            <div className="pm-footer">
              <button
                type="button"
                className="pm-button"
                onClick={() => setConfirmarResorteoModalOpen(false)}
                disabled={verificandoInicio}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="pm-button pm-primary pm-destructive"
                onClick={async () => {
                  setConfirmarResorteoModalOpen(false);
                  await handlePreCheckInicio(false, true);
                }}
                disabled={verificandoInicio}
              >
                {verificandoInicio ? 'Rearmando…' : 'Rearmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
