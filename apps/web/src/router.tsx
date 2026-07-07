import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen.ts";

export function createAppRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
  });
}

export function getRouter() {
  return createAppRouter();
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
