-- Migration 001: Initial Schema

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canonical_path TEXT NOT NULL UNIQUE,
  default_branch TEXT,
  last_analyzed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  started_at TEXT,
  finished_at TEXT,
  error_code TEXT,
  error_message TEXT,
  commits_processed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_repo_id ON analysis_runs(repo_id);

CREATE TABLE IF NOT EXISTS commits (
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_time TEXT NOT NULL,
  committer_time TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  PRIMARY KEY (repo_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_commits_repo_author_time ON commits(repo_id, author_time);

CREATE TABLE IF NOT EXISTS commit_parents (
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  parent_index INTEGER NOT NULL,
  PRIMARY KEY (repo_id, commit_hash, parent_index)
);

CREATE INDEX IF NOT EXISTS idx_commit_parents_repo_parent ON commit_parents(repo_id, parent_hash);

CREATE TABLE IF NOT EXISTS refs (
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ref_type TEXT NOT NULL CHECK(ref_type IN ('branch', 'tag')),
  target_hash TEXT NOT NULL,
  is_remote INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_id, name, ref_type)
);

CREATE INDEX IF NOT EXISTS idx_refs_repo_target ON refs(repo_id, target_hash);

CREATE TABLE IF NOT EXISTS file_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  old_path TEXT,
  change_type TEXT NOT NULL CHECK(change_type IN ('added', 'modified', 'deleted', 'renamed', 'copied', 'type_changed', 'unknown')),
  additions INTEGER,
  deletions INTEGER,
  is_binary INTEGER
);

CREATE INDEX IF NOT EXISTS idx_file_changes_repo_path ON file_changes(repo_id, path);
CREATE INDEX IF NOT EXISTS idx_file_changes_repo_commit ON file_changes(repo_id, commit_hash);
CREATE INDEX IF NOT EXISTS idx_file_changes_repo_change_type ON file_changes(repo_id, change_type);
