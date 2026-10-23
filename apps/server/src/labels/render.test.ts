import { describe, expect, it } from 'vitest';
import { labelsCsv, labelSvg, qrDxf, qrMatrix, qrSvg, type LabelData } from './render.js';

const label: LabelData = {
  code: 'A3F9',
  kind: 'location',
  name: 'Box: vacuum parts',
  path: 'Robotics lab › Cabinet A › Shelf 3',
  type: 'box',
  qr: 'HTTPS://IXF.LOCAL/L/A3F9',
  address: 'B7',
  parent: 'RL-A-3',
  short: 'B7',
  movable: true,
};

describe('label rendering', () => {
  it('keeps upper-case label URLs in a version 2 (25×25) QR', () => {
    // 27 characters: alphanumeric mode fits version 2, byte mode (lower case) needs version 3.
    expect(qrMatrix('HTTPS://IXF.INTERNAL/L/A3F9').size).toBe(25);
    expect(qrMatrix('https://ixf.internal/l/a3f9').size).toBe(29);
  });

  it('draws tape labels at the printable height of each tape', () => {
    expect(labelSvg(label, 9)).toContain('height="7mm"');
    expect(labelSvg(label, 9)).not.toContain('Box: vacuum parts');
    expect(labelSvg(label, 12)).toContain('Box: vacuum parts');
    const wide = labelSvg(label, 24);
    expect(wide).toContain('height="18mm"');
    expect(wide).toContain('Robotics lab › Cabinet A › Shelf 3');
  });

  it('shows a tool by its name and home address, the code only small on wide tape', () => {
    const drill: LabelData = {
      ...label,
      kind: 'unit',
      type: 'unit',
      code: 'D2D2',
      name: 'Drill 2',
      path: 'Impact drill · S/N SN-12346',
      qr: 'HTTPS://IXF.LOCAL/U/D2D2',
      address: 'Robolab-A-3',
      parent: '',
      short: '',
      movable: false,
    };
    const narrow = labelSvg(drill, 9);
    expect(narrow).toContain('Robolab-A-3');
    expect(narrow).not.toContain('D2D2</text>');
    const mid = labelSvg(drill, 12);
    expect(mid).toContain('Drill 2');
    expect(mid).toContain('Robolab-A-3');
    expect(mid).not.toContain('D2D2</text>');
    expect(labelSvg(drill, 24)).toContain('Impact drill · S/N SN-12346 · D2D2');
    // Without a home, the code stands in for the address.
    expect(labelSvg({ ...drill, address: '' }, 12)).toContain('D2D2</text>');
  });

  it('shows a fixed place by its address, the part above it smaller', () => {
    const shelf = {
      ...label,
      name: 'Shelf C',
      type: 'shelf',
      address: 'Robolab-A-C',
      parent: 'Robolab-A',
      short: 'C',
      movable: false,
    };
    const svg = labelSvg(shelf, 12);
    expect(svg).toMatch(/<tspan font-size="[\d.]+" font-weight="400">Robolab-A-<\/tspan>C<\/text>/);
    expect(svg).not.toContain('A3F9<');
    expect(labelSvg(shelf, 24)).toContain('A3F9 · Robotics lab');
    // Containers move around, so their labels keep the code.
    expect(labelSvg(label, 12)).toContain('>A3F9</text>');
  });

  it('escapes text in SVG', () => {
    expect(labelSvg({ ...label, name: 'Nuts & <bolts>' }, 12)).toContain(
      'Nuts &amp; &lt;bolts&gt;',
    );
  });

  it('produces a plain QR SVG and a DXF in millimetres', () => {
    expect(qrSvg(label.qr, { sizeMm: 20 })).toContain('width="20mm"');
    const dxf = qrDxf(label.qr, { moduleMm: 0.8, card: true });
    expect(dxf).toMatch(/^0\r\nSECTION/);
    expect(dxf).toContain('$INSUNITS');
    expect(dxf).toContain('CIRCLE');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('writes CSV for P-touch Editor with a BOM and quoting', () => {
    const csv = labelsCsv([label, { ...label, code: 'K7Q2', name: 'Fitting "L", 6 mm' }]);
    expect(csv.startsWith('\uFEFFcode,qr,name,path,type,address,parent,short\r\n')).toBe(true);
    expect(csv).toContain(',box,B7,RL-A-3,B7\r\n');
    expect(csv).toContain('"Fitting ""L"", 6 mm"');
  });
});
