import { describe, expect, it } from "vitest";
import { DRIFT_CHECK_FLAG, driftExitCode, parseArgv, USAGE } from "./cli.ts";

describe("the command line", () => {
  it("serves over stdio when given nothing, which is the whole point of the binary", () => {
    expect(parseArgv([])).toEqual({ mode: "serve" });
  });

  it("runs the drift check when explicitly asked, and only then", () => {
    expect(parseArgv([DRIFT_CHECK_FLAG])).toEqual({ mode: "check-drift" });
    expect(DRIFT_CHECK_FLAG).toBe("--check-drift");
  });

  it("refuses an argument it does not have rather than ignoring it", () => {
    // The same rule the filter surface follows: a silently-ignored typo lets an
    // operator believe they invoked something they did not (SPEC 8.4).
    expect(parseArgv(["--check-dirft"])).toEqual({
      mode: "refused",
      message: `unrecognised argument "--check-dirft"\n${USAGE}`,
    });
    expect(parseArgv([DRIFT_CHECK_FLAG, "--verbose"])).toMatchObject({ mode: "refused" });
  });

  it("refuses the flag twice, because a repeat means the caller meant something else", () => {
    expect(parseArgv([DRIFT_CHECK_FLAG, DRIFT_CHECK_FLAG])).toMatchObject({ mode: "refused" });
  });
});

describe("what the drift check exits with", () => {
  it("is 0 for a clean bundle", () => {
    expect(driftExitCode({ outcome: "clean", bundled_count: 159, live_count: 159 })).toBe(0);
  });

  it("is 1 for drift, so a maintainer's script can act on it", () => {
    expect(
      driftExitCode({
        outcome: "drifted",
        bundled_count: 159,
        live_count: 160,
        added: [999],
        removed: [],
      }),
    ).toBe(1);
  });

  it("is 2 when the check could not run, which is not the same as clean", () => {
    expect(driftExitCode({ outcome: "unavailable", reason: "block", message: "blocked" })).toBe(2);
  });
});
