export type DayId = 'opprigg' | 'd1' | 'd2';
export type TimePref = 'hele' | 'for18' | 'etter18';

export interface Day { id: DayId; name: string; date: string }

export interface Shift {
  id: string;        // fast ID, endres aldri etter første påmelding
  day: DayId;
  station: string;
  start: string;     // HH:MM
  end: string;       // HH:MM (Opprigg: 23:59 = åpen slutt)
  base: number;      // «Antall personer»
  extra: number;     // ekstra plasser I TILLEGG til base
  priority: number;  // 1 fylles først i fase 2
}

// Kaketyper styres fra oppsettet (config/main.cakeTypes). ID-er: små bokstaver uten mellomrom eller _.
export type CakeTypeId = string;
/** unit = mengde som vises (f.eks. «20–30 stk»). needsText = må beskrives (Annen kake). noExtra = åpner ikke igjen (vaffelrøre). */
export interface CakeType { id: CakeTypeId; name: string; unit: string; needsText?: boolean; noExtra?: boolean }

export interface AppConfig {
  year: number;
  contact: { email: string; phone: string };
  place: string;
  days: Day[];
  shifts: Shift[];
  cakeTypes?: CakeType[];
  /** Maks antall per dag per kaketype. Typer som mangler her, har ingen grense. */
  cakeLimits?: Record<CakeTypeId, number>;
  /** Antall kakeplasser per dag som må fylles før ekstraplassene åpner (summen av kakene, uten vaffelrøre). */
  cakeBaseTotal?: number;
  cakeNoExtra?: string[];
  cakeNeedsText?: string[];
  /** Øk når kakelisten byttes ut, så vedlikeholdsknappen skriver den nye listen. */
  cakeVersion?: number;
  /** Ekstra kaker per dag NÅR alle kvoteplassene er tatt. 0 eller mangler = ingen grense. */
  cakeExtraPerDay?: number;
}

export interface Assignment {
  day: DayId;
  shift: Shift | null; // null = venteliste eller allerede opptatt
  /** «opptatt» = personen har allerede vakt i hele tidsrommet; da lagres ingenting. */
  status?: 'tildelt' | 'venteliste' | 'opptatt';
}
