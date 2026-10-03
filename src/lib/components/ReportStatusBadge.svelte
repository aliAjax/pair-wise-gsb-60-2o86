<script lang="ts">
  import {
    reportStatusLabels,
    type ReportStatus
  } from '$lib/models/regulatory';

  export let status: ReportStatus;

  const tone: Record<ReportStatus, string> = {
    pending_backfill: 'badge variant-soft-warning',
    draft: 'badge variant-soft-surface',
    submission_failed: 'badge variant-soft-error',
    submitted: 'badge variant-soft-primary',
    acknowledged: 'badge variant-soft-success',
    invalidated: 'badge variant-soft-error'
  };
</script>

<span class={tone[status]}>{reportStatusLabels[status]}</span>
