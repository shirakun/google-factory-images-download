# Build the site after the publisher finishes, not on URL-list pushes

**Status**: accepted

`FactoryImages.txt` / `FullOTAImages.txt` updates used to trigger the site build immediately, while the publisher spent 30-60 minutes splitting and uploading multi-GB assets. `data.json` therefore recorded single-file Release URLs for entries whose mirror only exists as `.partNN`, producing deterministic 404s until some later commit rebuilt the site. The site now deploys from `workflow_run` on "Publish Firmware Orchestrator" completion (master only), and URL-list/metadata pushes no longer trigger it. A build-time check fails the build when any `data.json` URL has no Release asset, including the case where only `<file>.part01` exists.

**Consequences**: site updates trail a publisher run by its duration; code changes still deploy immediately; a publisher that never finishes leaves the previous site live instead of publishing dead links.
