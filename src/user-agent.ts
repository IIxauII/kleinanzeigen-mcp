import { VERSION } from "./version.ts";

/**
 * Fixed in code, deliberately not an environment variable: the User-Agent names
 * the project and links to it, so the site operator has something to block
 * (SPEC 8.5, ADR-0003). The build-time dataset generator sends it too.
 */
export const USER_AGENT = `kleinanzeigen-mcp/${VERSION} (+https://github.com/IIxauII/kleinanzeigen-mcp)`;
