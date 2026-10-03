import type {
  AuditSeed,
  FrozenEvidence,
  FrozenSnapshot,
  FrozenVersion,
  RegulatoryReceipt,
  RegulatoryReport,
  RegulatoryState,
  ReportStatus
} from '$lib/models/regulatory';
import type { SignalCase } from '$lib/models/signal';

/**
 * 报送链路纯函数核心：不触碰 store / localStorage / 网络，
 * 所有规则（冻结、失效、补充、对账、提交、旧数据升级）集中在此，便于测试。
 */

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

/** 递归按键名排序，得到与字段书写顺序无关的规范结构 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, canonicalize(source[key])])
    );
  }
  return value;
}

/** 稳定哈希：字段顺序无关，忽略时间戳；确定性 djb2 */
export function stableHash(value: unknown): string {
  const json = JSON.stringify(canonicalize(value));
  let hash = 5381;
  for (let i = 0; i < json.length; i += 1) {
    hash = ((hash << 5) + hash + json.charCodeAt(i)) >>> 0;
  }
  return `h${hash.toString(16).padStart(8, '0')}`;
}

export function freezeSignal(signal: SignalCase, at = nowIso()): FrozenSnapshot {
  const evidence: FrozenEvidence[] = signal.evidence.map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    source: item.source,
    strength: item.strength,
    batch: item.batch,
    note: item.note
  }));

  const latest = signal.versions[0];
  const version: FrozenVersion | null = latest
    ? {
        id: latest.id,
        version: latest.version,
        author: latest.author,
        summary: latest.summary,
        disposition: latest.disposition,
        rationale: latest.rationale,
        createdAt: latest.createdAt
      }
    : null;

  const batches = [...signal.affectedBatches].sort();
  const evidenceHash = stableHash({ evidence, version, batches });

  return { evidenceHash, evidence, version, batches, frozenAt: at };
}

function digestOf(snapshot: FrozenSnapshot): string {
  return stableHash({
    evidence: snapshot.evidence,
    version: snapshot.version,
    batches: snapshot.batches
  });
}

/** 报送件冻结内容相对当前信号是否已漂移（证据矩阵 / 结论版本 / 批号任一变化） */
export function isSnapshotStale(report: RegulatoryReport, signal: SignalCase): boolean {
  const current = freezeSignal(signal, report.snapshot.frozenAt);
  return digestOf(current) !== digestOf(report.snapshot);
}

/** 仍具报送效力的状态；已失效件的任何新变化不再重复记失效 */
const LIVE_STATUSES: ReportStatus[] = ['submitted', 'acknowledged'];

export function reportsForSignal(state: RegulatoryState, signalId: string): RegulatoryReport[] {
  return state.reports
    .filter((report) => report.signalId === signalId)
    .sort((a, b) => b.seq - a.seq);
}

function nextSeq(state: RegulatoryState, signalId: string): number {
  return state.reports.reduce((max, report) => (report.signalId === signalId ? Math.max(max, report.seq) : max), 0) + 1;
}

function pushAudit(target: AuditSeed[], actor: string, action: string, detail: string, at = nowIso()) {
  target.push({ actor, action, detail, at });
}

export interface ReconcileResult {
  state: RegulatoryState;
  audits: Array<AuditSeed & { signalId: string }>;
}

/**
 * 对全部信号做一次链路对账，两类动作：
 * 1. 旧数据升级：有结论版本但没有任何报送件的信号，建「待补报」占位（幂等）；
 * 2. 已报送/已回执件冻结内容发生漂移：原报送件失效（幂等）。
 */
export function reconcile(state: RegulatoryState, signals: SignalCase[], at = nowIso()): ReconcileResult {
  const audits: Array<AuditSeed & { signalId: string }> = [];
  let changed = false;
  const reports = state.reports.map((report) => {
    if (!LIVE_STATUSES.includes(report.status)) return report;
    const signal = signals.find((item) => item.id === report.signalId);
    if (!signal || !isSnapshotStale(report, signal)) return report;

    changed = true;
    audits.push({
      id: `AUD-RPT-INV-${report.id}`,
      signalId: report.signalId,
      actor: '系统',
      action: '报送件失效',
      detail:
        `报送件 ${report.id} 冻结的证据矩阵/结论版本/关联批号已发生变化，原报送件标记失效，` +
        '需另起补充报送。',
      at
    });
    return { ...report, status: 'invalidated' as const, invalidatedAt: at, invalidateReason: '冻结内容发生变化' };
  });

  for (const signal of signals) {
    if (signal.versions.length === 0) continue;
    if (state.reports.some((report) => report.signalId === signal.id)) continue;

    const id = `RPT-${signal.id.replace(/^SIG-/, '')}-0`;
    reports.push({
      id,
      signalId: signal.id,
      kind: 'backfill',
      seq: 0,
      status: 'pending_backfill',
      snapshot: { evidenceHash: '', evidence: [], version: null, batches: [], frozenAt: at },
      attempts: [],
      createdAt: at,
      createdBy: '系统升级'
    });
    changed = true;
    audits.push({
      id: `AUD-RPT-BACKFILL-${signal.id}`,
      signalId: signal.id,
      actor: '系统',
      action: '旧数据升级',
      detail: '检测到结论版本但缺少报送件，已列入待补报队列。',
      at
    });
  }

  if (!changed) return { state, audits: [] };
  return { state: { ...state, reports }, audits };
}

export interface GenerateOutcome {
  ok: boolean;
  reason?: string;
  state: RegulatoryState;
  report?: RegulatoryReport;
  audits: AuditSeed[];
}

/**
 * 生成报送件：冻结当前证据矩阵、结论版本和关联批号。
 * - 初次报送：从待补报占位转为补报件，或为无件信号新建初次件；
 * - 已有有效件时拒绝生成（避免重复）；
 * - 最新件已失效时，另起一份补充件。
 */
export function generateReport(
  state: RegulatoryState,
  signal: SignalCase,
  actor: string,
  at = nowIso()
): GenerateOutcome {
  if (signal.versions.length === 0) {
    return {
      ok: false,
      reason: '尚未形成结论版本，不满足报送条件。',
      state,
      audits: []
    };
  }

  const existing = reportsForSignal(state, signal.id);
  const pending = existing.find((report) => report.status === 'pending_backfill');
  const live = existing.find((report) => LIVE_STATUSES.includes(report.status));
  if (live) {
    return {
      ok: false,
      reason: `报送件 ${live.id} 仍为「${live.status === 'submitted' ? '已报送' : '已回执'}」，无需重复生成；内容变化时应使用补充件。`,
      state,
      audits: []
    };
  }
  const editable = existing.find(
    (report) => report.status === 'draft' || report.status === 'submission_failed'
  );
  if (editable) {
    return {
      ok: false,
      reason: `报送件 ${editable.id} 尚未提交，请直接提交；提交失败可就地重试，不重复生成。`,
      state,
      audits: []
    };
  }

  const snapshot = freezeSignal(signal, at);
  const audits: AuditSeed[] = [];

  if (pending) {
    const report: RegulatoryReport = {
      ...pending,
      id: `RPT-${signal.id.replace(/^SIG-/, '')}-1`,
      kind: 'backfill',
      seq: 1,
      status: 'draft',
      snapshot,
      createdBy: actor
    };
    const next: RegulatoryState = {
      ...state,
      reports: state.reports.map((item) => (item.id === pending.id ? report : item))
    };
    pushAudit(
      audits,
      actor,
      '生成补报件',
      `补报件 ${report.id} 已冻结证据矩阵（${snapshot.evidence.length} 项）、结论版本和关联批号。`,
      at
    );
    return { ok: true, state: next, report, audits };
  }

  const latest = existing[0];
  const isFirst = !latest;
  const seq = nextSeq(state, signal.id);
  const report: RegulatoryReport = {
    id: `RPT-${signal.id.replace(/^SIG-/, '')}-${seq}`,
    signalId: signal.id,
    kind: isFirst ? 'initial' : 'supplement',
    seq,
    status: 'draft',
    snapshot,
    supersedesId: isFirst ? undefined : latest.id,
    attempts: [],
    createdAt: at,
    createdBy: actor
  };
  const next: RegulatoryState = { ...state, reports: [...state.reports, report] };

  pushAudit(
    audits,
    actor,
    isFirst ? '生成报送件' : '生成补充报送件',
    isFirst
      ? `报送件 ${report.id} 已冻结证据矩阵（${snapshot.evidence.length} 项）、结论版本 V${snapshot.version?.version ?? '-'} 和关联批号。`
      : `原报送件 ${latest.id} 已失效，补充报送件 ${report.id} 另起一份并重新冻结证据矩阵、结论版本和关联批号。`,
    at
  );
  return { ok: true, state: next, report, audits };
}

export interface PrepareOutcome {
  ok: boolean;
  reason?: string;
  /** 提交前快照已漂移的草稿是否完成了就地重新冻结 */
  refrozen?: boolean;
  audits: AuditSeed[];
}

/**
 * 提交前检查：只允许草稿/失败件提交；提交前若发现冻结内容已漂移，
 * 就地重新冻结同一份报送件（尚未报送，不构成对监管件的覆盖），并记录审计。
 */
export function prepareSubmit(
  state: RegulatoryState,
  reportId: string,
  signal: SignalCase,
  actor: string,
  at = nowIso()
): PrepareOutcome & { state: RegulatoryState } {
  const report = state.reports.find((item) => item.id === reportId);
  if (!report || report.signalId !== signal.id) {
    return { ok: false, reason: '报送件不存在或不属于该信号。', state, audits: [] };
  }
  if (report.status !== 'draft' && report.status !== 'submission_failed') {
    return { ok: false, reason: `当前状态不可提交（${report.status}）。`, state, audits: [] };
  }

  if (!isSnapshotStale(report, signal)) {
    return { ok: true, state, audits: [] };
  }

  const snapshot = freezeSignal(signal, at);
  const next: RegulatoryState = {
    ...state,
    reports: state.reports.map((item) => (item.id === reportId ? { ...item, snapshot } : item))
  };
  return {
    ok: true,
    refrozen: true,
    state: next,
    audits: [
      {
        actor,
        action: '提交前重新冻结',
        detail: `报送件 ${reportId} 提交前发现内容变化，已就地重新冻结证据矩阵、结论版本和关联批号。`,
        at
      }
    ]
  };
}

export interface AttemptResult {
  ok: boolean;
  state: RegulatoryState;
  report?: RegulatoryReport;
  audits: AuditSeed[];
}

/** 记录一次提交尝试：成功转入已报送并记下网关报送号，失败保留同件供就地重试 */
export function applySubmissionAttempt(
  state: RegulatoryState,
  reportId: string,
  params: { actor: string; success: boolean; gatewayReportNo?: string; error?: string; at?: string }
): AttemptResult {
  const at = params.at ?? nowIso();
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) return { ok: false, state, audits: [] };

  const attempt = {
    at,
    actor: params.actor,
    ok: params.success,
    ...(params.success ? { gatewayReportNo: params.gatewayReportNo } : { error: params.error })
  };
  const updated: RegulatoryReport = {
    ...report,
    attempts: [...report.attempts, attempt],
    ...(params.success
      ? { status: 'submitted' as const, submittedAt: at, gatewayReportNo: params.gatewayReportNo }
      : { status: 'submission_failed' as const })
  };

  const next: RegulatoryState = {
    ...state,
    reports: state.reports.map((item) => (item.id === reportId ? updated : item))
  };

  const audits: AuditSeed[] = [
    params.success
      ? {
          actor: params.actor,
          action: '报送监管',
          detail: `报送件 ${reportId} 提交成功，监管报送号 ${params.gatewayReportNo}。`,
          at
        }
      : {
          actor: params.actor,
          action: '报送提交失败',
          detail: `报送件 ${reportId} 提交失败（${params.error ?? '未知错误'}），保留原报送件待就地重试。`,
          at
        }
  ];

  return { ok: params.success, state: next, report: updated, audits };
}

export interface ReceiptOutcome {
  ok: boolean;
  duplicate?: boolean;
  reason?: string;
  receipt?: RegulatoryReceipt;
  state: RegulatoryState;
  audits: AuditSeed[];
}

/**
 * 录入监管回执并按 回执号 / 报送号 / 信号 对账：
 * - 回执号重复：只记一次，直接驳回；
 * - 对不上报送件，或引用的信号与报送件不一致：进入待核对；
 * - 精确匹配：报送件转已回执。
 */
export function recordReceipt(
  state: RegulatoryState,
  input: {
    receiptNo: string;
    receivedAt: string;
    gatewayReportNo?: string;
    signalId?: string;
    actor: string;
    at?: string;
  }
): ReceiptOutcome {
  const at = input.at ?? nowIso();

  if (state.receipts.some((item) => item.receiptNo === input.receiptNo)) {
    return { ok: false, duplicate: true, reason: '该回执号已录入，重复回执只记一次。', state, audits: [] };
  }

  const byGateway = input.gatewayReportNo
    ? state.reports.find((report) => report.gatewayReportNo === input.gatewayReportNo)
    : undefined;

  let matched: RegulatoryReport | undefined;
  let reviewNote: string | undefined;

  if (byGateway) {
    if (input.signalId && input.signalId !== byGateway.signalId) {
      reviewNote = `回执引用信号 ${input.signalId} 与报送号 ${input.gatewayReportNo} 所属信号 ${byGateway.signalId} 不一致。`;
    } else if (byGateway.status === 'invalidated') {
      reviewNote = `报送号 ${input.gatewayReportNo} 对应的报送件 ${byGateway.id} 已失效，需人工核对回执归属。`;
    } else {
      matched = byGateway;
    }
  } else {
    const liveForSignal = input.signalId
      ? state.reports
          .filter((report) => report.signalId === input.signalId && LIVE_STATUSES.includes(report.status))
          .sort((a, b) => b.seq - a.seq)
      : [];
    if (!input.gatewayReportNo && liveForSignal.length === 1) {
      matched = liveForSignal[0];
    } else {
      reviewNote = !input.gatewayReportNo
        ? '回执未提供监管报送号，无法唯一对应报送件。'
        : `报送号 ${input.gatewayReportNo} 在本地报送件中查无对应记录。`;
    }
  }

  const receipt: RegulatoryReceipt = {
    id: makeId('RCP'),
    receiptNo: input.receiptNo,
    receivedAt: input.receivedAt,
    recordedAt: at,
    recordedBy: input.actor,
    gatewayReportNo: input.gatewayReportNo || undefined,
    signalId: input.signalId || undefined,
    status: matched ? 'recorded' : 'pending_review',
    matchedReportId: matched?.id,
    reviewNote
  };

  const nextReports = matched
    ? state.reports.map((report) => (report.id === matched.id ? { ...report, status: 'acknowledged' as const } : report))
    : state.reports;

  const next: RegulatoryState = {
    reports: nextReports,
    receipts: [...state.receipts, receipt]
  };

  const audits: AuditSeed[] = matched
    ? [
        {
          actor: input.actor,
          action: '监管回执对账',
          detail: `回执 ${input.receiptNo} 与报送件 ${matched.id} 对账成功，报送件转入已回执。`,
          at
        }
      ]
    : [
        {
          actor: input.actor,
          action: '回执待核对',
          detail: `回执 ${input.receiptNo}${reviewNote ? `：${reviewNote}` : ''} 留在待核对队列。`,
          at
        }
      ];

  return { ok: true, receipt, state: next, audits };
}

export interface ResolveOutcome {
  ok: boolean;
  reason?: string;
  state: RegulatoryState;
  audits: AuditSeed[];
}

/** 人工核对待核对回执：指定报送件后完成对账 */
export function resolvePendingReceipt(
  state: RegulatoryState,
  input: { receiptId: string; reportId: string; note: string; actor: string; at?: string }
): ResolveOutcome {
  const at = input.at ?? nowIso();
  const receipt = state.receipts.find((item) => item.id === input.receiptId);
  if (!receipt) return { ok: false, reason: '回执不存在。', state, audits: [] };
  if (receipt.status !== 'pending_review') {
    return { ok: false, reason: '该回执不在待核对状态。', state, audits: [] };
  }
  const report = state.reports.find((item) => item.id === input.reportId);
  if (!report) return { ok: false, reason: '目标报送件不存在。', state, audits: [] };

  const next: RegulatoryState = {
    reports: state.reports.map((item) =>
      item.id === input.reportId && item.status !== 'invalidated'
        ? { ...item, status: 'acknowledged' as const }
        : item
    ),
    receipts: state.receipts.map((item) =>
      item.id === input.receiptId
        ? { ...item, status: 'recorded', matchedReportId: input.reportId, reviewNote: input.note }
        : item
    )
  };

  return {
    ok: true,
    state: next,
    audits: [
      {
        actor: input.actor,
        action: '回执人工核对',
        detail: `回执 ${receipt.receiptNo} 经人工核对挂接到报送件 ${input.reportId}：${input.note}`,
        at
      }
    ]
  };
}
