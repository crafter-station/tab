import { afterAll, beforeAll, describe, expect, it } from "bun:test";

let apiServer: ReturnType<typeof Bun.serve>;
let vite: Bun.Subprocess;
let webOrigin = "";
const apiRequests: string[] = [];

async function waitForResponse(url: string) {
	const deadline = Date.now() + 45_000;
	let lastError: unknown;

	while (Date.now() < deadline) {
		if (vite.exitCode !== null) {
			const stderr = await new Response(vite.stderr).text();
			throw new Error(`Vite exited with code ${vite.exitCode}: ${stderr}`);
		}

		try {
			const response = await fetch(url);
			if (response.status === 200) return response;
			lastError = new Error(
				`Vite returned ${response.status}: ${await response.text()}`,
			);
		} catch (error) {
			lastError = error;
		}
		await Bun.sleep(100);
	}

	throw lastError;
}

beforeAll(async () => {
	apiServer = Bun.serve({
		port: 0,
		fetch(request) {
			apiRequests.push(new URL(request.url).pathname);
			return Response.json(null);
		},
	});

	const portReservation = Bun.serve({
		port: 0,
		fetch: () => new Response(null, { status: 503 }),
	});
	const webPort = portReservation.port;
	await portReservation.stop(true);

	webOrigin = `http://127.0.0.1:${webPort}`;

	vite = Bun.spawn(
		[
			new URL("../node_modules/.bin/vite", import.meta.url).pathname,
			"dev",
			"--host",
			"127.0.0.1",
			"--logLevel",
			"silent",
		],
		{
			cwd: new URL("../apps/web", import.meta.url).pathname,
			env: {
				...process.env,
				PORT: String(apiServer.port),
				TAB_API_BASE_URL: `http://127.0.0.1:${apiServer.port}`,
				WEB_PORT: String(webPort),
			},
			stderr: "pipe",
			stdout: "ignore",
		},
	);
}, 30_000);

afterAll(async () => {
	vite?.kill();
	await vite?.exited;
	await apiServer?.stop(true);
});

describe("web development configuration", () => {
	it("uses WEB_PORT and sends server requests to the configured local API", async () => {
		const response = await waitForResponse(`${webOrigin}/login`);

		expect(response.status).toBe(200);
		expect(apiRequests).toContain("/api/auth/get-session");
	}, 50_000);
});
