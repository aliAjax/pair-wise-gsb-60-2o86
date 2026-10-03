import type { CaseVersion, EvidenceItem, SignalCase } from '$lib/models/signal';

let counter = 0;

export function makeSignal(overrides: Partial<SignalCase> = {}): SignalCase {
  counter += 1;
  const id = overrides.id ?? `SIG-T-${String(counter).padStart(3, '0')}`;
  const evidence: EvidenceItem[] = overrides.evidence ?? [
    {
      id: `${id}-E1`,
      type: 'test',
      title: '初始测试证据',
      source: '实验室',
      strength: 'strong',
      batch: 'B1',
      note: '初始核查说明。',
      createdAt: '2026-09-01T00:00:00.000Z'
    }
  ];
  const versions: CaseVersion[] = overrides.versions ?? [
    {
      id: `${id}-V1`,
      version: 1,
      author: '测试员',
      summary: '初始结论摘要，满足报送条件。',
      disposition: 'risk_communication',
      rationale: '初始判断依据充分。',
      createdAt: '2026-09-02T00:00:00.000Z'
    }
  ];
  return {
    id,
    title: '测试信号标题',
    product: '测试器械 X1',
    batch: 'B1',
    sourceType: 'adverse_event',
    status: 'action_required',
    riskLevel: 'high',
    severity: 4,
    reportCount: 3,
    exposedUnits: 100,
    occurrenceRate: 1.2,
    occurredAt: '2026-09-01',
    openedAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    owner: '测试员',
    description: '测试信号经过描述。',
    affectedBatches: overrides.affectedBatches ?? ['B1'],
    evidence,
    tasks: [],
    versions,
    audit: [],
    reopenedCount: 0,
    ...overrides
  };
}

export function makeSignalWithoutVersion(overrides: Partial<SignalCase> = {}): SignalCase {
  return makeSignal({ versions: [], ...overrides });
}
