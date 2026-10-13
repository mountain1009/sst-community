import { fileURLToPath } from "url";

const platform = fileURLToPath(new URL("../../", import.meta.url));

/**
 * What a vitest config needs to test a component the way an app loads it.
 * `sst/components`, its groups like `sst/components/aws`, `sst/testing` and
 * the providers come from the app's platform, in `.sst/platform`, so a test
 * and a deploy use the same ones.
 *
 * @example
 * ```ts title="vitest.config.ts"
 * import { defineConfig } from "vitest/config";
 * import { alias } from "./.sst/platform/src/testing/vitest";
 *
 * export default defineConfig({ resolve: { alias } });
 * ```
 */
export const alias = [
  // What SST's components share, and the components of each provider. The
  // groups are named here rather than read from groups.ts, which would bring
  // every component into the vitest config's bundle. A test checks they agree.
  {
    find: /^sst\/components$/,
    replacement: `${platform}src/components/core.ts`,
  },
  {
    find: /^sst\/components\/(aws|cloudflare|vercel)$/,
    replacement: `${platform}src/components/$1/index.ts`,
  },
  { find: /^sst\/testing$/, replacement: `${platform}src/testing/index.ts` },
  {
    find: /^(@pulumi|@pulumiverse|@sst-provider)\/(.*)$/,
    replacement: `${platform}node_modules/$1/$2`,
  },
];
