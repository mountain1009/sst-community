# Providers in the app's package.json

**Status: not taken (2026-10-12).** It was tried on the local branch `v5-sharing-deps`, where this note has every step and what each found. It worked, but it moved onto every app what only a component package's repo needed. [v5-sharing-host.md](v5-sharing-host.md) is the plan instead, and says why. This copy is the proposal as it was written.

## The question

[Sharing components as packages](v5-sharing.md) works today with SST's platform and the providers kept in `.sst/platform`, where an app's own tools don't see them. Three things make up for that: the bundler points `sst/components` at the platform, `.sst/tsconfig.json` tells TypeScript where the platform and providers are, and a vitest alias does the same for tests. A component package also needs an `sst.config.ts` in its repo, only so `sst install` fetches SST and the providers to compile against.

Pulumi, the AWS CDK and CDKTF projects install the framework and the providers as ordinary npm dependencies. So did SST v2. This note looks at doing the same in v5: what the app looks like, what the CLI does differently, how an app moves over, and what it costs.

## How it works today

- **Versions** are in `sst.config.ts`: `providers: { aws: "7.48.0" }`. `sst add` edits that file.
- **`sst install`** works out each provider's package and version and writes them to `.sst/provider-lock.json`. It writes them into `.sst/platform/package.json`, with `@pulumi/pulumi` pinned to the CLI's Pulumi version, and runs `bun install` there (`npm` with `SST_NO_BUN`). Then it writes the types (`config.d.ts`, and `.sst/tsconfig.json` on this branch).
- **The platform** (SST's components, its functions and the bridge binaries) is embedded in the CLI binary and copied into `.sst/platform`. Nine of the platform's source files read from it at deploy, through `$cli.paths.platform`.
- **The config** is bundled into `.sst/platform/sst.config.<time>.mjs`. Providers are left out of the bundle, so Node resolves them from `.sst/platform/node_modules`. The generated `Pulumi.yaml` is `runtime: nodejs` with `main` set to the bundle.
- **The npm package `sst`** is the SDK (`sst`, `sst/resource`, ...) and a `bin` that hands off to the CLI binary for the platform. It has no components.
- **Apps not written in JavaScript** need no `package.json` at all. Node only runs `sst.config.ts`.

## The proposal

### What an app looks like

```json title="package.json"
{
  "devDependencies": {
    "sst": "npm:@sst-community/sst@5.0.0",
    "@pulumi/pulumi": "3.267.0",
    "@pulumi/aws": "7.48.0",
    "@pulumi/cloudflare": "6.15.0"
  }
}
```

```ts title="sst.config.ts"
export default $config({
  app() {
    return {
      name: "my-app",
      home: "aws",
      // Settings stay here. Versions come from package.json.
      providers: { aws: { region: "us-east-1" }, cloudflare: true },
    };
  },
  async run() {},
});
```

- `package.json` holds the versions, and the lockfile pins them. Dependabot, Renovate and `npm audit` see them.
- `sst.config.ts` keeps the provider settings, and which providers the app uses. A version written there is still read, as a check: the deploy says when it doesn't match what's installed.
- The globals (`aws`, `cloudflare`) are still made for each provider in the config, from the app's `node_modules`.

### What a component package looks like

```json title="package.json"
{
  "name": "@acme/secure-bucket",
  "peerDependencies": {
    "sst": "^5",
    "@pulumi/pulumi": "^3",
    "@pulumi/aws": "^7"
  },
  "devDependencies": {
    "sst": "npm:@sst-community/sst@5.0.0",
    "@pulumi/pulumi": "3.267.0",
    "@pulumi/aws": "7.48.0",
    "typescript": "^5",
    "vitest": "^3"
  }
}
```

That's the convention CDK construct libraries use. The package manager checks the peer ranges at install, so SST's own peer check isn't needed. The repo has no `sst.config.ts`, a plain `tsconfig.json`, and a plain vitest config. `import { mock } from "sst/testing"` resolves like any import.

### Two stages

The spike (summarised below) split it in two, and each stage stands on its own.

1. **Providers in the app's `node_modules`, the platform still in `.sst/platform`.** Files in `.sst/platform` already resolve up into the app's `node_modules` when a package isn't in their own, so the platform finds the app's providers with no mapping. This removes the provider entries from `.sst/tsconfig.json` and from the vitest alias.
2. **The platform ships in the npm package `sst`.** Then `sst/components` resolves like any import. This removes the bundler's mapping for it, `.sst/tsconfig.json`, and the vitest alias. The platform's files that components read at deploy (functions, the bridge binaries) either ship in the package too or are still copied into `.sst/platform`.

### What the CLI does differently

- **`sst install`** in an app with a `package.json` doesn't install providers. It checks that the app's `node_modules` has each provider the config names and exactly one `@pulumi/pulumi`, and says what to install when it doesn't. `.sst/provider-lock.json` is written from what's installed.
- **`sst add <provider>`** adds the package with the app's package manager, as a dev dependency, as well as adding it to the config.
- **`sst upgrade`** moves `sst` and `@pulumi/pulumi` to the versions the new CLI was built with. Providers stay where they are unless they fall outside the ranges `sst` declares.
- **The deploy** refuses to run when more than one `@pulumi/pulumi` resolves, and says how to pin one (`overrides`, `resolutions` or `pnpm.overrides`).
- **`Pulumi.yaml`** gets `options: { typescript: false }`. Pulumi's Node runtime looks for TypeScript next to `@pulumi/pulumi`. Once that's in the app, it falls back to an old copy that can't read the platform's `tsconfig.json`. SST already runs compiled JavaScript, so it doesn't need it.

### Apps without a package.json

Two choices:

- **Keep `.sst/platform` for them.** The code has one idea of where an app's dependencies are: the app's own `node_modules` when its `package.json` has `sst`, otherwise `.sst/platform`. It's two modes to test.
- **Require a `package.json` beside `sst.config.ts`.** `sst init` writes one. Node is already required. It's a breaking change for those apps, in a major version.

The first is the safer start. The second can follow if the two modes cost too much.

### Moving an existing app over

- The first `sst install` or `sst upgrade` with the new CLI adds the providers to `package.json` at the versions in `.sst/provider-lock.json`, so no version moves.
- State files don't change. The same provider versions mean the same provider resources, so `sst diff` should show nothing. That has to be shown on a deployed stack before this is built.
- `.sst/platform/node_modules` no longer holds the providers.

## What the spike found

It tried stage 1 on npm 11, pnpm 9, bun 1.4, yarn 1 and yarn 4, in a single app and in a monorepo, with Pulumi 3.215 and the providers from before `main`'s provider update. It ran the bundle under the mock, and a real `pulumi up` and `destroy` of two small resources with local state.

- **npm, pnpm and bun:** one copy of `@pulumi/pulumi` and of each provider, everywhere. Every run passed.
- **Yarn 1 and 4:** each provider's own `@pulumi/pulumi` range resolved to a newer version than the app's, so there were up to eight copies, and the mock run failed. A `resolutions` entry pinning `@pulumi/pulumi` fixed every case. A peer dependency in the component package didn't help, because the copies come from the providers.
- **Yarn Plug'n'Play:** not tried. It would need `nodeLinker: node-modules`, since with no `node_modules` the platform has nothing to resolve up into.
- **Every run needed `typescript: false`** in `Pulumi.yaml`, for the reason above.
- **Pulumi still downloaded the provider plugins** for the versions installed in the app.
- **The app needed every provider the platform loads**, not only the ones it uses: aws, cloudflare, command, docker-build, random, tls and vercel. `components/index` loads cloudflare and vercel when it's imported. Any left in `.sst/platform/node_modules` would be a second copy.

## Costs

- **Merging from SST.** `sst install`, `sst add`, `sst upgrade`, the provider lock, the run and the templates are SST's code, and SST changes them. Every merge would conflict there, in code unrelated to components.
- **The platform's own providers in every app.** An AWS-only app lists cloudflare, vercel, command, docker-build, random and tls, unless the platform is changed to load providers only when they're used, or `sst` takes the ones it uses internally as its own dependencies.
- **Duplicates of `@pulumi/pulumi` are possible** with yarn and in monorepos with different versions. The deploy guard catches them. It can't prevent them.
- **Size.** `@pulumi/aws` is large. As a dev dependency it stays out of production installs and function bundles, but CI and Docker builds that install dev dependencies get bigger.
- **Two modes**, while apps without a `package.json` keep `.sst/platform`.

## What happens to v5-sharing's work

Kept:

- the named `ComponentClass` type, and the platform's compiled types;
- `sst/components` as the name a package imports;
- the globals reaching `.mjs` files, and not clashing with a package's own imports;
- the hint to run `sst add` when a provider isn't defined;
- `sst upgrade` and `sst init` staying in the CLI's major version.

No longer needed after stage 2:

- `.sst/tsconfig.json` and the docs about extending it;
- the bundler's mapping for `sst/components`;
- the deploy's peer dependency check;
- the vitest alias;
- probably the stubs for provider imports in the first evaluation of the config, since the providers are installed before it runs.

## To show before building it

- An app deployed with today's design moves over, and `sst diff` shows nothing.
- A monorepo with two apps on different provider versions.
- `sst dev`, including a function inside a package's component.
- Windows.
- An app without a `package.json`, on the fallback.

## Open questions

1. **How long does `v5` keep merging SST's releases?** The answer decides whether the merge cost is acceptable.
2. **Is a `package.json` required, or is `.sst/platform` kept for apps without one?**
3. **Which providers does `sst` itself depend on?** Peers the app installs, its own dependencies, or loaded only when used.
4. **Does the version stay allowed in `sst.config.ts`?** As a check, as proposed, or not at all.
