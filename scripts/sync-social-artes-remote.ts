process.env.SOCIAL_ARTES_SKIP_STARTUP_SYNC = '1';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SocialPostsService } from '../src/social-posts/social-posts.service';

async function main() {
  const force = process.argv.includes('--force') || process.env.FORCE === '1';
  if (!process.env.SOCIAL_ARTES_SYNC_GAP_MS) process.env.SOCIAL_ARTES_SYNC_GAP_MS = '800';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const posts = app.get(SocialPostsService);
    const result = await posts.relinkAllArtesFromAssets({ force });
    // eslint-disable-next-line no-console
    console.log(
      `Artes no storage remoto: ${result.linked} enviada(s)/atualizada(s), ${result.alreadyOk} já ok, ${result.missing} sem arquivo local, ${result.failed} falha(s), total ${result.total}${force ? ' (force)' : ''}`,
    );
    if (result.missing) {
      // eslint-disable-next-line no-console
      console.warn(
        'Artes faltando: coloque PNG em storage/social-posts/assets/{codigo}/ ou faça upload no admin.',
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});