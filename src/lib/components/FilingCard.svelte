<script lang="ts">
  import type { RegulatoryFiling } from '$lib/models/signal';

  interface Props {
    filing: RegulatoryFiling;
    signalTitle: string;
    signalHref: string;
    busy?: boolean;
    /** 是否显示提交/重试按钮（中心页和详情页都用） */
    showActions?: boolean;
    onsubmit?: (event: { detail: { filing: RegulatoryFiling } }) => void;
  }

  let { filing, signalTitle, signalHref, busy = false, showActions = true, onsubmit }: Props = $props();

  const statusBadge: Record<RegulatoryFiling['status'], string> = {
    pending_submission: 'badge variant-soft-warning',
    submitted: 'badge variant-soft-success',
    send_failed: 'badge variant-soft-error',
    superseded: 'badge'
  };

  const statusText: Record<RegulatoryFiling['status'], string> = {
    pending_submission: '待报送',
    submitted: '已报送',
    send_failed: '报送失败',
    superseded: '已失效'
  };

  const dispositionText: Record<RegulatoryFiling['snapshot']['disposition'], string> = {
    continue_observation: '继续观察',
    risk_communication: '风险沟通',
    corrective_action: '纠正措施'
  };

  const canSubmit = $derived(
    showActions && (filing.status === 'pending_submission' || filing.status === 'send_failed')
  );
</script>

<article class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <span class={statusBadge[filing.status]}>{statusText[filing.status]}</span>
        <span class="badge">{filing.kind === 'supplement' ? '补充件' : '首次报送'}</span>
        {#if filing.receiptNo}
          <span class="badge variant-soft-success">回执 {filing.receiptNo}</span>
        {/if}
      </div>
      <p class="mt-2 font-mono text-sm font-semibold">{filing.filingNo}</p>
      <a class="mt-1 block text-sm text-primary-700-300 hover:underline" href={signalHref}>
        {filing.signalId} · {signalTitle}
      </a>
    </div>
    {#if canSubmit}
      <button
        class="btn btn-sm variant-filled-primary"
        type="button"
        disabled={busy || filing.isSubmitting}
        onclick={() => onsubmit?.({ detail: { filing } })}
      >
        {#if busy || filing.isSubmitting}
          报送中…
        {:else if filing.status === 'send_failed'}
          就地重试
        {:else}
          提交报送
        {/if}
      </button>
    {/if}
  </header>

  <div class="section-rule mt-4 pt-4">
    <p class="text-xs font-medium text-surface-500-400">
      冻结快照 · V{filing.snapshot.versionNo} · {dispositionText[filing.snapshot.disposition]}
    </p>
    <p class="mt-1 text-sm">{filing.snapshot.versionSummary}</p>

    <dl class="mt-3 grid gap-2 text-xs text-surface-500-400 md:grid-cols-2">
      <div>
        <dt>证据矩阵（{filing.snapshot.evidence.length} 项）</dt>
        <dd class="mt-1 leading-5">
          {#each filing.snapshot.evidence as item}
            <span class="mr-2">· {item.title}（{item.strength}）</span>
          {/each}
        </dd>
      </div>
      <div>
        <dt>关联批号</dt>
        <dd class="mt-1">{filing.snapshot.batches.join('、')}</dd>
      </div>
    </dl>

    <p class="metric-value mt-3 text-[11px] text-surface-500-400">
      内容指纹 {filing.snapshot.contentHash} · 冻结于 {filing.snapshot.frozenAt.slice(0, 16).replace('T', ' ')}
    </p>
  </div>

  {#if filing.status === 'superseded'}
    <p class="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
      报送后核查内容变化（{filing.supersededReason === 'evidence_changed'
        ? '证据矩阵变化'
        : filing.supersededReason === 'version_changed'
          ? '结论版本变化'
          : '关联批号变化'}
      ），本报送件已于 {filing.supersededAt?.slice(0, 10)} 失效，以补充件为准。
    </p>
  {/if}
  {#if filing.status === 'send_failed'}
    <p class="mt-3 rounded border border-error-300 bg-error-50 p-2 text-xs text-error-900">
      报送失败：{filing.lastError}。报送件保留原报送号与冻结内容，请就地重试，无需重新生成。
    </p>
  {/if}
  {#if filing.status === 'submitted'}
    <p class="mt-3 text-xs text-surface-500-400">
      报送人 {filing.submittedBy ?? '—'} · 报送时间 {filing.submittedAt?.slice(0, 16).replace('T', ' ')}
      {#if !filing.receiptNo}· 等待监管回执{/if}
    </p>
  {/if}
</article>
