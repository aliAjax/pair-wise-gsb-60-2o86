import { fail } from '@sveltejs/kit';
import { receiptSchema, resolveReceiptSchema } from '$lib/models/regulatory';

function failure(error: { issues: Array<{ message: string }> }) {
  return fail(400, {
    message: error.issues[0]?.message ?? '表单校验失败'
  });
}

export const actions = {
  receipt: async ({ request }) => {
    const formData = await request.formData();
    const parsed = receiptSchema.safeParse({
      receiptNo: String(formData.get('receiptNo') ?? ''),
      receivedAt: String(formData.get('receivedAt') ?? ''),
      gatewayReportNo: String(formData.get('gatewayReportNo') ?? '') || undefined,
      signalId: String(formData.get('signalId') ?? '') || undefined,
      actor: String(formData.get('actor') ?? '')
    });
    if (!parsed.success) return failure(parsed.error);

    return { success: true, receipt: parsed.data };
  },

  resolve: async ({ request }) => {
    const formData = await request.formData();
    const parsed = resolveReceiptSchema.safeParse({
      receiptId: String(formData.get('receiptId') ?? ''),
      reportId: String(formData.get('reportId') ?? ''),
      note: String(formData.get('note') ?? ''),
      actor: String(formData.get('actor') ?? '')
    });
    if (!parsed.success) return failure(parsed.error);

    return { success: true, resolve: parsed.data };
  }
};
