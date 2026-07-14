import { createServerFn } from "@tanstack/react-start";
import { createDownloadInfo } from "./download.ts";
import { getRuntimeConfig } from "./runtime.server.ts";

export const getDownloadInfo = createServerFn({ method: "GET" }).handler(() => {
  return createDownloadInfo(getRuntimeConfig());
});
