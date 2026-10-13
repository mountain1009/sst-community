import {
  ComponentResourceOptions,
  interpolate,
  output,
} from "@pulumi/pulumi";
import { cloudwatch, lambda, sqs } from "@pulumi/aws";
import { V5Args, component, deferred, many } from "../../parts-component";
import type { Input } from "../../input";
import { Function } from "./function";
import {
  type FunctionDefinition,
  functionPart,
} from "../helpers/function-part";
import { invokePermissionArgs } from "../helpers/function-permission";
import { sendPolicyArgs } from "../helpers/queue-policy";
import { permission } from "../permission";
import type { Queue as OriginalQueue } from "../queue";
import type { Queue } from "./queue";
import type {
  BusArgs as OriginalBusArgs,
  BusSubscriberArgs as OriginalBusSubscriberArgs,
} from "../bus";

const parts = () => ({
  /**
   * The EventBridge event bus.
   */
  bus: cloudwatch.EventBus,
  /**
   * The functions subscribed to the bus, by subscriber name.
   */
  subscriber: many(deferred(Function)),
  /**
   * The permission that lets EventBridge invoke each function subscriber, by
   * subscriber name.
   */
  permission: many(lambda.Permission),
  /**
   * The rule that matches the events of each subscriber, by subscriber name.
   */
  rule: many(cloudwatch.EventRule),
  /**
   * The target that sends what each rule matches to its subscriber, by
   * subscriber name.
   */
  target: many(cloudwatch.EventTarget),
  /**
   * The policy that lets EventBridge send to each queue subscriber, by
   * subscriber name.
   */
  queuePolicy: many(sqs.QueuePolicy),
});

export interface BusArgs extends V5Args<OriginalBusArgs, typeof parts> {}

export interface BusSubscriberArgs
  extends Omit<OriginalBusSubscriberArgs, "transform"> {}

/**
 * The `Bus` component lets you add an [Amazon EventBridge Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html) to your app.
 *
 * It takes the same args as [`sst.aws.Bus`](/docs/component/aws/bus) and creates the same
 * resources. It's built from parts, so every resource it creates can be transformed, is
 * available in `nodes`, and can be swapped for one you already have. That includes the
 * resources of each subscriber, which are kept inside the bus.
 *
 * @example
 *
 * #### Create a bus
 *
 * ```ts title="sst.config.ts"
 * const bus = new sst.aws.v5.Bus("MyBus");
 * ```
 *
 * #### Add a subscriber
 *
 * Each subscriber has a name.
 *
 * ```ts title="sst.config.ts"
 * bus.subscribe("MySubscriber", "src/subscriber.handler", {
 *   pattern: { detailType: ["order.created"] }
 * });
 * ```
 *
 * #### Subscribe to a bus that isn't in your app
 *
 * Reference it with `get`, by its name, then subscribe to it.
 *
 * ```ts title="sst.config.ts"
 * sst.aws.v5.Bus.get("Shared", "my-shared-bus").subscribe("MySubscriber", "src/subscriber.handler");
 * ```
 *
 * #### Switch from `sst.aws.Bus`
 *
 * Change `sst.aws.Bus` to `sst.aws.v5.Bus` and keep the name. The bus and the subscribers
 * you've deployed are kept.
 *
 * ```ts title="sst.config.ts" del={1} ins={2}
 * const bus = new sst.aws.Bus("MyBus");
 * const bus = new sst.aws.v5.Bus("MyBus");
 * ```
 *
 * A few things work differently:
 *
 * - `sst.aws.Bus.subscribe` and `sst.aws.Bus.subscribeQueue`, which took the ARN of a bus
 *   that isn't in your app, are `get` followed by `subscribe` or `subscribeQueue`. `get`
 *   takes the bus's name. What they created is kept.
 *
 *   ```ts title="sst.config.ts" del={1} ins={2}
 *   sst.aws.Bus.subscribe("MySubscriber", busArn, "src/subscriber.handler");
 *   sst.aws.v5.Bus.get("Shared", "my-shared-bus").subscribe("MySubscriber", "src/subscriber.handler");
 *   ```
 *
 * - A subscriber's `transform` is the bus's: its `rule` and `target` apply to every
 *   subscriber, and a function there is given the subscriber's name.
 * - A queue subscriber is created with the bus's `provider`. `sst.aws.Bus` created it with
 *   your app's provider, whatever the bus was given. If your bus has a `provider` and a queue
 *   subscribed to it, the queue's rule, target and policy are replaced on switch: remove the
 *   subscriber and deploy before you switch, then add it back.
 *
 * #### Link the bus to a resource
 *
 * You can link the bus to other resources, like a function or your Next.js app.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [bus]
 * });
 * ```
 *
 * Once linked, you can publish messages to the bus from your app.
 *
 * ```ts title="app/page.tsx" {1,9}
 * import { Resource } from "sst";
 * import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
 *
 * const eb = new EventBridgeClient({});
 *
 * await eb.send(new PutEventsCommand({
 *   Entries: [
 *     {
 *       EventBusName: Resource.MyBus.name,
 *       Source: "my.source",
 *       Detail: JSON.stringify({ foo: "bar" })
 *     }
 *   ]
 * }));
 * ```
 */
export class Bus extends component("sst:aws:Bus", parts) {
  constructor(
    name: string,
    args: BusArgs = {},
    opts?: ComponentResourceOptions,
  ) {
    super(name, args, opts);

    this.part("bus", {
      logConfig:
        args.logging &&
        output(args.logging).apply((logging) => ({
          level: logging.level.toUpperCase(),
          includeDetail: logging.detail ? "FULL" : "NONE",
        })),
    });
  }

  /**
   * The ARN of the EventBus.
   */
  public get arn() {
    return this.nodes.bus.arn;
  }

  /**
   * The name of the EventBus.
   */
  public get name() {
    return this.nodes.bus.name;
  }

  /**
   * Subscribe to this EventBus with a function.
   *
   * @param name The name of the subscriber.
   * @param subscriber The function that'll be notified: its handler, its args, a function
   * component, or the ARN of a function.
   * @param args Configure the subscription.
   *
   * @example
   *
   * ```js title="sst.config.ts"
   * bus.subscribe("MySubscriber", "src/subscriber.handler");
   * ```
   *
   * Only receive some events with a pattern.
   *
   * ```js title="sst.config.ts"
   * bus.subscribe("MySubscriber", "src/subscriber.handler", {
   *   pattern: {
   *     detailType: ["order.created", "order.updated"]
   *   }
   * });
   * ```
   */
  public subscribe(
    name: string,
    subscriber: FunctionDefinition,
    args: BusSubscriberArgs = {},
  ) {
    this.assertNew("subscriber", "rule", name, args, ["rule", "target"]);
    const rule = this.subscriberRule(name, args);
    const fn = functionPart(this, "subscriber", name, subscriber, {
      description: interpolate`Subscribed to ${this.name}`,
    });
    const permission = this.part(
      "permission",
      name,
      invokePermissionArgs(fn, "events.amazonaws.com", rule.arn),
    );
    this.part(
      "target",
      name,
      { arn: fn.targetArn, rule: rule.name, eventBusName: this.name },
      { dependsOn: [permission] },
    );
    return this;
  }

  /**
   * Subscribe to this EventBus with an SQS Queue.
   *
   * @param name The name of the subscriber.
   * @param queue The queue that'll be notified: a queue component, or the ARN of a queue.
   * @param args Configure the subscription.
   *
   * @example
   *
   * ```js title="sst.config.ts"
   * const queue = new sst.aws.v5.Queue("MyQueue");
   *
   * bus.subscribeQueue("MyQueue", queue);
   * ```
   */
  public subscribeQueue(
    name: string,
    queue: Input<string | OriginalQueue | Queue>,
    args: BusSubscriberArgs = {},
  ) {
    this.assertNew("subscriber", "rule", name, args, ["rule", "target"]);
    const queueArn = output(queue).apply((queue) =>
      typeof queue === "string" ? output(queue) : queue.arn,
    );
    this.part("queuePolicy", name, sendPolicyArgs(queueArn), {
      retainOnDelete: true,
    });
    const rule = this.subscriberRule(name, args);
    this.part("target", name, {
      arn: queueArn,
      rule: rule.name,
      eventBusName: this.name,
    });
    return this;
  }

  // The rule that picks a subscriber's events off the bus: all of them,
  // without a pattern
  private subscriberRule(name: string, args: BusSubscriberArgs) {
    return this.part("rule", name, {
      eventBusName: this.name,
      state: output(args.enabled ?? true).apply((enabled) =>
        enabled ? "ENABLED" : "DISABLED",
      ),
      eventPattern: args.pattern
        ? output(args.pattern).apply((pattern) =>
            JSON.stringify({
              "detail-type": pattern.detailType,
              source: pattern.source,
              detail: pattern.detail,
            }),
          )
        : JSON.stringify({ source: [{ prefix: "" }] }),
    });
  }

  /**
   * Reference an existing EventBus with its name. This is useful when you create a bus in
   * one stage and want to share it in another, or to subscribe to a bus that isn't in your
   * app. The bus is used the way it is: it isn't configured here.
   *
   * @param name The name of the component.
   * @param busName The name of the existing EventBus.
   * @param opts Component resource options.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * const bus = $app.stage === "frank"
   *   ? sst.aws.v5.Bus.get("MyBus", "app-dev-MyBus")
   *   : new sst.aws.v5.Bus("MyBus");
   * ```
   */
  public static get(
    name: string,
    busName: Input<string>,
    opts?: ComponentResourceOptions,
  ) {
    return new Bus(name, { existing: { bus: busName } }, opts);
  }

  /**
   * Linking a bus gives the linked resource its name and ARN, and permission
   * to use it.
   */
  public link() {
    return {
      properties: { name: this.name, arn: this.arn },
      include: [permission({ actions: ["events:*"], resources: [this.arn] })],
    };
  }
}
