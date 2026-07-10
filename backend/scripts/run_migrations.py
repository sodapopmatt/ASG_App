r"""Apply migration file(s) from backend/migrations/ to a Postgres database.
Used to bootstrap a fresh Supabase project (e.g. a sandbox) from scratch
instead of pasting files into the SQL Editor by hand -- or to apply just one
new file to a project that's already been bootstrapped.

Usage (PowerShell):
    $env:SANDBOX_DB_URL = "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
    ..\venv\Scripts\python.exe run_migrations.py            # all files, in order
    ..\venv\Scripts\python.exe run_migrations.py 029_*.sql   # just one (glob against the filename)

The connection string is the "URI" one under Supabase's
Project Settings -> Database -> Connection string (use the direct
connection, port 5432, not the pgbouncer pooler on 6543 -- some of these
migrations run multiple statements per file, which the transaction-mode
pooler doesn't handle well).
"""

import fnmatch
import os
import pathlib
import sys

import psycopg


def main() -> None:
    db_url = os.environ.get("SANDBOX_DB_URL")
    if not db_url:
        print("Set SANDBOX_DB_URL to the target database's connection string first.")
        sys.exit(1)

    migrations_dir = pathlib.Path(__file__).resolve().parent.parent / "migrations"
    files = sorted(migrations_dir.glob("*.sql"), key=lambda p: p.name)
    pattern = sys.argv[1] if len(sys.argv) > 1 else None
    if pattern:
        files = [f for f in files if fnmatch.fnmatch(f.name, pattern)]
    if not files:
        print(f"No .sql files found in {migrations_dir}" + (f" matching {pattern!r}" if pattern else ""))
        sys.exit(1)

    conn = psycopg.connect(db_url, autocommit=False)
    try:
        with conn.cursor() as cur:
            for f in files:
                print(f"Applying {f.name} ...")
                cur.execute(f.read_text(encoding="utf-8"))
        conn.commit()
        print(f"\nApplied {len(files)} migrations successfully.")
    except Exception:
        conn.rollback()
        print("\nFailed -- rolled back. No partial changes were committed.")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
