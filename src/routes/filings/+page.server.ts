import { fail } from '@sveltejs/kit';
import { filingSubmissionSchema, receiptSchema } from '$lib/models/signal';

function failure(error: { issues: Array<{ message: string }> }) {
  return fail(400, {
    message: error.issues[0]?.message ?? '表单校验失败'
  });
}

export const actions = {
  // 提交报送件（仅做服务端校验；幂等/并发仲裁在本地 store 完成）
  submit: async ({ request }) => {
    const formData = await request.formData();
    const parsed = filingSubmissionSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return failure(parsed.error);

    return { success: true, submission: parsed.data };
  },

  // 录入监管回执
  receipt: async ({ request }) => {
    const formData = await request.formData();
    const parsed = receiptSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return failure(parsed.error);

    return {
      success: true,
      receipt: parsed.data
    };
  }
};
