import { describe, expect, it } from 'vitest';
import { guessColumns, mapRows, parseQuantity } from './import-map';
import { detectDelimiter, parseDelimited } from './table';

describe('reading spreadsheets', () => {
  it('detects semicolons from Finnish Excel and handles quotes', () => {
    const text =
      '\uFEFFNimike;Tilausnumero;Määrä\r\n"Imukuppi ""SPB1"" 30";SPB1 30 NBR-60;14\r\nLetku 6/4;TU0604BU;"7,5"\r\n';
    expect(detectDelimiter(text)).toBe(';');
    expect(parseDelimited(text)).toEqual([
      ['Nimike', 'Tilausnumero', 'Määrä'],
      ['Imukuppi "SPB1" 30', 'SPB1 30 NBR-60', '14'],
      ['Letku 6/4', 'TU0604BU', '7,5'],
    ]);
  });

  it('keeps newlines inside quoted cells', () => {
    expect(parseDelimited('a,b\n"line 1\nline 2",x')).toEqual([
      ['a', 'b'],
      ['line 1\nline 2', 'x'],
    ]);
  });
});

describe('mapping columns', () => {
  it('guesses columns from English and Finnish headers', () => {
    expect(guessColumns(['Nimike', 'Valmistaja', 'Tilausnumero', 'Määrä', 'Sijainti'])).toEqual({
      name: 'Nimike',
      manufacturer: 'Valmistaja',
      orderNo: 'Tilausnumero',
      quantity: 'Määrä',
      location: 'Sijainti',
    });
    expect(guessColumns(['Item', 'Order No.', 'Qty', 'Unit'])).toMatchObject({
      name: 'Item',
      orderNo: 'Order No.',
      quantity: 'Qty',
      unit: 'Unit',
    });
  });

  it('turns rows into import rows and reports unreadable ones', () => {
    const table = [
      ['Item', 'Qty', 'Unit', 'Tags'],
      ['PU tube', '7,5', 'm', 'spare; Gripper v2'],
      ['Screw M4x12', '1 200 kpl', '', ''],
      ['', '3', '', ''],
      ['Bad', 'lots', '', ''],
    ];
    const mapped = mapRows(table, 1, { name: 'Item', quantity: 'Qty', unit: 'Unit', tags: 'Tags' });
    expect(mapped[0]!.row).toMatchObject({
      name: 'PU tube',
      quantity: 7.5,
      unit: 'm',
      tags: ['spare', 'Gripper v2'],
    });
    expect(mapped[1]!.row).toMatchObject({ quantity: 1200 });
    expect(mapped[2]).toMatchObject({ line: 4, problem: 'no name' });
    expect(mapped[3]!.problem).toMatch(/lots/);
    expect(parseQuantity('')).toBeUndefined();
  });
});

describe('BOM columns', () => {
  it('guesses CAD/TIA headers and multiplies quantities by sets', async () => {
    const { guessBomColumns, toBomLines } = await import('./bom-map');
    const table = [
      ['Item', 'Article no.', 'Description', 'Qty', 'Length'],
      ['1', '6ES7 214-1AG40-0XB0', 'CPU 1214C', '1', ''],
      ['2', '', 'Suction cup 30', '4', ''],
      ['3', 'PROFILE-45', 'Profile 45x45', '2', '400'],
      ['4', '', '', '', ''],
    ];
    const cols = guessBomColumns(table[0]!);
    expect(cols).toEqual({
      ref: 'Article no.',
      quantity: 'Qty',
      name: 'Description',
      size: 'Length',
    });
    expect(toBomLines(table, 1, cols, 2)).toEqual([
      { ref: '6ES7 214-1AG40-0XB0', name: 'CPU 1214C', quantity: 2, size: null },
      { ref: null, name: 'Suction cup 30', quantity: 8, size: null },
      { ref: 'PROFILE-45', name: 'Profile 45x45', quantity: 4, size: '400' },
    ]);
  });
});
