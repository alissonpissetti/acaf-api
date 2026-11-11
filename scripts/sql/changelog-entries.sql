-- Executar se DB_SYNC=false ou após deploy da entidade ChangelogEntry.
-- Com DB_SYNC=true a tabela acaf_changelog_entries é criada automaticamente.

CREATE TABLE IF NOT EXISTS acaf_changelog_entries (
  id VARCHAR(64) NOT NULL,
  commit_sha VARCHAR(40) NULL,
  repository VARCHAR(40) NULL,
  source VARCHAR(32) NOT NULL,
  committed_at DATETIME NOT NULL,
  title VARCHAR(300) NOT NULL,
  summary TEXT NULL,
  category VARCHAR(32) NOT NULL,
  areas JSON NOT NULL,
  highlights JSON NULL,
  author VARCHAR(120) NULL,
  audience VARCHAR(16) NOT NULL DEFAULT 'internal',
  published TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_changelog_repo_sha (repository, commit_sha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
