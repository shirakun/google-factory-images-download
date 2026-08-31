export type FirmwareMergeKind = 'factory' | 'ota';

export type FirmwareMergeStatus =
  | 'idle'
  | 'preparing'
  | 'downloading'
  | 'verifying'
  | 'done'
  | 'done-unchecked'
  | 'error'
  | 'cancelled';

export interface FirmwareMergeRequest {
  device: string;
  type: FirmwareMergeKind;
  buildId: string;
  urls: string[];
  expectedSha256: string | null;
}

export interface FirmwareMergeTask {
  status: FirmwareMergeStatus;
  fileName: string;
  message: string;
  progressPercent: number | null;
  bytesReceived: number;
  totalBytes: number | null;
  speedBytesPerSecond: number;
  expectedSha256: string | null;
  actualSha256: string | null;
  error: string | null;
}

export const IDLE_MERGE_TASK: FirmwareMergeTask = {
  status: 'idle',
  fileName: '',
  message: '',
  progressPercent: null,
  bytesReceived: 0,
  totalBytes: null,
  speedBytesPerSecond: 0,
  expectedSha256: null,
  actualSha256: null,
  error: null,
};
