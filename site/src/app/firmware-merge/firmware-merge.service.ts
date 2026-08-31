import { Injectable, computed, signal } from '@angular/core';
import { createSHA256, type IHasher } from 'hash-wasm';
import { getMergedFileName } from './merge-command';
import { FirmwareMergeRequest, FirmwareMergeTask, IDLE_MERGE_TASK } from './firmware-merge.types';

interface SavePickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface SavePickerOptions {
  suggestedName: string;
  types: SavePickerType[];
}

interface MergeWritableFileStream {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

interface MergeFileHandle {
  createWritable(): Promise<MergeWritableFileStream>;
}

type ShowSaveFilePicker = (options: SavePickerOptions) => Promise<MergeFileHandle>;

interface WindowWithSavePicker extends Window {
  showSaveFilePicker?: ShowSaveFilePicker;
}

const TERMINAL_STATES = new Set<FirmwareMergeTask['status']>(['idle', 'done', 'done-unchecked', 'error', 'cancelled']);

@Injectable({ providedIn: 'root' })
export class FirmwareMergeService {
  readonly task = signal<FirmwareMergeTask>({ ...IDLE_MERGE_TASK });
  readonly isActive = computed(() => !TERMINAL_STATES.has(this.task().status));
  readonly supportsFileSystemAccess = this.getSaveFilePicker() !== null;

  private abortController: AbortController | null = null;
  private writable: MergeWritableFileStream | null = null;

  async start(request: FirmwareMergeRequest): Promise<void> {
    if (this.isActive()) {
      this.patchTask({ message: 'Another download is already in progress.' });
      return;
    }

    const fileName = getMergedFileName(request.urls);
    const savePicker = this.getSaveFilePicker();
    if (!savePicker) {
      this.startNativeDownload(request, fileName);
      return;
    }

    const estimatedSize = this.formatMaybeSize(null);
    if (!window.confirm(`This file may be multiple gigabytes${estimatedSize}. Continue?`)) return;

    this.task.set({
      ...IDLE_MERGE_TASK,
      status: 'preparing',
      fileName,
      message: 'Preparing download…',
      expectedSha256: request.expectedSha256,
    });

    let shouldAbortWritable = false;
    try {
      const handle = await savePicker({
        suggestedName: fileName,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
      });
      this.writable = await handle.createWritable();
      shouldAbortWritable = true;

      this.abortController = new AbortController();
      const response = await fetch(this.buildApiUrl(request), { signal: this.abortController.signal });
      if (!response.ok) throw new Error(`Merge API returned HTTP ${response.status}`);
      if (!response.body) throw new Error('Merge API did not return a response stream');

      const totalBytes = this.headerNumber(response.headers, 'content-length') ?? this.headerNumber(response.headers, 'x-expected-size');
      const expectedSha256 = request.expectedSha256 ?? response.headers.get('x-expected-sha256');
      const hasher = expectedSha256 ? await createSHA256() : null;

      this.patchTask({
        status: 'downloading',
        message: 'Downloading full image…',
        totalBytes,
        expectedSha256,
      });

      await this.pipeResponse(response, hasher);
      this.patchTask({ status: 'verifying', message: expectedSha256 ? 'Verifying SHA-256…' : 'Finishing download…', progressPercent: 100 });
      await this.writable.close();
      shouldAbortWritable = false;

      const actualSha256 = hasher?.digest('hex') ?? null;
      if (expectedSha256 && actualSha256 !== expectedSha256) {
        this.patchTask({
          status: 'error',
          message: 'SHA-256 verification failed.',
          actualSha256,
          error: 'The merged file checksum did not match the expected SHA-256.',
        });
        return;
      }

      this.patchTask({
        status: expectedSha256 ? 'done' : 'done-unchecked',
        message: expectedSha256 ? 'Saved and verified.' : 'Saved. No checksum was available for browser verification.',
        actualSha256,
        progressPercent: 100,
      });
    } catch (error) {
      if (this.isAbortError(error)) {
        this.patchTask({ status: 'cancelled', message: 'Download cancelled.', error: null });
      } else {
        this.patchTask({
          status: 'error',
          message: 'Merge download failed. Use individual parts below.',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (shouldAbortWritable && this.writable) {
        await this.writable.abort(error).catch(() => undefined);
      }
    } finally {
      this.abortController = null;
      this.writable = null;
    }
  }

  cancel(): void {
    this.abortController?.abort();
    if (this.writable) void this.writable.abort('cancelled').catch(() => undefined);
    if (this.isActive()) {
      this.patchTask({ status: 'cancelled', message: 'Download cancelled.', error: null });
    }
  }

  clear(): void {
    if (!this.isActive()) this.task.set({ ...IDLE_MERGE_TASK });
  }

  buildApiUrl(request: FirmwareMergeRequest): string {
    const params = new URLSearchParams({
      device: request.device,
      type: request.type,
      buildId: request.buildId,
    });
    return `/api/firmware-merge?${params.toString()}`;
  }

  formatBytes(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return 'unknown size';
    if (value < 1024) return `${value} B`;
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let size = value / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unit]}`;
  }

  private async pipeResponse(response: Response, hasher: IHasher | null): Promise<void> {
    if (!response.body || !this.writable) throw new Error('Stream is not ready');
    const reader = response.body.getReader();
    let bytesReceived = 0;
    let lastBytes = 0;
    let lastTime = performance.now();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        hasher?.update(value);
        await this.writable.write(value);
        bytesReceived += value.byteLength;

        const now = performance.now();
        const elapsed = now - lastTime;
        const totalBytes = this.task().totalBytes;
        if (elapsed >= 500 || (totalBytes !== null && bytesReceived >= totalBytes)) {
          const speedBytesPerSecond = Math.round(((bytesReceived - lastBytes) * 1000) / Math.max(elapsed, 1));
          this.patchTask({
            bytesReceived,
            speedBytesPerSecond,
            progressPercent: totalBytes && totalBytes > 0 ? Math.min(100, (bytesReceived / totalBytes) * 100) : null,
          });
          lastBytes = bytesReceived;
          lastTime = now;
        }
      }
      this.patchTask({ bytesReceived });
    } finally {
      reader.releaseLock();
    }
  }

  private startNativeDownload(request: FirmwareMergeRequest, fileName: string): void {
    window.location.assign(this.buildApiUrl(request));
    this.task.set({
      ...IDLE_MERGE_TASK,
      status: 'done-unchecked',
      fileName,
      message: 'Download started in the browser download manager. In-browser SHA-256 verification is unavailable here.',
      expectedSha256: request.expectedSha256,
    });
  }

  private getSaveFilePicker(): ShowSaveFilePicker | null {
    const picker = (window as WindowWithSavePicker).showSaveFilePicker;
    return typeof picker === 'function' ? picker.bind(window) : null;
  }

  private headerNumber(headers: Headers, name: string): number | null {
    const value = headers.get(name);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  private patchTask(patch: Partial<FirmwareMergeTask>): void {
    this.task.update(task => ({ ...task, ...patch }));
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  private formatMaybeSize(size: number | null): string {
    return size === null ? '' : ` (${this.formatBytes(size)})`;
  }
}
