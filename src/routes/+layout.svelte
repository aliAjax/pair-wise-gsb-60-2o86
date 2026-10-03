<script lang="ts">
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import AppShell from '$lib/components/AppShell.svelte';
  import '../app.css';

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false
      }
    }
  });
</script>

<svelte:head>
  <title>医疗器械安全信号核查平台</title>
  <meta
    name="description"
    content="面向医疗器械上市后安全团队的信号聚类、证据核查、风险处置与审计工作台"
  />
</svelte:head>

<QueryClientProvider client={queryClient}>
  <AppShell>
    <slot />
  </AppShell>
</QueryClientProvider>
