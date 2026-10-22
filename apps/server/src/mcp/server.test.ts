import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';
import { createMcpServer } from './server.js';

let env: TestEnv;
let client: Client;

beforeEach(async () => {
  env = await createTestEnv();
  const server = createMcpServer(env.services, env.inventory, 'http://lab.test', '0.0.0-test');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
});
afterEach(async () => {
  await client.close();
  await env.cleanup();
});

async function call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
  if (res.isError) throw new Error(text);
  return JSON.parse(text) as T;
}

describe('MCP tools', () => {
  it('runs the initial-inventory flow: drafts in the Inbox, then into a box', async () => {
    const shelf = await call<{ code: string }>('create_location', {
      name: 'Shelf 3',
      type: 'shelf',
    });
    const box = await call<{ code: string; url: string }>('create_location', {
      name: 'Box: vacuum parts',
      parent: shelf.code,
    });
    expect(box.url).toBe(`http://lab.test/l/${box.code}`);

    const [draft] = await call<{ ok: boolean; code: string; lots: { lotId: string }[] }[]>(
      'create_part_drafts',
      {
        parts: [
          {
            name: 'Vacuum generator VN-10',
            manufacturer: 'Festo',
            identifiers: [{ value: 'VN-10-H-T3-PQ2-VQ3-RO1' }],
            source: 'order 4711',
            stock: { amount: { mode: 'count', quantity: 4 } },
          },
        ],
      },
    );
    expect(draft?.ok).toBe(true);

    const similar = await call<{ code: string; score: number }[]>('find_similar_parts', {
      identifiers: ['vn-10-h-t3-pq2-vq3-ro1'],
    });
    expect(similar[0]).toMatchObject({ code: draft!.code, score: 1 });

    await call('move_stock', { lotId: draft!.lots[0]!.lotId, to: box.code });
    const loc = await call<{ contents: { part: { code: string }; display: string }[] }>(
      'get_location',
      { ref: box.code },
    );
    expect(loc.contents).toEqual([
      expect.objectContaining({
        part: expect.objectContaining({ code: draft!.code }),
        display: '4 pcs',
      }),
    ]);

    const part = await call<{ lots: { path: { name: string }[] }[]; url: string }>('get_part', {
      ref: draft!.code,
    });
    expect(part.lots[0]!.path.map((p) => p.name)).toEqual(['Shelf 3', 'Box: vacuum parts']);
  });

  it('reports problems as tool errors, not crashes', async () => {
    await expect(call('get_part', { ref: 'nope' })).rejects.toThrow(/not found/);
    await expect(call('add_stock', { part: 'nope', amount: { mode: 'count' } })).rejects.toThrow(
      /quantity|not found/,
    );
  });

  it('attaches links with absolute URLs and explains uploads', async () => {
    const [draft] = await call<{ code: string }[]>('create_part_drafts', {
      parts: [{ name: 'Suction cup' }],
    });
    const att = await call<{ href: string }>('attach_file', {
      owner: 'part',
      ref: draft!.code,
      kind: 'product_page',
      url: 'https://example.com/spb1',
    });
    expect(att.href).toBe('https://example.com/spb1');
    const info = await call<{ curl: string }>('get_upload_info');
    expect(info.curl).toContain('http://lab.test/api/files');
  });

  it('lists all tools with descriptions', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(15);
    expect(tools.every((t) => (t.description ?? '').length > 10)).toBe(true);
  });
});
