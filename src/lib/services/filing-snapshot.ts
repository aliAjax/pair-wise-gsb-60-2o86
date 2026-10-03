import type {
  CaseVersion,
  EvidenceItem,
  FilingSnapshot,
  RegulatoryFiling,
  SignalCase
} from '$lib/models/signal';

/**
 * 确定性序列化：对象键排序，保证同一内容在任何时刻得到相同字符串。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/** 32 位 FNV-1a，输出 8 位十六进制。纯前端、稳定、无需依赖。 */
export function hashContent(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 证据矩阵指纹：只取会被报送出去的内容字段。
 * id / createdAt 等台账字段不参与，避免录入时刻差异误判内容变化；
 * 但强度、批号、说明等任何实质内容变动都会改变指纹。
 */
export function evidenceFingerprint(evidence: EvidenceItem[]): string {
  return stableStringify(
    evidence
      .map((item) => ({
        type: item.type,
        title: item.title,
        source: item.source,
        strength: item.strength,
        batch: item.batch,
        note: item.note
      }))
      .sort((a, b) => a.title.localeCompare(b.title))
  );
}

function versionFingerprint(version: CaseVersion): string {
  return stableStringify({
    v: version.version,
    s: version.summary,
    d: version.disposition,
    r: version.rationale
  });
}

/** 构建生成时刻的冻结快照。 */
export function buildSnapshot(signal: SignalCase, frozenAt: string): FilingSnapshot {
  const latest = signal.versions[0];
  if (!latest) {
    throw new Error('尚无结论版本，不能生成报送件。');
  }
  return {
    versionNo: latest.version,
    versionId: latest.id,
    versionSummary: latest.summary,
    disposition: latest.disposition,
    rationale: latest.rationale,
    evidence: structuredClone(signal.evidence),
    batches: [...signal.affectedBatches].sort(),
    product: signal.product,
    status: signal.status,
    riskLevel: signal.riskLevel,
    reportCount: signal.reportCount,
    occurrenceRate: signal.occurrenceRate,
    contentHash: contentHashOf(signal),
    frozenAt
  };
}

/** 当前核查内容指纹：证据矩阵 + 结论版本 + 关联批号。 */
export function contentHashOf(signal: SignalCase): string {
  const latest = signal.versions[0];
  return hashContent(
    stableStringify({
      e: evidenceFingerprint(signal.evidence),
      v: latest ? versionFingerprint(latest) : null,
      b: [...signal.affectedBatches].sort()
    })
  );
}

/** 信号级幂等键：同一份内容只允许一份生效报送件。 */
export function idempotencyKeyFor(signalId: string, snapshot: FilingSnapshot): string {
  return `${signalId}::${snapshot.contentHash}`;
}

/** 报送件编号格式：RPT-信号尾号-哈希前 8 位，重试与补充件各自不同但确定。 */
export function filingNumberOf(filing: Pick<RegulatoryFiling, 'signalId' | 'snapshot'>): string {
  const tail = filing.signalId.split('-').pop() ?? filing.signalId;
  return `RPT-${tail}-${filing.snapshot.contentHash.slice(0, 8)}`.toUpperCase();
}
