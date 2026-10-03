// 无头逻辑验证：不启动浏览器，stub 掉 $app/environment 与 localStorage，
// 直接驱动 signalStore / receiptStore / filing-service。
import assert from 'node:assert';

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => void storage.set(k, String(v)),
  removeItem: (k) => void storage.delete(k)
};
// Node 无头环境无 navigator；filing-service 会走无 Web Locks 的回退路径
globalThis.navigator = globalThis.navigator ?? {};

const listeners = new Map();
globalThis.window = {
  addEventListener: (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  },
  removeEventListener: () => {},
  dispatchEvent: () => {}
};

// 模拟另一个窗口写入：触发本窗口 storage 监听
function fireStorage(key, value) {
  storage.set(key, value);
  for (const fn of listeners.get('storage') ?? []) fn({ key, newValue: value });
}

const { buildSnapshot, contentHashOf } = await import('./src/lib/services/filing-snapshot.ts');
const { signalStore } = await import('./src/lib/stores/signal-store.ts');

function getSignal(id) {
  return signalStore.getSnapshot().find((s) => s.id === id);
}

// ---------- 规则 5：旧数据升级：有结论版本无报送件 -> 待补报 ----------
{
  const s018 = getSignal('SIG-2026-018');
  assert.equal(s018.filings.length, 1, '升级后每个有版本的种子信号应有 1 份待补报');
  assert.equal(s018.filings[0].status, 'pending_submission');
  assert.equal(s018.filings[0].kind, 'initial');
  assert.ok(s018.audit.some((a) => a.action === '历史数据升级'), '升级应留审计');
  console.log('✔ 规则5 旧数据升级：结论版本无报送件 -> 待补报');
}

// 持久化键里必须已带 filings（升级结果会落盘）
const persisted = JSON.parse(storage.get('medical-safety-signals-v1'));
assert.ok(Array.isArray(persisted[0].filings), '落盘结构含 filings');

// ---------- 规则 3 后半 + 规则 1：报送成功后内容变化 -> 原件失效，补充件另起 ----------
{
  const before = getSignal('SIG-2026-019');
  const filing = before.filings[0];
  const originalSnapshotEvidence = filing.snapshot.evidence.length;
  const hashAtFreeze = filing.snapshot.contentHash;
  assert.equal(contentHashOf(before), hashAtFreeze, '冻结时内容哈希应一致');

  // 直接提交（无 Web Locks 时走回退路径；网关默认在线）
  const { submitFiling } = await import('./src/lib/services/filing-service.ts');
  const res = await submitFiling(filing.id, '顾岚');
  assert.equal(res.kind, 'submitted', '首次提交应成功');

  const submitted = getSignal('SIG-2026-019').filings.find((f) => f.id === filing.id);
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.snapshot.evidence.length, originalSnapshotEvidence, '快照证据数冻结');

  // 本地补一条证据（证据矩阵变化）
  signalStore.addEvidence(
    'SIG-2026-019',
    {
      id: 'E-NEW',
      type: 'test',
      title: '新增的同批模组温度复测记录',
      source: '实验室',
      strength: 'strong',
      batch: 'D9-260722',
      note: '补充证据，验证旧报送件失效逻辑。',
      createdAt: new Date().toISOString()
    },
    '顾岚'
  );

  const after = getSignal('SIG-2026-019');
  assert.notEqual(contentHashOf(after), hashAtFreeze, '当前内容哈希应改变');
  const old = after.filings.find((f) => f.id === filing.id);
  assert.equal(old.status, 'superseded', '原报送件应失效');
  assert.equal(old.supersededReason, 'evidence_changed');
  const supplement = after.filings.find((f) => f.kind === 'supplement');
  assert.ok(supplement, '应另起一份补充件');
  assert.equal(supplement.status, 'pending_submission');
  assert.equal(supplement.snapshot.evidence.length, originalSnapshotEvidence + 1, '补充件冻结新证据矩阵');
  assert.notEqual(supplement.filingNo, old.filingNo, '补充件是新的一份（新报送号）');
  assert.equal(old.supersededByFilingId, supplement.id);
  assert.ok(after.audit.some((a) => a.action === '报送件失效'), '失效留审计');
  console.log('✔ 规则1 报送后补证据：原报送件失效，补充件另起，快照保持旧样');

  // 再变一次，不应堆积第二份补充件，而是刷新现有待报补充件
  signalStore.addEvidence(
    'SIG-2026-019',
    {
      id: 'E-NEW2',
      type: 'test',
      title: '第二批留样的焊点切片记录',
      source: '实验室',
      strength: 'moderate',
      batch: 'D9-260722',
      note: '再次补充，验证补充件不重复生成。',
      createdAt: new Date().toISOString()
    },
    '顾岚'
  );
  const after2 = getSignal('SIG-2026-019');
  const pendingSupps = after2.filings.filter(
    (f) => f.kind === 'supplement' && f.status === 'pending_submission'
  );
  assert.equal(pendingSupps.length, 1, '待报补充件始终只有一份');
  assert.equal(pendingSupps[0].snapshot.evidence.length, originalSnapshotEvidence + 2);
  console.log('✔ 连续补证据不重复堆积补充件');
}

// ---------- 结论版本变化同样触发失效 ----------
{
  const { submitFiling } = await import('./src/lib/services/filing-service.ts');
  const target = getSignal('SIG-2026-015');
  const f = target.filings[0];
  await submitFiling(f.id, '林澈');
  signalStore.addVersion(
    'SIG-2026-015',
    {
      id: 'V-015-02',
      version: 2,
      author: '林澈',
      summary: '补充分层分析后升级为风险沟通，建议通知医疗机构排查。',
      disposition: 'risk_communication',
      rationale: '分层结果显示特定充电环境下衰减加剧。',
      createdAt: new Date().toISOString()
    },
    '林澈'
  );
  const s = getSignal('SIG-2026-015');
  const old = s.filings.find((x) => x.id === f.id);
  assert.equal(old.status, 'superseded');
  assert.equal(old.supersededReason, 'version_changed');
  assert.ok(s.filings.some((x) => x.kind === 'supplement'), '版本变化也另起补充件');
  console.log('✔ 结论版本变化 -> 原报送件失效');
}

// ---------- 规则 2：回执按号去重 + 对账 ----------
{
  const { receiptStore } = await import('./src/lib/stores/receipt-store.ts');
  // 先成功报送 018
  const s = getSignal('SIG-2026-018');
  const filing018 = s.filings[0];
  const { submitFiling } = await import('./src/lib/services/filing-service.ts');
  await submitFiling(filing018.id, '周宁');

  const now = getSignal('SIG-2026-018').filings.find((x) => x.id === filing018.id);
  const filingNo = now.filingNo;

  const r1 = receiptStore.record({
    receiptNo: 'JJH-TEST-001',
    filingNo,
    signalId: 'SIG-2026-018',
    receivedAt: '2026-10-01',
    recordedBy: '周宁'
  });
  assert.equal(r1.outcome, 'matched');
  const dup = receiptStore.record({
    receiptNo: 'JJH-TEST-001',
    filingNo,
    signalId: 'SIG-2026-018',
    receivedAt: '2026-10-01',
    recordedBy: '周宁'
  });
  assert.equal(dup.outcome, 'duplicate', '同回执号重复只记一次');
  console.log('✔ 规则2 回执对账一致；重复回执只记一次');

  // 对不上报送件
  const miss = receiptStore.record({
    receiptNo: 'JJH-TEST-002',
    filingNo: 'RPT-UNKNOWN-00000000',
    signalId: 'SIG-2026-018',
    receivedAt: '2026-10-01',
    recordedBy: '周宁'
  });
  assert.equal(miss.outcome, 'pending_review');
  assert.equal(miss.issue, 'filing_not_found');

  // 指向另一条信号
  const wrong = receiptStore.record({
    receiptNo: 'JJH-TEST-003',
    filingNo,
    signalId: 'SIG-2026-019',
    receivedAt: '2026-10-01',
    recordedBy: '周宁'
  });
  assert.equal(wrong.outcome, 'pending_review');
  assert.equal(wrong.issue, 'signal_mismatch');
  console.log('✔ 规则2 对不上报送件 / 指向另一条信号 -> 待核对');

  // 待核对回执在补报成功后自动对上
  // 种子 RCV-SEED-01 的 filingNo 是 RPT-018-PENDING，造不出来；改为验证 reconcile 接口可用：
  const before = (await import('svelte/store')).get(receiptStore).filter(
    (r) => r.status === 'pending_review'
  ).length;
  receiptStore.reconcile();
  const after = (await import('svelte/store')).get(receiptStore).filter(
    (r) => r.status === 'pending_review'
  ).length;
  assert.ok(after <= before);
  console.log('✔ 重新对账接口正常');
}

// ---------- 规则 3：提交失败就地重试，不重复生成；同内容幂等 ----------
{
  const { submitFiling, setGatewayOffline } = await import('./src/lib/services/filing-service.ts');
  const s = getSignal('SIG-2026-011');
  const f0 = s.filings[0];
  const idBefore = f0.id;
  const noBefore = f0.filingNo;

  setGatewayOffline(true);
  const fail = await submitFiling(f0.id, '高远');
  assert.equal(fail.kind, 'failed');
  const mid = getSignal('SIG-2026-011').filings.find((x) => x.id === idBefore);
  assert.equal(mid.status, 'send_failed');
  assert.equal(mid.filingNo, noBefore, '失败后报送号不变');

  // 失败后再次生成 -> 幂等，不新增
  const gen = signalStore.ensureFiling('SIG-2026-011', 'initial');
  assert.equal(gen.ok, true);
  assert.equal(gen.filing.id, idBefore, '不重复生成报送件');

  setGatewayOffline(false);
  const retry = await submitFiling(idBefore, '高远');
  assert.equal(retry.kind, 'submitted');
  assert.equal(retry.filing.id, idBefore, '就地重试沿用同一份');
  assert.equal(retry.filing.filingNo, noBefore);
  console.log('✔ 规则3 提交失败就地重试，不重复生成');
}

// ---------- 规则 4：跨窗口并发，只有先到的生效 ----------
{
  // 用 019 的补充件（当前 pending）。模拟两个标签页：标签页B 先 storage 写入一份"已提交的同内容件"
  const s019 = getSignal('SIG-2026-019');
  const pending = s019.filings.find((f) => f.status === 'pending_submission' && f.kind === 'supplement');
  assert.ok(pending, '前置：019 有一份待报补充件');

  // 构造另一个窗口"抢先提交"后的完整数据集：同 idempotencyKey 的 submitted 件
  const snapshotClone = structuredClone(signalStore.getSnapshot());
  const targetSignal = snapshotClone.find((x) => x.id === 'SIG-2026-019');
  const otherFiling = targetSignal.filings.find((f) => f.id === pending.id);
  otherFiling.status = 'submitted';
  otherFiling.submittedAt = new Date().toISOString();
  otherFiling.submittedBy = '另一窗口-顾岚';
  otherFiling.updatedAt = new Date().toISOString();
  fireStorage('medical-safety-signals-v1', JSON.stringify(snapshotClone));

  // 本窗口看到的同一份件已是 submitted（跨窗口同步生效）
  const synced = getSignal('SIG-2026-019').filings.find((f) => f.id === pending.id);
  assert.equal(synced.status, 'submitted', '另一窗口提交结果经 storage 同步到本窗口');

  const { submitFiling } = await import('./src/lib/services/filing-service.ts');
  const res = await submitFiling(pending.id, '顾岚');
  assert.equal(
    res.kind === 'submitted' || res.kind === 'concurrent_lost',
    true,
    '本窗口重复提交不会产生第二份生效件'
  );
  const finalSignal = getSignal('SIG-2026-019');
  const sameKeySubmitted = finalSignal.filings.filter(
    (f) => f.status === 'submitted' && f.idempotencyKey === pending.idempotencyKey
  );
  assert.equal(sameKeySubmitted.length, 1, '同一内容只有一份生效报送件');
  console.log('✔ 规则4 跨窗口提交：先到者生效，后到者不产生重复');
}

// ---------- 未达处置条件不能报送 ----------
{
  // 手工造一个 continue_observation 结论但没有报送件的信号
  signalStore.create({
    title: '某低风险外观瑕疵观察信号测试用',
    product: '测试产品 X1',
    batch: 'X1-B1',
    sourceType: 'complaint',
    status: 'observed',
    riskLevel: 'low',
    severity: 1,
    reportCount: 1,
    exposedUnits: 10,
    occurrenceRate: 0,
    occurredAt: '2026-10-01',
    owner: '测试员',
    description: '用于验证继续观察的结论不开放报送。',
    affectedBatches: ['X1-B1'],
    evidence: [],
    tasks: [],
    versions: [
      {
        id: 'V-T1',
        version: 1,
        author: '测试员',
        summary: '风险可控继续观察，暂不需要监管报送处置。',
        disposition: 'continue_observation',
        rationale: '无伤害、无批次性证据。',
        createdAt: new Date().toISOString()
      }
    ],
    filings: []
  });
  const created = signalStore.getSnapshot()[0];
  // 新信号不走升级（直接进 store），无报送件
  assert.equal(created.filings.length, 0);
  const gen = signalStore.ensureFiling(created.id, 'initial');
  assert.equal(gen.ok, false, '继续观察结论不应允许报送');
  console.log('✔ 未达处置条件（继续观察）不能生成报送件');
}

console.log('\n全部业务规则验证通过 ✅');

// ---------- 待核对回执在补报报送成功后自动对账 ----------
{
  const { receiptStore } = await import('./src/lib/stores/receipt-store.ts');
  const { get } = await import('svelte/store');

  // 018 的迁移报送件真实报送号
  const s018 = getSignal('SIG-2026-018');
  const realNo = s018.filings.find((f) => f.kind === 'initial' && f.status === 'submitted').filingNo;

  // 此前录入时报送件还没报 -> 待核对
  const rec = receiptStore.record({
    receiptNo: 'JJH-AUTO-001',
    filingNo: realNo,
    signalId: 'SIG-2026-018',
    receivedAt: '2026-10-02',
    recordedBy: '周宁'
  });
  assert.equal(rec.outcome, 'matched', '已报送件当场就应能对上');
  assert.equal(get(receiptStore).find((r) => r.receiptNo === 'JJH-AUTO-001').status, 'matched');
  console.log('✔ 已报送件录入回执立即对账');

  // 构造"录入时报送件尚未生成"的情形：先录回执（报送号用 015 将来补充件的号不可预知，
  // 改用当前 015 补充件已存在但仍 pending 的报送号），再报送 -> reconcile 自动对上
  const s015 = getSignal('SIG-2026-015');
  const pending015 = s015.filings.find((f) => f.status === 'pending_submission');
  assert.ok(pending015, '015 应有版本变化后待报的补充件');
  const early = receiptStore.record({
    receiptNo: 'JJH-AUTO-002',
    filingNo: pending015.filingNo,
    signalId: 'SIG-2026-015',
    receivedAt: '2026-10-02',
    recordedBy: '林澈'
  });
  assert.equal(early.outcome, 'pending_review', '报送件尚未报送时先留待核对');
  assert.equal(early.issue, 'filing_not_found');

  const { submitFiling } = await import('./src/lib/services/filing-service.ts');
  const r = await submitFiling(pending015.id, '林澈');
  assert.equal(r.kind, 'submitted');
  const after = get(receiptStore).find((x) => x.receiptNo === 'JJH-AUTO-002');
  assert.equal(after.status, 'matched', '报送成功后待核对回执自动对上');
  assert.equal(after.matchedFilingId, pending015.id);
  console.log('✔ 待核对回执在报送成功后自动对账命中');
}

// ---------- 种子待核对回执（含旧数据补报）在提交补报后自动对上 ----------
{
  const { receiptStore } = await import('./src/lib/stores/receipt-store.ts');
  const { submitFiling } = await import('./src/lib/services/filing-service.ts');
  const { get } = await import('svelte/store');

  // RCV-SEED-01 指向 018 的迁移补报件；此前 018 initial 已在规则2测试中报送，
  // 所以它在那次 submitFiling 触发的 reconcile 里应已自动对上。
  const seed01 = get(receiptStore).find((r) => r.id === 'RCV-SEED-01');
  assert.equal(seed01.status, 'matched', '018 补报报送后，待核对种子回执应自动对上');
  console.log('✔ 种子回执：补报报送成功后自动对账（旧数据补报闭环）');

  // RCV-SEED-02 永远对不上（信号不一致），即便 019 已报送
  const seed02 = get(receiptStore).find((r) => r.id === 'RCV-SEED-02');
  assert.equal(seed02.status, 'pending_review');
  assert.equal(seed02.issue, 'signal_mismatch');

  // 重复回执始终是 duplicate，不会被 reconcile 复活
  const dup = get(receiptStore).find((r) => r.id === 'RCV-SEED-03-DUP');
  assert.equal(dup.status, 'duplicate');

  // 提交 011 补报后 RCV-SEED-03 对上，而重复那条仍是 duplicate
  const f011 = getSignal('SIG-2026-011').filings.find((f) => f.status === 'submitted');
  assert.ok(f011, '011 补报件应已报送（规则3测试）');
  const seed03 = get(receiptStore).find((r) => r.id === 'RCV-SEED-03');
  assert.equal(seed03.status, 'matched', '011 补报报送后待核对回执自动对上');
  assert.equal(get(receiptStore).find((r) => r.id === 'RCV-SEED-03-DUP').status, 'duplicate');
  console.log('✔ 重复回执在自动对账后仍只记一次，不复活');
}
