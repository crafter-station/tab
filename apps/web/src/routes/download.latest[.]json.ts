import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeConfig } from "../lib/runtime.server.ts";
import { downloadMetadata } from "../lib/download.ts";

export const Route = createFileRoute("/download/latest.json")({
  server: {
    handlers: {
      GET: () => {
        return downloadMetadata(getRuntimeConfig());
      },
    },
  },
});
