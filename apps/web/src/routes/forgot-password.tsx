import { createRoute } from "@tanstack/react-router";
import { ForgotPasswordPage } from "../components/pages/auth.tsx";
import { rootRoute } from "./__root.tsx";

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "forgot-password", component: ForgotPasswordPage });
