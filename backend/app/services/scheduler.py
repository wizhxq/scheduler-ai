from datetime import datetime, timedelta
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from app.models.models import (
    Machine, WorkOrder, Operation, ScheduleRun, ScheduleItem, MachineStatus
)

# Map day name abbreviations to ISO weekday numbers (Mon=1 ... Sun=7)
DAY_NAME_MAP = {
    "Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6, "Sun": 7,
    "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4,
    "Friday": 5, "Saturday": 6, "Sunday": 7,
}


def parse_shift_days(shift_days_str: str) -> List[int]:
    """Parse shift_days which may be '1,2,3,4,5' or 'Mon,Tue,Wed,Thu,Fri'."""
    days = []
    for d in shift_days_str.split(","):
        d = d.strip()
        if d in DAY_NAME_MAP:
            days.append(DAY_NAME_MAP[d])
        else:
            try:
                days.append(int(d))
            except ValueError:
                pass  # skip unrecognised values
    return days if days else [1, 2, 3, 4, 5]  # default Mon-Fri


def parse_time(t: str):
    h, m = t.split(":")
    return int(h), int(m)


def next_shift_start(machine: Machine, after: datetime) -> datetime:
    """Finds the next available shift start time for a machine."""
    shift_days = parse_shift_days(machine.shift_days or "1,2,3,4,5")
    sh, sm = parse_time(machine.shift_start or "08:00")
    eh, em = parse_time(machine.shift_end or "18:00")
    candidate = after
    for _ in range(14):  # Look ahead up to 2 weeks
        iso_day = candidate.isoweekday()
        if iso_day in shift_days:
            shift_open = candidate.replace(hour=sh, minute=sm, second=0, microsecond=0)
            shift_close = candidate.replace(hour=eh, minute=em, second=0, microsecond=0)
            if candidate < shift_open:
                return shift_open
            if candidate < shift_close:
                return candidate
        candidate = (candidate + timedelta(days=1)).replace(hour=sh, minute=sm, second=0, microsecond=0)
    return candidate


def slot_fits_in_shift(machine: Machine, start: datetime, duration_minutes: int) -> bool:
    """Checks if an operation fits within the current shift."""
    eh, em = parse_time(machine.shift_end or "18:00")
    shift_close = start.replace(hour=eh, minute=em, second=0, microsecond=0)
    return (start + timedelta(minutes=duration_minutes)) <= shift_close


def schedule_slot(machine: Machine, earliest: datetime, duration_minutes: int) -> datetime:
    """Finds the first valid slot for an operation considering shifts."""
    start = next_shift_start(machine, earliest)
    while not slot_fits_in_shift(machine, start, duration_minutes):
        next_day = (start + timedelta(days=1)).replace(hour=0, minute=0, second=0)
        start = next_shift_start(machine, next_day)
    return start


def compute_schedule(db: Session, label: str = "auto", algorithm: str = "EDD") -> ScheduleRun:
    """Primary scheduling engine with KPI calculation."""
    machines = db.query(Machine).filter(
        Machine.status.in_([MachineStatus.available, MachineStatus.busy])
    ).all()
    work_orders = db.query(WorkOrder).filter(
        WorkOrder.status.in_(["pending", "in_progress"])
    ).all()
    machine_free_at = {m.id: datetime.utcnow() for m in machines}
    # Sort by priority (1=Critical is highest) then due date
    sorted_wo = sorted(
        work_orders,
        key=lambda x: (x.priority, x.due_date or datetime(2099, 1, 1))
    )
    run = ScheduleRun(label=label, algorithm=algorithm)
    db.add(run)
    db.flush()
    items = []
    total_busy_minutes = 0
    late_count = 0
    on_time_count = 0
    total_delay = 0
    for wo in sorted_wo:
        wo_avail = datetime.utcnow()
        for op in wo.operations:
            m = next((m for m in machines if m.id == op.machine_id), None)
            if not m:
                continue
            dur = (op.setup_minutes or m.default_setup_minutes or 15) + op.processing_minutes
            start = schedule_slot(m, max(machine_free_at[m.id], wo_avail), dur)
            end = start + timedelta(minutes=dur)
            is_late = bool(wo.due_date and end > wo.due_date)
            delay = max(0, int((end - wo.due_date).total_seconds() / 60)) if wo.due_date else 0
            item = ScheduleItem(
                schedule_run_id=run.id,
                work_order_id=wo.id,
                operation_id=op.id,
                machine_id=m.id,
                start_time=start,
                end_time=end,
                delay_minutes=delay,
                is_late=is_late,
                is_conflict=False
            )
            db.add(item)
            items.append(item)
            machine_free_at[m.id] = end
            wo_avail = end
            total_busy_minutes += dur
            if is_late:
                late_count += 1
                total_delay += delay
            else:
                on_time_count += 1
    # Capacity calculation for utilization
    total_cap_minutes = 0
    for m in machines:
        sh, sm = parse_time(m.shift_start or "08:00")
        eh, em = parse_time(m.shift_end or "18:00")
        shift_dur = (eh * 60 + em) - (sh * 60 + sm)
        total_cap_minutes += shift_dur
    run.total_operations = len(items)
    run.on_time_count = on_time_count
    run.late_count = late_count
    run.total_delay_minutes = total_delay
    run.machine_utilization_pct = min(
        100.0, round((total_busy_minutes / (total_cap_minutes or 1)) * 100, 1)
    )
    db.commit()
    db.refresh(run)
    return run


def get_schedule_summary(db: Session) -> Dict[str, Any]:
    machines = db.query(Machine).all()
    work_orders = db.query(WorkOrder).all()
    latest = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    return {
        "machine_count": len(machines),
        "work_order_count": len(work_orders),
        "utilization": latest.machine_utilization_pct if latest else 0,
        "is_running": any(m.status == MachineStatus.available for m in machines)
    }
