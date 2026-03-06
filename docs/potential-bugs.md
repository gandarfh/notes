# Potential Bugs Found During Test Coverage

Bugs and suspicious behaviors discovered while writing integration tests for the Go backend.

---

## 1. `GetDatabaseStats` — `sql.NullTime` can't scan SQLite string timestamps

**File:** `internal/storage/localdb.go`
**Function:** `GetDatabaseStats(databaseID string)`
**Status:** FIXED

**Behavior:** `sql.NullTime` failed to scan `MAX(updated_at)` because `modernc.org/sqlite` stores Go `time.Time` values as strings (e.g. `"2026-03-03 18:56:21.178838 -0300 -03 m=+0.009217043"`). The `sql.NullTime` scanner expects a native `time.Time`, not a string.

**Fix applied:** Changed to `sql.NullString` with manual parsing. Strips Go's monotonic clock suffix (`m=+...`) before parsing with multiple format attempts.

---

## 2. `DatabaseService.CreateConnection` — missing UUID generation

**File:** `internal/service/database_service.go`
**Function:** `CreateConnection(input CreateDBConnInput)`
**Status:** FIXED

**Behavior:** The `DatabaseConnection.ID` field was left empty because no UUID was generated before persisting to storage. This caused empty IDs in the database and broke password storage in the secret store (keyed by `"db:" + conn.ID`).

**Fix applied:** Added `ID: uuid.New().String()` to the connection struct before calling `connStore.CreateConnection`.

---

## 3. `BatchUpdateRows` is a no-op placeholder

**File:** `internal/service/localdb_service.go`
**Function:** `BatchUpdateRows(databaseID string, updates []domain.LocalDBRow)`

**Behavior:** The function returns `nil` immediately without performing any updates. Any caller expecting rows to be batch-updated will silently succeed without effect.

**Expected:** Should iterate over `updates` and call `store.UpdateRow` for each, or implement a bulk SQL update.

---

## 4. `ReplacePageBlocks` silently deletes connections as side effect

**File:** `internal/storage/block.go`
**Function:** `ReplacePageBlocks(pageID string, blocks []domain.Block)`

**Behavior:** Inside a transaction, this function calls `DeleteBlocksByPage` which also deletes all connections (`DELETE FROM connections WHERE from_block_id IN (...) OR to_block_id IN (...)`). This means restoring/replacing blocks on a page permanently destroys all connection data for that page.

**Expected:** If the intent is to restore a page snapshot, connections should also be part of the snapshot and restored. If connections are intentionally deleted, the function name and documentation should make this clear.

---

## 5. `ListPages` omits `drawing_data` column

**File:** `internal/storage/notebook.go`
**Function:** `ListPages(notebookID string)`

**Behavior:** The `SELECT` statement in `ListPages` does not include the `drawing_data` column, so all returned `Page` structs have an empty `DrawingData` field. However, `GetPage` includes `drawing_data` in its query.

**Expected:** Either both functions should include `drawing_data`, or the omission should be documented as intentional (e.g., for performance reasons since drawing data can be large). Currently there is no comment explaining the difference.

---

## 6. `WindowSettingsService` creates table outside `migrate()`

**File:** `internal/service/window_settings.go`
**Function:** `LoadWindowSize()`

**Behavior:** The `app_settings` table is created lazily via `CREATE TABLE IF NOT EXISTS` inside `LoadWindowSize()`, not during the main schema migration in `storage.New()`. If `SaveWindowSize()` is called before `LoadWindowSize()`, it will fail with `"no such table: app_settings"`.

**Expected:** The `app_settings` table should be created in the main `migrate()` function alongside other tables, or `SaveWindowSize` should also ensure the table exists.

---

## 7. `inferCSVValue` — "0" matches as float before bool check

**File:** `internal/etl/sources/csvfile.go`
**Function:** `inferCSVValue(s string)`

**Behavior:** The string `"0"` is parsed as `float64(0)` by `strconv.ParseFloat` before reaching the boolean check (`case "0"` → `false`). This means CSV values of `"0"` become `0.0` (number) instead of `false` (bool). The comment in the code says `// "0" already matched as number, but just in case` — acknowledging this precedence.

**Expected:** This is likely intentional (numbers take priority), but could surprise users who expect `"0"` to be treated as boolean false in a boolean column context.

---

## 8. ETL `destination.go` — `Write` method has 0% coverage on helper functions

**File:** `internal/etl/destination.go`
**Functions:** `resetColumns`, `ensureColumns`, `columnNameToID`, `mapFieldType`

**Behavior:** These functions are exercised through the ETL service `RunJob` integration tests, but the `Write` method's internal helpers (`resetColumns`, `ensureColumns`, `columnNameToID`) show 0% in isolated ETL package tests because `sync_test.go` uses a mock destination.

**Note:** This is a test coverage gap, not a bug. The functions work correctly when tested through the service layer integration tests.

---

## 9. `CloudShape.SketchOutline` — returns empty paths

**File:** `internal/plugins/drawing/shape_cloud.go`
**Function:** `SketchOutline(w, h float64, seed int, sw float64)`

**Behavior:** `SketchOutline` calls `sketchFromPathCmds(s.OutlinePath(w, h), sw, seed)`, but the cloud's `OutlinePath` only contains `OpCurveTo` commands (Bézier curves). The `sketchFromPathCmds` function only processes `OpMoveTo` and `OpLineTo` — it ignores `OpCurveTo` entirely. As a result, `SketchOutline` returns an empty slice for clouds.

**Expected:** Either `sketchFromPathCmds` should handle `OpCurveTo` (linearize/approximate curves), or `CloudShape.SketchOutline` should use a different strategy (e.g., `sketchEllipseOutline` since cloud already uses `EllipseGeometry`).

---

## 10. `EdgeCrossesRect` — only handles axis-aligned segments

**File:** `internal/plugins/drawing/rect_geometry.go`
**Function:** `EdgeCrossesRect(a, b Vec2, r Rect)`

**Behavior:** The function returns `false` for any diagonal segment (where both `|a.X-b.X| >= 0.5` and `|a.Y-b.Y| >= 0.5`). This means `HitTestSegment` on all geometry types (Rect, Ellipse, Diamond) will miss diagonal line segments that cross through the shape.

**Expected:** This is documented as handling only axis-aligned segments, which is correct for the orthogonal routing use case. However, `HitTestSegment` on `RectGeometry` delegates to this function without any comment about the axis-aligned restriction, which could mislead callers.
