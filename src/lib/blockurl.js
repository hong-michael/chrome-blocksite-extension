// The block page URL carries the original URL in its fragment: blocked.html#<original-url>.
// DNR's regexSubstitution produces the same shape (see dnr.js).

export const BLOCK_PAGE_PATH = 'pages/blocked/blocked.html';

export function blockPageBase() {
  return chrome.runtime.getURL(BLOCK_PAGE_PATH);
}

export function buildBlockUrl(base, originalUrl) {
  return `${base}#${originalUrl}`;
}

export function isBlockPageUrl(url, base) {
  return typeof url === 'string' && url.startsWith(base);
}

/** Extract the original URL from a block page URL (or its hash). */
export function originalUrlFrom(urlOrHash) {
  const i = urlOrHash.indexOf('#');
  const raw = i >= 0 ? urlOrHash.slice(i + 1) : urlOrHash;
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    const decoded = decodeURIComponent(raw);
    return /^https?:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
