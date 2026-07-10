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
        "assumed_courts_per_group", "pool_count", "advance_per_pool", "pool_play_rounds",
    ],
    "teams": ["id", "company_id", "sport_id", "name", "created_at", "seed", "pool_index"],
    "companies": ["id", "name", "short_id", "logo_url", "created_at"],
    "brackets": ["id", "sport_id", "name", "phase", "division"],
    "matches": [
        "id", "sport_id", "bracket_id", "home_team_id", "away_team_id",
        "location_id", "winner_id", "home_score", "away_score",
        "home_games_won", "away_games_won", "home_points_total", "away_points_total",
        "winner_next_match_id", "loser_next_match_id", "status", "match_round",
        "scheduled_at", "actual_start", "played_at", "notes",
        "home_slot_state", "away_slot_state", "time_ms",
    ],
    "locations": ["id", "sport_id", "name", "pool_index"],
    "event_points": ["id", "company_id", "sport_id", "placement", "points", "notes", "created_at"],
    "schedule_blocks": ["id", "label", "start_time", "end_time"],
}


_FIXED_CREATED_AT = "2000-01-01T00:00:00+00:00"


def _new_row(defaults, item):
    row = {col: None for col in defaults}
    row.update(item)
    if not row.get("id"):
        row["id"] = str(uuid.uuid4())
    if "created_at" in row and row["created_at"] is None:
        row["created_at"] = _FIXED_CREATED_AT
    return row


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
        self._order = []          # list of (column, desc)
        self._negate_next = False

    @property
    def not_(self):
        self._negate_next = True
        return self

    def _add_filter(self, predicate):
        if self._negate_next:
            self._negate_next = False
            self._filters.append(lambda r: not predicate(r))
        else:
            self._filters.append(predicate)
        return self

    def select(self, *_cols):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def upsert(self, payload, on_conflict=None):
        self._op = "upsert"
        self._payload = payload
        self._on_conflict = on_conflict
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, col, val):
        return self._add_filter(lambda r: r.get(col) == val)

    def neq(self, col, val):
        return self._add_filter(lambda r: r.get(col) != val)

    def in_(self, col, vals):
        vals = list(vals)
        return self._add_filter(lambda r: r.get(col) in vals)

    def is_(self, col, val):
        if val == "null":
            return self._add_filter(lambda r: r.get(col) is None)
        return self._add_filter(lambda r: r.get(col) == val)

    def limit(self, n):
        self._limit = n
        return self

    def order(self, col, desc=False):
        self._order.append((col, desc))
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
                row = _new_row(defaults, item)
                rows.append(row)
                inserted.append(deepcopy(row))
            return _Result(inserted)

        if self._op == "upsert":
            payload = self._payload if isinstance(self._payload, list) else [self._payload]
            conflict_cols = (self._on_conflict or "id").split(",")
            upserted = []
            for item in payload:
                match = next(
                    (r for r in rows if all(r.get(c) == item.get(c) for c in conflict_cols)),
                    None,
                )
                if match is not None:
                    match.update(item)
                    upserted.append(deepcopy(match))
                else:
                    row = _new_row(defaults, item)
                    rows.append(row)
                    upserted.append(deepcopy(row))
            return _Result(upserted)

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
        # Apply orderings like Postgres: last .order() is the least significant,
        # NULLS LAST for ascending, NULLS FIRST for descending (PG defaults).
        # Tuple key never compares a null placeholder with a real value: the
        # is-None flag differs first, so comparison short-circuits.
        for col, desc in reversed(self._order):
            out.sort(
                key=lambda r, c=col: (r.get(c) is None, r.get(c) if r.get(c) is not None else ""),
                reverse=desc,
            )
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
