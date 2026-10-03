<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import FilingCard from '$lib/components/FilingCard.svelte';
  import type { RegulatoryFiling } from '$lib/models/signal';
  import {
    isGatewayOffline,
    setGatewayOffline,
    submitFiling
  } from '$lib/services/filing-service';
  import { receiptStore } from '$lib/stores/receipt-store';
  import { signalStore } from '$lib/stores/signal-store';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();

  let gatewayOffline = $state(isGatewayOffline());
  let busyId = $state<string | null>(null);
  let flash = $state<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);

  $effect(() => {
    const onChange = (event: Event) => {
      gatewayOffline = (event as CustomEvent<{ offline: boolean }>).detail.offline;
    };
    window.addEventListener('filing-gateway-change', onChange);
    return () => window.removeEventListener('filing-gateway-change', onChange);
  });

  const signals = $derived($signalStore);
  const receipts = $derived($receiptStore);
  const allFilings = $derived(
    signals
      .flatMap((signal) => signal.filings.map((filing) => ({ filing, signal })))
      .sort((a, b) => b.filing.updatedAt.localeCompare(a.filing.updatedAt))
  );

  const pendingBacklog = $derived(
    allFilings.filter(
      ({ filing }) => filing.status === 'pending_submission' || filing.status === 'send_failed'
    )
  );
  const submittedFilings = $derived(allFilings.filter(({ filing }) => filing.status === 'submitted'));
  const supersededFilings = $derived(
    allFilings.filter(({ filing }) => filing.status === 'superseded')
  );
  const pendingReceipts = $derived(
    receipts.filter((receipt) => receipt.status === 'pending_review')
  );
  const duplicateReceipts = $derived(receipts.filter((receipt) => receipt.status === 'duplicate'));
  const matchedReceipts = $derived(receipts.filter((receipt) => receipt.status === 'matched'));

  async function handleSubmit(filing: RegulatoryFiling) {
    if (busyId) return;
    busyId = filing.id;
    flash = null;
    const owner = signals.find((signal) => signal.id === filing.signalId)?.owner ?? '安全评审专员';
    const result = await submitFiling(filing.id, owner);
    busyId = null;

    if (result.kind === 'submitted') {
      flash = { kind: 'ok', text: `报送号 ${result.filing.filingNo} 已送达监管，内容以冻结快照为准。` };
    } else if (result.kind === 'failed') {
      flash = { kind: 'error', text: `报送失败：${result.error}。可就地重试，报送件未重新生成。` };
    } else if (result.kind === 'concurrent_lost') {
      flash = { kind: 'warn', text: result.message };
    } else {
      flash = { kind: 'error', text: result.message };
    }
  }

  function toggleGateway() {
    setGatewayOffline(!gatewayOffline);
  }

  function manualReconcile() {
    const matched = receiptStore.reconcile();
    flash =
      matched.length > 0
        ? { kind: 'ok', text: `重新对账完成，新对上 ${matched.length} 张回执：${matched
            .map((item) => item.receiptNo)
            .join('、')}。` }
        : { kind: 'warn', text: '重新对账完成：待核对回执仍无法与报送件对上。' };
  }

  const receiptHandler: SubmitFunction = () => {
    return async ({ result, update }) => {
      if (result.type === 'success') {
        const payload = result.data as {
          receipt?: {
            receiptNo: string;
            filingNo: string;
            signalId: string;
            receivedAt: string;
            recordedBy: string;
            note?: string;
          };
        };
        if (payload.receipt) {
          const r = receiptStore.record(payload.receipt);
          if (r.outcome === 'duplicate') {
            flash = {
              kind: 'warn',
              text: `回执号 ${r.existing.receiptNo} 已录入过（${r.existing.receivedAt.slice(0, 10)}），重复回执只记一次。`
            };
          } else if (r.outcome === 'matched') {
            flash = {
              kind: 'ok',
              text: `回执 ${r.receipt.receiptNo} 与报送号 ${r.filing.filingNo} 对账一致。`
            };
          } else {
            flash = {
              kind: 'warn',
              text:
                r.issue === 'filing_not_found'
                  ? `回执 ${r.receipt.receiptNo} 的报送号在本地找不到报送件，已留待核对。`
                  : `回执 ${r.receipt.receiptNo} 指向另一条信号，已留待核对。`
            };
          }
        }
      }
      await update({ reset: true });
    };
  };
</script>

<svelte:head><title>监管报送 | 医疗器械安全信号核查平台</title></svelte:head>

<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
  <div>
    <h1 class="text-2xl font-semibold">监管报送与回执对账</h1>
    <p class="mt-1 text-sm text-surface-600-300">
      报送件生成时冻结证据矩阵、结论版本与关联批号；内容变化后原件失效、补充件另起一份。
    </p>
  </div>
  <label class="flex cursor-pointer items-center gap-2 rounded border border-surface-300-700 px-3 py-2 text-sm">
    <input type="checkbox" checked={gatewayOffline} onchange={toggleGateway} />
    模拟监管网关中断（用于演示失败重试）
  </label>
</div>

{#if flash}
  <div
    class="mb-5 rounded border p-3 text-sm {flash.kind === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : flash.kind === 'error'
        ? 'border-error-300 bg-error-50 text-error-900'
        : 'border-amber-300 bg-amber-50 text-amber-900'}"
  >
    {flash.text}
  </div>
{/if}
{#if form?.message}
  <div class="mb-5 rounded border border-error-300 bg-error-50 p-3 text-sm text-error-900">{form.message}</div>
{/if}

<section class="workspace-grid mb-6">
  {#each [
    { label: '待报送 / 待补报', value: pendingBacklog.length, note: '含旧数据升级与补充件' },
    { label: '已报送', value: submittedFilings.length, note: '以冻结快照为准' },
    { label: '已失效', value: supersededFilings.length, note: '被补充件替代' },
    { label: '待核对回执', value: pendingReceipts.length, note: '对不上报送件或信号' }
  ] as metric}
    <article class="col-span-6 rounded border border-surface-300-700 bg-surface-100-900 p-4 xl:col-span-3">
      <p class="text-sm text-surface-500-400">{metric.label}</p>
      <p class="metric-value mt-2 text-3xl font-semibold">{metric.value}</p>
      <p class="mt-2 text-xs text-surface-500-400">{metric.note}</p>
    </article>
  {/each}
</section>

{#if pendingBacklog.length > 0}
  <section class="mb-6">
    <div class="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">待报送队列</h2>
        <p class="mt-1 text-sm text-surface-500-400">
          两个窗口同时提交时只有先到的生效；报送失败后就地重试，不重复生成。
        </p>
      </div>
    </div>
    <div class="grid gap-3 xl:grid-cols-2">
      {#each pendingBacklog as { filing, signal } (filing.id)}
        <FilingCard
          {filing}
          signalTitle={signal.title}
          signalHref={`/signals/${signal.id}`}
          busy={busyId === filing.id}
          onsubmit={(event) => handleSubmit(event.detail.filing)}
        />
      {/each}
    </div>
  </section>
{/if}

<div class="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
  <div class="space-y-6">
    <section class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
      <h2 class="font-semibold">已报送与已失效报送件</h2>
      <div class="mt-4 grid gap-3">
        {#each [...submittedFilings, ...supersededFilings] as { filing, signal } (filing.id)}
          <FilingCard
            {filing}
            signalTitle={signal.title}
            signalHref={`/signals/${signal.id}`}
            showActions={false}
          />
        {:else}
          <p class="text-sm text-surface-500-400">暂无已报送件。</p>
        {/each}
      </div>
    </section>
  </div>

  <aside class="space-y-6">
    <section class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-semibold">监管回执录入</h2>
        <button class="btn btn-sm variant-ghost-surface" type="button" onclick={manualReconcile}>
          重新对账
        </button>
      </div>
      <form class="mt-4 grid gap-3" method="POST" action="?/receipt" use:enhance={receiptHandler}>
        <label>
          <span class="mb-1 block text-sm font-medium">监管回执号</span>
          <input class="input" name="receiptNo" required placeholder="如 JJH-2026-1008" />
        </label>
        <label>
          <span class="mb-1 block text-sm font-medium">回执指向报送号</span>
          <input class="input" name="filingNo" required placeholder="如 RPT-019-AB12CD34" />
        </label>
        <label>
          <span class="mb-1 block text-sm font-medium">回执指向信号号</span>
          <input class="input" name="signalId" required placeholder="如 SIG-2026-019" />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label>
            <span class="mb-1 block text-sm font-medium">回执日期</span>
            <input class="input" name="receivedAt" type="date" required />
          </label>
          <label>
            <span class="mb-1 block text-sm font-medium">录入人</span>
            <input class="input" name="recordedBy" value="安全评审专员" required />
          </label>
        </div>
        <label>
          <span class="mb-1 block text-sm font-medium">备注</span>
          <input class="input" name="note" placeholder="可选" />
        </label>
        <button class="btn variant-filled-primary" type="submit">录入并对账</button>
      </form>
    </section>

    <section class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
      <h2 class="font-semibold">待核对回执（{pendingReceipts.length}）</h2>
      <p class="mt-1 text-xs text-surface-500-400">报送号无对应报送件，或指向另一条信号；报送/补报后自动重对。</p>
      <div class="mt-4 space-y-3">
        {#each pendingReceipts as receipt (receipt.id)}
          <article class="border-l-2 border-amber-500 pl-3 text-sm">
            <p class="font-medium">{receipt.receiptNo}</p>
            <p class="mt-1 text-xs text-surface-500-400">
              报送号 {receipt.filingNo} · 声称信号 {receipt.signalId}
            </p>
            <p class="mt-1 text-xs text-amber-800">
              {receipt.issue === 'filing_not_found'
                ? '报送件尚未在本地生成或尚未报出（报送成功后自动对上）'
                : '与报送件实际所属信号不一致'}
            </p>
          </article>
        {:else}
          <p class="text-sm text-surface-500-400">没有待核对回执。</p>
        {/each}
      </div>
    </section>

    <section class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
      <h2 class="font-semibold">已处理回执</h2>
      <div class="mt-4 space-y-3">
        {#each [...matchedReceipts, ...duplicateReceipts] as receipt (receipt.id)}
          <article class="border-l-2 pl-3 text-sm {receipt.status === 'matched'
            ? 'border-emerald-600'
            : 'border-surface-400'}">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium">{receipt.receiptNo}</p>
              <span class="badge">{receipt.status === 'matched' ? '已对账' : '重复已忽略'}</span>
            </div>
            <p class="mt-1 text-xs text-surface-500-400">报送号 {receipt.filingNo}</p>
            {#if receipt.status === 'duplicate'}
              <p class="mt-1 text-xs text-surface-500-400">同一回执号只记一次。</p>
            {/if}
          </article>
        {:else}
          <p class="text-sm text-surface-500-400">暂无已处理回执。</p>
        {/each}
      </div>
    </section>
  </aside>
</div>
