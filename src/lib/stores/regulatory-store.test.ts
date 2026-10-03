// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceItem, SignalCase } from '$lib/models/signal';
import { makeSignal } from '$lib/testing/signal-fixtures';

vi.mock('$app/environment', () => ({ browser: true }));

const SIGNAL_KEY = 'medical-safety-signals-v1';

function seedLocalStorage(signals: SignalCase[]) {
  localStorage.clear();
  localStorage.setItem(SIGNAL_KEY, JSON.stringify(signals));
}

async function loadChain() {
  vi.resetModules();
  const { signalStore } = await import('./signal-store');
  const { regulatoryStore } = await import('./regulatory-store');
  const { submitRegulatoryReport } = await import('$lib/services/regulatory-service');
  return { signalStore, regulatoryStore, submitRegulatoryReport };
}

function newEvidence(id: string): EvidenceItem {
  return {
    id,
    type: 'complaint',
    title: '补充的投诉证据名称',
    source: '客服工单',
    strength: 'moderate',
    batch: 'B1',
    note: '报送后补充的核查说明。',
    createdAt: '2026-10-03T00:00:00.000Z'
  };
}

describe('报送链路集成（store 接线）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('旧数据升级 -> 生成 -> 报送 -> 补证据自动失效；审计可追溯', async () => {
    const signal = makeSignal({ id: 'SIG-2026-100' });
    seedLocalStorage([signal]);
    const { signalStore, regulatoryStore } = await loadChain();

    // 升级：有结论版本无报送件 -> 待补报
    let reports = regulatoryStore.getSnapshot().reports;
    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe('pending_backfill');

    // 生成补报件并冻结
    const generated = regulatoryStore.generate(signal.id, '专员甲');
    expect(generated.ok).toBe(true);
    expect(generated.report!.status).toBe('draft');
    expect(generated.report!.snapshot.evidence).toHaveLength(1);

    // 报送成功
    regulatoryStore.recordAttempt(generated.report!.id, {
      actor: '专员甲',
      success: true,
      gatewayReportNo: 'GOV-2026-0001'
    });
    expect(regulatoryStore.getSnapshot().reports[0].status).toBe('submitted');

    // 报送后补证据 -> 原报送件自动失效
    signalStore.addEvidence(signal.id, newEvidence('E-NEW'), '专员甲');
    reports = regulatoryStore.getSnapshot().reports;
    expect(reports[0].status).toBe('invalidated');

    // 失效后另起补充件
    const updatedSignal = signalStore.getSnapshot().find((item) => item.id === signal.id)!;
    const supplement = regulatoryStore.generate(signal.id, '专员甲');
    expect(supplement.ok).toBe(true);
    expect(supplement.report!.kind).toBe('supplement');
    expect(supplement.report!.supersedesId).toBe(reports[0].id);
    expect(supplement.report!.snapshot.evidence).toHaveLength(2);
    expect(regulatoryStore.getSnapshot().reports).toHaveLength(2);

    // 审计流含失效与补充记录
    const audits = updatedSignal.audit.map((entry) => entry.action);
    expect(audits).toContain('报送件失效');
  });

  it('草稿补证据不失效，提交前就地重新冻结', async () => {
    const signal = makeSignal({ id: 'SIG-2026-101' });
    seedLocalStorage([signal]);
    const { signalStore, regulatoryStore } = await loadChain();

    const generated = regulatoryStore.generate(signal.id, '专员甲');
    signalStore.addEvidence(signal.id, newEvidence('E-NEW'), '专员甲');

    const report = regulatoryStore.getSnapshot().reports[0];
    expect(report.status).toBe('draft'); // 草稿不失效

    const prepared = regulatoryStore.beginSubmit(report.id, '专员甲');
    expect(prepared.ok).toBe(true);
    expect(regulatoryStore.getSnapshot().reports[0].snapshot.evidence).toHaveLength(2);
  });

  it('重复生成被拒绝：已报送后不允许重复生成', async () => {
    const signal = makeSignal({ id: 'SIG-2026-102' });
    seedLocalStorage([signal]);
    const { regulatoryStore } = await loadChain();

    const generated = regulatoryStore.generate(signal.id, '专员甲');
    regulatoryStore.recordAttempt(generated.report!.id, {
      actor: '专员甲',
      success: true,
      gatewayReportNo: 'GOV-2026-0002'
    });
    const duplicate = regulatoryStore.generate(signal.id, '专员甲');
    expect(duplicate.ok).toBe(false);
    expect(regulatoryStore.getSnapshot().reports).toHaveLength(1);
  });
});

describe('回执对账集成', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('成功对账、重复回执只记一次、对不上进待核对', async () => {
    const signal = makeSignal({ id: 'SIG-2026-200' });
    seedLocalStorage([signal]);
    const { regulatoryStore } = await loadChain();

    const generated = regulatoryStore.generate(signal.id, '专员甲');
    regulatoryStore.recordAttempt(generated.report!.id, {
      actor: '专员甲',
      success: true,
      gatewayReportNo: 'GOV-2026-0100'
    });

    const matched = regulatoryStore.addReceipt({
      receiptNo: 'RCP-1',
      receivedAt: '2026-10-03',
      gatewayReportNo: 'GOV-2026-0100',
      actor: '联络人'
    });
    expect(matched.ok).toBe(true);
    expect(matched.receipt!.status).toBe('recorded');
    expect(regulatoryStore.getSnapshot().reports[0].status).toBe('acknowledged');

    const duplicate = regulatoryStore.addReceipt({
      receiptNo: 'RCP-1',
      receivedAt: '2026-10-04',
      gatewayReportNo: 'GOV-2026-0100',
      actor: '联络人'
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(regulatoryStore.getSnapshot().receipts).toHaveLength(1);

    const unknown = regulatoryStore.addReceipt({
      receiptNo: 'RCP-2',
      receivedAt: '2026-10-03',
      gatewayReportNo: 'GOV-NOPE',
      actor: '联络人'
    });
    expect(unknown.receipt!.status).toBe('pending_review');

    const cross = regulatoryStore.addReceipt({
      receiptNo: 'RCP-3',
      receivedAt: '2026-10-03',
      gatewayReportNo: 'GOV-2026-0100',
      signalId: 'SIG-OTHER-1',
      actor: '联络人'
    });
    expect(cross.receipt!.status).toBe('pending_review');
    expect(regulatoryStore.getSnapshot().receipts).toHaveLength(3);
  });
});

describe('提交服务：就地重试与同信号并发', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('提交失败就地重试成功，不重新生成报送件', async () => {
    const signal = makeSignal({ id: 'SIG-2026-300' });
    seedLocalStorage([signal]);
    const { regulatoryStore, submitRegulatoryReport } = await loadChain();

    const generated = regulatoryStore.generate(signal.id, '专员甲');
    const reportId = generated.report!.id;

    const failed = await submitRegulatoryReport(reportId, '专员甲', { simulateFail: true });
    expect(failed.ok).toBe(false);
    expect(regulatoryStore.getSnapshot().reports[0].status).toBe('submission_failed');

    const retried = await submitRegulatoryReport(reportId, '专员甲');
    expect(retried.ok).toBe(true);
    const report = regulatoryStore.getSnapshot().reports[0];
    expect(report.status).toBe('submitted');
    expect(report.id).toBe(reportId);
    expect(report.attempts).toHaveLength(2);
  });

  it('同一条信号两次同时提交只有先到的生效', async () => {
    const signal = makeSignal({ id: 'SIG-2026-301' });
    seedLocalStorage([signal]);
    const { regulatoryStore, submitRegulatoryReport } = await loadChain();

    const generated = regulatoryStore.generate(signal.id, '专员甲');
    const [first, second] = await Promise.all([
      submitRegulatoryReport(generated.report!.id, '窗口甲'),
      submitRegulatoryReport(generated.report!.id, '窗口乙')
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    const rejected = outcomes.find((result) => !result.ok);
    expect(rejected?.reason).toMatch(/先到/);
    expect(regulatoryStore.getSnapshot().reports).toHaveLength(1);
    expect(regulatoryStore.getSnapshot().reports[0].status).toBe('submitted');
    expect(regulatoryStore.getSnapshot().reports[0].attempts).toHaveLength(1);
  });
});
