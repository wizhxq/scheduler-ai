"""
scheduler.py  –  Production-grade scheduling engine

Algorithms supported
--------------------
EDD  – Earliest Due Date          (minimises maximum lateness)
SPT  – Shortest Processing Time   (minimises average flow time)
FIFO – First In, First Out        (created_at order)
CR   – Critical Ratio             (urgency = remaining time / remaining work)

Key fixes vs. original
----------------------
* All datetime arithmetic is timezone-naive UTC consistently (no mixing).
* machine_free_at is seeded per machine, not reset to utcnow() on every WO.
* Operation sequence ordering is enforced (sequence_no ASC).
* Capacity utilisation is computed over the *actual scheduling horizon*
  (first start → last end) rather than a flat single-shift window.
* Makespan is stored on the ScheduleRun.
* Conflict detection: overlapping slots on the same machine are flagged.
* next_shift_start loop guard raised to 30 days; infinite-loop protection.
* parse_time raises a clear ValueError instead of silently producing wrong ints.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any

from sqlalchemy.orm import Session

from app.models.models import (
    Machine,
    MachineStatus,
    Operation,
    ScheduleItem,
    ScheduleRun,
    WorkOrder,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DAY_NAME_MAP: Dict[str, int] = {
    "Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6, "Sun": 7,
    "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4,
    "Friday": 5, "Saturday": 6, "Sunday": 7,
}
DEFAULT_SHIFT_DAYS = [1, 2, 3, 4, 5]   # Mon–Fri
DEFAULT_SHIFT_START = "08:00"
DEFAULT_SHIFT_END = "18:00"
MAX_LOOKAHEAD_DAYS = 30


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_shift_days(shift_days_str: str | None) -> List[int]:
    """Parse '1,2,3,4,5' or 'Mon,Tue,Wed,Thu,Fri' into ISO weekday ints."""
    if not shift_days_str:
        return list(DEFAULT_SHIFT_DAYS)
    days: List[int] = []
    for token in shift_days_str.split(","):
        token = token.strip()
        if token in DAY_NAME_MAP:
            days.append(DAY_NAME_MAP[token])
        else:
            try:
                days.append(int(token))
            except ValueError:
                logger.warning("Ignoring unrecognised shift day token: %r", token)
    return days if days else list(DEFAULT_SHIFT_DAYS)


def parse_time(t: str | None, default: str = "00:00") -> tuple[int, int]:
    """Parse 'HH:MM' → (hour, minute).  Raises ValueError on bad input."""
    raw = t or default
    parts = raw.split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid time string: {raw!r}  (expected HH:MM)")
    return int(parts[0]), int(parts[1])


def shift_minutes(machine: Machine) -> int:
    """Return shift duration in minutes for one working day."""
    sh, sm = parse_time(machine.shift_start, DEFAULT_SHIFT_START)
    eh, em = parse_time(machine.shift_end, DEFAULT_SHIFT_END)
    return max(0, (eh * 60 + em) - (sh * 60 + sm))


def next_shift_start(machine: Machine, after: datetime) -> datetime:
    """
    Return the earliest moment >= `after` that falls inside a valid shift
    window for `machine`.  Raises RuntimeError if no slot is found within
    MAX_LOOKAHEAD_DAYS.
    """
    shift_days = parse_shift_days(machine.shift_days)
    sh, sm = parse_time(machine.shift_start, DEFAULT_SHIFT_START)
    eh, em = parse_time(machine.shift_end, DEFAULT_SHIFT_END)

    candidate = after
    for _ in range(MAX_LOOKAHEAD_DAYS):
        iso_day = candidate.isoweekday()     # Mon=1 … Sun=7
        if iso_day in shift_days:
            shift_open = candidate.replace(hour=sh, minute=sm, second=0, microsecond=0)
            shift_close = candidate.replace(hour=eh, minute=em, second=0, microsecond=0)
            if candidate <= shift_open:
                return shift_open
            if candidate < shift_close:
                return candidate             # mid-shift: use as-is
        # Advance to start of next day
        candidate = (candidate + timedelta(days=1)).replace(
            hour=sh, minute=sm, second=0, microsecond=0
        )

    raise RuntimeError(
        f"No valid shift found for machine {machine.code!r} "
        f"within {MAX_LOOKAHEAD_DAYS} days of {after.isoformat()}"
    )


def slot_fits_in_shift(machine: Machine, start: datetime, duration_minutes: int) -> bool:
    """Return True iff [start, start+duration] fits inside the current shift."""
    eh, em = parse_time(machine.shift_end, DEFAULT_SHIFT_END)
    shift_close = start.replace(hour=eh, minute=em, second=0, microsecond=0)
    return (start + timedelta(minutes=duration_minutes)) <= shift_close


def schedule_slot(machine: Machine, earliest: datetime, duration_minutes: int) -> datetime:
    """
    Return the first valid shift start >= `earliest` where `duration_minutes`
    fits entirely within a single shift window.
    """
    start = next_shift_start(machine, earliest)
    # Advance to the next shift day if the operation doesn't fit today
    guard = 0
    while not slot_fits_in_shift(machine, start, duration_minutes):
        guard += 1
        if guard > MAX_LOOKAHEAD_DAYS:
            raise RuntimeError(
                f"Cannot fit {duration_minutes}-min op on machine {machine.code!r} "
                "within the lookahead window – check shift durations."
            )
        next_day = (start + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        start = next_shift_start(machine, next_day)
    return start


# ---------------------------------------------------------------------------
# Sorting strategies
# ---------------------------------------------------------------------------

_FAR_FUTURE = datetime(2099, 1, 1)


def _sort_key_edd(wo: WorkOrder):
    return (wo.priority, wo.due_date or _FAR_FUTURE)


def _sort_key_spt(wo: WorkOrder):
    total = sum(op.processing_minutes + (op.setup_minutes or 0) for op in wo.operations)
    return (wo.priority, total)


def _sort_key_fifo(wo: WorkOrder):
    return (wo.priority, wo.created_at or _FAR_FUTURE)


def _sort_key_cr(wo: WorkOrder, now: datetime):
    if not wo.due_date:
        return (wo.priority, float("inf"))
    remaining_time = max(1.0, (wo.due_date - now).total_seconds() / 60.0)
    remaining_work = max(1.0, sum(
        op.processing_minutes + (op.setup_minutes or 0) for op in wo.operations
    ))
    return (wo.priority, remaining_time / remaining_work)  # lower CR = more urgent


def sort_work_orders(work_orders: List[WorkOrder], algorithm: str, now: datetime) -> List[WorkOrder]:
    alg = algorithm.upper()
    if alg == "SPT":
        return sorted(work_orders, key=_sort_key_spt)
    if alg == "FIFO":
        return sorted(work_orders, key=_sort_key_fifo)
    if alg == "CR":
        return sorted(work_orders, key=lambda wo: _sort_key_cr(wo, now))
    # Default: EDD
    return sorted(work_orders, key=_sort_key_edd)


# ---------------------------------------------------------------------------
# Core engine
# ---------------------------------------------------------------------------

def compute_schedule(
    db: Session,
    label: str = "auto",
    algorithm: str = "EDD",
) -> ScheduleRun:
    """
    Compute a new schedule and persist it as a ScheduleRun + ScheduleItems.

    Returns the committed ScheduleRun instance.
    """
    now = datetime.utcnow()

    machines: List[Machine] = (
        db.query(Machine)
        .filter(Machine.status.in_([MachineStatus.available, MachineStatus.busy]))
        .all()
    )
    machine_map: Dict[int, Machine] = {m.id: m for m in machines}

    work_orders: List[WorkOrder] = (
        db.query(WorkOrder)
        .filter(WorkOrder.status.in_(["pending", "in_progress"]))
        .all()
    )

    # Per-machine free-at tracker – machines might already have work in progress
    machine_free_at: Dict[int, datetime] = {m.id: now for m in machines}

    sorted_wo = sort_work_orders(work_orders, algorithm, now)

    run = ScheduleRun(label=label, algorithm=algorithm)
    db.add(run)
    db.flush()  # populate run.id before creating items

    items: List[ScheduleItem] = []
    on_time_count = late_count = total_delay = total_busy_minutes = 0
    all_start_times: List[datetime] = []
    all_end_times: List[datetime] = []
    conflicts: List[str] = []

    for wo in sorted_wo:
        # Operations must be executed in sequence
        ops = sorted(wo.operations, key=lambda op: op.sequence_no)
        wo_avail = now  # earliest the first op of this WO can start

        for op in ops:
            machine = machine_map.get(op.machine_id)
            if machine is None:
                logger.warning(
                    "Operation %d references unknown machine %d – skipped.",
                    op.id,
                    op.machine_id,
                )
                continue

            setup = op.setup_minutes if op.setup_minutes is not None else (machine.default_setup_minutes or 0)
            duration = setup + op.processing_minutes

            earliest = max(machine_free_at[machine.id], wo_avail)

            try:
                start = schedule_slot(machine, earliest, duration)
            except RuntimeError as exc:
                logger.error("Could not schedule op %d: %s", op.id, exc)
                continue

            end = start + timedelta(minutes=duration)

            is_late = bool(wo.due_date and end > wo.due_date)
            delay = (
                max(0, int((end - wo.due_date).total_seconds() / 60))
                if wo.due_date
                else 0
            )

            # Conflict detection: does this slot overlap with any already-placed
            # item on the same machine for this run?
            is_conflict = False
            conflict_with: int | None = None
            for existing in items:
                if existing.machine_id == machine.id:
                    if start < existing.end_time and end > existing.start_time:
                        is_conflict = True
                        conflict_with = existing.id
                        conflicts.append(
                            f"op {op.id} vs item {existing.id} on {machine.code}"
                        )
                        break

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
                conflict_with_item_id=conflict_with,
            )
            db.add(item)
            items.append(item)

            # Advance trackers
            machine_free_at[machine.id] = end
            wo_avail = end  # next op in this WO cannot start before this one ends

            total_busy_minutes += duration
            all_start_times.append(start)
            all_end_times.append(end)

            if is_late:
                late_count += 1
                total_delay += delay
            else:
                on_time_count += 1

    # -----------------------------------------------------------------------
    # KPI calculation
    # -----------------------------------------------------------------------

    # Makespan: wall-clock span of the entire schedule
    makespan = 0
    if all_start_times and all_end_times:
        horizon_start = min(all_start_times)
        horizon_end = max(all_end_times)
        makespan = max(0, int((horizon_end - horizon_start).total_seconds() / 60))

    # Utilisation: busy minutes / available capacity across the horizon
    # Available capacity = sum of shift minutes per machine over the horizon days.
    total_cap_minutes = 0
    if all_start_times and all_end_times:
        horizon_days = max(1, (horizon_end.date() - horizon_start.date()).days + 1)
        for m in machines:
            working_days = sum(
                1 for d in range(horizon_days)
                if ((horizon_start + timedelta(days=d)).isoweekday()
                    in parse_shift_days(m.shift_days))
            )
            total_cap_minutes += working_days * shift_minutes(m)

    utilisation_pct = (
        min(100.0, round((total_busy_minutes / total_cap_minutes) * 100, 1))
        if total_cap_minutes > 0
        else 0.0
    )

    # Populate run KPIs
    run.total_operations = len(items)
    run.on_time_count = on_time_count
    run.late_count = late_count
    run.total_delay_minutes = total_delay
    run.makespan_minutes = makespan
    run.machine_utilization_pct = utilisation_pct
    run.has_conflicts = bool(conflicts)
    run.conflict_details = "; ".join(conflicts[:20])  # cap to avoid DB overflow

    db.commit()
    db.refresh(run)
    logger.info(
        "ScheduleRun %d: %d ops, %d late, util=%.1f%%, makespan=%d min",
        run.id, len(items), late_count, utilisation_pct, makespan,
    )
    return run


def get_schedule_summary(db: Session) -> Dict[str, Any]:
    """Return a lightweight summary dict used by chat tools and the API."""
    machines = db.query(Machine).all()
    work_orders = db.query(WorkOrder).all()
    latest = (
        db.query(ScheduleRun)
        .order_by(ScheduleRun.created_at.desc())
        .first()
    )
    return {
        "machine_count": len(machines),
        "work_order_count": len(work_orders),
        "utilization": latest.machine_utilization_pct if latest else 0.0,
        "makespan_minutes": latest.makespan_minutes if latest else 0,
        "on_time_count": latest.on_time_count if latest else 0,
        "late_count": latest.late_count if latest else 0,
        "has_conflicts": latest.has_conflicts if latest else False,
        "active_machines": sum(
            1 for m in machines
            if m.status in (MachineStatus.available, MachineStatus.busy)
        ),
    }
