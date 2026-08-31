export function getPartUrls(urls: string[]): string[] {
  return urls.filter(url => !url.endsWith('.sha256'));
}

export function getManifestUrl(urls: string[]): string | null {
  const last = urls[urls.length - 1];
  return last?.endsWith('.sha256') ? last : null;
}

export function getMergedFileName(urls: string[]): string {
  const firstPart = getPartUrls(urls)[0] ?? urls[0] ?? 'firmware.zip';
  const fileName = firstPart.split('/').pop() ?? firstPart;
  return fileName.replace(/\.part\d+$/, '');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(value: string): string {
  return `"${value.replace(/`/g, '``').replace(/"/g, '`"')}"`;
}

export function buildBashMergeCommand(urls: string[]): string {
  const fileName = getMergedFileName(urls);
  const partPattern = `${shellQuote(fileName)}.part*`;
  const manifest = getManifestUrl(urls);
  const verify = manifest ? `\nsha256sum --check ${shellQuote(manifest.split('/').pop() ?? `${fileName}.sha256`)}` : '';
  return `cat ${partPattern} > ${shellQuote(fileName)}${verify}`;
}

export function buildPowerShellMergeCommand(urls: string[]): string {
  const fileName = getMergedFileName(urls);
  const parts = getPartUrls(urls).map(url => powershellQuote(url.split('/').pop() ?? url));
  const copy = `cmd /c copy /b ${parts.join('+')} ${powershellQuote(fileName)}`;
  return `${copy}\nGet-FileHash -Algorithm SHA256 ${powershellQuote(fileName)}`;
}
