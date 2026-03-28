"""
chat_tools.py — AI-callable tool layer for the scheduler assistant.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict

from sqlalchemy.orm import Session

from app.models.models import Machine, MachineStatus, Operation, ScheduleItem, ScheduleRun, WorkOrder
from app.services.scheduler import compute_schedule, get_schedule_summary

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def _create_machine(db: Session, code: str, name: str, **_) -> str:
    if db.query(Machine).filter(Machine.code == code).first():
        return f"Machine with code '{code}' already exists."
    try:
        machine = Machine(code=code, name=name, status=MachineStatus.available)
        db.add(machine)
        db.commit()
        return f"Successfully added machine '{name}' (code: {code})."
    except Exception as exc:
        db.rollback()
        return f"Error creating machine: {exc}"


def _list_machines(db: Session, **_) -> str:
    machines = db.query(Machine).order_by(Machine.code).all()
    if not machines:
        return "No machines registered yet."
    lines = ["**Machines:**"]
    for m in machines:
        status = m.status.value if hasattr(m.status, "value") else str(m.status)
        shift_info = f"shift {m.shift_start or '08:00'}–{m.shift_end or '18:00'}"
        maint = f" | ⚠️ {m.maintenance_notes}" if status == "maintenance" and m.maintenance_notes else ""
        lines.append(f"- {m.name} ({m.code}) | {status} | {shift_info}{maint}")
    return "\n".join(lines)


def _list_work_orders(db: Session, status_filter: str = "all", **_) -> str:
    q = db.query(WorkOrder)
    if status_filter and status_filter != "all":
        q = q.filter(WorkOrder.status == status_filter)
    wos = q.order_by(WorkOrder.priority, WorkOrder.due_date).all()
    if not wos:
        return f"No work orders found (filter: {status_filter})."
    priority_label = {1: "Critical", 2: "High", 3: "Medium", 4: "Low"}
    lines = [f"**Work Orders (filter: {status_filter}):**"]
    for wo in wos:
        due = wo.due_date.date() if wo.due_date else "no due date"
        pri = priority_label.get(wo.priority, str(wo.priority))
        op_count = len(wo.operations)
        lines.append(
            f"- {wo.code} | {wo.status.value if hasattr(wo.status, 'value') else wo.status} "
            f"| Priority: {pri} | Due: {due} | Ops: {op_count}"
        )
    return "\n".join(lines)


def _create_work_order(
    db: Session, code: str, customer_name: str = None,
    priority: int = 3, due_date_days_from_now: int = 7, **_,
) -> str:
    if db.query(WorkOrder).filter(WorkOrder.code == code).first():
        return f"Work order '{code}' already exists."
    if not 1 <= priority <= 4:
        return "Priority must be 1 (Critical), 2 (High), 3 (Medium), or 4 (Low)."
    try:
        due_date = datetime.utcnow() + timedelta(days=due_date_days_from_now)
        wo = WorkOrder(code=code, customer_name=customer_name, priority=priority, due_date=due_date, status="pending")
        db.add(wo)
        db.commit()
        return f"Created work order {code} for {customer_name or 'unnamed customer'} (priority: {priority}, due: {due_date.date()})."
    except Exception as exc:
        db.rollback()
        return f"Error creating work order: {exc}"


def _add_operation(
    db: Session, work_order_code: str, machine_code: str,
    processing_minutes: int, setup_minutes: int = None, **_,
) -> str:
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return f"Work order '{work_order_code}' not found."
    machine = db.query(Machine).filter(Machine.code == machine_code).first()
    if not machine:
        return f"Machine '{machine_code}' not found."
    try:
        last_op = db.query(Operation).filter(Operation.work_order_id == wo.id).order_by(Operation.sequence_no.desc()).first()
        seq = (last_op.sequence_no + 1) if last_op else 1
        op = Operation(work_order_id=wo.id, machine_id=machine.id, sequence_no=seq,
                       processing_minutes=processing_minutes, setup_minutes=setup_minutes)
        db.add(op)
        db.commit()
        return f"Added operation (step {seq}) to {work_order_code}: {processing_minutes} min on {machine_code}."
    except Exception as exc:
        db.rollback()
        return f"Error adding operation: {exc}"


def _update_work_order_deadline(db: Session, work_order_code: str, new_due_date: str, **_) -> str:
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return f"Work order '{work_order_code}' not found."
    try:
        wo.due_date = datetime.fromisoformat(new_due_date)
        db.commit()
        return f"Due date of {work_order_code} updated to {new_due_date}."
    except ValueError:
        return f"Invalid date format: {new_due_date!r}. Use ISO format e.g. '2026-04-10T17:00:00'."
    except Exception as exc:
        db.rollback()
        return f"Error updating deadline: {exc}"


def _change_work_order_priority(db: Session, work_order_code: str, priority: int, **_) -> str:
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return f"Work order '{work_order_code}' not found."
    if not 1 <= priority <= 4:
        return "Priority must be between 1 (Critical) and 4 (Low)."
    try:
        old = wo.priority
        wo.priority = priority
        db.commit()
        priority_label = {1: "Critical", 2: "High", 3: "Medium", 4: "Low"}
        return f"Priority of {work_order_code} changed from {priority_label.get(old, old)} to {priority_label.get(priority, priority)}."
    except Exception as exc:
        db.rollback()
        return f"Error changing priority: {exc}"


def _shift_work_order(db: Session, work_order_code: str, days: int, direction: str = "prepone", **_) -> str:
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return f"Work order '{work_order_code}' not found."
    if not wo.due_date:
        return f"Work order '{work_order_code}' has no due date set."
    if direction not in ("prepone", "postpone"):
        return "direction must be 'prepone' or 'postpone'."
    if days <= 0:
        return "days must be a positive integer."
    try:
        delta = timedelta(days=days)
        wo.due_date = wo.due_date - delta if direction == "prepone" else wo.due_date + delta
        db.flush()
        run = compute_schedule(db, label=f"{direction}-{work_order_code}")
        late_count = db.query(ScheduleItem).filter(
            ScheduleItem.schedule_run_id == run.id, ScheduleItem.is_late.is_(True)
        ).count()
        return (
            f"{direction.capitalize()}d {work_order_code} by {days} day(s). "
            f"New due date: {wo.due_date.date()}. "
            f"Schedule impact: {late_count}/{run.total_operations} operations now late, "
            f"utilization: {run.machine_utilization_pct}%."
        )
    except Exception as exc:
        db.rollback()
        return f"Error shifting work order: {exc}"


def _recompute_schedule(db: Session, algorithm: str = "EDD", **_) -> str:
    try:
        run = compute_schedule(db, label="ai-triggered", algorithm=algorithm)
        summary = get_schedule_summary(db)
        return (
            f"Schedule recomputed (Run #{run.id}, algorithm: {algorithm}). "
            f"Machines: {summary['machine_count']}, Work orders: {summary['work_order_count']} "
            f"({summary['pending_count']} pending), Utilization: {summary['utilization']}%, "
            f"On-time: {run.on_time_count}, Late: {run.late_count}, "
            f"Conflicts: {'yes' if run.has_conflicts else 'none'}."
        )
    except Exception as exc:
        return f"Error recomputing schedule: {exc}"


def _get_schedule_summary(db: Session, **_) -> str:
    run: ScheduleRun | None = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    if not run:
        return "No schedule has been computed yet. Ask me to recompute the schedule."
    summary = get_schedule_summary(db)
    return (
        f"**Latest Schedule (Run #{run.id}, {run.algorithm})** \u2014 "
        f"{run.total_operations} operations | {run.on_time_count} on-time | {run.late_count} late | "
        f"Total delay: {run.total_delay_minutes} min | Utilization: {run.machine_utilization_pct}% | "
        f"Makespan: {getattr(run, 'makespan_minutes', 0)} min | "
        f"Conflicts: {'detected' if run.has_conflicts else 'none'} | "
        f"Machines: {summary['machine_count']} | Work orders: {summary['work_order_count']}"
    )


def _set_maintenance_window(
    db: Session,
    machine_code: str,
    start_date: str,
    end_date: str,
    notes: str = "",
    **_,
) -> str:
    machine = db.query(Machine).filter(Machine.code == machine_code).first()
    if not machine:
        return f"Machine '{machine_code}' not found."
    try:
        datetime.fromisoformat(start_date)
        datetime.fromisoformat(end_date)
    except ValueError:
        return f"Invalid date format. Use ISO format e.g. '2026-04-10T08:00:00'."
    try:
        machine.status = MachineStatus.maintenance
        machine.maintenance_notes = notes or f"Scheduled maintenance {start_date[:10]} to {end_date[:10]}"
        db.commit()
        # Recompute schedule so maintenance is reflected
        run = compute_schedule(db, label=f"post-maintenance-{machine_code}")
        return (
            f"Machine {machine.name} ({machine_code}) set to maintenance from {start_date[:10]} to {end_date[:10]}. "
            f"Notes: '{machine.maintenance_notes}'. "
            f"Schedule recomputed: {run.total_operations} ops, "
            f"utilization now {run.machine_utilization_pct}%."
        )
    except Exception as exc:
        db.rollback()
        return f"Error setting maintenance: {exc}"


def _clear_maintenance(db: Session, machine_code: str, **_) -> str:
    machine = db.query(Machine).filter(Machine.code == machine_code).first()
    if not machine:
        return f"Machine '{machine_code}' not found."
    try:
        machine.status = MachineStatus.available
        machine.maintenance_notes = ""
        db.commit()
        run = compute_schedule(db, label=f"post-clear-maintenance-{machine_code}")
        return (
            f"Machine {machine.name} ({machine_code}) is now available. "
            f"Schedule recomputed: utilization {run.machine_utilization_pct}%."
        )
    except Exception as exc:
        db.rollback()
        return f"Error clearing maintenance: {exc}"


# ---------------------------------------------------------------------------
# Tool registry & dispatcher
# ---------------------------------------------------------------------------

TOOL_REGISTRY: Dict[str, Any] = {
    "create_machine": _create_machine,
    "list_machines": _list_machines,
    "list_work_orders": _list_work_orders,
    "create_work_order": _create_work_order,
    "add_operation": _add_operation,
    "update_work_order_deadline": _update_work_order_deadline,
    "change_work_order_priority": _change_work_order_priority,
    "shift_work_order": _shift_work_order,
    "recompute_schedule": _recompute_schedule,
    "get_schedule_summary": _get_schedule_summary,
    "set_maintenance_window": _set_maintenance_window,
    "clear_maintenance": _clear_maintenance,
}


def dispatch_tool(db: Session, tool_name: str, arguments: Dict[str, Any]) -> str:
    fn = TOOL_REGISTRY.get(tool_name)
    if fn is None:
        return f"Unknown tool: {tool_name!r}. Available: {list(TOOL_REGISTRY)}"
    if not isinstance(arguments, dict):
        arguments = {}
    return fn(db=db, **arguments)


# ---------------------------------------------------------------------------
# OpenAI-compatible tool schemas
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_machine",
            "description": "Register a new machine in the factory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Short unique code, e.g. CNC-01"},
                    "name": {"type": "string", "description": "Human-readable machine name"},
                },
                "required": ["code", "name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_machines",
            "description": "List all registered machines with their status and shift info.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_work_orders",
            "description": "List work orders, optionally filtered by status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status_filter": {
                        "type": "string",
                        "enum": ["all", "pending", "in_progress", "completed"],
                        "description": "Filter by status (default: all)",
                        "default": "all",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_work_order",
            "description": "Create a new production work order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string"},
                    "customer_name": {"type": "string"},
                    "priority": {"type": "integer", "description": "1=Critical 2=High 3=Medium 4=Low", "default": 3},
                    "due_date_days_from_now": {"type": "integer", "default": 7},
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_operation",
            "description": "Append a processing step to a work order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "machine_code": {"type": "string"},
                    "processing_minutes": {"type": "integer"},
                    "setup_minutes": {"type": "integer"},
                },
                "required": ["work_order_code", "machine_code", "processing_minutes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_work_order_deadline",
            "description": "Change the due date of a work order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "new_due_date": {"type": "string", "description": "ISO datetime e.g. '2026-04-10T17:00:00'"},
                },
                "required": ["work_order_code", "new_due_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "change_work_order_priority",
            "description": "Set the urgency level of a work order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "priority": {"type": "integer", "description": "1=Critical 2=High 3=Medium 4=Low"},
                },
                "required": ["work_order_code", "priority"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "shift_work_order",
            "description": "Move a work order due date earlier or later by N days and recompute schedule.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "days": {"type": "integer"},
                    "direction": {"type": "string", "enum": ["prepone", "postpone"], "default": "prepone"},
                },
                "required": ["work_order_code", "days"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recompute_schedule",
            "description": "Recalculate the full production schedule.",
            "parameters": {
                "type": "object",
                "properties": {
                    "algorithm": {"type": "string", "enum": ["EDD", "SPT", "FIFO", "CRITICAL_RATIO"], "default": "EDD"}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_schedule_summary",
            "description": "Return KPI summary of the most recently computed schedule.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_maintenance_window",
            "description": "Put a machine into maintenance mode for a scheduled window. The scheduler will exclude this machine during maintenance. Always recomputes schedule after.",
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_code": {"type": "string", "description": "Exact machine code e.g. CNC-01"},
                    "start_date": {"type": "string", "description": "ISO datetime when maintenance starts e.g. '2026-04-01T08:00:00'"},
                    "end_date": {"type": "string", "description": "ISO datetime when maintenance ends e.g. '2026-04-02T18:00:00'"},
                    "notes": {"type": "string", "description": "Reason for maintenance e.g. 'Oil change and calibration'"},
                },
                "required": ["machine_code", "start_date", "end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clear_maintenance",
            "description": "Mark a machine as available again after maintenance is done and recompute schedule.",
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_code": {"type": "string"},
                },
                "required": ["machine_code"],
            },
        },
    },
]
