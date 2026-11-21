import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ProjectTasksSeedService } from '../src/project-tasks/project-tasks-seed.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const seed = app.get(ProjectTasksSeedService);
    const result = await seed.seedFromJsonFile({ forceUpsert: true });
    // eslint-disable-next-line no-console
    console.log('Seed cronograma concluído:', result);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});