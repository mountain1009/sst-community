// The globals that are aliases of modules, `sst` and `$util`, which an app's
// config.d.ts has with global.d.ts. They're on their own so that the
// platform's declarations are built without them: then the declarations name
// SST's and Pulumi's types through their modules, as `sst/components` does,
// and a component package reads them without an app's config.d.ts. The docs
// put them back in global.d.ts (www/generate.ts).
import * as util from "@pulumi/pulumi";
import * as _sst from "./components/index";

declare global {
  // @ts-expect-error
  export import sst = _sst;

  /**
   * A convenience reference to the [`util`](https://www.pulumi.com/docs/reference/pkg/nodejs/pulumi/pulumi/) module from Pulumi.
   *
   * This is useful for working with components. You can use these without importing or installing the Pulumi SDK.
   *
   * @example
   *
   * For example, to create a new asset, you can:
   *
   * ```ts title="sst.config.ts"
   * const myFiles = new $util.asset.FileArchive("./path/to/files");
   * ```
   *
   * This is equivalent to doing:
   *
   * ```ts title="sst.config.ts"
   * import * as pulumi from "@pulumi/pulumi";
   *
   * const myFiles = new pulumi.asset.FileArchive("./path/to/files");
   * ```
   */
  // @ts-expect-error
  export import $util = util;
}
