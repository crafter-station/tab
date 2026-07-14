import { createFileRoute } from "@tanstack/react-router";
import { DownloadPage } from "../components/pages/marketing.tsx";
import { getDownloadInfo } from "../lib/download.functions.ts";

function DownloadRoute() {
  const info = Route.useLoaderData();
  return <DownloadPage latestVersion={info.version} />;
}

export const Route = createFileRoute("/download")({
  loader: () => getDownloadInfo(),
  component: DownloadRoute,
  head: () => ({ meta: [{ title: "Tab Download" }] }),
});
