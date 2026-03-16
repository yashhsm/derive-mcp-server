import { z } from "zod";

// Generic passthrough for raw API responses
export const rawResponseSchema = z.unknown();

// Ticker
export const tickerSchema = z.object({
  instrument_name: z.string(),
  best_bid_price: z.string(),
  best_ask_price: z.string(),
  best_bid_amount: z.string(),
  best_ask_amount: z.string(),
  mark_price: z.string(),
  index_price: z.string(),
}).passthrough();

// Index price (derived from perp ticker)
export const indexPriceSchema = z.object({
  currency: z.string(),
  index_price: z.string(),
  mark_price: z.string(),
});

// Position
export const positionSchema = z.object({
  instrument_name: z.string(),
  amount: z.string(),
  average_price: z.string(),
  mark_price: z.string(),
  unrealized_pnl: z.string(),
  realized_pnl: z.string(),
}).passthrough();

// Order
export const orderSchema = z.object({
  order_id: z.string(),
  instrument_name: z.string(),
  direction: z.enum(["buy", "sell"]),
  amount: z.string(),
  limit_price: z.string(),
  order_status: z.string(),
  filled_amount: z.string(),
}).passthrough();

// Collateral
export const collateralSchema = z.object({
  asset_name: z.string(),
  amount: z.string(),
  mark_value: z.string(),
}).passthrough();

// Auth status
export const authStatusSchema = z.object({
  api_url: z.string(),
  testnet: z.boolean(),
  has_private_key_auth: z.boolean(),
  has_api_key_auth: z.boolean(),
  wallet_address: z.string().nullable(),
  session_signer: z.string().nullable(),
  default_subaccount_id: z.string().nullable(),
  capabilities: z.object({
    public_data: z.boolean(),
    read_account: z.boolean(),
    place_orders: z.boolean(),
    cancel_orders: z.boolean(),
  }),
});

