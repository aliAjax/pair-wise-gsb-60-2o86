<script lang="ts">
  import { enhance } from '$app/forms';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import SignalTable from '$lib/components/SignalTable.svelte';
  import type { SignalCase, SignalFilters } from '$lib/models/signal';
  import { listSignals } from '$lib/services/signal-service';
  import { signalStore } from '$lib/stores/signal-store';
  import type { ActionData } from './$types';

  export let form: ActionData;

  const queryClient = useQueryClient();
  let filters: SignalFilters = {
    query: '',
    status: 'all',
    riskLevel: 'all',
    sourceType: 'all'
  };
  let showCreate = false;

  const query = createQuery({
    queryKey: ['signals', filters],
    queryFn: () => listSignals(filters)
  });

  $: signals = ($query.data ?? []) as SignalCase[];
  $: statusCounts = signals.reduce<Record<string, number>>((counts, signal) => {
    counts[signal.status] = (counts[signal.status] ?? 0) + 1;
    return counts;
  }, {});
</script>

<svelte:head><title>信号台账 | 医疗器械安全信号核查平台</title></svelte:head>

<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
  <div>
    <h1 class="text-2xl font-semibold">信号台账</h1>
    <p class="mt-1 text-sm text-surface-600-300">筛选、聚类并跟踪全部产品安全信号。</p>
  </div>
  <button class="btn variant-filled-primary" type="button" on:click={() => (showCreate = !showCreate)}>
    {showCreate ? '收起登记表' : '登记新信号'}
  </button>
</div>

{#if showCreate}
  <section class="mb-6 border-y border-surface-300-700 py-5">
    <div class="mb-4">
      <h2 class="font-semibold">人工登记初始信号</h2>
      <p class="mt-1 text-sm text-surface-500-400">表单由 SvelteKit Form Action 校验，提交后写入本地台账。</p>
    </div>
    <form
      method="POST"
      class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      use:enhance={() => {
        return async ({ result, update }) => {
          if (result.type === 'success') {
            const data = result.data as { signal?: SignalCase };
            if (data.signal) signalStore.add(data.signal);
            await queryClient.invalidateQueries({ queryKey: ['signals'] });
            showCreate = false;
          }
          await update({ reset: true });
        };
      }}
    >
      <label class="block">
        <span class="mb-1 block text-sm font-medium">信号标题</span>
        <input class="input" name="title" required minlength="6" placeholder="描述主要故障模式" />
      </label>
      <label class="block">
        <span class="mb-1 block text-sm font-medium">产品名称</span>
        <input class="input" name="product" required placeholder="型号或产品名称" />
      </label>
      <label class="block">
        <span class="mb-1 block text-sm font-medium">关联批号</span>
        <input class="input" name="batch" required placeholder="生产批号或软件版本" />
      </label>
      <label class="block">
        <span class="mb-1 block text-sm font-medium">来源类型</span>
        <select class="select" name="sourceType">
          <option value="complaint">投诉</option>
          <option value="repair">维修记录</option>
          <option value="adverse_event">不良事件</option>
          <option value="field_report">现场报告</option>
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-sm font-medium">严重度</span>
        <select class="select" name="severity">
          <option value="1">1 - 轻微</option>
          <option value="2">2 - 低</option>
          <option value="3">3 - 中</option>
          <option value="4">4 - 高</option>
          <option value="5">5 - 严重</option>
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-sm font-medium">发生日期</span>
        <input class="input" name="occurredAt" type="date" required />
      </label>
      <label class="block md:col-span-2 xl:col-span-3">
        <span class="mb-1 block text-sm font-medium">经过说明</span>
        <textarea class="textarea" name="description" required minlength="10" rows="3"></textarea>
      </label>
      {#if form?.message}
        <p class="rounded bg-error-100 p-3 text-sm text-error-900 md:col-span-2 xl:col-span-3">{form.message}</p>
      {/if}
      <div class="md:col-span-2 xl:col-span-3">
        <button class="btn variant-filled-primary" type="submit">提交并建立信号</button>
      </div>
    </form>
  </section>
{/if}

<section class="mb-5 rounded border border-surface-300-700 bg-surface-100-900 p-4">
  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
    <label>
      <span class="mb-1 block text-sm font-medium">关键词</span>
      <input class="input" bind:value={filters.query} placeholder="信号号、产品、批号或标题" />
    </label>
    <label>
      <span class="mb-1 block text-sm font-medium">状态</span>
      <select class="select" bind:value={filters.status}>
        <option value="all">全部状态</option>
        <option value="new">待分派</option>
        <option value="investigating">调查中</option>
        <option value="observed">持续观察</option>
        <option value="action_required">待处置</option>
        <option value="review">复核中</option>
        <option value="closed">已关闭</option>
      </select>
    </label>
    <label>
      <span class="mb-1 block text-sm font-medium">风险</span>
      <select class="select" bind:value={filters.riskLevel}>
        <option value="all">全部风险</option>
        <option value="low">低</option>
        <option value="medium">中</option>
        <option value="high">高</option>
        <option value="critical">严重</option>
      </select>
    </label>
    <label>
      <span class="mb-1 block text-sm font-medium">来源</span>
      <select class="select" bind:value={filters.sourceType}>
        <option value="all">全部来源</option>
        <option value="complaint">投诉</option>
        <option value="repair">维修</option>
        <option value="adverse_event">不良事件</option>
        <option value="field_report">现场报告</option>
      </select>
    </label>
  </div>
  <div class="mt-3 flex flex-wrap gap-3 text-xs text-surface-500-400">
    <span>筛选结果 {signals.length} 项</span>
    <span>调查中 {statusCounts.investigating ?? 0}</span>
    <span>待处置 {statusCounts.action_required ?? 0}</span>
    <span>已关闭 {statusCounts.closed ?? 0}</span>
  </div>
</section>

<section class="rounded border border-surface-300-700 bg-surface-100-900">
  {#if $query.isPending}
    <div class="p-8 text-center text-surface-500-400">正在读取信号台账…</div>
  {:else if $query.isError}
    <div class="p-8 text-center text-error-700">信号台账读取失败。</div>
  {:else}
    <SignalTable {signals} />
  {/if}
</section>
