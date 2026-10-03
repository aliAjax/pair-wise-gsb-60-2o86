import { z } from 'zod';

/**
 * 监管报送域模型。
 *
 * 报送件在生成那一刻冻结证据矩阵、结论版本和关联批号；此后这三项任一变化，
 * 已报送件即标记失效，补充材料必须另起一份报送件，不得覆盖原件。
 */

export const reportKinds = ['initial', 'supplement', 'backfill'] as const;
export const reportStatuses = [
  /** 旧数据升级：有结论版本但查无报送件，先占位待补报 */
  'pending_backfill',
  /** 已生成并冻结，等待提交监管 */
  'draft',
  /** 提交失败：保留同一报送件就地重试，不重复生成 */
  'submission_failed',
  /** 已报送监管，等待回执 */
  'submitted',
  /** 已收到并对账监管回执 */
  'acknowledged',
  /** 冻结内容与当前信号不一致，原报送件失效，需另起补充件 */
  'invalidated'
] as const;

export const receiptStatuses = ['recorded', 'pending_review'] as const;

export type ReportKind = (typeof reportKinds)[number];
export type ReportStatus = (typeof reportStatuses)[number];
export type ReceiptStatus = (typeof receiptStatuses)[number];

/** 冻结在报送件中的证据条目（快照，不随后续编辑变化） */
export interface FrozenEvidence {
  id: string;
  type: string;
  title: string;
  source: string;
  strength: string;
  batch: string;
  note: string;
}

/** 冻结在报送件中的结论版本（报送时的最新版本） */
export interface FrozenVersion {
  id: string;
  version: number;
  author: string;
  summary: string;
  disposition: string;
  rationale: string;
  createdAt: string;
}

export interface FrozenSnapshot {
  /** 证据矩阵 + 结论版本 + 批号的稳定哈希，用于漂移检测 */
  evidenceHash: string;
  evidence: FrozenEvidence[];
  version: FrozenVersion | null;
  batches: string[];
  frozenAt: string;
}

export interface SubmissionAttempt {
  at: string;
  actor: string;
  ok: boolean;
  /** 成功时监管网关返回的报送号 */
  gatewayReportNo?: string;
  /** 失败原因，供就地重试时展示 */
  error?: string;
}

export interface RegulatoryReport {
  /** 例如 RPT-2026-018-02，末段为同信号内的报送次序 */
  id: string;
  signalId: string;
  kind: ReportKind;
  /** 同一信号内的报送件次序，补充件依次递增 */
  seq: number;
  status: ReportStatus;
  snapshot: FrozenSnapshot;
  /** 补充件指向被其接替的原报送件 */
  supersedesId?: string;
  /** 监管网关报送号，提交成功后取得，回执对账的首选键 */
  gatewayReportNo?: string;
  submittedAt?: string;
  attempts: SubmissionAttempt[];
  invalidatedAt?: string;
  invalidateReason?: string;
  createdAt: string;
  createdBy: string;
}

export interface RegulatoryReceipt {
  id: string;
  /** 监管回执号，全局唯一；重复回执号只记一次 */
  receiptNo: string;
  /** 回执签发时间 */
  receivedAt: string;
  /** 本地录入时间 */
  recordedAt: string;
  recordedBy: string;
  /** 回执上引用的监管报送号（可能填错或缺失） */
  gatewayReportNo?: string;
  /** 回执上引用的信号（可能填错或缺失） */
  signalId?: string;
  status: ReceiptStatus;
  /** 已对账时指向匹配的报送件 */
  matchedReportId?: string;
  /** 待核对原因或人工核对说明 */
  reviewNote?: string;
}

export interface RegulatoryState {
  reports: RegulatoryReport[];
  receipts: RegulatoryReceipt[];
}

/** 核心逻辑产出、由 store 追加到信号审计流的种子记录；id 稳定时跨窗口幂等去重 */
export interface AuditSeed {
  id?: string;
  actor: string;
  action: string;
  detail: string;
  at: string;
}

export const generateReportSchema = z.object({
  signalId: z.string().min(1),
  actor: z.string().trim().min(2, '请填写操作人')
});

export const submitReportSchema = z.object({
  reportId: z.string().min(1),
  actor: z.string().trim().min(2, '请填写操作人'),
  simulateFail: z.string().optional()
});

export const receiptSchema = z.object({
  receiptNo: z.string().trim().min(4, '回执号至少 4 个字符'),
  receivedAt: z.string().min(1, '请选择回执签发日期'),
  gatewayReportNo: z.string().trim().optional(),
  signalId: z.string().trim().optional(),
  actor: z.string().trim().min(2, '请填写录入人')
});

export const resolveReceiptSchema = z.object({
  receiptId: z.string().min(1),
  reportId: z.string().min(1, '请选择核对目标报送件'),
  note: z.string().trim().min(4, '核对说明至少 4 个字符'),
  actor: z.string().trim().min(2, '请填写核对人')
});

export const reportKindLabels: Record<ReportKind, string> = {
  initial: '初次报送',
  supplement: '补充报送',
  backfill: '旧数据补报'
};

export const reportStatusLabels: Record<ReportStatus, string> = {
  pending_backfill: '待补报',
  draft: '待提交',
  submission_failed: '提交失败',
  submitted: '已报送待回执',
  acknowledged: '已回执对账',
  invalidated: '已失效'
};

export const receiptStatusLabels: Record<ReceiptStatus, string> = {
  recorded: '已对账',
  pending_review: '待核对'
};
