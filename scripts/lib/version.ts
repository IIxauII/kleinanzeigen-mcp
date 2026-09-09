/** A specific version, never a range and never `latest` — both are rejected. */
const PUBLISHABLE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Refuse a version no release channel would take, before anything touches the
 * disk or the network.
 *
 * One rule in one place because one release input reaches all of them: npm, the
 * MCPB manifest, the plugin's pin and the registry submission. The registry is
 * the reason it is a refusal rather than a warning — a version it cannot parse
 * as semver is marked `latest` **even when it sorts earlier**, so a malformed
 * input would quietly repoint the listing rather than fail it (SPEC 8.7).
 */
export function assertPublishableVersion(version: string): void {
  if (!PUBLISHABLE_VERSION.test(version)) {
    throw new Error(`\`${version}\` is not a version the release channels would accept: ranges and \`latest\` are rejected`);
  }
}
