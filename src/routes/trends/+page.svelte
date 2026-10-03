<script lang="ts">
  import TrendChart from '$lib/components/TrendChart.svelte';
  import { signalStore } from '$lib/stores/signal-store';

  $: signals = $signalStore;
  const trendPoints = [
    { label: '2026-04', value: 0.18, threshold: 0.75 },
    { label: '2026-05', value: 0.31, threshold: 0.75 },
    { label: '2026-06', value: 0.46, threshold: 0.75 },
    { label: '2026-07', value: 0.52, threshold: 0.75 },
    { label: '2026-08', value: 0.69, threshold: 0.75 },
    { label: '2026-09', value: 0.83, threshold: 0.75 }
  ];
</script>

<svelte:head><title>趋势核对 | 医疗器械安全信号核查平台</title></svelte:head>

<div class="mb-6">
  <h1 class="text-2xl font-semibold">发生率趋势核对</h1>
  <p class="mt-1 text-sm text-surface-600-300">对比月度核查发生率与预设监测阈值，识别持续上升和短时聚集。</p>
</div>

<div class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
  <section class="rounded border border-surface-300-700 bg-surface-100-900 p-5">
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-semibold">阻塞报警月度发生率</h2>
        <p class="mt-1 text-xs text-surface-500-400">红色线为当前监测阈值 0.75%</p>
      </div>
      <span class="badge bg-amber-100 text-amber-950">阈值已连续两月接近</span>
    </div>
    <TrendChart points={trendPoints} />
  </section>

  <aside class="rounded border border-surface-300-700 bg-surface-100-900 p-5">
    <h2 class="font-semibold">趋势判断</h2>
    <div class="mt-4 space-y-4 text-sm">
      <div class="border-l-2 border-amber-500 pl-3">
        <p class="font-medium">近三月增幅 80.4%</p>
        <p class="mt-1 text-surface-500-400">8 月至 9 月环比增幅 20.3%，需与装机量增长分开计算。</p>
      </div>
      <div class="border-l-2 border-teal-600 pl-3">
        <p class="font-medium">批号集中度明显</p>
        <p class="mt-1 text-surface-500-400">当前 13 条报告关联 IP8-260401，占总报告 76.5%。</p>
      </div>
    </div>
  </aside>
</div>

<section class="mt-6 rounded border border-surface-300-700 bg-surface-100-900">
  <div class="border-b border-surface-300-700 px-4 py-3">
    <h2 class="font-semibold">需要趋势复核的信号</h2>
  </div>
  <div class="overflow-x-auto">
    <table class="data-table min-w-[760px]">
      <thead>
        <tr>
          <th>信号</th>
          <th>产品</th>
          <th>报告数</th>
          <th>核查发生率</th>
          <th>当前判断</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {#each signals.filter((signal) => signal.occurrenceRate >= 0.75) as signal}
          <tr>
            <td>{signal.id}</td>
            <td>{signal.product}</td>
            <td>{signal.reportCount}</td>
            <td class="metric-value">{signal.occurrenceRate.toFixed(2)}%</td>
            <td>超过或接近阈值</td>
            <td><a class="btn btn-sm variant-soft-primary" href={`/signals/${signal.id}`}>核对详情</a></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
