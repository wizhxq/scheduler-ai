"""
chat_tools.py  –  AI tool-callable actions for the scheduling assistant

Design principles
-----------------
* Each tool function is pure in intent: it receives a db session + typed
  kwargs, performs exactly one logical action, and returns a structured dict
  (not a raw string) so the caller can inspect success/failure programmatically.
* TOOLS is the canonical OpenAI-compatible function-call schema.
* TOOL_REGISTRY maps function names → callables; the dispatcher in chat.py
  no longer needs a brittle if/elif chain.
* All mutations are wrapped in try/except with explicit rollback so a failed
  tool call never leaves the DB in a partial state.
* datetime.utcnow() is used consistently (timezone-naive UTC throughout).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Callable, Dict

from sqlalchemy.orm import Session

from app.models.models import Machine, MachineStatus, Operation, ScheduleRun, ScheduleItem, WorkOrder
from app.services.scheduler import compute_schedule, get_schedule_summary

logger = logging.getLogger(__name__)

ToolResult = Dict[str, Any]  # {"ok": bool, "message": str, ...extra fields}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _ok(message: str, **extra) -> ToolResult:
    return {"ok": True, "message": message, **extra}


def _err(message: str, **extra) -> ToolResult:
    return {"ok": False, "message": message, **extra}


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def create_machine_tool(db: Session, code: str, name: str) -> ToolResult:
    """Add a new machine to the factory."""
    if db.query(Machine).filter(Machine.code == code).first():
        return _err(f"Machine with code '{code}' already exists.")
    try:
        machine = Machine(code=code, name=name, status=MachineStatus.available)
        db.add(machine)
        db.commit()
        logger.info("Created machine %r (%r)", code, name)
        return _ok(f"Added machine '{name}' (code: {code}).")
    except Exception as exc:
        db.rollback()
        logger.exception("create_machine_tool failed")
        return _err(f"Database error: {exc}")


def list_machines_tool(db: Session) -> ToolResult:
    """List all machines and their current status."""
    machines = db.query(Machine).order_by(Machine.code).all()
    if not machines:
        return _ok("No machines registered.", machines=[])
    rows = [
        {"code": m.code, "name": m.name, "status": m.status.value}
        for m in machines
    ]
    lines = "\n".join(f"- {r['name']} ({r['code']}): {r['status']}" for r in rows)
    return _ok(f"Machines ({len(rows)}):\n{lines}", machines=rows)


def create_work_order_tool(
    db: Session,
    code: str,
    customer_name: str | None = None,
    priority: int = 3,
    due_date_days_from_now: int = 7,
) -> ToolResult:
    """Create a new work order."""
    if not 1 <= priority <= 4:
        return _err("Priority must be 1 (Critical), 2 (High), 3 (Medium), or 4 (Low).")
    if db.query(WorkOrder).filter(WorkOrder.code == code).first():
        return _err(f"Work order '{code}' already exists.")
    try:
        due_date = datetime.utcnow() + timedelta(days=due_date_days_from_now)
        wo = WorkOrder(
            code=code,
            customer_name=customer_name,
            priority=priority,
            due_date=due_date,
            status="pending",
        )
        db.add(wo)
        db.commit()
        logger.info("Created work order %r", code)
        return _ok(
            f"Created work order {code} for {customer_name or 'unnamed'} "
            f"(priority: {priority}, due: {due_date.date()}).",
            work_order_code=code,
            due_date=due_date.isoformat(),
        )
    except Exception as exc:
        db.rollback()
        logger.exception("create_work_order_tool failed")
        return _err(f"Database error: {exc}")


def add_operation_tool(
    db: Session,
    work_order_code: str,
    machine_code: str,
    processing_minutes: int,
    setup_minutes: int = 0,
) -> ToolResult:
    """Add a processing step (operation) to a work order."""
    if processing_minutes < 1:
        return _err("processing_minutes must be at least 1.")
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return _err(f"Work order '{work_order_code}' not found.")
    machine = db.query(Machine).filter(Machine.code == machine_code).first()
    if not machine:
        return _err(f"Machine '{machine_code}' not found.")
    try:
        last_op = (
            db.query(Operation)
            .filter(Operation.work_order_id == wo.id)
            .order_by(Operation.sequence_no.desc())
            .first()
        )
        seq = (last_op.sequence_no + 1) if last_op else 1
        op = Operation(
            work_order_id=wo.id,
            machine_id=machine.id,
            sequence_no=seq,
            processing_minutes=processing_minutes,
            setup_minutes=setup_minutes,
        )
        db.add(op)
        db.commit()
        return _ok(
            f"Added step {seq} to {work_order_code}: "
            f"{processing_minutes} min processing + {setup_minutes} min setup on {machine_code}.",
            sequence_no=seq,
        )
    except Exception as exc:
        db.rollback()
        logger.exception("add_operation_tool failed")
        return _err(f"Database error: {exc}")


def update_work_order_deadline(
    db: Session, work_order_code: str, new_due_date: str
) -> ToolResult:
    """Update the due date of a work order (ISO-8601 string)."""
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return _err(f"Work order '{work_order_code}' not found.")
    try:
        parsed = datetime.fromisoformat(new_due_date)
    except ValueError:
        return _err(
            f"Invalid date format: {new_due_date!r}. "
            "Use ISO-8601, e.g. 2025-04-10T17:00:00."
        )
    try:
        wo.due_date = parsed
        db.commit()
        return _ok(
            f"Due date of {work_order_code} updated to {parsed.date()}.",
            new_due_date=parsed.isoformat(),
        )
    except Exception as exc:
        db.rollback()
        logger.exception("update_work_order_deadline failed")
        return _err(f"Database error: {exc}")


def change_work_order_priority(
    db: Session, work_order_code: str, priority: int
) -> ToolResult:
    """Change the priority of a work order (1=Critical … 4=Low)."""
    if not 1 <= priority <= 4:
        return _err("Priority must be between 1 (Critical) and 4 (Low).")
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return _err(f"Work order '{work_order_code}' not found.")
    try:
        old = wo.priority
        wo.priority = priority
        db.commit()
        labels = {1: "Critical", 2: "High", 3: "Medium", 4: "Low"}
        return _ok(
            f"{work_order_code} priority changed from {labels.get(old, old)} "
            f"to {labels[priority]}."
        )
    except Exception as exc:
        db.rollback()
        logger.exception("change_work_order_priority failed")
        return _err(f"Database error: {exc}")


def recompute_schedule(db: Session, algorithm: str = "EDD") -> ToolResult:
    """Trigger a fresh schedule computation and return KPI results."""
    try:
        run = compute_schedule(db, label="ai-triggered", algorithm=algorithm)
        summary = get_schedule_summary(db)
        return _ok(
            f"Schedule recomputed (run #{run.id}, {algorithm}): "
            f"{run.total_operations} ops, {run.on_time_count} on-time, "
            f"{run.late_count} late, utilization {run.machine_utilization_pct}%, "
            f"makespan {run.makespan_minutes} min.",
            run_id=run.id,
            **summary,
        )
    except Exception as exc:
        db.rollback()
        logger.exception("recompute_schedule failed")
        return _err(f"Scheduling engine error: {exc}")


def get_schedule_summary_tool(db: Session) -> ToolResult:
    """Return a text summary of the latest schedule run."""
    run = (
        db.query(ScheduleRun)
        .order_by(ScheduleRun.created_at.desc())
        .first()
    )
    if not run:
        return _ok("No schedule has been computed yet.")
    return _ok(
        f"Latest schedule (run #{run.id}, {run.algorithm}): "
        f"{run.total_operations} ops, {run.on_time_count} on-time, "
        f"{run.late_count} late, utilization {run.machine_utilization_pct}%, "
        f"makespan {run.makespan_minutes} min."
        + (f" ⚠ Conflicts: {run.conflict_details}" if run.has_conflicts else ""),
        run_id=run.id,
        algorithm=run.algorithm,
        total_operations=run.total_operations,
        on_time_count=run.on_time_count,
        late_count=run.late_count,
        utilization_pct=run.machine_utilization_pct,
        makespan_minutes=run.makespan_minutes,
        has_conflicts=run.has_conflicts,
    )


def prepone_work_order_tool(
    db: Session,
    work_order_code: str,
    days: int,
    direction: str = "prepone",
) -> ToolResult:
    """
    Shift a work order's due date earlier (prepone) or later (postpone)
    by `days` days, then recompute the schedule to surface cascading impact.
    """
    if days < 1:
        return _err("days must be a positive integer.")
    if direction not in ("prepone", "postpone"):
        return _err("direction must be 'prepone' or 'postpone'.")

    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return _err(f"Work order '{work_order_code}' not found.")
    if not wo.due_date:
        return _err(f"Work order '{work_order_code}' has no due date set.")

    try:
        delta = timedelta(days=days)
        old_date = wo.due_date
        wo.due_date = old_date - delta if direction == "prepone" else old_date + delta
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("prepone_work_order_tool: date update failed")
        return _err(f"Database error: {exc}")

    # Recompute to measure cascading impact
    try:
        run = compute_schedule(db, label=f"after-{direction}-{work_order_code}")
    except Exception as exc:
        logger.exception("prepone_work_order_tool: recompute failed")
        return _err(
            f"Due date updated to {wo.due_date.date()} but schedule recompute failed: {exc}"
        )

    late_items = (
        db.query(ScheduleItem)
        .filter(
            ScheduleItem.schedule_run_id == run.id,
            ScheduleItem.is_late == True,  # noqa: E712
        )
        .count()
    )
    total_items = (
        db.query(ScheduleItem)
        .filter(ScheduleItem.schedule_run_id == run.id)
        .count()
    )

    direction_word = "Preponed" if direction == "prepone" else "Postponed"
    return _ok(
        f"{direction_word} {work_order_code} by {days} day(s): "
        f"{old_date.date()} → {wo.due_date.date()}. "
        f"Impact: {late_items}/{total_items} operations now late, "
        f"utilization {run.machine_utilization_pct}%.",
        old_due_date=old_date.isoformat(),
        new_due_date=wo.due_date.isoformat(),
        late_operations=late_items,
        total_operations=total_items,
        run_id=run.id,
    )


def list_work_orders_tool(db: Session, status: str | None = None) -> ToolResult:
    """List work orders, optionally filtered by status."""
    q = db.query(WorkOrder)
    if status:
        q = q.filter(WorkOrder.status == status)
    orders = q.order_by(WorkOrder.priority, WorkOrder.due_date).all()
    if not orders:
        msg = "No work orders" + (f" with status '{status}'" if status else "") + "."
        return _ok(msg, work_orders=[])
    rows = [
        {
            "code": wo.code,
            "customer": wo.customer_name,
            "priority": wo.priority,
            "status": wo.status.value if hasattr(wo.status, "value") else wo.status,
            "due_date": wo.due_date.date().isoformat() if wo.due_date else None,
        }
        for wo in orders
    ]
    lines = "\n".join(
        f"- {r['code']} | {r['customer'] or 'n/a'} | P{r['priority']} | "
        f"{r['status']} | due {r['due_date'] or 'none'}"
        for r in rows
    )
    return _ok(f"Work orders ({len(rows)}):\n{lines}", work_orders=rows)


# ---------------------------------------------------------------------------
# Tool registry  (name → callable)  — used by the dispatcher in chat.py
# ---------------------------------------------------------------------------

TOOL_REGISTRY: Dict[str, Callable[..., ToolResult]] = {
    "create_machine": create_machine_tool,
    "list_machines": list_machines_tool,
    "create_work_order": create_work_order_tool,
    "add_operation": add_operation_tool,
    "update_work_order_deadline": update_work_order_deadline,
    "change_work_order_priority": change_work_order_priority,
    "recompute_schedule": recompute_schedule,
    "get_schedule_summary": get_schedule_summary_tool,
    "prepone_work_order": prepone_work_order_tool,
    "list_work_orders": list_work_orders_tool,
}


# ---------------------------------------------------------------------------
# OpenAI-compatible tool schema (TOOLS list)
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_machine",
            "description": "Add a new machine to the factory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Short unique code, e.g. CNC-01"},
                    "name": {"type": "string", "description": "Human-readable name"},
                },
                "required": ["code", "name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_machines",
            "description": "List all machines and their current status.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_work_orders",
            "description": "List work orders, optionally filtered by status (pending, in_progress, completed, etc.).",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["pending", "in_progress", "paused", "completed", "cancelled", "on_hold"],
                        "description": "Filter by work order status (omit for all).",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_work_order",
            "description": "Create a new work order for a customer.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Unique order code, e.g. WO-500"},
                    "customer_name": {"type": "string"},
                    "priority": {
                        "type": "integer",
                        "description": "1=Critical, 2=High, 3=Medium, 4=Low",
                        "default": 3,
                    },
                    "due_date_days_from_now": {
                        "type": "integer",
                        "description": "Days until deadline from today",
                        "default": 7,
                    },
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_operation",
            "description": "Add a processing step to a work order on a specific machine.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "machine_code": {"type": "string"},
                    "processing_minutes": {"type": "integer", "description": "Net machining time"},
                    "setup_minutes": {
                        "type": "integer",
                        "description": "Setup / changeover time before machining",
                        "default": 0,
                    },
                },
                "required": ["work_order_code", "machine_code", "processing_minutes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_work_order_deadline",
            "description": "Change the due date of an existing work order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "new_due_date": {
                        "type": "string",
                        "description": "ISO-8601 datetime, e.g. 2025-04-10T17:00:00",
                    },
                },
                "required": ["work_order_code", "new_due_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "change_work_order_priority",
            "description": "Change the urgency of a work order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "priority": {
                        "type": "integer",
                        "description": "1=Critical, 2=High, 3=Medium, 4=Low",
                    },
                },
                "required": ["work_order_code", "priority"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepone_work_order",
            "description": "Move a work order's due date earlier (prepone) or later (postpone) and show cascading schedule impact.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "days": {"type": "integer", "description": "Number of calendar days to shift"},
                    "direction": {
                        "type": "string",
                        "enum": ["prepone", "postpone"],
                        "default": "prepone",
                    },
                },
                "required": ["work_order_code", "days"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recompute_schedule",
            "description": "Recalculate the full production schedule and return KPIs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "algorithm": {
                        "type": "string",
                        "enum": ["EDD", "SPT", "FIFO", "CR"],
                        "description": "Scheduling algorithm: EDD=Earliest Due Date, SPT=Shortest Processing Time, FIFO=creation order, CR=Critical Ratio",
                        "default": "EDD",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_schedule_summary",
            "description": "Fetch a summary of the most recent schedule run including KPIs.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]
