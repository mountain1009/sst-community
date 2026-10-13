import {
  all,
  ComponentResourceOptions,
  interpolate,
  jsonStringify,
  Output,
  output,
} from "@pulumi/pulumi";
import { RandomPassword } from "@pulumi/random";
import { elasticache, secretsmanager } from "@pulumi/aws";
import { V5Args, component, optional } from "../../parts-component";
import { ifSet, plain, withDefault } from "../../args";
import { Input } from "../../input";
import { VisibleError } from "../../error";
import { toGBs } from "../../size";
import { DevCommand } from "../../experimental/dev-command";
import { type TakesVpc, isVpc } from "../helpers/vpc";
import type { RedisArgs as OriginalRedisArgs } from "../redis";

const parts = {
  /**
   * The random password clients authenticate with. A serverless cache with
   * `password: false` has none.
   */
  authToken: optional(RandomPassword),
  /**
   * The Secrets Manager secret that stores the auth token of a cluster.
   */
  secret: optional(secretsmanager.Secret),
  /**
   * The version of the secret holding the current auth token.
   */
  secretVersion: optional(secretsmanager.SecretVersion),
  /**
   * The ElastiCache subnet group of a cluster.
   */
  subnetGroup: optional(elasticache.SubnetGroup),
  /**
   * The ElastiCache parameter group of a cluster.
   */
  parameterGroup: optional(elasticache.ParameterGroup),
  /**
   * The ElastiCache replication group. There's none when `serverless` is set.
   */
  cluster: optional(elasticache.ReplicationGroup),
  /**
   * The ElastiCache serverless cache, when `serverless` is set.
   */
  serverlessCache: optional(elasticache.ServerlessCache),
  /**
   * The `default` user of a serverless cache, which has the password.
   */
  user: optional(elasticache.User),
  /**
   * The user group a serverless cache takes its passwords from.
   */
  userGroup: optional(elasticache.UserGroup),
};

export interface RedisArgs
  extends V5Args<TakesVpc<OriginalRedisArgs>, typeof parts> {}

/** What the rest of the app reads from the cluster, deployed or local. */
interface Connection {
  clusterId: Output<string>;
  host: Output<string>;
  port: Output<number>;
  username: Output<string>;
  /** A serverless cache with `password: false` has none. */
  password?: Output<string>;
}

/**
 * The `Redis` component lets you add a Redis cluster to your app using
 * [Amazon ElastiCache](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/WhatIs.html).
 *
 * It takes the same args as [`sst.aws.Redis`](/docs/component/aws/redis) and creates the same
 * resources. It's built from parts, so every resource it creates can be transformed, is
 * available in `nodes`, and can be swapped for one you already have.
 *
 * @example
 *
 * #### Create the cluster
 *
 * ```ts title="sst.config.ts"
 * const vpc = new sst.aws.Vpc("MyVpc");
 * const redis = new sst.aws.v5.Redis("MyRedis", { vpc });
 * ```
 *
 * #### Create a serverless Redis
 *
 * A serverless cache scales with how much it's used. It connects with the same
 * `username` and `password` as a cluster.
 *
 * ```ts title="sst.config.ts"
 * const redis = new sst.aws.v5.Redis("MyRedis", {
 *   vpc,
 *   serverless: {
 *     storage: { maximum: "100 GB" },
 *     ecpuPerSecond: { maximum: 50000 }
 *   }
 * });
 * ```
 *
 * #### Switch from `sst.aws.Redis`
 *
 * Change `sst.aws.Redis` to `sst.aws.v5.Redis` and keep the name. The cluster or
 * serverless cache you've deployed is kept.
 *
 * ```ts title="sst.config.ts" del={1} ins={2}
 * const redis = new sst.aws.Redis("MyRedis", { vpc });
 * const redis = new sst.aws.v5.Redis("MyRedis", { vpc });
 * ```
 *
 * A few things work differently:
 *
 * - If you set `tags` on the cluster with an object in `transform`, it keeps the tags SST
 *   sets next to yours. They're added back when you switch.
 *
 * #### Link to a resource
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [redis],
 *   vpc
 * });
 * ```
 *
 * #### Running locally
 *
 * By default, your Redis cluster is deployed in `sst dev`. If you set the `dev` prop, a
 * Redis server on your machine is used there, and nothing is deployed.
 *
 * ```ts title="sst.config.ts" {3-6}
 * const redis = new sst.aws.v5.Redis("MyRedis", {
 *   vpc,
 *   dev: {
 *     host: "localhost",
 *     port: 6379
 *   }
 * });
 * ```
 */
export class Redis extends component("sst:aws:Redis", parts) {
  private connection: Connection;

  constructor(name: string, args: RedisArgs, opts?: ComponentResourceOptions) {
    super(name, args, opts);

    const self = this;

    // A cluster that's already deployed
    const existing = this.existingPart("cluster");
    if (existing) {
      this.connection = connectTo(existing, authTokenOf(existing));
      return;
    }

    // In `sst dev`, a Redis server on the user's machine stands in for the
    // cluster. This is the only place the component handles dev mode.
    const local = args.dev ? runLocally(args.dev) : undefined;
    if (local && $dev) {
      this.runsLocally();
      this.connection = local;
      return;
    }

    const engine = withDefault(args.engine, "redis");
    const version = all([engine, args.version]).apply(
      ([engine, v]) => v ?? (engine === "redis" ? "7.1" : "7.2"),
    );
    const vpc = isVpc(args.vpc)
      ? output({
          subnets: args.vpc.privateSubnets,
          securityGroups: args.vpc.securityGroups,
        })
      : output(args.vpc);

    const serverless = plain(
      args.serverless,
      `The "serverless" of the "${name}" Redis`,
    );
    if (serverless) {
      this.connection = createServerless(serverless === true ? {} : serverless);
      return;
    }

    const instance = withDefault(args.instance, "t4g.micro");
    const clustered = all([args.cluster, args.nodes]).apply(([v, nodes]) => {
      if (v === false) return undefined;
      if (v === true) return { nodes: 1 };
      if (v === undefined) return { nodes: nodes || 1 };
      return v;
    });

    const authToken = this.part("authToken", {
      length: 32,
      special: true,
      overrideSpecial: "!&#$^<>-",
    }).result;

    const secret = this.part("secret", { recoveryWindowInDays: 0 });
    this.part("secretVersion", {
      secretId: secret.id,
      secretString: jsonStringify({ authToken }),
    });

    const subnetGroup = this.part("subnetGroup", {
      description: "Managed by SST",
      subnetIds: vpc.subnets,
    });

    const parameterGroup = this.part(
      "parameterGroup",
      {
        description: "Managed by SST",
        family: all([engine, version]).apply(([engine, version]) => {
          const majorVersion = version.split(".")[0];
          const defaultFamily = `${engine}${majorVersion}`;
          return (
            {
              redis4: "redis4.0",
              redis5: "redis5.0",
              redis6: "redis6.x",
            }[defaultFamily] ?? defaultFamily
          );
        }),
        parameters: all([args.parameters ?? {}, clustered]).apply(
          ([parameters, clustered]) => [
            {
              name: "cluster-enabled",
              value: clustered ? "yes" : "no",
            },
            ...Object.entries(parameters).map(([name, value]) => ({
              name,
              value,
            })),
          ],
        ),
      },
      {
        // Necessary for the parameter group to be deleted AFTER upgrading the instance.
        // This is either a Pulumi bug or an undocumented feature.
        deleteBeforeReplace: false,
      },
    );

    const cluster = this.part("cluster", {
      description: "Managed by SST",
      engine,
      engineVersion: version,
      nodeType: interpolate`cache.${instance}`,
      dataTieringEnabled: instance.apply((v) => v.startsWith("r6gd.")),
      port: 6379,
      clusterMode: clustered.apply((v) => (v ? "enabled" : "disabled")),
      numNodeGroups: ifSet(clustered, (v) => v.nodes),
      replicasPerNodeGroup: ifSet(clustered, () => 0),
      automaticFailoverEnabled: ifSet(clustered, () => true),
      multiAzEnabled: false,
      applyImmediately: true,
      autoMinorVersionUpgrade: false,
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      transitEncryptionMode: "required",
      authTokenUpdateStrategy: "ROTATE",
      authToken,
      subnetGroupName: subnetGroup.name,
      parameterGroupName: parameterGroup.name,
      securityGroupIds: vpc.securityGroups,
      tags: {
        // The same value `Redis` writes, so either component can reference
        // a cluster the other created.
        "sst:component-version": "2",
        "sst:ref:secret": secret.id,
      },
    });
    this.connection = connectTo(cluster, authToken);

    // A serverless cache in place of the cluster, with a password by default.
    // It takes the password from a user group, which needs a user named
    // "default".
    function createServerless(
      options: Exclude<NonNullable<RedisArgs["serverless"]>, boolean>,
    ): Connection {
      const password =
        (options.password ?? true)
          ? self.part("authToken", {
              length: 32,
              special: true,
              overrideSpecial: "!&#$^<>-",
            }).result
          : undefined;
      const userGroup = password
        ? self.part("userGroup", {
            // Named by SST: an empty id is filled in from the part's name
            userGroupId: "",
            engine,
            userIds: [
              self.part("user", {
                userId: "",
                userName: "default",
                engine,
                accessString: "on ~* +@all",
                authenticationMode: { type: "password", passwords: [password] },
              }).userId,
            ],
          })
        : undefined;

      const limits = serverlessLimits(name, options);
      const cache = self.part("serverlessCache", {
        description: "Managed by SST",
        engine,
        majorEngineVersion: version.apply((v) => {
          const major = v.split(".")[0];
          if (parseInt(major) < 7)
            throw new VisibleError(
              `In the Redis component "${name}", \`serverless\` needs version 7 or later, but \`version\` is "${v}".`,
            );
          return major;
        }),
        cacheUsageLimits: all([limits.storage, limits.ecpuPerSecond]).apply(
          ([storage, ecpu]) => ({
            dataStorage: {
              minimum: storage.minimum,
              maximum: storage.maximum,
              unit: "GB",
            },
            ecpuPerSeconds: [{ minimum: ecpu.minimum, maximum: ecpu.maximum }],
          }),
        ),
        securityGroupIds: vpc.securityGroups,
        subnetIds: vpc.subnets,
        userGroupId: userGroup?.userGroupId,
        tags: { "sst:component-version": "2" },
      });

      return {
        clusterId: cache.id,
        username: output("default"),
        password,
        host: cache.endpoints.apply((endpoints) => {
          const address = endpoints?.[0]?.address;
          if (!address)
            throw new VisibleError(
              "The serverless Redis cache has no endpoint address yet.",
            );
          return address;
        }),
        port: cache.endpoints.apply(
          (endpoints) => endpoints?.[0]?.port ?? 6379,
        ),
      };
    }

    function connectTo(
      cluster: elasticache.ReplicationGroup,
      authToken: Output<string>,
    ): Connection {
      return {
        clusterId: cluster.id,
        username: output("default"),
        password: authToken,
        host: cluster.clusterEnabled.apply((enabled) =>
          enabled
            ? cluster.configurationEndpointAddress
            : cluster.primaryEndpointAddress,
        ),
        port: cluster.port.apply((v) => v!),
      };
    }

    // A cluster created by this component, or by the 4.x one, is tagged with
    // the secret that holds its auth token.
    function authTokenOf(cluster: elasticache.ReplicationGroup) {
      const secretId = cluster.tagsAll.apply((tags) => {
        if (!tags?.["sst:ref:secret"])
          throw new VisibleError(
            `Failed to lookup secret for Redis cluster "${name}".`,
          );
        return tags["sst:ref:secret"];
      });
      return secretsmanager
        .getSecretVersionOutput({ secretId }, { parent: self })
        .secretString.apply((v) => JSON.parse(v).authToken as string);
    }

    function runLocally(dev: NonNullable<RedisArgs["dev"]>): Connection {
      const local = {
        clusterId: output("placeholder"),
        host: output(dev.host ?? "localhost"),
        port: output(dev.port ?? 6379),
        username: output(dev.username ?? "default"),
        password: output(dev.password ?? ""),
      };

      new DevCommand(`${name}Dev`, {
        dev: {
          title: name,
          autostart: true,
          command: `sst print-and-not-quit`,
        },
        environment: {
          SST_DEV_COMMAND_MESSAGE: interpolate`Make sure your local Redis server is using:

  username: "${local.username}"
  password: "${dev.password || "\x1b[38;5;8m[no password]\x1b[0m"}"

Listening on "${local.host}:${local.port}"...`,
        },
      });

      return local;
    }
  }

  /**
   * The ID of the Redis cluster, or of the serverless cache when `serverless` is set.
   * `Redis.get` only works with the ID of a cluster.
   */
  public get clusterId() {
    return this.connection.clusterId;
  }

  /**
   * The username to connect to the Redis cluster.
   */
  public get username() {
    return this.connection.username;
  }

  /**
   * The password to connect to the Redis cluster. This is `undefined` for a serverless
   * cache with `password: false`.
   */
  public get password(): Output<string> | undefined {
    return this.connection.password;
  }

  /**
   * The host to connect to the Redis cluster.
   */
  public get host() {
    return this.connection.host;
  }

  /**
   * The port to connect to the Redis cluster.
   */
  public get port() {
    return this.connection.port;
  }

  /**
   * Linking a cluster gives the linked resource its host, port, username and
   * password, if it has one.
   */
  public link() {
    return {
      properties: {
        host: this.host,
        port: this.port,
        username: this.username,
        ...(this.password ? { password: this.password } : {}),
      },
    };
  }

  /**
   * Reference an existing Redis cluster with the given cluster name. This is useful when you
   * create a Redis cluster in one stage and want to share it in another. It avoids having to
   * create a new Redis cluster in the other stage.
   *
   * @param name The name of the component.
   * @param clusterId The id of the existing Redis cluster.
   * @param opts Component resource options.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * const redis = $app.stage === "frank"
   *   ? sst.aws.v5.Redis.get("MyRedis", "app-dev-myredis")
   *   : new sst.aws.v5.Redis("MyRedis");
   * ```
   */
  public static get(
    name: string,
    clusterId: Input<string>,
    opts?: ComponentResourceOptions,
  ) {
    return new Redis(
      name,
      { existing: { cluster: clusterId } } as RedisArgs,
      opts,
    );
  }
}

/**
 * The usage limits of a serverless cache, checked: storage in whole GB, 10 at
 * most by default, and ECPUs per second, 5,000 at most by default. They can be
 * outputs, so they're read once known.
 */
function serverlessLimits(
  name: string,
  options: Exclude<NonNullable<RedisArgs["serverless"]>, boolean>,
) {
  return {
    storage: output(options.storage)
      .apply((v) => all([v?.minimum, v?.maximum]))
      .apply(([min, max]) => {
        const minimum = min ? Math.ceil(toGBs(min)) : undefined;
        const maximum = max ? Math.ceil(toGBs(max)) : 10;
        checkRange(name, "storage", "GB", minimum, maximum, !max);
        return { minimum, maximum };
      }),
    ecpuPerSecond: output(options.ecpuPerSecond)
      .apply((v) => all([v?.minimum, v?.maximum]))
      .apply(([min, max]) => {
        const minimum = min;
        const maximum = max ?? 5000;
        checkRange(name, "ecpuPerSecond", "", minimum, maximum, max === undefined);
        return { minimum, maximum };
      }),
  };
}

function checkRange(
  name: string,
  key: string,
  unit: string,
  minimum: number | undefined,
  maximum: number,
  maximumIsDefault: boolean,
) {
  const suffix = unit ? ` ${unit}` : "";
  for (const [limit, value] of [
    ["minimum", minimum],
    ["maximum", maximum],
  ] as const) {
    if (value !== undefined && value < 1)
      throw new VisibleError(
        `In the Redis component "${name}", \`serverless.${key}.${limit}\` has to be at least 1${suffix}.`,
      );
  }
  if (minimum !== undefined && minimum > maximum)
    throw new VisibleError(
      `In the Redis component "${name}", \`serverless.${key}.minimum\` (${minimum}${suffix}) is above \`serverless.${key}.maximum\` (${maximum}${suffix}${maximumIsDefault ? ", the default" : ""}). Set a \`maximum\` that is at least the \`minimum\`.`,
    );
}
