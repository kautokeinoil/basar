// Offentlig vaktliste: hvem som jobber når. Oppdateres i sanntid.
// Viser bare navn på dem som har samtykket; de andre telles («og 2 andre»). Aldri telefon.
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useConfig, formatDate } from '../lib/useConfig';
import { Loading } from '../lib/Loading';

export default function Roster() {
  const cfg = useConfig();
  const [names, setNames] = useState<{ name: string; shiftId: string }[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState(false);

  useEffect(() => {
    const a = onSnapshot(collection(db, 'publicRoster'),
      (s) => setNames(s.docs.map((d) => d.data() as { name: string; shiftId: string })), () => setError(true));
    const b = onSnapshot(collection(db, 'shiftCounts'),
      (s) => setCounts(Object.fromEntries(s.docs.map((d) => [d.id, d.data().count as number]))), () => setError(true));
    return () => { a(); b(); };
  }, []);

  const config = cfg.status === 'ok' ? cfg.config : null;
  const days = useMemo(() => {
    if (!config || !names) return [];
    return config.days.map((day) => {
      const shifts = config.shifts.filter((s) => s.day === day.id && (counts[s.id] ?? 0) > 0);
      const stations = [...new Set(shifts.map((s) => s.station))].map((station) => ({
        station,
        shifts: shifts.filter((s) => s.station === station)
          .sort((x, y) => x.start.localeCompare(y.start))
          .map((s) => {
            const list = names.filter((n) => n.shiftId === s.id).map((n) => n.name).sort((x, y) => x.localeCompare(y, 'nb'));
            return { shift: s, list, others: Math.max(0, (counts[s.id] ?? 0) - list.length) };
          }),
      }));
      return { day, stations };
    }).filter((d) => d.stations.length > 0);
  }, [config, names, counts]);

  if (error) return <p className="error">Kunne ikke laste vaktlisten. Last inn siden på nytt.</p>;
  if (!config || !names) return <Loading />;

  return (
    <section className="roster">
      <h1>Vaktliste</h1>
      <p className="muted">Romjulsbasar {config.year} · {config.place}. Oppdateres automatisk.</p>
      {days.length === 0 && <p className="muted">Ingen er påmeldt ennå.</p>}
      {days.map(({ day, stations }) => (
        <div key={day.id}>
          <h2>{day.name} <span className="muted small">{formatDate(day.date)}</span></h2>
          {stations.map(({ station, shifts }) => (
            <div key={station} className="panel">
              <strong>{station}</strong>
              <ul className="slots">
                {shifts.map(({ shift, list, others }) => (
                  <li key={shift.id}>
                    <span className="time">{shift.day === 'opprigg' ? `Fra ${shift.start}` : `${shift.start}–${shift.end}`}</span>
                    <span>
                      {list.join(', ')}
                      {others > 0 && <span className="muted">{list.length ? ' og ' : ''}{others} {list.length ? (others === 1 ? 'annen' : 'andre') : (others === 1 ? 'frivillig' : 'frivillige')}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
      <p><a href="#/frivillig">Meld deg som frivillig</a></p>
    </section>
  );
}
