"""
chat_tools.py — AI-callable tool layer for the scheduler assistant.

Architecture:
  - TOOL_REGISTRY maps OpenAI function-call names → Python callables.
  - dispatch_tool() is the single entry point called by the chat route.
  - Every tool returns a plain string; the AI embeds it in its reply.
  - All DB mutations are guarded by try/except with explicit rollback.
  - The TOOLS list is the OpenAI-compatible JSON schema for all tools.

Adding a new tool:
  1. Write a function with signature (db: Session, **kwargs) -> str.
  2. Register it in TOOL_REGISTRY.
  3. Add its OpenAI schema to TOOLS.
"""

from __future__ import annotations

import json
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
        logger.exception("_create_machine failed")
        return f"Error creating machine: {exc}"


def _list_machines(db: Session, **_) -> str:
    machines = db.query(Machine).order_by(Machine.code).all()
    if not machines:
        return "No machines registered yet."
    lines = ["**Machines:**"]
    for m in machines:
        status = m.status.value if hasattr(m.status, "value") else m.status
        shift_info = f"shift {m.shift_start or '08:00'}–{m.shift_end or '18:00'}"
        lines.append(f"- {m.name} ({m.code}) | {status} | {shift_info}")
    return "\n".join(lines)


def _list_work_orders(db: Session, status_filter: str = "all", **_) -> str:
    q = db.query(WorkOrder)
    if status_filter != "all":
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
            f"- {wo.code} | {wo.status} | Priority: {pri} | Due: {due} | Ops: {op_count}"
        )
    return "\n".join(lines)


def _create_work_order(
    db: Session,
    code: str,
    customer_name: str = None,
    priority: int = 3,
    due_date_days_from_now: int = 7,
    **_,
) -> str:
    if db.query(WorkOrder).filter(WorkOrder.code == code).first():
        return f"Work order '{code}' already exists."
    if not 1 <= priority <= 4:
        return "Priority must be 1 (Critical), 2 (High), 3 (Medium), or 4 (Low)."
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
        return (
            f"Created work order {code} for {customer_name or 'unnamed customer'} "
            f"(priority: {priority}, due: {due_date.date()})."
        )
    except Exception as exc:
        db.rollback()
        logger.exception("_create_work_order failed")
        return f"Error creating work order: {exc}"


def _add_operation(
    db: Session,
    work_order_code: str,
    machine_code: str,
    processing_minutes: int,
    setup_minutes: int = None,
    **_,
) -> str:
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return f"Work order '{work_order_code}' not found."
    machine = db.query(Machine).filter(Machine.code == machine_code).first()
    if not machine:
        return f"Machine '{machine_code}' not found."
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
        return (
            f"Added operation (step {seq}) to {work_order_code}: "
            f"{processing_minutes} min processing on {machine_code}."
        )
    except Exception as exc:
        db.rollback()
        logger.exception("_add_operation failed")
        return f"Error adding operation: {exc}"


def _update_work_order_deadline(
    db: Session, work_order_code: str, new_due_date: str, **_
) -> str:
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return f"Work order '{work_order_code}' not found."
    try:
        wo.due_date = datetime.fromisoformat(new_due_date)
        db.commit()
        return f"Due date of {work_order_code} updated to {new_due_date}."
    except ValueError:
        return (
            f"Invalid date format: {new_due_date!r}. "
            "Use ISO format e.g. '2025-04-10T17:00:00'."
        )
    except Exception as exc:
        db.rollback()
        logger.exception("_update_work_order_deadline failed")
        return f"Error updating deadline: {exc}"


def _change_work_order_priority(
    db: Session, work_order_code: str, priority: int, **_
) -> str:
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
        return (
            f"Priority of {work_order_code} changed from "
            f"{priority_label.get(old, old)} to {priority_label.get(priority, priority)}."
        )
    except Exception as exc:
        db.rollback()
        logger.exception("_change_work_order_priority failed")
        return f"Error changing priority: {exc}"


def _shift_work_order(
    db: Session,
    work_order_code: str,
    days: int,
    direction: str = "prepone",
    **_,
) -> str:
    """
    Shift a work order's due date earlier (prepone) or later (postpone)
    and automatically recompute the schedule to show cascading impact.
    """
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
        db.flush()  # persist WO change before recomputing

        run = compute_schedule(db, label=f"{direction}-{work_order_code}")

        late_count = (
            db.query(ScheduleItem)
            .filter(
                ScheduleItem.schedule_run_id == run.id,
                ScheduleItem.is_late.is_(True),
            )
            .count()
        )
        total_ops = run.total_operations
        return (
            f"{direction.capitalize()}d {work_order_code} by {days} day(s). "
            f"New due date: {wo.due_date.date()}. "
            f"Schedule impact: {late_count}/{total_ops} operations now late, "
            f"utilization: {run.machine_utilization_pct}%."
        )
    except Exception as exc:
        db.rollback()
        logger.exception("_shift_work_order failed")
        return f"Error shifting work order: {exc}"


def _recompute_schedule(db: Session, algorithm: str = "EDD", **_) -> str:
    try:
        run = compute_schedule(db, label="ai-triggered", algorithm=algorithm)
        summary = get_schedule_summary(db)
        return (
            f"Schedule recomputed (Run #{run.id}, algorithm: {algorithm}). "
            f"Machines: {summary['machine_count']}, "
            f"Work orders: {summary['work_order_count']} "
            f"({summary['pending_count']} pending), "
            f"Utilization: {summary['utilization']}%, "
            f"On-time: {run.on_time_count}, Late: {run.late_count}."
        )
    except Exception as exc:
        logger.exception("_recompute_schedule failed")
        return f"Error recomputing schedule: {exc}"


def _get_schedule_summary(db: Session, **_) -> str:
    run: ScheduleRun | None = (
        db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    )
    if not run:
        return "No schedule has been computed yet. Ask me to recompute the schedule."
    summary = get_schedule_summary(db)
    return (
        f"**Latest Schedule (Run #{run.id}, {run.algorithm})** — "
        f"{run.total_operations} operations | "
        f"{run.on_time_count} on-time | "
        f"{run.late_count} late | "
        f"Total delay: {run.total_delay_minutes} min | "
        f"Utilization: {run.machine_utilization_pct}% | "
        f"Machines: {summary['machine_count']} | "
        f"Work orders: {summary['work_order_count']}"
    )


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
}


def dispatch_tool(db: Session, tool_name: str, arguments: Dict[str, Any]) -> str:
    """
    Execute the named tool with *arguments* and return a plain-text result
    suitable for injecting into an AI message.

    This is the single entry point that the chat route should call after
    receiving a function_call from the OpenAI response.

    Example usage in a chat route::

        import json
        from app.services.chat_tools import dispatch_tool, TOOLS

        # 1. Send user message + TOOLS schema to OpenAI
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )
        msg = response.choices[0].message

        # 2. If the model called a tool, dispatch it
        while msg.tool_calls:
            for tc in msg.tool_calls:
                result = dispatch_tool(
                    db,
                    tc.function.name,
                    json.loads(tc.function.arguments),
                )
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
            # 3. Send tool results back to the model for a final answer
            response = openai.chat.completions.create(
                model="gpt-4o", messages=messages, tools=TOOLS, tool_choice="auto"
            )
            msg = response.choices[0].message
    """
    fn = TOOL_REGISTRY.get(tool_name)
    if fn is None:
        logger.warning("dispatch_tool: unknown tool %r", tool_name)
        return f"Unknown tool: {tool_name!r}. Available tools: {list(TOOL_REGISTRY)}"
    logger.info("Dispatching tool %r with args %s", tool_name, arguments)
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
                    "code": {"type": "string", "description": "Order code, e.g. WO-500"},
                    "customer_name": {"type": "string", "description": "Customer name"},
                    "priority": {
                        "type": "integer",
                        "description": "1=Critical, 2=High, 3=Medium, 4=Low",
                        "default": 3,
                    },
                    "due_date_days_from_now": {
                        "type": "integer",
                        "description": "Days from today until deadline",
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
            "description": "Append a processing step (operation) to a work order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "machine_code": {"type": "string"},
                    "processing_minutes": {"type": "integer"},
                    "setup_minutes": {
                        "type": "integer",
                        "description": "Optional override for setup time",
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
            "description": "Change the due date of a work order to an exact datetime.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "new_due_date": {
                        "type": "string",
                        "description": "ISO datetime, e.g. '2025-04-10T17:00:00'",
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
            "description": "Set the urgency level of a work order.",
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
            "name": "shift_work_order",
            "description": (
                "Move a work order's due date earlier (prepone) or later (postpone) "
                "by N days and recompute the schedule to show cascading impact."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string", "description": "e.g. WO-100"},
                    "days": {"type": "integer", "description": "Number of days to shift"},
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
            "description": "Recalculate the full production schedule.",
            "parameters": {
                "type": "object",
                "properties": {
                    "algorithm": {
                        "type": "string",
                        "enum": ["EDD", "SPT", "FIFO", "CRITICAL_RATIO"],
                        "description": "Scheduling algorithm (default: EDD)",
                        "default": "EDD",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_schedule_summary",
            "description": "Return a KPI summary of the most recently computed schedule.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]
