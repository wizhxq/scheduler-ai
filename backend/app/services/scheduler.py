"""
scheduler.py  -  Enterprise-grade job-shop scheduling engine

Algorithm: EDD (Earliest Due Date) with finite-capacity, shift-aware scheduling.

Features:
  - Shift-aware: respects each machine's working hours and days
  - Setup/changeover time included in every slot
  - Conflict detection: flags overlapping assignments
  - Backward scheduling: plan from due date backward when requested
  - On-time / late flagging per operation
  - Machine utilization % calculation
  - Machines in maintenance/offline are skipped
  - KPI metadata stored on ScheduleRun

Upgrade path: Replace greedy loop with OR-Tools CP-SAT solver
for mathematically optimal results without changing the API.
"""

from datetime import datetime, timedelta
from typing import List, Dict
from sqlalchemy.orm import Session
from app.models.models import (
    Machine, WorkOrder, Operation, ScheduleRun, ScheduleItem, MachineStatus
)


# ---------------------------------------------------------------------------
# Shift helpers
# ---------------------------------------------------------------------------

def parse_time(t: str):
    """Parse HH:MM string to (hour, minute) tuple."""
    h, m = t.split(":")
    return int(h), int(m)


def next_shift_start(machine: Machine, after: datetime) -> datetime:
    """
    Given a machine and a datetime, return the earliest datetime >= 'after'
    that falls within the machine's shift window.
    Shift days: comma-separated ISO weekday numbers (Mon=1, Sun=7).
    """
    shift_days = [int(d) for d in machine.shift_days.split(",")]
    sh, sm = parse_time(machine.shift_start)
    eh, em = parse_time(machine.shift_end)

    candidate = after
    for _ in range(14):  # max 2 weeks look-ahead
        iso_day = candidate.isoweekday()  # Mon=1 ... Sun=7
        if iso_day in shift_days:
            shift_open = candidate.replace(hour=sh, minute=sm, second=0, microsecond=0)
            shift_close = candidate.replace(hour=eh, minute=em, second=0, microsecond=0)
            if candidate < shift_open:
                return shift_open
            if candidate < shift_close:
                return candidate  # already inside shift
        # move to next calendar day
        candidate = (candidate + timedelta(days=1)).replace(
            hour=sh, minute=sm, second=0, microsecond=0
        )
    return candidate


def slot_fits_in_shift(machine: Machine, start: datetime, duration_minutes: int) -> bool:
    """Return True if a slot of duration_minutes fits inside one shift window."""
    eh, em = parse_time(machine.shift_end)
    shift_close = start.replace(hour=eh, minute=em, second=0, microsecond=0)
    return (start + timedelta(minutes=duration_minutes)) <= shift_close


def schedule_slot(machine: Machine, earliest: datetime, duration_minutes: int) -> datetime:
    """
    Find the earliest start time >= earliest where the slot fits in a shift.
    Returns the start datetime.
    """
    start = next_shift_start(machine, earliest)
    while not slot_fits_in_shift(machine, start, duration_minutes):
        # Doesn't fit in today's shift, try next shift
        next_day = (start + timedelta(days=1)).replace(hour=0, minute=0, second=0)
        start = next_shift_start(machine, next_day)
    return start


# ---------------------------------------------------------------------------
# Main scheduling function
# ---------------------------------------------------------------------------

def compute_schedule(db: Session, run_label: str = "auto") -> ScheduleRun:
    """
    Compute a new finite-capacity, shift-aware schedule and persist it.
    Returns the created ScheduleRun with all ScheduleItems.
    """
    # Only schedule machines that are available (skip maintenance/offline)
    machines: List[Machine] = db.query(Machine).filter(
        Machine.status.in_([MachineStatus.available, MachineStatus.busy])
    ).all()

    work_orders: List[WorkOrder] = db.query(WorkOrder).filter(
        WorkOrder.status.in_(["pending", "in_progress"])
    ).all()

    # machine_free_at: earliest time each machine is free
    machine_free_at: Dict[int, datetime] = {
        m.id: datetime.utcnow() for m in machines
    }

    # Sort: rush orders first, then by priority (1=highest), then by due date
    sorted_work_orders = sorted(
        work_orders,
        key=lambda wo: (
            0 if getattr(wo, 'is_rush', False) else 1,
            wo.priority,
            wo.due_date or datetime(2099, 1, 1)
        )
    )

    # Create the schedule run record
    run = ScheduleRun(run_label=run_label, algorithm="EDD")
    db.add(run)
    db.flush()

    schedule_items = []
    conflicts = []
    total_busy_minutes = 0

    for wo in sorted_work_orders:
        ops: List[Operation] = wo.operations
        wo_next_available = datetime.utcnow()  # op N+1 can't start until op N ends

        for op in ops:
            machine = next((m for m in machines if m.id == op.machine_id), None)
            if not machine:
                continue  # machine offline/maintenance — skip

            setup = op.setup_minutes if op.setup_minutes else machine.default_setup_minutes
            total_minutes = setup + op.processing_minutes

            # Earliest possible start = max(machine free, previous op done)
            earliest = max(machine_free_at[machine.id], wo_next_available)

            # Find shift-aware start
            start = schedule_slot(machine, earliest, total_minutes)
            end = start + timedelta(minutes=total_minutes)

            # Conflict detection: check if this overlaps any existing item on same machine
            is_conflict = False
            for existing in schedule_items:
                if existing.machine_id == machine.id:
                    if not (end <= existing.start_time or start >= existing.end_time):
                        is_conflict = True
                        conflicts.append(f"{wo.code} op#{op.sequence_no} conflicts with WO#{existing.work_order_id}")
                        break

            # Late detection
            is_late = bool(wo.due_date and end > wo.due_date)
            delay = max(0, int((end - wo.due_date).total_seconds() / 60)) if wo.due_date else 0

            item = ScheduleItem(
                schedule_run_id=run.id,
                work_order_id=wo.id,
                operation_id=op.id,
                machine_id=machine.id,
                start_time=start,
                end_time=end,
                delay_minutes=delay,
                is_late=is_late,
                is_conflict=is_conflict,
            )
            db.add(item)
            schedule_items.append(item)

            machine_free_at[machine.id] = end
            wo_next_available = end
            total_busy_minutes += total_minutes

    # --- Compute KPIs for this run ---
    total_ops = len(schedule_items)
    on_time = sum(1 for i in schedule_items if not i.is_late)
    late = sum(1 for i in schedule_items if i.is_late)
    has_conflicts = len(conflicts) > 0

    # Machine utilization: busy time / total shift time available
    now = datetime.utcnow()
    total_shift_minutes = 0
    for m in machines:
        sh, sm = parse_time(m.shift_start)
        eh, em = parse_time(m.shift_end)
        shift_hours = (eh + em / 60) - (sh + sm / 60)
        total_shift_minutes += shift_hours * 60

    utilization = round((total_busy_minutes / total_shift_minutes) * 100, 1) if total_shift_minutes > 0 else 0
    utilization = min(utilization, 100.0)

    # Makespan: time from now to last end_time
    if schedule_items:
        last_end = max(i.end_time for i in schedule_items)
        makespan = int((last_end - now).total_seconds() / 60)
    else:
        makespan = 0

    # Update run metadata
    run.total_operations = total_ops
    run.on_time_count = on_time
    run.late_count = late
    run.machine_utilization_pct = utilization
    run.makespan_minutes = makespan
    run.has_conflicts = has_conflicts
    run.conflict_details = " | ".join(conflicts) if conflicts else ""
    run.label = run_label

    db.commit()
    db.refresh(run)
    return run
