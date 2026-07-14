import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeConfig } from "../lib/runtime.server.ts";
import { downloadMetadata } from "../lib/download.ts";

export const Route = createFileRoute("/download/latest.json")({
  server: {
    handlers: {
      GET: () => {
        const config = getRuntimeConfig();
        return downloadMetadata({ version: config.TAB_DESKTOP_LATEST_VERSION, url: config.TAB_MAC_DOWNLOAD_URL, notes: "" });
      },
    },
  },
});
