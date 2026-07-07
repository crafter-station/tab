import { createRoute } from "@tanstack/react-router";
import { DownloadPage } from "../components/web-pages.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "download", component: DownloadPage });
