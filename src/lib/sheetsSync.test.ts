// Tester de rene delene av apps-script/Code.gs (synk-logikken) i Node.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { SEED_CONFIG } from '../config/seed';

const mod: { exports: any } = { exports: {} };
vm.runInNewContext(readFileSync('apps-script/Code.gs', 'utf8'), {
  module: mod,
  Utilities: { formatDate: (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ') },
});
const { headerPlan_, planUpsert_, signupToRow_, cakeToRow_, prizeToRow_, buildTickets_, drawRows_, decodeDoc_, TABS } = mod.exports;
const header = TABS.Vakter.header as string[];

describe('overskrifter', () => {
  it('tomt ark får hele overskriften', () => {
    expect(headerPlan_([], header)).toEqual({ append: header, from: 1 });
  });
  it('nye kolonner legges bare til helt til høyre', () => {
    expect(headerPlan_(header.slice(0, 12), header)).toEqual({ append: header.slice(12), from: 13 });
  });
  it('flyttet eller omdøpt kolonne stopper synken', () => {
    const moved = [...header]; [moved[6], moved[7]] = [moved[7], moved[6]];
    expect(headerPlan_(moved, header).error).toMatch(/kolonne 7/);
  });
});

describe('upsert', () => {
  it('kjent ID oppdateres på samme rad, ny ID legges nederst', () => {
    const p = planUpsert_(['a', 'b', ''], [['b', 'ny'], ['c', 'x']]);
    expect(p.updates).toEqual([{ row: 3, values: ['b', 'ny'] }]);
    expect(p.appends).toEqual([['c', 'x']]);
  });
  it('to kjøringer på rad gir ingen duplikater', () => {
    const rows = [['a', 1], ['b', 2]];
    const first = planUpsert_([], rows);
    const ids = first.appends.map((r: unknown[]) => String(r[0]));
    const second = planUpsert_(ids, rows);
    expect(second.appends).toHaveLength(0);
    expect(second.updates).toHaveLength(2);
  });
  it('rader som ikke finnes i databasen, blir stående (sletter aldri)', () => {
    const p = planUpsert_(['gammel', 'a'], [['a', 1]]);
    expect(p.updates).toEqual([{ row: 3, values: ['a', 1] }]);
  });
});

describe('Firestore-dokument → rad', () => {
  const restDoc = {
    name: 'projects/basar-ba738/databases/(default)/documents/signups/abc123',
    fields: {
      name: { stringValue: 'Anne Sara' }, phone: { stringValue: '41234567' }, email: { stringValue: '' },
      day: { stringValue: 'd1' }, timePref: { stringValue: 'for18' }, source: { stringValue: 'app' },
      attended: { booleanValue: false }, status: { stringValue: 'aktiv' }, shiftId: { stringValue: 'd1-arer-1730' },
      createdAt: { timestampValue: '2026-11-20T10:15:00Z' },
    },
  };
  it('gir riktig rad med stasjon og tider fra oppsettet', () => {
    const row = signupToRow_(decodeDoc_(restDoc), SEED_CONFIG);
    expect(row).toHaveLength(header.length);
    expect(row.slice(0, 8)).toEqual(['abc123', 'Basardag 1', '2026-12-29', 'Årer', '17:30', '19:30', 'Anne Sara', '41234567']);
    expect(row[10]).toBe('aktiv');
    expect(row[11]).toBe('NEI');
  });
  it('venteliste har tom stasjon og tid', () => {
    const d = decodeDoc_({ ...restDoc, fields: { ...restDoc.fields, shiftId: { nullValue: null }, status: { stringValue: 'venteliste' } } });
    const row = signupToRow_(d, SEED_CONFIG);
    expect(row.slice(3, 6)).toEqual(['', '', '']);
    expect(row[10]).toBe('venteliste');
  });
});

describe('kaker og trekning', () => {
  it('kake blir rad med typenavn og JA/NEI', () => {
    const d = decodeDoc_({ name: 'x/cakes/k1', fields: {
      regId: { stringValue: 'r1' }, name: { stringValue: 'Ole' }, phone: { stringValue: '41111111' },
      type: { stringValue: 'vaffel' }, variant: { stringValue: '' }, glutenFree: { booleanValue: true },
      lactoseFree: { booleanValue: false }, allergens: { stringValue: 'egg' }, deliveryDay: { stringValue: 'd2' },
      delivered: { booleanValue: true }, source: { stringValue: 'app' } } });
    const row = cakeToRow_(d, SEED_CONFIG);
    expect(row).toHaveLength(TABS.Kaker.header.length);
    expect(row.slice(4, 11)).toEqual(['Vaffelrøre', '', 'JA', 'NEI', 'egg', 'Basardag 2', 'JA']);
  });

  const V = [TABS.Vakter.header,
    ['a', '', '', '', '', '', 'Anne', '40000001', '', '', 'aktiv', 'JA', 'app', ''],
    ['b', '', '', '', '', '', 'Anne', '40000001', '', '', 'aktiv', 'JA', 'app', ''],
    ['c', '', '', '', '', '', 'Ole', '40000002', '', '', 'aktiv', 'JA', 'app', ''],
    ['d', '', '', '', '', '', 'Ikke møtt', '40000003', '', '', 'aktiv', 'NEI', 'app', ''],
    ['e', '', '', '', '', '', 'Avmeldt', '40000004', '', '', 'avmeldt', 'JA', 'app', '']];
  const K = [TABS.Kaker.header,
    ['k1', 'r', 'Anne', '40000001', 'Fløtekake', '', 'NEI', 'NEI', '', 'Basardag 1', 'JA', 'app', ''],
    ['k2', 'r', 'Kari', '40000005', 'Formkake', '', 'NEI', 'NEI', '', 'Basardag 1', 'NEI', 'app', '']];

  it('lodd: møtt-vakter og leverte kaker, ikke ikke-møtt, avmeldt eller ikke levert', () => {
    const t = buildTickets_(V, K);
    expect(t.map((x: any) => x.name)).toEqual(['Anne', 'Anne', 'Ole', 'Anne']); // Anne 3, Ole 1
  });

  it('regel B: ingen utelukkelse, hver rad er ett lodd', () => {
    const t = buildTickets_(V, K);
    expect(t.filter((x: any) => x.phone === '40000001')).toHaveLength(3);
  });

  it('trekningslisten nummereres 1..N med bare siste 3 siffer', () => {
    const rows = drawRows_(buildTickets_(V, K));
    expect(rows.map((r: any[]) => r[0])).toEqual([1, 2, 3, 4]);
    expect(rows[0][2]).toBe('…001');
    expect(rows[3][3]).toBe('Kake');
  });
});

describe('gevinster', () => {
  const doc = (value: number) => decodeDoc_({ name: 'x/prizes/p1', fields: {
    regId: { stringValue: 'r' }, sponsor: { stringValue: 'Rema 1000 Kautokeino' }, contact: { stringValue: 'Per' },
    phone: { stringValue: '+4741234567' }, gift: { stringValue: 'Gavekort' }, qty: { integerValue: '3' },
    value: { integerValue: String(value) }, status: { stringValue: 'bekreftet' } } });
  it('regner sum', () => {
    const row = prizeToRow_(doc(500));
    expect(row).toHaveLength(TABS.Gevinster.header.length);
    expect(row.slice(6, 10)).toEqual([3, 500, 1500, 'bekreftet']);
    expect(row[11]).toBe('');
  });
  it('verdi 0 betyr ikke oppgitt: tom celle, ikke tekst (QUERY dropper tekst i tallkolonner)', () => {
    expect(prizeToRow_(doc(0)).slice(7, 9)).toEqual(['', '']);
  });
  it('bok kommer i siste kolonne', () => {
    const d = decodeDoc_({ name: 'x/prizes/p2', fields: { qty: { integerValue: '1' }, value: { integerValue: '100' }, book: { stringValue: 'Basarbok 3' } } });
    expect(prizeToRow_(d)[11]).toBe('Basarbok 3');
  });
  it('bokarkets formler bruker riktige kolonner', () => {
    const bm: { exports: any } = { exports: {} };
    vm.runInNewContext(readFileSync('apps-script/bokark/Bokark.gs', 'utf8'), { module: bm });
    expect(bm.exports.BOOKS).toHaveLength(13);
    const f = bm.exports.bookFormula_('Basarbok 1');
    expect(f).toContain("Col12 = 'Basarbok 1'");
    expect(f).toContain('Gevinster!A:L');
    expect(TABS.Gevinster.header[11]).toBe('Bok');
    expect(TABS.Gevinster.header[9]).toBe('Status');
  });
});
