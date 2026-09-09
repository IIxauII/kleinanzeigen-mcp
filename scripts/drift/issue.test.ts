import { describe, expect, it } from "vitest";
import { TRACKING_ISSUE_MARKER, TRACKING_ISSUE_TITLE, trackingIssue } from "./issue.ts";
import type { DatasetReport } from "./report.ts";

const clean = (dataset: "categories" | "locations"): DatasetReport => ({
  dataset,
  outcome: "clean",
  bundled_count: 159,
  live_count: 159,
});

const unavailable = (dataset: "categories" | "locations"): DatasetReport => ({
  dataset,
  outcome: "unavailable",
  message: "GET https://www.kleinanzeigen.de/sitemap_cities.xml answered 503",
});

const drifted: DatasetReport = {
  dataset: "categories",
  outcome: "drifted",
  bundled_count: 159,
  live_count: 160,
  added: [301, 302],
  removed: [286],
  renamed: [{ id: 216, from: "Autos", to: "Auto" }],
};

describe("what the cron does with a run's report", () => {
  it("opens nothing when both datasets match the site", () => {
    expect(trackingIssue([clean("categories"), clean("locations")])).toBeNull();
  });

  it("opens nothing when a dataset never reached the site", () => {
    // `2` logs only. A check that never reached the site has learnt nothing,
    // and an issue would claim otherwise (SPEC 7, `docs/maintenance.md`).
    expect(trackingIssue([clean("categories"), unavailable("locations")])).toBeNull();
  });

  it("opens on real drift even when the other dataset's outage pushed the exit to 2", () => {
    // The whole reason issue-opening reads the report rather than the process
    // exit: real drift is never swallowed by the other half's failure.
    const issue = trackingIssue([drifted, unavailable("locations")]);
    expect(issue).not.toBeNull();
    expect(issue?.body).toContain("locations: UNAVAILABLE");
  });

  it("says so when half the picture is missing, so nobody reads the issue as the whole answer", () => {
    const issue = trackingIssue([drifted, unavailable("locations")]);
    expect(issue?.body).toContain("not all the drift there is");
  });

  it("names the added and the removed ids, and the renames", () => {
    const body = trackingIssue([drifted, clean("locations")])?.body ?? "";
    expect(body).toContain("c301");
    expect(body).toContain("c302");
    expect(body).toContain("c286");
    expect(body).toContain("c216 Autos → Auto");
  });

  it("carries the rebuild commands for the datasets that drifted, and no others", () => {
    const body = trackingIssue([drifted, clean("locations")])?.body ?? "";
    expect(body).toContain("npm run generate:category-tree");
    expect(body).not.toContain("npm run generate:cities");
    // Confirming afterwards is part of the procedure, not an optional extra.
    expect(body).toContain("npm run check:drift");
  });

  it("carries a stable marker and a stable title, which is how the cron finds the one issue", () => {
    // Drift that persists across months is one condition, not N: the cron
    // updates this issue rather than opening a second one.
    const issue = trackingIssue([drifted, clean("locations")]);
    expect(issue?.title).toBe(TRACKING_ISSUE_TITLE);
    expect(issue?.body).toContain(TRACKING_ISSUE_MARKER);
  });

  it("links the run that found the drift when it was given one", () => {
    const runUrl = "https://github.com/IIxauII/kleinanzeigen-mcp/actions/runs/1";
    expect(trackingIssue([drifted], runUrl)?.body).toContain(runUrl);
  });
});
