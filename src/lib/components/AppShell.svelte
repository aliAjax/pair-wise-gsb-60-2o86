<script lang="ts">
  import { page } from '$app/stores';

  const navItems = [
    { href: '/', label: '总览', short: '览' },
    { href: '/signals', label: '信号台账', short: '信' },
    { href: '/trends', label: '趋势核对', short: '趋' },
    { href: '/batches', label: '批次追踪', short: '批' },
    { href: '/audit', label: '审计报告', short: '审' }
  ];
</script>

<div class="min-h-screen bg-surface-50-950">
  <header class="sticky top-0 z-20 border-b border-surface-300-700 bg-surface-50-950/95 backdrop-blur">
    <div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-4 py-3 lg:px-6">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded bg-teal-700 font-bold text-white">安</div>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-surface-900-50">医疗器械上市后安全信号核查与处置平台</p>
          <p class="text-xs text-surface-500-400">Safety Signal Operations / SvelteKit</p>
        </div>
      </div>
      <nav class="order-3 flex w-full gap-1 overflow-x-auto lg:order-none lg:ml-auto lg:w-auto" aria-label="主导航">
        {#each navItems as item}
          <a
            href={item.href}
            class="btn btn-sm whitespace-nowrap {$page.url.pathname === item.href ? 'variant-filled-primary' : 'variant-ghost-surface'}"
          >
            {item.label}
          </a>
        {/each}
      </nav>
      <div class="ml-auto hidden items-center gap-3 lg:flex">
        <div class="text-right">
          <p class="text-xs text-surface-500-400">当前角色</p>
          <p class="text-sm font-medium">安全评审专员</p>
        </div>
        <span class="badge variant-soft-primary">在线</span>
      </div>
    </div>
  </header>

  <main class="mx-auto max-w-[1600px] px-4 py-5 lg:px-6 lg:py-7">
    <slot />
  </main>
</div>
