import { describe, expect, it } from "vitest";
import { notInstalled, sstGlobal } from "../../src/testing/global";

// A provider the app hasn't installed
const missing = "@sst-test/not-installed";

describe("sstGlobal()", () => {
  it("has the core and every group whose providers are installed", async () => {
    const sst: any = await sstGlobal({ aws: ["@pulumi/aws"] });
    expect(typeof sst.component).toBe("function");
    expect(typeof sst.Linkable).toBe("function");
    expect(typeof sst.aws.v5.Function).toBe("function");
    expect(typeof sst.cloudflare.Worker).toBe("function");
  });

  it("says what to install for a group whose providers aren't", async () => {
    const sst: any = await sstGlobal({
      cloudflare: ["@pulumi/cloudflare", missing],
      vercel: [missing, "@sst-test/also-not-installed"],
    });
    expect(typeof sst.aws.Bucket).toBe("function");
    expect(() => sst.cloudflare.Worker).toThrow(
      "sst.cloudflare needs @sst-test/not-installed, which the app hasn't installed. To test what uses it, install it as a dev dependency.",
    );
    expect(() => sst.vercel).toThrow(
      "sst.vercel needs @sst-test/not-installed and @sst-test/also-not-installed, which the app hasn't installed. To test what uses it, install them as dev dependencies.",
    );
    expect(Object.keys(sst)).toContain("vercel");
  });
});

describe("notInstalled()", () => {
  it("finds the ones that can't be loaded", () => {
    expect(notInstalled(["@pulumi/aws", "@pulumi/pulumi", missing])).toEqual([
      missing,
    ]);
  });
});
