<script lang="ts">
  import RiskBadge from '$lib/components/RiskBadge.svelte';
  import { signalStore } from '$lib/stores/signal-store';

  $: signals = $signalStore;
  let selectedBatch = 'all';

  $: batches = Array.from(new Set(signals.flatMap((signal) => signal.affectedBatches))).sort();
  $: visibleSignals = signals.filter(
    (signal) => selectedBatch === 'all' || signal.affectedBatches.includes(selectedBatch)
  );
</script>

<svelte:head><title>批次追踪 | 医疗器械安全信号核查平台</title></svelte:head>

<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
  <div>
    <h1 class="text-2xl font-semibold">批次追踪</h1>
    <p class="mt-1 text-sm text-surface-600-300">按生产批号或软件版本追踪信号覆盖、报告数量和高风险关联。</p>
  </div>
  <label class="min-w-[240px]">
    <span class="mb-1 block text-sm font-medium">目标批号</span>
    <select class="select" bind:value={selectedBatch}>
      <option value="all">全部批号</option>
      {#each batches as batch}
        <option value={batch}>{batch}</option>
      {/each}
    </select>
  </label>
</div>

<section class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
  {#each visibleSignals as signal}
    <article class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm text-surface-500-400">{signal.product}</p>
          <h2 class="mt-1 font-semibold">{signal.batch}</h2>
        </div>
        <RiskBadge risk={signal.riskLevel} status={signal.status} />
      </div>
      <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt class="text-surface-500-400">报告数量</dt>
          <dd class="metric-value mt-1 font-semibold">{signal.reportCount}</dd>
        </div>
        <div>
          <dt class="text-surface-500-400">暴露数量</dt>
          <dd class="metric-value mt-1 font-semibold">{signal.exposedUnits}</dd>
        </div>
      </dl>
      <p class="mt-4 text-sm text-surface-600-300">覆盖批号：{signal.affectedBatches.join('、')}</p>
      <a class="btn btn-sm mt-4 variant-soft-primary" href={`/signals/${signal.id}`}>查看批次证据</a>
    </article>
  {/each}
</section>
