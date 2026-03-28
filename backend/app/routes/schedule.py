from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.schemas import ScheduleRunOut, ScheduleItemOut, KPIOut
from app.services.scheduler import compute_schedule
from app.models.models import ScheduleRun, Machine, WorkOrder, Operation, ScheduleItem
from datetime import datetime
from typing import List

router = APIRouter()


def enrich_run(run: ScheduleRun, db: Session) -> ScheduleRunOut:
    """Add machine_name and work_order_name to each schedule item."""
    machines = {m.id: m.name for m in db.query(Machine).all()}
    work_orders = {wo.id: wo.code for wo in db.query(WorkOrder).all()}
    items = [
        ScheduleItemOut(
            id=item.id,
            work_order_id=item.work_order_id,
            operation_id=item.operation_id,
            machine_id=item.machine_id,
            machine_name=machines.get(item.machine_id, f"Machine #{item.machine_id}"),
            work_order_name=work_orders.get(item.work_order_id, f"WO #{item.work_order_id}"),
            start_time=item.start_time,
            end_time=item.end_time,
            delay_minutes=item.delay_minutes,
            is_late=item.is_late,
            is_conflict=item.is_conflict,
        )
        for item in run.items
    ]
    return ScheduleRunOut(
        schedule_run_id=run.id,
        run_label=run.label,
        algorithm=run.algorithm,
        computed_at=run.created_at,
        created_at=run.created_at,
        total_operations=run.total_operations,
        on_time_count=run.on_time_count,
        late_count=run.late_count,
        machine_utilization_pct=run.machine_utilization_pct,
        has_conflicts=run.has_conflicts,
        conflict_details=run.conflict_details,
        items=items,
    )


@router.post("/compute", response_model=ScheduleRunOut)
def trigger_schedule(db: Session = Depends(get_db)):
    """
    Compute a new schedule from the current machines, work orders, and operations.
    Uses EDD (Earliest Due Date) with shift-awareness and conflict detection.
    """
    run = compute_schedule(db, label="manual")
    return enrich_run(run, db)


@router.get("/latest", response_model=ScheduleRunOut)
def get_latest_schedule(db: Session = Depends(get_db)):
    """
    Return the most recently computed schedule.
    """
    run = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    if not run:
        raise HTTPException(status_code=404, detail="No schedule computed yet")
    return enrich_run(run, db)


@router.get("/history", response_model=List[ScheduleRunOut])
def get_schedule_history(limit: int = 10, db: Session = Depends(get_db)):
    """Return the last N schedule runs for comparison."""
    runs = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).limit(limit).all()
    return [enrich_run(r, db) for r in runs]


@router.get("/kpis", response_model=KPIOut)
def get_kpis(db: Session = Depends(get_db)):
    """
    Return live KPI dashboard metrics.
    """
    now = datetime.utcnow()
    all_wos = db.query(WorkOrder).all()
    total_wos = len(all_wos)
    pending = sum(1 for w in all_wos if w.status.value == "pending")
    in_progress = sum(1 for w in all_wos if w.status.value == "in_progress")
    completed = sum(1 for w in all_wos if w.status.value == "completed")
    overdue = sum(
        1 for w in all_wos
        if w.due_date and w.due_date < now and w.status.value not in ("completed", "cancelled")
    )
    on_time = sum(
        1 for w in all_wos
        if w.status.value == "completed" and w.due_date and w.completed_at and w.completed_at <= w.due_date
    )
    completed_total = completed or 1
    on_time_rate = round((on_time / completed_total) * 100, 1)

    lead_times = [
        (w.completed_at - w.started_at).total_seconds() / 3600
        for w in all_wos
        if w.completed_at and w.started_at
    ]
    avg_lead_time_hours = round(sum(lead_times) / len(lead_times), 1) if lead_times else 0

    latest_run = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    machine_utilization = round(latest_run.machine_utilization_pct, 1) if latest_run else 0
    conflicts = db.query(ScheduleItem).filter(ScheduleItem.is_conflict == True).count() if latest_run else 0
    late_ops = db.query(ScheduleItem).filter(
        ScheduleItem.schedule_run_id == latest_run.id,
        ScheduleItem.is_late == True
    ).count() if latest_run else 0

    all_machines = db.query(Machine).all()
    machines_in_maintenance = sum(1 for m in all_machines if m.status.value == "maintenance")

    return KPIOut(
        total_work_orders=total_wos,
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


@router.patch("/work-orders/{wo_id}/status")
def update_work_order_status(wo_id: int, status: str, db: Session = Depends(get_db)):
    """Update work order status with timestamp tracking."""
    wo = db.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    valid = ["pending", "in_progress", "paused", "completed", "cancelled", "on_hold"]
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status. Choose from: {valid}")
    wo.status = status
    if status == "in_progress" and not wo.started_at:
        wo.started_at = datetime.utcnow()
    elif status == "completed":
        wo.completed_at = datetime.utcnow()
    elif status == "paused":
        wo.paused_at = datetime.utcnow()
    db.commit()
    return {"message": f"Work order {wo.code} status updated to {status}", "updated_at": datetime.utcnow()}


@router.patch("/machines/{machine_id}/status")
def update_machine_status(machine_id: int, status: str, notes: str = "", db: Session = Depends(get_db)):
    """Toggle machine status (available/maintenance/offline)."""
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    valid = ["available", "busy", "maintenance", "offline"]
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status")
    machine.status = status
    if notes:
        machine.maintenance_notes = notes
    db.commit()
    return {"message": f"{machine.name} status set to {status}"}
