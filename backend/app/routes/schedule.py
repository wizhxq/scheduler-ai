from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.schemas import ScheduleRunOut, ScheduleItemOut
from app.services.scheduler import compute_schedule
from app.models.models import ScheduleRun, Machine, WorkOrder

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
        )
        for item in run.items
    ]
    return ScheduleRunOut(
        schedule_run_id=run.id,
        run_label=run.run_label,
        computed_at=run.created_at,
        created_at=run.created_at,
        items=items,
    )


@router.post("/compute", response_model=ScheduleRunOut)
def trigger_schedule(db: Session = Depends(get_db)):
    """
    Compute a new schedule from the current machines, work orders, and operations.
    Returns the full schedule with start/end times for every operation.
    """
    run = compute_schedule(db, run_label="manual")
    return enrich_run(run, db)


@router.get("/latest", response_model=ScheduleRunOut)
def get_latest_schedule(db: Session = Depends(get_db)):
    """
    Return the most recently computed schedule.
    """
    run = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    if not run:
        raise HTTPException(
            status_code=404,
            detail="No schedule found. POST to /api/schedule/compute first."
        )
    return enrich_run(run, db)


@router.get("/history")
def get_schedule_history(db: Session = Depends(get_db)):
    """List all past schedule runs (metadata only)."""
    runs = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).limit(20).all()
    return [
        {"id": r.id, "label": r.run_label, "created_at": r.created_at, "items": len(r.items)}
        for r in runs
    ]
