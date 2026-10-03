import { describe, expect, it } from 'vitest';
import type { RegulatoryState } from '$lib/models/regulatory';
import { makeSignal, makeSignalWithoutVersion } from '$lib/testing/signal-fixtures';
import {
  applySubmissionAttempt,
  freezeSignal,
  generateReport,
  isSnapshotStale,
  prepareSubmit,
  reconcile,
  recordReceipt,
  reportsForSignal,
  resolvePendingReceipt,
  stableHash
} from './regulatory-core';

const empty: RegulatoryState = { reports: [], receipts: [] };
const T1 = '2026-10-01T00:00:00.000Z';
const T2 = '2026-10-02T00:00:00.000Z';
const T3 = '2026-10-03T00:00:00.000Z';

describe('stableHash', () => {
  it('对相同内容给出相同哈希，字段顺序无关', () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});

describe('freezeSignal', () => {
  it('冻结证据矩阵、最新结论版本和排序后的批号', () => {
    const signal = makeSignal({ affectedBatches: ['B2', 'B1'] });
    const frozen = freezeSignal(signal, T1);
    expect(frozen.evidence).toHaveLength(1);
    expect(frozen.version?.version).toBe(1);
    expect(frozen.batches).toEqual(['B1', 'B2']);
    expect(frozen.evidenceHash).toMatch(/^h[0-9a-f]{8}$/);
    expect(frozen.frozenAt).toBe(T1);
  });
});

describe('旧数据升级 reconcile', () => {
  it('有结论版本但没有报送件的信号进入待补报，且幂等', () => {
    const signal = makeSignal();
    const once = reconcile(empty, [signal], T1);
    expect(once.state.reports).toHaveLength(1);
    expect(once.state.reports[0].status).toBe('pending_backfill');
    expect(once.state.reports[0].kind).toBe('backfill');
    expect(once.audits).toHaveLength(1);

    const twice = reconcile(once.state, [signal], T2);
    expect(twice.state).toBe(once.state);
    expect(twice.audits).toHaveLength(0);
  });

  it('没有结论版本的信号不进待补报', () => {
    const result = reconcile(empty, [makeSignalWithoutVersion()], T1);
    expect(result.state.reports).toHaveLength(0);
  });
});

describe('报送件冻结与失效', () => {
  it('证据/版本/批号变化使已报送件失效；草稿不受影响', () => {
    const signal = makeSignal();
    const generated = generateReport(empty, signal, '测试员', T1);
    expect(generated.ok).toBe(true);
    const submitted = applySubmissionAttempt(generated.state, generated.report!.id, {
      actor: '测试员',
      success: true,
      gatewayReportNo: 'GOV-1',
      at: T1
    });

    // 补证据 -> 已报送件失效
    const withEvidence = makeSignal({
      id: signal.id,
      evidence: [
        ...signal.evidence,
        {
          id: 'E-NEW',
          type: 'complaint',
          title: '新增投诉证据',
          source: '客服',
          strength: 'moderate',
          batch: 'B1',
          note: '新补的核查说明。',
          createdAt: T2
        }
      ]
    });
    let result = reconcile(submitted.state, [withEvidence], T2);
    expect(result.state.reports[0].status).toBe('invalidated');
    expect(result.state.reports[0].invalidateReason).toContain('冻结内容');

    // 幂等：再次对账不重复失效、不重复审计
    const again = reconcile(result.state, [withEvidence], T3);
    expect(again.state).toBe(result.state);
    expect(again.audits).toHaveLength(0);

    // 新版本号 / 新批号同样判定漂移
    const v2 = makeSignal({
      versions: [
        {
          id: 'V2',
          version: 2,
          author: '测试员',
          summary: '更新后的结论版本。',
          disposition: 'corrective_action',
          rationale: '依据变化。',
          createdAt: T3
        },
        ...signal.versions
      ]
    });
    expect(isSnapshotStale(submitted.state.reports[0], v2)).toBe(true);
    const newBatch = makeSignal({ affectedBatches: ['B1', 'B3'] });
    expect(isSnapshotStale(submitted.state.reports[0], newBatch)).toBe(true);
  });

  it('尚未报送的草稿不参与失效对账，提交前就地重新冻结', () => {
    const signal = makeSignal();
    const generated = generateReport(empty, signal, '测试员', T1);
    const changed = makeSignal({
      id: signal.id,
      evidence: [
        ...signal.evidence,
        {
          id: 'E2',
          type: 'test',
          title: '第二项证据名称',
          source: '实验室',
          strength: 'weak',
          batch: 'B1',
          note: '补充说明内容。',
          createdAt: T2
        }
      ]
    });
    // 草稿状态漂移：reconcile 不动它
    const reconciled = reconcile(generated.state, [changed], T2);
    expect(reconciled.state).toBe(generated.state);
    expect(generated.report!.status).toBe('draft');

    // 提交前重新冻结同一份报送件
    const prepared = prepareSubmit(generated.state, generated.report!.id, changed, '测试员', T2);
    expect(prepared.ok).toBe(true);
    expect(prepared.refrozen).toBe(true);
    const report = prepared.state.reports[0];
    expect(report.snapshot.evidence).toHaveLength(2);
    expect(isSnapshotStale(report, changed)).toBe(false);
  });
});

describe('生成报送件', () => {
  it('无结论版本拒绝生成', () => {
    const outcome = generateReport(empty, makeSignalWithoutVersion(), '测试员', T1);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('结论版本');
  });

  it('已有有效报送件时拒绝重复生成', () => {
    const signal = makeSignal();
    const generated = generateReport(empty, signal, '测试员', T1);
    const submitted = applySubmissionAttempt(generated.state, generated.report!.id, {
      actor: '测试员',
      success: true,
      gatewayReportNo: 'GOV-1',
      at: T1
    });
    const duplicate = generateReport(submitted.state, signal, '测试员', T2);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.state.reports).toHaveLength(1);
  });

  it('待提交/提交失败件存在时拒绝重新生成，要求直接提交或就地重试', () => {
    const signal = makeSignal();
    const generated = generateReport(empty, signal, '测试员', T1);
    expect(generateReport(generated.state, signal, '测试员', T2).ok).toBe(false);

    const failed = applySubmissionAttempt(generated.state, generated.report!.id, {
      actor: '测试员',
      success: false,
      error: '网关超时',
      at: T2
    });
    expect(generateReport(failed.state, signal, '测试员', T3).ok).toBe(false);
  });

  it('原件失效后补充件另起一份并指向原件', () => {
    const signal = makeSignal();
    const first = generateReport(empty, signal, '测试员', T1);
    const submitted = applySubmissionAttempt(first.state, first.report!.id, {
      actor: '测试员',
      success: true,
      gatewayReportNo: 'GOV-1',
      at: T1
    });
    const changed = makeSignal({
      id: signal.id,
      evidence: [
        ...signal.evidence,
        {
          id: 'E2',
          type: 'complaint',
          title: '新证据标题名称',
          source: '客服',
          strength: 'weak',
          batch: 'B1',
          note: '新增核查说明。',
          createdAt: T2
        }
      ]
    });
    const invalidated = reconcile(submitted.state, [changed], T2);

    const supplement = generateReport(invalidated.state, changed, '测试员', T3);
    expect(supplement.ok).toBe(true);
    expect(supplement.report!.kind).toBe('supplement');
    expect(supplement.report!.seq).toBe(2);
    expect(supplement.report!.supersedesId).toBe(first.report!.id);
    expect(supplement.report!.id).not.toBe(first.report!.id);
    expect(supplement.state.reports).toHaveLength(2);
  });

  it('待补报占位生成补报件后转为待提交草稿', () => {
    const signal = makeSignal();
    const backfilled = reconcile(empty, [signal], T1);
    const generated = generateReport(backfilled.state, signal, '测试员', T2);
    expect(generated.ok).toBe(true);
    expect(generated.report!.kind).toBe('backfill');
    expect(generated.report!.status).toBe('draft');
    expect(generated.report!.snapshot.evidence).toHaveLength(1);
    expect(generated.state.reports).toHaveLength(1);
  });
});

describe('提交尝试', () => {
  it('提交失败保留同一报送件并可就地重试成功', () => {
    const signal = makeSignal();
    const generated = generateReport(empty, signal, '测试员', T1);
    const id = generated.report!.id;

    const failed = applySubmissionAttempt(generated.state, id, {
      actor: '测试员',
      success: false,
      error: '网关超时',
      at: T2
    });
    expect(failed.report!.status).toBe('submission_failed');
    expect(failed.report!.attempts).toHaveLength(1);
    expect(failed.report!.gatewayReportNo).toBeUndefined();

    const retried = applySubmissionAttempt(failed.state, id, {
      actor: '测试员',
      success: true,
      gatewayReportNo: 'GOV-9',
      at: T3
    });
    expect(retried.report!.status).toBe('submitted');
    expect(retried.report!.attempts).toHaveLength(2);
    expect(retried.report!.id).toBe(id);
    expect(retried.report!.gatewayReportNo).toBe('GOV-9');
  });
});

describe('回执对账', () => {
  function setupSubmitted() {
    const signal = makeSignal();
    const generated = generateReport(empty, signal, '测试员', T1);
    const submitted = applySubmissionAttempt(generated.state, generated.report!.id, {
      actor: '测试员',
      success: true,
      gatewayReportNo: 'GOV-2026-0007',
      at: T1
    });
    return { signal, reportId: generated.report!.id, state: submitted.state };
  }

  it('按报送号精确对账，报送件转已回执', () => {
    const { state, reportId } = setupSubmitted();
    const outcome = recordReceipt(state, {
      receiptNo: 'RCP-1',
      receivedAt: '2026-10-03',
      gatewayReportNo: 'GOV-2026-0007',
      actor: '监管联络人',
      at: T2
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.receipt!.status).toBe('recorded');
    expect(outcome.receipt!.matchedReportId).toBe(reportId);
    expect(outcome.state.reports.find((r) => r.id === reportId)?.status).toBe('acknowledged');
  });

  it('重复回执号只记一次', () => {
    const { state } = setupSubmitted();
    const first = recordReceipt(state, {
      receiptNo: 'RCP-DUP',
      receivedAt: '2026-10-03',
      gatewayReportNo: 'GOV-2026-0007',
      actor: '甲',
      at: T2
    });
    const second = recordReceipt(first.state, {
      receiptNo: 'RCP-DUP',
      receivedAt: '2026-10-04',
      gatewayReportNo: 'GOV-2026-0007',
      actor: '乙',
      at: T3
    });
    expect(second.ok).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.state.receipts).toHaveLength(1);
  });

  it('报送号对不上任何报送件时留在待核对', () => {
    const { state } = setupSubmitted();
    const outcome = recordReceipt(state, {
      receiptNo: 'RCP-X',
      receivedAt: '2026-10-03',
      gatewayReportNo: 'GOV-UNKNOWN',
      actor: '甲',
      at: T2
    });
    expect(outcome.receipt!.status).toBe('pending_review');
    expect(outcome.receipt!.matchedReportId).toBeUndefined();
    expect(outcome.receipt!.reviewNote).toContain('查无对应');
  });

  it('回执指向另一条信号时留在待核对', () => {
    const { state } = setupSubmitted();
    const outcome = recordReceipt(state, {
      receiptNo: 'RCP-CROSS',
      receivedAt: '2026-10-03',
      gatewayReportNo: 'GOV-2026-0007',
      signalId: 'SIG-OTHER-999',
      actor: '甲',
      at: T2
    });
    expect(outcome.receipt!.status).toBe('pending_review');
    expect(outcome.receipt!.reviewNote).toContain('不一致');
  });

  it('人工核对后挂接到指定报送件', () => {
    const { state, reportId } = setupSubmitted();
    const pending = recordReceipt(state, {
      receiptNo: 'RCP-P',
      receivedAt: '2026-10-03',
      gatewayReportNo: 'GOV-UNKNOWN',
      actor: '甲',
      at: T2
    });
    const resolved = resolvePendingReceipt(pending.state, {
      receiptId: pending.receipt!.id,
      reportId,
      note: '经与监管电话确认为本报送件回执。',
      actor: '乙',
      at: T3
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.state.receipts[0].status).toBe('recorded');
    expect(resolved.state.receipts[0].matchedReportId).toBe(reportId);
  });

  it('仅提供信号且该信号唯一有生效件时可自动对账', () => {
    const { state } = setupSubmitted();
    const outcome = recordReceipt(state, {
      receiptNo: 'RCP-SIG',
      receivedAt: '2026-10-03',
      signalId: state.reports[0].signalId,
      actor: '甲',
      at: T2
    });
    expect(outcome.receipt!.status).toBe('recorded');
  });
});

describe('reportsForSignal', () => {
  it('按 seq 倒序返回同一信号的报送件', () => {
    const signal = makeSignal();
    const g1 = generateReport(empty, signal, '甲', T1);
    const submitted = applySubmissionAttempt(g1.state, g1.report!.id, {
      actor: '甲',
      success: true,
      gatewayReportNo: 'G1',
      at: T1
    });
    const changed = makeSignal({ id: signal.id, affectedBatches: ['B1', 'B2'] });
    const inv = reconcile(submitted.state, [changed], T2);
    const g2 = generateReport(inv.state, changed, '甲', T3);
    const list = reportsForSignal(g2.state, signal.id);
    expect(list.map((r) => r.seq)).toEqual([2, 1]);
  });
});
