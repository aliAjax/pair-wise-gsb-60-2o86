<script lang="ts">
  export let points: Array<{ label: string; value: number; threshold: number }>;

  $: maxValue = Math.max(...points.flatMap((point) => [point.value, point.threshold]), 1);
</script>

<div class="space-y-4" aria-label="发生率趋势图">
  {#each points as point}
    <div class="grid grid-cols-[72px_1fr_64px] items-center gap-3">
      <span class="text-sm text-surface-500-400">{point.label}</span>
      <div class="relative h-7 overflow-hidden rounded bg-surface-200-800">
        <div
          class="absolute inset-y-0 left-0 bg-teal-600"
          style={`width: ${Math.max((point.value / maxValue) * 100, 3)}%`}
        ></div>
        <div
          class="absolute inset-y-0 w-0.5 bg-red-600"
          style={`left: ${(point.threshold / maxValue) * 100}%`}
          title={`阈值 ${point.threshold}%`}
        ></div>
      </div>
      <span class="metric-value text-right text-sm font-semibold">{point.value.toFixed(2)}%</span>
    </div>
  {/each}
</div>
