"""
scheduler.py

Greedy job-shop scheduling algorithm (v1).
For each work order (sorted by priority then due date), schedule each operation
in sequence on its assigned machine, starting as early as possible.

This respects two constraints:
  1. Machine capacity - a machine can only process one operation at a time.
  2. Operation sequence - op N+1 in a work order cannot start until op N is done.

Upgrade path: Replace compute_schedule() body with OR-Tools CP-SAT solver
for mathematically optimal results without changing the API.
"""

from datetime import datetime, timedelta
from typing import List, Dict
from sqlalchemy.orm import Session
from app.models.models import (
    Machine, WorkOrder, Operation, ScheduleRun, ScheduleItem
)


def compute_schedule(db: Session, run_label: str = "auto") -> ScheduleRun:
    """
    Compute a new schedule and persist it to the database.
    Returns the created ScheduleRun with all ScheduleItems.
    """
    machines: List[Machine] = db.query(Machine).all()
    work_orders: List[WorkOrder] = db.query(WorkOrder).filter(
        WorkOrder.status.in_(["pending", "in_progress"])
    ).all()

    # Track the earliest time each machine is free
    machine_free_at: Dict[int, datetime] = {
        m.id: datetime.utcnow() for m in machines
    }

    # Sort work orders: highest priority first, then earliest due date
    sorted_work_orders = sorted(
        work_orders,
        key=lambda wo: (-wo.priority, wo.due_date)
    )

    # Create a new schedule run
    run = ScheduleRun(run_label=run_label)
    db.add(run)
    db.flush()  # Get the run ID before adding items

    schedule_items = []

    for wo in sorted_work_orders:
        # Operations are already ordered by sequence_no via the relationship
        ops: List[Operation] = wo.operations
        wo_next_available = datetime.utcnow()  # Track when this WO's ops are done

        for op in ops:
            machine_id = op.machine_id
            total_duration = op.setup_minutes + op.processing_minutes

            # Start time = max(machine free, previous op in this WO done)
            start_time = max(
                machine_free_at.get(machine_id, datetime.utcnow()),
                wo_next_available
            )
            end_time = start_time + timedelta(minutes=total_duration)

            # Calculate how late we are vs due date
            delay = max(0, int((end_time - wo.due_date).total_seconds() / 60))

            item = ScheduleItem(
                schedule_run_id=run.id,
                work_order_id=wo.id,
                operation_id=op.id,
                machine_id=machine_id,
                start_time=start_time,
                end_time=end_time,
                delay_minutes=delay
            )
            schedule_items.append(item)

            # Update machine and work order availability
            machine_free_at[machine_id] = end_time
            wo_next_available = end_time

    db.add_all(schedule_items)
    db.commit()
    db.refresh(run)
    return run


def get_schedule_summary(run: ScheduleRun) -> dict:
    """Return a plain summary dict for the AI to use in explanations."""
    delayed = [i for i in run.items if i.delay_minutes > 0]
    return {
        "run_id": run.id,
        "total_operations": len(run.items),
        "operations_delayed": len(delayed),
        "max_delay_minutes": max((i.delay_minutes for i in run.items), default=0),
        "created_at": run.created_at.isoformat()
    }
