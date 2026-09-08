/**
 * What a drift run has to say, and what the process exits with.
 *
 * One run covers **both** datasets, and each keeps its own outcome: the stderr
 * report always names them separately, because a caller decides whether to open
 * an issue from the *report* rather than from the process exit. A dataset at
 * `drifted` stays visible as drift even when the other dataset's outage pushed
 * the exit to `2` — real drift is never swallowed by the other half's failure
 * (SPEC 7, `docs/maintenance.md`).
 */

export const DATASETS = ["categories", "locations"] as const;

export type DatasetName = (typeof DATASETS)[number];

/** A node that kept its id and changed its German name. */
export type Rename = { id: number; from: string; to: string };

export type DatasetReport =
  | { dataset: DatasetName; outcome: "clean"; bundled_count: number; live_count: number }
  | {
      dataset: DatasetName;
      outcome: "drifted";
      bundled_count: number;
      live_count: number;
      added: number[];
      removed: number[];
      renamed: Rename[];
    }
  | { dataset: DatasetName; outcome: "unavailable"; message: string };

/** What a maintainer runs when a dataset has drifted. Drift is fixed by shipping a new version. */
export const REBUILD_COMMANDS: Record<DatasetName, string> = {
  categories: "npm run generate:category-tree",
  locations: "npm run generate:cities",
};

/** How each dataset's ids are written down: `c210`, `l3331`. */
const ID_PREFIX: Record<DatasetName, string> = { categories: "c", locations: "l" };

/** The live side of a dataset: every id it published, and the names it carried, if any. */
export type LiveDataset = {
  ids: ReadonlySet<number>;
  /** Absent when the legs that ran carry no names — then renames are not checked, not "none". */
  names?: ReadonlyMap<number, string>;
};

const ascending = (left: number, right: number): number => left - right;

/**
 * The verdict for one dataset: set difference both ways, plus the names that
 * changed under an id that stayed. Order in either input is immaterial.
 *
 * A rename is drift in its own right: `find_location` matches on the name, so a
 * locality renamed on the site stops resolving from the bundled dataset even
 * though its id is untouched (CONTEXT.md, *Location drift*).
 */
export function reportFor(
  dataset: DatasetName,
  bundled: ReadonlyMap<number, string>,
  live: LiveDataset,
): DatasetReport {
  const counts = { bundled_count: bundled.size, live_count: live.ids.size };
  const added = [...live.ids].filter((id) => !bundled.has(id)).sort(ascending);
  const removed = [...bundled.keys()].filter((id) => !live.ids.has(id)).sort(ascending);
  const renamed: Rename[] = [];
  for (const [id, name] of live.names ?? []) {
    const was = bundled.get(id);
    if (was !== undefined && was !== name) renamed.push({ id, from: was, to: name });
  }
  renamed.sort((left, right) => ascending(left.id, right.id));

  if (added.length === 0 && removed.length === 0 && renamed.length === 0) {
    return { dataset, outcome: "clean", ...counts };
  }
  return { dataset, outcome: "drifted", ...counts, added, removed, renamed };
}

/** Reports a leg that never produced readable bytes, which is not the same as a clean dataset. */
export function unavailable(dataset: DatasetName, error: unknown): DatasetReport {
  return {
    dataset,
    outcome: "unavailable",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * `2` outranks `1` outranks `0`: one process, one exit code, two datasets.
 *
 * `2` is deliberately not `0` — a check that never reached the site has not
 * established that the bundle is current — and it outranks `1` because a run
 * with a leg missing cannot claim to have found *all* the drift there is.
 */
export function driftExitCode(reports: readonly DatasetReport[]): number {
  if (reports.some((report) => report.outcome === "unavailable")) return 2;
  if (reports.some((report) => report.outcome === "drifted")) return 1;
  return 0;
}

/** At most ten ids on a line; a taxonomy-wide change should not fill a terminal. */
function sample(ids: readonly number[], prefix: string): string {
  const shown = ids.slice(0, 10).map((id) => `${prefix}${id}`).join(", ");
  return ids.length > 10 ? `${shown}, … and ${ids.length - 10} more` : shown;
}

/**
 * The report a maintainer and a CI job both read, one dataset per block, in a
 * fixed order so a diff between two runs is legible.
 */
export function formatReport(reports: readonly DatasetReport[]): string[] {
  const lines: string[] = [];
  for (const report of reports) {
    const prefix = ID_PREFIX[report.dataset];
    if (report.outcome === "unavailable") {
      lines.push(`${report.dataset}: UNAVAILABLE — ${report.message}`);
      continue;
    }
    const counts = `${report.bundled_count} bundled, ${report.live_count} live`;
    if (report.outcome === "clean") {
      lines.push(`${report.dataset}: clean — ${counts}`);
      continue;
    }
    lines.push(`${report.dataset}: DRIFTED — ${counts}`);
    if (report.added.length > 0) {
      lines.push(`  added ${report.added.length}: ${sample(report.added, prefix)}`);
    }
    if (report.removed.length > 0) {
      lines.push(`  REMOVED ${report.removed.length}: ${sample(report.removed, prefix)}`);
    }
    for (const { id, from, to } of report.renamed.slice(0, 10)) {
      lines.push(`  renamed: ${prefix}${id} ${from} → ${to}`);
    }
    if (report.renamed.length > 10) {
      lines.push(`  … and ${report.renamed.length - 10} more rename(s)`);
    }
    lines.push(`  rebuild: ${REBUILD_COMMANDS[report.dataset]}`);
  }
  return lines;
}
