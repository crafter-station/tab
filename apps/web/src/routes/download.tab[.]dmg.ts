import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeConfig } from "../lib/runtime.server.ts";
import { downloadRedirect } from "../lib/download.ts";

export const Route = createFileRoute("/download/tab.dmg")({
  server: {
    handlers: {
      GET: () => {
        const config = getRuntimeConfig();
        return downloadRedirect({ version: config.TAB_DESKTOP_LATEST_VERSION, url: config.TAB_MAC_DOWNLOAD_URL, notes: "" });
      },
    },
  },
});
