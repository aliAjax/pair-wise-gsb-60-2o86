<script lang="ts">
  import { signalStore } from '$lib/stores/signal-store';

  $: signals = $signalStore;
  $: auditEntries = signals
    .flatMap((signal) => signal.audit.map((entry) => ({ ...entry, signalId: signal.id, product: signal.product })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function exportAll() {
    const payload = {
      generatedAt: new Date().toISOString(),
      signals: signals.map((signal) => ({
        id: signal.id,
        product: signal.product,
        batch: signal.batch,
        status: signal.status,
        risk: signal.riskLevel,
        conclusion: signal.versions[0] ?? null,
        audit: signal.audit
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'medical-device-safety-audit-report.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head><title>审计报告 | 医疗器械安全信号核查平台</title></svelte:head>

<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
  <div>
    <h1 class="text-2xl font-semibold">审计与可追溯报告</h1>
    <p class="mt-1 text-sm text-surface-600-300">所有新增证据、结论版本和状态流转均保留操作者与时间。</p>
  </div>
  <button class="btn variant-filled-primary" type="button" on:click={exportAll}>导出完整审计包</button>
</div>

<section class="rounded border border-surface-300-700 bg-surface-100-900">
  <div class="border-b border-surface-300-700 px-4 py-3">
    <h2 class="font-semibold">审计时间线</h2>
    <p class="mt-1 text-xs text-surface-500-400">共 {auditEntries.length} 条持久化记录</p>
  </div>
  <div class="space-y-5 p-5">
    {#each auditEntries as entry}
      <article class="timeline-item">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-medium">{entry.action} · {entry.actor}</p>
          <span class="text-xs text-surface-500-400">{entry.createdAt.slice(0, 16).replace('T', ' ')}</span>
        </div>
        <p class="mt-1 text-sm text-surface-600-300">{entry.detail}</p>
        <p class="mt-1 text-xs text-surface-500-400">{entry.signalId} · {entry.product}</p>
      </article>
    {/each}
  </div>
</section>
