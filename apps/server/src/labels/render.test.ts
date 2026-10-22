import { describe, expect, it } from 'vitest';
import { labelsCsv, labelSvg, qrDxf, qrMatrix, qrSvg, type LabelData } from './render.js';

const label: LabelData = {
  code: 'A3F9',
  kind: 'location',
  name: 'Box: vacuum parts',
  path: 'Robotics lab › Cabinet A › Shelf 3',
  type: 'box',
  qr: 'HTTPS://IXF.LOCAL/L/A3F9',
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
    expect(csv.startsWith('\uFEFFcode,qr,name,path,type\r\n')).toBe(true);
    expect(csv).toContain('"Fitting ""L"", 6 mm"');
  });
});
