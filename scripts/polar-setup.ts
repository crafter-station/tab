import { Polar } from "@polar-sh/sdk";
import type { WebhookEventType } from "@polar-sh/sdk/models/components/webhookeventtype.js";
import { env } from "./env.ts";
import { getPolarEnvFile, updatePolarEnvFile } from "./polar-env-file.ts";

const envFile = getPolarEnvFile();
const productionWebhookUrl = "https://api.tab.cueva.io/api/billing/webhook";
const url = env.POLAR_SERVER === "production"
  ? productionWebhookUrl
  : env.POLAR_WEBHOOK_URL;
if (!url) throw new Error("POLAR_WEBHOOK_URL is required outside production");
if (env.POLAR_SERVER === "production" && env.POLAR_WEBHOOK_URL && env.POLAR_WEBHOOK_URL !== url) {
  throw new Error(`Production webhook URL must be ${productionWebhookUrl}`);
}

const events = [
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.revoked",
  "subscription.past_due",
] as const satisfies readonly WebhookEventType[];
const polar = new Polar({ accessToken: env.POLAR_ACCESS_TOKEN, server: env.POLAR_SERVER });
const organizationScope = env.POLAR_SEND_ORGANIZATION_ID
  ? { organizationId: env.POLAR_ORGANIZATION_ID }
  : {};

const listed = await polar.webhooks.listWebhookEndpoints({
  ...organizationScope,
  limit: 100,
});
const matches = listed.result.items.filter(
  (endpoint) => endpoint.url === url || endpoint.name === "Tab billing sync",
);
if (matches.length > 1) {
  throw new Error(`Multiple Polar webhook endpoints already target ${url}`);
}

const endpoint = matches[0]
  ? await polar.webhooks.updateWebhookEndpoint({
      id: matches[0].id,
      webhookEndpointUpdate: {
        name: "Tab billing sync",
        url,
        format: "raw",
        events: [...events],
        enabled: true,
      },
    })
  : await polar.webhooks.createWebhookEndpoint({
      name: "Tab billing sync",
      url,
      format: "raw",
      events: [...events],
      ...organizationScope,
    });

await updatePolarEnvFile(envFile, {
  POLAR_WEBHOOK_URL: url,
  POLAR_WEBHOOK_SECRET: endpoint.secret,
});

console.log(JSON.stringify({
  status: matches[0] ? "updated" : "created",
  environment: env.POLAR_SERVER,
  webhookEndpointId: endpoint.id,
  url: endpoint.url,
  events: endpoint.events,
  secretStoredIn: envFile,
}, null, 2));
