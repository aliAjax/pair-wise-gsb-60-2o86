<script lang="ts">
  import type { RiskLevel, SignalStatus } from '$lib/models/signal';

  export let risk: RiskLevel;
  export let status: SignalStatus;

  const riskLabels: Record<RiskLevel, string> = {
    low: '低风险',
    medium: '中风险',
    high: '高风险',
    critical: '严重风险'
  };

  const statusLabels: Record<SignalStatus, string> = {
    new: '待分派',
    investigating: '调查中',
    observed: '观察中',
    action_required: '待处置',
    review: '复核中',
    closed: '已关闭'
  };

  const riskClass: Record<RiskLevel, string> = {
    low: 'bg-emerald-100 text-emerald-900',
    medium: 'bg-amber-100 text-amber-950',
    high: 'bg-orange-100 text-orange-950',
    critical: 'bg-red-100 text-red-950'
  };
</script>

<div class="flex flex-wrap items-center gap-2">
  <span class="badge px-3 py-1 {riskClass[risk]}">{riskLabels[risk]}</span>
  <span class="badge bg-surface-200-800">{statusLabels[status]}</span>
</div>
