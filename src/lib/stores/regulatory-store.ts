import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import type {
  AuditSeed,
  RegulatoryReport,
  RegulatoryReceipt,
  RegulatoryState
} from '$lib/models/regulatory';
import {
  applySubmissionAttempt,
  generateReport as coreGenerate,
  makeId,
  prepareSubmit,
  reconcile,
  recordReceipt,
  resolvePendingReceipt
} from '$lib/services/regulatory-core';
import { signalStore, onSignalsChange } from './signal-store';

const REGULATORY_KEY = 'medical-safety-regulatory-v1';

function readPersisted(): RegulatoryState {
  if (!browser) return { reports: [], receipts: [] };
  try {
    const raw = localStorage.getItem(REGULATORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RegulatoryState;
      return { reports: parsed.reports ?? [], receipts: parsed.receipts ?? [] };
    }
  } catch {
    // 数据损坏时从空状态重建
  }
  return { reports: [], receipts: [] };
}

const internal = writable<RegulatoryState>(browser ? readPersisted() : { reports: [], receipts: [] });

function persist(state: RegulatoryState) {
  if (browser) localStorage.setItem(REGULATORY_KEY, JSON.stringify(state));
}

/** 把核心产出的审计种子追加到信号审计流；带稳定 id 的走幂等写入 */
function attachAudits(items: Array<AuditSeed & { signalId?: string }>) {
  for (const item of items) {
    if (!item.signalId) continue;
    const entry = {
      id: item.id ?? makeId('AUD'),
      actor: item.actor,
      action: item.action,
      detail: item.detail,
      createdAt: item.at
    };
    if (item.id) signalStore.upsertAudit(item.signalId, entry);
    else signalStore.addAudit(item.signalId, entry);
  }
}

/**
 * 按当前信号全量对账：旧数据升级待补报 + 已报送件冻结漂移失效。
 * 对账类审计均带稳定 id，跨窗口对齐时经 upsertAudit 幂等去重，不会重复记账。
 */
function runReconcile(_origin: 'init' | 'local' | 'external') {
  const snapshot = get(internal);
  const result = reconcile(snapshot, signalStore.getSnapshot());
  if (!result.audits.length && result.state === snapshot) return;
  internal.set(result.state);
  persist(result.state);
  attachAudits(result.audits);
}

if (browser) {
  // 初始化升级：结论版本无报送件 -> 待补报
  runReconcile('init');

  // 信号变化即对账：本窗口补证据/新版本/批号使原报送件失效；跨窗口仅对齐状态
  onSignalsChange((_signals, origin) => runReconcile(origin));

  // 另一个窗口写入的报送状态直接同步
  window.addEventListener('storage', (event) => {
    if (event.key !== REGULATORY_KEY || !event.newValue) return;
    try {
      internal.set(JSON.parse(event.newValue) as RegulatoryState);
    } catch {
      // 忽略损坏数据
    }
  });
}

function updateWithAudits(next: RegulatoryState, audits: AuditSeed[], signalId?: string) {
  internal.set(next);
  persist(next);
  attachAudits(audits.map((item) => ({ ...item, signalId })));
}

export const regulatoryStore = {
  subscribe: internal.subscribe,

  getSnapshot() {
    return get(internal);
  },

  /** 生成报送件（或从待补报生成补报件）；补充件另起一份 */
  generate(signalId: string, actor: string): { ok: boolean; reason?: string; report?: RegulatoryReport } {
    const signal = signalStore.getSnapshot().find((item) => item.id === signalId);
    if (!signal) return { ok: false, reason: '信号不存在。' };
    const outcome = coreGenerate(get(internal), signal, actor);
    if (!outcome.ok) return { ok: false, reason: outcome.reason };
    updateWithAudits(outcome.state, outcome.audits, signalId);
    return { ok: true, report: outcome.report };
  },

  /**
   * 提交前准备：状态校验 + 提交前重新冻结（草稿内容漂移时就地重冻）。
   * 返回最新 state 供 service 调用模拟监管网关。
   */
  beginSubmit(
    reportId: string,
    actor: string
  ): { ok: boolean; reason?: string; state: RegulatoryState } {
    const report = get(internal).reports.find((item) => item.id === reportId);
    if (!report) return { ok: false, reason: '报送件不存在。', state: get(internal) };
    const signal = signalStore.getSnapshot().find((item) => item.id === report.signalId);
    if (!signal) return { ok: false, reason: '信号不存在。', state: get(internal) };

    const outcome = prepareSubmit(get(internal), reportId, signal, actor);
    if (!outcome.ok) return { ok: false, reason: outcome.reason, state: outcome.state };
    if (outcome.audits.length > 0) updateWithAudits(outcome.state, outcome.audits, report.signalId);
    return { ok: true, state: get(internal) };
  },

  /** 记录一次提交尝试；失败保留同件就地重试，不生成新报送件 */
  recordAttempt(
    reportId: string,
    params: { actor: string; success: boolean; gatewayReportNo?: string; error?: string }
  ) {
    const report = get(internal).reports.find((item) => item.id === reportId);
    if (!report) return;
    const outcome = applySubmissionAttempt(get(internal), reportId, params);
    updateWithAudits(outcome.state, outcome.audits, report.signalId);
  },

  /** 录入监管回执：按回执号去重、按报送号/信号对账，对不上进待核对 */
  addReceipt(input: {
    receiptNo: string;
    receivedAt: string;
    gatewayReportNo?: string;
    signalId?: string;
    actor: string;
  }): { ok: boolean; duplicate?: boolean; reason?: string; receipt?: RegulatoryReceipt } {
    const outcome = recordReceipt(get(internal), input);
    if (!outcome.ok) return { ok: false, duplicate: outcome.duplicate, reason: outcome.reason };
    internal.set(outcome.state);
    persist(outcome.state);
    const matchedReport = outcome.state.reports.find(
      (report) => report.id === outcome.receipt?.matchedReportId
    );
    attachAudits(
      outcome.audits.map((item) => ({ ...item, signalId: matchedReport?.signalId ?? input.signalId }))
    );
    return { ok: true, receipt: outcome.receipt };
  },

  /** 人工核对待核对回执并挂接到报送件 */
  resolveReceipt(input: { receiptId: string; reportId: string; note: string; actor: string }) {
    const report = get(internal).reports.find((item) => item.id === input.reportId);
    const outcome = resolvePendingReceipt(get(internal), input);
    if (!outcome.ok) return { ok: false, reason: outcome.reason };
    updateWithAudits(outcome.state, outcome.audits, report?.signalId);
    return { ok: true };
  },

  reset() {
    const empty: RegulatoryState = { reports: [], receipts: [] };
    internal.set(empty);
    persist(empty);
  }
};
