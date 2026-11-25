import { Component, OnInit, OnDestroy, HostListener, signal, computed, effect, afterNextRender, Injector, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { DEVICE_RELEASE_DATES, releaseDateKey } from './device-release-dates';
import { buildBashMergeCommand, buildPowerShellMergeCommand, getMergedFileName } from './firmware-merge/merge-command';

type FirmwareType = 'phone-factory' | 'phone-ota' | 'watch-factory' | 'watch-ota';

interface FirmwareCategory {
  value: FirmwareType;
  label: string;
  isWatch: boolean;
  dataKey: 'factory' | 'ota';
}

interface PageCopy {
  crumb: string;
  h1: string;
  title: string;
  intro: string[];
  note: string;
  warning: string[];
  googleHref: string;
  googleLabel: string;
}

const FIRMWARE_CATEGORIES: ReadonlyArray<FirmwareCategory> = [
  { value: 'phone-factory', label: 'Factory images',              isWatch: false, dataKey: 'factory' },
  { value: 'phone-ota',     label: 'Full OTA images',             isWatch: false, dataKey: 'ota'     },
  { value: 'watch-factory', label: 'Pixel Watch factory images',  isWatch: true,  dataKey: 'factory' },
  { value: 'watch-ota',     label: 'Pixel Watch full OTA images', isWatch: true,  dataKey: 'ota'     },
];

const PAGE_COPY: Readonly<Record<FirmwareType, PageCopy>> = {
  'phone-factory': {
    crumb: 'Factory images',
    h1: 'Factory images for Nexus and Pixel devices',
    title: 'Factory images for Nexus and Pixel devices | Firmware Archive',
    intro: [
      'This archive mirrors the binary image files that restore a Nexus or Pixel device to its original factory firmware. They are useful if you have flashed custom builds and want to return the device to its factory state.',
      'It is usually easier and safer to sideload the full OTA image instead.',
      'If you do use a factory image, make sure you relock the bootloader when the process is complete.',
      'These files are published by Google for use only on your personal Nexus or Pixel device. They may not be disassembled, decompiled, reverse engineered, modified or redistributed except as the license terms that came with your device allow.',
    ],
    note: 'The security patch level (SPL) date of a build can differ from the date it was published. Per-build SPL dates are listed on Google\'s build number reference.',
    warning: [
      'Installing a factory image erases all data from the device, and unlocking the bootloader makes your device less secure.',
      'In most cases you can sideload the full OTA image instead. That requires no data wipe and no bootloader unlock.',
    ],
    googleHref: 'https://developers.google.com/android/images',
    googleLabel: 'Google\'s factory images page',
  },
  'phone-ota': {
    crumb: 'Full OTA images',
    h1: 'Full OTA images for Nexus and Pixel devices',
    title: 'Full OTA images for Nexus and Pixel devices | Firmware Archive',
    intro: [
      'This archive mirrors the full OTA images Google publishes for Nexus and Pixel devices.',
      'Sideloading a full OTA image is typically easier and safer than flashing a factory image: it does not require a data wipe and does not require the bootloader to be unlocked.',
      'Full OTA images can recover a device that will not boot, or move it to a newer build without waiting for the staggered over-the-air rollout.',
    ],
    note: 'The security patch level (SPL) date of a build can differ from the date it was published. Per-build SPL dates are listed on Google\'s build number reference.',
    warning: [
      'Sideloading does not erase your data, but back up anything you cannot afford to lose before you start.',
      'Do not interrupt the update or power off the device while it is being applied.',
    ],
    googleHref: 'https://developers.google.com/android/ota',
    googleLabel: 'Google\'s full OTA images page',
  },
  'watch-factory': {
    crumb: 'Pixel Watch factory images',
    h1: 'Factory images for Google Pixel Watch devices',
    title: 'Factory images for Google Pixel Watch devices | Firmware Archive',
    intro: [
      'This archive mirrors the factory images Google publishes for Google Pixel Watch devices.',
      'These images restore a watch to its original firmware after a custom build has been flashed.',
      'For the phone and tablet equivalents, use the Nexus and Pixel factory images.',
    ],
    note: 'The security patch level (SPL) date of a build can differ from the date it was published. Per-build SPL dates are listed on Google\'s build number reference.',
    warning: [
      'Installing a factory image erases all data from the watch, and unlocking the bootloader makes the device less secure.',
      'In most cases, sideloading the full OTA image is the safer option.',
    ],
    googleHref: 'https://developers.google.com/android/images-watch',
    googleLabel: 'Google\'s Pixel Watch factory images page',
  },
  'watch-ota': {
    crumb: 'Pixel Watch full OTA images',
    h1: 'Full OTA images for Google Pixel Watch devices',
    title: 'Full OTA images for Google Pixel Watch devices | Firmware Archive',
    intro: [
      'This archive mirrors the full OTA images Google publishes for Google Pixel Watch devices.',
      'Sideloading a full OTA image is typically easier and safer than flashing a factory image, and it does not require a data wipe.',
    ],
    note: 'The security patch level (SPL) date of a build can differ from the date it was published. Per-build SPL dates are listed on Google\'s build number reference.',
    warning: [
      'Back up anything you cannot afford to lose before you start.',
      'Do not interrupt the update or power off the watch while it is being applied.',
    ],
    googleHref: 'https://developers.google.com/android/ota-watch',
    googleLabel: 'Google\'s Pixel Watch full OTA images page',
  },
};

const VALID_TYPES = new Set<string>(FIRMWARE_CATEGORIES.map(c => c.value));

const DOWNLOAD_PROXY_PATH = '/api/firmware-download';

// Schema v1 entries are length-2; schema v2 entries are length-4.
type LegacyFwEntry   = [string, string | string[]];
type EnrichedFwEntry = [string, string | string[], string | null, string | null];
type FwEntry = LegacyFwEntry | EnrichedFwEntry;

interface DeviceEntry {
  name: string;
  watch?: boolean;
  factory: EnrichedFwEntry[];
  ota: EnrichedFwEntry[];
}

interface DataJson {
  schemaVersion: number;
  generatedAt: string;
  sourceRevision: string;
  counts: { devices: number; factory: number; ota: number };
  devices: Record<string, DeviceEntry>;
}

interface VisibleDevice {
  codename: string;
  device: DeviceEntry;
  entries: EnrichedFwEntry[];
}

function normEntry(e: FwEntry): EnrichedFwEntry {
  return [e[0], e[1], (e as EnrichedFwEntry)[2] ?? null, (e as EnrichedFwEntry)[3] ?? null];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly firmwareCategories = FIRMWARE_CATEGORIES;

  // Required to pass to afterNextRender() when called inside an effect callback
  // (effect callbacks run reactively, outside injection context; afterNextRender
  // calls assertInInjectionContext when options are omitted - Angular 17.3.12 core.mjs:15193)
  private readonly injector = inject(Injector);

  data          = signal<DataJson | null>(null);
  firmwareType  = signal<FirmwareType>('phone-factory');
  activeDevice  = signal<string | null>(null);
  copiedCommand = signal<string | null>(null);
  searchQuery   = signal<string>('');
  navOpen       = signal<boolean>(false);

  readonly copy = computed<PageCopy>(() => PAGE_COPY[this.firmwareType()]);

  private get activeCategory(): FirmwareCategory {
    return FIRMWARE_CATEGORIES.find(c => c.value === this.firmwareType())!;
  }

  // What the article and the on-this-page rail actually render.
  visibleDevices = computed<VisibleDevice[]>(() => {
    const d = this.data();
    if (!d) return [];
    const cat = this.activeCategory;
    const q = this.searchQuery().trim().toLowerCase();

    return Object.entries(d.devices)
      .filter(([, dev]) =>
        (dev.watch === true) === cat.isWatch &&
        dev[cat.dataKey].length > 0
      )
      .map(([codename, device]) => {
        const entries = device[cat.dataKey];
        if (!q) return { codename, device, entries };
        const deviceHit =
          codename.toLowerCase().includes(q) || device.name.toLowerCase().includes(q);
        return {
          codename,
          device,
          entries: deviceHit ? entries : entries.filter(e => e[0].toLowerCase().includes(q)),
        };
      })
      .filter(v => v.entries.length > 0)
      .sort((a, b) => this.compareDevices([a.codename, a.device], [b.codename, b.device]));
  });

  matchSummary = computed(() => {
    const devices = this.visibleDevices();
    return {
      devices: devices.length,
      builds: devices.reduce((n, d) => n + d.entries.length, 0),
    };
  });

  searchSummaryText = computed(() => {
    const q = this.searchQuery().trim();
    const { devices, builds } = this.matchSummary();
    if (!q) return '';
    if (devices === 0) return `No builds match “${q}”.`;
    return `Showing ${builds} ${builds === 1 ? 'build' : 'builds'} across ${devices} ${devices === 1 ? 'device' : 'devices'} for “${q}”.`;
  });

  private observer: IntersectionObserver | null = null;

  constructor(private http: HttpClient, private titleService: Title) {
    effect(() => {
      this.visibleDevices(); // establish reactive dependency
      afterNextRender(() => this.rebuildObserver(), { injector: this.injector });
    });
  }

  ngOnInit(): void {
    const typeParam = new URLSearchParams(window.location.search).get('type');
    if (typeParam && VALID_TYPES.has(typeParam)) {
      this.firmwareType.set(typeParam as FirmwareType);
    }
    this.applyTitle();

    this.http.get<{
      schemaVersion: number;
      generatedAt: string;
      sourceRevision: string;
      counts: { devices: number; factory: number; ota: number };
      devices: Record<string, { name: string; watch?: boolean; factory: FwEntry[]; ota: FwEntry[] }>;
    }>('./assets/data.json').subscribe({
      next: raw => {
        const devices: Record<string, DeviceEntry> = {};
        for (const [code, dev] of Object.entries(raw.devices)) {
          devices[code] = {
            name: dev.name,
            watch: dev.watch === true,
            factory: dev.factory.map(normEntry),
            ota:     dev.ota.map(normEntry),
          };
        }
        this.data.set({ ...raw, devices });
      },
      error: () => console.error('Failed to load data.json'),
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  setFirmwareType(type: FirmwareType): void {
    if (this.firmwareType() === type) return;
    this.firmwareType.set(type);
    this.searchQuery.set('');
    this.navOpen.set(false);
    history.replaceState(null, '', '?type=' + type);
    this.applyTitle();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  onNavClick(event: MouseEvent, type: FirmwareType): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.setFirmwareType(type);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.navOpen()) this.closeNav();
  }

  toggleNav(): void {
    this.navOpen.update(open => !open);
  }

  closeNav(): void {
    this.navOpen.set(false);
  }

  onSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  scrollToDevice(codename: string): void {
    document.getElementById(codename)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  isSharded(entry: EnrichedFwEntry): boolean {
    return Array.isArray(entry[1]);
  }

  getUrls(entry: EnrichedFwEntry): string[] {
    return Array.isArray(entry[1]) ? entry[1] : [entry[1]];
  }

  getFilename(url: string): string {
    return url.split('/').pop() ?? url;
  }

  getChecksum(entry: EnrichedFwEntry): string | null {
    return entry[2];
  }

  getFlashUrl(entry: EnrichedFwEntry): string | null {
    return entry[3];
  }

  // Sharded entries download the unsplit Original image through the proxy.
  getProxiedDownloadUrl(entry: EnrichedFwEntry): string | null {
    const filename = getMergedFileName(this.getUrls(entry));
    if (!filename.endsWith('.zip')) return null;
    return `${DOWNLOAD_PROXY_PATH}?file=${encodeURIComponent(filename)}`;
  }

  // Primary Download link: the Original image name, as on the reference page.
  getDownloadUrl(entry: EnrichedFwEntry): string | null {
    return this.isSharded(entry)
      ? this.getProxiedDownloadUrl(entry)
      : (this.getUrls(entry)[0] ?? null);
  }

  getDownloadLabel(entry: EnrichedFwEntry): string {
    return this.isSharded(entry)
      ? getMergedFileName(this.getUrls(entry))
      : this.getFilename(this.getUrls(entry)[0] ?? '');
  }

  getBashMergeCommand(entry: EnrichedFwEntry): string {
    return buildBashMergeCommand(this.getUrls(entry));
  }

  getPowerShellMergeCommand(entry: EnrichedFwEntry): string {
    return buildPowerShellMergeCommand(this.getUrls(entry));
  }

  async copyMergeCommand(entry: EnrichedFwEntry, shell: 'bash' | 'powershell'): Promise<void> {
    const command = shell === 'bash' ? this.getBashMergeCommand(entry) : this.getPowerShellMergeCommand(entry);
    try {
      await navigator.clipboard.writeText(command);
      const key = `${entry[0]}:${shell}`;
      this.copiedCommand.set(key);
      window.setTimeout(() => {
        if (this.copiedCommand() === key) this.copiedCommand.set(null);
      }, 1500);
    } catch {
      // Clipboard may fail when the tab is not focused or permission is denied.
    }
  }

  copiedCommandKey(entry: EnrichedFwEntry, shell: 'bash' | 'powershell'): string {
    return `${entry[0]}:${shell}`;
  }

  private applyTitle(): void {
    this.titleService.setTitle(PAGE_COPY[this.firmwareType()].title);
  }

  private compareDevices(a: [string, DeviceEntry], b: [string, DeviceEntry]): number {
    const da = this.releaseKey(a[0], a[1]);
    const db = this.releaseKey(b[0], b[1]);
    if (da !== db) return db - da;
    return a[1].name.localeCompare(b[1].name, undefined, { numeric: true });
  }

  private rebuildObserver(): void {
    this.observer?.disconnect();
    this.activeDevice.set(null);

    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('#center-content .device-section')
    );
    if (sections.length === 0) return;

    const validIds = new Set(this.visibleDevices().map(d => d.codename));

    this.observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = visible[0].target.id;
          if (validIds.has(id)) this.activeDevice.set(id);
        }
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );

    sections.forEach(el => this.observer!.observe(el));
  }

  private releaseKey(codename: string, dev: DeviceEntry): number {
    const d = DEVICE_RELEASE_DATES[codename];
    if (d) return releaseDateKey(d);
    const all = [...dev.factory, ...dev.ota];
    let best = Infinity;
    for (const e of all) {
      const parts = e[0].split('.');
      if (parts.length >= 2 && /^\d{6}$/.test(parts[1])) {
        const yyyymm = parseInt('20' + parts[1].slice(0, 4), 10);
        if (yyyymm < best) best = yyyymm;
      }
    }
    return best === Infinity ? 0 : best;
  }
}