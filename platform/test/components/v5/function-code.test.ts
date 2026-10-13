import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  ownFile,
  zipCode,
} from "../../../src/components/aws/helpers/function-code";

// The names in a zip, from its central directory
function entries(file: string) {
  const data = fs.readFileSync(file);
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = data.readUInt16LE(offset + 28);
    const extra = data.readUInt16LE(offset + 30);
    const comment = data.readUInt16LE(offset + 32);
    names.push(data.toString("utf8", offset + 46, offset + 46 + name));
    offset += 46 + name + extra + comment;
  }
  return names.sort();
}

// A bundle two functions share, after the CLI wrote each one's resources
function sharedBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sst-bundle-"));
  for (const file of [
    "index.mjs",
    "lib/util.mjs",
    "resource.enc",
    ".sst/Api/resource.enc",
    ".sst/Worker/resource.enc",
    ".sst/Apis/resource.enc",
  ]) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), file);
  }
  return dir;
}

describe("zipCode", () => {
  it("keeps only a function's own resources from a shared bundle", async () => {
    const bundle = sharedBundle();
    const { path: zip } = await zipCode({
      to: path.join(bundle, "..", "api.zip"),
      bundle,
      sharedBundle: "Api",
    });
    expect(entries(zip).filter((name) => !name.endsWith("/"))).toEqual([
      ".sst/Api/resource.enc",
      "index.mjs",
      "lib/util.mjs",
    ]);
  });

  it("keeps a bundle as it is when it isn't shared", async () => {
    const bundle = sharedBundle();
    const { path: zip } = await zipCode({
      to: path.join(bundle, "..", "all.zip"),
      bundle,
    });
    expect(entries(zip).filter((name) => !name.endsWith("/"))).toEqual([
      ".sst/Api/resource.enc",
      ".sst/Apis/resource.enc",
      ".sst/Worker/resource.enc",
      "index.mjs",
      "lib/util.mjs",
      "resource.enc",
    ]);
  });

  it("tells a function's own folder from one whose name starts the same", () => {
    expect(ownFile(".sst/Api", "Api")).toBe(true);
    expect(ownFile(".sst/Apis", "Api")).toBe(false);
    expect(ownFile(".sst/Apis/resource.enc", "Api")).toBe(false);
  });
});
