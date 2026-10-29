-- Migration 002: Add index on old_path for optimized file history rename queries
CREATE INDEX IF NOT EXISTS idx_file_changes_repo_old_path ON file_changes(repo_id, old_path);

