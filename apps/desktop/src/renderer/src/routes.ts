export type ControlAppRoute = "settings" | "onboarding";

const routes = new Set<ControlAppRoute>(["settings", "onboarding"]);

export function getAppRoute(hash = window.location.hash): ControlAppRoute {
  const route = hash.replace(/^#/, "");
  return routes.has(route as ControlAppRoute) ? (route as ControlAppRoute) : "settings";
}
