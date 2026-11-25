# Firmware Archive

An archive of Google Pixel and Nexus firmware images plus a browser that links each build to a downloadable file.

## Language

**Firmware entry**:
One build of one firmware type for one device, identified by codename, firmware type and build ID.
_Avoid_: version, release, ROM

**Firmware type**:
`factory` for factory images, `ota` for full OTA images.
_Avoid_: category, channel

**Codename**:
Google's internal device name, such as `tokay`. Used in slugs, URLs and release tags.
_Avoid_: device ID, model number

**Marketing name**:
The public product name, such as `Pixel 9`. The browser shows `Marketing name (codename)`.
_Avoid_: display name, friendly name

**Mirror**:
The GitHub Releases copy of every firmware entry, kept as the archive and as the fallback source.
_Avoid_: backup, cache, storage

**Original image**:
The single, unsplit ZIP that Google publishes on `dl.google.com` for a firmware entry.
_Avoid_: upstream file, source file, raw file

**Watch device**:
A firmware entry whose codename is listed in `WatchDevices.txt`; the browser groups these under the watch tabs.
_Avoid_: wearable, watch model

**Sharded entry**:
A firmware entry whose Mirror copy is split into parts because it exceeds GitHub's per-asset size limit.
_Avoid_: split file, multi-part entry

**Merge**:
Reassembling a sharded entry's parts into one file. A manual recovery path, not the primary download.
_Avoid_: join, combine, reassemble

**Download proxy**:
A same-origin endpoint that streams an Original image from `dl.google.com` to the browser.
_Avoid_: worker, reverse proxy, mirror

**Firmware page**:
One of the four browser views: factory or full OTA, for phones/tablets or for watches. Selected by the `?type=` query parameter.
_Avoid_: category, tab, section

**Reference page**:
The Google developer page whose structure the browser mirrors: book nav, article body, per-device tables, on-this-page rail.
_Avoid_: template, upstream page, original page