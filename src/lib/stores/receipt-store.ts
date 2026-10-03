import { browser } from '$app/environment';
import type {
  ReceiptIssue,
  RegulatorReceipt,
  RegulatoryFiling,
  SignalCase
} from '$lib/models/signal';
import { signalStore } from './signal-store';
import { seedSignals } from '$lib/services/seed';
import { buildSnapshot, filingNumberOf } from '$lib/services/filing-snapshot';
import { get, writable } from 'svelte/store';

const STORAGE_KEY = 'medical-safety-receipts-v1';

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

/** 由种子信号推导其迁移补报件的真实报送号（与 upgradeSignal 口径一致）。 */
function seedFilingNo(signalId: string): string {
  const raw = seedSignals.find((signal) => signal.id === signalId);
  if (!raw) return `RPT-${signalId.split('-').pop()}-UNKNOWN`;
  const legacy = raw as SignalCase;
  const signal: SignalCase = { ...legacy, filings: [] } as SignalCase;
  const snapshot = buildSnapshot(signal, legacy.versions[0].createdAt);
  return filingNumberOf({ signalId, snapshot });
}

function seedReceipts(): RegulatorReceipt[] {
  const no018 = seedFilingNo('SIG-2026-018');
  const no019 = seedFilingNo('SIG-2026-019');
  const no011 = seedFilingNo('SIG-2026-011');

  return [
    {
      id: 'RCV-SEED-01',
      receiptNo: 'JJH-2026-0901',
      // 真实补报件报送号：迁移后尚在待补报 -> 先待核对，用户提交该补报后自动对上
      filingNo: no018,
      signalId: 'SIG-2026-018',
      receivedAt: '2026-09-29T02:00:00.000Z',
      recordedBy: '顾岚',
      note: '模拟：监管回执先到、本地补报尚未报出，留在待核对；提交补报后自动对上。',
      status: 'pending_review',
      issue: 'filing_not_found',
      matchedFilingId: null,
      matchedSignalId: null,
      duplicatedOfReceiptId: null,
      createdAt: '2026-09-29T03:00:00.000Z',
      reconciledAt: null
    },
    {
      id: 'RCV-SEED-02',
      receiptNo: 'JJH-2026-0902',
      // 报送号属于 019，却声称指向 018 -> 指向另一条信号
      filingNo: no019,
      signalId: 'SIG-2026-018',
      receivedAt: '2026-09-29T05:00:00.000Z',
      recordedBy: '顾岚',
      note: '模拟：报送号与指向信号对不上（疑似另一条信号），留在待核对。',
      status: 'pending_review',
      issue: 'signal_mismatch',
      matchedFilingId: null,
      matchedSignalId: null,
      duplicatedOfReceiptId: null,
      createdAt: '2026-09-29T06:00:00.000Z',
      reconciledAt: null
    },
    {
      id: 'RCV-SEED-03',
      receiptNo: 'JJH-2026-0903',
      filingNo: no011,
      signalId: 'SIG-2026-011',
      receivedAt: '2026-09-30T01:00:00.000Z',
      recordedBy: '高远',
      note: '模拟：监管补录回执，待旧数据补报后自动对账。',
      status: 'pending_review',
      issue: 'filing_not_found',
      matchedFilingId: null,
      matchedSignalId: null,
      duplicatedOfReceiptId: null,
      createdAt: '2026-09-30T01:30:00.000Z',
      reconciledAt: null
    },
    {
      id: 'RCV-SEED-03-DUP',
      receiptNo: 'JJH-2026-0903',
      filingNo: no011,
      signalId: 'SIG-2026-011',
      receivedAt: '2026-09-30T01:00:00.000Z',
      recordedBy: '高远',
      note: '模拟：同回执号再次录入。',
      status: 'duplicate',
      issue: null,
      matchedFilingId: null,
      matchedSignalId: null,
      duplicatedOfReceiptId: 'RCV-SEED-03',
      createdAt: '2026-09-30T02:00:00.000Z',
      reconciledAt: '2026-09-30T02:00:00.000Z'
    }
  ];
}

function readPersisted(): RegulatorReceipt[] {
  if (!browser) return seedReceipts();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RegulatorReceipt[]) : seedReceipts();
  } catch {
    return seedReceipts();
  }
}

const internal = writable<RegulatorReceipt[]>(readPersisted());
let lastWrittenRaw = '';

if (browser) {
  internal.subscribe((value) => {
    lastWrittenRaw = JSON.stringify(value);
    localStorage.setItem(STORAGE_KEY, lastWrittenRaw);
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue || event.newValue === lastWrittenRaw) return;
    try {
      const next = JSON.parse(event.newValue);
      if (Array.isArray(next)) internal.set(next);
    } catch {
      // 忽略跨窗口的异常数据
    }
  });
}

function findFiling(
  signals: SignalCase[],
  filingNo: string
): { filing: RegulatoryFiling; signal: SignalCase } | undefined {
  for (const signal of signals) {
    const filing = signal.filings.find((item) => item.filingNo === filingNo);
    if (filing) return { filing, signal };
  }
  return undefined;
}

/**
 * 对账判定（优先级：信号归属 > 报送状态 > 存在性）：
 * - 报送号属于另一条信号 -> signal_mismatch（待核对，最需人工介入）
 * - 报送号存在且信号一致、但尚未真正报出（待报送/失败/失效）-> filing_not_found（报送成功后自动对上）
 * - 找不到报送号 -> filing_not_found（待核对）
 * - 已报送且信号一致 -> 命中
 */
function classify(
  signals: SignalCase[],
  filingNo: string,
  signalId: string
):
  | { kind: 'match'; filing: RegulatoryFiling; signal: SignalCase }
  | { kind: 'issue'; issue: ReceiptIssue; filing?: RegulatoryFiling; actualSignal?: SignalCase } {
  const located = findFiling(signals, filingNo);
  if (!located) {
    return { kind: 'issue', issue: 'filing_not_found' };
  }
  if (located.signal.id !== signalId) {
    return {
      kind: 'issue',
      issue: 'signal_mismatch',
      filing: located.filing,
      actualSignal: located.signal
    };
  }
  if (located.filing.status !== 'submitted') {
    return { kind: 'issue', issue: 'filing_not_found' };
  }
  return { kind: 'match', filing: located.filing, signal: located.signal };
}

export interface RecordReceiptInput {
  receiptNo: string;
  filingNo: string;
  signalId: string;
  receivedAt: string;
  recordedBy: string;
  note?: string;
}

export type RecordReceiptResult =
  | { outcome: 'duplicate'; existing: RegulatorReceipt }
  | { outcome: 'matched'; receipt: RegulatorReceipt; filing: RegulatoryFiling }
  | { outcome: 'pending_review'; receipt: RegulatorReceipt; issue: ReceiptIssue };

export const receiptStore = {
  subscribe: internal.subscribe,

  /**
   * 录入监管回执：
   * 1) 回执号已存在 -> 只记一次，直接返回 duplicate；
   * 2) 报送号找不到报送件 -> 待核对（filing_not_found）；
   * 3) 报送件属于另一条信号 -> 待核对（signal_mismatch）；
   * 4) 一致 -> 对账命中，回填报送件。
   */
  record(input: RecordReceiptInput): RecordReceiptResult {
    const current = get(internal);
    const existing = current.find((item) => item.receiptNo === input.receiptNo.trim());
    if (existing) {
      return { outcome: 'duplicate', existing };
    }

    const ts = now();
    const signals = signalStore.getSnapshot();
    const verdict = classify(signals, input.filingNo.trim(), input.signalId.trim());

    let receipt: RegulatorReceipt;
    let result: RecordReceiptResult;

    if (verdict.kind === 'issue') {
      receipt = {
        id: makeId('RCV'),
        receiptNo: input.receiptNo.trim(),
        filingNo: input.filingNo.trim(),
        signalId: input.signalId.trim(),
        receivedAt: input.receivedAt,
        recordedBy: input.recordedBy,
        note: input.note ?? null,
        status: 'pending_review',
        issue: verdict.issue,
        matchedFilingId: verdict.filing?.id ?? null,
        matchedSignalId: verdict.actualSignal?.id ?? null,
        duplicatedOfReceiptId: null,
        createdAt: ts,
        reconciledAt: null
      };
      result = { outcome: 'pending_review', receipt, issue: verdict.issue };
    } else {
      receipt = {
        id: makeId('RCV'),
        receiptNo: input.receiptNo.trim(),
        filingNo: verdict.filing.filingNo,
        signalId: verdict.signal.id,
        receivedAt: input.receivedAt,
        recordedBy: input.recordedBy,
        note: input.note ?? null,
        status: 'matched',
        issue: null,
        matchedFilingId: verdict.filing.id,
        matchedSignalId: verdict.signal.id,
        duplicatedOfReceiptId: null,
        createdAt: ts,
        reconciledAt: ts
      };
      signalStore.attachReceipt(verdict.filing.id, receipt.receiptNo, ts);
      result = { outcome: 'matched', receipt, filing: verdict.filing };
    }

    internal.update((items) => [receipt, ...items]);
    return result;
  },

  /**
   * 重新对账：报送成功、补报生成后调用。
   * 只处理待核对回执；重复回执永不复活。
   */
  reconcile(): Array<{ receiptNo: string; filingNo: string }> {
    const signals = signalStore.getSnapshot();
    const newlyMatched: Array<{ receiptNo: string; filingNo: string }> = [];

    internal.update((items) =>
      items.map((receipt) => {
        if (receipt.status !== 'pending_review') return receipt;
        const verdict = classify(signals, receipt.filingNo, receipt.signalId);
        if (verdict.kind === 'issue') {
          return {
            ...receipt,
            issue: verdict.issue,
            matchedFilingId: verdict.filing?.id ?? null,
            matchedSignalId: verdict.actualSignal?.id ?? null
          } satisfies RegulatorReceipt;
        }

        const ts = now();
        signalStore.attachReceipt(verdict.filing.id, receipt.receiptNo, ts);
        newlyMatched.push({ receiptNo: receipt.receiptNo, filingNo: receipt.filingNo });
        return {
          ...receipt,
          status: 'matched',
          issue: null,
          matchedFilingId: verdict.filing.id,
          matchedSignalId: verdict.signal.id,
          reconciledAt: ts
        } satisfies RegulatorReceipt;
      })
    );

    return newlyMatched;
  },

  reset() {
    internal.set(seedReceipts());
  }
};
