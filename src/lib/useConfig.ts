import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { AppConfig } from './types';

export type ConfigState = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ok'; config: AppConfig };

export function useConfig(): ConfigState {
  const [state, setState] = useState<ConfigState>({ status: 'loading' });
  useEffect(() => {
    getDoc(doc(db, 'config', 'main'))
      .then((s) => setState(s.exists() ? { status: 'ok', config: s.data() as AppConfig } : { status: 'missing' }))
      .catch(() => setState({ status: 'error' }));
  }, []);
  return state;
}

export const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });
