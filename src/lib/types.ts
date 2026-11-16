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

export type CakeTypeId = 'flotekake' | 'formkake' | 'muffins' | 'vaffel';
export interface CakeType { id: CakeTypeId; name: string; unit: string }

export interface AppConfig {
  year: number;
  contact: { email: string; phone: string };
  place: string;
  days: Day[];
  shifts: Shift[];
  cakeTypes?: CakeType[];
}

export interface Assignment {
  day: DayId;
  shift: Shift | null; // null = venteliste
}
