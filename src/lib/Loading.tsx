import { Component, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react';

/** «Laster …», og etter 8 sekunder et tilbud om å laste siden på nytt. */
export function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(t); }, []);
  return (
    <div>
      <p className="muted">Laster …</p>
      {slow && (
        <p className="notice small">
          Dette tar lang tid. <button className="link" onClick={() => window.location.reload()}>Last inn siden på nytt</button>
        </p>
      )}
    </div>
  );
}

const KEY = 'basar-chunk-reload';
const getFlag = () => { try { return sessionStorage.getItem(KEY); } catch { return '1'; } };
const setFlag = (v: string | null) => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* ignorer */ } };

/**
 * Som React.lazy, men tåler at siden er publisert på nytt mens nettleseren husket den gamle:
 * da finnes ikke de gamle kodefilene lenger, og vi laster siden på nytt én gang for å hente den nye versjonen.
 */
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const m = await factory();
      setFlag(null);
      return m;
    } catch (e) {
      if (!getFlag()) {
        setFlag('1');
        window.location.reload();
        return new Promise<{ default: T }>(() => {}); // venter på omlastingen
      }
      throw e;
    }
  });
}

/** Viser en vennlig melding i stedet for en tom side hvis noe likevel feiler under lasting. */
export class LoadErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="notice">
        Siden er oppdatert siden sist du var her.{' '}
        <button className="link" onClick={() => window.location.reload()}>Last inn på nytt</button>
      </p>
    );
  }
}
