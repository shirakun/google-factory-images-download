import { Component, OnInit, OnDestroy, signal, computed, effect, afterNextRender, Injector, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DEVICE_RELEASE_DATES, WATCH_CODENAMES, releaseDateKey } from './device-release-dates';
import { FirmwareMergeService } from './firmware-merge/firmware-merge.service';
import { buildBashMergeCommand, buildPowerShellMergeCommand } from './firmware-merge/merge-command';
import { MergeTaskCardComponent } from './firmware-merge/merge-task-card.component';

// Tasks 1.1 – 1.2
type FirmwareType = 'phone-factory' | 'phone-ota' | 'watch-factory' | 'watch-ota';

interface FirmwareCategory {
  value: FirmwareType;
  label: string;
  isWatch: boolean;
  dataKey: 'factory' | 'ota';
}

const FIRMWARE_CATEGORIES: ReadonlyArray<FirmwareCategory> = [
  { value: 'phone-factory', label: 'Factory Images',       isWatch: false, dataKey: 'factory' },
  { value: 'phone-ota',     label: 'OTA Updates',          isWatch: false, dataKey: 'ota'     },
  { value: 'watch-factory', label: 'Watch Factory Images', isWatch: true,  dataKey: 'factory' },
  { value: 'watch-ota',     label: 'Watch OTA Updates',    isWatch: true,  dataKey: 'ota'     },
];

const VALID_TYPES = new Set<string>(FIRMWARE_CATEGORIES.map(c => c.value));

// Schema v1 entries are length-2; schema v2 entries are length-4.
type LegacyFwEntry   = [string, string | string[]];
type EnrichedFwEntry = [string, string | string[], string | null, string | null];
type FwEntry = LegacyFwEntry | EnrichedFwEntry;

interface DeviceEntry {
  name: string;
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

function normEntry(e: FwEntry): EnrichedFwEntry {
  return [e[0], e[1], (e as EnrichedFwEntry)[2] ?? null, (e as EnrichedFwEntry)[3] ?? null];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MergeTaskCardComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  // Task 1.3 – expose descriptor array to template
  readonly firmwareCategories = FIRMWARE_CATEGORIES;

  // Required to pass to afterNextRender() when called inside an effect callback
  // (effect callbacks run reactively, outside injection context; afterNextRender
  // calls assertInInjectionContext when options are omitted — Angular 17.3.12 core.mjs:15193)
  private readonly injector = inject(Injector);
  readonly mergeDownloader = inject(FirmwareMergeService);

  // Tasks 2.1 – 2.2
  data         = signal<DataJson | null>(null);
  firmwareType = signal<FirmwareType>('phone-factory');
  activeDevice = signal<string | null>(null);
  copiedCommand = signal<string | null>(null);

  private readonly beforeUnloadHandler = (event: BeforeUnloadEvent) => {
    if (!this.mergeDownloader.isActive()) return;
    event.preventDefault();
    event.returnValue = '';
  };

  // Task 2.4 – single source of truth for active category descriptor
  private get activeCategory(): FirmwareCategory {
    return FIRMWARE_CATEGORIES.find(c => c.value === this.firmwareType())!;
  }

  // Task 2.3 – filtered + sorted devices for active firmware type
  filteredDevices = computed(() => {
    const d = this.data();
    if (!d) return [];
    const cat = this.activeCategory;
    return Object.entries(d.devices)
      .filter(([codename, dev]) =>
        WATCH_CODENAMES.has(codename) === cat.isWatch &&
        dev[cat.dataKey].length > 0
      )
      .sort((a, b) => {
        const da = this.releaseKey(a[0], a[1]);
        const db = this.releaseKey(b[0], b[1]);
        if (da !== db) return db - da;
        return a[1].name.localeCompare(b[1].name, undefined, { numeric: true });
      });
  });

  // Task 3.2
  private observer: IntersectionObserver | null = null;

  constructor(private http: HttpClient) {
    // Task 3.5 – rebuild observer after every filteredDevices render cycle
    effect(() => {
      this.filteredDevices(); // establish reactive dependency
      afterNextRender(() => this.rebuildObserver(), { injector: this.injector });
    });
  }

  // Task 2.5
  ngOnInit(): void {
    window.addEventListener('beforeunload', this.beforeUnloadHandler);

    const typeParam = new URLSearchParams(window.location.search).get('type');
    if (typeParam && VALID_TYPES.has(typeParam)) {
      this.firmwareType.set(typeParam as FirmwareType);
    }

    this.http.get<{
      schemaVersion: number;
      generatedAt: string;
      sourceRevision: string;
      counts: { devices: number; factory: number; ota: number };
      devices: Record<string, { name: string; factory: FwEntry[]; ota: FwEntry[] }>;
    }>('./assets/data.json').subscribe({
      next: raw => {
        const devices: Record<string, DeviceEntry> = {};
        for (const [code, dev] of Object.entries(raw.devices)) {
          devices[code] = {
            name: dev.name,
            factory: dev.factory.map(normEntry),
            ota:     dev.ota.map(normEntry),
          };
        }
        this.data.set({ ...raw, devices });
      },
      error: () => console.error('Failed to load data.json'),
    });
  }

  // Task 3.6
  ngOnDestroy(): void {
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    this.observer?.disconnect();
  }

  // Task 3.1
  setFirmwareType(type: FirmwareType): void {
    this.firmwareType.set(type);
    history.replaceState(null, '', '?type=' + type);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // Scroll to a device section without triggering navigation (avoids stripping ?type= from URL)
  scrollToDevice(codename: string): void {
    document.getElementById(codename)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Task 3.7 – single entry-point for template table rows
  getDeviceEntries(dev: DeviceEntry): EnrichedFwEntry[] {
    return dev[this.activeCategory.dataKey];
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

  startMergedDownload(codename: string, entry: EnrichedFwEntry): void {
    if (!this.isSharded(entry)) return;
    void this.mergeDownloader.start({
      device: codename,
      type: this.activeCategory.dataKey,
      buildId: entry[0],
      urls: this.getUrls(entry),
      expectedSha256: this.getChecksum(entry),
    });
  }

  getMergeApiUrl(codename: string, entry: EnrichedFwEntry): string {
    return this.mergeDownloader.buildApiUrl({
      device: codename,
      type: this.activeCategory.dataKey,
      buildId: entry[0],
      urls: this.getUrls(entry),
      expectedSha256: this.getChecksum(entry),
    });
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

  // Task 3.3 – 3.4
  private rebuildObserver(): void {
    this.observer?.disconnect();
    this.activeDevice.set(null);

    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('#center-content .device-section')
    );
    if (sections.length === 0) return;

    // Capture valid IDs at rebuild time to guard stale callbacks (Task 3.4)
    const validIds = new Set(this.filteredDevices().map(([c]) => c));

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
