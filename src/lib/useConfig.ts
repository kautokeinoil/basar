import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { AppConfig } from './types';

export type ConfigState = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ok'; config: AppConfig };

// Oppsettet hentes ÉN gang per sidevisning og deles av alle sider.
// Siste kjente versjon huskes i nettleseren, så gjentatte besøk vises med en gang
// mens ny versjon hentes i bakgrunnen.
const KEY = 'basar-config-v1';
let current: ConfigState = readCache();
let request: Promise<void> | null = null;
const listeners = new Set<(s: ConfigState) => void>();

function readCache(): ConfigState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { status: 'ok', config: JSON.parse(raw) as AppConfig };
  } catch { /* privat modus o.l. */ }
  return { status: 'loading' };
}

function set(s: ConfigState) {
  current = s;
  listeners.forEach((l) => l(s));
}

function refresh() {
  if (request) return;
  request = getDoc(doc(db, 'config', 'main'))
    .then((snap) => {
      if (!snap.exists()) return set({ status: 'missing' });
      const config = snap.data() as AppConfig;
      try { localStorage.setItem(KEY, JSON.stringify(config)); } catch { /* ignorer */ }
      set({ status: 'ok', config });
    })
    .catch(() => { if (current.status !== 'ok') set({ status: 'error' }); });
}

export function useConfig(): ConfigState {
  const [state, setState] = useState<ConfigState>(current);
  useEffect(() => {
    listeners.add(setState);
    refresh();
    setState(current);
    return () => { listeners.delete(setState); };
  }, []);
  return state;
}

export const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });
