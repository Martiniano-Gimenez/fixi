import { Outlet } from 'react-router-dom';

export default function PublicLayout() {
  return (
    <div className="public-layout">
      <main className="public-main">
        <Outlet />
      </main>
      <footer className="public-footer">
        <p>🏸 Pádel Torneos — Seguí el torneo en vivo</p>
      </footer>
    </div>
  );
}
