"""
scheduler.py — Production-grade job scheduling engine.

Algorithms supported:
  EDD            – Earliest Due Date (default)
  SPT            – Shortest Processing Time first
  FIFO           – First In First Out (by creation date)
  CRITICAL_RATIO – (slack_minutes / remaining_processing_minutes); lower = more urgent

Design principles:
  - Operations within a work order are scheduled in strict sequence_no order
    (precedence constraint).
  - machine_free_at tracks per-machine availability across ALL work orders.
  - wo_predecessor_end tracks the end of the last operation in the current WO
    (ensures no two ops of the same WO overlap).
  - Both constraints are enforced via max(machine_free_at, wo_predecessor_end).
  - Shift capacity is computed over the ACTUAL schedule window, not a single day.
  - Makespan is stored on the ScheduleRun for fast KPI queries.
  - Conflict detection: flags any ScheduleItem that overlaps with another item
    on the same machine within the same run.
  - All datetimes are timezone-naive UTC. Convert at the API boundary only.
  - Every public function rolls back on failure.
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
SCHEDULE_HORIZON_DAYS = 60


# ---------------------------------------------------------------------------
# Shift helpers
# ---------------------------------------------------------------------------

def _parse_hhmm(t: str) -> Tuple[int, int]:
    parts = t.strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid time string: {t!r}")
    return int(parts[0]), int(parts[1])


def _parse_shift_days(shift_days_str: str) -> List[int]:
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
    sh, sm = _parse_hhmm(machine.shift_start or DEFAULT_SHIFT_START)
    eh, em = _parse_hhmm(machine.shift_end or DEFAULT_SHIFT_END)
    return (
        on_date.replace(hour=sh, minute=sm, second=0, microsecond=0),
        on_date.replace(hour=eh, minute=em, second=0, microsecond=0),
    )


def _next_shift_start(machine: Machine, after: datetime) -> datetime:
    shift_days = _parse_shift_days(machine.shift_days or DEFAULT_SHIFT_DAYS)
    candidate = after
    for _ in range(SCHEDULE_HORIZON_DAYS):
        if candidate.isoweekday() in shift_days:
            shift_open, shift_close = _shift_bounds(machine, candidate)
            if candidate <= shift_open:
                return shift_open
            if candidate < shift_close:
                return candidate
        candidate = (candidate + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    raise RuntimeError(
        f"No shift slot found within {SCHEDULE_HORIZON_DAYS} days for machine {machine.code}"
    )


def _find_slot(machine: Machine, earliest: datetime, duration_minutes: int) -> datetime:
    """
    Find the earliest start >= *earliest* where *duration_minutes* fits
    entirely within one shift. Rolls to next shift when it would straddle.
    """
    start = _next_shift_start(machine, earliest)
    for _ in range(SCHEDULE_HORIZON_DAYS):
        _, shift_close = _shift_bounds(machine, start)
        if start + timedelta(minutes=duration_minutes) <= shift_close:
            return start
        next_day = (start + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        start = _next_shift_start(machine, next_day)
    raise RuntimeError(
        f"Cannot fit {duration_minutes}-min op on {machine.code} within {SCHEDULE_HORIZON_DAYS} days."
    )


# ---------------------------------------------------------------------------
# Sorting keys
# ---------------------------------------------------------------------------

_FAR_FUTURE = datetime(2099, 1, 1)


def _sort_key_edd(wo: WorkOrder):
    return (wo.priority, wo.due_date or _FAR_FUTURE)


def _sort_key_spt(wo: WorkOrder):
    return (wo.priority, sum(op.processing_minutes for op in wo.operations))


def _sort_key_fifo(wo: WorkOrder):
    return (wo.priority, wo.created_at or _FAR_FUTURE)


def _sort_key_cr(wo: WorkOrder):
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
# Main engine
# ---------------------------------------------------------------------------

def compute_schedule(
    db: Session,
    label: str = "auto",
    algorithm: str = "EDD",
) -> ScheduleRun:
    """
    Build a full schedule for all pending/in-progress work orders and
    persist it as a ScheduleRun with ScheduleItems.
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

        now = datetime.utcnow()
        machine_free_at: Dict[int, datetime] = {m.id: now for m in machines}

        sorted_wos = sorted(work_orders, key=_SORT_KEYS[algorithm])

        run = ScheduleRun(label=label, algorithm=algorithm)
        db.add(run)
        db.flush()

        items: List[ScheduleItem] = []
        total_busy_minutes = 0
        late_count = 0
        on_time_count = 0
        total_delay = 0
        earliest_start: Optional[datetime] = None
        latest_end: Optional[datetime] = None

        for wo in sorted_wos:
            ordered_ops: List[Operation] = sorted(
                wo.operations, key=lambda op: op.sequence_no
            )
            wo_predecessor_end: Optional[datetime] = None

            for op in ordered_ops:
                machine = machine_map.get(op.machine_id)
                if machine is None:
                    logger.warning(
                        "Op %d references unknown/offline machine %d — skipped",
                        op.id, op.machine_id,
                    )
                    continue

                setup = (
                    op.setup_minutes
                    if op.setup_minutes is not None
                    else (machine.default_setup_minutes or DEFAULT_SETUP_MINUTES)
                )
                duration = setup + op.processing_minutes

                earliest = machine_free_at[machine.id]
                if wo_predecessor_end is not None:
                    earliest = max(earliest, wo_predecessor_end)

                start = _find_slot(machine, earliest, duration)
                end = start + timedelta(minutes=duration)

                delay = 0
                is_late = False
                if wo.due_date:
                    is_late = end > wo.due_date
                    delay = max(0, int((end - wo.due_date).total_seconds() / 60))

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
        # Post-processing: conflict detection
        # Two items conflict when they share the same machine and their
        # time windows overlap within the same schedule run.
        # ------------------------------------------------------------------
        conflict_count = _detect_conflicts(items)

        # ------------------------------------------------------------------
        # Utilization over actual schedule window
        # ------------------------------------------------------------------
        total_cap_minutes = _compute_capacity(
            machines, earliest_start or now, latest_end or now
        )

        # Makespan in minutes
        makespan = (
            int((latest_end - earliest_start).total_seconds() / 60)
            if earliest_start and latest_end
            else 0
        )

        run.total_operations = len(items)
        run.on_time_count = on_time_count
        run.late_count = late_count
        run.total_delay_minutes = total_delay
        run.makespan_minutes = makespan
        run.has_conflicts = conflict_count > 0
        run.conflict_details = (
            f"{conflict_count} conflicting item(s) detected." if conflict_count else ""
        )
        run.machine_utilization_pct = (
            min(100.0, round((total_busy_minutes / total_cap_minutes) * 100, 1))
            if total_cap_minutes > 0
            else 0.0
        )

        db.commit()
        db.refresh(run)
        logger.info(
            "Schedule run %d committed: %d ops, util=%.1f%%, conflicts=%d",
            run.id, len(items), run.machine_utilization_pct, conflict_count,
        )
        return run

    except Exception:
        db.rollback()
        logger.exception("compute_schedule failed — rolled back")
        raise


def _detect_conflicts(items: List[ScheduleItem]) -> int:
    """
    For each machine, sort items by start time and flag any pair where
    item[i].end_time > item[i+1].start_time (overlap).
    Returns total number of conflicted items.
    """
    from collections import defaultdict

    by_machine: Dict[int, List[ScheduleItem]] = defaultdict(list)
    for item in items:
        by_machine[item.machine_id].append(item)

    conflict_count = 0
    for machine_items in by_machine.values():
        sorted_items = sorted(machine_items, key=lambda x: x.start_time)
        for i in range(len(sorted_items) - 1):
            a, b = sorted_items[i], sorted_items[i + 1]
            if a.end_time > b.start_time:  # overlap
                a.is_conflict = True
                b.is_conflict = True
                a.conflict_with_item_id = b.id  # ids are None pre-flush; best effort
                conflict_count += 2
    return conflict_count


def _compute_capacity(
    machines: List[Machine],
    window_start: datetime,
    window_end: datetime,
) -> int:
    """Sum available shift minutes across all machines over the schedule window."""
    total = 0
    current = window_start.replace(hour=0, minute=0, second=0, microsecond=0)
    end_date = window_end.replace(hour=23, minute=59, second=59)

    while current <= end_date:
        for machine in machines:
            shift_days = _parse_shift_days(machine.shift_days or DEFAULT_SHIFT_DAYS)
            if current.isoweekday() not in shift_days:
                continue
            try:
                shift_open, shift_close = _shift_bounds(machine, current)
            except ValueError:
                continue
            effective_open = max(shift_open, window_start)
            effective_close = min(shift_close, window_end)
            if effective_close > effective_open:
                total += int((effective_close - effective_open).total_seconds() / 60)
        current += timedelta(days=1)
    return total


# ---------------------------------------------------------------------------
# Summary helper
# ---------------------------------------------------------------------------

def get_schedule_summary(db: Session) -> dict:
    """Lightweight summary dict for the chat layer."""
    try:
        machines = db.query(Machine).all()
        work_orders = db.query(WorkOrder).all()
        latest: Optional[ScheduleRun] = (
            db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
        )
        return {
            "machine_count": len(machines),
            "work_order_count": len(work_orders),
            "pending_count": sum(
                1 for wo in work_orders if wo.status in ("pending", "in_progress")
            ),
            "utilization": latest.machine_utilization_pct if latest else 0.0,
            "latest_run_id": latest.id if latest else None,
            "latest_algorithm": latest.algorithm if latest else None,
            "has_conflicts": latest.has_conflicts if latest else False,
        }
    except Exception:
        logger.exception("get_schedule_summary failed")
        raise
