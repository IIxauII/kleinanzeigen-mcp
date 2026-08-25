/**
 * stderr only, never a file, and metadata only — no listing content, ever.
 * `stdout` is reserved for the MCP stdio transport and must stay clean
 * (SPEC 6.4, ADR-0002).
 */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ event, ...fields })}\n`);
}
