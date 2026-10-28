import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './layouts/AdminLayout';
import PublicLayout from './layouts/PublicLayout';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import TorneosList from './pages/admin/TorneosList';
import TorneoCreate from './pages/admin/TorneoCreate';
import TorneoDetail from './pages/admin/TorneoDetail';
import CategoriaDetail from './pages/admin/CategoriaDetail';
import ParejasManager from './pages/admin/ParejasManager';
import TorneoPublic from './pages/public/TorneoPublic';
import InscripcionPublica from './pages/public/InscripcionPublica';
import EliminatoriaView from './pages/admin/EliminatoriaView';
import ConfiguracionClub from './pages/admin/ConfiguracionClub';
import TorneoEnVivo from './pages/admin/TorneoEnVivo';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Redirect raíz a login */}
          <Route path="/" element={<Navigate to="/login" replace />} />

          {/* Auth (sin layout) */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Admin (protegido) */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<TorneosList />} />
            <Route path="club" element={<ConfiguracionClub />} />
            <Route path="torneos/nuevo" element={<TorneoCreate />} />
            <Route path="torneos/:id" element={<TorneoDetail />} />
            <Route path="torneos/:id/en-vivo" element={<TorneoEnVivo />} />
            <Route path="torneos/:torneoId/categorias/:id" element={<CategoriaDetail />} />
            <Route path="torneos/:torneoId/categorias/:id/parejas" element={<ParejasManager />} />
            <Route path="torneos/:torneoId/categorias/:id/eliminatoria" element={<EliminatoriaView />} />
          </Route>

          {/* Vista pública (soporta /torneo/:slug y /torneos/:slug) */}
          <Route path="/torneo/:slug" element={<PublicLayout />}>
            <Route index element={<TorneoPublic />} />
            <Route path="inscripcion" element={<InscripcionPublica />} />
          </Route>
          <Route path="/torneos/:slug" element={<PublicLayout />}>
            <Route index element={<TorneoPublic />} />
            <Route path="inscripcion" element={<InscripcionPublica />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
