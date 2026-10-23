import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const svgFile = (body: string) =>
  env.services.files.store(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`),
    { filename: 'plan.svg', mime: 'image/svg+xml' },
    env.admin,
  );

describe('lab maps', () => {
  it('links drawing elements to places and lights up the path to a box', async () => {
    const { locations, maps } = env.services;
    const lab = await locations.create({ name: 'Robotics lab', type: 'room' }, env.admin);
    const cabA = await locations.create(
      { name: 'Cabinet A', type: 'cabinet', parent: lab.code },
      env.admin,
    );
    const cabB = await locations.create(
      { name: 'Cabinet B', type: 'cabinet', parent: lab.code },
      env.admin,
    );
    const shelf = await locations.create(
      { name: 'Shelf 3', type: 'shelf', parent: cabA.code },
      env.admin,
    );
    const box = await locations.create({ name: 'Box', type: 'box', parent: shelf.code }, env.admin);

    const plan = await svgFile(
      `<rect id="loc:${cabA.code}"/><rect id="loc-ZZZZ"/><text id="title">Lab</text>`,
    );
    const check = await maps.setMap(lab.code, plan.id, env.inventory);
    expect(check).toEqual({
      linked: [{ code: cabA.code, name: 'Cabinet A' }],
      unknown: ['ZZZZ'],
      notDrawn: [{ code: cabB.code, name: 'Cabinet B' }],
    });

    const front = await svgFile(`<rect id="loc_${shelf.code.toLowerCase()}"/>`);
    await maps.setMap(cabA.code, front.id, env.inventory);

    const layers = await maps.layers(box.code);
    expect(layers.map((l) => [l.location.name, l.highlight])).toEqual([
      ['Robotics lab', [cabA.code, shelf.code, box.code]],
      ['Cabinet A', [shelf.code, box.code]],
    ]);
    expect(layers[0]!.href).toMatch(/^\/api\/files\/.+\/plan\.svg$/);

    // Replacing a drawing keeps one map per place.
    const plan2 = await svgFile(`<rect id="loc:${cabA.code}"/><rect id="loc:${cabB.code}"/>`);
    expect((await maps.setMap(lab.code, plan2.id, env.inventory)).notDrawn).toEqual([]);
    expect((await maps.layers(lab.code)).length).toBe(1);

    await maps.removeMap(cabA.code, 'svg_2d', env.inventory);
    expect((await maps.layers(box.code)).map((l) => l.location.name)).toEqual(['Robotics lab']);
  });

  it('accepts only SVG drawings and needs a token to change maps', async () => {
    const { locations, maps, files } = env.services;
    const lab = await locations.create({ name: 'Lab', type: 'room' }, env.admin);
    const pdf = await files.store(
      Buffer.from('%PDF-1.4'),
      { filename: 'plan.pdf', mime: 'application/pdf' },
      env.admin,
    );
    await expect(maps.setMap(lab.code, pdf.id, env.admin)).rejects.toThrow(/SVG/);
    const svg = await svgFile('');
    await expect(maps.setMap(lab.code, svg.id, null)).rejects.toThrow(/token/);
    await expect(maps.check(lab.code, 'svg_2d')).rejects.toThrow(/not found/);
  });
});

describe('starter map', () => {
  it('draws one linked box per sub-place, which then links up fully', async () => {
    const { locations, maps, files } = env.services;
    const lab = await locations.create({ name: 'Lab & workshop', type: 'room' }, env.admin);
    for (const name of ['Cabinet A', 'Cabinet B', 'Robot cell 2'])
      await locations.create({ name, type: 'cabinet', parent: lab.code }, env.admin);
    const svg = await maps.starterSvg(lab.code);
    expect(svg).toContain('Lab &amp; workshop');
    const file = await files.store(
      Buffer.from(svg),
      { filename: 'starter.svg', mime: 'image/svg+xml' },
      env.admin,
    );
    const check = await maps.setMap(lab.code, file.id, env.admin);
    expect(check.linked).toHaveLength(3);
    expect(check.notDrawn).toEqual([]);
  });
});

describe('3D models', () => {
  it('accepts a .glb next to the SVG and links objects named loc-<code>', async () => {
    const { locations, maps, files } = env.services;
    const lab = await locations.create({ name: 'Lab', type: 'room' }, env.admin);
    const cab = await locations.create(
      { name: 'Cabinet A', type: 'cabinet', parent: lab.code },
      env.admin,
    );
    const json = new TextEncoder().encode(
      JSON.stringify({
        asset: { version: '2.0' },
        nodes: [{ name: `loc-${cab.code}.001` }, { name: 'Walls' }],
      }),
    );
    const padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20);
    padded.set(json);
    const glb = Buffer.alloc(20 + padded.length);
    glb.writeUInt32LE(0x46546c67, 0);
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(padded.length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16);
    Buffer.from(padded).copy(glb, 20);
    const model = await files.store(
      glb,
      { filename: 'lab.glb', mime: 'model/gltf-binary' },
      env.admin,
    );
    const plan = await svgFile(`<rect id="loc:${cab.code}"/>`);

    expect((await maps.setMap(lab.code, model.id, env.admin)).linked).toEqual([
      { code: cab.code, name: 'Cabinet A' },
    ]);
    await maps.setMap(lab.code, plan.id, env.admin);
    expect((await maps.layers(cab.code)).map((l) => l.kind)).toEqual(['gltf_3d', 'svg_2d']);
    expect((await maps.check(lab.code, 'gltf_3d')).linked).toHaveLength(1);
    await maps.removeMap(lab.code, 'gltf_3d', env.admin);
    expect((await maps.layers(cab.code)).map((l) => l.kind)).toEqual(['svg_2d']);
  });
});
