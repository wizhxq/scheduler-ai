"""Database migration script – adds ALL missing columns to keep SQLite schema
in sync with the SQLAlchemy models after Phase 1 enterprise upgrade.

Safe to run multiple times: existing columns are skipped.
Also creates any completely new tables (schedule_items) via CREATE TABLE IF NOT EXISTS.

Usage:
    docker-compose exec backend python /app/app/migrate_db.py
"""
import sqlite3
import os


def _add_columns(cursor, conn, table: str, columns: list):
    """Add missing columns to *table*. Each item is (col_name, col_type, default_sql)."""
    cursor.execute(f"PRAGMA table_info({table})")
    existing = {row[1] for row in cursor.fetchall()}
    print(f"\n[{table}] existing columns: {existing}")
    for col_name, col_type, default_val in columns:
        if col_name not in existing:
            try:
                sql = f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type} DEFAULT {default_val}"
                cursor.execute(sql)
                conn.commit()
                print(f"  + Added   : {col_name}")
            except Exception as e:
                print(f"  ! Error   : {col_name} -> {e}")
        else:
            print(f"  o Exists  : {col_name}")


def migrate():
    db_url = os.getenv("DATABASE_URL", "sqlite:///./scheduler.db")
    db_path = db_url.replace("sqlite:///", "")
    print(f"Connecting to database: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # ------------------------------------------------------------------
    # machines  (Phase 1: shift & capacity fields)
    # ------------------------------------------------------------------
    _add_columns(cursor, conn, "machines", [
        ("shift_start",           "VARCHAR",  "'08:00'"),
        ("shift_end",             "VARCHAR",  "'18:00'"),
        ("shift_days",            "VARCHAR",  "'1,2,3,4,5'"),
        ("capacity_per_hour",     "FLOAT",    "1.0"),
        ("default_setup_minutes", "INTEGER",  "15"),
        ("maintenance_notes",     "VARCHAR",  "''"),
        ("utilization_target_pct","FLOAT",    "85.0"),
    ])

    # ------------------------------------------------------------------
    # work_orders  (Phase 1: status tracking & scheduling metadata)
    # ------------------------------------------------------------------
    _add_columns(cursor, conn, "work_orders", [
        ("status",             "VARCHAR",  "'pending'"),
        ("started_at",         "DATETIME", "NULL"),
        ("completed_at",       "DATETIME", "NULL"),
        ("paused_at",          "DATETIME", "NULL"),
        ("notes",              "VARCHAR",  "''"),
        ("estimated_hours",    "FLOAT",    "NULL"),
        ("actual_hours",       "FLOAT",    "NULL"),
        ("is_rush",            "BOOLEAN",  "0"),
        ("backward_schedule",  "BOOLEAN",  "0"),
    ])

    # ------------------------------------------------------------------
    # operations  (Phase 1: live status tracking)
    # ------------------------------------------------------------------
    _add_columns(cursor, conn, "operations", [
        ("setup_minutes",  "INTEGER",  "0"),
        ("notes",          "VARCHAR",  "''"),
        ("status",         "VARCHAR",  "'pending'"),
        ("started_at",     "DATETIME", "NULL"),
        ("completed_at",   "DATETIME", "NULL"),
        ("actual_minutes", "INTEGER",  "NULL"),
    ])

    # ------------------------------------------------------------------
    # schedule_runs  (Phase 1: richer run metadata)
    # ------------------------------------------------------------------
    _add_columns(cursor, conn, "schedule_runs", [
        ("label",                   "VARCHAR", "''"),
        ("algorithm",               "VARCHAR", "'EDD'"),
        ("total_operations",        "INTEGER", "0"),
        ("total_delay_minutes",     "INTEGER", "0"),
        ("makespan_minutes",        "INTEGER", "0"),
        ("on_time_count",           "INTEGER", "0"),
        ("late_count",              "INTEGER", "0"),
        ("machine_utilization_pct", "FLOAT",   "0.0"),
        ("has_conflicts",           "BOOLEAN", "0"),
        ("conflict_details",        "VARCHAR", "''"),
    ])

    # ------------------------------------------------------------------
    # schedule_items  (Phase 1: brand-new table – CREATE IF NOT EXISTS)
    # ------------------------------------------------------------------
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS schedule_items (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            schedule_run_id      INTEGER NOT NULL REFERENCES schedule_runs(id),
            work_order_id        INTEGER NOT NULL REFERENCES work_orders(id),
            operation_id         INTEGER NOT NULL REFERENCES operations(id),
            machine_id           INTEGER NOT NULL REFERENCES machines(id),
            start_time           DATETIME NOT NULL,
            end_time             DATETIME NOT NULL,
            delay_minutes        INTEGER  DEFAULT 0,
            is_late              BOOLEAN  DEFAULT 0,
            is_conflict          BOOLEAN  DEFAULT 0,
            conflict_with_item_id INTEGER
        )
    """)
    conn.commit()
    print("\n[schedule_items] table ensured (CREATE TABLE IF NOT EXISTS)")

    conn.close()
    print("\nMigration complete!")


if __name__ == "__main__":
    migrate()
