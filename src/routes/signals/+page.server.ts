import { fail } from '@sveltejs/kit';
import { createSignalFromForm } from '$lib/stores/signal-store';
import { createSignalSchema } from '$lib/models/signal';

export const actions = {
  default: async ({ request }) => {
    const formData = await request.formData();
    const raw = Object.fromEntries(formData);
    const parsed = createSignalSchema.safeParse(raw);

    if (!parsed.success) {
      return fail(400, {
        message: parsed.error.issues[0]?.message ?? '表单校验失败',
        values: raw
      });
    }

    return {
      success: true,
      signal: createSignalFromForm(parsed.data)
    };
  }
};
