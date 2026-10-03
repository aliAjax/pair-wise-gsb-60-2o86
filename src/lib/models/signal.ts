import { z } from 'zod';

export const signalStatuses = [
  'new',
  'investigating',
  'observed',
  'action_required',
  'review',
  'closed'
] as const;

export const riskLevels = ['low', 'medium', 'high', 'critical'] as const;
export const evidenceStrengths = ['strong', 'moderate', 'weak', 'contrary'] as const;

export const createSignalSchema = z.object({
  title: z.string().trim().min(6, '信号标题至少 6 个字符'),
  product: z.string().trim().min(2, '请输入产品名称'),
  batch: z.string().trim().min(2, '请输入批号'),
  sourceType: z.enum(['complaint', 'repair', 'adverse_event', 'field_report']),
  severity: z.coerce.number().int().min(1).max(5),
  occurredAt: z.string().min(1, '请选择发生日期'),
  description: z.string().trim().min(10, '经过说明至少 10 个字符')
});

export const transitionSchema = z.object({
  id: z.string().min(1),
  nextStatus: z.enum(signalStatuses),
  reason: z.string().trim().min(4, '请填写流转依据'),
  actor: z.string().trim().min(2, '请填写操作人')
});

export const evidenceSchema = z.object({
  id: z.string().min(1),
  evidenceType: z.enum(['complaint', 'repair', 'adverse_event', 'field_report', 'test', 'literature']),
  title: z.string().trim().min(4, '证据名称至少 4 个字符'),
  source: z.string().trim().min(2, '请填写来源'),
  strength: z.enum(evidenceStrengths),
  batch: z.string().trim().min(1, '请填写关联批号'),
  note: z.string().trim().min(4, '请填写核查说明')
});

export const versionSchema = z.object({
  id: z.string().min(1),
  author: z.string().trim().min(2, '请填写版本作者'),
  summary: z.string().trim().min(8, '结论摘要至少 8 个字符'),
  disposition: z.enum(['continue_observation', 'risk_communication', 'corrective_action']),
  rationale: z.string().trim().min(6, '请填写判断依据')
});

// 报送监管：仅对达到处置条件（建议处置非继续观察）的结论开放
export const dispositionReportable = ['risk_communication', 'corrective_action'] as const;

export const filingSubmissionSchema = z.object({
  filingId: z.string().min(1, '缺少报送件标识'),
  signalId: z.string().min(1, '缺少信号标识'),
  submittedBy: z.string().trim().min(2, '请填写报送操作人')
});

export const receiptSchema = z.object({
  receiptNo: z
    .string()
    .trim()
    .min(4, '回执号至少 4 个字符')
    .regex(/^[A-Za-z0-9-_]+$/, '回执号仅支持字母、数字、连字符'),
  filingNo: z.string().trim().min(1, '请填写回执指向的报送号'),
  signalId: z.string().trim().min(1, '请填写回执指向的信号号'),
  receivedAt: z.string().min(1, '请选择回执日期'),
  recordedBy: z.string().trim().min(2, '请填写录入人'),
  note: z.string().trim().max(200, '备注不超过 200 字').optional()
});

export type ReportableDisposition = (typeof dispositionReportable)[number];

export type SignalStatus = (typeof signalStatuses)[number];
export type RiskLevel = (typeof riskLevels)[number];
export type EvidenceStrength = (typeof evidenceStrengths)[number];
export type SignalSourceType = z.infer<typeof createSignalSchema>['sourceType'];
export type Disposition = z.infer<typeof versionSchema>['disposition'];

export interface EvidenceItem {
  id: string;
  type: SignalSourceType | 'test' | 'literature';
  title: string;
  source: string;
  strength: EvidenceStrength;
  batch: string;
  note: string;
  createdAt: string;
}

export interface InvestigationTask {
  id: string;
  title: string;
  owner: string;
  dueAt: string;
  status: 'open' | 'in_progress' | 'done';
}

export interface CaseVersion {
  id: string;
  version: number;
  author: string;
  summary: string;
  disposition: Disposition;
  rationale: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  detail: string;
  createdAt: string;
}

// ---- 监管报送 ----

/**
 * 报送件生命周期：
 * pending_submission 待提交（含旧数据升级产生的待补报）
 * submitted          已报送（以冻结快照为准）
 * send_failed        报送失败，等待就地重试（不另生成）
 * superseded         已失效：本地核查内容变化后被补充件替代
 */
export const filingStatuses = [
  'pending_submission',
  'submitted',
  'send_failed',
  'superseded'
] as const;
export type FilingStatus = (typeof filingStatuses)[number];

/** initial 首次报送；supplement 原报送件失效后的补充件 */
export const filingKinds = ['initial', 'supplement'] as const;
export type FilingKind = (typeof filingKinds)[number];

export type FilingInvalidReason = 'evidence_changed' | 'version_changed' | 'batch_changed';

export interface FilingSnapshot {
  /** 快照生成时的结论版本号 */
  versionNo: number;
  versionId: string;
  versionSummary: string;
  disposition: Disposition;
  rationale: string;
  /** 冻结时的证据矩阵（深拷贝，不受后续补证据影响） */
  evidence: EvidenceItem[];
  /** 冻结时的关联批号 */
  batches: string[];
  product: string;
  status: SignalStatus;
  riskLevel: RiskLevel;
  reportCount: number;
  occurrenceRate: number;
  /** 由冻结内容计算的指纹；当前核查内容与之一不一致即判定旧报送件失效 */
  contentHash: string;
  frozenAt: string;
}

export interface RegulatoryFiling {
  id: string;
  /** 监管侧报送号，确定性生成，重试沿用同一号 */
  filingNo: string;
  signalId: string;
  kind: FilingKind;
  status: FilingStatus;
  snapshot: FilingSnapshot;
  submittedBy: string | null;
  submittedAt: string | null;
  /** 已记录的监管回执号（对账命中后回填） */
  receiptNo: string | null;
  /** 失效信息 */
  supersededAt: string | null;
  supersededReason: FilingInvalidReason | null;
  supersededByFilingId: string | null;
  /** 报送失败原因（模拟渠道） */
  lastError: string | null;
  /** 同一信号同一份内容的幂等键：信号号+内容哈希 */
  idempotencyKey: string;
  /** 提交进行中占位：跨窗口并发时后到者据此让出生效权 */
  isSubmitting: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- 监管回执 ----

/**
 * matched       已与报送件对账
 * duplicate     回执号重复（只记一次，后续重复直接忽略）
 * pending_review 待核对：报送号无对应报送件，或指向另一条信号
 */
export const receiptStatuses = ['matched', 'duplicate', 'pending_review'] as const;
export type ReceiptStatus = (typeof receiptStatuses)[number];

export type ReceiptIssue = 'filing_not_found' | 'signal_mismatch';

export interface RegulatorReceipt {
  id: string;
  /** 监管回执号，全局唯一，重复回执只记一次 */
  receiptNo: string;
  filingNo: string;
  signalId: string;
  receivedAt: string;
  recordedBy: string;
  note: string | null;
  status: ReceiptStatus;
  issue: ReceiptIssue | null;
  /** 对账命中的本地报送件与信号 */
  matchedFilingId: string | null;
  matchedSignalId: string | null;
  duplicatedOfReceiptId: string | null;
  createdAt: string;
  reconciledAt: string | null;
}

export interface SignalCase {
  id: string;
  title: string;
  product: string;
  batch: string;
  sourceType: SignalSourceType;
  status: SignalStatus;
  riskLevel: RiskLevel;
  severity: number;
  reportCount: number;
  exposedUnits: number;
  occurrenceRate: number;
  occurredAt: string;
  openedAt: string;
  updatedAt: string;
  owner: string;
  description: string;
  affectedBatches: string[];
  evidence: EvidenceItem[];
  tasks: InvestigationTask[];
  versions: CaseVersion[];
  filings: RegulatoryFiling[];
  audit: AuditEntry[];
  reopenedCount: number;
}

export interface SignalFilters {
  query?: string;
  status?: SignalStatus | 'all';
  riskLevel?: RiskLevel | 'all';
  sourceType?: SignalSourceType | 'all';
}
