import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Award, UserPlus } from 'lucide-react';
import { APP_NAME } from '../constants/app';
import './admin/panel.css';

export default function Register() {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post('/auth/register', { nombre, email, password });
      login(data.token);
      navigate('/admin');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel au-page">
      <div className="au-shell">
        <h1 className="au-brand">
          <Award size={26} strokeWidth={2} className="au-brand-icon" />
          {APP_NAME}
        </h1>
        <div className="au-card">
          <h2 className="au-title">Creá tu cuenta</h2>
          <p className="au-intro">Registrá tu club para organizar sus torneos.</p>

          {error && <div className="au-error" role="alert">{error}</div>}

          <form onSubmit={handleSubmit} className="au-form">
            <div className="au-field">
              <label htmlFor="nombre">Nombre o club</label>
              <input
                className="au-input"
                type="text"
                id="nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
              />
            </div>
            <div className="au-field">
              <label htmlFor="email">Email</label>
              <input
                className="au-input"
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="au-field">
              <label htmlFor="password">Contraseña</label>
              <input
                className="au-input"
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="au-button au-primary"
              disabled={loading}
            >
              <UserPlus size={16} strokeWidth={2} />
              {loading ? 'Registrando…' : 'Crear cuenta'}
            </button>
          </form>

          <p className="au-links">
            ¿Ya tenés cuenta? <Link to="/login">Iniciá sesión</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
