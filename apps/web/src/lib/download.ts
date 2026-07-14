export type DownloadInfo = { version: string; url: string; notes: string };

export function downloadRedirect(info: DownloadInfo): Response {
  return Response.redirect(info.url, 302);
}

export function downloadMetadata(info: DownloadInfo): Response {
  return Response.json(info);
}
