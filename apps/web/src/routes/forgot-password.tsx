import { createRoute } from "@tanstack/react-router";
import { ForgotPasswordPage } from "../components/web-pages.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "forgot-password", component: ForgotPasswordPage });
