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
    expect(check).toMatchObject({
      links: [{ elementKey: `loc:${cabA.code}`, code: cabA.code, name: 'Cabinet A', auto: true }],
      broken: [],
      unknown: ['ZZZZ'],
      notLinked: [{ code: cabB.code, name: 'Cabinet B' }],
    });

    const front = await svgFile(`<rect id="loc_${shelf.code.toLowerCase()}"/>`);
    await maps.setMap(cabA.code, front.id, env.inventory);

    const layers = await maps.layers(box.code);
    expect(layers.map((l) => [l.location.name, l.highlight])).toEqual([
      ['Robotics lab', [cabA.code, shelf.code, box.code]],
      ['Cabinet A', [shelf.code, box.code]],
    ]);
    expect(layers[0]!.href).toMatch(/^\/api\/files\/.+\/plan\.svg$/);
    expect(layers[0]!.links).toEqual({ [`loc:${cabA.code}`]: cabA.code });

    // Replacing a drawing keeps one map per place.
    const plan2 = await svgFile(`<rect id="loc:${cabA.code}"/><rect id="loc:${cabB.code}"/>`);
    expect((await maps.setMap(lab.code, plan2.id, env.inventory)).notLinked).toEqual([]);
    expect((await maps.layers(lab.code)).length).toBe(1);
    expect(await maps.drawings()).toHaveLength(2);

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
    expect(check.links).toHaveLength(3);
    expect(check.notLinked).toEqual([]);
  });
});

describe('nested starter map', () => {
  it('draws the places inside each sub-place too, in the order they are numbered', async () => {
    const { locations, maps, files } = env.services;
    const cab = await locations.create(
      { name: 'Drawer cabinet', type: 'cabinet', numberFrom: 'top' },
      env.admin,
    );
    for (const row of ['Row 2', 'Row 1']) {
      const r = await locations.create(
        { name: row, type: 'shelf', parent: cab.code, numberFrom: 'left' },
        env.admin,
      );
      for (const [short, name] of [
        ['2', 'M4 nuts'],
        ['1', 'M3 screws'],
      ] as const)
        await locations.create(
          { name, shortName: short, type: 'drawer', parent: r.code },
          env.admin,
        );
    }
    const svg = await maps.starterSvg(cab.code);
    // Row 1 above row 2, drawer 1 left of drawer 2, labelled by short name.
    const ys = [...svg.matchAll(/<text x="\d+" y="(\d+)"[^>]*>(Row \d)</g)].map((m) => [
      m[2],
      +m[1]!,
    ]);
    expect(ys[0]![0]).toBe('Row 1');
    expect(ys[0]![1]).toBeLessThan(ys[1]![1] as number);
    const xs = [...svg.matchAll(/<text x="(\d+)" y="\d+"[^>]*>([12])</g)]
      .slice(0, 2)
      .map((m) => m[2]);
    expect(xs).toEqual(['1', '2']);
    const file = await files.store(
      Buffer.from(svg),
      { filename: 'starter.svg', mime: 'image/svg+xml' },
      env.admin,
    );
    const check = await maps.setMap(cab.code, file.id, env.admin);
    expect(check.links).toHaveLength(6);
    expect(check.notLinked).toEqual([]);
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

    expect((await maps.setMap(lab.code, model.id, env.admin)).links).toEqual([
      { elementKey: `loc-${cab.code}.001`, code: cab.code, name: 'Cabinet A', auto: true },
    ]);
    await maps.setMap(lab.code, plan.id, env.admin);
    expect((await maps.layers(cab.code)).map((l) => l.kind)).toEqual(['gltf_3d', 'svg_2d']);
    expect((await maps.check(lab.code, 'gltf_3d')).links).toHaveLength(1);
    // Objects can also be linked by clicking, by their plain Blender name.
    const walls = await maps.setLink(lab.code, 'gltf_3d', 'Walls', cab.code, env.admin);
    expect(walls.links).toEqual([
      { elementKey: 'Walls', code: cab.code, name: 'Cabinet A', auto: false },
    ]);
    await maps.removeMap(lab.code, 'gltf_3d', env.admin);
    expect((await maps.layers(cab.code)).map((l) => l.kind)).toEqual(['svg_2d']);
  });
});

describe('shared drawings', () => {
  /** A lab with cabinets of shelves; returns the codes by name. */
  async function lab() {
    const { locations } = env.services;
    const room = await locations.create({ name: 'Lab', type: 'room' }, env.admin);
    const make = async (cab: string) => {
      const c = await locations.create(
        { name: cab, type: 'cabinet', parent: room.code },
        env.admin,
      );
      const shelves = [];
      for (const s of ['Shelf 1', 'Shelf 2'])
        shelves.push(await locations.create({ name: s, type: 'shelf', parent: c.code }, env.admin));
      return { cab: c, shelves };
    };
    return { room, a: await make('Cabinet A'), b: await make('Cabinet B') };
  }

  it('gives SVG shapes ids, links them by clicking, and copies the links to a twin cabinet', async () => {
    const { maps } = env.services;
    const { a, b } = await lab();
    const front = await svgFile('<rect x="0"/><rect x="50"/><text>Cabinet</text>');
    const check = await maps.setMap(a.cab.code, front.id, env.inventory);
    expect(check.links).toEqual([]);
    expect(check.notLinked.map((n) => n.name)).toEqual(['Shelf 1', 'Shelf 2']);
    expect(check.drawing.usedBy).toBe(1);

    await maps.setLink(a.cab.code, 'svg_2d', 'ixf-1', a.shelves[0]!.code, env.inventory);
    const linked = await maps.setLink(
      a.cab.code,
      'svg_2d',
      'ixf-2',
      a.shelves[1]!.code,
      env.inventory,
    );
    expect(linked.notLinked).toEqual([]);
    // A place outside the cabinet can't be linked.
    await expect(
      maps.setLink(a.cab.code, 'svg_2d', 'ixf-3', b.shelves[0]!.code, env.inventory),
    ).rejects.toThrow(/isn't inside/);
    // Re-linking a shelf moves its link to the new shape.
    const moved = await maps.setLink(
      a.cab.code,
      'svg_2d',
      'ixf-3',
      a.shelves[0]!.code,
      env.inventory,
    );
    expect(moved.links.map((l) => [l.elementKey, l.name])).toEqual([
      ['ixf-3', 'Shelf 1'],
      ['ixf-2', 'Shelf 2'],
    ]);

    const copied = await maps.attach(b.cab.code, check.drawing.id, a.cab.code, env.inventory);
    expect(copied.drawing.usedBy).toBe(2);
    expect(copied.links.map((l) => [l.elementKey, l.code])).toEqual([
      ['ixf-3', b.shelves[0]!.code],
      ['ixf-2', b.shelves[1]!.code],
    ]);
    expect((await maps.layers(b.shelves[0]!.code))[0]!.links['ixf-3']).toBe(b.shelves[0]!.code);
  });

  it('replaces a shared drawing for every place and reports links whose shapes are gone', async () => {
    const { maps } = env.services;
    const { a, b } = await lab();
    const v1 = await svgFile('<rect id="s1"/><rect id="s2"/>');
    const drawing = await maps.createDrawing(v1.id, 'Cabinet front', env.inventory);
    await maps.attach(a.cab.code, drawing.id, null, env.inventory);
    await maps.setLink(a.cab.code, 'svg_2d', 's1', a.shelves[0]!.code, env.inventory);
    await maps.setLink(a.cab.code, 'svg_2d', 's2', a.shelves[1]!.code, env.inventory);
    await maps.attach(b.cab.code, drawing.id, a.cab.code, env.inventory);

    // Uploading to one of the places that share it doesn't touch the other.
    const own = await svgFile('<rect id="s1"/>');
    const ownCheck = await maps.setMap(b.cab.code, own.id, env.inventory);
    expect(ownCheck.drawing.id).not.toBe(drawing.id);
    await maps.attach(b.cab.code, drawing.id, a.cab.code, env.inventory);

    const v2 = await svgFile('<rect id="s1"/><rect id="s3"/>');
    const results = await maps.replaceDrawing(drawing.id, v2.id, env.inventory);
    expect(results.map((r) => [r.location, r.check.broken.map((l) => l.elementKey)])).toEqual([
      [a.cab.code, ['s2']],
      [b.cab.code, ['s2']],
    ]);
    const library = await maps.drawings();
    expect(library.find((d) => d.id === drawing.id)?.usages.map((u) => u.broken)).toEqual([1, 1]);
    await expect(maps.deleteDrawing(drawing.id, env.inventory)).rejects.toThrow(/Still used/);
    await maps.removeMap(a.cab.code, 'svg_2d', env.inventory);
    await maps.removeMap(b.cab.code, 'svg_2d', env.inventory);
    await maps.deleteDrawing(drawing.id, env.inventory);
  });
});

describe('copying places', () => {
  it('copies a cabinet with its shelves, new codes, numbered names and linked maps', async () => {
    const { locations, maps } = env.services;
    const room = await locations.create({ name: 'Lab', type: 'room' }, env.admin);
    const cab = await locations.create(
      { name: 'Cabinet A', type: 'cabinet', parent: room.code },
      env.admin,
    );
    const shelf = await locations.create(
      { name: 'Shelf 1', type: 'shelf', parent: cab.code },
      env.admin,
    );
    await locations.create(
      { name: 'Box', type: 'box', parent: shelf.code, description: 'M4' },
      env.admin,
    );
    await locations.create({ name: 'Cabinet C', type: 'cabinet', parent: room.code }, env.admin);
    const front = await svgFile('<rect id="top"/>');
    await maps.setMap(cab.code, front.id, env.admin);
    await maps.setLink(cab.code, 'svg_2d', 'top', shelf.code, env.admin);

    const copies = await locations.duplicate(cab.code, { count: 2 }, env.inventory, (tx, pairs) =>
      maps.copyMapsFor(tx, pairs),
    );
    expect(copies.map((c) => c.name)).toEqual(['Cabinet B', 'Cabinet D']);
    expect(copies[0]!.code).not.toBe(cab.code);
    const tree = await locations.tree(copies[0]!.code);
    expect(tree[0]!.type).toBe('cabinet');
    const copiedShelf = tree[0]!.children[0]!;
    expect([copiedShelf.name, copiedShelf.children[0]!.name]).toEqual(['Shelf 1', 'Box']);
    expect(copiedShelf.code).not.toBe(shelf.code);

    const check = await maps.check(copies[1]!.code, 'svg_2d');
    expect(check.drawing.usedBy).toBe(3);
    expect(check.links.map((l) => l.name)).toEqual(['Shelf 1']);
    expect(check.links[0]!.code).not.toBe(shelf.code);

    // Shapes linked by loc-<code> names link the copies too (the copies have new codes).
    const shelf2 = await locations.create(
      { name: 'Shelf 2', type: 'shelf', parent: cab.code },
      env.admin,
    );
    const named2 = await svgFile(`<rect id="loc-${shelf2.code}"/><rect id="top"/>`);
    await maps.setMap(cab.code, named2.id, env.admin);
    // The old drawing was shared by then, so this is a new drawing without the old links.
    await maps.setLink(cab.code, 'svg_2d', 'top', shelf.code, env.admin);
    const [byName] = await locations.duplicate(cab.code, {}, env.inventory, (tx, pairs) =>
      maps.copyMapsFor(tx, pairs),
    );
    const byNameCheck = await maps.check(byName!.code, 'svg_2d');
    expect(byNameCheck.links.map((l) => [l.elementKey, l.name, l.auto])).toEqual([
      ['top', 'Shelf 1', false],
      [`loc-${shelf2.code}`, 'Shelf 2', false],
    ]);
    expect(byNameCheck.unknown).toEqual([]);

    const named = await locations.duplicate(
      shelf.code,
      { name: 'Top shelf', parent: room.code },
      env.inventory,
    );
    expect(named.map((n) => n.name)).toEqual(['Top shelf']);
    await expect(locations.duplicate(cab.code, {}, null)).rejects.toThrow(/token/);
  });
});
