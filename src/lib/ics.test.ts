import { describe, it, expect } from 'vitest';
import { buildIcs } from './ics';
import { SEED_CONFIG } from '../config/seed';

describe('kalenderfil', () => {
  it('gir riktige datoer og tider for 2026', () => {
    const s = (id: string) => SEED_CONFIG.shifts.find((x) => x.id === id)!;
    const ics = buildIcs(SEED_CONFIG, [s('opprigg-1800'), s('d1-kafe-1400'), s('d2-arer-1930')]);
    expect(ics).toContain('DTSTART:20261228T180000');
    expect(ics).toContain('DTSTART:20261229T140000');
    expect(ics).toContain('DTEND:20261229T160000');
    expect(ics).toContain('DTSTART:20261230T193000');
    expect(ics).toContain('LOCATION:Báktehárji');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  });
});
