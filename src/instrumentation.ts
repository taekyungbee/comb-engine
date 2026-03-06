export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initVectorExtension } = await import('./lib/rag/embedding');
    const { initScheduler } = await import('./lib/scheduler');

    try {
      await initVectorExtension();
      console.log('[Init] pgvector extension initialized');
    } catch (error) {
      console.warn('[Init] pgvector init skipped (may need data first):', error);
    }

    await initScheduler();
  }
}
