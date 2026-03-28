"""
scheduler.py — Production-grade job scheduling engine.

Algorithms supported:
  EDD  – Earliest Due Date (default)
  SPT  – Shortest Processing Time
  FIFO – First In, First Out (by creation date)
  CRITICAL_RATIO – (due_date - now) / remaining_processing_time

Key design principles:
  - Operations within a work order are scheduled strictly in sequence_no order.
  - machine_free_at tracks per-machine availability across ALL work orders.
  - wo_earliest tracks the earliest a WO's NEXT operation can start (predecessor end).
  - All datetimes are timezone-naive UTC throughout; convert at API boundary only.
  - Shift capacity is computed over the actual schedule window (not a single day).
  - Every public function is wrapped in a try/except that rolls back on failure.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

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

DEFAULT_SHIFT_START = "08:00"
DEFAULT_SHIFT_END = "18:00"
DEFAULT_SHIFT_DAYS = "1,2,3,4,5"  # Mon–Fri
DEFAULT_SETUP_MINUTES = 15
SCHEDULE_HORIZON_DAYS = 60  # max look-ahead when finding shift slots


# ---------------------------------------------------------------------------
# Shift helpers
# ---------------------------------------------------------------------------

def _parse_hhmm(t: str) -> Tuple[int, int]:
    """Parse 'HH:MM' → (hour, minute). Raises ValueError on bad input."""
    parts = t.strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid time string: {t!r}")
    return int(parts[0]), int(parts[1])


def _parse_shift_days(shift_days_str: str) -> List[int]:
    """
    Parse shift_days which may be '1,2,3,4,5' or 'Mon,Tue,Wed,Thu,Fri'.
    Returns a sorted list of ISO weekday numbers (1=Mon … 7=Sun).
    Falls back to Mon–Fri on empty/invalid input.
    """
    days: List[int] = []
    for token in shift_days_str.split(","):
        token = token.strip()
        if token in DAY_NAME_MAP:
            days.append(DAY_NAME_MAP[token])
        else:
            try:
                days.append(int(token))
            except ValueError:
                logger.warning("Unrecognised shift day token: %r", token)
    return sorted(set(days)) if days else [1, 2, 3, 4, 5]


def _shift_bounds(machine: Machine, on_date: datetime) -> Tuple[datetime, datetime]:
    """Return (shift_open, shift_close) for *machine* on the date of *on_date*."""
    sh, sm = _parse_hhmm(machine.shift_start or DEFAULT_SHIFT_START)
    eh, em = _parse_hhmm(machine.shift_end or DEFAULT_SHIFT_END)
    shift_open = on_date.replace(hour=sh, minute=sm, second=0, microsecond=0)
    shift_close = on_date.replace(hour=eh, minute=em, second=0, microsecond=0)
    return shift_open, shift_close


def _next_shift_start(machine: Machine, after: datetime) -> datetime:
    """
    Find the earliest datetime >= *after* that falls inside a scheduled shift
    for *machine*.  Searches up to SCHEDULE_HORIZON_DAYS days ahead.
    """
    shift_days = _parse_shift_days(machine.shift_days or DEFAULT_SHIFT_DAYS)
    candidate = after
    for _ in range(SCHEDULE_HORIZON_DAYS):
        if candidate.isoweekday() in shift_days:
            shift_open, shift_close = _shift_bounds(machine, candidate)
            if candidate <= shift_open:
                return shift_open
            if candidate < shift_close:
                return candidate  # already inside the shift
        # Advance to start of next day
        candidate = (candidate + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    raise RuntimeError(
        f"No shift slot found within {SCHEDULE_HORIZON_DAYS} days for machine {machine.code}"
    )


def _find_slot(
    machine: Machine, earliest: datetime, duration_minutes: int
) -> datetime:
    """
    Return the earliest start time >= *earliest* where *duration_minutes*
    fits entirely within one shift of *machine*.  Rolls over to the next
    shift when the operation would straddle a shift boundary.
    """
    start = _next_shift_start(machine, earliest)
    for _ in range(SCHEDULE_HORIZON_DAYS):
        _, shift_close = _shift_bounds(machine, start)
        if start + timedelta(minutes=duration_minutes) <= shift_close:
            return start
        # Does not fit — advance to beginning of next shift
        next_day = (start + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        start = _next_shift_start(machine, next_day)
    raise RuntimeError(
        f"Cannot fit {duration_minutes}-min operation on machine {machine.code} "
        f"within {SCHEDULE_HORIZON_DAYS} days"
    )


# ---------------------------------------------------------------------------
# Sorting / priority keys
# ---------------------------------------------------------------------------

_FAR_FUTURE = datetime(2099, 1, 1)


def _sort_key_edd(wo: WorkOrder):
    return (wo.priority, wo.due_date or _FAR_FUTURE)


def _sort_key_spt(wo: WorkOrder):
    total_minutes = sum(op.processing_minutes for op in wo.operations)
    return (wo.priority, total_minutes)


def _sort_key_fifo(wo: WorkOrder):
    return (wo.priority, wo.created_at or _FAR_FUTURE)


def _sort_key_cr(wo: WorkOrder):
    """Critical Ratio = slack / remaining work.  Lower CR → more urgent."""
    now = datetime.utcnow()
    remaining = max(1, sum(op.processing_minutes for op in wo.operations))
    if wo.due_date:
        slack = (wo.due_date - now).total_seconds() / 60
        return (wo.priority, slack / remaining)
    return (wo.priority, float("inf"))


_SORT_KEYS = {
    "EDD": _sort_key_edd,
    "SPT": _sort_key_spt,
    "FIFO": _sort_key_fifo,
    "CRITICAL_RATIO": _sort_key_cr,
}


# ---------------------------------------------------------------------------
# Main scheduling engine
# ---------------------------------------------------------------------------

def compute_schedule(
    db: Session,
    label: str = "auto",
    algorithm: str = "EDD",
) -> ScheduleRun:
    """
    Build a full schedule for all pending/in-progress work orders and
    persist it as a new ScheduleRun with associated ScheduleItems.

    Args:
        db:        Active SQLAlchemy session.
        label:     Human-readable label for this schedule run.
        algorithm: Sorting algorithm key (EDD | SPT | FIFO | CRITICAL_RATIO).

    Returns:
        The committed ScheduleRun ORM object.

    Raises:
        ValueError: If an unknown algorithm is requested.
        RuntimeError: If a slot cannot be found within the horizon.
    """
    if algorithm not in _SORT_KEYS:
        raise ValueError(
            f"Unknown algorithm {algorithm!r}. Choose from {list(_SORT_KEYS)}"
        )

    try:
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

        # Eagerly determine when each machine is next free (starts from now)
        now = datetime.utcnow()
        machine_free_at: Dict[int, datetime] = {m.id: now for m in machines}

        sort_fn = _SORT_KEYS[algorithm]
        sorted_wos = sorted(work_orders, key=sort_fn)

        run = ScheduleRun(label=label, algorithm=algorithm)
        db.add(run)
        db.flush()  # obtain run.id without committing

        items: List[ScheduleItem] = []
        total_busy_minutes = 0
        late_count = 0
        on_time_count = 0
        total_delay = 0
        earliest_start: Optional[datetime] = None
        latest_end: Optional[datetime] = None

        for wo in sorted_wos:
            # Operations MUST be executed in sequence_no order
            ordered_ops: List[Operation] = sorted(
                wo.operations, key=lambda op: op.sequence_no
            )

            # Tracks the earliest the *next* operation of this WO can start
            # (i.e., the previous operation's end time — precedence constraint)
            wo_predecessor_end: Optional[datetime] = None

            for op in ordered_ops:
                machine = machine_map.get(op.machine_id)
                if machine is None:
                    logger.warning(
                        "Operation %d references unknown machine %d — skipped",
                        op.id,
                        op.machine_id,
                    )
                    continue

                setup = op.setup_minutes if op.setup_minutes is not None else (
                    machine.default_setup_minutes or DEFAULT_SETUP_MINUTES
                )
                duration = setup + op.processing_minutes

                # Earliest start must satisfy BOTH constraints:
                #   1. Machine is free
                #   2. Predecessor operation is complete
                earliest = machine_free_at[machine.id]
                if wo_predecessor_end is not None:
                    earliest = max(earliest, wo_predecessor_end)

                start = _find_slot(machine, earliest, duration)
                end = start + timedelta(minutes=duration)

                delay = 0
                is_late = False
                if wo.due_date:
                    is_late = end > wo.due_date
                    delay = max(
                        0, int((end - wo.due_date).total_seconds() / 60)
                    )

                item = ScheduleItem(
                    schedule_run_id=run.id,
                    work_order_id=wo.id,
                    operation_id=op.id,
                    machine_id=machine.id,
                    start_time=start,
                    end_time=end,
                    delay_minutes=delay,
                    is_late=is_late,
                    is_conflict=False,
                )
                db.add(item)
                items.append(item)

                # Update tracking state
                machine_free_at[machine.id] = end
                wo_predecessor_end = end
                total_busy_minutes += duration

                if is_late:
                    late_count += 1
                    total_delay += delay
                else:
                    on_time_count += 1

                if earliest_start is None or start < earliest_start:
                    earliest_start = start
                if latest_end is None or end > latest_end:
                    latest_end = end

        # ------------------------------------------------------------------
        # Utilization: busy_minutes / available_capacity over the actual
        # schedule window (earliest_start → latest_end), not a single day.
        # ------------------------------------------------------------------
        total_cap_minutes = _compute_capacity(
            machines,
            earliest_start or now,
            latest_end or now,
        )

        run.total_operations = len(items)
        run.on_time_count = on_time_count
        run.late_count = late_count
        run.total_delay_minutes = total_delay
        run.machine_utilization_pct = (
            min(100.0, round((total_busy_minutes / total_cap_minutes) * 100, 1))
            if total_cap_minutes > 0
            else 0.0
        )

        db.commit()
        db.refresh(run)
        logger.info(
            "Schedule run %d committed: %d ops, util=%.1f%%",
            run.id,
            len(items),
            run.machine_utilization_pct,
        )
        return run

    except Exception:
        db.rollback()
        logger.exception("compute_schedule failed — rolled back")
        raise


def _compute_capacity(
    machines: List[Machine],
    window_start: datetime,
    window_end: datetime,
) -> int:
    """
    Sum the available shift minutes across all machines between
    *window_start* and *window_end*.
    """
    total = 0
    current = window_start.replace(hour=0, minute=0, second=0, microsecond=0)
    end_date = window_end.replace(hour=23, minute=59, second=59, microsecond=0)

    while current <= end_date:
        for machine in machines:
            shift_days = _parse_shift_days(
                machine.shift_days or DEFAULT_SHIFT_DAYS
            )
            if current.isoweekday() not in shift_days:
                continue
            try:
                shift_open, shift_close = _shift_bounds(machine, current)
            except ValueError:
                continue
            # Clip to the actual window boundaries
            effective_open = max(shift_open, window_start)
            effective_close = min(shift_close, window_end)
            if effective_close > effective_open:
                total += int(
                    (effective_close - effective_open).total_seconds() / 60
                )
        current += timedelta(days=1)
    return total


# ---------------------------------------------------------------------------
# Summary helpers
# ---------------------------------------------------------------------------

def get_schedule_summary(db: Session) -> dict:
    """Return a lightweight dict summary of the system state."""
    try:
        machines = db.query(Machine).all()
        work_orders = db.query(WorkOrder).all()
        latest: Optional[ScheduleRun] = (
            db.query(ScheduleRun)
            .order_by(ScheduleRun.created_at.desc())
            .first()
        )
        return {
            "machine_count": len(machines),
            "work_order_count": len(work_orders),
            "pending_count": sum(
                1 for wo in work_orders if wo.status in ("pending", "in_progress")
            ),
            "utilization": (
                latest.machine_utilization_pct if latest else 0.0
            ),
            "latest_run_id": latest.id if latest else None,
            "latest_algorithm": latest.algorithm if latest else None,
        }
    except Exception:
        logger.exception("get_schedule_summary failed")
        raise
