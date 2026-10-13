# Sharing components as packages

Branch `v5-sharing`, from `v5`. Reviewed and built 2026-10-06. Nothing is committed yet.

## Goal

Someone writes a component with `component()`, publishes it to npm, and any app on 5.x installs it and uses it like a built-in one: typed args, `transform`, `existing`, `nodes`, linking and `$transform`. The package is written like any other TypeScript package. It imports what it uses, and it builds and tests with ordinary tools.

## Where it started

Inside an app, components work. Through npm they only worked by accident:

- A package used the `sst` and provider globals. The CLI adds their imports to the top of every file it bundles, `node_modules` included. Nothing says a package can rely on that. It failed for `.mjs` files, and for a package that imports `@pulumi/aws` as `aws`.
- `sst` couldn't be imported. The `sst` npm package is the runtime SDK.
- A package couldn't be compiled to a `.d.ts`. `component()` returned an unnamed class with private members, and a provider's class could only be named by where it's installed.
- The app has to add every provider a package uses, and a missing one was a bare `ReferenceError`.
- Nothing said which SST a package needs, and 5.x has no release path.

## How it works now

A package imports what it uses:

```ts
import { component, type ComponentArgs } from "sst/components";
import * as aws from "@pulumi/aws";
```

In an app, both resolve to the app's own copies in `.sst/platform`, at deploy time and when type-checking. So there's one framework and one copy of each provider, and they're the ones the globals are. Apps keep the globals. The package's own repo installs `sst`, Pulumi and the providers as dev dependencies, and builds and tests against them with ordinary tools, with no `sst.config.ts` (since [v5-sharing-host.md](v5-sharing-host.md), step 6).

| Piece | Where |
| --- | --- |
| `sst/components` resolves to what SST's components share, and `sst/components/aws`, `/cloudflare` and `/vercel` to the components of each provider: the files the `sst` global is made of, resolved as any import is, symlinks included | `pkg/js/js.go` (`PlatformModules`), `pkg/project/run.go` |
| Reading `app()` doesn't load the platform's or the providers' modules that `run()` code imports. That build runs before they're installed, and esbuild moves external imports to the top of the bundle. | `pkg/js/js.go` (`NotLoaded`) |
| Globals are imported under private names and pointed at with `define`, so a file can import a provider as `aws` itself. `.mjs`/`.mts` files get them. `.cjs`/`.cts` files are left as they are. | `pkg/js/js.go` |
| The platform ships its types as `.d.ts` (`dist/types`, with declaration maps), and `config.d.ts` reads them. A CLI built without them falls back to the source. | `platform/tsconfig.types.json`, `platform/scripts/build`, `pkg/project/install.go`, `pkg/project/tsconfig.go` |
| `sst install` writes `.sst/tsconfig.json`, with `paths` for `sst/components` and its groups, `sst/testing` and every installed provider. An app extends it. | `pkg/project/tsconfig.go` |
| The `sst` package has SST's components compiled to JavaScript, with their types and `sst/testing`, for a package's repo. An app's deploy doesn't use them. | `sdk/js/scripts/platform.ts`, `sdk/js/package.json` |
| `component()` returns a named type, `ComponentClass`. The part types are exported (`ManyPart`, `OptionalPart`, `NamedPart`, `DeferredPart`). `partHandle` has a type annotation so the platform compiles to `.d.ts`. | `platform/src/components/parts-component.ts`, `core.ts` |
| A deploy checks each package that imports `sst/components` or one of its groups: its `peerDependencies` on `sst` against the CLI, and on providers against the app's. | `pkg/project/packages.go` |
| "X is not defined" says how to add a provider, for code that uses the globals | `platform/src/auto/run.ts` |
| `alias` for an app's vitest config, when its tests load a package. `mock()` gives the `sst` global the groups whose providers are installed, and says what to install when a test uses another. | `platform/src/testing/vitest.ts`, `platform/src/testing/global.ts` |
| `sst upgrade` and `sst init` pick the newest version in the CLI's own major version, with prereleases only from a prerelease. For 4.x that is what `latest` is today. A dev build keeps using `latest`. | `pkg/npm/versions.go`, `pkg/global/upgrade.go`, `pkg/project/create.go` |
| Docs: "Share it" in the component guide, and two rules in the rulebook | `www/.../write-a-component.mdx`, `platform/src/components/README.md` |

## How it was checked

- **Go tests:**
  - `TestBuildGlobals`, `TestBuildPlatformModules` (one copy of the framework, through a symlinked path) and `TestBuildReadingApp` (`app()` read with no platform or providers installed), in `pkg/js`.
  - `TestCheckPackages` (against a real esbuild metafile) and `TestWriteTsconfig`, in `pkg/project`.
  - `TestNewestInMajor` and `TestNewest`, in `pkg/npm`.
  - All Go tests pass.
- **Platform tests:**
  - `declarations.test.ts` compiles a package to a `.d.ts` both ways: importing `sst/components`, and using the globals with typed parts.
  - `test/auto/run.test.ts` covers the hint.
  - 1,492 tests pass. The three files that already fail to load on `main` still do.
- **A real app's config, bundled by the old and the new bundler:** identical resources under the mock for four configs (124 to 276 resources, v4 and v5 components), and an identical `app()` result.
- **That app type-checked against the compiled types and against the source:** the same result. Deliberate mistakes in ten places give the same ten errors. The type check is faster with the compiled types (1.9 s against 3.1 s).
- **The whole flow, built with `sst5`:**
  - `sst5 install` in a package repo.
  - `tsc` emits only the package's own files.
  - The package's vitest test passes with the `alias` helper.
  - An app that extends `.sst/tsconfig.json` type-checks the installed package and gets exactly the two intended errors.
  - The app is bundled as `Run` does it, and the package check passes.
  - Under the mock, a global `aws` resource is used through the package's `existing`, the `transform` applies, and linking it to a function works.
  - The same app without Cloudflare stops with `"@acme/email" needs the cloudflare provider. Add it with "sst add cloudflare".`
- **The docs site builds.**

## Not done yet

1. **A release path for 5.x.** These files live on `main`, whose release files are newer than `v5`'s:
   - The tag pattern in `release.yml` doesn't match `v5.0.0-alpha.1`.
   - `sdk/js/scripts/release.ts` publishes every version as npm `latest`.
   - goreleaser makes every GitHub release the latest one, which is what the `install` script downloads.
   - `MAINTAINING.md` says not to tag 5.x.

   The CLI side (`sst upgrade`, `sst init`) is done here.
2. **A deploy to AWS** of an app that uses a package, and `sst dev` with a function inside a package's component. Everything above ran under the mock.
3. **Other package managers and Windows.** The check finds a package under pnpm's `.pnpm` layout by its last `node_modules/`. Neither has been run.
4. **`sst/components` reviewed as a public API.** Its `.d.ts` also shows members marked `@internal`.
5. **A template package**, to copy as a starting point.

## Breaking changes (for the 5.0 release notes)

- An app file that re-exports a global by name (`export { aws }`) no longer builds or runs. `export const x = aws` and `export default aws` still work.
- When `app()` is read, a file it imports that uses a provider's module while it loads now gets a stub that throws. Providers aren't installed at that point, so such code couldn't rely on them before either.

## Known limits

- **`paths` in an app's own `tsconfig.json` replace the ones it extends.** The docs say to copy the entries from `.sst/tsconfig.json`. They change when a provider is added.
- **The Next.js preset excludes `sst.config.ts` from `tsconfig.json`.** The editor then checks the config outside it, and a compiled package's types aren't resolved there. A `tsconfig` for the infrastructure that extends `.sst/tsconfig.json` covers `tsc`, but not every editor.
- **A package that uses the globals instead of imports still works**, as TypeScript source with no setup in the app. Nothing in it says what it depends on, and a deploy doesn't check it.

## Open questions

1. **The 5.x channel.** Prereleases on npm `next`, never the GitHub latest release, until 5.0.0? Or keep the whole major off `latest`?
2. **Providers a package needs.** A deploy fails and says to run `sst add`. Should it add them to the app's providers itself instead?
3. **The import name.** `sst/components` reads well. It sits beside the SDK's `sst/*` exports, which have no `components`.
