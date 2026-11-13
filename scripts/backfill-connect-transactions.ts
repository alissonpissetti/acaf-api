import { NestFactory } from '@nestjs/core';
import { ConnectBackfillScriptModule } from '../src/asaas/connect-backfill.script-module';
import { ConnectTransactionBackfillService } from '../src/asaas/connect-transaction-backfill.service';

function parseLimit(argv: string[]): number | undefined {
  const idx = argv.findIndex((a) => a === '--limit');
  if (idx >= 0) {
    const raw = argv[idx + 1];
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const inline = argv.find((a) => a.startsWith('--limit='));
  if (inline) {
    const n = Number(inline.split('=')[1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return undefined;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const skipAsaas = process.argv.includes('--no-asaas');

  const app = await NestFactory.createApplicationContext(ConnectBackfillScriptModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const backfill = app.get(ConnectTransactionBackfillService);
    const summary = await backfill.run({
      limit,
      fetchFromAsaas: !skipAsaas,
    });

    console.log(JSON.stringify(summary, null, 2));

    if (summary.errors.length > 0) {
      console.error(`Concluído com ${summary.errors.length} aviso(s)/erro(s) em recebíveis específicos.`);
      process.exitCode = 0;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
