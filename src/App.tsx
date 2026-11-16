import { useEffect, useState } from 'react';
import Home from './pages/Home';
import VolunteerForm from './pages/VolunteerForm';
import Confirmation from './pages/Confirmation';
import Admin from './pages/Admin';
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
      <main>{page}</main>
    </div>
  );
}
