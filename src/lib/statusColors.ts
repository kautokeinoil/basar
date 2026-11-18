import type { PrizeStatus } from './prizes';

// Samme farger som i arket (Basar → Fargelegg Basarbok)
export const STATUS_BG: Record<PrizeStatus, string> = {
  mottatt: '#d9ead3',
  bekreftet: '#cfe2f3',
  registrert: '#fce5cd',
  avvist: '#f4cccc',
};
