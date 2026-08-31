import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FirmwareMergeService } from './firmware-merge.service';

@Component({
  selector: 'app-merge-task-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './merge-task-card.component.html',
  styleUrl: './merge-task-card.component.css',
})
export class MergeTaskCardComponent {
  readonly downloader = inject(FirmwareMergeService);

  progressValue(): number {
    return Math.round(this.downloader.task().progressPercent ?? 0);
  }

  isVisible(): boolean {
    return this.downloader.task().status !== 'idle';
  }

  canCancel(): boolean {
    const status = this.downloader.task().status;
    return status === 'preparing' || status === 'downloading' || status === 'verifying';
  }

  canClear(): boolean {
    const status = this.downloader.task().status;
    return status === 'done' || status === 'done-unchecked' || status === 'error' || status === 'cancelled';
  }

  statusClass(): string {
    return 'state-' + this.downloader.task().status;
  }
}
