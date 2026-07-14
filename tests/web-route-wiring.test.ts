import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { createServer, type ViteDevServer } from "vite";
import { createAuthInstance, migrateAuth } from "../apps/api/src/auth.ts";
import {
	BillingService,
	InMemoryBillingStorage,
	InMemoryUsageMeterClient,
	UsageMeterService,
} from "../apps/api/src/billing.ts";
import {
	DeviceTokenService,
	InMemoryDeviceTokenStorage,
} from "../apps/api/src/device-tokens.ts";
import { createApp } from "../apps/api/src/index.ts";
import { InMemoryPersonalMemoryStorage } from "../apps/api/src/personal-memory.ts";
import { InMemoryTelemetryStorage } from "../apps/api/src/telemetry.ts";

const WEB_ORIGIN = "http://localhost:3000";
const API_ORIGIN = "http://in-process-api.test";
const email = `web-route-${crypto.randomUUID()}@example.com`;
const password = "password123456";
const virtualCloudflareWorkers = "\0test-cloudflare-workers";

let database: Database;
let personalMemoryStorage: InMemoryPersonalMemoryStorage;
let vite: ViteDevServer;
let userId = "";
let sessionCookie = "";
let webFetch: (request: Request) => Promise<Response>;
const nativeFetch = globalThis.fetch;

function webRequest(path: string, init: RequestInit = {}) {
	return webFetch(new Request(`${WEB_ORIGIN}${path}`, init));
}

beforeAll(async () => {
	database = new Database(":memory:");
	const auth = createAuthInstance({
		database,
		baseURL: API_ORIGIN,
		requireEmailVerification: false,
	});
	await migrateAuth(auth);
	personalMemoryStorage = new InMemoryPersonalMemoryStorage();
	const app = createApp({
		auth,
		billingService: new BillingService({
			storage: new InMemoryBillingStorage(),
		}),
		billingCheckoutClient: {
			createCheckoutUrl: async (planId) => `https://checkout.example/${planId}`,
			createPortalUrl: async () => "https://portal.example/account",
		},
		deviceTokenService: new DeviceTokenService({
			storage: new InMemoryDeviceTokenStorage(),
		}),
		personalMemoryStorage,
		telemetryStorage: new InMemoryTelemetryStorage(),
		usageMeterService: new UsageMeterService({
			client: new InMemoryUsageMeterClient(),
		}),
	});

	globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		return new URL(request.url).origin === API_ORIGIN
			? app.fetch(request)
			: nativeFetch(input, init);
	};

	const signup = await app.request("/api/auth/sign-up/email", {
		method: "POST",
		headers: { "content-type": "application/json", origin: WEB_ORIGIN },
		body: JSON.stringify({ name: "Web Route User", email, password }),
	});
	expect(signup.status).toBe(200);
	const signupBody = (await signup.json()) as { user: { id: string } };
	userId = signupBody.user.id;
	sessionCookie = signup.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
	database.query("UPDATE user SET emailVerified = 1 WHERE id = ?").run(userId);

	vite = await createServer({
		root: new URL("../apps/web", import.meta.url).pathname,
		configFile: false,
		logLevel: "silent",
		plugins: [
			{
				name: "in-process-cloudflare-bindings",
				resolveId(id) {
					if (id === "cloudflare:workers") return virtualCloudflareWorkers;
				},
				load(id) {
					if (id !== virtualCloudflareWorkers) return;
					return `export const env = ${JSON.stringify({
						TAB_API_BASE_URL: API_ORIGIN,
						TAB_MAC_DOWNLOAD_URL: "https://download.example/Tab.dmg",
						TAB_DESKTOP_LATEST_VERSION: "0.1.0",
					})}`;
				},
			},
			tailwindcss(),
			tanstackStart(),
			react(),
		],
		server: { middlewareMode: true },
	});
	const serverEntry = await vite.ssrLoadModule(
		"@tanstack/react-start/server-entry",
	);
	webFetch = (request) => serverEntry.default.fetch(request);
}, 30_000);

afterAll(async () => {
	globalThis.fetch = nativeFetch;
	await vite?.close();
	database?.close();
});

describe("TanStack Start request routing", () => {
	it("routes auth through the API-owned session interface", async () => {
		const response = await webRequest("/signup", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				name: "Route Signup User",
				email: `route-signup-${crypto.randomUUID()}@example.com`,
				password,
			}),
		});
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"/signup?status=verify_email",
		);
		expect(response.headers.get("set-cookie")).toContain(
			"better-auth.session_token=",
		);
	});

	it("routes Personal Memory mutations to the in-memory API", async () => {
		const response = await webRequest("/dashboard/memories/create", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				cookie: sessionCookie,
			},
			body: new URLSearchParams({ content: "Prefers concise summaries" }),
		});
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/dashboard/memories");
		expect(
			await personalMemoryStorage.listMemoriesByUser(userId),
		).toMatchObject([
			{ content: "Prefers concise summaries", createdBy: "user" },
		]);
	});

	it("rejects explicit cross-origin mutation requests before they reach the API", async () => {
		const before = await personalMemoryStorage.listMemoriesByUser(userId);
		for (const headers of [
			{ origin: "https://evil.example" },
			{ "sec-fetch-site": "cross-site" },
		]) {
			const response = await webRequest("/dashboard/memories/create", {
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					cookie: sessionCookie,
					...headers,
				},
				body: new URLSearchParams({ content: "Cross-site memory" }),
			});
			expect(response.status).toBe(403);
		}
		expect(await personalMemoryStorage.listMemoriesByUser(userId)).toEqual(before);
	});

	it("accepts an explicit same-origin mutation request", async () => {
		const response = await webRequest("/dashboard/memories/create", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				cookie: sessionCookie,
				origin: WEB_ORIGIN,
				"sec-fetch-site": "same-origin",
			},
			body: new URLSearchParams({ content: "Same-origin memory" }),
		});
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/dashboard/memories");
	});

	it("routes Max Plan Change requests through canonical checkout", async () => {
		const response = await webRequest("/billing/checkout?plan=max", {
			headers: { cookie: sessionCookie },
		});
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"https://checkout.example/max",
		);
	});

	it("routes raw download metadata without falling through to SSR", async () => {
		const response = await webRequest("/download/latest.json");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toMatchObject({ version: "0.1.0" });
	});
});
