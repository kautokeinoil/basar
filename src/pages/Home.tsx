import { useConfig, formatDate } from '../lib/useConfig';

// Nye moduler legges til her (se «Kontrakt for nye moduler» i spesifikasjonen).
const MODULES = [
  { href: '#/frivillig', title: 'Meld deg som frivillig', text: 'Få en tilfeldig vakt på dagen du velger.', open: true },
  { href: '#/kaker', title: 'Lever kaker', text: 'Fløtekake, formkake, muffins/boller eller vaffelrøre.', open: true },
  { href: '#/gevinster', title: 'Gevinster og sponsing', text: 'Registrer en gevinst eller sjekk om bedriften har sponset.', open: false },
];

export default function Home() {
  const cfg = useConfig();
  return (
    <>
      <section className="hero">
        <h1>Romjulsbasar {cfg.status === 'ok' ? cfg.config.year : ''}</h1>
        {cfg.status === 'ok' && (
          <p className="muted">
            {cfg.config.days.map((d) => `${d.name}: ${formatDate(d.date)}`).join(' · ')}
            <br />
            {cfg.config.place}
          </p>
        )}
      </section>
      <nav className="modules">
        {MODULES.map((m) =>
          m.open ? (
            <a key={m.href} className="module" href={m.href}>
              <strong>{m.title}</strong>
              <span>{m.text}</span>
            </a>
          ) : (
            <div key={m.href} className="module disabled" aria-disabled="true">
              <strong>{m.title}</strong>
              <span>Åpner snart</span>
            </div>
          ),
        )}
      </nav>
      {cfg.status === 'ok' && (
        <p className="muted small">
          Spørsmål? {cfg.config.contact.email} eller tlf. {cfg.config.contact.phone}
        </p>
      )}
    </>
  );
}
