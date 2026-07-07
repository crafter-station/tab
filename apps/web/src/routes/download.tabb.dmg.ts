import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "download/tabb.dmg" });
