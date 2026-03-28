"""Database migration script to add missing columns to machines table"""
import sqlite3
import os

def migrate():
    db_path = os.getenv("DATABASE_URL", "sqlite:///./scheduler.db").replace("sqlite:///", "")
    
    print(f"Connecting to database: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # List of columns to add
    columns_to_add = [
        ("shift_start", "VARCHAR(5)", "'08:00'"),
        ("shift_end", "VARCHAR(5)", "'18:00'"),
        ("shift_days", "VARCHAR", "'Mon,Tue,Wed,Thu,Fri'"),
        ("capacity_per_hour", "INTEGER", "10"),
        ("default_setup_minutes", "INTEGER", "30"),
        ("maintenance_notes", "VARCHAR", "NULL"),
        ("utilization_target_pct", "FLOAT", "80.0")
    ]
    
    # Check existing columns
    cursor.execute("PRAGMA table_info(machines)")
    existing_columns = {row[1] for row in cursor.fetchall()}
    
    print(f"Existing columns: {existing_columns}")
    
    # Add missing columns
    for col_name, col_type, default_val in columns_to_add:
        if col_name not in existing_columns:
            try:
                sql = f"ALTER TABLE machines ADD COLUMN {col_name} {col_type} DEFAULT {default_val}"
                print(f"Adding column: {col_name}")
                cursor.execute(sql)
                conn.commit()
                print(f"✓ Added column: {col_name}")
            except Exception as e:
                print(f"✗ Error adding {col_name}: {e}")
        else:
            print(f"○ Column {col_name} already exists")
    
    conn.close()
    print("\nMigration complete!")

if __name__ == "__main__":
    migrate()
