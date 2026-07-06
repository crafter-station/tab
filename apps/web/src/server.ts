import { planQuotas, type PlanId } from "@tabb/billing";
import {
  BillingQuotaResponseSchema,
  type DeviceListItem,
  DeviceListResponseSchema,
  MemoryListResponseSchema,
  type PersonalMemory,
} from "@tabb/contracts";

export type WebAppConfig = {
  apiBaseUrl: string;
  fetch?: typeof globalThis.fetch;
  appName?: string;
  macDownloadUrl?: string;
  latestVersion?: string;
};

type User = {
  id: string;
  name?: string;
  email?: string;
};

type SessionResult =
  | { ok: true; user: User }
  | { ok: false; response: Response };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPlanName(planId: string): string {
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

function formatMonthlyPrice(monthlyPriceUsd: number): string {
  if (monthlyPriceUsd === 0) {
    return "Free";
  }

  return `$${monthlyPriceUsd}/mo`;
}

function renderTableOrEmpty(
  rows: string,
  header: string,
  emptyMessage: string,
): string {
  if (!rows) {
    return `<p>${emptyMessage}</p>`;
  }

  return `<table><thead>${header}</thead><tbody>${rows}</tbody></table>`;
}

function layout(
  title: string,
  content: string,
  options: { user?: User; path?: string } = {},
): string {
  const { user, path } = options;
  const nav = [
    { href: "/", label: "Home" },
    { href: "/pricing", label: "Pricing" },
    ...(user ? [{ href: "/account", label: "Account" }] : []),
  ];

  const authLink = user
    ? `<form method="post" action="/logout" style="display:inline"><button type="submit" class="link-button">Sign out</button></form>`
    : `<a href="/login" class="button">Sign in</a>`;

  const navItems = nav
    .map(
      (item) =>
        `<a href="${item.href}" class="${path === item.href ? "active" : ""}">${item.label}</a>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; max-width: 960px; margin: 0 auto; padding: 1rem; color: #111; background: #fff; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ddd; padding-bottom: 1rem; margin-bottom: 1.5rem; }
    header a { text-decoration: none; color: inherit; }
    nav { display: flex; gap: 1rem; align-items: center; }
    nav a.active { font-weight: 600; text-decoration: underline; }
    .button, button { display: inline-block; padding: 0.5rem 0.75rem; border-radius: 0.375rem; border: 1px solid #111; background: #111; color: #fff; text-decoration: none; cursor: pointer; }
    .button.secondary { background: #fff; color: #111; }
    .link-button { background: transparent; color: inherit; border: none; padding: 0; font: inherit; cursor: pointer; text-decoration: underline; }
    .card { border: 1px solid #ddd; border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; }
    .pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
    .price { font-size: 1.5rem; font-weight: 700; }
    .muted { color: #666; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
    form.inline { display: inline; }
    .alert { background: #fff3cd; border: 1px solid #ffeaa7; padding: 0.75rem; border-radius: 0.375rem; }
    footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #ddd; font-size: 0.875rem; color: #666; }
    label { display: block; margin-top: 0.75rem; font-weight: 500; }
    input { width: 100%; padding: 0.5rem; margin-top: 0.25rem; box-sizing: border-box; }
    .error { color: #c0392b; }
  </style>
</head>
<body>
  <header>
    <a href="/" style="font-weight:700;font-size:1.25rem">Tabb</a>
    <nav>${navItems} ${authLink}</nav>
  </header>
  <main>${content}</main>
  <footer>Tabb — native autocomplete for macOS.</footer>
</body>
</html>`;
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function htmlErrorPage(
  title: string,
  message: string,
  user?: User,
): Response {
  return html(layout(title, `<p class="error">${message}</p>`, { user }));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function routeSegment(path: string, index: number): string | undefined {
  const segment = path.split("/")[index];
  return segment ? decodeURIComponent(segment) : undefined;
}

function setCookies(response: Response, source: Response): void {
  const cookies = source.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
}

export function createWebApp(config: WebAppConfig) {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const appName = config.appName ?? "Tabb";
  const macDownloadUrl =
    config.macDownloadUrl ??
    process.env.TABB_MAC_DOWNLOAD_URL ??
    "https://downloads.tabb.app/tabb.dmg";
  const latestVersion =
    config.latestVersion ??
    process.env.TABB_DESKTOP_LATEST_VERSION ??
    "0.1.0";

  async function apiRequest(
    path: string,
    init: RequestInit = {},
    cookieHeader?: string,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
    if (!headers.has("origin")) {
      headers.set("origin", baseUrl);
    }

    const url = `${baseUrl}${path}`;
    return fetchImpl(url, { ...init, headers });
  }

  async function getSession(
    cookieHeader: string | undefined,
  ): Promise<SessionResult> {
    const response = await apiRequest("/api/auth/get-session", {}, cookieHeader);
    if (response.status !== 200) {
      return {
        ok: false,
        response: redirect("/login"),
      };
    }

    const body = (await response.json()) as { user?: User };
    if (!body.user?.id) {
      return {
        ok: false,
        response: redirect("/login"),
      };
    }

    return { ok: true, user: body.user };
  }

  async function requireSession(
    cookieHeader: string | undefined,
  ): Promise<SessionResult> {
    return getSession(cookieHeader);
  }

  function homePage(path: string): Response {
    const content = `
      <section class="card">
        <h1>Native autocomplete for macOS</h1>
        <p>Tabb suggests the next few words while you type in Mail, Slack, Notes, Ghostty, and everywhere else you write.</p>
        <p>Your typing context stays on your Mac. Personal Memory is stored in your account and visible only to you.</p>
        <a href="/download" class="button">Download for macOS</a>
        <a href="/pricing" class="button secondary">See pricing</a>
      </section>
      <section>
        <h2>How it works</h2>
        <ol>
          <li>Install the Tabb app and grant Accessibility permissions.</li>
          <li>Sign in with your Tabb account.</li>
          <li>Tabb shows a lightweight suggestion overlay after you pause typing.</li>
          <li>Press Option+Tab or click the overlay to accept a suggestion.</li>
        </ol>
      </section>`;
    return html(layout(`${appName} — Native autocomplete for macOS`, content, { path }));
  }

  function pricingPage(path: string): Response {
    const plans = Object.entries(planQuotas).map(([planId, plan]) => ({
      planId: planId as PlanId,
      name: formatPlanName(planId),
      ...plan,
    }));

    const cards = plans
      .map((plan) => {
        const cta =
          plan.planId === "free"
            ? `<span class="muted">Free forever</span>`
            : `<a href="/billing/checkout?plan=${plan.planId}" class="button">Choose ${plan.name}</a>`;
        return `
          <div class="card">
            <h3>${escapeHtml(plan.name)}</h3>
            <div class="price">${formatMonthlyPrice(plan.monthlyPriceUsd)}</div>
            <p>${plan.monthlyAutocompleteSuggestions.toLocaleString()} autocompletes per month</p>
            <p>Personal Memory included</p>
            ${cta}
          </div>`;
      })
      .join("");

    const content = `
      <h1>Pricing</h1>
      <p>Choose the plan that fits how much you write. Upgrade or downgrade at any time.</p>
      <div class="pricing-grid">${cards}</div>`;
    return html(layout(`${appName} Pricing`, content, { path }));
  }

  function loginPage(error?: string, path = "/login"): Response {
    const errorBlock = error
      ? `<p class="error">${escapeHtml(error)}</p>`
      : "";
    const content = `
      <h1>Sign in to ${escapeHtml(appName)}</h1>
      <form method="post" action="/login" class="card">
        ${errorBlock}
        <label>Email
          <input type="email" name="email" required autocomplete="email">
        </label>
        <label>Password
          <input type="password" name="password" required autocomplete="current-password">
        </label>
        <p style="margin-top:1rem"><button type="submit">Sign in</button></p>
      </form>`;
    return html(layout(`Sign in — ${appName}`, content, { path }));
  }

  async function loginHandler(request: Request, cookieHeader?: string): Promise<Response> {
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return loginPage("Invalid form submission.");
    }

    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    const signInResponse = await apiRequest(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe: true }),
      },
      cookieHeader,
    );

    if (signInResponse.status !== 200) {
      return loginPage("Invalid email or password.");
    }

    const response = redirect("/account");
    setCookies(response, signInResponse);
    return response;
  }

  async function accountPage(
    cookieHeader: string | undefined,
    path: string,
    searchParams: URLSearchParams,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const [quotaResponse, devicesResponse, memoriesResponse] = await Promise.all([
      apiRequest("/api/billing/quota", {}, cookieHeader),
      apiRequest("/api/auth/devices", {}, cookieHeader),
      apiRequest("/api/account/memory", {}, cookieHeader),
    ]);

    if (quotaResponse.status === 401) {
      return redirect("/login");
    }

    const quota = BillingQuotaResponseSchema.parse(await quotaResponse.json());
    const deviceList = DeviceListResponseSchema.parse(await devicesResponse.json());
    const memoryList = MemoryListResponseSchema.parse(await memoriesResponse.json());

    const upgradeAlert =
      quota.data.usage >= quota.data.quota
        ? `<div class="alert"><strong>Quota exhausted.</strong> You have used ${quota.data.usage.toLocaleString()} of ${quota.data.quota.toLocaleString()} autocompletes this month. <a href="/pricing">Upgrade to continue</a>.</div>`
        : "";

    const usageBar = `
      <div class="card">
        <h2>Monthly usage</h2>
        <p><strong>${formatPlanName(quota.data.planId)} plan</strong></p>
        <p>${quota.data.usage.toLocaleString()} / ${quota.data.quota.toLocaleString()} autocompletes used this month</p>
        <p class="muted">Resets ${formatDate(quota.data.resetAt)}</p>
        ${upgradeAlert}
        <p><a href="/billing/portal" class="button secondary">Manage billing</a></p>
      </div>`;

    const devicesRows = deviceList.data.devices
      .map((device: DeviceListItem) => {
        const revokeForm = device.revoked
          ? ""
          : `<form class="inline" method="post" action="/account/devices/${encodeURIComponent(device.deviceId)}/revoke"><button type="submit">Revoke</button></form>`;

        return `
          <tr>
            <td>${escapeHtml(device.platform)}</td>
            <td>${escapeHtml(device.appVersion)}</td>
            <td>${formatDate(device.createdAt)}</td>
            <td>${device.revoked ? "Revoked" : "Active"}</td>
            <td>${revokeForm}</td>
          </tr>`;
      })
      .join("");

    const devicesTableHeader =
      "<tr><th>Platform</th><th>Version</th><th>Added</th><th>Status</th><th></th></tr>";

    const devicesSection = `
      <div class="card" id="devices">
        <h2>Devices</h2>
        ${renderTableOrEmpty(devicesRows, devicesTableHeader, "No devices linked to your account.")}
      </div>`;

    const memoryRows = memoryList.data.memories
      .map(
        (memory: PersonalMemory) => `
          <tr>
            <td>${escapeHtml(memory.category)}</td>
            <td>${escapeHtml(memory.content)}</td>
            <td>${escapeHtml(memory.source)}</td>
            <td>${formatDate(memory.createdAt)}</td>
            <td>
              <form class="inline" method="post" action="/account/memory/${encodeURIComponent(memory.id)}/delete"><button type="submit">Delete</button></form>
            </td>
          </tr>`,
      )
      .join("");

    const memoriesTableHeader =
      "<tr><th>Category</th><th>Content</th><th>Source</th><th>Added</th><th></th></tr>";

    const memoriesSection = `
      <div class="card" id="memories">
        <h2>Personal Memory</h2>
        ${renderTableOrEmpty(memoryRows, memoriesTableHeader, "No memories stored yet.")}
      </div>`;

    const tab = searchParams.get("tab");
    const focusScript = tab
      ? `<script>document.getElementById("${escapeHtml(tab)}")?.scrollIntoView();</script>`
      : "";

    const content = `
      <h1>Account</h1>
      ${usageBar}
      ${devicesSection}
      ${memoriesSection}
      ${focusScript}`;

    return html(layout(`Account — ${appName}`, content, { user: sessionCheck.user, path }));
  }

  async function checkoutRedirect(
    cookieHeader: string | undefined,
    searchParams: URLSearchParams,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const plan = searchParams.get("plan") ?? "pro";
    const response = await apiRequest(
      `/api/billing/checkout?plan=${encodeURIComponent(plan)}`,
      {},
      cookieHeader,
    );

    if (response.status === 401) return redirect("/login");
    if (response.status !== 200) {
      return htmlErrorPage(
        "Checkout error",
        "Could not start checkout. Please try again.",
        sessionCheck.user,
      );
    }

    const body = (await response.json()) as { data: { url: string } };
    return redirect(body.data.url);
  }

  async function portalRedirect(
    cookieHeader: string | undefined,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const response = await apiRequest("/api/billing/portal", {}, cookieHeader);
    if (response.status === 401) return redirect("/login");
    if (response.status !== 200) {
      return htmlErrorPage(
        "Billing error",
        "Could not open billing portal. Please try again.",
        sessionCheck.user,
      );
    }

    const body = (await response.json()) as { data: { url: string } };
    return redirect(body.data.url);
  }

  async function revokeDeviceHandler(
    cookieHeader: string | undefined,
    deviceId: string,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const response = await apiRequest(
      "/api/auth/device/revoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId }),
      },
      cookieHeader,
    );

    if (response.status === 401) return redirect("/login");
    return redirect("/account?tab=devices");
  }

  async function deleteMemoryHandler(
    cookieHeader: string | undefined,
    memoryId: string,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    const response = await apiRequest(
      `/api/account/memory/${encodeURIComponent(memoryId)}`,
      { method: "DELETE" },
      cookieHeader,
    );

    if (response.status === 401) return redirect("/login");
    return redirect("/account?tab=memories");
  }

  async function logoutHandler(
    cookieHeader: string | undefined,
  ): Promise<Response> {
    const sessionCheck = await requireSession(cookieHeader);
    if (!sessionCheck.ok) return sessionCheck.response;

    await apiRequest("/api/auth/sign-out", { method: "POST" }, cookieHeader);
    return redirect("/");
  }

  function downloadPage(): Response {
    const content = `
      <section class="card">
        <h1>Download Tabb for macOS</h1>
        <p>Install the native autocomplete app directly on your Mac.</p>
        <p><a href="/download/tabb.dmg" class="button">Download Tabb.dmg</a></p>
        <p class="muted">Version ${escapeHtml(latestVersion)} · macOS 14+. Notarization and code signing are handled during release packaging.</p>
      </section>`;
    return html(layout(`${appName} Download`, content));
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const cookieHeader = request.headers.get("cookie") ?? undefined;

      if (path === "/" && request.method === "GET") {
        return homePage(path);
      }

      if (path === "/pricing" && request.method === "GET") {
        return pricingPage(path);
      }

      if (path === "/login") {
        if (request.method === "GET") return loginPage(undefined, path);
        if (request.method === "POST") return loginHandler(request, cookieHeader);
      }

      if (path === "/logout" && request.method === "POST") {
        return logoutHandler(cookieHeader);
      }

      if (path === "/account" && request.method === "GET") {
        return accountPage(cookieHeader, path, url.searchParams);
      }

      if (path === "/billing/checkout" && request.method === "GET") {
        return checkoutRedirect(cookieHeader, url.searchParams);
      }

      if (path === "/billing/portal" && request.method === "GET") {
        return portalRedirect(cookieHeader);
      }

      if (
        path.startsWith("/account/devices/") &&
        path.endsWith("/revoke") &&
        request.method === "POST"
      ) {
        const deviceId = routeSegment(path, 3);
        if (deviceId) {
          return revokeDeviceHandler(cookieHeader, deviceId);
        }
      }

      if (
        path.startsWith("/account/memory/") &&
        path.endsWith("/delete") &&
        request.method === "POST"
      ) {
        const memoryId = routeSegment(path, 3);
        if (memoryId) {
          return deleteMemoryHandler(cookieHeader, memoryId);
        }
      }

      if (path === "/download" && request.method === "GET") {
        return downloadPage();
      }

      if (path === "/download/tabb.dmg" && request.method === "GET") {
        return redirect(macDownloadUrl);
      }

      if (path === "/download/latest.json" && request.method === "GET") {
        return json({
          version: latestVersion,
          url: macDownloadUrl,
          notes: "",
        });
      }

      return html(layout("Not found", `<h1>Not found</h1><p>The page <code>${escapeHtml(path)}</code> does not exist.</p>`), 404);
    },
  };
}

export type WebApp = ReturnType<typeof createWebApp>;
