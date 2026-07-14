import { createServerFn } from "@tanstack/react-start";
import { getRequestSession } from "./session.server.ts";

export const getViewer = createServerFn({ method: "GET" }).handler(() => getRequestSession(false));
