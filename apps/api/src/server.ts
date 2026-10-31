import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { testClockFromEnv } from './test-clock';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

// TEST-ONLY: a fixed clock for the e2e suite; undefined (the real clock) in production.
const app = buildApp(config, { now: testClockFromEnv(process.env) });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
