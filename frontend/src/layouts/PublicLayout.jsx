import { Outlet } from 'react-router-dom';
import { Award } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '../constants/app';

export default function PublicLayout() {
  return (
    <div className="public-layout">
      <main className="public-main">
        <Outlet />
      </main>
      <footer className="public-footer">
        <p style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
          <Award size={14} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
          {APP_NAME} — {APP_TAGLINE}
        </p>
      </footer>
    </div>
  );
}
