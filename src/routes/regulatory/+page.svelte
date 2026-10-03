<script lang="ts">
  import { enhance } from '$app/forms';
  import ReportStatusBadge from '$lib/components/ReportStatusBadge.svelte';
  import {
    reportKindLabels,
    receiptStatusLabels,
    type RegulatoryReport
  } from '$lib/models/regulatory';
  import { submitRegulatoryReport } from '$lib/services/regulatory-service';
  import { regulatoryStore } from '$lib/stores/regulatory-store';
  import { signalStore } from '$lib/stores/signal-store';
  import type { ActionData } from './$types';

  export let form: ActionData;

  let notice: { tone: 'ok' | 'error'; text: string } | null = form?.message
    ? { tone: 'error', text: form.message }
    : null;
  let expanded: string | null = null;
  let submittingId: string | null = null;
  const failToggles: Record<string, boolean> = {};

  $: reports = $regulatoryStore.reports;
  $: receipts = $regulatoryStore.receipts;
  $: signalsById = new Map($signalStore.map((signal) => [signal.id, signal]));

  $: sortedReports = [...reports].sort((a, b) =>
    (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt)
  );
  $: pendingBackfill = reports.filter((report) => report.status === 'pending_backfill');
  $: failed = reports.filter((report) => report.status === 'submission_failed');
  $: submitted = reports.filter((report) => report.status === 'submitted');
  $: pendingReceipts = receipts.filter((receipt) => receipt.status === 'pending_review');

  $: stats = [
    { label: '待补报（旧数据升级）', value: pendingBackfill.length, note: '有结论版本但查无报送件' },
    { label: '提交失败待重试', value: failed.length, note: '就原报送件就地重试' },
    { label: '已报送待回执', value: submitted.length, note: '按监管报送号跟踪' },
    { label: '回执待核对', value: pendingReceipts.length, note: '对不上报送件或信号不一致' }
  ];

  function signalLabel(id: string) {
    const signal = signalsById.get(id);
    return signal ? `${signal.id} · ${signal.product}` : `${id}（信号缺失）`;
  }

  async function handleSubmit(event: SubmitEvent, report: RegulatoryReport) {
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const actor = String(data.get('actor') ?? '').trim();
    const simulateFail = data.get('simulateFail') === 'on';
    if (actor.length < 2) {
      notice = { tone: 'error', text: '请填写操作人。' };
      return;
    }
    submittingId = report.id;
    notice = null;
    const result = await submitRegulatoryReport(report.id, actor, { simulateFail });
    submittingId = null;
    notice = result.ok
      ? { tone: 'ok', text: `报送件 ${report.id} 已提交监管。` }
      : { tone: 'error', text: result.reason ?? '提交失败。' };
  }
</script>

<svelte:head><title>监管报送 | 医疗器械安全信号核查平台</title></svelte:head>

<div class="mb-6">
  <p class="text-sm font-medium text-teal-700">Regulatory Reporting</p>
  <h1 class="mt-1 text-2xl font-semibold">监管报送与回执对账</h1>
  <p class="mt-2 max-w-4xl text-sm text-surface-600-300">
    报送件生成时冻结证据矩阵、结论版本和关联批号；冻结内容一旦变化，原报送件失效，补充件另起一份。
    回执按回执号对账，重复回执只记一次，对不上的留在待核对。
  </p>
</div>

{#if notice}
  <div
    class="mb-5 rounded border p-3 text-sm {notice.tone === 'ok'
      ? 'border-success-300 bg-success-50 text-success-900'
      : 'border-error-300 bg-error-50 text-error-900'}"
  >
    {notice.text}
  </div>
{/if}

<section class="workspace-grid mb-6">
  {#each stats as stat}
    <article class="col-span-12 rounded border border-surface-300-700 bg-surface-100-900 p-4 sm:col-span-6 xl:col-span-3">
      <p class="text-sm text-surface-500-400">{stat.label}</p>
      <p class="metric-value mt-2 text-3xl font-semibold">{stat.value}</p>
      <p class="mt-2 text-xs text-surface-500-400">{stat.note}</p>
    </article>
  {/each}
</section>

<div class="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
  <section class="rounded border border-surface-300-700 bg-surface-100-900">
    <div class="border-b border-surface-300-700 px-4 py-3">
      <h2 class="font-semibold">报送件台账</h2>
      <p class="mt-1 text-xs text-surface-500-400">初次、补充与旧数据补报分件保存，已失效件保留可追溯。</p>
    </div>
    <div class="divide-y divide-surface-300-700">
      {#each sortedReports as report (report.id)}
        {@const signal = signalsById.get(report.signalId)}
        <article class="px-4 py-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-medium">{report.id}</h3>
                <span class="badge variant-soft-surface">{reportKindLabels[report.kind]}</span>
                <ReportStatusBadge status={report.status} />
              </div>
              <p class="mt-1 text-xs text-surface-500-400">{signalLabel(report.signalId)}</p>
              {#if report.supersedesId}
                <p class="mt-1 text-xs text-amber-600">接替失效报送件：{report.supersedesId}</p>
              {/if}
              {#if report.gatewayReportNo}
                <p class="mt-1 text-xs text-surface-500-400">监管报送号：{report.gatewayReportNo}</p>
              {/if}
              {#if report.status === 'invalidated'}
                <p class="mt-1 text-xs text-error-700">失效原因：{report.invalidateReason}（{report.invalidatedAt?.slice(0, 16).replace('T', ' ')}）</p>
              {/if}
            </div>
            <div class="flex shrink-0 items-center gap-2">
              {#if report.status === 'draft' || report.status === 'submission_failed'}
                <form
                  class="flex flex-wrap items-center justify-end gap-2"
                  on:submit|preventDefault={(event) => handleSubmit(event, report)}
                >
                  <input
                    class="input input-sm w-28"
                    name="actor"
                    value={signal?.owner ?? '安全评审专员'}
                    aria-label="操作人"
                  />
                  <label class="flex items-center gap-1 text-xs text-surface-500-400">
                    <input type="checkbox" name="simulateFail" bind:checked={failToggles[report.id]} />
                    模拟失败
                  </label>
                  <button
                    class="btn btn-sm variant-filled-primary"
                    type="submit"
                    disabled={submittingId === report.id}
                  >
                    {submittingId === report.id
                      ? '提交中…'
                      : report.status === 'submission_failed'
                        ? '就地重试'
                        : '提交监管'}
                  </button>
                </form>
              {/if}
              <button
                class="btn btn-sm variant-ghost-surface"
                type="button"
                on:click={() => (expanded = expanded === report.id ? null : report.id)}
              >
                {expanded === report.id ? '收起冻结件' : '查看冻结件'}
              </button>
            </div>
          </div>

          {#if report.attempts.length > 0}
            <p class="mt-2 text-xs text-surface-500-400">
              提交尝试：{report.attempts.length} 次
              {#each report.attempts.filter((attempt) => !attempt.ok).slice(-1) as attempt}
                · 最近失败：{attempt.error}（{attempt.at.slice(0, 16).replace('T', ' ')}）
              {/each}
            </p>
          {/if}

          {#if expanded === report.id}
            <div class="mt-3 rounded border border-surface-300-700 p-3 text-sm">
              {#if report.status === 'pending_backfill'}
                <p class="text-xs text-amber-600">
                  旧数据升级占位：请在信号详情页生成补报件后提交。冻结内容在生成时才写入。
                </p>
              {:else}
                <p class="text-xs text-surface-500-400">
                  冻结于 {report.snapshot.frozenAt.slice(0, 16).replace('T', ' ')} · 快照哈希 {report.snapshot.evidenceHash}
                </p>
                {#if report.snapshot.version}
                  <div class="mt-2 border-l-2 border-teal-600 pl-3">
                    <p class="font-medium">
                      V{report.snapshot.version.version} · {report.snapshot.version.author} ·
                      {report.snapshot.version.disposition}
                    </p>
                    <p class="mt-1 text-xs">{report.snapshot.version.summary}</p>
                  </div>
                {:else}
                  <p class="mt-2 text-xs text-surface-500-400">冻结时无结论版本</p>
                {/if}
                <p class="mt-2 text-xs text-surface-500-400">
                  关联批号：{report.snapshot.batches.join('、') || '—'}
                </p>
                <ul class="mt-2 space-y-1 text-xs">
                  {#each report.snapshot.evidence as item}
                    <li>[{item.strength}] {item.title}（批号 {item.batch} / {item.source}）</li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </article>
      {:else}
        <p class="px-4 py-8 text-center text-sm text-surface-500-400">暂无报送件。</p>
      {/each}
    </div>
  </section>

  <div class="space-y-6">
    <section class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
      <h2 class="font-semibold">录入监管回执</h2>
      <p class="mt-1 text-xs text-surface-500-400">回执号重复只记一次；报送号或信号对不上时自动进待核对。</p>
      <form
        method="POST"
        action="?/receipt"
        use:enhance={() =>
          async ({ result, update }) => {
            if (result.type === 'success') {
              const payload = result.data as {
                receipt?: {
                  receiptNo: string;
                  receivedAt: string;
                  gatewayReportNo?: string;
                  signalId?: string;
                  actor: string;
                };
              };
              if (payload.receipt) {
                const outcome = regulatoryStore.addReceipt(payload.receipt);
                notice = outcome.ok
                  ? {
                      tone: 'ok',
                      text:
                        outcome.receipt?.status === 'recorded'
                          ? `回执 ${payload.receipt.receiptNo} 已对账。`
                          : `回执 ${payload.receipt.receiptNo} 已留在待核对：${outcome.receipt?.reviewNote ?? ''}`
                    }
                  : { tone: 'error', text: outcome.reason ?? '回执录入失败。' };
              }
            }
            await update({ reset: true });
          }}
        class="mt-4 space-y-3"
      >
        <label class="block">
          <span class="mb-1 block text-sm font-medium">监管回执号</span>
          <input class="input" name="receiptNo" required placeholder="如 RCP-2026-1023" />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm font-medium">回执签发日期</span>
          <input class="input" type="date" name="receivedAt" required />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm font-medium">监管报送号（选填）</span>
          <input class="input" name="gatewayReportNo" placeholder="如 GOV-2026-0001" />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm font-medium">信号编号（选填）</span>
          <input class="input" name="signalId" placeholder="如 SIG-2026-019" />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm font-medium">录入人</span>
          <input class="input" name="actor" value="安全评审专员" />
        </label>
        <button class="btn w-full variant-filled-primary" type="submit">录入并对账</button>
      </form>
    </section>

    <section class="rounded border border-surface-300-700 bg-surface-100-900">
      <div class="border-b border-surface-300-700 px-4 py-3">
        <h2 class="font-semibold">回执记录（{receipts.length}）</h2>
      </div>
      <div class="divide-y divide-surface-300-700">
        {#each [...receipts].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)) as receipt (receipt.id)}
          <article class="px-4 py-3 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="font-medium">{receipt.receiptNo}</p>
              <span
                class="badge {receipt.status === 'recorded'
                  ? 'variant-soft-success'
                  : 'variant-soft-warning'}"
              >
                {receiptStatusLabels[receipt.status]}
              </span>
            </div>
            <p class="mt-1 text-xs text-surface-500-400">
              签发 {receipt.receivedAt} · 录入 {receipt.recordedAt.slice(0, 10)} · {receipt.recordedBy}
            </p>
            {#if receipt.gatewayReportNo}
              <p class="mt-1 text-xs text-surface-500-400">报送号：{receipt.gatewayReportNo}</p>
            {/if}
            {#if receipt.matchedReportId}
              <p class="mt-1 text-xs text-success-700">对账报送件：{receipt.matchedReportId}</p>
            {/if}
            {#if receipt.reviewNote}
              <p class="mt-1 text-xs {receipt.status === 'pending_review' ? 'text-amber-600' : 'text-surface-500-400'}">
                {receipt.status === 'pending_review' ? '待核对原因' : '核对说明'}：{receipt.reviewNote}
              </p>
            {/if}

            {#if receipt.status === 'pending_review'}
              <form
                method="POST"
                action="?/resolve"
                use:enhance={() =>
                  async ({ result, update }) => {
                    if (result.type === 'success') {
                      const payload = result.data as {
                        resolve?: { receiptId: string; reportId: string; note: string; actor: string };
                      };
                      if (payload.resolve) {
                        const outcome = regulatoryStore.resolveReceipt(payload.resolve);
                        notice = outcome.ok
                          ? { tone: 'ok', text: '回执已人工核对并完成对账。' }
                          : { tone: 'error', text: outcome.reason ?? '核对失败。' };
                      }
                    }
                    await update({ reset: true });
                  }}
                class="mt-3 space-y-2 border-t border-surface-300-700 pt-3"
              >
                <input type="hidden" name="receiptId" value={receipt.id} />
                <select class="select select-sm" name="reportId" required>
                  <option value="">选择核对目标报送件…</option>
                  {#each sortedReports.filter((item) => item.status === 'submitted' || item.status === 'acknowledged' || item.status === 'invalidated') as item}
                    <option value={item.id}>{item.id}（{item.signalId}）</option>
                  {/each}
                </select>
                <input class="input input-sm" name="note" placeholder="核对说明（至少 4 字）" required />
                <div class="flex gap-2">
                  <input class="input input-sm flex-1" name="actor" value="安全评审专员" aria-label="核对人" />
                  <button class="btn btn-sm variant-filled-secondary" type="submit">人工核对</button>
                </div>
              </form>
            {/if}
          </article>
        {:else}
          <p class="px-4 py-6 text-center text-xs text-surface-500-400">尚无回执记录。</p>
        {/each}
      </div>
    </section>
  </div>
</div>
