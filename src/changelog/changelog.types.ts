export type ChangelogCategory = 'feature' | 'fix' | 'improvement' | 'docs' | 'maintenance';

export type ChangelogAudience = 'internal' | 'partner' | 'client';

export type ChangelogEntryRaw = {
  id: string;
  commitSha?: string | null;
  committedAt: string;
  title: string;
  summary?: string | null;
  category: ChangelogCategory;
  areas: string[];
  highlights?: string[];
  author?: string | null;
  audience?: ChangelogAudience;
  published?: boolean;
};

export type ChangelogFile = {
  version: number;
  entries: ChangelogEntryRaw[];
};

export type ChangelogAreaDto = { id: string; label: string };

export type ChangelogEntryDto = {
  id: string;
  commitSha: string | null;
  committedAt: string;
  title: string;
  summary: string | null;
  category: ChangelogCategory;
  categoryLabel: string;
  areas: ChangelogAreaDto[];
  highlights: string[];
  author: string | null;
  audience: ChangelogAudience;
  published: boolean;
};
