import { describe, expect, it } from 'vitest';
import { buildCodeUrl, parseScannedCode } from './qr.js';

describe('buildCodeUrl', () => {
  it('upper-cases URLs without a path so the QR can use alphanumeric mode', () => {
    expect(buildCodeUrl('https://ixf.local', 'location', 'A3F9')).toBe('HTTPS://IXF.LOCAL/L/A3F9');
    expect(buildCodeUrl('http://192.168.1.20:3000/', 'part', 'K7Q2')).toBe(
      'HTTP://192.168.1.20:3000/P/K7Q2',
    );
  });

  it('keeps a base path as is', () => {
    expect(buildCodeUrl('https://lab.example.fi/ixf', 'location', 'A3F9')).toBe(
      'https://lab.example.fi/ixf/L/A3F9',
    );
  });
});

describe('parseScannedCode', () => {
  it('ignores the host so relabelling is never needed', () => {
    expect(parseScannedCode('HTTPS://OLD-NAME.LOCAL/L/A3F9')).toEqual({
      target: 'location',
      code: 'A3F9',
    });
    expect(parseScannedCode('http://10.0.0.5:3000/p/k7q2')).toEqual({
      target: 'part',
      code: 'K7Q2',
    });
  });

  it('accepts bare typed codes', () => {
    expect(parseScannedCode(' a3f9 ')).toEqual({ target: null, code: 'A3F9' });
  });

  it('rejects garbage', () => {
    expect(parseScannedCode('hello world!')).toBeNull();
  });
});
