import { useState, useEffect } from 'react';
import { api } from '../api/client';

const DIAS = ['Viernes', 'Sabado'];
const DIAS_LABELS = { Viernes: 'Viernes', Sabado: 'Sábado' };

export default function DisponibilidadEditor({ parejaId, onClose }) {
  const [franjas, setFranjas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Estado del formulario nueva franja
  const [diasSeleccionados, setDiasSeleccionados] = useState([]);
  const [horaInicio, setHoraInicio] = useState('08:00');
  const [horaFin, setHoraFin] = useState('12:00');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!parejaId) return;
    api.get(`/parejas/${parejaId}/disponibilidades`)
      .then(setFranjas)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [parejaId]);

  const toggleDia = (dia) => {
    setDiasSeleccionados((prev) =>
      prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]
    );
  };

  const handleAgregarFranjas = () => {
    setFormError('');
    if (diasSeleccionados.length === 0) {
      setFormError('Seleccioná al menos un día.');
      return;
    }
    if (horaInicio >= horaFin) {
      setFormError('La hora de fin debe ser mayor a la hora de inicio.');
      return;
    }
    // Agregar una franja por cada día seleccionado
    const nuevas = diasSeleccionados.map((dia) => ({ dia, horaInicio, horaFin }));
    const franjasMergeadas = [...franjas, ...nuevas];
    guardarFranjas(franjasMergeadas);
    setDiasSeleccionados([]);
  };

  const handleEliminar = (index) => {
    const nuevas = franjas.filter((_, i) => i !== index);
    guardarFranjas(nuevas);
  };

  const guardarFranjas = async (nuevasFranjas) => {
    setSaving(true);
    setError('');
    try {
      const resultado = await api.put(`/parejas/${parejaId}/disponibilidades`, {
        franjas: nuevasFranjas,
      });
      setFranjas(resultado);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading" style={{ padding: '1rem' }}>Cargando...</div>;

  return (
    <div className="disponibilidad-editor">
      {error && <div className="error-message" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      {/* Lista de franjas existentes */}
      {franjas.length > 0 ? (
        <ul className="franjas-list">
          {franjas.map((f, i) => (
            <li key={i} className="franja-item">
              <span className="franja-badge">{DIAS_LABELS[f.dia] || f.dia}</span>
              <span className="franja-hora">{f.horaInicio} – {f.horaFin}</span>
              <button
                onClick={() => handleEliminar(i)}
                className="franja-delete"
                disabled={saving}
                aria-label="Eliminar franja"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: '0.75rem' }}>
          Sin franjas cargadas.
        </p>
      )}

      {/* Formulario nueva franja */}
      <div className="nueva-franja-form">
        <div className="dia-chips">
          {DIAS.map((dia) => (
            <button
              key={dia}
              type="button"
              className={`dia-chip${diasSeleccionados.includes(dia) ? ' selected' : ''}`}
              onClick={() => toggleDia(dia)}
            >
              {DIAS_LABELS[dia]}
            </button>
          ))}
        </div>

        <div className="hora-inputs">
          <div className="form-group" style={{ margin: 0 }}>
            <label>Desde</label>
            <input
              type="time"
              value={horaInicio}
              onChange={(e) => setHoraInicio(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Hasta</label>
            <input
              type="time"
              value={horaFin}
              onChange={(e) => setHoraFin(e.target.value)}
            />
          </div>
        </div>

        {formError && (
          <p style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', marginTop: '0.25rem' }}>
            {formError}
          </p>
        )}

        <button
          type="button"
          className="btn-secondary"
          onClick={handleAgregarFranjas}
          disabled={saving}
          style={{ marginTop: '0.5rem', width: '100%' }}
        >
          {saving ? 'Guardando...' : '+ Agregar franja'}
        </button>
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: '1rem',
            width: '100%',
            background: 'none',
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          Cerrar
        </button>
      )}
    </div>
  );
}
