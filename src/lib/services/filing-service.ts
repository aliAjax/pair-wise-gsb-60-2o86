import { signalStore } from '$lib/stores/signal-store';
import { receiptStore } from '$lib/stores/receipt-store';
import type { RegulatoryFiling } from '$lib/models/signal';

// 同一窗口内的在途请求：提交失败后点重试沿用同一 Promise，绝不重复生成报送件
const inFlight = new Map<string, Promise<SubmitOutcome>>();

// 模拟监管报送渠道：offline 时报送失败，用于演示"就地重试"
const GATEWAY_KEY = 'medical-safety-gateway-offline-v1';

export function isGatewayOffline(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(GATEWAY_KEY) === '1';
}

export function setGatewayOffline(offline: boolean) {
  if (offline) localStorage.setItem(GATEWAY_KEY, '1');
  else localStorage.removeItem(GATEWAY_KEY);
  // 通知同窗口其他组件
  window.dispatchEvent(new CustomEvent('filing-gateway-change', { detail: { offline } }));
}

export type SubmitOutcome =
  | { kind: 'submitted'; filing: RegulatoryFiling }
  | { kind: 'failed'; filing: RegulatoryFiling; error: string }
  | { kind: 'concurrent_lost'; message: string; winnerFilingId?: string }
  | { kind: 'not_found'; message: string };

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 跨窗口信号级互斥：两个窗口同时提交同一条信号时，只有先拿到锁的生效。 */
function withSignalLock<T>(signalId: string, task: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator & { locks?: LockManager }).locks;
  if (locks) {
    // 直接透传任务 Promise：回调返回 Promise<T>，request 本身也返回 Promise<T>
    return locks.request(`filing-submit:${signalId}`, () => task()) as Promise<T>;
  }
  return task();
}

async function runSubmit(filingId: string, submittedBy: string): Promise<SubmitOutcome> {
  const claim = signalStore.claimSubmission(filingId, submittedBy);
  if (claim.outcome === 'not_found') {
    return { kind: 'not_found', message: '报送件不存在，可能已被重置。' };
  }
  if (claim.outcome === 'already_submitted' && claim.filing) {
    return { kind: 'submitted', filing: claim.filing };
  }
  if (claim.outcome === 'concurrent_lost') {
    return {
      kind: 'concurrent_lost',
      winnerFilingId: claim.winnerFilingId,
      message: '另一个窗口已先一步提交同一条信号，本次提交未生效。'
    };
  }

  const claimed = claim.filing!;
  await delay(700);

  // 模拟向监管网关报送
  if (isGatewayOffline()) {
    const commit = signalStore.commitSubmission(filingId, 'failure', {
      error: '监管报送网关无响应（HTTP 504）'
    });
    if (commit.filing) return { kind: 'failed', filing: commit.filing, error: commit.filing.lastError ?? '报送失败' };
    return { kind: 'failed', filing: claimed, error: '报送失败' };
  }

  const commit = signalStore.commitSubmission(filingId, 'success', {});
  if (commit.outcome === 'already_submitted' && commit.filing) {
    return {
      kind: 'concurrent_lost',
      winnerFilingId: commit.filing.id,
      message: '另一个窗口已先一步报送同一份内容，本次提交未生效。'
    };
  }
  if (commit.filing) {
    // 报送成功后立即对一遍待核对回执（补报后回执可能正好对上）
    receiptStore.reconcile();
    return { kind: 'submitted', filing: signalStore.getFilingById(filingId) ?? commit.filing };
  }
  return { kind: 'not_found', message: '报送结果落库失败。' };
}

/**
 * 提交报送件。同一份报送件的并发/重试调用共享同一个在途 Promise。
 */
export function submitFiling(filingId: string, submittedBy: string): Promise<SubmitOutcome> {
  const existing = inFlight.get(filingId);
  if (existing) return existing;

  const filing = signalStore.getFilingById(filingId);
  if (!filing) {
    return Promise.resolve({ kind: 'not_found', message: '报送件不存在。' });
  }

  const promise = withSignalLock(filing.signalId, () => runSubmit(filingId, submittedBy)).finally(() => {
    inFlight.delete(filingId);
  });
  inFlight.set(filingId, promise);
  return promise;
}

/** 生成报送件（冻结快照）。 */
export function generateFiling(
  signalId: string,
  kind: 'initial' | 'supplement'
): { ok: boolean; filing?: RegulatoryFiling; reason?: string } {
  return signalStore.ensureFiling(signalId, kind);
}

export function listFilings(): Array<RegulatoryFiling> {
  return signalStore
    .getSnapshot()
    .flatMap((signal) => signal.filings)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
