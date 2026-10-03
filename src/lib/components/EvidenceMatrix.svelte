<script lang="ts">
  import type { EvidenceItem } from '$lib/models/signal';

  export let evidence: EvidenceItem[];

  const strengthLabels: Record<EvidenceItem['strength'], string> = {
    strong: '强支持',
    moderate: '中等支持',
    weak: '弱支持',
    contrary: '相反证据'
  };

  const typeLabels: Record<EvidenceItem['type'], string> = {
    complaint: '投诉',
    repair: '维修',
    adverse_event: '不良事件',
    field_report: '现场报告',
    test: '测试',
    literature: '文献'
  };
</script>

<div class="grid gap-3 lg:grid-cols-2">
  {#each evidence as item (item.id)}
    <article
      class="rounded border border-surface-300-700 bg-surface-100-900 p-4 {item.strength === 'strong'
        ? 'evidence-strong'
        : item.strength === 'contrary'
          ? 'evidence-conflicting'
          : 'evidence-weak'}"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p class="text-xs font-medium text-surface-500-400">{typeLabels[item.type]}</p>
          <h4 class="mt-1 font-semibold">{item.title}</h4>
        </div>
        <span class="badge">{strengthLabels[item.strength]}</span>
      </div>
      <p class="mt-3 text-sm text-surface-600-300">{item.note}</p>
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-surface-500-400">
        <span>来源：{item.source}</span>
        <span>批号：{item.batch}</span>
        <span>录入：{item.createdAt.slice(0, 10)}</span>
      </div>
    </article>
  {/each}
</div>
