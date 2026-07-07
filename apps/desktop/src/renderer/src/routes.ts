export type ControlAppRoute = "settings" | "onboarding" | "sign-in";

const routes = new Set<ControlAppRoute>(["settings", "onboarding", "sign-in"]);

export function getAppRoute(hash = window.location.hash): ControlAppRoute {
  const route = hash.replace(/^#/, "");
  return routes.has(route as ControlAppRoute) ? (route as ControlAppRoute) : "settings";
}
