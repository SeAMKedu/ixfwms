import { describe, expect, it } from 'vitest';
import { codeFromElementId, scanSvgCodes } from './maps.js';

describe('map element ids', () => {
  it('reads loc:, loc- and loc_ ids, case-insensitively', () => {
    expect(codeFromElementId('loc:A3F9')).toBe('A3F9');
    expect(codeFromElementId('loc-a3f9')).toBe('A3F9');
    expect(codeFromElementId('LOC_K7Q2')).toBe('K7Q2');
    expect(codeFromElementId('location:A3F9')).toBeNull();
    expect(codeFromElementId('loc:!!')).toBeNull();
  });

  it('finds every linked code once in an SVG document', () => {
    const svg = `<svg><rect id="loc:A3F9"/><g id='loc-K7Q2'><rect id="loc:A3F9"/></g><text id="title">Lab</text></svg>`;
    expect(scanSvgCodes(svg)).toEqual(['A3F9', 'K7Q2']);
  });
});

describe('3D object names', () => {
  it('reads Blender names and the forms three.js makes of them', async () => {
    const { codeFromObjectName } = await import('./maps.js');
    expect(codeFromObjectName('loc-A3F9')).toBe('A3F9');
    expect(codeFromObjectName('loc:A3F9')).toBe('A3F9');
    expect(codeFromObjectName('locA3F9')).toBe('A3F9');
    expect(codeFromObjectName('loc-A3F9.001')).toBe('A3F9');
    expect(codeFromObjectName('Cube.001')).toBeNull();
    expect(codeFromObjectName('locker')).toBeNull();
  });

  it('lists codes from a GLB file', async () => {
    const { scanGlbCodes } = await import('./maps.js');
    const json = new TextEncoder().encode(
      JSON.stringify({
        asset: { version: '2.0' },
        nodes: [{ name: 'loc-A3F9' }, { name: 'Floor' }, { name: 'loc:K7Q2.001' }],
      }),
    );
    const padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20);
    padded.set(json);
    const glb = new Uint8Array(20 + padded.length);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, glb.length, true);
    view.setUint32(12, padded.length, true);
    view.setUint32(16, 0x4e4f534a, true);
    glb.set(padded, 20);
    expect(scanGlbCodes(glb)).toEqual(['A3F9', 'K7Q2']);
    expect(scanGlbCodes(new Uint8Array([1, 2, 3]))).toEqual([]);
  });
});
