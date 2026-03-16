import type { ZodType } from "zod";

/**
 * Action interface — a stateless, typed function wrapping a Derive API endpoint.
 * Each action is a stateless, typed function.
 */
export interface Action<
  TSchema extends ZodType = ZodType,
  Result = unknown,
> {
  name: string;
  protocol: "derive";
  description: string;
  schema: TSchema;
  responseSchema: ZodType;
  /** "public" = no auth, "read" = needs auth headers, "write" = needs auth + order signing */
  auth: "public" | "read" | "write";
  execute(params: TSchema extends ZodType<infer O> ? O : unknown): Promise<Result>;
}

/**
 * Protocol interface — collection of actions keyed by name.
 */
export interface Protocol {
  name: string;
  actions: Record<string, Action>;
}
