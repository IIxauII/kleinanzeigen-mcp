import { describe, expect, it } from "vitest";
import { DRIFT_CHECK_FLAG, parseArgv, USAGE } from "./cli.ts";

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

  it("refuses the flag twice, and says a repeat is what it refused", () => {
    // Never "unrecognised": that argument is recognised, and telling an
    // operator otherwise about the argument in front of them is the failure
    // this refusal exists to prevent.
    expect(parseArgv([DRIFT_CHECK_FLAG, DRIFT_CHECK_FLAG])).toEqual({
      mode: "refused",
      message: `${DRIFT_CHECK_FLAG} given more than once\n${USAGE}`,
    });
  });

  it("lines its usage descriptions up under one another", () => {
    // The indent, an optional label, and the gap after it — so a label line and
    // a continuation line both measure to where their description starts.
    const descriptionColumn = /^ {2}(?:\S+(?: \S+)*)? +(?=\S)/u;
    const indented = USAGE.split("\n").filter((line) => line.startsWith("  "));
    expect(indented).toHaveLength(3);
    const columns = indented.map((line) => descriptionColumn.exec(line)![0].length);
    expect(new Set(columns)).toEqual(new Set([19]));
  });
});
