"""Record ticket scans and admission decisions at the door."""

from __future__ import annotations

from datetime import datetime

from store.store import Store, new_ulid
from store.timeutil import time_to_text

CONTROL_TYPES = {"event_entry", "food_access", "merch_pickup", "after_entry"}


def list_admitted_ticket_ids(st: Store, event_id: str) -> list[str]:
    """List admitted ticket ids."""
    rows = st.fetchall(
        """
        SELECT ticket_id FROM admissions
        WHERE event_id = ? AND result = 'admitted'
        ORDER BY ticket_id ASC
        """,
        (event_id,),
    )
    out: list[str] = []
    for row in rows:
        out.append(row["ticket_id"] if hasattr(row, "keys") else row[0])
    return out


def try_insert_admitted(
    st: Store,
    *,
    ticket_id: str,
    event_id: str,
    gate_id: str,
    device_id: str,
    scanned_by: str | None,
    scanned_at: datetime,
    control_type: str = "event_entry",
) -> bool:
    """Try insert admitted."""
    # ON CONFLICT DO NOTHING: a duplicate is not an error, so the shared connection is never aborted.
    inserted = st.execute_rowcount(
        """
        INSERT INTO admissions (id, ticket_id, event_id, gate_id, scanned_by, device_id,
            scanned_at, result, note, reported_result, control_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'admitted', '', 'admitted', ?)
        ON CONFLICT DO NOTHING
        """,
        (
            new_ulid(),
            ticket_id,
            event_id,
            gate_id,
            scanned_by,
            device_id,
            time_to_text(scanned_at),
            control_type,
        ),
    )
    return inserted == 1


def first_admission(st: Store, ticket_id: str, control_type: str) -> dict | None:
    """Return the authoritative first admission for one ticket/control pair."""
    row = st.fetchone(
        """
        SELECT scanned_at, scanned_by, device_id, gate_id
        FROM admissions
        WHERE ticket_id = ? AND control_type = ? AND result = 'admitted'
        ORDER BY scanned_at ASC, id ASC
        LIMIT 1
        """,
        (ticket_id, control_type),
    )
    if row is None:
        return None
    return dict(row) if hasattr(row, "keys") else {
        "scanned_at": row[0],
        "scanned_by": row[1],
        "device_id": row[2],
        "gate_id": row[3],
    }


def record_offline_claim(
    st: Store,
    *,
    operation_id: str,
    ticket_id: str,
    event_id: str,
    control_type: str,
    gate_id: str,
    device_id: str,
    scanned_by: str | None,
    scanned_at: datetime,
    reported_result: str,
) -> tuple[str, bool]:
    """Persist one verified mobile operation; replaying an operation is a no-op."""
    existing = st.fetchone(
        "SELECT result FROM admissions WHERE operation_id = ?",
        (operation_id,),
    )
    if existing is not None:
        value = existing["result"] if hasattr(existing, "keys") else existing[0]
        return str(value), True

    result = "duplicate"
    if reported_result == "admitted":
        try:
            st.execute(
                """
                INSERT INTO admissions (
                    id, operation_id, ticket_id, event_id, control_type, gate_id,
                    scanned_by, device_id, scanned_at, result, reported_result, note
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admitted', ?, 'offline sync')
                """,
                (
                    new_ulid(), operation_id, ticket_id, event_id, control_type,
                    gate_id, scanned_by, device_id, time_to_text(scanned_at),
                    reported_result,
                ),
            )
            return "admitted", False
        except Exception as err:
            message = str(err).lower()
            if "unique" not in message and "duplicate" not in message:
                raise

    st.execute(
        """
        INSERT INTO admissions (
            id, operation_id, ticket_id, event_id, control_type, gate_id,
            scanned_by, device_id, scanned_at, result, reported_result, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offline sync')
        """,
        (
            new_ulid(), operation_id, ticket_id, event_id, control_type,
            gate_id, scanned_by, device_id, time_to_text(scanned_at), result,
            reported_result,
        ),
    )
    return result, False


def list_conflicts(st: Store, event_id: str) -> list[dict]:
    """List tickets that different devices reported as admitted for one control."""
    rows = st.fetchall(
        """
        SELECT ticket_id, control_type, COUNT(DISTINCT device_id) AS device_count,
               MIN(scanned_at) AS first_scanned_at, MAX(scanned_at) AS last_scanned_at
        FROM admissions
        WHERE event_id = ? AND reported_result = 'admitted'
        GROUP BY ticket_id, control_type
        HAVING COUNT(DISTINCT device_id) > 1
        ORDER BY first_scanned_at ASC, ticket_id ASC
        """,
        (event_id,),
    )
    return [dict(row) for row in rows]


def admitted_counts_by_control(st: Store, event_id: str) -> dict[str, int]:
    """Return authoritative admission totals for every supported control."""
    counts = {control: 0 for control in sorted(CONTROL_TYPES)}
    rows = st.fetchall(
        """SELECT control_type, COUNT(*) AS admitted
           FROM admissions
           WHERE event_id = ? AND result = 'admitted'
           GROUP BY control_type""",
        (event_id,),
    )
    for row in rows:
        control = row["control_type"] if hasattr(row, "keys") else row[0]
        value = row["admitted"] if hasattr(row, "keys") else row[1]
        if control in counts:
            counts[str(control)] = int(value)
    return counts


def _table_exists(st: Store, table_name: str) -> bool:
    """Return whether a public PostgreSQL table exists without aborting the transaction."""
    row = st.fetchone("SELECT to_regclass(?) AS tbl", (f"public.{table_name}",))
    val = row["tbl"] if hasattr(row, "keys") else (row[0] if row else None)
    return val is not None


def reset_event_admissions(
    st: Store,
    event_id: str,
    *,
    before_iso: str | None = None,
    ticket_id: str | None = None,
) -> dict[str, int]:
    """Clear recorded admissions and check-in consumptions for an event.

    Supports full reset (default), partial reset before a timestamp
    (``before_iso``), or single-ticket reset (``ticket_id``). Recomputes
    ``checkin_entitlements.uses`` from remaining consumptions when v2 checkin
    tables are present.
    """
    deleted_admissions = 0
    deleted_consumptions = 0
    deleted_scan_logs = 0

    clean_ticket = (ticket_id or "").strip() or None
    clean_before = (before_iso or "").strip() or None

    with st.transaction():
        if clean_ticket is not None:
            deleted_admissions = st.execute_rowcount(
                "DELETE FROM admissions WHERE event_id = ? AND ticket_id = ?",
                (event_id, clean_ticket),
            )
        elif clean_before is not None:
            deleted_admissions = st.execute_rowcount(
                "DELETE FROM admissions WHERE event_id = ? AND scanned_at < ?",
                (event_id, clean_before),
            )
        else:
            deleted_admissions = st.execute_rowcount(
                "DELETE FROM admissions WHERE event_id = ?",
                (event_id,),
            )

        has_scan_logs = _table_exists(st, "scan_logs")

        if _table_exists(st, "station_consumptions"):
            if clean_ticket is not None:
                deleted_consumptions = st.execute_rowcount(
                    "DELETE FROM station_consumptions WHERE event_id = ? AND ticket_id = ?",
                    (event_id, clean_ticket),
                )
            elif clean_before is not None and has_scan_logs:
                deleted_consumptions = st.execute_rowcount(
                    """
                    DELETE FROM station_consumptions
                    WHERE event_id = ?
                      AND (
                        consumed_at < ?::timestamptz
                        OR winning_log_id IN (
                          SELECT log_id FROM scan_logs
                          WHERE event_id = ? AND server_received_at < ?::timestamptz
                        )
                      )
                    """,
                    (event_id, clean_before, event_id, clean_before),
                )
            elif clean_before is not None:
                deleted_consumptions = st.execute_rowcount(
                    "DELETE FROM station_consumptions WHERE event_id = ? AND consumed_at < ?::timestamptz",
                    (event_id, clean_before),
                )
            else:
                deleted_consumptions = st.execute_rowcount(
                    "DELETE FROM station_consumptions WHERE event_id = ?",
                    (event_id,),
                )

        if _table_exists(st, "scan_conflicts"):
            if clean_ticket is not None:
                st.execute(
                    "DELETE FROM scan_conflicts WHERE event_id = ? AND ticket_id = ?",
                    (event_id, clean_ticket),
                )
            elif clean_before is not None and has_scan_logs:
                st.execute(
                    """
                    DELETE FROM scan_conflicts
                    WHERE event_id = ?
                      AND (
                        detected_at < ?::timestamptz
                        OR winning_log_id IN (
                          SELECT log_id FROM scan_logs
                          WHERE event_id = ? AND server_received_at < ?::timestamptz
                        )
                        OR losing_log_id IN (
                          SELECT log_id FROM scan_logs
                          WHERE event_id = ? AND server_received_at < ?::timestamptz
                        )
                      )
                    """,
                    (event_id, clean_before, event_id, clean_before, event_id, clean_before),
                )
            elif clean_before is not None:
                st.execute(
                    "DELETE FROM scan_conflicts WHERE event_id = ? AND detected_at < ?::timestamptz",
                    (event_id, clean_before),
                )
            else:
                st.execute(
                    "DELETE FROM scan_conflicts WHERE event_id = ?",
                    (event_id,),
                )

        if has_scan_logs:
            st.execute("ALTER TABLE scan_logs DISABLE TRIGGER trg_scan_logs_immutable")
            try:
                if clean_ticket is not None:
                    deleted_scan_logs = st.execute_rowcount(
                        "DELETE FROM scan_logs WHERE event_id = ? AND ticket_id = ?",
                        (event_id, clean_ticket),
                    )
                elif clean_before is not None:
                    deleted_scan_logs = st.execute_rowcount(
                        "DELETE FROM scan_logs WHERE event_id = ? AND server_received_at < ?::timestamptz",
                        (event_id, clean_before),
                    )
                else:
                    deleted_scan_logs = st.execute_rowcount(
                        "DELETE FROM scan_logs WHERE event_id = ?",
                        (event_id,),
                    )
            finally:
                st.execute("ALTER TABLE scan_logs ENABLE TRIGGER trg_scan_logs_immutable")

        if _table_exists(st, "checkin_entitlements"):
            if clean_ticket is not None:
                st.execute(
                    """
                    UPDATE checkin_entitlements e
                    SET uses = COALESCE((
                            SELECT jsonb_object_agg(s.station, s.cnt)
                            FROM (
                                SELECT c.station, count(*)::int AS cnt
                                FROM station_consumptions c
                                WHERE c.event_id = e.event_id AND c.ticket_id = e.ticket_id
                                GROUP BY c.station
                            ) s
                        ), '{}'::jsonb),
                        version = nextval('checkin_version_seq')
                    WHERE e.event_id = ? AND e.ticket_id = ?
                    """,
                    (event_id, clean_ticket),
                )
            else:
                st.execute(
                    """
                    UPDATE checkin_entitlements e
                    SET uses = COALESCE((
                            SELECT jsonb_object_agg(s.station, s.cnt)
                            FROM (
                                SELECT c.station, count(*)::int AS cnt
                                FROM station_consumptions c
                                WHERE c.event_id = e.event_id AND c.ticket_id = e.ticket_id
                                GROUP BY c.station
                            ) s
                        ), '{}'::jsonb),
                        version = nextval('checkin_version_seq')
                    WHERE e.event_id = ?
                    """,
                    (event_id,),
                )

        if _table_exists(st, "checkin_snapshot_meta"):
            st.execute(
                """
                UPDATE checkin_snapshot_meta
                SET refreshed_at = now(),
                    max_version = COALESCE(
                        (SELECT max(version) FROM checkin_entitlements WHERE event_id = ?),
                        0
                    )
                WHERE event_id = ?
                """,
                (event_id, event_id),
            )

    return {
        "deleted_admissions": deleted_admissions,
        "deleted_consumptions": deleted_consumptions,
        "deleted_scan_logs": deleted_scan_logs,
    }
