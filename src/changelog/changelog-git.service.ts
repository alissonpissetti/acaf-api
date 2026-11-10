import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  extractChangelogHighlights,
  humanizeChangelogSubject,
  parseChangelogCategory,
  shouldSkipChangelog,
} from './changelog-commit-parse';
import {
  loadChangelogEnvironments,
  normalizeChangelogAreaId,
  normalizeChangelogAreaIds,
  type ChangelogEnvironmentsManifest,
} from './changelog-environments';
import type { ChangelogEntryRaw } from './changelog.types';

const GIT_FIELD = '\x1f';
const GIT_RECORD = '\x1e';

type GitRepoRef = {
  envId: string;
  repoPath: string;
};

@Injectable()
export class ChangelogGitService {
  private readonly logger = new Logger(ChangelogGitService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    const raw = this.config.get<string>('CHANGELOG_GIT_READ');
    if (raw === '0' || raw === 'false') return false;
    return true;
  }

  collectMissingFromGit(
    persisted: ChangelogEntryRaw[],
    options?: { limitPerRepo?: number },
  ): ChangelogEntryRaw[] {
    if (!this.isEnabled()) return [];

    const limit = Math.min(120, Math.max(5, Number(options?.limitPerRepo ?? 40) || 40));
    const manifest = loadChangelogEnvironments();
    const known = this.buildKnownKeys(persisted);
    const repos = this.resolveRepositories(manifest);
    const collected: ChangelogEntryRaw[] = [];

    for (const repo of repos) {
      const commits = this.readGitLog(repo.repoPath, limit);
      for (const commit of commits) {
        const key = this.entryKey(repo.envId, commit.sha);
        if (known.has(key)) continue;
        if (shouldSkipChangelog(commit.subject, commit.body)) continue;

        const areas = this.areasForCommit({
          repo,
          manifest,
          subject: commit.subject,
          body: commit.body,
          files: commit.files,
        });

        const highlights = extractChangelogHighlights(commit.body);
        collected.push({
          id: `git:${repo.envId}:${commit.sha}`,
          commitSha: commit.sha,
          committedAt: commit.date,
          title: humanizeChangelogSubject(commit.subject),
          summary: highlights.length
            ? null
            : commit.body
                .split('\n')
                .find((line) => line.trim() && !/^changelog\s*:/i.test(line))
                ?.trim() || null,
          category: parseChangelogCategory(commit.subject),
          areas,
          highlights,
          author: commit.author || null,
          audience: 'internal',
          published: true,
          repository: repo.envId,
          source: 'git',
        });
        known.add(key);
      }
    }

    return collected;
  }

  syncMissingToFile(
    filePath: string,
    persisted: ChangelogEntryRaw[],
    options?: { limitPerRepo?: number },
  ): { added: number; entries: ChangelogEntryRaw[] } {
    const missing = this.collectMissingFromGit(persisted, options);
    if (!missing.length) return { added: 0, entries: persisted };

    const merged = [...missing, ...persisted].sort(
      (a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime(),
    );

    const payload = { version: 1, entries: merged };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return { added: missing.length, entries: merged };
  }

  private buildKnownKeys(rows: ChangelogEntryRaw[]): Set<string> {
    const keys = new Set<string>();
    for (const row of rows) {
      const sha = String(row.commitSha ?? '').trim();
      if (!sha) continue;
      const repo = String(row.repository ?? '').trim() || this.inferRepositoryFromAreas(row.areas);
      keys.add(this.entryKey(repo || 'unknown', sha));
      keys.add(this.entryKey('unknown', sha));
      keys.add(sha);
    }
    return keys;
  }

  private inferRepositoryFromAreas(areas: string[] | undefined): string {
    const list = areas ?? [];
    if (list.length === 1) return list[0];
    return '';
  }

  private entryKey(repository: string, sha: string): string {
    return `${repository}:${sha}`;
  }

  private areasForCommit(input: {
    repo: GitRepoRef;
    manifest: ChangelogEnvironmentsManifest;
    subject: string;
    body: string;
    files: string[];
  }): string[] {
    const merged = new Set<string>([input.repo.envId]);

    for (const file of input.files) {
      for (const env of input.manifest.environments) {
        if (env.folder && file.startsWith(`${env.folder}/`)) merged.add(env.id);
      }
      for (const infra of input.manifest.infra ?? []) {
        for (const prefix of infra.folders ?? []) {
          if (file.startsWith(prefix)) merged.add(infra.id);
        }
      }
    }

    const scopeMatch = /^(?:feat|fix|perf|refactor|docs|style|test|chore|ci|build)\(([^)]+)\)/i.exec(
      input.subject,
    );
    if (scopeMatch?.[1]) {
      for (const token of scopeMatch[1].split(/[,/|]/)) {
        const id = normalizeChangelogAreaId(token.trim(), input.manifest);
        if (id) merged.add(id);
      }
    }

    for (const raw of input.body.split('\n')) {
      const line = raw.trim();
      const match = /^(ambientes?|environments?)\s*:\s*(.+)$/i.exec(line);
      if (!match?.[2]) continue;
      for (const token of match[2].split(/[,;|/]/)) {
        const id = normalizeChangelogAreaId(token.trim(), input.manifest);
        if (id) merged.add(id);
      }
    }

    return normalizeChangelogAreaIds([...merged], input.manifest);
  }

  private resolveRepositories(manifest: ChangelogEnvironmentsManifest): GitRepoRef[] {
    const configured = this.parseConfiguredRepos();
    if (configured.length) return configured;

    const changelogFile = this.resolveChangelogFilePath();
    const workspaceRoot = changelogFile
      ? path.resolve(path.dirname(changelogFile), '..', '..')
      : path.resolve(process.cwd(), '..');

    const repos: GitRepoRef[] = [];
    for (const env of manifest.environments) {
      if (!env.folder) continue;
      const repoPath = path.join(workspaceRoot, env.folder);
      if (!this.isGitRepo(repoPath)) continue;
      repos.push({ envId: env.id, repoPath });
    }

    const apiPath = path.join(workspaceRoot, 'acaf-api');
    if (this.isGitRepo(apiPath) && !repos.some((row) => row.envId === 'api')) {
      repos.push({ envId: 'api', repoPath: apiPath });
    }

    return repos;
  }

  private parseConfiguredRepos(): GitRepoRef[] {
    const raw = this.config.get<string>('CHANGELOG_GIT_REPOS')?.trim();
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as Array<{ id?: string; path?: string }>;
      return parsed
        .map((row) => ({
          envId: String(row.id ?? '').trim(),
          repoPath: path.resolve(String(row.path ?? '').trim()),
        }))
        .filter((row) => row.envId && row.repoPath && this.isGitRepo(row.repoPath));
    } catch {
      return raw
        .split(',')
        .map((chunk) => {
          const [id, repoPath] = chunk.split('=').map((part) => part.trim());
          if (!id || !repoPath) return null;
          const resolved = path.resolve(repoPath);
          if (!this.isGitRepo(resolved)) return null;
          return { envId: id, repoPath: resolved };
        })
        .filter((row): row is GitRepoRef => row !== null);
    }
  }

  private isGitRepo(repoPath: string): boolean {
    return fs.existsSync(path.join(repoPath, '.git'));
  }

  private resolveChangelogFilePath(): string | null {
    const envPath = this.config.get<string>('CHANGELOG_FILE')?.trim();
    if (envPath && fs.existsSync(envPath)) return path.resolve(envPath);

    const cwd = process.cwd();
    for (const candidate of [
      path.resolve(cwd, 'changelog/changelog.json'),
      path.resolve(cwd, '../changelog/changelog.json'),
      path.resolve(cwd, '../../changelog/changelog.json'),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  private readGitLog(
    repoPath: string,
    limit: number,
  ): Array<{ sha: string; date: string; author: string; subject: string; body: string; files: string[] }> {
    try {
      const format = ['%H', '%cI', '%an', '%s', '%b'].join(GIT_FIELD);
      const out = execFileSync(
        'git',
        ['-C', repoPath, 'log', `-n${limit}`, `--format=${format}${GIT_RECORD}`],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      );
      const blocks = out.split(GIT_RECORD).map((block) => block.trim()).filter(Boolean);
      const commits: Array<{
        sha: string;
        date: string;
        author: string;
        subject: string;
        body: string;
        files: string[];
      }> = [];

      for (const block of blocks) {
        const [sha, date, author, subject, body = ''] = block.split(GIT_FIELD);
        if (!sha || !subject) continue;
        commits.push({
          sha: sha.trim(),
          date: date?.trim() || new Date().toISOString(),
          author: author?.trim() || '',
          subject: subject.trim(),
          body,
          files: this.filesForCommit(repoPath, sha.trim()),
        });
      }
      return commits;
    } catch (err) {
      this.logger.debug(
        `git log indisponível em ${repoPath}: ${err instanceof Error ? err.message : 'erro'}`,
      );
      return [];
    }
  }

  private filesForCommit(repoPath: string, sha: string): string[] {
    try {
      const out = execFileSync(
        'git',
        ['-C', repoPath, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha],
        { encoding: 'utf8' },
      );
      return out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}
