"""Minimal in-memory stand-in for the supabase-py client.

Implements exactly the query-builder surface used by app.bracket_engine.generator
and the match progression helpers, so the real bracket generation, advancement,
and settlement code can run against it without a database.
"""

import uuid
from copy import deepcopy

# Columns per table so inserted rows get explicit NULLs, matching Postgres.
_TABLE_COLUMNS = {
    "sports": [
        "id", "name", "bracket_type", "teams_per_company", "scoring_direction",
        "multi_team_rule", "points_scale", "match_duration_minutes", "schedule_start",
    ],
    "teams": ["id", "company_id", "sport_id", "name"],
    "brackets": ["id", "sport_id", "name", "phase", "division"],
    "matches": [
        "id", "sport_id", "bracket_id", "home_team_id", "away_team_id",
        "location_id", "winner_id", "home_score", "away_score",
        "winner_next_match_id", "loser_next_match_id", "status", "match_round",
        "scheduled_at", "actual_start", "played_at", "notes",
        "home_slot_state", "away_slot_state",
    ],
    "locations": ["id", "sport_id", "name"],
}


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, store, table_name):
        self._store = store
        self._table = table_name
        self._op = "select"
        self._payload = None
        self._filters = []
        self._limit = None
        self._range = None

    def select(self, *_cols):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, col, val):
        self._filters.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col, val):
        self._filters.append(lambda r: r.get(col) != val)
        return self

    def in_(self, col, vals):
        vals = list(vals)
        self._filters.append(lambda r: r.get(col) in vals)
        return self

    def is_(self, col, val):
        if val == "null":
            self._filters.append(lambda r: r.get(col) is None)
        else:
            self._filters.append(lambda r: r.get(col) == val)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def order(self, _col, desc=False):
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def _matching(self, rows):
        return [r for r in rows if all(f(r) for f in self._filters)]

    def execute(self):
        rows = self._store.setdefault(self._table, [])
        defaults = _TABLE_COLUMNS.get(self._table, [])

        if self._op == "insert":
            payload = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for item in payload:
                row = {col: None for col in defaults}
                row.update(item)
                if not row.get("id"):
                    row["id"] = str(uuid.uuid4())
                rows.append(row)
                inserted.append(deepcopy(row))
            return _Result(inserted)

        if self._op == "update":
            updated = []
            for r in self._matching(rows):
                r.update(self._payload)
                updated.append(deepcopy(r))
            return _Result(updated)

        if self._op == "delete":
            keep, dropped = [], []
            for r in rows:
                (dropped if all(f(r) for f in self._filters) else keep).append(r)
            self._store[self._table] = keep
            return _Result([deepcopy(r) for r in dropped])

        out = [deepcopy(r) for r in self._matching(rows)]
        if self._range is not None:
            out = out[self._range[0]: self._range[1] + 1]
        if self._limit is not None:
            out = out[: self._limit]
        return _Result(out)


class FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name):
        return _Query(self.store, name)

    def rows(self, name):
        """Snapshot of a table's rows for assertions."""
        return [deepcopy(r) for r in self.store.get(name, [])]
