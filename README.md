# 医疗器械上市后安全信号核查与处置平台

面向医疗器械上市后安全团队的本地工作台，用于合并投诉、维修、不良事件和现场报告，维护证据矩阵、调查任务、风险状态、结论版本和审计轨迹。

## 技术栈

- SvelteKit 2 + Vite + TypeScript
- Skeleton UI + Tailwind CSS
- Svelte stores
- SvelteKit Form Actions
- TanStack Query for Svelte
- Zod

## 主要工作区

- `/`：开放信号、高风险信号、任务和逾期总览
- `/signals`：关键词与多条件筛选、人工登记新信号
- `/signals/[id]`：证据矩阵、状态流转、补充证据、结论版本、重新打开和审计
- `/trends`：发生率趋势与阈值核对
- `/batches`：批号覆盖与报告追踪
- `/audit`：跨信号审计时间线和 JSON 报告导出

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:18460`。

## 构建与检查

```bash
npm run check
npm run build
```

无后端服务，页面使用确定性模拟数据，并将信号、证据、版本和审计记录持久化到浏览器 `localStorage`。关键表单先经过 SvelteKit Form Action 与 Zod 校验，再写入本地 store。
