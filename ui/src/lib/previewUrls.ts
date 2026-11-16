// Object URLs for the Storage preview. Fetches may overlap and resolve out of order: only the
// latest one started may show its blob, and every URL created here is revoked exactly once
// (when a later preview replaces or clears it, or on `dispose`).

export type PreviewUrls = {
  /** Starts a fetch; the token says whether it is still the latest when it resolves. */
  begin: () => number;
  /**
   * The URL to show for this fetch's blob, or null when a newer fetch began (none is created and
   * the shown one stays). A null blob (a text or failed fetch) only clears the shown URL.
   */
  adopt: (token: number, blob: Blob | null) => string | null;
  /** Revokes the URL shown now and refuses every later adopt. */
  dispose: () => void;
};

export const createPreviewUrls = (
  urls: { create: (blob: Blob) => string; revoke: (url: string) => void } = {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
  },
): PreviewUrls => {
  let latest = 0;
  let current: string | null = null;
  let disposed = false;
  const release = () => {
    if (current !== null) urls.revoke(current);
    current = null;
  };
  return {
    begin: () => (latest += 1),
    adopt: (token, blob) => {
      if (disposed || token !== latest) return null;
      release();
      if (blob === null) return null;
      current = urls.create(blob);
      return current;
    },
    dispose: () => {
      disposed = true;
      release();
    },
  };
};
