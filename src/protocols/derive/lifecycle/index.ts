// ============================================
// ORDER LIFECYCLE MANAGER — Tool Registry
// ============================================

import { z } from "zod";
import {
  placeAndVerifySchema,
  placeAndVerifyDescription,
  executePlaceAndVerify,
} from "./place-and-verify.js";
import {
  verifyOrderSchema,
  verifyOrderDescription,
  executeVerifyOrder,
} from "./verify-order.js";
import {
  createRfqSchema,
  createRfqDescription,
  executeCreateRfq,
} from "./create-rfq.js";
import {
  awaitRfqQuotesSchema,
  awaitRfqQuotesDescription,
  executeAwaitRfqQuotes,
} from "./await-rfq-quotes.js";
import {
  acceptRfqQuoteSchema,
  acceptRfqQuoteDescription,
  executeAcceptRfqQuote,
} from "./accept-rfq-quote.js";
import {
  checkMultiLegMarginSchema,
  checkMultiLegMarginDescription,
  executeCheckMultiLegMargin,
} from "./check-multi-leg-margin.js";
import {
  orderAuditLogSchema,
  orderAuditLogDescription,
  executeOrderAuditLog,
} from "./order-audit-log.js";
import {
  reconcileSchema,
  reconcileDescription,
  executeReconcile,
} from "./reconcile.js";

// --- Helpers ---

function extractShape(zodSchema: z.ZodObject<any>): Record<string, z.ZodType> {
  const shape = (zodSchema as any)._zod?.def?.shape
    ?? (zodSchema as any).shape
    ?? {};
  const result: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(shape)) {
    result[key] = value as z.ZodType;
  }
  return result;
}

/**
 * JSON replacer for lifecycle results — rounds excessively precise numeric strings.
 */
function lifecycleReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.startsWith("0x")) return value;
  if (/[a-f]/i.test(value) || value.indexOf("-", 1) !== -1) return value;
  if (!/^-?\d+\.?\d*$/.test(value)) return value;
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  const dotIndex = value.indexOf(".");
  if (dotIndex === -1 || value.length - dotIndex - 1 <= 6) return value;
  if (Math.abs(num) < 0.000001 && num !== 0) return num.toExponential(2);
  return num.toFixed(6).replace(/\.?0+$/, "");
}

function makeHandler(executeFn: (params: any) => Promise<any>, schema: z.ZodType) {
  return async (params: Record<string, unknown>) => {
    try {
      const validated = schema.parse(params);
      const result = await executeFn(validated);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, lifecycleReplacer, 2) }],
      };
    } catch (err: any) {
      return {
        isError: true as const,
        content: [{ type: "text" as const, text: err.message || String(err) }],
      };
    }
  };
}

// --- Tool Registration ---

export const lifecycleTools = {
  place_and_verify: {
    description: placeAndVerifyDescription,
    schema: extractShape(placeAndVerifySchema),
    handler: makeHandler(executePlaceAndVerify, placeAndVerifySchema),
  },
  verify_order: {
    description: verifyOrderDescription,
    schema: extractShape(verifyOrderSchema),
    handler: makeHandler(executeVerifyOrder, verifyOrderSchema),
  },
  create_rfq: {
    description: createRfqDescription,
    schema: extractShape(createRfqSchema),
    handler: makeHandler(executeCreateRfq, createRfqSchema),
  },
  await_rfq_quotes: {
    description: awaitRfqQuotesDescription,
    schema: extractShape(awaitRfqQuotesSchema),
    handler: makeHandler(executeAwaitRfqQuotes, awaitRfqQuotesSchema),
  },
  accept_rfq_quote: {
    description: acceptRfqQuoteDescription,
    schema: extractShape(acceptRfqQuoteSchema),
    handler: makeHandler(executeAcceptRfqQuote, acceptRfqQuoteSchema),
  },
  check_multi_leg_margin: {
    description: checkMultiLegMarginDescription,
    schema: extractShape(checkMultiLegMarginSchema),
    handler: makeHandler(executeCheckMultiLegMargin, checkMultiLegMarginSchema),
  },
  order_audit_log: {
    description: orderAuditLogDescription,
    schema: extractShape(orderAuditLogSchema),
    handler: makeHandler(executeOrderAuditLog, orderAuditLogSchema),
  },
  reconcile: {
    description: reconcileDescription,
    schema: extractShape(reconcileSchema),
    handler: makeHandler(executeReconcile, reconcileSchema),
  },
};
