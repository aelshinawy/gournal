import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { CallToolResult, RegisteredTool, StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';

export { McpServer, StdioServerTransport };

// Keeps the tools/list result equal to SDK 1.x (draft-07 schemas, execution). test/contract.test.ts guards it.
function draft07<T extends z.ZodType>(schema: T): StandardSchemaWithJSON<z.input<T>, z.output<T>> {
  const std = schema['~standard'];
  const jsonSchema = {
    input: () => z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }),
    output: () => z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }),
  };
  const out = Object.create(schema);
  Object.defineProperty(out, '~standard', { value: { ...std, jsonSchema }, enumerable: false });
  return out;
}

export interface FrozenToolConfig<Shape extends z.ZodRawShape> {
  title: string;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: Shape;
  outputSchema?: z.ZodType;
}

export function registerFrozenTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: FrozenToolConfig<Shape>,
  cb: (args: z.output<z.ZodObject<Shape>>) => CallToolResult | Promise<CallToolResult>,
): RegisteredTool {
  const tool = server.registerTool(
    name,
    {
      ...config,
      inputSchema: draft07(z.object(config.inputSchema)),
      outputSchema: config.outputSchema === undefined ? undefined : draft07(config.outputSchema),
    },
    (args) => cb(args as z.output<z.ZodObject<Shape>>),
  );
  tool.execution = { taskSupport: 'forbidden' };
  return tool;
}
