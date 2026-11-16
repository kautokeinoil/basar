import { describe, it, expect } from 'vitest';
import { pickShift, matchesPref } from './assign';
import { SEED_CONFIG } from '../config/seed';
import type { Shift } from './types';

const day = (d: string) => SEED_CONFIG.shifts.filter((s) => s.day === d);
const byId = (id: string) => SEED_CONFIG.shifts.find((s) => s.id === id)!;
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

describe('fase 1: grunnplasser', () => {
  it('trekker tilfeldig blant alle med ledig grunnplass, uavhengig av prioritet', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(pickShift({ dayShifts: day('d1'), counts: {}, pref: 'hele', existing: [] })!.priority);
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]); // også prio 6 kan trekkes
  });

  it('går ikke over grunnplass så lenge noe har grunnplass ledig', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 47; i++) {
      const s = pickShift({ dayShifts: day('d1'), counts, pref: 'hele', existing: [] })!;
      counts[s.id] = (counts[s.id] ?? 0) + 1;
      expect(counts[s.id]).toBeLessThanOrEqual(s.base);
    }
    for (const s of day('d1')) expect(counts[s.id]).toBe(s.base); // alle 47 grunnplasser fylt
  });
});

describe('fase 2: ekstra plasser etter prioritet', () => {
  const full = () => Object.fromEntries(day('d1').map((s) => [s.id, s.base]));

  it('fyller prioritet 1 helt før prioritet 2', () => {
    const counts = full();
    const prio1 = day('d1').filter((s) => s.priority === 1);
    const prio1Extra = prio1.reduce((n, s) => n + s.extra, 0); // Kafé: 4 skift × 5
    for (let i = 0; i < prio1Extra; i++) {
      const s = pickShift({ dayShifts: day('d1'), counts, pref: 'hele', existing: [] })!;
      expect(s.priority).toBe(1);
      counts[s.id]++;
    }
    expect(pickShift({ dayShifts: day('d1'), counts, pref: 'hele', existing: [] })!.priority).toBe(2);
  });

  it('ekstra kommer i tillegg: Kafé tar maks 3 + 5 = 8', () => {
    const counts = full();
    let kafe = 0;
    for (;;) {
      const s = pickShift({ dayShifts: day('d1'), counts, pref: 'hele', existing: [] });
      if (!s) break;
      counts[s.id]++;
    }
    for (const s of day('d1')) expect(counts[s.id]).toBe(s.base + s.extra);
    kafe = counts['d1-kafe-1400'];
    expect(kafe).toBe(8);
  });
});

describe('tidsvalg (på starttid)', () => {
  it('før 18 gir bare skift som starter før 18:00, også 17:30–19:30', () => {
    for (let i = 0; i < 200; i++) {
      const s = pickShift({ dayShifts: day('d1'), counts: {}, pref: 'for18', existing: [] })!;
      expect(Number(s.start.slice(0, 2))).toBeLessThan(18);
    }
    expect(matchesPref(byId('d1-arer-1730'), 'for18')).toBe(true);
  });

  it('etter 18 gir bare skift som starter 18:00 eller senere', () => {
    for (let i = 0; i < 200; i++) {
      const s = pickShift({ dayShifts: day('d2'), counts: {}, pref: 'etter18', existing: [] })!;
      expect(Number(s.start.slice(0, 2))).toBeGreaterThanOrEqual(18);
    }
  });

  it('fullt innenfor tidsvalget gir venteliste, aldri et skift utenfor', () => {
    const counts = Object.fromEntries(day('d1').map((s) => [s.id, s.start >= '18:00' ? s.base + s.extra : 0]));
    expect(pickShift({ dayShifts: day('d1'), counts, pref: 'etter18', existing: [] })).toBeNull();
  });
});

describe('overlapp og Opprigg', () => {
  it('gir ikke et skift som overlapper en vakt personen har samme dag', () => {
    const existing: Shift[] = [byId('d1-kafe-1600')]; // 16–18
    for (let i = 0; i < 300; i++) {
      const s = pickShift({ dayShifts: day('d1'), counts: {}, pref: 'hele', existing })!;
      const st = Number(s.start.replace(':', '')), en = Number(s.end.replace(':', ''));
      expect(st >= 1800 || en <= 1600).toBe(true);
    }
  });

  it('Opprigg stopper på 100 og bruker ikke ekstra plasser', () => {
    const o = day('opprigg');
    expect(pickShift({ dayShifts: o, counts: { 'opprigg-1800': 99 }, pref: 'etter18', existing: [] })?.id).toBe('opprigg-1800');
    expect(pickShift({ dayShifts: o, counts: { 'opprigg-1800': 100 }, pref: 'hele', existing: [] })).toBeNull();
  });

  it('samme person får ikke Opprigg to ganger', () => {
    expect(pickShift({ dayShifts: day('opprigg'), counts: {}, pref: 'hele', existing: [byId('opprigg-1800')] })).toBeNull();
  });

  it('bruker rng deterministisk', () => {
    const a = pickShift({ dayShifts: day('d1'), counts: {}, pref: 'hele', existing: [], rng: seq(0) });
    expect(a?.id).toBe(day('d1')[0].id);
  });
});
