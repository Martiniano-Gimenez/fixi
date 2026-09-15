import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
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
  ListOrdered,
  GitBranch,
  MoreVertical,
} from 'lucide-react';
import InlineDisponibilidadEditor from '../../components/InlineDisponibilidadEditor';
import CruceResolver from '../../components/CruceResolver';
import PartidosPendientesSection from '../../components/PartidosPendientesSection';
import OrdenDomingoModal from '../../components/OrdenDomingoModal';
import { estadoLabel } from '../../utils/estadoLabels';

function CruceDetalles({ partido, categoriaId, torneoId, onApplied }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showOtrosViables, setShowOtrosViables] = useState(false);
  const [applyingSlotId, setApplyingSlotId] = useState(null);
  const [error, setError] = useState('');
  const p = partido;

  const slotsViables = p.slotsViables || [];
  const viernesViables = slotsViables.filter((s) => s.startsWith('Viernes'));
  const sabadoViables = slotsViables.filter((s) => s.startsWith('Sabado'));

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

  const renderSlotChip = (slotId) => {
    const isThisApplying = applyingSlotId === slotId;
    const hora = slotId.split('-')[1];
    return (
      <button
        key={slotId}
        type="button"
        disabled={Boolean(applyingSlotId)}
        className="slot-chip"
        style={{
          padding: '0.2rem 0.45rem',
          fontSize: '11px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
        }}
        onClick={() => handleApplySlot(slotId)}
        title={`Asignar ${slotId} a ambas parejas y resolver cruce (1 click)`}
      >
        {isThisApplying ? (
          <>
            <Loader2 size={10} className="spin" /> {hora}
          </>
        ) : (
          hora
        )}
      </button>
    );
  };

  return (
    <div style={{ marginTop: '0.35rem' }}>
      <button
        type="button"
        className="btn-link-action"
        style={{
          padding: '0.15rem 0',
          fontSize: '11px',
          color: 'var(--color-text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3rem',
        }}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <Info size={12} />
        <span>{isOpen ? 'Ocultar detalles' : 'Detalles y opciones manuales'}</span>
        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {isOpen && (
        <div
          style={{
            marginTop: '0.4rem',
            padding: '0.5rem 0.65rem',
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          }}
        >
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
            {p.motivo === 'SIN_FRANJA_COMUN'
              ? 'Ambas parejas no tienen ninguna ventana horaria en común.'
              : 'Coinciden en disponibilidad pero las canchas están 100% ocupadas en esa franja.'}
          </div>

          {p.parejaMasRestringidaNombre && (
            <div style={{ fontSize: 'var(--font-size-xs)' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>Pareja más restringida a contactar: </span>
              <strong style={{ color: 'var(--color-text)' }}>{p.parejaMasRestringidaNombre}</strong>{' '}
              <span style={{ color: 'var(--color-text-secondary)' }}>
                ({p.parejaMasRestringidaSlots} turnos, {p.parejaMasRestringidaOpciones}{' '}
                {p.parejaMasRestringidaOpciones === 1 ? 'franja' : 'franjas'})
              </span>
            </div>
          )}

          {slotsViables.length > 0 && (
            <div style={{ marginTop: '0.2rem' }}>
              <button
                type="button"
                className="btn-link-action"
                style={{
                  padding: 0,
                  fontSize: '11px',
                  color: 'var(--color-text-secondary)',
                  textDecoration: 'underline',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
                onClick={() => setShowOtrosViables((prev) => !prev)}
              >
                {showOtrosViables
                  ? 'Ocultar otros turnos viables del club'
                  : `+ Ver otros turnos viables con cancha libre (${slotsViables.length})`}
              </button>

              {showOtrosViables && (
                <div
                  style={{
                    marginTop: '0.35rem',
                    padding: '0.45rem',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div style={{ fontSize: '10.5px', color: 'var(--color-text-secondary)', marginBottom: '0.35rem', fontStyle: 'italic' }}>
                    Hacé clic en cualquier turno para asignarlo a ambas parejas y resolver el cruce:
                  </div>

                  {error && (
                    <div className="error-message" style={{ fontSize: '11px', margin: '0.2rem 0' }}>
                      {error}
                    </div>
                  )}

                  {viernesViables.length > 0 && (
                    <div style={{ marginBottom: '0.3rem' }}>
                      <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.2rem' }}>
                        Viernes:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                        {viernesViables.map(renderSlotChip)}
                      </div>
                    </div>
                  )}

                  {sabadoViables.length > 0 && (
                    <div>
                      <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.2rem' }}>
                        Sábado:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                        {sabadoViables.map(renderSlotChip)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {p.parejaMasRestringidaId && (
            <div style={{ marginTop: '0.2rem' }}>
              <Link
                to={`/admin/torneos/${torneoId}/categorias/${categoriaId}/parejas?parejaId=${p.parejaMasRestringidaId}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  fontSize: '11px',
                  color: 'var(--color-primary)',
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Ver disponibilidad completa en Gestionar Parejas →
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
  const navigate = useNavigate();

  const [torneo, setTorneo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modales y estados
  const [copiado, setCopiado] = useState(false);
  const [nuevaCatModalOpen, setNuevaCatModalOpen] = useState(false);
  const [nombreNuevaCat, setNombreNuevaCat] = useState('');
  const [creandoCat, setCreandoCat] = useState(false);

  const [categoriaAEliminar, setCategoriaAEliminar] = useState(null);
  const [eliminandoCat, setEliminandoCat] = useState(false);

  const [reiniciarModalOpen, setReiniciarModalOpen] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);
  const [ordenDomingoModalOpen, setOrdenDomingoModalOpen] = useState(false);
  const [menuAccionesOpen, setMenuAccionesOpen] = useState(false);
  const menuAccionesRef = useRef(null);

  useEffect(() => {
    if (!menuAccionesOpen) return;
    const handleClickOutside = (event) => {
      if (menuAccionesRef.current && !menuAccionesRef.current.contains(event.target)) {
        setMenuAccionesOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [menuAccionesOpen]);

  // Editar Torneo y Fecha
  const [editTorneoModalOpen, setEditTorneoModalOpen] = useState(false);
  const [editNombre, setEditNombre] = useState('');
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
  const [hayCambiosGuardados, setHayCambiosGuardados] = useState(false);
  const [resultadoInicio, setResultadoInicio] = useState(null);
  const [undoAction, setUndoAction] = useState(null);
  const [confirmarResorteoModalOpen, setConfirmarResorteoModalOpen] = useState(false);
  const [avisoSesionReiniciada, setAvisoSesionReiniciada] = useState(false);

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

  const handleCopyLink = () => {
    if (!torneo?.slug) return;
    const url = `${window.location.origin}/torneo/${torneo.slug}`;
    navigator.clipboard.writeText(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
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
    if (!torneo) return;
    setEditNombre(torneo.nombre || '');
    if (torneo.fecha) {
      const match = typeof torneo.fecha === 'string' && torneo.fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        setEditFecha(`${match[1]}-${match[2]}-${match[3]}`);
      } else {
        const d = new Date(torneo.fecha);
        if (!isNaN(d.getTime())) {
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
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
    if (!editNombre.trim()) {
      setEditTorneoError('El nombre del torneo es obligatorio.');
      return;
    }
    setGuardandoTorneo(true);
    setEditTorneoError('');
    try {
      const updated = await api.put(`/torneos/${torneo.id}`, {
        nombre: editNombre.trim(),
        fecha: editFecha || null,
      });
      setTorneo((prev) => ({ ...prev, ...updated }));
      setEditTorneoModalOpen(false);
    } catch (err) {
      setEditTorneoError(err.message || 'Error al actualizar el torneo.');
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
      setAvisoSesionReiniciada(Boolean(res.sesionReiniciada));

      if (res.grillaOrganizador) {
        setGrillaOrganizador(res.grillaOrganizador);
      }
      if (res.bloqueado) {
        const conflictos = res.conflictos || [];
        const total = conflictos.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0);
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

  if (loading) return <div className="loading">Cargando torneo...</div>;
  if (error || !torneo) return <div className="error-message">{error || 'Torneo no encontrado'}</div>;

  const categoriasBorrador = (torneo.categorias || []).filter((c) => c.estado === 'BORRADOR');
  const puedeIniciar = categoriasBorrador.length > 0 && categoriasBorrador.some((c) => c.parejas?.length >= 2);

  return (
    <div className="page">
      {/* Volver */}
      <div style={{ marginBottom: '1rem' }}>
        <Link
          to="/admin"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          <ChevronLeft size={16} /> Volver a Mis Torneos
        </Link>
      </div>

      {/* Header del Torneo */}
      <div className="card" style={{ marginBottom: '1.5rem', background: 'var(--color-surface-elevated)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              {!isEditingNombre ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h1
                    style={{
                      margin: 0,
                      fontSize: 'var(--font-size-2xl)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                    onClick={handleStartEditingNombre}
                    title="Hacé click para cambiar el nombre del torneo"
                    className="editable-title-hover"
                  >
                    <span>{torneo.nombre}</span>
                  </h1>
                  <button
                    type="button"
                    onClick={handleStartEditingNombre}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.25rem',
                      color: 'var(--color-text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    className="hover-card"
                    title="Cambiar nombre del torneo"
                    aria-label="Cambiar nombre del torneo"
                  >
                    <Edit2 size={14} style={{ color: 'var(--color-primary)' }} />
                  </button>
                  <span className={`badge badge-${torneo.estado.toLowerCase()}`}>{estadoLabel(torneo.estado)}</span>
                </div>
              ) : (
                <form
                  onSubmit={handleSaveNombreInline}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    flexWrap: 'wrap',
                    width: '100%',
                    maxWidth: '520px',
                  }}
                >
                  <input
                    ref={inlineNombreInputRef}
                    type="text"
                    value={nombreInline}
                    onChange={(e) => {
                      setNombreInline(e.target.value);
                      if (nombreInlineError) setNombreInlineError('');
                    }}
                    disabled={guardandoNombreInline}
                    placeholder="Nombre del torneo..."
                    style={{
                      fontSize: 'var(--font-size-xl)',
                      fontWeight: 700,
                      padding: '0.35rem 0.65rem',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-surface)',
                      color: 'var(--color-text)',
                      border: '1px solid var(--color-primary)',
                      outline: 'none',
                      boxShadow: '0 0 0 2px rgba(0, 208, 132, 0.2)',
                      flex: '1 1 200px',
                      minWidth: 0,
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        handleCancelEditingNombre();
                      }
                    }}
                  />
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={guardandoNombreInline || !nombreInline.trim() || nombreInline.trim() === torneo.nombre}
                      title="Guardar nombre (Enter)"
                      style={{
                        padding: '0.4rem 0.65rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: 'var(--font-size-sm)',
                      }}
                    >
                      {guardandoNombreInline ? (
                        <RefreshCw size={14} className="spin" />
                      ) : (
                        <Check size={15} strokeWidth={2.5} />
                      )}
                      <span>Guardar</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleCancelEditingNombre}
                      disabled={guardandoNombreInline}
                      title="Cancelar (Esc)"
                      style={{
                        padding: '0.4rem 0.65rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: 'var(--font-size-sm)',
                      }}
                    >
                      <X size={15} />
                      <span>Cancelar</span>
                    </button>
                  </div>
                  {nombreInlineError && (
                    <div style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-xs)', width: '100%', marginTop: '0.2rem' }}>
                      {nombreInlineError}
                    </div>
                  )}
                </form>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1.25rem',
                color: 'var(--color-text-secondary)',
                fontSize: 'var(--font-size-sm)',
                marginTop: '0.6rem',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={handleOpenEditTorneo}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  background: 'transparent',
                  border: '1px dashed var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.2rem 0.5rem',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 'inherit',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s ease',
                }}
                className="hover-card"
                title="Click para cambiar fecha o nombre del torneo"
              >
                <Calendar size={15} style={{ color: 'var(--color-primary)' }} />
                <span>
                  {torneo.fecha
                    ? new Date(torneo.fecha).toLocaleDateString('es-AR', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })
                    : 'Fecha a confirmar'}
                </span>
                <Edit2 size={12} style={{ opacity: 0.7, marginLeft: '0.2rem' }} />
              </button>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Layers size={15} />
                {torneo.categorias?.length || 0} {torneo.categorias?.length === 1 ? 'categoría' : 'categorías'}
              </span>
            </div>
          </div>

          {/* Acciones principales */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleOpenEditTorneo}
              title="Editar nombre y fecha del torneo"
            >
              <Edit2 size={15} /> Editar Torneo
            </button>

            <button
              type="button"
              className="btn-ghost"
              onClick={handleCopyLink}
              title="Copiar link público para compartir con jugadores"
            >
              {copiado ? <Check size={16} style={{ color: 'var(--color-primary)' }} /> : <Copy size={16} />}
              {copiado ? 'Link Copiado!' : 'Copiar Link'}
            </button>

            <a
              href={`/torneo/${torneo.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
              title="Abrir vista pública en nueva pestaña"
            >
              <Eye size={16} /> Ver Público
            </a>

            {torneo.estado !== 'BORRADOR' && (
              <div className="actions-menu" ref={menuAccionesRef}>
                <button
                  type="button"
                  className={`actions-menu-btn ${menuAccionesOpen ? 'active' : ''}`}
                  onClick={() => setMenuAccionesOpen((prev) => !prev)}
                  title="Más opciones"
                  aria-label="Más opciones"
                  aria-expanded={menuAccionesOpen}
                >
                  <MoreVertical size={16} />
                </button>

                {menuAccionesOpen && (
                  <div className="actions-menu-panel" role="menu">
                    <button
                      type="button"
                      className="actions-menu-item danger"
                      role="menuitem"
                      onClick={() => {
                        setMenuAccionesOpen(false);
                        setReiniciarModalOpen(true);
                      }}
                    >
                      <RotateCcw size={15} /> Reiniciar Torneo
                    </button>
                  </div>
                )}
              </div>
            )}

            {torneo.estado === 'EN_CURSO' && (
              <Link
                to={`/admin/torneos/${torneo.id}/en-vivo`}
                className="btn-primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  width: 'auto',
                  textDecoration: 'none',
                  background: 'linear-gradient(135deg, var(--color-primary), #00b372)',
                  boxShadow: '0 2px 8px rgba(0, 208, 132, 0.3)',
                  fontWeight: 700,
                }}
                title="Abrir panel de control en vivo y reprogramación por lluvia"
              >
                <Activity size={16} /> Día de Torneo (En Vivo)
              </Link>
            )}

            {puedeIniciar && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => handlePreCheckInicio()}
                disabled={verificandoInicio}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
              >
                {verificandoInicio ? (
                  <>
                    <RefreshCw size={16} className="spin" /> Verificando turnos...
                  </>
                ) : (
                  <>
                    <Play size={16} /> Iniciar Torneo y Asignar Horarios
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>


      {/* Sección de partidos pendientes de horario si el torneo está en curso */}
      {torneo.estado === 'EN_CURSO' && (
        <PartidosPendientesSection
          torneoId={torneo.id}
          torneoEstado={torneo.estado}
          onPartidosActualizados={fetchData}
        />
      )}

      {/* Listado de Categorías */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={22} style={{ color: 'var(--color-primary)' }} />
            Categorías del Torneo
          </h2>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {torneo.estado === 'BORRADOR' && torneo.categorias && torneo.categorias.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setOrdenDomingoModalOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
            >
              <ListOrdered size={16} /> Orden del Domingo
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={() => setNuevaCatModalOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
          >
            <Plus size={16} /> Nueva Categoría
          </button>
        </div>
      </div>

      {(!torneo.categorias || torneo.categorias.length === 0) ? (
        <div className="empty-state" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
          <Layers size={44} style={{ color: 'var(--color-text-secondary)', marginBottom: '0.75rem', opacity: 0.5 }} />
          <h3 style={{ margin: '0 0 0.4rem 0' }}>No hay categorías cargadas</h3>
          <p style={{ margin: '0 0 1.25rem 0', color: 'var(--color-text-secondary)' }}>
            Comenzá agregando las categorías que participarán en este torneo (ej. 4ta, 6ta, 8va, Damas 5ta).
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setNuevaCatModalOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
          >
            <Plus size={16} /> Agregar Categoría
          </button>
        </div>
      ) : (
        <div className="torneos-grid">
          {torneo.categorias.map((cat) => {
            const totalParejas = cat.parejas?.length || 0;
            const totalZonas = cat.zonas?.length || 0;
            const totalPartidos = cat.partidos?.length || 0;
            const partidosFinalizados = (cat.partidos || []).filter((p) => p.estado === 'FINALIZADO').length;

            return (
              <div
                key={cat.id}
                className="torneo-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  cursor: 'default',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <h3 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>{cat.nombre}</h3>
                    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                      {cat.ordenDomingo !== null && cat.ordenDomingo !== undefined && (
                        <span className="badge badge-info" title="Prioridad de arranque del domingo">
                          Dom #{cat.ordenDomingo}
                        </span>
                      )}
                      {cat.estado !== torneo.estado && (
                        <span className={`badge badge-${cat.estado.toLowerCase()}`}>{estadoLabel(cat.estado)}</span>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      color: 'var(--color-text-secondary)',
                      fontSize: 'var(--font-size-sm)',
                      marginTop: '0.75rem',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Users size={15} style={{ color: 'var(--color-primary)' }} />
                      <strong style={{ color: 'var(--color-text)' }}>{totalParejas}</strong> parejas
                    </span>
                    {totalZonas > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Layers size={15} />
                        <strong style={{ color: 'var(--color-text)' }}>{totalZonas}</strong> zonas
                      </span>
                    )}
                    {totalPartidos > 0 && (
                      <span style={{ fontSize: 'var(--font-size-xs)' }}>
                        {partidosFinalizados}/{totalPartidos} jugados
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid var(--color-border)',
                    gap: '0.5rem',
                  }}
                >
                  <Link
                    to={`/admin/torneos/${torneo.id}/categorias/${cat.id}`}
                    className="btn-primary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      flex: 1,
                      justifyContent: 'center',
                      padding: '0.45rem 0.75rem',
                      fontSize: 'var(--font-size-sm)',
                      textDecoration: 'none',
                    }}
                  >
                    <Settings size={15} /> Administrar
                  </Link>

                  <Link
                    to={`/admin/torneos/${torneo.id}/categorias/${cat.id}/eliminatoria`}
                    className="btn-secondary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.45rem 0.65rem',
                      fontSize: 'var(--font-size-sm)',
                      textDecoration: 'none',
                    }}
                    title="Ver Bracket Eliminatorio"
                  >
                    <GitBranch size={15} /> Bracket
                  </Link>

                  <button
                    type="button"
                    className="btn-danger"
                    title="Eliminar categoría"
                    onClick={() => setCategoriaAEliminar(cat)}
                    style={{
                      padding: '0.45rem 0.6rem',
                      background: 'transparent',
                      borderColor: 'transparent',
                    }}
                  >
                    <Trash2 size={16} style={{ color: 'var(--color-danger)' }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal para editar torneo y fecha */}
      {editTorneoModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Edit2 size={20} style={{ color: 'var(--color-primary)' }} /> Editar Nombre y Fecha del Torneo
            </h3>

            {editTorneoError && (
              <div className="error-message" style={{ marginBottom: '1rem' }}>
                {editTorneoError}
              </div>
            )}

            <form onSubmit={handleGuardarTorneo}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                  Nombre del torneo:
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Ej: Pares Agosto 2026"
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                  Fecha de inicio (Viernes):
                </label>
                <input
                  type="date"
                  value={editFecha}
                  onChange={(e) => setEditFecha(e.target.value)}
                  style={{ width: '100%' }}
                />
                <p style={{ margin: '0.4rem 0 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  Seleccioná el día viernes en que inicia el torneo. Los partidos de Viernes y Sábado se programarán de acuerdo a esta fecha.
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditTorneoModalOpen(false)}
                  disabled={guardandoTorneo}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={guardandoTorneo || !editNombre.trim()}
                >
                  {guardandoTorneo ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal para crear categoría */}
      {nuevaCatModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Plus size={20} style={{ color: 'var(--color-primary)' }} /> Nueva Categoría
            </h3>

            <form onSubmit={handleCrearCategoria}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 'var(--font-size-sm)' }}>
                  Nombre de la categoría:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: 4ta, 6ta, 8va, Damas 5ta..."
                  value={nombreNuevaCat}
                  onChange={(e) => setNombreNuevaCat(e.target.value)}
                  autoFocus
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setNuevaCatModalOpen(false);
                    setNombreNuevaCat('');
                  }}
                  disabled={creandoCat}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={creandoCat || !nombreNuevaCat.trim()}>
                  {creandoCat ? 'Creando...' : 'Crear Categoría'}
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
        <div className="modal-overlay">
          {preCheckAprobado ? (
            <div className="modal-content" style={{ maxWidth: '560px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <CheckCircle size={28} color="var(--color-success)" style={{ flexShrink: 0 }} />
                <div>
                  <h3 style={{ margin: 0, color: 'var(--color-success)', fontSize: '1.25rem' }}>
                    ¡Listo para iniciar! 0 conflictos
                  </h3>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                    Todos los cruces y horarios son 100% compatibles
                  </span>
                </div>
              </div>

              <div
                style={{
                  padding: '0.85rem 1rem',
                  background: 'rgba(34, 197, 94, 0.08)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  marginBottom: '1.25rem',
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text)',
                }}
              >
                Se verificó la asignación global de todas las categorías en borrador. No existen colisiones de cancha ni incompatibilidades horarias.
              </div>

              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                Al confirmar, se guardarán las zonas y los horarios de cada partido de forma definitiva en el torneo.
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
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
                  className="btn-primary"
                  onClick={executeIniciarTorneo}
                  disabled={iniciandoTorneo}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <Play size={16} />
                  {iniciandoTorneo ? 'Iniciando torneo...' : 'Iniciar Torneo'}
                </button>
              </div>
            </div>
          ) : (
            <div
              className="modal-content"
              style={{
                maxWidth: '720px',
                maxHeight: '88vh',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '1rem',
                  paddingBottom: '0.6rem',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem' }}>
                    <AlertTriangle size={22} /> Incompatibilidades detectadas
                  </h3>
                  {conteoInicialConflictos !== null &&
                    conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) < conteoInicialConflictos && (
                      <span style={{ fontSize: '11.5px', color: 'var(--color-success)', fontWeight: 600, marginTop: '2px', display: 'block' }}>
                        ✓ ¡Resolviste {conteoInicialConflictos - conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)} {conteoInicialConflictos - conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) === 1 ? 'conflicto' : 'conflictos'}!
                      </span>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  {categoriasConflictosOrdenadas.length > 1 && (
                    <button
                      type="button"
                      className="btn-link-action"
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--color-text-secondary)',
                        whiteSpace: 'nowrap',
                        padding: '0.2rem 0.4rem',
                      }}
                      onClick={handleToggleAllConflictos}
                    >
                      {allConflictosExpanded ? 'Colapsar todas' : 'Expandir todas'}
                    </button>
                  )}
                  <span className="badge badge-danger" style={{ fontSize: 'var(--font-size-xs)' }}>
                    {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)}{' '}
                    {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) === 1 ? 'pendiente' : 'pendientes'}
                  </span>
                </div>
              </div>

              {avisoSesionReiniciada && (
                <div
                  style={{
                    padding: '0.6rem 0.85rem',
                    marginBottom: '0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(59, 130, 246, 0.12)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    color: '#3b82f6',
                    fontSize: 'var(--font-size-xs)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Info size={16} style={{ flexShrink: 0 }} />
                  <span>
                    El servidor se reinició o la sesión expiró. Se recalculó la vista previa con los horarios guardados.
                  </span>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  marginBottom: '0.75rem',
                }}
              >
                {categoriasConflictosOrdenadas.map((c) => {
                  const isExpanded = expandedCategoriasConflictos.has(c.categoriaId);

                  return (
                    <div
                      key={c.categoriaId}
                      style={{
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)',
                        overflow: 'hidden',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                      }}
                    >
                      {/* Header del acordeón */}
                      <div
                        style={{
                          padding: '0.65rem 0.85rem',
                          background: 'var(--color-surface-elevated)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: 'pointer',
                          userSelect: 'none',
                          borderBottom: isExpanded ? '1px solid var(--color-border)' : 'none',
                          transition: 'background 150ms ease',
                        }}
                        onClick={() => toggleCategoriaConflicto(c.categoriaId)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <Layers size={16} style={{ color: 'var(--color-primary)' }} />
                          <strong style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
                            {c.nombreCategoria}
                          </strong>
                          <span
                            className="badge"
                            style={{
                              background: 'rgba(255, 255, 255, 0.08)',
                              fontSize: '11px',
                              padding: '2px 6px',
                              fontWeight: 600,
                            }}
                          >
                            {c.partidosSinHorario.length} {c.partidosSinHorario.length === 1 ? 'conflicto' : 'conflictos'}
                          </span>

                          {c.tieneCriticos && (
                            <span
                              style={{
                                fontSize: '10.5px',
                                background: 'rgba(239, 68, 68, 0.15)',
                                color: '#ef4444',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                              }}
                            >
                              <AlertTriangle size={11} /> Muy restringido
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                            {isExpanded ? 'Ocultar' : 'Ver conflictos'}
                          </span>
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                      </div>

                      {/* Cuerpo expandido */}
                      {isExpanded && (
                        <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                          {c.partidosSinHorario.map((p, idx) => (
                            <div
                              key={idx}
                              style={{
                                padding: '0.65rem 0.75rem',
                                background: 'var(--color-bg-input)',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--color-border)',
                                borderLeft: `3px solid ${
                                  p.motivo === 'SIN_FRANJA_COMUN'
                                    ? '#ef4444'
                                    : p.motivo === 'ZONA_MANUAL_INCOMPLETA'
                                    ? '#eab308'
                                    : '#f59e0b'
                                }`,
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.3rem' }}>
                                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                                  {p.zona}
                                </span>
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: '11px',
                                    padding: '2px 6px',
                                    background:
                                      p.motivo === 'SIN_FRANJA_COMUN'
                                        ? 'rgba(239, 68, 68, 0.15)'
                                        : p.motivo === 'ZONA_MANUAL_INCOMPLETA'
                                        ? 'rgba(234, 179, 8, 0.15)'
                                        : 'rgba(245, 158, 11, 0.15)',
                                    color:
                                      p.motivo === 'SIN_FRANJA_COMUN'
                                        ? '#ef4444'
                                        : p.motivo === 'ZONA_MANUAL_INCOMPLETA'
                                        ? '#eab308'
                                        : '#f59e0b',
                                  }}
                                >
                                  {p.motivo === 'SIN_FRANJA_COMUN'
                                    ? 'Sin franja común'
                                    : p.motivo === 'ZONA_MANUAL_INCOMPLETA'
                                    ? 'Armado manual requerido'
                                    : 'Canchas saturadas'}
                                </span>
                              </div>

                              {p.motivo === 'ZONA_MANUAL_INCOMPLETA' ? (
                                <div>
                                  <div style={{ fontSize: 'var(--font-size-sm)', marginBottom: '0.35rem', color: 'var(--color-text)' }}>
                                    <strong>Incompatibilidad para formar grupo:</strong> Las parejas de la zona no tienen horarios comunes para completar el fixture.
                                  </div>

                                  {p.crucesIncompatibles && p.crucesIncompatibles.length > 0 && (
                                    <div style={{ marginBottom: '0.5rem', padding: '0.4rem 0.6rem', background: 'rgba(234, 179, 8, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#eab308', marginBottom: '0.2rem' }}>
                                        Incompatibilidad directa en el grupo:
                                      </div>
                                      {p.crucesIncompatibles.map((ci, idx) => (
                                        <div key={idx} style={{ fontSize: '11.5px', color: 'var(--color-text)', marginBottom: '0.15rem' }}>
                                          • <strong>{ci.p1}</strong> no coincide en ningún turno con <strong>{ci.p2}</strong>.
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
                                    Podés ampliar la disponibilidad de alguna de estas parejas con turnos libres o reestructurar la zona:
                                  </div>

                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.6rem' }}>
                                    {(p.parejasManuales || []).map((pm) => (
                                      <div
                                        key={pm.id}
                                        style={{
                                          padding: '0.35rem 0.5rem',
                                          background: 'var(--color-surface)',
                                          borderRadius: 'var(--radius-sm)',
                                          border: '1px solid var(--color-border)',
                                        }}
                                      >
                                        <div style={{ fontSize: 'var(--font-size-xs)', marginBottom: '0.2rem' }}>
                                          <strong>{pm.nombre}</strong> ({pm.slotsCount} {pm.slotsCount === 1 ? 'turno cargado' : 'turnos cargados'})
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

                                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <Link
                                      to={`/admin/torneos/${id}/categorias/${c.categoriaId}/parejas`}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.3rem',
                                        fontSize: 'var(--font-size-xs)',
                                        color: 'var(--color-primary)',
                                        textDecoration: 'none',
                                        fontWeight: 600,
                                      }}
                                    >
                                      Ir a Gestionar Parejas de {c.nombreCategoria} →
                                    </Link>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  {/* Título del cruce */}
                                  <div style={{ fontSize: 'var(--font-size-sm)', marginBottom: '0.25rem' }}>
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
                                  <CruceDetalles
                                    partido={p}
                                    categoriaId={c.categoriaId}
                                    torneoId={id}
                                    onApplied={handleCasiEstrellaApplied}
                                  />
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

              {/* Toast flotante de Deshacer (Undo) */}
              {undoAction && (
                <div
                  style={{
                    position: 'sticky',
                    bottom: '0.5rem',
                    zIndex: 20,
                    margin: '0.5rem 0',
                    padding: '0.6rem 0.85rem',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-success)',
                    borderRadius: 'var(--radius-sm)',
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-text)' }}>
                    <CheckCircle size={15} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                    <span>
                      Se aplicó <strong>{undoAction.label}</strong> a ambas parejas.
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{
                        padding: '0.25rem 0.6rem',
                        fontSize: '11px',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        color: 'var(--color-warning)',
                        borderColor: 'rgba(245, 158, 11, 0.4)',
                      }}
                      onClick={handleUndo}
                    >
                      <RotateCcw size={12} /> Deshacer
                    </button>
                    <button
                      type="button"
                      className="btn-link-action"
                      style={{ padding: '0.2rem', color: 'var(--color-text-secondary)' }}
                      onClick={() => {
                        if (undoAction.timeoutId) clearTimeout(undoAction.timeoutId);
                        setUndoAction(null);
                      }}
                      title="Cerrar aviso"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid var(--color-border)',
                }}
              >
                <div>
                  {hayCambiosGuardados && (
                    <span
                      style={{
                        fontSize: '11.5px',
                        color: 'var(--color-warning)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontWeight: 600,
                      }}
                    >
                      <AlertTriangle size={13} />
                      Hay cambios guardados. Hacé clic en "Volver a verificar".
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn-link-action"
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-muted)',
                      textDecoration: 'underline',
                      padding: '0.2rem 0.4rem',
                      whiteSpace: 'nowrap',
                    }}
                    onClick={() => setConfirmarResorteoModalOpen(true)}
                    disabled={verificandoInicio || iniciandoTorneo}
                  >
                    Re-sortear zonas desde cero
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {/* Botón de salida de emergencia (disponible siempre que haya plan de emergencia y no haya zonas manuales) */}
                  {!conflictosBloqueo.some((c) => c.partidosSinHorario.some((p) => p.motivo === 'ZONA_MANUAL_INCOMPLETA')) &&
                    Boolean(planEmergenciaId) && (
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{
                          color: 'var(--color-warning)',
                          borderColor: 'rgba(245, 158, 11, 0.5)',
                          fontSize: 'var(--font-size-xs)',
                          fontWeight: 600,
                          padding: '0.4rem 0.75rem',
                          whiteSpace: 'nowrap',
                        }}
                        onClick={() => setConfirmarEmergenciaModalOpen(true)}
                        disabled={verificandoInicio || iniciandoTorneo}
                      >
                        Iniciar dejando {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)} pendientes
                      </button>
                    )}

                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: 'var(--font-size-xs)', padding: '0.4rem 0.8rem', whiteSpace: 'nowrap' }}
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
                    className="btn-primary"
                    onClick={() => handlePreCheckInicio(true)}
                    disabled={verificandoInicio || iniciandoTorneo}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontSize: 'var(--font-size-xs)',
                      padding: '0.4rem 0.85rem',
                      whiteSpace: 'nowrap',
                      fontWeight: 600,
                    }}
                  >
                    <RefreshCw size={14} className={verificandoInicio ? 'animate-spin' : ''} />
                    {verificandoInicio ? 'Verificando...' : 'Volver a verificar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal de confirmación de Inicio de Emergencia */}
      {confirmarEmergenciaModalOpen && conflictosBloqueo && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '540px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem', color: 'var(--color-warning)' }}>
              <AlertTriangle size={24} />
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-text)' }}>
                ¿Iniciar torneo con partidos pendientes?
              </h3>
            </div>

            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '0.85rem', lineHeight: 1.4 }}>
              Estás por iniciar el torneo dejando{' '}
              <strong style={{ color: 'var(--color-warning)' }}>
                {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)}{' '}
                {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) === 1
                  ? 'partido sin cancha ni horario asignado'
                  : 'partidos sin cancha ni horario asignado'}
              </strong>{' '}
              en las siguientes categorías:
            </p>

            <div
              style={{
                padding: '0.75rem 1rem',
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '1rem',
                fontSize: 'var(--font-size-sm)',
                border: '1px solid var(--color-border)',
              }}
            >
              <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
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

            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '1.5rem', lineHeight: 1.4 }}>
              Las zonas y cuadros se generarán normalmente y el torneo pasará a estado <strong>EN CURSO</strong>. Podrás asignarles cancha y horario a estos partidos en cualquier momento desde el panel de administración en tiempo real.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmarEmergenciaModalOpen(false)}
                disabled={iniciandoTorneo}
              >
                Volver a intentar resolver
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: 'var(--color-warning)', color: '#000', fontWeight: 600 }}
                onClick={executeIniciarTorneoEmergencia}
                disabled={iniciandoTorneo}
              >
                {iniciandoTorneo ? 'Iniciando torneo...' : 'Iniciar de todas formas'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal de confirmación de Re-sorteo de Zonas desde cero */}
      {confirmarResorteoModalOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem', color: 'var(--color-danger)' }}>
              <AlertTriangle size={24} />
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-text)' }}>
                ¿Re-sortear y mezclar todas las zonas?
              </h3>
            </div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              Esta acción descartará la distribución actual de parejas y volverá a sortear todas las zonas de las categorías desde cero en base a las disponibilidades actuales. Se reiniciará el avance de los cruces resueltos en esta sesión.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmarResorteoModalOpen(false)}
                disabled={verificandoInicio}
              >
                Cancelar, mantener zonas
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                onClick={async () => {
                  setConfirmarResorteoModalOpen(false);
                  await handlePreCheckInicio(false, true);
                }}
                disabled={verificandoInicio}
              >
                {verificandoInicio ? 'Re-sorteando...' : 'Sí, re-sortear todo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ordenDomingoModalOpen && (
        <OrdenDomingoModal
          isOpen={true}
          torneoId={torneo.id}
          categorias={torneo.categorias || []}
          onClose={() => setOrdenDomingoModalOpen(false)}
          onSaved={() => fetchData()}
        />
      )}
    </div>
  );
}
