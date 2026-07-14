import { apiSchemas, type ApiClient } from "./api.server.ts";
import { requireSession } from "./session-api.server.ts";

export async function loadDashboardData(request: Request, api: ApiClient, onResponse?: (response: Response) => void) {
  const user = await requireSession(request, api, onResponse);
  if (new URL(request.url).searchParams.get("billing") === "success") {
    const reconciliation = await api.request("/api/billing/reconcile", request, {
      method: "POST",
    });
    onResponse?.(reconciliation);
  }
  const [billingResponse, devicesResponse, memoriesResponse, localActivityResponse] = await Promise.all([
    api.request("/api/billing/status", request),
    api.request("/api/auth/devices", request),
    api.request("/api/account/memory", request),
    api.request("/api/activity/local-suggestions", request),
  ]);
  for (const response of [billingResponse, devicesResponse, memoriesResponse, localActivityResponse]) onResponse?.(response);
  if ([billingResponse, devicesResponse, memoriesResponse, localActivityResponse].some((response) => response.status === 401)) {
    throw new Response(null, { status: 401 });
  }
  const [billing, devices, memories, localSuggestionActivity] = await Promise.all([
    billingResponse.json().then((body) => apiSchemas.billing.parse(body)),
    devicesResponse.json().then((body) => apiSchemas.devices.parse(body)),
    memoriesResponse.json().then((body) => apiSchemas.memories.parse(body)),
    localActivityResponse.json().then((body) => apiSchemas.localActivity.parse(body)),
  ]);
  return {
    user,
    billing: billing.data,
    devices: devices.data.devices,
    memories: memories.data.memories,
    localSuggestionActivity: localSuggestionActivity.data,
  };
}
