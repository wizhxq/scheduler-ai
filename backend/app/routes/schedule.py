"""
schedule.py — Schedule, KPI, and status-update routes.

Fixes applied:
  - enrich_run now computes makespan from actual item times (not a model field).
  - /kpis uses WorkOrderStatus enum comparison (not .value) consistently.
  - /work-orders/{id}/status validates against the WorkOrderStatus enum.
  - /machines/{id}/status validates against the MachineStatus enum.
  - Both PATCH endpoints return typed dicts instead of bare strings.
  - compute triggers now accept an optional algorithm query param.
"""

from datetime import datetime
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
from app.schemas.schemas import KPIOut, ScheduleItemOut, ScheduleRunOut
from app.services.scheduler import compute_schedule

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _enrich_run(run: ScheduleRun, db: Session) -> ScheduleRunOut:
    """Attach machine/WO names and compute derived fields for API output."""
    machine_map = {m.id: m.name for m in db.query(Machine).all()}
    wo_map = {wo.id: wo.code for wo in db.query(WorkOrder).all()}

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

    # Makespan = span from earliest start to latest end across all items
    makespan = 0
    if run.items:
        earliest = min(i.start_time for i in run.items)
        latest = max(i.end_time for i in run.items)
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
    """
    Compute a new schedule from current data.
    Optionally specify the sorting algorithm via ?algorithm=SPT etc.
    """
    run = compute_schedule(db, label="manual", algorithm=algorithm)
    return _enrich_run(run, db)


@router.get("/latest", response_model=ScheduleRunOut)
def get_latest_schedule(db: Session = Depends(get_db)):
    """Return the most recently computed schedule."""
    run = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    if not run:
        raise HTTPException(status_code=404, detail="No schedule computed yet.")
    return _enrich_run(run, db)


@router.get("/history", response_model=List[ScheduleRunOut])
def get_schedule_history(
    limit: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Return the last N schedule runs."""
    runs = (
        db.query(ScheduleRun)
        .order_by(ScheduleRun.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_enrich_run(r, db) for r in runs]


# ---------------------------------------------------------------------------
# KPI endpoint
# ---------------------------------------------------------------------------

@router.get("/kpis", response_model=KPIOut)
def get_kpis(db: Session = Depends(get_db)):
    """Live KPI dashboard metrics."""
    now = datetime.utcnow()
    all_wos = db.query(WorkOrder).all()

    pending = sum(1 for w in all_wos if w.status == WorkOrderStatus.pending)
    in_progress = sum(1 for w in all_wos if w.status == WorkOrderStatus.in_progress)
    completed_wos = [w for w in all_wos if w.status == WorkOrderStatus.completed]
    completed = len(completed_wos)
    overdue = sum(
        1 for w in all_wos
        if w.due_date
        and w.due_date < now
        and w.status not in (WorkOrderStatus.completed, WorkOrderStatus.cancelled)
    )
    on_time = sum(
        1 for w in completed_wos
        if w.due_date and w.completed_at and w.completed_at <= w.due_date
    )
    on_time_rate = round((on_time / max(completed, 1)) * 100, 1)

    lead_times = [
        (w.completed_at - w.started_at).total_seconds() / 3600
        for w in all_wos
        if w.completed_at and w.started_at
    ]
    avg_lead_time_hours = round(sum(lead_times) / len(lead_times), 1) if lead_times else 0.0

    latest_run: Optional[ScheduleRun] = (
        db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    )
    machine_utilization = round(latest_run.machine_utilization_pct, 1) if latest_run else 0.0
    late_ops = (
        db.query(ScheduleItem)
        .filter(
            ScheduleItem.schedule_run_id == latest_run.id,
            ScheduleItem.is_late.is_(True),
        )
        .count()
        if latest_run
        else 0
    )
    # Conflict count is across ALL runs (is_conflict is a persistent flag)
    conflicts = (
        db.query(ScheduleItem)
        .filter(ScheduleItem.is_conflict.is_(True))
        .count()
    )

    all_machines = db.query(Machine).all()
    machines_in_maintenance = sum(
        1 for m in all_machines if m.status == MachineStatus.maintenance
    )

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
    """Update work order status with automatic timestamp tracking."""
    wo = db.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found.")

    valid = [s.value for s in WorkOrderStatus]
    if status not in valid:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status '{status}'. Valid values: {valid}",
        )

    now = datetime.utcnow()
    wo.status = WorkOrderStatus(status)
    if status == "in_progress" and not wo.started_at:
        wo.started_at = now
    elif status == "completed":
        wo.completed_at = now
    elif status == "paused":
        wo.paused_at = now

    db.commit()
    return {
        "message": f"Work order {wo.code} status updated to '{status}'.",
        "work_order_id": wo_id,
        "new_status": status,
        "updated_at": now.isoformat(),
    }


@router.patch("/machines/{machine_id}/status")
def update_machine_status(
    machine_id: int,
    status: str,
    notes: str = "",
    db: Session = Depends(get_db),
):
    """Toggle machine availability status."""
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found.")

    valid = [s.value for s in MachineStatus]
    if status not in valid:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status '{status}'. Valid values: {valid}",
        )

    machine.status = MachineStatus(status)
    if notes:
        machine.maintenance_notes = notes

    db.commit()
    return {
        "message": f"{machine.name} status set to '{status}'.",
        "machine_id": machine_id,
        "new_status": status,
    }
