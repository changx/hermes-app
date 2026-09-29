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