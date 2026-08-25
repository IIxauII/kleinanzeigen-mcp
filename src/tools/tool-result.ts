import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { FetchError } from "../fetch/errors.ts";
import { log } from "../logging.ts";

/**
 * A domain outcome: a normal result, serialised both as structured content and
 * as text.
 *
 * "This listing no longer exists" and "nothing matched" travel this way, with a
 * discriminant in the value — dressing either as an error invites the agent to
 * retry it (SPEC 6.3). A block never reaches here as an empty list: it is an
 * operational failure, by §5.4.
 */
export function toolResult<T extends object>(value: T): CallToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

/**
 * An operational failure: MCP `isError`, carrying the reason so the caller can
 * tell a block from a timeout without parsing prose (SPEC 6.3).
 *
 * A block, retries exhausted, a `Retry-After` past the cap and a parse failure
 * with no stale entry all arrive here — every one of them a case where the
 * server could not answer, never a case where the answer was "nothing".
 */
export function toolError(error: unknown, tool: string): CallToolResult {
  const reason = error instanceof FetchError ? error.reason : "network";
  const message = error instanceof Error ? error.message : String(error);
  log("tool_error", { level: "error", tool, reason, message });
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: reason, message }) }],
  };
}
