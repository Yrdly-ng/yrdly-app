import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

const appUrl = process.env.E2E_APP_URL ?? 'http://localhost:9002';

export default {
  targets: [
    {
      name: 'yrdly-app-web',
      engine: web(),
      app: {
        url: appUrl,
        command: {
          executable: 'pnpm',
          args: ['run', 'dev'],
          reuseExisting: true,
        },
      },
    },
  ],
  workers: 1,
} satisfies E2EConfig;
