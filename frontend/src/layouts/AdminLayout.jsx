import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AdminLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div className="admin-header-left">
          <Link to="/admin" className="admin-logo">🏸 Pádel Torneos</Link>
        </div>
        <nav className="admin-nav">
          <Link to="/admin">Mis Torneos</Link>
          <Link to="/admin/club">🏟️ Mi Club</Link>
          <button onClick={handleLogout} className="btn-logout">Cerrar sesión</button>
        </nav>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
