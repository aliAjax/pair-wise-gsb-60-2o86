<script lang="ts">
  import RiskBadge from '$lib/components/RiskBadge.svelte';
  import { signalStore } from '$lib/stores/signal-store';

  $: signals = $signalStore;
  $: openSignals = signals.filter((signal) => signal.status !== 'closed');
  $: criticalSignals = signals.filter(
    (signal) => signal.riskLevel === 'critical' || signal.riskLevel === 'high'
  );
  $: overdueTasks = signals.flatMap((signal) =>
    signal.tasks
      .filter((task) => task.status !== 'done' && task.dueAt < new Date().toISOString().slice(0, 10))
      .map((task) => ({ ...task, signalId: signal.id }))
  );

  $: metrics = [
    { label: '开放信号', value: openSignals.length, note: '含调查、观察与处置队列' },
    { label: '高及以上风险', value: criticalSignals.length, note: '需复核人优先确认' },
    {
      label: '未关闭任务',
      value: signals.flatMap((signal) => signal.tasks).filter((task) => task.status !== 'done').length,
      note: '跨信号调查任务'
    },
    { label: '逾期任务', value: overdueTasks.length, note: '按任务截止日计算' }
  ];
</script>

<svelte:head><title>总览 | 医疗器械安全信号核查平台</title></svelte:head>

<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
  <div>
    <p class="text-sm font-medium text-teal-700">上市后安全运营</p>
    <h1 class="mt-1 text-2xl font-semibold tracking-normal">信号核查总览</h1>
    <p class="mt-2 text-sm text-surface-600-300">汇总投诉、维修、不良事件和现场报告，按风险推进核查闭环。</p>
  </div>
  <a class="btn variant-filled-primary" href="/signals">进入信号台账</a>
</div>

<section class="workspace-grid mb-6">
  {#each metrics as metric}
    <article class="col-span-12 rounded border border-surface-300-700 bg-surface-100-900 p-4 sm:col-span-6 xl:col-span-3">
      <p class="text-sm text-surface-500-400">{metric.label}</p>
      <p class="metric-value mt-2 text-3xl font-semibold">{metric.value}</p>
      <p class="mt-2 text-xs text-surface-500-400">{metric.note}</p>
    </article>
  {/each}
</section>

<div class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
  <section class="rounded border border-surface-300-700 bg-surface-100-900">
    <div class="flex items-center justify-between border-b border-surface-300-700 px-4 py-3">
      <div>
        <h2 class="font-semibold">近期信号</h2>
        <p class="text-xs text-surface-500-400">按最后更新时间排序</p>
      </div>
      <a class="text-sm text-primary-700-300 hover:underline" href="/signals">查看全部</a>
    </div>
    <div class="divide-y divide-surface-300-700">
      {#each signals.slice(0, 4) as signal}
        <a class="block px-4 py-4 hover:bg-surface-200-800" href={`/signals/${signal.id}`}>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs text-surface-500-400">{signal.id} · {signal.product}</p>
              <h3 class="mt-1 font-medium">{signal.title}</h3>
            </div>
            <RiskBadge risk={signal.riskLevel} status={signal.status} />
          </div>
          <p class="mt-2 text-sm text-surface-600-300">
            {signal.reportCount} 条报告 · 发生率 {signal.occurrenceRate.toFixed(2)}% · 负责人 {signal.owner}
          </p>
        </a>
      {/each}
    </div>
  </section>

  <aside class="rounded border border-surface-300-700 bg-surface-100-900">
    <div class="border-b border-surface-300-700 px-4 py-3">
      <h2 class="font-semibold">任务与复核提醒</h2>
      <p class="text-xs text-surface-500-400">优先处理逾期及高风险事项</p>
    </div>
    <div class="space-y-4 p-4">
      {#each signals.flatMap((signal) => signal.tasks.map((task) => ({ ...task, signalId: signal.id }))).filter((task) => task.status !== 'done').slice(0, 5) as task}
        <div class="border-l-2 border-amber-500 pl-3">
          <p class="text-sm font-medium">{task.title}</p>
          <p class="mt-1 text-xs text-surface-500-400">{task.signalId} · {task.owner} · 截止 {task.dueAt}</p>
        </div>
      {/each}
    </div>
  </aside>
</div>
