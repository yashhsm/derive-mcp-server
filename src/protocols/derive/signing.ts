import { ethers } from "ethers";
import {
  SESSION_PRIVATE_KEY,
  WALLET_ADDRESS,
  DEFAULT_SUBACCOUNT_ID,
  DERIVE_MAINNET,
  getSessionWallet,
  publicRequest,
} from "./client.js";

// ============================================
// NONCE & WEI HELPERS
// ============================================

export function getNonce(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function toWei(value: string): bigint {
  const parts = value.split(".");
  const whole = parts[0] || "0";
  const decimal = (parts[1] || "").padEnd(18, "0").slice(0, 18);
  return BigInt(whole + decimal);
}

// ============================================
// EIP-712 ORDER SIGNING
// ============================================

function encodeTradeModuleData(
  assetAddress: string,
  subId: bigint,
  limitPrice: string,
  amount: string,
  maxFee: string,
  recipientId: number,
  isBid: boolean
): string {
  const encoder = ethers.AbiCoder.defaultAbiCoder();
  return encoder.encode(
    ["address", "uint256", "int256", "int256", "uint256", "uint256", "bool"],
    [assetAddress, subId, toWei(limitPrice), toWei(amount), toWei(maxFee), recipientId, isBid]
  );
}

function computeActionHash(
  subaccountId: number,
  nonce: number,
  moduleAddress: string,
  encodedData: string,
  expiry: number,
  ownerAddress: string,
  signerAddress: string
): string {
  const encoder = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(
    encoder.encode(
      ["bytes32", "uint256", "uint256", "address", "bytes32", "uint256", "address", "address"],
      [
        DERIVE_MAINNET.ACTION_TYPEHASH,
        subaccountId,
        nonce,
        moduleAddress,
        ethers.keccak256(encodedData),
        expiry,
        ownerAddress,
        signerAddress,
      ]
    )
  );
}

function toTypedDataHash(actionHash: string): string {
  const domainSeparatorBytes = Buffer.from(DERIVE_MAINNET.DOMAIN_SEPARATOR.slice(2), "hex");
  const actionHashBytes = Buffer.from(actionHash.slice(2), "hex");
  const prefix = Buffer.from("1901", "hex");
  return ethers.keccak256(Buffer.concat([prefix, domainSeparatorBytes, actionHashBytes]));
}

/**
 * Sign an order payload using EIP-712.
 * Auto-fetches instrument details for asset address + sub_id.
 */
export async function signOrderPayload(params: {
  instrument_name: string;
  direction: "buy" | "sell";
  amount: string;
  limit_price: string;
  max_fee: string;
  order_type?: string;
  time_in_force?: string;
  reduce_only?: boolean;
  label?: string;
  mmp?: boolean;
}): Promise<Record<string, unknown>> {
  if (!SESSION_PRIVATE_KEY || !WALLET_ADDRESS || !DEFAULT_SUBACCOUNT_ID) {
    throw new Error(
      "Order signing requires DERIVE_SESSION_PRIVATE_KEY, DERIVE_WALLET_ADDRESS, and DERIVE_SUBACCOUNT_ID"
    );
  }

  const wallet = getSessionWallet()!;
  const subaccountId = parseInt(DEFAULT_SUBACCOUNT_ID);
  const nonce = getNonce();
  const signatureExpirySec = Math.floor(Date.now() / 1000) + 3600;

  const instrumentDetails = await publicRequest<{
    base_asset_address: string;
    base_asset_sub_id: string;
  }>("get_instrument", { instrument_name: params.instrument_name });

  const assetAddress = instrumentDetails.base_asset_address;
  const subId = BigInt(instrumentDetails.base_asset_sub_id);
  const isBid = params.direction === "buy";

  const encodedData = encodeTradeModuleData(
    assetAddress,
    subId,
    params.limit_price,
    params.amount,
    params.max_fee,
    subaccountId,
    isBid
  );

  const actionHash = computeActionHash(
    subaccountId,
    nonce,
    DERIVE_MAINNET.TRADE_ADDRESS,
    encodedData,
    signatureExpirySec,
    WALLET_ADDRESS,
    wallet.address
  );

  const typedDataHash = toTypedDataHash(actionHash);
  const signature = wallet.signingKey.sign(typedDataHash).serialized;

  return {
    subaccount_id: subaccountId,
    instrument_name: params.instrument_name,
    direction: params.direction,
    amount: params.amount,
    limit_price: params.limit_price,
    max_fee: params.max_fee,
    order_type: params.order_type || "limit",
    time_in_force: params.time_in_force || "gtc",
    reduce_only: params.reduce_only ?? false,
    mmp: params.mmp ?? false,
    label: params.label || "",
    nonce,
    signature_expiry_sec: signatureExpirySec,
    signer: wallet.address,
    signature,
  };
}
