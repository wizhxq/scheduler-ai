"""
schedule.py — Schedule, KPI, and status-update routes.
"""

from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import (
    Machine,
    MachineStatus,
    Operation,
    ScheduleItem,
    ScheduleRun,
    WorkOrder,
    WorkOrderStatus,
)
from app.schemas.schemas import KPIOut, RescheduleBody, ScheduleItemOut, ScheduleRunOut
from app.services.scheduler import compute_schedule

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _enrich_run(run: ScheduleRun, db: Session) -> ScheduleRunOut:
    machine_map = {m.id: m.name for m in db.query(Machine).all()}
    wo_map      = {wo.id: wo.code for wo in db.query(WorkOrder).all()}

    items_out = [
        ScheduleItemOut(
            id=item.id,
            schedule_run_id=item.schedule_run_id,
            work_order_id=item.work_order_id,
            operation_id=item.operation_id,
            machine_id=item.machine_id,
            machine_name=machine_map.get(item.machine_id, f"Machine #{item.machine_id}"),
            work_order_name=wo_map.get(item.work_order_id, f"WO #{item.work_order_id}"),
            start_time=item.start_time,
            end_time=item.end_time,
            delay_minutes=item.delay_minutes or 0,
            is_late=item.is_late or False,
            is_conflict=item.is_conflict or False,
            conflict_with_item_id=item.conflict_with_item_id,
        )
        for item in run.items
    ]

    makespan = 0
    if run.items:
        earliest = min(i.start_time for i in run.items)
        latest   = max(i.end_time   for i in run.items)
        makespan = int((latest - earliest).total_seconds() / 60)

    return ScheduleRunOut(
        id=run.id,
        created_at=run.created_at,
        label=run.label or "",
        algorithm=run.algorithm or "EDD",
        total_operations=run.total_operations or 0,
        total_delay_minutes=run.total_delay_minutes or 0,
        makespan_minutes=makespan,
        on_time_count=run.on_time_count or 0,
        late_count=run.late_count or 0,
        machine_utilization_pct=run.machine_utilization_pct or 0.0,
        has_conflicts=run.has_conflicts or False,
        conflict_details=run.conflict_details or "",
        items=items_out,
    )


# ---------------------------------------------------------------------------
# Schedule endpoints
# ---------------------------------------------------------------------------

@router.post("/compute", response_model=ScheduleRunOut)
def trigger_schedule(
    algorithm: str = Query(default="EDD", enum=["EDD", "SPT", "FIFO", "CRITICAL_RATIO"]),
    db: Session = Depends(get_db),
):
    run = compute_schedule(db, label="manual", algorithm=algorithm)
    return _enrich_run(run, db)


@router.get("/latest", response_model=ScheduleRunOut)
def get_latest_schedule(db: Session = Depends(get_db)):
    run = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    if not run:
        raise HTTPException(status_code=404, detail="No schedule computed yet.")
    return _enrich_run(run, db)


@router.get("/history", response_model=List[ScheduleRunOut])
def get_schedule_history(
    limit: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    runs = (
        db.query(ScheduleRun)
        .order_by(ScheduleRun.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_enrich_run(r, db) for r in runs]


# ---------------------------------------------------------------------------
# Schedule Item — manual reschedule from calendar
# ---------------------------------------------------------------------------

@router.patch("/items/{item_id}", response_model=ScheduleItemOut)
def update_schedule_item(
    item_id: int,
    body: RescheduleBody,          # <-- single Pydantic model, not two Body() params
    db: Session = Depends(get_db),
):
    """
    Move a scheduled operation to a new start/end time (called from calendar drag-drop).
    Updates the parent work order's due_date so calendar and schedule stay in sync.
    """
    item = db.query(ScheduleItem).filter(ScheduleItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found.")

    item.start_time = body.start_time
    item.end_time   = body.end_time

    wo = db.query(WorkOrder).filter(WorkOrder.id == item.work_order_id).first()
    if wo:
        if wo.due_date and body.end_time > wo.due_date:
            item.is_late       = True
            item.delay_minutes = int((body.end_time - wo.due_date).total_seconds() / 60)
        else:
            item.is_late       = False
            item.delay_minutes = 0
        wo.due_date = body.end_time

    db.commit()
    db.refresh(item)

    machine_name = ""
    wo_name      = ""
    m = db.query(Machine).filter(Machine.id == item.machine_id).first()
    if m:  machine_name = m.name
    if wo: wo_name      = wo.code

    return ScheduleItemOut(
        id=item.id,
        schedule_run_id=item.schedule_run_id,
        work_order_id=item.work_order_id,
        operation_id=item.operation_id,
        machine_id=item.machine_id,
        machine_name=machine_name,
        work_order_name=wo_name,
        start_time=item.start_time,
        end_time=item.end_time,
        delay_minutes=item.delay_minutes or 0,
        is_late=item.is_late or False,
        is_conflict=item.is_conflict or False,
        conflict_with_item_id=item.conflict_with_item_id,
    )


# ---------------------------------------------------------------------------
# KPI endpoint
# ---------------------------------------------------------------------------

@router.get("/kpis", response_model=KPIOut)
def get_kpis(db: Session = Depends(get_db)):
    now    = datetime.utcnow()
    all_wos = db.query(WorkOrder).all()

    pending     = sum(1 for w in all_wos if w.status == WorkOrderStatus.pending)
    in_progress = sum(1 for w in all_wos if w.status == WorkOrderStatus.in_progress)
    completed_wos = [w for w in all_wos if w.status == WorkOrderStatus.completed]
    completed   = len(completed_wos)
    overdue     = sum(
        1 for w in all_wos
        if w.due_date and w.due_date < now
        and w.status not in (WorkOrderStatus.completed, WorkOrderStatus.cancelled)
    )
    on_time = sum(
        1 for w in completed_wos
        if w.due_date and w.completed_at and w.completed_at <= w.due_date
    )
    on_time_rate = round((on_time / max(completed, 1)) * 100, 1)

    lead_times = [
        (w.completed_at - w.started_at).total_seconds() / 3600
        for w in all_wos if w.completed_at and w.started_at
    ]
    avg_lead_time_hours = round(sum(lead_times) / len(lead_times), 1) if lead_times else 0.0

    latest_run: Optional[ScheduleRun] = (
        db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    )
    machine_utilization = round(latest_run.machine_utilization_pct, 1) if latest_run else 0.0
    late_ops = (
        db.query(ScheduleItem)
        .filter(ScheduleItem.schedule_run_id == latest_run.id, ScheduleItem.is_late.is_(True))
        .count() if latest_run else 0
    )
    conflicts = db.query(ScheduleItem).filter(ScheduleItem.is_conflict.is_(True)).count()

    all_machines = db.query(Machine).all()
    machines_in_maintenance = sum(1 for m in all_machines if m.status == MachineStatus.maintenance)

    return KPIOut(
        total_work_orders=len(all_wos),
        pending_orders=pending,
        in_progress_orders=in_progress,
        completed_orders=completed,
        overdue_orders=overdue,
        on_time_delivery_rate=on_time_rate,
        avg_lead_time_hours=avg_lead_time_hours,
        machine_utilization_pct=machine_utilization,
        conflict_count=conflicts,
        late_operations=late_ops,
        machines_in_maintenance=machines_in_maintenance,
        total_machines=len(all_machines),
    )


# ---------------------------------------------------------------------------
# Status-update endpoints
# ---------------------------------------------------------------------------

@router.patch("/work-orders/{wo_id}/status")
def update_work_order_status(
    wo_id: int,
    status: str,
    db: Session = Depends(get_db),
):
    wo = db.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found.")
    valid = [s.value for s in WorkOrderStatus]
    if status not in valid:
        raise HTTPException(status_code=422, detail=f"Invalid status '{status}'. Valid: {valid}")
    now = datetime.utcnow()
    wo.status = WorkOrderStatus(status)
    if status == "in_progress" and not wo.started_at: wo.started_at   = now
    elif status == "completed":                       wo.completed_at = now
    elif status == "paused":                          wo.paused_at    = now
    db.commit()
    return {"message": f"{wo.code} → {status}", "updated_at": now.isoformat()}


@router.patch("/machines/{machine_id}/status")
def update_machine_status(
    machine_id: int,
    status: str,
    notes: str = "",
    db: Session = Depends(get_db),
):
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found.")
    valid = [s.value for s in MachineStatus]
    if status not in valid:
        raise HTTPException(status_code=422, detail=f"Invalid status '{status}'. Valid: {valid}")
    machine.status = MachineStatus(status)
    if notes: machine.maintenance_notes = notes
    db.commit()
    return {"message": f"{machine.name} → {status}"}
