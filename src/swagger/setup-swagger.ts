import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const API_DESCRIPTION = [
  'API do ecossistema **ACAF** (NestJS).',
  '',
  '## Autenticação',
  '',
  '| Esquema | Uso |',
  '|---------|-----|',
  '| **Admin JWT** (Authorization: Bearer) | Painel acaf-adm — login em POST /api/auth/login |',
  '| **Partner JWT** | Portal acaf-partner — login em POST /api/partner/auth/login |',
  '| **Corporate JWT** | Portal acaf-corporate — login em POST /api/corporate/auth/login |',
  '',
  'Rotas públicas (catálogo, check-in do app, validação de código de empresa) não exigem token.',
  '',
  '## Prefixo',
  '',
  'Quase todos os endpoints usam o prefixo /api. Exceções:',
  '',
  '- GET /test — ping de disponibilidade',
  '- GET /docs — esta documentação (Swagger UI)',
  '- GET /docs/openapi.json — especificação OpenAPI',
  '- GET /shared/connect_domain.json — configuração compartilhada (planos, taxas)',
  '',
  '## Consumidores',
  '',
  '- acaf-app (Flutter) — catálogo, planos, check-in, diárias, reservas',
  '- acaf-partner — portal da academia (unidades, recepção, clientes, financeiro)',
  '- acaf-adm — admin interno (redes, unidades, empresas, modalidades)',
  '- acaf-corporate — empresas (colaboradores, faturas, convites)',
].join('\n');

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('ACAF API')
    .setDescription(API_DESCRIPTION)
    .setVersion(process.env.npm_package_version ?? '1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token do painel admin (`POST /api/auth/login`)',
      },
      'admin-jwt',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token do portal parceiro (`POST /api/partner/auth/login`)',
      },
      'partner-jwt',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token do portal corporativo (`POST /api/corporate/auth/login`)',
      },
      'corporate-jwt',
    )
    .addTag('Público', 'Health, test, configuração compartilhada e assets')
    .addTag(
      'App & Parceiro',
      'Catálogo, planos, check-in, reservas, portal da academia e clientes (app + acaf-partner)',
    )
    .addTag('Admin · Auth', 'Login e sessão do painel administrativo')
    .addTag('Admin · API', 'Redes, unidades, empresas, modalidades e usuários (JWT admin)')
    .addTag('Parceiro · Auth', 'Login do portal da academia')
    .addTag('Corporativo', 'Colaboradores, faturas e convites (JWT empresa)')
    .addTag('Corporativo · Auth', 'Cadastro e login de empresas')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: false,
    customSiteTitle: 'ACAF API — Documentação',
    jsonDocumentUrl: 'docs/openapi.json',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      showRequestDuration: true,
    },
  });
}
