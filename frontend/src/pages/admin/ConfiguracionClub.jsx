import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import { Building2, Calendar, Save, ChevronLeft } from 'lucide-react';

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
    <div className="page" style={{ maxWidth: '720px' }}>
      <div className="flex-header">
        <div>
          <Link
            to="/admin"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <ChevronLeft size={14} strokeWidth={2} />
            Volver a Mis Torneos
          </Link>
          <h1 style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building2 size={24} strokeWidth={2} />
            Configuración del Club
          </h1>
        </div>
      </div>

      <div className="torneo-card" style={{ marginTop: '1.5rem' }}>
        {error && <div className="error-message" style={{ marginBottom: '1.25rem' }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="club-nombre">Nombre del Club / Organizador</label>
            <input
              id="club-nombre"
              type="text"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              required
            />
          </div>

          <div className="form-group" style={{ margin: 0, maxWidth: '240px' }}>
            <label htmlFor="club-canchas">Cantidad de canchas disponibles</label>
            <input
              id="club-canchas"
              type="number"
              min="1"
              max="30"
              value={form.cantidadCanchas}
              onChange={(e) => setForm({ ...form, cantidadCanchas: e.target.value })}
              required
            />
          </div>

          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={16} strokeWidth={2} style={{ color: 'var(--color-text-secondary)' }} />
              <h3 style={{ fontSize: 'var(--font-size-base)', margin: 0 }}>Horarios de Apertura (Jornada)</h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              {/* Viernes */}
              <div style={{ background: 'var(--color-bg-input)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <h4 style={{ fontSize: 'var(--font-size-sm)', marginBottom: '0.75rem' }}>Viernes</h4>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div className="form-group" style={{ margin: 0, flex: 1 }}>
                    <label style={{ fontSize: 'var(--font-size-xs)' }}>Inicio</label>
                    <input
                      type="time"
                      value={form.viernesInicio}
                      onChange={(e) => setForm({ ...form, viernesInicio: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0, flex: 1 }}>
                    <label style={{ fontSize: 'var(--font-size-xs)' }}>Fin</label>
                    <input
                      type="time"
                      value={form.viernesFin}
                      onChange={(e) => setForm({ ...form, viernesFin: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Sábado */}
              <div style={{ background: 'var(--color-bg-input)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <h4 style={{ fontSize: 'var(--font-size-sm)', marginBottom: '0.75rem' }}>Sábado</h4>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div className="form-group" style={{ margin: 0, flex: 1 }}>
                    <label style={{ fontSize: 'var(--font-size-xs)' }}>Inicio</label>
                    <input
                      type="time"
                      value={form.sabadoInicio}
                      onChange={(e) => setForm({ ...form, sabadoInicio: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0, flex: 1 }}>
                    <label style={{ fontSize: 'var(--font-size-xs)' }}>Fin</label>
                    <input
                      type="time"
                      value={form.sabadoFin}
                      onChange={(e) => setForm({ ...form, sabadoFin: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={saving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', width: 'auto', alignSelf: 'flex-start', marginTop: '0.5rem' }}
          >
            <Save size={16} strokeWidth={2} />
            {saving ? 'Guardando...' : 'Guardar configuración del club'}
          </button>
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
