# GitScope Metrics & Analysis Definitions

**Document version:** 1.0.0  
**Status:** Active  
**Scope:** Specification of repository analytics, time series aggregation, file hotspots, co-change coupling, and data coverage semantics for GitScope.

---

## 1. Ethical & Interpretive Principles

GitScope is designed for software engineering observability, code architecture exploration, and maintenance risk prioritization. The metrics computed by GitScope reflect **historical repository change patterns**, not individual developer performance or definitive defect attribution.

> [!IMPORTANT]
>
> - **Commit Count is Not Productivity:** Commit counts vary widely depending on branching workflows, commit granularity (e.g. micro-commits vs. squashed features), automated tooling, and formatting sweeps. High commit volume does not imply high value, and low commit volume does not imply lack of progress.
> - **Change Frequency is Not Defect Density:** A file that changes frequently may be a core domain router, configuration table, or actively developed feature. While high change frequency coupled with high churn can correlate with regression risk, it is not proof of defects or poor code quality.
> - **Co-Change is Association, Not Causation:** Co-change indicates that two files were committed together in the same change set. It highlights historical structural or semantic coupling, but does not prove runtime architectural dependency.

---

## 2. Core Metrics Specification

### 2.1. Commit Activity

#### Definition

Commit activity aggregates the number of commits authored within discrete, non-overlapping chronological time buckets across a specified time interval \( [T_{\text{from}}, T_{\text{to}}] \).

#### Mathematical Formula

Let \( \mathcal{C} \) be the set of commits in repository \( R \). Each commit \( c \in \mathcal{C} \) possesses an author timestamp \( t_{\text{author}}(c) \). Given time interval \( [T_{\text{from}}, T_{\text{to}}] \) and bucketing function \( B_{\text{interval}}(t) \to \text{bucket\_key} \):

\[
\text{Activity}(b) = \left| \{ c \in \mathcal{C} \mid B_{\text{interval}}(t_{\text{author}}(c)) = b \land T_{\text{from}} \le t_{\text{author}}(c) \le T_{\text{to}} \} \right|
\]

#### Interval Bucketing Rules (UTC)

All time bucketing is calculated strictly in **UTC ISO 8601**:

1. **Day (`day`)**:
   - Bucket key: `YYYY-MM-DD` (starts at `YYYY-MM-DDT00:00:00.000Z`, ends at `YYYY-MM-DDT23:59:59.999Z`).
2. **Week (`week`)**:
   - Bucket key: `YYYY-Www` (ISO week date, starting Monday 00:00:00.000Z).
   - Display timestamp: The ISO UTC timestamp of the Monday starting that week.
3. **Month (`month`)**:
   - Bucket key: `YYYY-MM` (starts at the 1st of the month `YYYY-MM-01T00:00:00.000Z`).

#### Zero-Fill Requirement

Queries must return **contiguous zero-filled buckets** across the entire requested range \( [T_{\text{from}}, T_{\text{to}}] \). If no commits occurred in a bucket, the query returns \( \text{count} = 0 \) and \( \text{distinctContributors} = 0 \).

#### Range Bounds

- Default range: Earliest commit in repository (`SELECT MIN(author_time)` bounded by maximum interval limits) if `from` is unspecified, falling back to 365 days for empty repositories. The Web UI default preset is 1 year (`1y`).
- Maximum range: 5 years (1826 days) for daily buckets, 10 years for weekly/monthly buckets. Requests exceeding maximum bounds or with \( T_{\text{from}} > T_{\text{to}} \) are rejected with HTTP 400 (`INVALID_DATE_RANGE`).

---

### 2.2. Contributor Overview

#### Definition

Identifies distinct authors contributing commits within the requested window, their commit counts, and first/last active timestamps.

#### Identity Normalization Rule

Git records author metadata as `author_name` and `author_email` strings provided by the client during `git commit`. To avoid fragmentation caused by casing variations or minor whitespace:

1. **Primary Key**: Normalized email address: `LOWER(TRIM(author_email))`.
2. **Display Name**: Most recent `author_name` associated with the normalized email.
3. **Fallback**: If `author_email` is empty, fallback to `LOWER(TRIM(author_name))`.

#### Distinct Contributor Count

\[
\text{DistinctContributors}(b) = \left| \{ \text{normalize}(c.\text{author\_email}) \mid c \in \text{commits}(b) \} \right|
\]

---

### 2.3. File Hotspots

#### Definition

File hotspots identify files exhibiting high revision frequency and cumulative modification volume across repository history or a filtered time window.

#### Metrics Computed Per File Path \( p \):

1. **Distinct Commits** (\( C_{\text{distinct}} \)):
   The primary hotspot score.
   \[
   C_{\text{distinct}}(p) = \left| \{ c.\text{hash} \mid \exists f \in \text{file\_changes}(c) \text{ with } f.\text{path} = p \} \right|
   \]
2. **Known Additions** (\( \Sigma_{\text{add}} \)):
   Sum of lines added across commits modifying \( p \), excluding binary modifications.
   \[
   \Sigma_{\text{add}}(p) = \sum_{f \in \text{changes}(p), f.\text{additions} \ne \text{NULL}} f.\text{additions}
   \]
3. **Known Deletions** (\( \Sigma_{\text{del}} \)):
   Sum of lines deleted across commits modifying \( p \), excluding binary modifications.
   \[
   \Sigma_{\text{del}}(p) = \sum_{f \in \text{changes}(p), f.\text{deletions} \ne \text{NULL}} f.\text{deletions}
   \]
4. **Last Modified Time** (\( T_{\text{last}} \)):
   Latest author timestamp among commits modifying \( p \).
   \[
   T_{\text{last}}(p) = \max_{c \in \text{modifying\_commits}(p)} c.\text{author\_time}
   \]

#### Ranking & Tie-Breaking

1. `distinct_commits DESC`
2. `(known_additions + known_deletions) DESC`
3. `path ASC` (deterministic alphabetical tie-breaker)

---

### 2.4. Co-Change Analysis (Logical Coupling)

#### Definition

Co-change analysis quantifies the historical frequency with which pairs of distinct repository files are modified together within the same commit.

#### Pairing Rule

For any commit \( c \), let \( P(c) = \{ f.\text{path} \mid f \in \text{file\_changes}(c) \} \) be the set of distinct file paths modified in \( c \).
The set of unordered pairs generated by commit \( c \) is:

\[
\text{Pairs}(c) = \{ \{u, v\} \mid u, v \in P(c) \land u \ne v \}
\]

To prevent duplicate reversed pairs, pairs are canonicalized lexicographically such that \( u < v \).

#### Co-Change Count

For file pair \( (u, v) \) with \( u < v \):

\[
\text{CoChange}(u, v) = \left| \{ c \in \mathcal{C} \mid u \in P(c) \land v \in P(c) \} \right|
\]

#### Safety Threshold & Combinatorial Bounding

A commit modifying \( N \) files produces \( \frac{N(N - 1)}{2} \) pairs. Massive commits (e.g. bulk license updates, automated formatting, dependency lockfile regenerations) can generate millions of synthetic pairs that distort metrics and exhaust system memory.

- **Safety Ceiling (`COCHANGE_MAX_FILES_PER_COMMIT`)**: Commits modifying more than 200 files (configurable via environment variable) are **excluded** from co-change pair mining.
- **Minimum Support Threshold (`minCount`)**: Pairs with \( \text{CoChange}(u, v) < \text{minCount} \) (default: 2) are filtered out, focusing results on recurring associations.
- **Bounded Result Limit (`limit`)**: Returned pairs are bounded (default: 50, maximum: 500).

#### Ranking

1. `co_change_count DESC`
2. `path_a ASC`
3. `path_b ASC`

---

## 3. Data Coverage & Edge Case Handling

| Scenario                                     | Impact on Commit Activity                              | Impact on File Hotspots                                                                                             | Impact on Co-Changes                                                                           |
| :------------------------------------------- | :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------- |
| **Binary Files** (`is_binary = 1`)           | Counted normally as commit activity.                   | Increments distinct commit count; additions/deletions recorded as `NULL` (displayed as `unknown` / `-`, not 0).     | Included in co-change pairs if touched alongside other files.                                  |
| **Merge Commits**                            | Author timestamp of merge commit included in activity. | Included if the merge introduced explicit diff hunks (e.g. conflict resolutions).                                   | Included only if merge introduced explicit file changes \( \le \text{threshold} \).            |
| **File Renames** (`change_type = 'renamed'`) | Counted normally in commit activity.                   | Changes are associated with the canonical post-rename `path`. Historical `old_path` is preserved in record history. | Pairs use the canonical `path` at the time of commit.                                          |
| **Empty Repository**                         | Returns 0 commits across zero-filled date range.       | Returns empty list `[]`.                                                                                            | Returns empty list `[]`.                                                                       |
| **Missing Additions / Deletions**            | No impact.                                             | Stored as `NULL`; summed aggregates count only known non-null values.                                               | No impact (pairing depends only on path co-presence).                                          |
| **Large Commits** (\( > 200 \) files)        | Counted in commit activity.                            | Counted in file hotspots.                                                                                           | **Excluded from co-change mining**; total excluded commit count reported in response metadata. |
