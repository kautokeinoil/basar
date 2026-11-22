import { lazy, Suspense, useEffect, useState } from 'react';
import Home from './pages/Home';
import VolunteerForm from './pages/VolunteerForm';
import Confirmation from './pages/Confirmation';
import CakeForm from './pages/CakeForm';
import PrizeForm from './pages/PrizeForm';
import Roster from './pages/Roster';

// Sider med innlogging lastes bare når de åpnes, så forsiden blir lettere
const Admin = lazy(() => import('./pages/Admin'));
const Station = lazy(() => import('./pages/Station'));
const CakeDesk = lazy(() => import('./pages/CakeDesk'));
const PrizeDesk = lazy(() => import('./pages/PrizeDesk'));
import type { Assignment } from './lib/types';

// Hash-ruting fungerer på GitHub Pages uten serveroppsett.
const route = () => window.location.hash.replace(/^#\/?/, '') || '';

export default function App() {
  const [path, setPath] = useState(route());
  const [result, setResult] = useState<Assignment[] | null>(null);

  useEffect(() => {
    const on = () => { setPath(route()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  let page;
  if (path === 'frivillig') {
    page = <VolunteerForm onDone={(r) => { setResult(r); window.location.hash = '#/bekreftelse'; }} />;
  } else if (path === 'bekreftelse' && result) {
    page = <Confirmation assignments={result} />;
  } else if (path === 'vakter') {
    page = <Roster />;
  } else if (path === 'gevinster') {
    page = <PrizeForm />;
  } else if (path === 'kaker') {
    page = <CakeForm />;
  } else if (path.startsWith('kake/')) {
    page = <CakeDesk token={path.slice('kake/'.length)} />;
  } else if (path.startsWith('stasjon/')) {
    page = <Station token={path.slice('stasjon/'.length)} />;
  } else if (path === 'admin/gevinster') {
    page = <PrizeDesk />;
  } else if (path === 'admin') {
    page = <Admin />;
  } else {
    page = <Home />;
  }

  return (
    <div className="shell">
      <header className="top">
        <a href="#/" className="brand">Kautokeino IL · Romjulsbasar</a>
      </header>
      <main><Suspense fallback={<p className="muted">Laster …</p>}>{page}</Suspense></main>
    </div>
  );
}
