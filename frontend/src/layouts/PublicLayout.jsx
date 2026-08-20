import { Outlet } from 'react-router-dom';
import { Award } from 'lucide-react';

export default function PublicLayout() {
  return (
    <div className="public-layout">
      <main className="public-main">
        <Outlet />
      </main>
      <footer className="public-footer">
        <p style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
          <Award size={14} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
          Pádel Torneos — Seguí el torneo en vivo
        </p>
      </footer>
    </div>
  );
}
