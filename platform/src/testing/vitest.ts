import { fileURLToPath } from "url";

const platform = fileURLToPath(new URL("../../", import.meta.url));

/**
 * What a vitest config needs to test a component the way an app loads it.
 * `sst/components`, `sst/testing` and the providers come from the app's
 * platform, in `.sst/platform`, so a test and a deploy use the same ones.
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
  {
    find: /^sst\/components$/,
    replacement: `${platform}src/components/index.ts`,
  },
  { find: /^sst\/testing$/, replacement: `${platform}src/testing/index.ts` },
  {
    find: /^(@pulumi|@pulumiverse|@sst-provider)\/(.*)$/,
    replacement: `${platform}node_modules/$1/$2`,
  },
];
