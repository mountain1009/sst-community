import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// A component published in a package is compiled to JavaScript and a .d.ts.
// The .d.ts is read by the app that installs the package, so it can only name
// what every app has: `sst/components` and the providers, or the globals.
describe("a component in a package", () => {
  const platform = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const dir = path.join(platform, "test", "components", "published");

  // Compiles index.ts to a .d.ts, with the other files in the program
  function compile(
    files: Record<string, string>,
    paths?: Record<string, string[]>,
  ) {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      declaration: true,
      emitDeclarationOnly: true,
      types: [],
      paths,
    };
    const all = Object.fromEntries(
      Object.entries(files).map(([name, text]) => [path.join(dir, name), text]),
    );
    const host = ts.createCompilerHost(options);
    const { fileExists, readFile, getSourceFile } = host;
    host.fileExists = (file) => file in all || fileExists(file);
    host.readFile = (file) => all[file] ?? readFile(file);
    host.getSourceFile = (file, version, ...rest) =>
      file in all
        ? ts.createSourceFile(file, all[file], version)
        : getSourceFile(file, version, ...rest);
    let declaration = "";
    host.writeFile = (_, text) => (declaration = text);

    const program = ts.createProgram(Object.keys(all), options, host);
    const source = program.getSourceFile(path.join(dir, "index.ts"));
    const result = program.emit(source);
    const errors = [
      ...ts.getPreEmitDiagnostics(program, source),
      ...result.diagnostics,
    ].map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    return { errors, declaration };
  }

  it("can import sst/components and its providers, as it's written", () => {
    const { errors, declaration } = compile(
      {
        "index.ts": `
          import { component, many, type ComponentArgs, type LinkDefinition } from "sst/components";
          import type { ComponentResourceOptions } from "@pulumi/pulumi";
          import * as aws from "@pulumi/aws";

          const parts = {
            bucket: aws.s3.Bucket,
            reader: many(aws.iam.Role),
          };

          export interface UploadsArgs extends ComponentArgs<typeof parts> {
            teams: string[];
          }

          export class Uploads extends component("acme:Uploads", parts) {
            constructor(name: string, args: UploadsArgs, opts?: ComponentResourceOptions) {
              super(name, args, opts);
              this.part("bucket", {});
            }

            link(): LinkDefinition {
              return { properties: { name: this.nodes.bucket.bucket } };
            }
          }
        `,
      },
      // What .sst/tsconfig.json maps it to in an app
      {
        "sst/components": [path.join(platform, "src/components/index.ts")],
      },
    );

    expect(errors).toEqual([]);
    expect(declaration).toContain('import("sst/components").ComponentClass<{');
    expect(declaration).toContain(
      'bucket: typeof import("@pulumi/aws/s3/bucket").Bucket;',
    );
    // Nothing named by where it's installed
    expect(declaration).not.toMatch(/import\("\.|node_modules/);
  }, 120_000);

  it("can use the globals, with its parts typed", () => {
    const { errors, declaration } = compile({
      // What `sst install` writes to `.sst/platform/config.d.ts` for an app
      // with the AWS provider
      "config.d.ts": `
        import "../../../src/global.d.ts";
        import * as _aws from "@pulumi/aws";
        declare global {
          // @ts-expect-error
          export import aws = _aws;
        }
      `,
      "index.ts": `
        const parts: {
          bucket: typeof aws.s3.Bucket;
          reader: sst.ManyPart<typeof aws.iam.Role>;
        } = {
          bucket: aws.s3.Bucket,
          reader: sst.many(aws.iam.Role),
        };

        export interface UploadsArgs extends sst.ComponentArgs<typeof parts> {
          teams: string[];
        }

        export class Uploads extends sst.component("acme:Uploads", parts) {
          constructor(
            name: string,
            args: UploadsArgs,
            opts?: $util.ComponentResourceOptions,
          ) {
            super(name, args, opts);
            this.part("bucket", {});
          }

          link(): sst.LinkDefinition {
            return { properties: { name: this.nodes.bucket.bucket } };
          }
        }
      `,
    });

    expect(errors).toEqual([]);
    expect(declaration).toContain("sst.ComponentClass<{");
    expect(declaration).toContain("bucket: typeof aws.s3.Bucket;");
    expect(declaration).not.toContain("import(");
  }, 120_000);
});
