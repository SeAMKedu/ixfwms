import { ATTACHMENT_KINDS } from '@ixfwms/domain';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { read, tool, write, type ToolContext } from '../../mcp/tool.js';

/** Uploading files and attaching files and links. */
export function filesTools(
  server: McpServer,
  { services, actor, links, baseUrl }: ToolContext,
): void {
  const { files } = services;

  server.registerTool(
    'get_upload_info',
    {
      title: 'How to upload files',
      description:
        'How to upload a photo, datasheet or CAD file so it can be attached with attach_file.',
      annotations: read,
    },
    tool(() =>
      Promise.resolve({
        uploadUrl: `${baseUrl}/api/files`,
        curl: `curl -sS -H "Authorization: Bearer $IXF_TOKEN" -F "file=@/path/to/photo.jpg" ${baseUrl}/api/files`,
        note: 'The response JSON has an "id"; pass it as fileId to attach_file. Use the same API token as this MCP connection.',
      }),
    ),
  );

  server.registerTool(
    'attach_file',
    {
      title: 'Attach file or link',
      description:
        'Attach an uploaded file (by id) or a URL (product page, datasheet, CAD download) to a part or place.',
      inputSchema: {
        owner: z.enum(['part', 'location']),
        ref: z.string(),
        kind: z.enum(ATTACHMENT_KINDS),
        fileId: z.string().optional(),
        url: z.string().optional(),
        title: z.string().optional(),
      },
      annotations: write,
    },
    tool(async (a) => {
      const view = await files.attach(
        {
          owner: a.owner,
          ref: a.ref,
          kind: a.kind,
          fileId: a.fileId ?? null,
          url: a.url ?? null,
          title: a.title ?? null,
        },
        actor,
      );
      return { ...view, href: links.abs(view.href) };
    }),
  );
}
