"""Organizer event administration and ticket type routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from auth import rbac
from events import service as events_svc
from http_layer.deps import AppState, get_app_state, require_user
from http_layer.errors import json_error
from store import NotFoundError
from store import admissions as admissions_repo

router = APIRouter(prefix="/events", tags=["events-admin"])
ticket_router = APIRouter(tags=["ticket-types"])


@router.post("")
def create_event(body: dict, state: AppState = Depends(require_user)):
    """Create event."""
    org_id = (body.get("org_id") or "").strip()
    if not org_id:
        return json_error(400, "invalid_request", "org_id is required")
    if not rbac.can_manage_org(state.store, state.current_user.id, org_id, rbac.ROLE_ADMIN):
        return json_error(403, "forbidden", "you are not an admin/owner of this org")
    try:
        ev = events_svc.create(state.store, org_id, body)
    except NotFoundError:
        return json_error(400, "invalid_request", "org_id does not exist")
    except events_svc.InvalidInput as err:
        return json_error(400, "invalid_request", str(err))
    except Exception:
        return json_error(500, "internal_error", "internal error")
    from fastapi.responses import JSONResponse

    return JSONResponse({"event": ev}, status_code=201)


@router.get("/{event_id}")
def get_event(event_id: str, state: AppState = Depends(get_app_state)):
    """Public storefront: published event + active catalog (passes, goodies)."""
    try:
        ev = events_svc.get_by_slug_or_id(state.store, event_id)
    except NotFoundError:
        return json_error(404, "not_found", "event not found")
    except Exception:
        return json_error(503, "database_unavailable", "Service billetterie temporairement indisponible")
    if ev.get("status") != "published":
        user = state.current_user
        if user is None or not rbac.can_manage_event(
            state.store, user.id, ev["id"], rbac.ROLE_ADMIN
        ):
            return json_error(404, "not_found", "event not found")
    try:
        if ev.get("status") == "published":
            try:
                events_svc.ensure_festival_pass_products(state.store, ev["id"])
            except events_svc.InvalidInput:
                pass
        types = events_svc.list_storefront_products(state.store, ev["id"])
        keys = events_svc.issuer_keys_json(state.store, ev["id"])
    except NotFoundError:
        return json_error(404, "not_found", "event not found")
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return {"event": ev, "ticket_types": types, "issuer_keys": keys, "gallery": []}


@router.patch("/{event_id}")
def patch_event(event_id: str, body: dict, state: AppState = Depends(require_user)):
    """Patch event."""
    if not rbac.can_manage_event_as_owner(state.store, state.current_user.id, event_id):
        return json_error(403, "forbidden", "event settings are reserved to organization owners")
    try:
        ev = events_svc.update(state.store, event_id, body)
    except NotFoundError:
        return json_error(404, "not_found", "event not found")
    except events_svc.InvalidInput as err:
        return json_error(400, "invalid_request", str(err))
    except events_svc.InvalidTransition as err:
        return json_error(400, "invalid_request", str(err))
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return {"event": ev}


@router.delete("/{event_id}", status_code=204)
def delete_event_route(event_id: str, state: AppState = Depends(require_user)):
    """Delete event route."""
    if not rbac.can_manage_event_as_owner(state.store, state.current_user.id, event_id):
        return json_error(403, "forbidden", "event settings are reserved to organization owners")
    try:
        events_svc.delete_event(state.store, event_id)
    except NotFoundError:
        return json_error(404, "not_found", "event not found")
    except events_svc.EventHasTickets as err:
        return json_error(409, "conflict", str(err))
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return Response(status_code=204)


@router.post("/{event_id}/publish")
def publish_event(event_id: str, state: AppState = Depends(require_user)):
    """Publish event."""
    if not rbac.can_manage_event_as_owner(state.store, state.current_user.id, event_id):
        return json_error(403, "forbidden", "event settings are reserved to organization owners")
    try:
        ev = events_svc.publish(state.store, event_id)
    except NotFoundError:
        return json_error(404, "not_found", "event not found")
    except events_svc.InvalidTransition as err:
        return json_error(400, "invalid_request", str(err))
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return {"event": ev}


@router.get("/{event_id}/stats")
def event_stats(event_id: str, state: AppState = Depends(require_user)):
    """Event stats."""
    if not rbac.can_manage_event(state.store, state.current_user.id, event_id, rbac.ROLE_SCANNER):
        return json_error(403, "forbidden", "you are not a member of this event's org")
    try:
        st = events_svc.stats(state.store, event_id)
    except NotFoundError:
        return json_error(404, "not_found", "event not found")
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return {"stats": st}


@router.get("/{event_id}/ticket-types")
def list_ticket_types(event_id: str, state: AppState = Depends(require_user)):
    """List ticket types."""
    if not rbac.can_manage_event_as_owner(state.store, state.current_user.id, event_id):
        return json_error(403, "forbidden", "ticket types are reserved to organization owners")
    try:
        types = events_svc.list_ticket_types(state.store, event_id)
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return {"ticket_types": types}


@router.post("/{event_id}/ticket-types")
def create_ticket_type(event_id: str, body: dict, state: AppState = Depends(require_user)):
    """Create ticket type."""
    if not rbac.can_manage_event_as_owner(state.store, state.current_user.id, event_id):
        return json_error(403, "forbidden", "ticket types are reserved to organization owners")
    try:
        tt = events_svc.create_ticket_type(state.store, event_id, body)
    except events_svc.InvalidInput as err:
        return json_error(400, "invalid_request", str(err))
    except NotFoundError:
        return json_error(404, "not_found", "event not found")
    except Exception:
        return json_error(500, "internal_error", "internal error")
    from fastapi.responses import JSONResponse

    return JSONResponse({"ticket_type": tt}, status_code=201)


@router.get("/{event_id}/admission-conflicts")
def admission_conflicts(event_id: str, state: AppState = Depends(require_user)):
    """Admission conflicts."""
    if not rbac.can_manage_event(state.store, state.current_user.id, event_id, rbac.ROLE_SCANNER):
        return json_error(403, "forbidden", "you are not a member of this event's org")
    return {"conflicts": admissions_repo.list_conflicts(state.store, event_id)}


@ticket_router.patch("/ticket-types/{tt_id}")
def patch_ticket_type(tt_id: str, body: dict, state: AppState = Depends(require_user)):
    """Patch ticket type."""
    from store import ticket_types as tt_repo

    try:
        tt = tt_repo.get_ticket_type_by_id(state.store, tt_id)
    except NotFoundError:
        return json_error(404, "not_found", "ticket type not found")
    if not rbac.can_manage_event_as_owner(state.store, state.current_user.id, tt.event_id):
        return json_error(403, "forbidden", "ticket types are reserved to organization owners")
    try:
        out = events_svc.update_ticket_type(state.store, tt_id, body)
    except events_svc.InvalidInput as err:
        return json_error(400, "invalid_request", str(err))
    except events_svc.QuantityBelowSold as err:
        return json_error(400, "invalid_request", str(err))
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return {"ticket_type": out}


@ticket_router.delete("/ticket-types/{tt_id}", status_code=204)
def delete_ticket_type_route(tt_id: str, state: AppState = Depends(require_user)):
    """Delete ticket type route."""
    from store import ticket_types as tt_repo

    try:
        tt = tt_repo.get_ticket_type_by_id(state.store, tt_id)
    except NotFoundError:
        return json_error(404, "not_found", "ticket type not found")
    if not rbac.can_manage_event_as_owner(state.store, state.current_user.id, tt.event_id):
        return json_error(403, "forbidden", "ticket types are reserved to organization owners")
    try:
        events_svc.delete_ticket_type(state.store, tt_id)
    except events_svc.TicketTypeHasSales as err:
        return json_error(409, "conflict", str(err))
    except Exception:
        return json_error(500, "internal_error", "internal error")
    return Response(status_code=204)

