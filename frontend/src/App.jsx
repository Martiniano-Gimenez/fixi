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
import ParejasManager from './pages/admin/ParejasManager';
import TorneoPublic from './pages/public/TorneoPublic';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
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
            <Route path="torneos/nuevo" element={<TorneoCreate />} />
            <Route path="torneos/:id" element={<TorneoDetail />} />
            <Route path="torneos/:id/parejas" element={<ParejasManager />} />
          </Route>

          {/* Vista pública */}
          <Route path="/" element={<PublicLayout />}>
            <Route path=":slug" element={<TorneoPublic />} />
          </Route>

          {/* Redirect raíz a login */}
          <Route path="/" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
