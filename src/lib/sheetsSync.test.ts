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
const { headerPlan_, planUpsert_, signupToRow_, decodeDoc_, TABS } = mod.exports;
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
