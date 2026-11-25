# Proxy sharded downloads instead of merging GitHub parts

**Status**: accepted

Sharded entries exist only because GitHub caps release assets at 2 GB, so the browser had to merge `.partNN` files client-side or through a Pages Function. Google's Original image is a single file, but direct `dl.google.com` downloads are rate limited (429) from some networks. We decided that a sharded entry's "Browser download" link goes through a same-origin Download proxy that streams the Original image from `dl.google.com`; the client-side merge, the merge Function and the shard allowlist are removed. Non-sharded entries keep their GitHub Release links.

**Considered options**: keeping the merge path (still depends on many GitHub requests and does not address rate limiting); pointing at the standalone `workers.dev` proxy (third-party hostname, extra infrastructure to own, CORS); proxying every entry (expands the blast radius for no benefit while GitHub links work).

**Consequences**: sharded downloads now depend on Google plus Cloudflare egress and cannot be resumed from GitHub parts in the browser; "Show individual parts" and the manual merge commands stay as recovery. Because sharded-ness is discovered from the GitHub Releases API at build time, the build now aborts when that API fails instead of publishing links to assets that cannot exist. The proxy accepts any canonical firmware filename, so it is a small open relay limited to `dl.google.com` AOSP paths.
