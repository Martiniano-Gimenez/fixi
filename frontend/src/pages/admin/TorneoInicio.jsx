import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronLeft, ChevronUp, Info, Layers, Play, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';
import { APP_NAME } from '../../constants/app';
import InlineDisponibilidadEditor from '../../components/InlineDisponibilidadEditor';
import PropuestasZona from '../../components/PropuestasZona';
import PartidosZonaManual from '../../components/PartidosZonaManual';
import ElegirHorarioPartido from '../../components/ElegirHorarioPartido';
import { agruparSlotsEnRangos } from '../../utils/disponibilidadUtils';
import usePreCheckInicio from './usePreCheckInicio';

const ResolverPartidos = lazy(() => import('../../components/ResolverPartidos'));

const BADGE_POR_MOTIVO = {
  SIN_FRANJA_COMUN: 'Sin horarios en común',
  ZONA_MANUAL_INCOMPLETA: 'Sin horarios en común',
  PARTIDO_SIN_HORARIO: 'Sin horario',
  HORARIO_QUITADO: 'Horario quitado',
  SIN_CANCHA_DISPONIBLE: 'No entra en su horario',
};

export default function TorneoInicio() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [torneo, setTorneo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cerrandoInscripcion, setCerrandoInscripcion] = useState(false);
  const [errorInscripcion, setErrorInscripcion] = useState('');
  const cierreInscripcionRef = useRef(false);
  const [modoResolver, setModoResolver] = useState(false);
  const resolverRef = useRef(null);
  const tituloRef = useRef(null);
  const paginaRef = useRef(null);
  const barraRef = useRef(null);
  const cancelarInicioRef = useRef(null);

  const fetchData = useCallback(async (vigente = () => true) => {
    try {
      const data = await api.get(`/torneos/${id}`);
      if (!vigente()) return null;
      const puedeIniciar = data.categorias?.some((c) => c.estado === 'BORRADOR' && c.parejas?.length >= 2);
      if (!puedeIniciar) {
        navigate(`/admin/torneos/${id}`, { replace: true });
        return null;
      }
      setTorneo(data);
      return data;
    } catch (err) {
      if (vigente()) setError(err.message);
      return null;
    }
  }, [id, navigate]);

  const {
    verificandoInicio, iniciarModalOpen, setIniciarModalOpen, iniciandoTorneo,
    planEmergenciaId, conteoInicialConflictos, confirmarEmergenciaModalOpen,
    setConfirmarEmergenciaModalOpen, conflictosBloqueo, expandedCategoriasConflictos,
    grillaOrganizador, preCheckAprobado, revisionPreCheck, partidoManualAbierto,
    setPartidoManualAbierto, hayCambiosGuardados, setHayCambiosGuardados,
    confirmarResorteoModalOpen, setConfirmarResorteoModalOpen, avisoSesionReiniciada,
    avisoDestrabe, nominaCambio, partidosFijados, categoriasConflictosOrdenadas, allConflictosExpanded,
    toggleCategoriaConflicto, handleToggleAllConflictos, handlePreCheckInicio, aplicarPreCheck,
    executeIniciarTorneo, executeIniciarTorneoEmergencia,
  } = usePreCheckInicio(id, fetchData, () => navigate(`/admin/torneos/${id}`, { replace: true }));

  // Cargar la página una sola vez; los re-checks usan el estado más reciente.
  const preCheckRef = useRef(handlePreCheckInicio);
  useEffect(() => { preCheckRef.current = handlePreCheckInicio; });

  useEffect(() => {
    let activo = true;
    setLoading(true);
    setError('');
    fetchData(() => activo).then(async (data) => {
      if (!activo || !data) return;
      await preCheckRef.current();
    }).catch((err) => {
      if (activo) setError(err.message);
    }).finally(() => {
      if (activo) setLoading(false);
    });
    return () => { activo = false; };
  }, [fetchData]);

  useEffect(() => {
    const anterior = document.title;
    document.title = `Iniciar torneo | ${APP_NAME}`;
    tituloRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    return () => { document.title = anterior; };
  }, [id]);

  useEffect(() => {
    if (iniciarModalOpen) cancelarInicioRef.current?.focus();
  }, [iniciarModalOpen]);

  useEffect(() => {
    const barra = barraRef.current;
    const pagina = paginaRef.current;
    if (!barra || !pagina) return;
    const reservarEspacio = () => pagina.style.setProperty('--pc-barra-alto', `${barra.getBoundingClientRect().height}px`);
    reservarEspacio();
    const observer = new ResizeObserver(reservarEspacio);
    observer.observe(barra);
    return () => observer.disconnect();
  }, []);

  const totalConflictos = categoriasConflictosOrdenadas.reduce((total, c) => total + c.partidosSinHorario.length, 0);
  const totalCategorias = categoriasConflictosOrdenadas.length;
  const ocupado = loading || verificandoInicio || iniciandoTorneo || cerrandoInscripcion || Boolean(partidoManualAbierto?.fijando);
  const confirmacionAbierta = iniciarModalOpen || confirmarEmergenciaModalOpen || confirmarResorteoModalOpen;
  const cerrarRecorrido = () => {
    setModoResolver(false); setPartidoManualAbierto(null);
    (resolverRef.current || tituloRef.current)?.focus({ preventScroll: true });
  };
  const cerrarInscripcion = async () => {
    if (ocupado || confirmacionAbierta || cierreInscripcionRef.current) return;
    cierreInscripcionRef.current = true;
    setCerrandoInscripcion(true);
    setErrorInscripcion('');
    try {
      const res = await api.patch(`/torneos/${id}/inscripcion`, { abierta: false });
      setTorneo((prev) => ({ ...prev, inscripcionAbierta: res.inscripcionAbierta }));
      await handlePreCheckInicio(true);
      tituloRef.current?.focus({ preventScroll: true });
    } catch (err) {
      setErrorInscripcion(err.message || 'No pudimos cerrar la inscripción.');
    } finally {
      cierreInscripcionRef.current = false;
      setCerrandoInscripcion(false);
    }
  };

  // "Rearmar" e "Iniciar dejando N pendientes": en la barra fija desde 768 px; en el celular, al final de la página.
  const accionesSecundarias = (
    <>
      <button type="button" className="pm-button pm-danger-secondary" onClick={() => setConfirmarResorteoModalOpen(true)} disabled={ocupado || !revisionPreCheck || confirmacionAbierta}>
        Rearmar zonas desde cero
      </button>
      {totalConflictos > 0 && !conflictosBloqueo.some((c) => c.partidosSinHorario.some((p) => p.motivo === 'ZONA_MANUAL_INCOMPLETA')) && Boolean(planEmergenciaId) && (
        <button type="button" className="pm-button" onClick={() => setConfirmarEmergenciaModalOpen(true)} disabled={ocupado || confirmacionAbierta}>
          Iniciar dejando {totalConflictos} pendientes
        </button>
      )}
    </>
  );

  return (
    <div className="pc-page" ref={paginaRef}>
      <Link to={`/admin/torneos/${id}`} className="pc-page-back">
        <ChevronLeft size={18} aria-hidden="true" /> Volver al torneo
      </Link>
      <header className="pc-page-header">
        <div>
          <h1 ref={tituloRef} tabIndex={-1} className="pc-page-title">Iniciar torneo</h1>
          {torneo && <p className="pc-page-torneo">{torneo.nombre}</p>}
          <p className="pc-page-summary" role="status">
            {loading || verificandoInicio ? 'Verificando horarios…' : error ? error : nominaCambio ? 'Hay que revisar el armado de zonas' : preCheckAprobado ? 'Todo listo para iniciar' : conflictosBloqueo !== null
              ? `${totalConflictos} ${totalConflictos === 1 ? 'conflicto' : 'conflictos'} en ${totalCategorias} ${totalCategorias === 1 ? 'categoría' : 'categorías'}`
              : 'No se pudo verificar el torneo.'}
          </p>
          {conteoInicialConflictos !== null && totalConflictos < conteoInicialConflictos && (
            <span className="pc-resolved"><CheckCircle size={15} aria-hidden="true" />
              Resolviste {conteoInicialConflictos - totalConflictos} {conteoInicialConflictos - totalConflictos === 1 ? 'conflicto' : 'conflictos'}
            </span>
          )}
        </div>
        <div className="pc-page-secondary">
          {totalConflictos > 0 && !modoResolver && (
            <button ref={resolverRef} type="button" className="pm-button" disabled={ocupado || !revisionPreCheck || confirmacionAbierta}
              onClick={() => { setPartidoManualAbierto(null); setModoResolver(true); }}>
              Resolver de a uno
            </button>
          )}
          {totalCategorias > 1 && !modoResolver && (
            <button type="button" className="pm-button pc-compact" onClick={handleToggleAllConflictos}>
              {allConflictosExpanded ? 'Cerrar todas' : 'Abrir todas'}
            </button>
          )}
        </div>
      </header>

      <section className="pc-page-body" aria-label="Vista previa del inicio" aria-busy={loading || verificandoInicio}>
        {nominaCambio && (
          <div className="pc-notice" role="status">
            <p>Cambió la lista de parejas. Para seguir, rearmá las zonas desde cero.</p>
            <button type="button" className="pc-manual-button" disabled={ocupado}
              onClick={() => setConfirmarResorteoModalOpen(true)}>Rearmar las zonas desde cero</button>
          </div>
        )}
        {preCheckAprobado && (
          <div className="pc-success-note">Todos los partidos tienen cancha y horario.</div>
        )}
        {avisoSesionReiniciada && (
          <div className="pc-notice pc-session-notice">
            <Info size={16} className="pc-icon" />
            <span>
              Pasó mucho tiempo sin cambios o se reinició el servidor, así que volvimos a armar los horarios. Los horarios que agregaste a las parejas siguen guardados, pero revisá los partidos que habías fijado: pueden haber cambiado.
            </span>
          </div>
        )}

        {torneo?.inscripcionAbierta && (
          <div className="pc-notice pc-inscripcion-notice" role="status">
            <Info size={16} className="pc-icon" aria-hidden="true" />
            <div className="pc-notice-lines">
              <p className="pc-notice-line">La inscripción sigue abierta. Si se anota otra pareja, vas a tener que rearmar las zonas y se pierden los horarios fijados.</p>
              <div className="pc-manual-actions">
                <button type="button" className="pc-manual-button" disabled={ocupado || confirmacionAbierta} onClick={cerrarInscripcion}>
                  {cerrandoInscripcion ? 'Cerrando inscripción…' : 'Cerrar inscripción'}
                </button>
              </div>
              {errorInscripcion && <p className="pc-manual-error" role="alert">{errorInscripcion}</p>}
            </div>
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

        {modoResolver && (
          <Suspense fallback={<p className="pc-manual-status" role="status">Abriendo el recorrido…</p>}>
            <ResolverPartidos categorias={categoriasConflictosOrdenadas} torneoId={id} revision={revisionPreCheck}
              abierto={partidoManualAbierto} onAbiertoChange={setPartidoManualAbierto} onSaved={aplicarPreCheck}
              onRecheck={() => handlePreCheckInicio(true)} onCerrar={cerrarRecorrido} ocupado={ocupado || confirmacionAbierta} />
          </Suspense>
        )}
        {!modoResolver && <div className="pc-conflict-list">
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
                            {BADGE_POR_MOTIVO[p.motivo] || 'Sin horario'}
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

                            <PartidosZonaManual
                              key={`manual:${c.categoriaId}:${p.zonaId}`}
                              torneoId={id}
                              categoriaId={c.categoriaId}
                              zonaId={p.zonaId}
                              revision={revisionPreCheck}
                              partidos={p.partidosZona || []}
                              parejas={p.parejasManuales || []}
                              abierto={partidoManualAbierto}
                              onAbiertoChange={setPartidoManualAbierto}
                              onSaved={aplicarPreCheck}
                              onRecheck={() => handlePreCheckInicio(true)}
                            >
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
                            </PartidosZonaManual>
                          </div>
                        ) : (
                          <div>
                            <div className="pc-match-names">
                              {p.motivo === 'PARTIDO_SIN_HORARIO' ? <strong>{p.pareja1}</strong> : (
                                <><strong>{p.pareja1}</strong> vs <strong>{p.pareja2}</strong></>
                              )}
                            </div>
                            <ElegirHorarioPartido
                              key={`${c.categoriaId}:${p.zonaId}:${p.posicionEnRonda}`}
                              torneoId={id}
                              categoriaId={c.categoriaId}
                              zonaId={p.zonaId}
                              revision={revisionPreCheck}
                              partido={{ ...p, estado: 'PENDIENTE', origen: p.motivo === 'PARTIDO_SIN_HORARIO' ? p.pareja1 : undefined }}
                              parejas={p.parejasManuales || [
                                { id: p.pareja1Id, nombre: p.pareja1, slotIds: p.pareja1SlotIds || [] },
                                { id: p.pareja2Id, nombre: p.pareja2, slotIds: p.pareja2SlotIds || [] },
                              ]}
                              mostrarPartido={false}
                              partidosZona={p.partidosZona}
                              parejasZona={p.parejasZona}
                              abierto={partidoManualAbierto}
                              onAbiertoChange={setPartidoManualAbierto}
                              onSaved={aplicarPreCheck}
                              onRecheck={() => handlePreCheckInicio(true)}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="pc-manage-row">
                      <Link
                        to={`/admin/torneos/${id}/categorias/${c.categoriaId}/parejas`}
                        className="pc-manage-link"
                      >
                        Ver parejas de {c.nombreCategoria}
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>}

        {partidosFijados.length > 0 && (
          <details className="pc-fijados">
            <summary className="pc-manual-button">Horarios fijados ({partidosFijados.length})</summary>
            <ol className="pc-manual-partidos">
              {partidosFijados.map((fijo) => (
                <li key={`${fijo.categoriaId}:${fijo.zonaId}:${fijo.partido.posicionEnRonda}`} className="pc-manual-partido">
                  <p className="pc-manual-copy">{fijo.nombreCategoria} · {fijo.zona} · Partido {fijo.partido.posicionEnRonda}</p>
                  <ElegirHorarioPartido {...fijo} torneoId={id} revision={revisionPreCheck} abierto={partidoManualAbierto}
                    onAbiertoChange={setPartidoManualAbierto} onSaved={aplicarPreCheck} onRecheck={() => handlePreCheckInicio(true)} />
                </li>
              ))}
            </ol>
          </details>
        )}
        {hayCambiosGuardados && (
          <span className="pc-notice pc-danger-notice">
            <AlertTriangle size={13} />
            Guardaste cambios. Volvé a verificar los horarios.
          </span>
        )}
        <div className="pc-page-secondary pc-page-secondary-final">{accionesSecundarias}</div>
      </section>

      <footer className="pc-page-bar" ref={barraRef}>
        <div className="pc-page-actions">
          <div className="pc-page-secondary">{accionesSecundarias}</div>
          <button type="button" className="pm-button pm-primary" disabled={ocupado || confirmacionAbierta || Boolean(error)}
            onClick={() => preCheckAprobado ? setIniciarModalOpen(true) : handlePreCheckInicio(true)}>
            {preCheckAprobado ? <Play size={16} aria-hidden="true" /> : <RefreshCw size={16} className={verificandoInicio ? 'pc-spin' : ''} aria-hidden="true" />}
            {iniciandoTorneo ? 'Iniciando torneo…' : preCheckAprobado ? 'Iniciar torneo' : 'Volver a verificar'}
          </button>
        </div>
      </footer>

      {iniciarModalOpen && (
        <div className="pm-overlay pm-confirm-overlay">
          <div className="pm-modal pm-confirm" role="dialog" aria-modal="true" aria-labelledby="pc-start-title">
            <h2 id="pc-start-title" className="pm-header pm-title">¿Iniciar el torneo?</h2>
            <div className="pm-body">
              <p className="pc-copy">Se guardan las zonas y los horarios de cada partido de las categorías en borrador. Después vas a poder cambiar horarios desde el torneo en vivo.</p>
            </div>
            <div className="pm-footer">
              <button ref={cancelarInicioRef} type="button" className="pm-button" onClick={() => setIniciarModalOpen(false)} disabled={iniciandoTorneo}>Cancelar</button>
              <button type="button" className="pm-button pm-primary" onClick={executeIniciarTorneo} disabled={iniciandoTorneo}>
                {iniciandoTorneo ? 'Iniciando torneo…' : 'Iniciar torneo'}
              </button>
            </div>
          </div>
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
                El torneo pasa a estar en curso. Vas a poder asignarles cancha y horario a estos partidos desde el torneo en vivo.
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
                Se descartan las zonas actuales y sus horarios fijados, y se vuelven a armar con las parejas y los horarios cargados ahora. Tarda unos segundos y puede dar un resultado distinto.
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
