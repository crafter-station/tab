import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeConfig } from "../lib/runtime.server.ts";
import { downloadRedirect } from "../lib/download.ts";

export const Route = createFileRoute("/download/tab.dmg")({
  server: {
    handlers: {
      GET: () => {
        return downloadRedirect(getRuntimeConfig());
      },
    },
  },
});
