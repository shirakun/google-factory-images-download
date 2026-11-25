// .github/scripts/scrape-metadata.mjs
// Turns one Google Android developer page's HTML into
// { [sourceUrl: string]: { checksum: string|null, flashUrl: string|null } }.
//
// Row shapes observed on 2026-07-30:
//   Factory (with Flash)  : Version | Flash anchor | Download anchor | SHA-256
//   Factory (no Flash)    : Version | Download anchor | SHA-256
//   OTA (phone + watch)   : Version | Download anchor | SHA-256
//
// Parse strategy: locate each <tr> containing a dl.google.com firmware anchor;
// extract fields by anchor hostname, not by column index, to handle both row shapes.

const DL_HREF_RE  = /href="(https:\/\/dl\.google\.com\/dl\/android\/aosp\/[^"]+\.zip)"/;
const FLASH_HREF_RE = /href="(https:\/\/flash\.android\.com\/[^"]+)"/;
const SHA256_RE   = /\b([0-9a-f]{64})\b/i;

export function parseRows(html) {
  const result = {};
  // Match each <tr ...>...</tr> block (non-greedy, multi-line)
  const trRe = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
  for (const m of html.matchAll(trRe)) {
    const row = m[0];
    const dlMatch = row.match(DL_HREF_RE);
    if (!dlMatch) continue;

    const sourceUrl = dlMatch[1];
    const flashMatch = row.match(FLASH_HREF_RE);
    const sha256Match = row.match(SHA256_RE);

    result[sourceUrl] = {
      checksum: sha256Match ? sha256Match[1].toLowerCase() : null,
      flashUrl: flashMatch ? flashMatch[1] : null,
    };
  }
  return result;
}
