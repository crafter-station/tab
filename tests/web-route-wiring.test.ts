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
const verificationEmails: string[] = [];
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
		webBaseURL: WEB_ORIGIN,
		requireEmailVerification: true,
		sendVerificationEmail: async ({ url }) => {
			verificationEmails.push(url);
		},
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
	database.query("UPDATE user SET emailVerified = 1 WHERE id = ?").run(userId);
	const signIn = await app.request("/api/auth/sign-in/email", {
		method: "POST",
		headers: { "content-type": "application/json", origin: WEB_ORIGIN },
		body: JSON.stringify({ email, password }),
	});
	sessionCookie = signIn.headers.get("set-cookie")?.split(";", 1)[0] ?? "";

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
		const next = "/dashboard/usage";
		const response = await webRequest("/signup", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				name: "Route Signup User",
				email: `route-signup-${crypto.randomUUID()}@example.com`,
				password,
				next,
			}),
		});
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toContain("/verify-email?status=sent");
		expect(response.headers.get("set-cookie")).not.toContain("better-auth.session_token=");
		const verificationStateCookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";

		const verificationUrl = new URL(verificationEmails.at(-1)!);
		expect(verificationUrl.origin).toBe(WEB_ORIGIN);
		expect(verificationUrl.pathname).toBe("/verify-email/confirm");
		const verified = await webRequest(`${verificationUrl.pathname}${verificationUrl.search}`, {
			headers: { cookie: verificationStateCookie },
		});
		expect(verified.status).toBe(303);
		expect(verified.headers.get("location")).toBe(`/signup?next=${encodeURIComponent(next)}`);
		expect(verified.headers.get("set-cookie")).toContain("better-auth.session_token=");

		const verifiedCookie = verified.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
		const continued = await webRequest(verified.headers.get("location")!, {
			headers: { cookie: verifiedCookie },
		});
		expect(continued.status).toBeGreaterThanOrEqual(300);
		expect(continued.status).toBeLessThan(400);
		expect(continued.headers.get("location")).toBe(next);

		const reused = await webRequest(`${verificationUrl.pathname}${verificationUrl.search}`);
		expect(reused.status).toBe(303);
		expect(reused.headers.get("location")).toBe(`/login?next=${encodeURIComponent(next)}&status=email_verified`);
		expect(reused.headers.get("set-cookie") ?? "").not.toContain("better-auth.session_token=");
	});

	it("makes malformed verification links recoverable", async () => {
		const callbackURL = `${WEB_ORIGIN}/login?next=%2Fdashboard`;
		const response = await webRequest(`/verify-email/confirm?${new URLSearchParams({
			token: "not-a-jwt",
			callbackURL,
		})}`);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toContain("/verify-email?error=invalid");
	});

	it("uses the same verification flow for desktop browser handoff", async () => {
		const callback = "tab://auth/callback";
		const signup = await webRequest("/signup", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				name: "Desktop Route User",
				email: `desktop-route-${crypto.randomUUID()}@example.com`,
				password,
				device_id: "desktop-route-mac",
				callback,
			}),
		});
		expect(signup.headers.get("location")).toContain("/verify-email?status=sent");
		const verificationStateCookie = signup.headers.get("set-cookie")?.split(";", 1)[0] ?? "";

		const verificationUrl = new URL(verificationEmails.at(-1)!);
		const verified = await webRequest(`${verificationUrl.pathname}${verificationUrl.search}`, {
			headers: { cookie: verificationStateCookie },
		});
		expect(verified.status).toBeGreaterThanOrEqual(300);
		expect(verified.status).toBeLessThan(400);
		const handoff = new URL(verified.headers.get("location")!);
		expect(`${handoff.protocol}//${handoff.host}${handoff.pathname}`).toBe(callback);
		expect(handoff.searchParams.get("code")).toBeTruthy();
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
