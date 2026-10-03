import { browser } from '$app/environment';
import type {
  AuditEntry,
  CaseVersion,
  EvidenceItem,
  FilingInvalidReason,
  FilingStatus,
  InvestigationTask,
  RegulatoryFiling,
  SignalCase,
  SignalStatus,
  RiskLevel
} from '$lib/models/signal';
import { seedSignals } from '$lib/services/seed';
import {
  buildSnapshot,
  contentHashOf,
  filingNumberOf,
  idempotencyKeyFor
} from '$lib/services/filing-snapshot';
import { get, writable } from 'svelte/store';

// v1 只存信号数组；v2 同构但 SignalCase 增加 filings，升级时进入待补报流程。
const STORAGE_KEY = 'medical-safety-signals-v1';

function cloneSeed(): SignalCase[] {
  return structuredClone(seedSignals) as SignalCase[];
}

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function riskFromSeverity(severity: number): RiskLevel {
  if (severity >= 5) return 'critical';
  if (severity >= 4) return 'high';
  if (severity >= 3) return 'medium';
  return 'low';
}

function statusLabel(status: SignalStatus) {
  const labels: Record<SignalStatus, string> = {
    new: '待分派',
    investigating: '调查中',
    observed: '持续观察',
    action_required: '待处置',
    review: '复核中',
    closed: '已关闭'
  };
  return labels[status];
}

type PossiblyLegacySignal = Omit<SignalCase, 'filings'> & { filings?: SignalCase['filings'] };

/**
 * 旧数据升级（同时作用于历史 localStorage 与演示种子）：
 * - 补齐 filings 字段；
 * - 有结论版本、但没有任何报送件的信号，生成一份 initial 待提交件，进入待补报队列。
 */
export function upgradeSignal(raw: PossiblyLegacySignal): SignalCase {
  const signal: SignalCase = structuredClone(raw) as SignalCase;
  if (!Array.isArray(signal.filings)) signal.filings = [];

  if (signal.versions.length > 0 && signal.filings.length === 0) {
    const frozenAt = signal.versions[0].createdAt;
    const snapshot = buildSnapshot(signal, frozenAt);
    const tail = signal.id.split('-').pop() ?? signal.id;
    const filing: RegulatoryFiling = {
      id: `RPT-${tail}`,
      filingNo: filingNumberOf({ signalId: signal.id, snapshot }),
      signalId: signal.id,
      kind: 'initial',
      status: 'pending_submission',
      snapshot,
      submittedBy: null,
      submittedAt: null,
      receiptNo: null,
      supersededAt: null,
      supersededReason: null,
      supersededByFilingId: null,
      lastError: null,
      idempotencyKey: idempotencyKeyFor(signal.id, snapshot),
      createdAt: frozenAt,
      updatedAt: frozenAt,
      isSubmitting: false
    };
    signal.filings = [filing];
    signal.audit.push({
      id: makeId('AUD'),
      actor: '系统',
      action: '历史数据升级',
      detail: `检测到结论 V${snapshot.versionNo} 尚无报送件，报送号 ${filing.filingNo} 已进入待补报队列。`,
      createdAt: frozenAt
    });
  }
  return signal;
}

function readPersisted(): SignalCase[] {
  if (!browser) return cloneSeed().map(upgradeSignal);

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SignalCase[];
      return Array.isArray(parsed) ? parsed.map(upgradeSignal) : cloneSeed().map(upgradeSignal);
    }
    return cloneSeed().map(upgradeSignal);
  } catch {
    return cloneSeed().map(upgradeSignal);
  }
}

const internal = writable<SignalCase[]>(readPersisted());

// 本地写入标记，避免 storage 事件回环
let lastWrittenRaw = '';

if (browser) {
  internal.subscribe((value) => {
    lastWrittenRaw = JSON.stringify(value);
    localStorage.setItem(STORAGE_KEY, lastWrittenRaw);
  });

  // 另一个窗口提交/补证据后，本窗口直接以其持久化结果为准
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue || event.newValue === lastWrittenRaw) return;
    try {
      const next = JSON.parse(event.newValue) as SignalCase[];
      if (Array.isArray(next)) internal.set(next.map(upgradeSignal));
    } catch {
      // 忽略无法解析的跨窗口数据
    }
  });
}

function appendAudit(
  signal: SignalCase,
  actor: string,
  action: string,
  detail: string,
  createdAt: string = now()
) {
  signal.audit.unshift({ id: makeId('AUD'), actor, action, detail, createdAt });
  signal.updatedAt = createdAt;
}

function newFiling(
  signal: SignalCase,
  kind: RegulatoryFiling['kind'],
  createdAt: string
): RegulatoryFiling {
  const snapshot = buildSnapshot(signal, createdAt);
  const filing: RegulatoryFiling = {
    id: makeId('RPT'),
    filingNo: '',
    signalId: signal.id,
    kind,
    status: 'pending_submission',
    snapshot,
    submittedBy: null,
    submittedAt: null,
    receiptNo: null,
    supersededAt: null,
    supersededReason: null,
    supersededByFilingId: null,
    lastError: null,
    idempotencyKey: idempotencyKeyFor(signal.id, snapshot),
    createdAt,
    updatedAt: createdAt,
    isSubmitting: false
  };
  filing.filingNo = filingNumberOf(filing);
  return filing;
}

/**
 * 核查内容变化后核对报送件。
 * - 已报送但快照内容过期：原报送件失效，并确保只有一份补充件（另起一份）；
 * * - 待提交/失败的件：快照就地刷新到最新，不重复生成。
 */
function reconcileFilings(
  signal: SignalCase,
  reason: FilingInvalidReason,
  actor: string,
  changedAt: string
) {
  if (signal.filings.length === 0) return;
  if (signal.versions.length === 0) return;

  const currentHash = contentHashOf(signal);
  const reasonLabel: Record<FilingInvalidReason, string> = {
    evidence_changed: '证据矩阵',
    version_changed: '结论版本',
    batch_changed: '关联批号'
  };

  let supplement: RegulatoryFiling | null =
    signal.filings.find(
      (f) => f.kind === 'supplement' && (f.status === 'pending_submission' || f.status === 'send_failed')
    ) ?? null;

  for (const filing of signal.filings) {
    if (filing.snapshot.contentHash === currentHash) continue;

    if (filing.status === 'submitted') {
      filing.status = 'superseded';
      filing.supersededAt = changedAt;
      filing.supersededReason = reason;
      filing.isSubmitting = false;
      filing.updatedAt = changedAt;

      if (!supplement) {
        supplement = newFiling(signal, 'supplement', changedAt);
        signal.filings.unshift(supplement);
      }
      filing.supersededByFilingId = supplement.id;

      appendAudit(
        signal,
        '系统',
        '报送件失效',
        `${reasonLabel[reason]}与报送号 ${filing.filingNo} 的冻结快照不一致，原报送件失效；` +
          `补充件 ${supplement.filingNo} 已另起一份等待报送。`,
        changedAt
      );
    } else if (filing.status === 'pending_submission' || filing.status === 'send_failed') {
      // 还没真正报出去：内容就地刷新，沿用同一报送件，不产生重复
      const refreshed = buildSnapshot(signal, changedAt);
      filing.snapshot = refreshed;
      filing.filingNo = filingNumberOf({ signalId: signal.id, snapshot: refreshed });
      filing.idempotencyKey = idempotencyKeyFor(signal.id, refreshed);
      filing.updatedAt = changedAt;
    }
  }

  // 已有待报补充件：把它的快照也刷新到最新，避免同一变化堆积多份补充件
  if (supplement && supplement.snapshot.contentHash !== currentHash) {
    const refreshed = buildSnapshot(signal, changedAt);
    supplement.snapshot = refreshed;
    supplement.filingNo = filingNumberOf({ signalId: signal.id, snapshot: refreshed });
    supplement.idempotencyKey = idempotencyKeyFor(signal.id, refreshed);
    supplement.updatedAt = changedAt;
    appendAudit(
      signal,
      actor,
      '补充件快照刷新',
      `待报补充件 ${supplement.filingNo} 的冻结内容已同步至当前核查结果。`,
      changedAt
    );
  }
}

export interface SubmitClaim {
  ok: boolean;
  outcome: 'claimed' | 'already_submitted' | 'concurrent_lost' | 'not_found';
  filing?: RegulatoryFiling;
  /** 冲突时指向已经生效的那份报送件 */
  winnerFilingId?: string;
}

export interface SubmitCommit {
  ok: boolean;
  outcome: 'recorded' | 'failed' | 'already_submitted' | 'not_found';
  filing?: RegulatoryFiling;
}

export const signalStore = {
  subscribe: internal.subscribe,

  add(signal: SignalCase) {
    internal.update((items) => [signal, ...items]);
  },

  create(input: Omit<SignalCase, 'id' | 'openedAt' | 'updatedAt' | 'audit' | 'reopenedCount'>) {
    const createdAt = now();
    const signal: SignalCase = {
      ...input,
      id: `SIG-${new Date().getFullYear()}-${String(get(internal).length + 20).padStart(3, '0')}`,
      openedAt: createdAt,
      updatedAt: createdAt,
      reopenedCount: 0,
      audit: [
        {
          id: makeId('AUD'),
          actor: input.owner,
          action: '建立信号',
          detail: `按${input.sourceType}来源建立核查任务。`,
          createdAt
        }
      ]
    };
    internal.update((items) => [signal, ...items]);
    return signal;
  },

  transition(id: string, nextStatus: SignalStatus, reason: string, actor: string) {
    internal.update((items) =>
      items.map((signal) => {
        if (signal.id !== id) return signal;
        const updated = structuredClone(signal);
        const previous = updated.status;
        updated.status = nextStatus;
        if (nextStatus === 'action_required' && updated.riskLevel === 'low') {
          updated.riskLevel = 'medium';
        }
        appendAudit(
          updated,
          actor,
          '状态流转',
          `${statusLabel(previous)} -> ${statusLabel(nextStatus)}；依据：${reason}`
        );
        return updated;
      })
    );
  },

  addEvidence(id: string, evidence: EvidenceItem, actor: string) {
    internal.update((items) =>
      items.map((signal) => {
        if (signal.id !== id) return signal;
        const updated = structuredClone(signal);
        const batchesBefore = new Set(updated.affectedBatches);
        updated.evidence.unshift(evidence);
        let batchAdded = false;
        if (!batchesBefore.has(evidence.batch)) {
          updated.affectedBatches = [...updated.affectedBatches, evidence.batch].sort();
          batchAdded = true;
        }
        appendAudit(
          updated,
          actor,
          '新增证据',
          `${evidence.title}，证据强度：${evidence.strength}`
        );
        reconcileFilings(updated, batchAdded ? 'batch_changed' : 'evidence_changed', actor, now());
        return updated;
      })
    );
  },

  addVersion(id: string, version: CaseVersion, actor: string) {
    internal.update((items) =>
      items.map((signal) => {
        if (signal.id !== id) return signal;
        const updated = structuredClone(signal);
        updated.versions.unshift(version);
        appendAudit(updated, actor, '形成版本', `版本 V${version.version}：${version.summary}`);
        reconcileFilings(updated, 'version_changed', actor, now());
        return updated;
      })
    );
  },

  reopen(id: string, actor: string, reason: string) {
    internal.update((items) =>
      items.map((signal) => {
        if (signal.id !== id) return signal;
        const updated = structuredClone(signal);
        updated.status = 'investigating';
        updated.reopenedCount += 1;
        appendAudit(updated, actor, '重新打开', reason);
        return updated;
      })
    );
  },

  replaceTask(id: string, task: InvestigationTask) {
    internal.update((items) =>
      items.map((signal) => {
        if (signal.id !== id) return signal;
        const updated = structuredClone(signal);
        updated.tasks = updated.tasks.map((item) => (item.id === task.id ? task : item));
        appendAudit(updated, task.owner, '更新任务', `${task.title}：${task.status}`);
        return updated;
      })
    );
  },

  addAudit(id: string, entry: AuditEntry) {
    internal.update((items) =>
      items.map((signal) => {
        if (signal.id !== id) return signal;
        const updated = structuredClone(signal);
        updated.audit.unshift(entry);
        updated.updatedAt = entry.createdAt;
        return updated;
      })
    );
  },

  /**
   * 生成报送件：冻结当时的证据矩阵、结论版本和关联批号。
   * 已存在同内容的生效/在途件时幂等返回，不重复生成。
   */
  ensureFiling(
    id: string,
    kind: RegulatoryFiling['kind']
  ): { ok: boolean; filing?: RegulatoryFiling; reason?: string } {
    let result: { ok: boolean; filing?: RegulatoryFiling; reason?: string } = {
      ok: false,
      reason: '未找到信号。'
    };
    internal.update((items) =>
      items.map((signal) => {
        if (signal.id !== id) return signal;
        const updated = structuredClone(signal);
        if (updated.versions.length === 0) {
          result = { ok: false, reason: '请先形成结论版本后再生成报送件。' };
          return updated;
        }
        const disposition = updated.versions[0].disposition;
        if (disposition === 'continue_observation') {
          result = { ok: false, reason: '当前结论为继续观察，未达到处置报送条件。' };
          return updated;
        }

        const ts = now();
        const snapshot = buildSnapshot(updated, ts);

        const live = updated.filings.find(
          (f) =>
            f.status !== 'superseded' &&
            (f.status === 'submitted' || f.status === 'pending_submission' || f.status === 'send_failed')
        );
        if (live && live.snapshot.contentHash === snapshot.contentHash) {
          result = { ok: true, filing: live, reason: '同内容报送件已存在，未重复生成。' };
          return updated;
        }

        const filing = newFiling(updated, kind, ts);
        updated.filings.unshift(filing);
        appendAudit(
          updated,
          updated.owner,
          kind === 'supplement' ? '生成补充报送件' : '生成报送件',
          `冻结 V${filing.snapshot.versionNo} 结论、${filing.snapshot.evidence.length} 项证据与批号 ${filing.snapshot.batches.join('、')}；报送号 ${filing.filingNo}。`
        );
        result = { ok: true, filing };
        return updated;
      })
    );
    return result;
  },

  /**
   * 提交前原子占位。两个窗口同时提交时，后到者在此被挡下（concurrent_lost）。
   */
  claimSubmission(filingId: string, submittedBy: string): SubmitClaim {
    let claim: SubmitClaim = { ok: false, outcome: 'not_found' };
    internal.update((items) =>
      items.map((signal) => {
        const target = signal.filings.find((f) => f.id === filingId);
        if (!target) return signal;
        const updated = structuredClone(signal);
        const filing = updated.filings.find((f) => f.id === filingId)!;

        if (filing.status === 'submitted') {
          claim = { ok: false, outcome: 'already_submitted', filing };
          return updated;
        }
        if (filing.isSubmitting) {
          claim = {
            ok: false,
            outcome: 'concurrent_lost',
            winnerFilingId: filingId
          };
          return updated;
        }
        // 同内容是否已被另一份报送件抢先报送（另一个窗口另起的件）
        const winner = updated.filings.find(
          (f) =>
            f.id !== filingId &&
            f.status === 'submitted' &&
            f.idempotencyKey === filing.idempotencyKey
        );
        if (winner) {
          filing.status = 'superseded';
          filing.supersededAt = now();
          filing.supersededReason = 'version_changed';
          filing.supersededByFilingId = winner.id;
          filing.updatedAt = now();
          claim = { ok: false, outcome: 'concurrent_lost', winnerFilingId: winner.id, filing };
          return updated;
        }

        filing.isSubmitting = true;
        filing.submittedBy = submittedBy;
        filing.updatedAt = now();
        claim = { ok: true, outcome: 'claimed', filing: structuredClone(filing) };
        return updated;
      })
    );
    return claim;
  },

  /** 渠道返回后落库：成功标记已报送；失败回到待重试（仍为同一份）。 */
  commitSubmission(
    filingId: string,
    outcome: 'success' | 'failure',
    detail: { submittedAt?: string; error?: string } = {}
  ): SubmitCommit {
    let commit: SubmitCommit = { ok: false, outcome: 'not_found' };
    internal.update((items) =>
      items.map((signal) => {
        if (!signal.filings.some((f) => f.id === filingId)) return signal;
        const updated = structuredClone(signal);
        const filing = updated.filings.find((f) => f.id === filingId)!;
        const ts = now();

        if (outcome === 'success') {
          if (filing.status === 'submitted') {
            commit = { ok: true, outcome: 'already_submitted', filing };
            return updated;
          }
          // 占位之后可能又被另一窗口的同内容件抢先
          const winner = updated.filings.find(
            (f) =>
              f.id !== filingId &&
              f.status === 'submitted' &&
              f.idempotencyKey === filing.idempotencyKey
          );
          if (winner) {
            filing.isSubmitting = false;
            filing.status = 'superseded';
            filing.supersededAt = ts;
            filing.supersededByFilingId = winner.id;
            filing.updatedAt = ts;
            commit = { ok: false, outcome: 'already_submitted', filing: winner };
            return updated;
          }
          filing.status = 'submitted';
          filing.isSubmitting = false;
          filing.submittedAt = detail.submittedAt ?? ts;
          filing.lastError = null;
          filing.updatedAt = ts;
          appendAudit(
            updated,
            filing.submittedBy ?? '安全评审专员',
            '报送监管',
            `报送号 ${filing.filingNo}（${filing.kind === 'supplement' ? '补充件' : '首次报送'}）已提交，以冻结快照为准。`
          );
          commit = { ok: true, outcome: 'recorded', filing: structuredClone(filing) };
        } else {
          filing.status = 'send_failed';
          filing.isSubmitting = false;
          filing.lastError = detail.error ?? '报送渠道异常';
          filing.updatedAt = ts;
          appendAudit(
            updated,
            filing.submittedBy ?? '安全评审专员',
            '报送失败',
            `报送号 ${filing.filingNo} 未送达：${filing.lastError}；可就地重试，报送件不重新生成。`
          );
          commit = { ok: false, outcome: 'failed', filing: structuredClone(filing) };
        }
        return updated;
      })
    );
    return commit;
  },

  /** 释放占位（极少见的本地异常中断时）。 */
  releaseSubmission(filingId: string) {
    internal.update((items) =>
      items.map((signal) => {
        if (!signal.filings.some((f) => f.id === filingId)) return signal;
        const updated = structuredClone(signal);
        const filing = updated.filings.find((f) => f.id === filingId)!;
        if (filing.isSubmitting && filing.status === 'pending_submission') filing.isSubmitting = false;
        return updated;
      })
    );
  },

  /** 回执对账命中后回填回执号。 */
  attachReceipt(filingId: string, receiptNo: string, recordedAt: string): boolean {
    let matched = false;
    internal.update((items) =>
      items.map((signal) => {
        if (!signal.filings.some((f) => f.id === filingId)) return signal;
        const updated = structuredClone(signal);
        const filing = updated.filings.find((f) => f.id === filingId)!;
        if (filing.receiptNo !== receiptNo) {
          filing.receiptNo = receiptNo;
          filing.updatedAt = recordedAt;
          appendAudit(
            updated,
            '监管回执',
            '回执对账',
            `报送号 ${filing.filingNo} 与回执 ${receiptNo} 对账一致。`,
            recordedAt
          );
        }
        matched = true;
        return updated;
      })
    );
    return matched;
  },

  reset() {
    internal.set(cloneSeed().map(upgradeSignal));
    // 回执库依赖信号库，动态取用避免循环导入；演示重置时一并回到初始回执
    void import('./receipt-store').then(({ receiptStore }) => receiptStore.reset());
  },

  getSnapshot() {
    return get(internal);
  },

  getFilingById(filingId: string): RegulatoryFiling | undefined {
    for (const signal of get(internal)) {
      const filing = signal.filings.find((item) => item.id === filingId);
      if (filing) return filing;
    }
    return undefined;
  },

  /** 供回执库在初始化/跨窗口对账后追加审计，避免循环依赖。 */
  pushAudit(signalId: string, entry: AuditEntry) {
    this.addAudit(signalId, entry);
  }
};

// 兼容旧引用：状态标签等保留导出
export function filingStatusLabel(status: FilingStatus): string {
  const labels: Record<FilingStatus, string> = {
    pending_submission: '待报送',
    submitted: '已报送',
    send_failed: '报送失败',
    superseded: '已失效'
  };
  return labels[status];
}

export function createSignalFromForm(input: {
  title: string;
  product: string;
  batch: string;
  sourceType: SignalCase['sourceType'];
  severity: number;
  occurredAt: string;
  description: string;
}): SignalCase {
  const nowIso = now();
  return {
    id: `SIG-${new Date().getFullYear()}-${String(Date.now()).slice(-3)}`,
    title: input.title,
    product: input.product,
    batch: input.batch,
    sourceType: input.sourceType,
    status: 'new',
    riskLevel: riskFromSeverity(input.severity),
    severity: input.severity,
    reportCount: 1,
    exposedUnits: 0,
    occurrenceRate: 0,
    occurredAt: input.occurredAt,
    openedAt: nowIso,
    updatedAt: nowIso,
    owner: '待分派',
    description: input.description,
    affectedBatches: [input.batch],
    evidence: [],
    tasks: [
      {
        id: makeId('TASK'),
        title: '核对来源记录与产品批号',
        owner: '待分派',
        dueAt: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
        status: 'open'
      }
    ],
    versions: [],
    filings: [],
    audit: [
      {
        id: makeId('AUD'),
        actor: '安全台账',
        action: '建立信号',
        detail: '由人工登记表单创建初始信号。',
        createdAt: nowIso
      }
    ],
    reopenedCount: 0
  };
}
