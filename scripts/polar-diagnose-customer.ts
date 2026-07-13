import { Polar } from "@polar-sh/sdk";
import { env } from "./env.ts";

const accessToken = env.POLAR_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error("POLAR_ACCESS_TOKEN is required");
}

const meterId = env.POLAR_DEEP_COMPLETE_METER_ID ?? env.POLAR_AUTOCOMPLETE_METER_ID;
if (!meterId) {
  throw new Error("POLAR_DEEP_COMPLETE_METER_ID is required");
}

const planProductIds = {
  pro_monthly: env.POLAR_PRODUCT_ID_PRO_MONTHLY ?? env.POLAR_PRODUCT_ID_PRO,
  pro_annual: env.POLAR_PRODUCT_ID_PRO_ANNUAL,
  legacy_max: env.POLAR_PRODUCT_ID_MAX,
};

type EntitlementRow = {
  user_id: string;
  plan_id: string;
  polar_customer_id: string | null;
  polar_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  local_usage_count: number | null;
};

const args = parseArgs(process.argv.slice(2));
const polar = new Polar({ accessToken, server: env.POLAR_SERVER });

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: Array<string>): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (!rawKey) {
      throw new Error(`Invalid argument: ${arg}`);
    }

    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
      continue;
    }

    const nextArg = argv[index + 1];
    if (nextArg && !nextArg.startsWith("--")) {
      parsed[rawKey] = nextArg;
      index++;
      continue;
    }

    parsed[rawKey] = true;
  }

  return parsed;
}

function getStringArg(name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getBooleanArg(name: string): boolean {
  return args[name] === true;
}

async function queryLocalEntitlements(
  whereClause?: string,
): Promise<Array<EntitlementRow>> {
  const command = [
    "bunx",
    "wrangler",
    "d1",
    "execute",
    "tab-db",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--json",
    "--command",
    `SELECT ue.user_id, ue.plan_id, ue.polar_customer_id, ue.polar_subscription_id, ue.status, ue.current_period_end, ur.count AS local_usage_count FROM user_entitlements ue LEFT JOIN usage_records ur ON ur.user_id = ue.user_id AND ur.month = strftime('%Y-%m', 'now')${whereClause ? ` WHERE ${whereClause}` : ""} ORDER BY ue.cached_at DESC LIMIT 20;`,
  ];
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`wrangler d1 execute failed: ${stderr.trim()}`);
  }

  const parsed = JSON.parse(stdout) as Array<{
    results?: Array<EntitlementRow>;
  }>;

  return parsed.flatMap((item) => item.results ?? []);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function summarizeSubscription(subscription: Awaited<ReturnType<typeof polar.subscriptions.get>>) {
  return {
    id: subscription.id,
    status: subscription.status,
    customerId: subscription.customerId,
    externalCustomerId: subscription.customer.externalId,
    productId: subscription.productId,
    currentProductMatch: Object.entries(planProductIds)
      .filter(([, productId]) => productId === subscription.productId)
      .map(([plan]) => plan)[0] ?? null,
    meters: subscription.meters.map((meter) => ({
      meterId: meter.meterId,
      currentMeter: meter.meterId === meterId,
      consumedUnits: meter.consumedUnits,
      creditedUnits: meter.creditedUnits,
      amount: meter.amount,
    })),
    hasCurrentMeter: subscription.meters.some((meter) => meter.meterId === meterId),
  };
}

async function getTargetFromLocal(): Promise<EntitlementRow | undefined> {
  const userId = getStringArg("user-id");
  if (!userId) {
    return undefined;
  }

  const rows = await queryLocalEntitlements(`ue.user_id = ${sqlString(userId)}`);
  return rows[0];
}

async function getPortalMeter(customerSession: string) {
  const customerMeters = await polar.customerPortal.customerMeters.list(
    { customerSession },
    { meterId, limit: 1 },
  );

  return customerMeters.result.items[0];
}

async function main() {
  const explicitSubscriptionId = getStringArg("subscription-id");
  const explicitCustomerId = getStringArg("customer-id");
  const explicitExternalCustomerId = getStringArg("external-customer-id");
  const shouldBackfill = getBooleanArg("backfill");
  const localTarget = await getTargetFromLocal();

  if (
    !explicitSubscriptionId &&
    !explicitCustomerId &&
    !explicitExternalCustomerId &&
    !localTarget
  ) {
    const rows = await queryLocalEntitlements();
    console.log(
      JSON.stringify(
        {
          message:
            "Pass one of --user-id, --customer-id, --external-customer-id, or --subscription-id.",
          recentLocalEntitlements: rows,
        },
        null,
        2,
      ),
    );
    return;
  }

  const organization = await polar.organizations.get({ id: env.POLAR_ORGANIZATION_ID });
  const subscription = explicitSubscriptionId
    ? await polar.subscriptions.get({ id: explicitSubscriptionId })
    : undefined;
  const customerId = explicitCustomerId ?? localTarget?.polar_customer_id ?? subscription?.customerId;
  const externalCustomerId = explicitExternalCustomerId ?? localTarget?.user_id ?? subscription?.customer.externalId ?? undefined;

  let subscriptions = subscription ? [subscription] : [];
  if (!subscription) {
    const listed = await polar.subscriptions.list({
      customerId,
      externalCustomerId: customerId ? undefined : externalCustomerId,
      active: true,
      limit: 10,
    });
    subscriptions = listed.result.items;
  }

  const session = customerId || externalCustomerId
    ? await polar.customerSessions.create(
      customerId ? { customerId } : { externalCustomerId: externalCustomerId as string },
    )
    : undefined;

  let portalMeter = session ? await getPortalMeter(session.token) : undefined;

  const portalSubscriptions = session
    ? await polar.customerPortal.subscriptions.list(
      { customerSession: session.token },
      { active: true, limit: 10 },
    )
    : undefined;

  const localUsageCount = localTarget?.local_usage_count ?? null;
  const portalConsumedUnits = portalMeter?.consumedUnits ?? null;
  const backfillDelta =
    localUsageCount !== null && portalConsumedUnits !== null
      ? Math.max(0, localUsageCount - portalConsumedUnits)
      : null;
  let backfillResult:
    | {
        applied: boolean;
        delta: number | null;
        externalId?: string;
        finalPortalConsumedUnits?: number;
      }
    | null = null;

  if (shouldBackfill) {
    if (!localTarget) {
      throw new Error("--backfill requires --user-id so the local usage count is known");
    }
    if (!externalCustomerId) {
      throw new Error("Could not determine external customer id for backfill");
    }
    if (backfillDelta === null) {
      throw new Error("Could not determine backfill delta");
    }

    if (backfillDelta > 0) {
      const month = currentMonth();
      const externalId = `tab-polar-backfill-${localTarget.user_id}-${month}-${meterId}-${localUsageCount}`;
      await polar.events.ingest({
        events: [
          {
            name: "deep_complete.used",
            externalCustomerId,
            externalId,
            metadata: {
              requestId: externalId,
              creditsSpent: backfillDelta,
            },
            organizationId: env.POLAR_SEND_ORGANIZATION_ID
              ? env.POLAR_ORGANIZATION_ID
              : undefined,
            timestamp: new Date(),
          },
        ],
      });

      for (let attempt = 1; attempt <= 12; attempt++) {
        await delay(2_500);
        portalMeter = session ? await getPortalMeter(session.token) : undefined;
        if ((portalMeter?.consumedUnits ?? 0) >= localUsageCount) {
          break;
        }
      }

      backfillResult = {
        applied: true,
        delta: backfillDelta,
        externalId,
        finalPortalConsumedUnits: portalMeter?.consumedUnits,
      };
    } else {
      backfillResult = {
        applied: false,
        delta: backfillDelta,
        finalPortalConsumedUnits: portalMeter?.consumedUnits,
      };
    }
  }

  console.log(JSON.stringify({
    message: "Polar customer diagnostics",
    environment: env.POLAR_SERVER,
    localEntitlement: localTarget ?? null,
    portalUsageVisible: organization.customerPortalSettings.usage.show,
    currentIds: {
      meterId,
      products: planProductIds,
    },
    subscriptions: subscriptions.map(summarizeSubscription),
    usageDelta: {
      localUsageCount,
      portalConsumedUnits,
      backfillDelta,
    },
    backfill: backfillResult,
    portalMeters: portalMeter
      ? [
        {
          id: portalMeter.id,
          meterId: portalMeter.meterId,
          consumedUnits: portalMeter.consumedUnits,
          creditedUnits: portalMeter.creditedUnits,
          balance: portalMeter.balance,
        },
      ]
      : null,
    portalSubscriptions: portalSubscriptions?.result.items.map((item) => ({
      id: item.id,
      status: item.status,
      productId: item.productId,
      currentProductMatch: Object.entries(planProductIds)
        .filter(([, productId]) => productId === item.productId)
        .map(([plan]) => plan)[0] ?? null,
    })) ?? null,
  }, null, 2));
}

await main();
