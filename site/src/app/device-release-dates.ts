// Device official release dates, newest → oldest.
// Format: codename → "YYYY-MM" (month precision is sufficient for sort order).
// Source: official Google device announcements — https://store.google.com/gb/category/phones
//         Pixel Watch: https://developers.google.com/android/images-watch
// To add a new device: append its codename and YYYY-MM launch month.

export const DEVICE_RELEASE_DATES: Readonly<Record<string, string>> = {
  'goteria':    '2026-08', // Pixel Watch 5
  'stallion':   '2026-03', // Pixel 10a
  'menari_btwifi': '2025-10', // Pixel Watch 4 (Bluetooth/Wi-Fi)
  'menari_lte': '2025-10', // Pixel Watch 4 (LTE)
  'rango':      '2025-10', // Pixel 10 Pro Fold
  'mustang':    '2025-08', // Pixel 10 Pro XL
  'blazer':     '2025-08', // Pixel 10 Pro
  'frankel':    '2025-08', // Pixel 10
  'tegu':       '2025-03', // Pixel 9a
  'seluna':     '2024-09', // Pixel Watch 3 (LTE)
  'solios':     '2024-09', // Pixel Watch 3 (Bluetooth/Wi-Fi)
  'comet':      '2024-09', // Pixel 9 Pro Fold
  'komodo':     '2024-08', // Pixel 9 Pro XL
  'caiman':     '2024-08', // Pixel 9 Pro
  'tokay':      '2024-08', // Pixel 9
  'akita':      '2024-05', // Pixel 8a
  'husky':      '2023-10', // Pixel 8 Pro
  'eos':        '2023-10', // Pixel Watch 2 (LTE)
  'aurora':     '2023-10', // Pixel Watch 2 (Bluetooth/Wi-Fi)
  'shiba':      '2023-10', // Pixel 8
  'felix':      '2023-06', // Pixel Fold
  'tangorpro':  '2023-06', // Pixel Tablet
  'lynx':       '2023-05', // Pixel 7a
  'cheetah':    '2022-10', // Pixel 7 Pro
  'panther':    '2022-10', // Pixel 7
  'r11':        '2022-10', // Pixel Watch (LTE)
  'r11btwifi':  '2022-10', // Pixel Watch (Bluetooth/Wi-Fi)
  'bluejay':    '2022-07', // Pixel 6a
  'raven':      '2021-10', // Pixel 6 Pro
  'oriole':     '2021-10', // Pixel 6
  'barbet':     '2021-08', // Pixel 5a
  'bramble':    '2020-11', // Pixel 4a (5G)
  'redfin':     '2020-10', // Pixel 5
  'sunfish':    '2020-08', // Pixel 4a
  'coral':      '2019-10', // Pixel 4 XL
  'flame':      '2019-10', // Pixel 4
  'bonito':     '2019-05', // Pixel 3a XL
  'sargo':      '2019-05', // Pixel 3a
  'crosshatch': '2018-10', // Pixel 3 XL
  'blueline':   '2018-10', // Pixel 3
  'taimen':     '2017-10', // Pixel 2 XL
  'walleye':    '2017-10', // Pixel 2
  'marlin':     '2016-10', // Pixel XL
  'sailfish':   '2016-10', // Pixel
  'ryu':        '2015-12', // Pixel C
  'angler':     '2015-09', // Nexus 6P
  'bullhead':   '2015-09', // Nexus 5X
  'fugu':       '2014-11', // Nexus Player
  'volantisg':  '2014-11', // Nexus 9 (LTE)
  'volantis':   '2014-11', // Nexus 9
  'shamu':      '2014-11', // Nexus 6
  'hammerhead': '2013-10', // Nexus 5
  'razorg':     '2013-07', // Nexus 7 (2013 LTE)
  'razor':      '2013-07', // Nexus 7 (2013)
  'mantaray':   '2012-11', // Nexus 10
  'occam':      '2012-11', // Nexus 4
  'nakasig':    '2012-07', // Nexus 7 (2012 Mobile)
  'nakasi':     '2012-07', // Nexus 7 (2012)
  'tungsten':   '2012-07', // Nexus Q (announced; never publicly sold)
  'mysid':      '2011-11', // Galaxy Nexus
  'mysidspr':   '2011-11', // Galaxy Nexus (Sprint)
  'takju':      '2011-11', // Galaxy Nexus
  'yakju':      '2011-11', // Galaxy Nexus
  'soju':       '2010-12', // Nexus S
  'sojua':      '2010-12', // Nexus S (AT&T)
  'sojuk':      '2010-12', // Nexus S (Korea)
  'sojus':      '2010-12', // Nexus S (Sprint)
};

/** Convert "YYYY-MM" to a numeric sort key (e.g. "2026-03" → 202603). Returns 0 for malformed input. */
export function releaseDateKey(yyyyMm: string): number {
  const n = Number(yyyyMm.replace('-', ''));
  return Number.isFinite(n) ? n : 0;
}
