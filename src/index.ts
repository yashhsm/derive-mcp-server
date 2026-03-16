#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { derive } from "./protocols/derive/index.js";
import {
  API_URL,
  WALLET_ADDRESS,
  DEFAULT_SUBACCOUNT_ID,
  getSessionWallet,
  hasPrivateKeyAuth,
  hasAnyAuth,
} from "./protocols/derive/client.js";

// ============================================
// RESPONSE HELPERS
// ============================================

/**
 * JSON replacer that rounds excessively precise numeric strings.
 * Derive API returns values like "1.7449702785691185713545792168588377535343170166015625"
 * which wastes tokens and adds no useful precision. This rounds to 6 decimal places.
 * Only affects string values that look like numbers (not IDs, addresses, etc).
 */
function roundingReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  // Skip hex addresses, UUIDs (contain hex letters or hyphens not at start)
  if (value.startsWith("0x")) return value;
  if (/[a-f]/i.test(value) || value.indexOf("-", 1) !== -1) return value;
  // Must be a numeric string
  if (!/^-?\d+\.?\d*$/.test(value)) return value;
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  // Only round if there are excessive decimals (more than 6)
  const dotIndex = value.indexOf(".");
  if (dotIndex === -1 || value.length - dotIndex - 1 <= 6) return value;
  // For very small numbers, preserve significant digits instead of rounding to zero
  if (Math.abs(num) < 0.000001 && num !== 0) {
    return num.toExponential(2);
  }
  return num.toFixed(6).replace(/\.?0+$/, "");
}

// ============================================
// MCP SERVER — Auto-registers from protocol
// ============================================

const server = new McpServer({
  name: "derive-mcp-server",
  version: "1.0.0",
});

// Auto-register all actions from the protocol as MCP tools
for (const [actionName, action] of Object.entries(derive.actions)) {
  // Extract the Zod schema shape for MCP tool registration
  const schemaShape = (action.schema as any)._zod?.def?.shape
    ?? (action.schema as any).shape
    ?? {};

  // Build a clean zod object from the action's schema shape
  const toolSchema: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(schemaShape)) {
    toolSchema[key] = value as z.ZodType;
  }

  server.tool(
    actionName,
    action.description,
    toolSchema,
    async (params: Record<string, unknown>) => {
      try {
        const result = await action.execute(params as any);
        return {
          content: [{ type: "text", text: JSON.stringify(result, roundingReplacer, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: err.message || String(err) }],
        };
      }
    }
  );
}

// Auth status tool (meta, not part of protocol actions)
server.tool(
  "auth_status",
  "Check what authentication is configured and what capabilities are available.",
  {},
  async () => {
    const status = {
      api_url: API_URL,
      testnet: API_URL.includes("demo"),
      has_private_key_auth: hasPrivateKeyAuth(),
      has_api_key_auth: !!process.env.DERIVE_API_KEY,
      wallet_address: WALLET_ADDRESS || null,
      session_signer: getSessionWallet()?.address || null,
      default_subaccount_id: DEFAULT_SUBACCOUNT_ID || null,
      capabilities: {
        public_data: true,
        read_account: hasAnyAuth(),
        place_orders: hasPrivateKeyAuth(),
        cancel_orders: hasAnyAuth(),
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
  }
);

// ============================================
// START
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
