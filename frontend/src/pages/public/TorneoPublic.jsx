import { useParams } from 'react-router-dom';

export default function TorneoPublic() {
  const { slug } = useParams();

  return (
    <div className="public-page">
      <h1>🏸 Torneo en Vivo</h1>
      <p className="stub-message">Vista pública de "{slug}" — Ticket 5.2</p>
    </div>
  );
}
