export const isAllowedExternalUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hostname !== ""
    );
  } catch {
    return false;
  }
};

export const isSameDocumentNavigation = (
  currentUrl: string,
  targetUrl: string,
): boolean => targetUrl === currentUrl;

/** A web link that may open in the system browser: http or https, a host, no embedded credentials. */
export const isSystemBrowserUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl);
    return (url.protocol === "https:" || url.protocol === "http:") && url.username === "" && url.password === "" && url.hostname !== "";
  } catch {
    return false;
  }
};

/**
 * Cmd+click (Ctrl+click on Linux and Windows) and a middle click on a link arrive as a `background-tab` window request.
 * Those links open in the system browser instead of the app's browser panel.
 */
export const opensInSystemBrowser = (disposition: string): boolean => disposition === "background-tab";
