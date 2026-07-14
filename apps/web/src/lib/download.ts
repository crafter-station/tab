export type DownloadInfo = { version: string; url: string; notes: string };

export type DownloadConfig = {
  readonly TAB_DESKTOP_LATEST_VERSION: string;
  readonly TAB_MAC_DOWNLOAD_URL: string;
};

export function createDownloadInfo(config: DownloadConfig): DownloadInfo {
  return {
    version: config.TAB_DESKTOP_LATEST_VERSION,
    url: config.TAB_MAC_DOWNLOAD_URL,
    notes: "",
  };
}

export function downloadRedirect(config: DownloadConfig): Response {
  return Response.redirect(createDownloadInfo(config).url, 302);
}

export function downloadMetadata(config: DownloadConfig): Response {
  return Response.json(createDownloadInfo(config));
}
