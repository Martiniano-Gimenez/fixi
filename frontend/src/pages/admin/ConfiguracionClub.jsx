import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import { Building2, Calendar, Save, ChevronLeft, Minus, Plus } from 'lucide-react';
import './ConfiguracionClub.css';

const DIAS = [
  { key: 'viernes', label: 'Viernes', inicio: 'viernesInicio', fin: 'viernesFin' },
  { key: 'sabado', label: 'Sábado', inicio: 'sabadoInicio', fin: 'sabadoFin' },
  { key: 'domingo', label: 'Domingo', inicio: 'domingoInicio', fin: 'domingoFin' },
];

export default function ConfiguracionClub() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [form, setForm] = useState({
    nombre: '',
    cantidadCanchas: 1,
    viernesInicio: '',
    viernesFin: '',
    sabadoInicio: '',
    sabadoFin: '',
    domingoInicio: '',
    domingoFin: '',
  });

  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    slotsAfectados: 0,
    parejasAfectadas: 0,
    pendingData: null,
  });

  useEffect(() => {
    fetchPerfil();
  }, []);

  const fetchPerfil = async () => {
    try {
      setLoading(true);
      const data = await api.get('/organizador/perfil');
      setForm({
        nombre: data.nombre || '',
        cantidadCanchas: data.cantidadCanchas ?? 1,
        viernesInicio: data.viernesInicio || '',
        viernesFin: data.viernesFin || '',
        sabadoInicio: data.sabadoInicio || '',
        sabadoFin: data.sabadoFin || '',
        domingoInicio: data.domingoInicio || '',
        domingoFin: data.domingoFin || '',
      });
    } catch (err) {
      setError(err.message || 'Error al cargar perfil del club.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      nombre: form.nombre,
      cantidadCanchas: Number(form.cantidadCanchas) || 1,
      viernesInicio: form.viernesInicio || null,
      viernesFin: form.viernesFin || null,
      sabadoInicio: form.sabadoInicio || null,
      sabadoFin: form.sabadoFin || null,
      domingoInicio: form.domingoInicio || null,
      domingoFin: form.domingoFin || null,
    };

    try {
      // 1. Simular impacto en todas las selecciones de parejas de todos los torneos
      const simulacion = await api.post('/organizador/simular-jornada', payload);

      if (simulacion.slotsAfectados > 0) {
        // 2. Mostrar advertencia con conteo total de slots y parejas afectadas
        setConfirmModal({
          isOpen: true,
          slotsAfectados: simulacion.slotsAfectados,
          parejasAfectadas: simulacion.parejasAfectadas,
          pendingData: payload,
        });
        setSaving(false);
        return;
      }

      // 3. Guardar directamente si no hay impacto negativo
      await api.patch('/organizador/perfil', payload);
      setToast('Configuración del club guardada');
      setTimeout(() => setToast(''), 3500);
      fetchPerfil();
    } catch (err) {
      setError(err.message || 'Error al guardar configuración.');
    } finally {
      setSaving(false);
    }
  };

  const executeGuardadoConImpacto = async () => {
    const payload = confirmModal.pendingData;
    setConfirmModal({ isOpen: false, slotsAfectados: 0, parejasAfectadas: 0, pendingData: null });
    setSaving(true);
    try {
      await api.patch('/organizador/perfil', payload);
      setToast('Horarios del club actualizados y turnos obsoletos limpiados');
      setTimeout(() => setToast(''), 4000);
      fetchPerfil();
    } catch (err) {
      setError(err.message || 'Error al guardar configuración.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Cargando configuración del club...</div>;

  return (
    <div className="page club-page">
      <div className="flex-header club-header">
        <div>
          <Link to="/admin" className="club-back-link">
            <ChevronLeft size={16} strokeWidth={2} />
            Volver a Mis Torneos
          </Link>
          <h1 className="club-title">
            <Building2 size={24} strokeWidth={2} />
            <span>Configuración del Club</span>
          </h1>
        </div>
      </div>

      <div className="torneo-card club-card">
        {error && <div className="error-message" style={{ marginBottom: '1.25rem' }}>{error}</div>}

        <form onSubmit={handleSubmit} className="club-form">
          {/* Columna Izquierda: Datos del club y botón guardar */}
          <div className="club-col-datos">
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="club-nombre">Nombre del Club / Organizador</label>
              <input
                id="club-nombre"
                type="text"
                className="club-text-input"
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                required
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="club-canchas">Cantidad de canchas disponibles</label>
              <div className="club-stepper">
                <button
                  type="button"
                  className="club-stepper-btn"
                  onClick={() => {
                    const current = Number(form.cantidadCanchas) || 1;
                    if (current > 1) {
                      setForm((prev) => ({ ...prev, cantidadCanchas: current - 1 }));
                    }
                  }}
                  disabled={Number(form.cantidadCanchas) <= 1}
                  aria-label="Disminuir cantidad de canchas"
                >
                  <Minus size={16} strokeWidth={2.5} />
                </button>
                <input
                  id="club-canchas"
                  type="number"
                  min="1"
                  max="30"
                  className="club-stepper-input"
                  value={form.cantidadCanchas}
                  onChange={(e) => setForm({ ...form, cantidadCanchas: e.target.value })}
                  required
                />
                <button
                  type="button"
                  className="club-stepper-btn"
                  onClick={() => {
                    const current = Number(form.cantidadCanchas) || 1;
                    if (current < 30) {
                      setForm((prev) => ({ ...prev, cantidadCanchas: current + 1 }));
                    }
                  }}
                  disabled={Number(form.cantidadCanchas) >= 30}
                  aria-label="Aumentar cantidad de canchas"
                >
                  <Plus size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* En escritorio el botón se posiciona junto a los datos; en móvil se ancla al fondo del viewport */}
            <div className="club-save-bar">
              <button
                type="submit"
                className="btn-primary club-save-btn"
                disabled={saving}
              >
                <Save size={16} strokeWidth={2} />
                <span>{saving ? 'Guardando...' : 'Guardar configuración del club'}</span>
              </button>
            </div>
          </div>

          {/* Columna Derecha: Horarios de apertura compactos */}
          <div className="club-col-horarios">
            <div className="club-horarios-header">
              <Calendar size={18} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
              <h3 style={{ fontSize: 'var(--font-size-base)', margin: 0 }}>
                Horarios de Apertura (Jornada)
              </h3>
            </div>

            <div className="club-table-wrapper">
              <table className="club-horarios-table">
                <thead>
                  <tr>
                    <th className="th-dia">Día</th>
                    <th className="th-hora">Inicio</th>
                    <th className="th-hora">Fin</th>
                  </tr>
                </thead>
                <tbody>
                  {DIAS.map((dia) => {
                    const horaInicio = form[dia.inicio];
                    const horaFin = form[dia.fin];
                    const esMadrugada = Boolean(horaInicio && horaFin && horaFin < horaInicio);

                    return (
                      <tr key={dia.key}>
                        <td className="td-dia">
                          <span className="club-dia-name">{dia.label}</span>
                        </td>
                        <td className="td-hora">
                          <input
                            id={`time-${dia.inicio}`}
                            type="time"
                            className="club-time-input"
                            value={horaInicio}
                            onChange={(e) => setForm({ ...form, [dia.inicio]: e.target.value })}
                            aria-label={`Horario de inicio para ${dia.label}`}
                          />
                        </td>
                        <td className="td-hora">
                          <div className="club-fin-container">
                            <input
                              id={`time-${dia.fin}`}
                              type="time"
                              className="club-time-input"
                              value={horaFin}
                              onChange={(e) => setForm({ ...form, [dia.fin]: e.target.value })}
                              aria-label={`Horario de fin para ${dia.label}`}
                            />
                            {esMadrugada && (
                              <span
                                className="club-madrugada-badge"
                                title="Cierra en la madrugada del día siguiente"
                              >
                                madrugada siguiente
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </form>
      </div>

      {toast && (
        <div className="toast-container">
          <div className="toast-message">{toast}</div>
        </div>
      )}

      {confirmModal.isOpen && (
        <ConfirmModal
          isOpen={true}
          title="⚠️ Cambios en Horarios del Club"
          message={`Este cambio va a invalidar ${confirmModal.slotsAfectados} selección(es) de ${confirmModal.parejasAfectadas} pareja(s) en total (entre todos tus torneos). ¿Deseas continuar y actualizar los horarios?`}
          onConfirm={executeGuardadoConImpacto}
          onCancel={() => setConfirmModal({ isOpen: false, slotsAfectados: 0, parejasAfectadas: 0, pendingData: null })}
          confirmText="Sí, actualizar y limpiar turnos"
          isDanger={true}
        />
      )}
    </div>
  );
}
