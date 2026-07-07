export type AppRoute = "overlay" | "settings" | "onboarding";

const routes = new Set<AppRoute>(["overlay", "settings", "onboarding"]);

export function getAppRoute(hash = window.location.hash): AppRoute {
  const route = hash.replace(/^#/, "");
  return routes.has(route as AppRoute) ? (route as AppRoute) : "overlay";
}
