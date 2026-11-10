import type { ChangelogCategory } from './changelog.types';

export function parseChangelogCategory(subject: string): ChangelogCategory {
  const match = /^(feat|fix|perf|refactor|docs|style|test|chore|ci|build)(\([^)]*\))?!?:\s*/i.exec(
    subject,
  );
  if (!match) return 'maintenance';
  const key = match[1].toLowerCase();
  if (key === 'feat') return 'feature';
  if (key === 'fix') return 'fix';
  if (key === 'docs') return 'docs';
  if (key === 'perf' || key === 'refactor') return 'improvement';
  return 'maintenance';
}

export function humanizeChangelogSubject(subject: string): string {
  const stripped = subject
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/^(feat|fix|perf|refactor|docs|style|test|chore|ci|build)(\([^)]*\))?!?:\s*/i, '')
    .trim();
  const text = stripped || subject.trim();
  if (!text) return 'Atualização do projeto';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function extractChangelogHighlights(body: string): string[] {
  const lines = String(body ?? '').split('\n');
  const highlights: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^changelog\s*:/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (!line) {
        if (highlights.length) break;
        continue;
      }
      if (/^[a-z]+(\([^)]*\))?!?:\s+/i.test(line) && !line.startsWith('-')) break;
      const bullet = line.replace(/^[-*•]\s*/, '').trim();
      if (bullet) highlights.push(bullet);
    }
  }
  return highlights;
}

export function shouldSkipChangelog(subject: string, body: string): boolean {
  return /\[skip changelog\]/i.test(`${subject}\n${body}`);
}
