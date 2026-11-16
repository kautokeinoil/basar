import type { AppConfig, Shift } from './types';

const stamp = (date: string, hhmm: string) => `${date.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;

/** Kalenderfil med lokal tid (flytende), som passer for norske brukere. */
export function buildIcs(config: AppConfig, shifts: Shift[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kautokeino IL//Basar//NO', 'CALSCALE:GREGORIAN'];
  for (const s of shifts) {
    const day = config.days.find((d) => d.id === s.day);
    if (!day) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.id}-${config.year}@basar.kautokeinoil`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART:${stamp(day.date, s.start)}`,
      `DTEND:${stamp(day.date, s.end)}`,
      `SUMMARY:Basarvakt: ${s.station}`,
      `LOCATION:${config.place}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
