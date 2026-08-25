import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchError } from "../fetch/errors.ts";
import { toolError, toolResult } from "./tool-result.ts";

beforeEach(() => vi.spyOn(process.stderr, "write").mockReturnValue(true));
afterEach(() => vi.restoreAllMocks());

describe("the error taxonomy at the tool boundary", () => {
  it("carries a domain outcome as a normal result, structured and as text", () => {
    const result = toolResult({ status: "gone", fetched_at: "2026-08-25T00:00:00.000Z" });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      status: "gone",
      fetched_at: "2026-08-25T00:00:00.000Z",
    });
    const content = result.content as { text: string }[];
    expect(JSON.parse(content[0]!.text)).toEqual(result.structuredContent);
  });

  it("carries an empty match set as a normal result — nothing matched is an answer", () => {
    expect(toolResult({ matches: [], count: 0 }).isError).toBeUndefined();
  });

  it("turns an operational failure into isError, naming the reason", () => {
    const result = toolError(new FetchError("block", "blocked; 900000 ms of cooldown left"), "search_listings");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const content = result.content as { text: string }[];
    expect(JSON.parse(content[0]!.text)).toEqual({
      error: "block",
      message: "blocked; 900000 ms of cooldown left",
    });
  });

  it("still reports a reason for an error that came from nowhere in the taxonomy", () => {
    const content = toolError(new Error("something else"), "get_listing").content as { text: string }[];
    expect(JSON.parse(content[0]!.text)).toEqual({ error: "network", message: "something else" });
  });
});
