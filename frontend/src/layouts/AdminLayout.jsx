import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Award, Trophy, Building2, LogOut } from 'lucide-react';
import { APP_NAME } from '../constants/app';

export default function AdminLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Considera activo "Mis Torneos" cuando la ruta empieza con /admin/torneos o es exactamente /admin
  const isTorneos =
    location.pathname === '/admin' || location.pathname.startsWith('/admin/torneos');
  const isClub = location.pathname.startsWith('/admin/club');

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div className="admin-header-left">
          <Link to="/admin" className="admin-logo" aria-label={APP_NAME}>
            <Award size={20} strokeWidth={2} className="admin-logo-icon" />
            <span className="admin-logo-text">{APP_NAME}</span>
          </Link>
        </div>

        <nav className="admin-nav">
          <Link
            to="/admin"
            className={`admin-nav-link${isTorneos ? ' active' : ''}`}
          >
            <Trophy size={16} strokeWidth={2} className="admin-nav-icon" />
            <span>Mis Torneos</span>
          </Link>
          <Link
            to="/admin/club"
            className={`admin-nav-link${isClub ? ' active' : ''}`}
          >
            <Building2 size={16} strokeWidth={2} className="admin-nav-icon" />
            <span>Mi Club</span>
          </Link>
        </nav>

        <div className="admin-nav-actions">
          <button
            type="button"
            onClick={handleLogout}
            className="btn-logout"
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
          >
            <LogOut size={16} strokeWidth={2} />
            <span className="btn-logout-text">Cerrar sesión</span>
          </button>
        </div>
      </header>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
