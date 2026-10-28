from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import get_admin_user
from app.database import get_db
from app.models import Complaint, StatusHistory, User
from app.schemas import AdminComplaintResponse, AnalyticsSummary, ComplaintUpdate, HotspotPoint
from app.services.gee_service import compute_hotspots, get_satellite_overlay_bounds, is_gee_available
from app.services.water_leak_analysis import analyze_water_leak
from app.services.sms import enqueue_notification

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/complaints", response_model=list[AdminComplaintResponse])
def list_all_complaints(
    status: str | None = None,
    category: str | None = None,
    department: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    query = db.query(Complaint)
    if status:
        query = query.filter(Complaint.status == status)
    if category:
        query = query.filter(Complaint.category == category)
    if department:
        query = query.filter(Complaint.department == department)
    complaints = query.order_by(Complaint.created_at.desc()).all()
    return [AdminComplaintResponse.model_validate(c) for c in complaints]


@router.patch("/complaints/{complaint_id}", response_model=AdminComplaintResponse)
def update_complaint(
    complaint_id: int,
    payload: ComplaintUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user),
):
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    original_status = complaint.status
    note = (payload.event_note or payload.admin_notes or "").strip() or None
    if payload.admin_notes is not None:
        complaint.admin_notes = payload.admin_notes.strip() or None
    action_status = {
        "confirm_fault": "confirmed_fault",
        "request_inspection": "field_inspection_required",
        "request_evidence": "more_evidence_required",
        "reject": "rejected",
        "mark_resolved": "resolved",
    }
    next_status = action_status.get(payload.verification_action, payload.status)
    if next_status:
        complaint.status = next_status
    assignment_changed = False
    if payload.assigned_team is not None:
        next_team = payload.assigned_team.strip() or None
        assignment_changed = next_team != complaint.assigned_team
        complaint.assigned_team = next_team
    if payload.priority:
        complaint.priority = payload.priority

    action_event = {
        "confirm_fault": "fault_confirmed",
        "request_inspection": "inspection_requested",
        "request_evidence": "more_evidence_requested",
        "reject": "report_rejected",
        "metadata_checked": "metadata_checked",
        "visual_assessment": "visual_assessment",
        "mark_resolved": "issue_resolved",
    }.get(payload.verification_action)
    status_changed = next_status is not None and next_status != original_status
    if status_changed or action_event or note or assignment_changed:
        event_type = action_event or ("status_changed" if status_changed else "team_assigned" if assignment_changed else "admin_note")
        event_note = f"{admin_user.name}: {note}" if note else f"{admin_user.name} changed status to {complaint.status.replace('_', ' ')}."
        if assignment_changed and payload.verification_action is None:
            assignment_note = f"Team assigned by {admin_user.name}: {complaint.assigned_team}"
            event_note = assignment_note + (f". {event_note}" if note else "")
        if payload.verification_action == "request_inspection" and complaint.assigned_team:
            event_note += f" Assigned to: {complaint.assigned_team}."
        db.add(StatusHistory(
            complaint_id=complaint.id,
            status=complaint.status,
            note=event_note,
            event_type=event_type,
            actor_user_id=admin_user.id,
            actor_name=admin_user.name,
        ))
    if status_changed:
        db.flush()
        if complaint.status in {"pending", "in_progress", "resolved"}:
            enqueue_notification(
                db,
                complaint,
                complaint.status,
                event_key=f"complaint:{complaint.id}:status:{complaint.status}:{complaint.updated_at.isoformat() if complaint.updated_at else 'now'}",
            )
    db.commit()
    db.refresh(complaint)
    return AdminComplaintResponse.model_validate(complaint)

@router.get("/analytics", response_model=AnalyticsSummary)
def get_analytics(
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    complaints = db.query(Complaint).all()

    by_status: dict[str, int] = {}
    by_category: dict[str, int] = {}
    by_priority: dict[str, int] = {}
    by_department: dict[str, int] = {}

    complaint_dicts = []
    for c in complaints:
        by_status[c.status] = by_status.get(c.status, 0) + 1
        by_category[c.category] = by_category.get(c.category, 0) + 1
        by_priority[c.priority] = by_priority.get(c.priority, 0) + 1
        by_department[c.department] = by_department.get(c.department, 0) + 1
        if (
            c.latitude is not None
            and c.longitude is not None
            and -90 <= c.latitude <= 90
            and -180 <= c.longitude <= 180
        ):
            complaint_dicts.append(
                {"latitude": c.latitude, "longitude": c.longitude, "category": c.category}
            )

    hotspots_raw = compute_hotspots(complaint_dicts)
    hotspots = [HotspotPoint(**h) for h in hotspots_raw]

    return AnalyticsSummary(
        total_complaints=len(complaints),
        by_status=by_status,
        by_category=by_category,
        by_priority=by_priority,
        by_department=by_department,
        hotspots=hotspots,
        gee_available=is_gee_available(),
    )


@router.get("/gee/overlay")
def gee_overlay(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    radius_m: int = Query(default=25000, ge=1000, le=50000),
    _: User = Depends(get_admin_user),
):
    return get_satellite_overlay_bounds(lat, lon, radius_m)


@router.post("/gee/leak-analysis")
def gee_leak_analysis(
    payload: dict = Body(...),
    _: User = Depends(get_admin_user),
):
    try:
        lat = float(payload["lat"])
        lon = float(payload["lon"])
        radius_m = int(payload["radius_m"])
        start_date = date.fromisoformat(payload["start_date"])
        end_date = date.fromisoformat(payload["end_date"])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("Coordinates are outside valid ranges.")
        if radius_m not in {100, 250, 500, 1000}:
            raise ValueError("Choose a supported search radius.")
        if end_date <= start_date or (end_date - start_date).days > 365:
            raise ValueError("Choose an end date after the start date, within a one-year analysis period.")
        if end_date > date.today():
            raise ValueError("The end date cannot be in the future.")
        return analyze_water_leak(lat, lon, radius_m, start_date, end_date)
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None

















