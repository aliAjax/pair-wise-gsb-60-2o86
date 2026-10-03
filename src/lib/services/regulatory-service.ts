import { regulatoryStore } from '$lib/stores/regulatory-store';
import { signalStore } from '$lib/stores/signal-store';

/**
 * 报送提交服务：模拟监管网关，并保证同一条信号的提交串行化——
 * 两个窗口（或同窗口两次操作）同时提交同一条信号的报送时，只有先到的生效。
 */

let gatewaySeq = 0;

/** 仅用于本地演示：模拟监管网关受理，返回监管报送号 */
function mockGatewayCall(payload: {
  reportId: string;
  signalId: string;
  simulateFail: boolean;
}): Promise<{ gatewayReportNo: string }> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (payload.simulateFail) {
        reject(new Error('监管网关暂不可用（模拟）'));
        return;
      }
      gatewaySeq += 1;
      resolve({ gatewayReportNo: `GOV-${new Date().getFullYear()}-${String(gatewaySeq).padStart(4, '0')}` });
    }, 250 + Math.random() * 250);
  });
}

/** 跨窗口互斥锁：优先 Web Locks API，不支持时退化为本窗口 Promise 锁 */
const localLocks = new Map<string, Promise<unknown>>();

async function withSignalLock<T>(
  signalId: string,
  task: () => Promise<T>
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const lockName = `regulatory-submit-${signalId}`;
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    let outcome: { acquired: true; value: T } | { acquired: false } = { acquired: false };
    await navigator.locks.request(
      lockName,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return; // 已有同信号提交在途（另一窗口先到）
        outcome = { acquired: true, value: await task() };
      }
    );
    return outcome;
  }

  if (localLocks.has(signalId)) return { acquired: false };
  const run = task().finally(() => localLocks.delete(signalId));
  localLocks.set(signalId, run);
  return { acquired: true, value: await run };
}

export interface SubmitResult {
  ok: boolean;
  reason?: string;
}

/**
 * 提交报送件。同信号串行：
 * - 该信号已有提交在途（含另一标签页），后来的请求直接拒绝，不排队、不重复；
 * - 锁内若发现先到的提交已生效，本次提交放弃；
 * - 提交前在锁内完成状态校验与草稿重冻，避免两个窗口同时改写同一份报送件；
 * - 提交失败不重新生成报送件，同一份报送件可调用本方法就地重试。
 */
export async function submitRegulatoryReport(
  reportId: string,
  actor: string,
  options: { simulateFail?: boolean } = {}
): Promise<SubmitResult> {
  const precheck = regulatoryStore.getSnapshot().reports.find((item) => item.id === reportId);
  if (!precheck) return { ok: false, reason: '报送件不存在。' };

  const locked = await withSignalLock(precheck.signalId, async () => {
    // 锁内复查：先到的提交可能已经完成
    const raced = regulatoryStore.getSnapshot().reports.some(
      (item) =>
        item.signalId === precheck.signalId &&
        (item.status === 'submitted' || item.status === 'acknowledged')
    );
    if (raced) return { proceeded: false as const, reason: '该信号已有先到的报送生效，本次提交不重复执行。' };

    // 提交前校验 + 草稿漂移时就地重新冻结（在锁内进行，只有先到者会改写状态）
    const prepared = regulatoryStore.beginSubmit(reportId, actor);
    if (!prepared.ok) return { proceeded: false as const, reason: prepared.reason ?? '当前状态不可提交。' };

    const report = prepared.state.reports.find((item) => item.id === reportId);
    if (!report) return { proceeded: false as const, reason: '报送件不存在。' };
    const signalExists = signalStore.getSnapshot().some((item) => item.id === report.signalId);
    if (!signalExists) return { proceeded: false as const, reason: '报送件关联的信号已不存在。' };

    try {
      const { gatewayReportNo } = await mockGatewayCall({
        reportId,
        signalId: report.signalId,
        simulateFail: options.simulateFail ?? false
      });
      regulatoryStore.recordAttempt(reportId, { actor, success: true, gatewayReportNo });
      return { proceeded: true as const, ok: true as const };
    } catch (error) {
      regulatoryStore.recordAttempt(reportId, {
        actor,
        success: false,
        error: error instanceof Error ? error.message : '提交失败'
      });
      return { proceeded: true as const, ok: false as const };
    }
  });

  if (!locked.acquired) {
    return { ok: false, reason: '该信号已有报送正在提交（另一窗口先到），本次提交已忽略。' };
  }
  if (!locked.value.proceeded) return { ok: false, reason: locked.value.reason };
  return locked.value.ok
    ? { ok: true }
    : { ok: false, reason: '提交失败，可就原报送件重试，无需重新生成。' };
}
