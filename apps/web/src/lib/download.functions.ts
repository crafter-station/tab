import { createServerFn } from "@tanstack/react-start";
import { getRuntimeConfig } from "./runtime.server.ts";

export const getDownloadInfo = createServerFn({ method: "GET" }).handler(() => {
  const config = getRuntimeConfig();
  return { version: config.TAB_DESKTOP_LATEST_VERSION, url: config.TAB_MAC_DOWNLOAD_URL, notes: "" };
});
