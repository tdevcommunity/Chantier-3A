"""Admin CSV exports."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from auth import rbac
from http_layer.deps import AppState, require_user
from http_layer.errors import json_error
from orders.participants_csv import build_participants_csv

router = APIRouter(tags=["exports"])


@router.get("/events/{event_id}/exports/participants.csv")
def export_participants_csv(event_id: str, state: AppState = Depends(require_user)):
    """Download all participant registrations for an event."""
    if not rbac.can_manage_event_as_owner(state.store, state.current_user.id, event_id):
        return json_error(403, "forbidden", "export is reserved to organization owners")
    body, count = build_participants_csv(state.store, event_id)
    if count == 0:
        return json_error(404, "not_found", "no registrations to export")
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="tdev_inscriptions_complet.csv"'},
    )
