import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Permission } from '../access-control/permission.entity';
import { ModuleItem } from '../access-control/module-item.entity';
import {
  DEFAULT_BUFFER_CHANNELS,
  SOCIAL_EXTRA_PERMISSIONS,
} from './social-post.constants';
import { SocialChannel } from './social-channel.entity';

@Injectable()
export class SocialPostsMigrationService implements OnModuleInit {
  private readonly logger = new Logger(SocialPostsMigrationService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SocialChannel)
    private readonly channels: Repository<SocialChannel>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    @InjectRepository(ModuleItem)
    private readonly items: Repository<ModuleItem>,
  ) {}

  async onModuleInit() {
    await this.ensureTables();
    await this.seedChannels();
    await this.ensureExtraPermissions();
  }

  private async ensureTables() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS acaf_social_canais (
        id CHAR(36) NOT NULL PRIMARY KEY,
        rede ENUM('instagram','facebook','linkedin') NOT NULL,
        buffer_channel_id VARCHAR(64) NOT NULL,
        nome_exibicao VARCHAR(120) NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE KEY uq_social_canais_rede (rede),
        UNIQUE KEY uq_social_canais_buffer (buffer_channel_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS acaf_social_posts (
        id CHAR(36) NOT NULL PRIMARY KEY,
        codigo VARCHAR(32) NOT NULL,
        numero_exibicao VARCHAR(64) NOT NULL,
        tipo ENUM('feed','stories') NOT NULL,
        formato VARCHAR(200) NULL,
        envio ENUM('feed','stories','reels') NOT NULL,
        pilar VARCHAR(120) NULL,
        titulo VARCHAR(500) NOT NULL,
        visual TEXT NULL,
        legenda TEXT NULL,
        hashtags TEXT NULL,
        telas JSON NULL,
        link VARCHAR(2000) NULL,
        aviso TEXT NULL,
        agendado_para DATETIME NULL,
        aprovacao ENUM('pendente','aprovado','ajustar') NOT NULL DEFAULT 'pendente',
        etapa ENUM('rascunho','programado','publicado') NOT NULL DEFAULT 'rascunho',
        nota TEXT NULL,
        redes JSON NOT NULL,
        aprovado_por CHAR(36) NULL,
        aprovado_em DATETIME(6) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE KEY uq_social_posts_codigo (codigo),
        KEY idx_social_posts_agendado (agendado_para)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS acaf_social_post_artes (
        id CHAR(36) NOT NULL PRIMARY KEY,
        post_id CHAR(36) NOT NULL,
        ordem INT UNSIGNED NOT NULL DEFAULT 0,
        nome VARCHAR(120) NULL,
        arquivo VARCHAR(500) NULL,
        url_publica VARCHAR(2000) NULL,
        drive_id VARCHAR(120) NULL,
        largura INT UNSIGNED NULL,
        altura INT UNSIGNED NULL,
        interacao VARCHAR(16) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        KEY idx_social_post_artes_post_ordem (post_id, ordem),
        CONSTRAINT fk_social_post_artes_post FOREIGN KEY (post_id) REFERENCES acaf_social_posts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS acaf_social_post_buffer (
        id CHAR(36) NOT NULL PRIMARY KEY,
        post_id CHAR(36) NOT NULL,
        rede ENUM('instagram','facebook','linkedin') NOT NULL,
        buffer_post_id VARCHAR(64) NULL,
        buffer_channel_id VARCHAR(64) NOT NULL,
        ordem_arte INT UNSIGNED NOT NULL DEFAULT 0,
        status ENUM('draft','scheduled','sending','sent','error') NOT NULL DEFAULT 'draft',
        due_at DATETIME NULL,
        external_link VARCHAR(2000) NULL,
        erro TEXT NULL,
        sincronizado_em DATETIME(6) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE KEY uq_social_post_buffer_slot (post_id, rede, ordem_arte),
        KEY idx_social_post_buffer_post (post_id),
        CONSTRAINT fk_social_post_buffer_post FOREIGN KEY (post_id) REFERENCES acaf_social_posts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    try {
      await this.dataSource.query(`
        ALTER TABLE acaf_social_post_buffer
        ADD COLUMN manual TINYINT(1) NOT NULL DEFAULT 0 AFTER erro
      `);
    } catch {
      /* coluna já existe */
    }

    try {
      await this.dataSource.query(`
        ALTER TABLE acaf_social_posts
        ADD COLUMN responsavel_user_id CHAR(36) NULL AFTER aprovado_em,
        ADD COLUMN manual_reminder_sent_at DATETIME(6) NULL AFTER responsavel_user_id
      `);
    } catch {
      /* colunas já existem */
    }

    this.logger.log('Tabelas do calendário de redes sociais verificadas.');
  }

  private async seedChannels() {
    for (const [rede, cfg] of Object.entries(DEFAULT_BUFFER_CHANNELS)) {
      const existing = await this.channels.findOne({
        where: { rede: rede as keyof typeof DEFAULT_BUFFER_CHANNELS },
      });
      if (!existing) {
        await this.channels.save(
          this.channels.create({
            rede: rede as keyof typeof DEFAULT_BUFFER_CHANNELS,
            bufferChannelId: cfg.bufferChannelId,
            nomeExibicao: cfg.nomeExibicao,
          }),
        );
      }
    }
  }

  private async ensureExtraPermissions() {
    const navItem = await this.items.findOne({
      where: { route: '/m/marketing/redes-sociais' },
    });
    for (const extra of SOCIAL_EXTRA_PERMISSIONS) {
      let permission = await this.permissions.findOne({ where: { key: extra.key } });
      if (!permission) {
        permission = this.permissions.create({
          key: extra.key,
          label: extra.label,
          moduleItemId: navItem?.id ?? null,
        });
      } else {
        permission.label = extra.label;
        if (navItem?.id) permission.moduleItemId = navItem.id;
      }
      await this.permissions.save(permission);
    }
  }
}