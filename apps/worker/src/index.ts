import { logEvent, readEnvironment, createWorkerRuntime } from '@runad123/server-core';
try {
  const env = readEnvironment(process.env),
    runtime = createWorkerRuntime(process.env);
  let stopping = false,
    inFlight: Promise<unknown> | null = null;
  logEvent('worker.started', {
    stage: 'M6',
    taskProcessing: !!runtime,
    aiProcessing: runtime?.aiProcessing ?? false,
    databaseConfigured: !!env.MYSQL_URL,
  });
  const run = () => {
    if (stopping || inFlight || !runtime) return;
    inFlight = runtime
      .tick()
      .catch(() => logEvent('worker.task_error', { code: 'WORKER_CYCLE_FAILED' }))
      .finally(() => {
        inFlight = null;
      });
  };
  const timer = setInterval(run, runtime ? 2000 : env.WORKER_HEARTBEAT_MS);
  run();
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    void Promise.resolve(inFlight).finally(async () => {
      await runtime?.close();
      logEvent('worker.stopped');
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch {
  logEvent('worker.config_error', { code: 'ENV_INVALID' });
  process.exitCode = 1;
}
