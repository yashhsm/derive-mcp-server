import { ethers } from "ethers";

// ============================================
// CONFIG
// ============================================

const BASE_URL = process.env.DERIVE_API_URL || "https://api.lyra.finance";
const TESTNET_URL = "https://api-demo.lyra.finance";
export const API_URL = process.env.DERIVE_TESTNET === "true" ? TESTNET_URL : BASE_URL;

export const SESSION_PRIVATE_KEY =
  process.env.DERIVE_SESSION_PRIVATE_KEY || process.env.LYRA_SESSION_PRIVATE_KEY;
export const WALLET_ADDRESS =
  process.env.DERIVE_WALLET_ADDRESS || process.env.LYRA_WALLET_ADDRESS;
export const DEFAULT_SUBACCOUNT_ID =
  process.env.DERIVE_SUBACCOUNT_ID || process.env.LYRA_SUBACCOUNT_ID;
const API_KEY = process.env.DERIVE_API_KEY;

// Derive mainnet constants for EIP-712 order signing
export const DERIVE_MAINNET = {
  TRADE_ADDRESS: "0xB8D20c2B7a1Ad2EE33Bc50eF10876eD3035b5e7b",
  ACTION_TYPEHASH: "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17",
  DOMAIN_SEPARATOR: "0xd96e5f90797da7ec8dc4e276260c7f3f87fedf68775fbe1ef116e996fc60441b",
};

// ============================================
// AUTH
// ============================================

export function getSessionWallet(): ethers.Wallet | null {
  if (!SESSION_PRIVATE_KEY) return null;
  return new ethers.Wallet(SESSION_PRIVATE_KEY);
}

export function hasPrivateKeyAuth(): boolean {
  return !!(SESSION_PRIVATE_KEY && WALLET_ADDRESS);
}

export function hasAnyAuth(): boolean {
  return hasPrivateKeyAuth() || !!API_KEY;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (SESSION_PRIVATE_KEY && WALLET_ADDRESS) {
    const wallet = getSessionWallet()!;
    const timestamp = Date.now().toString();
    const signature = await wallet.signMessage(timestamp);
    headers["X-LyraWallet"] = WALLET_ADDRESS;
    headers["X-LyraTimestamp"] = timestamp;
    headers["X-LyraSignature"] = signature;
  } else if (API_KEY) {
    headers["Authorization"] = `Bearer ${API_KEY}`;
  }

  return headers;
}

// ============================================
// REQUEST HELPERS
// ============================================

interface DeriveApiResponse<T> {
  result: T;
  id?: string;
}

interface DeriveApiError {
  error: { code: number; message: string };
}

const REQUEST_TIMEOUT_MS = 30_000;

export async function publicRequest<T>(
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const endpoint = `/public/${method}`;
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Derive API ${response.status}: ${text}`);
  }

  const data = (await response.json()) as DeriveApiResponse<T> | DeriveApiError;
  if ("error" in data) throw new Error(`Derive: ${data.error.message}`);
  return data.result;
}

export async function privateRequest<T>(
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  if (!hasAnyAuth()) {
    throw new Error(
      "No auth configured. Set DERIVE_SESSION_PRIVATE_KEY + DERIVE_WALLET_ADDRESS, or DERIVE_API_KEY"
    );
  }

  const endpoint = `/private/${method}`;
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Derive API ${response.status}: ${text}`);
  }

  const data = (await response.json()) as DeriveApiResponse<T> | DeriveApiError;
  if ("error" in data) throw new Error(`Derive: ${data.error.message}`);
  return data.result;
}

// ============================================
// HELPERS
// ============================================

export function requireSubaccount(provided?: number | string): number {
  const id = provided ?? DEFAULT_SUBACCOUNT_ID;
  if (!id) throw new Error("subaccount_id required (set DERIVE_SUBACCOUNT_ID or pass it)");
  return typeof id === "string" ? parseInt(id) : id;
}
