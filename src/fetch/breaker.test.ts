import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCK_COOLDOWN_MS, BLOCK_MARKER, createBreaker, isBlockPage } from "./breaker.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("block detection", () => {
  it("matches the literal string the site serves", () => {
    expect(BLOCK_MARKER).toBe("IP-Bereich vorübergehend gesperrt");
    expect(isBlockPage('{"title": "IP-Bereich vorübergehend gesperrt."}')).toBe(true);
    expect(isBlockPage("<h1>IP-Bereich vorübergehend gesperrt</h1>")).toBe(true);
  });

  it("does not read an ordinary page as a block", () => {
    expect(isBlockPage("<html><li class='ad-listitem'></li></html>")).toBe(false);
  });

  it("does not read an empty result page as a block either — that is §5.4's other half", () => {
    expect(isBlockPage("<html>Es wurden keine Ergebnisse gefunden</html>")).toBe(false);
  });
});

describe("the circuit breaker", () => {
  it("is closed until a block trips it", () => {
    const breaker = createBreaker();
    expect(breaker.blockedFor()).toBeNull();
  });

  it("refuses every request for the cooldown once tripped", () => {
    const breaker = createBreaker();
    breaker.trip();
    expect(breaker.blockedFor()).toBe(BLOCK_COOLDOWN_MS);
    vi.advanceTimersByTime(BLOCK_COOLDOWN_MS - 1);
    expect(breaker.blockedFor()).toBe(1);
  });

  it("closes again when the cooldown has run out", () => {
    const breaker = createBreaker();
    breaker.trip();
    vi.advanceTimersByTime(BLOCK_COOLDOWN_MS);
    expect(breaker.blockedFor()).toBeNull();
  });

  it("restarts the cooldown on a second block", () => {
    const breaker = createBreaker();
    breaker.trip();
    vi.advanceTimersByTime(BLOCK_COOLDOWN_MS - 1000);
    breaker.trip();
    expect(breaker.blockedFor()).toBe(BLOCK_COOLDOWN_MS);
  });

  it("holds the cooldown fixed in code: 15 minutes, not a knob", () => {
    expect(BLOCK_COOLDOWN_MS).toBe(15 * 60_000);
  });
});
