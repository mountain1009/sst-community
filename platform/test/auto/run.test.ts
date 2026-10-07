import { describe, expect, it } from "vitest";
import { explainUndefined } from "../../src/auto/run";

describe("a name that isn't defined", () => {
  it("says how to add it when it's a provider", () => {
    const error = new ReferenceError("cloudflare is not defined");
    expect(() => explainUndefined(error)).toThrow(
      'cloudflare is not defined. If "cloudflare" is a provider, add it to your app with "sst add cloudflare".',
    );
    expect(error.stack).toContain(
      'add it to your app with "sst add cloudflare"',
    );
  });

  it("leaves any other error as it is", () => {
    const error = new TypeError("x is not a function");
    expect(() => explainUndefined(error)).toThrow(/^x is not a function$/);
  });
});
