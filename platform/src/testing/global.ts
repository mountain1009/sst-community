import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { groups } from "../components/groups";

/**
 * The `sst` global a test is given: what SST's components share, and the
 * components of each provider whose packages are installed. A config's `sst`
 * has every group, and a deploy's bundle keeps the ones the app uses. A test
 * loads what it's given without a bundler, so a group the app hasn't
 * installed is left out, and says what to install when a test uses it.
 */
export async function sstGlobal(providers = groupProviders()) {
  const sst: Record<string, unknown> = {
    ...(await import("../components/core")),
  };
  for (const [name, load] of Object.entries(groups)) {
    const missing = notInstalled(providers[name] ?? []);
    if (missing.length === 0) {
      sst[name] = await load();
      continue;
    }
    Object.defineProperty(sst, name, {
      enumerable: true,
      get() {
        const install =
          missing.length === 1
            ? "it as a dev dependency"
            : "them as dev dependencies";
        throw new Error(
          `sst.${name} needs ${list(
            missing,
          )}, which the app hasn't installed. To test what uses it, install ${install}.`,
        );
      },
    });
  }
  return sst;
}

function list(names: string[]) {
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The providers each group's components load, where the platform's
 * package.json lists them: the one nearest this file, from its source or from
 * the JavaScript the `sst` package has. Empty where they're all installed
 * with the platform, as in an app's `.sst/platform` and the platform's own
 * tests.
 */
function groupProviders(): Record<string, string[]> {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const file = path.join(dir, "package.json");
    if (fs.existsSync(file))
      return JSON.parse(fs.readFileSync(file, "utf8")).groups ?? {};
    const parent = path.dirname(dir);
    if (parent === dir) return {};
    dir = parent;
  }
}

/** Those of `names` that SST's components can't load */
export function notInstalled(names: string[]) {
  const require = createRequire(import.meta.url);
  const found = (path: string) => {
    try {
      require.resolve(path);
      return true;
    } catch {
      return false;
    }
  };
  // A package's `exports` can hide either one from `require`
  return names.filter((name) => !found(`${name}/package.json`) && !found(name));
}
