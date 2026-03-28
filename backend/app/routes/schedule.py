from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.schemas import ScheduleRunOut
from app.services.scheduler import compute_schedule
from app.models.models import ScheduleRun

router = APIRouter()


@router.post("/compute", response_model=ScheduleRunOut)
def trigger_schedule(db: Session = Depends(get_db)):
    """
    Compute a new schedule from the current machines, work orders, and operations.
    Returns the full schedule with start/end times for every operation.
    """
    run = compute_schedule(db, run_label="manual")
    return ScheduleRunOut(
        schedule_run_id=run.id,
        run_label=run.run_label,
        created_at=run.created_at,
        items=run.items
    )


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
    return ScheduleRunOut(
        schedule_run_id=run.id,
        run_label=run.run_label,
        created_at=run.created_at,
        items=run.items
    )


@router.get("/history")
def get_schedule_history(db: Session = Depends(get_db)):
    """List all past schedule runs (metadata only)."""
    runs = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).limit(20).all()
    return [
        {"id": r.id, "label": r.run_label, "created_at": r.created_at, "items": len(r.items)}
        for r in runs
    ]
