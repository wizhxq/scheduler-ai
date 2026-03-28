"""
chat_tools.py

Backend tool functions that the AI assistant can call.
These are the "actions" the AI takes when a user says things like:
  - "Prepone WO-101 by 3 days"
  - "Set priority of WO-102 to urgent"
  - "Recompute the schedule"

Each function takes a db session + parameters, performs the action,
and returns a plain string result for the AI to include in its response.
"""

import json
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models.models import WorkOrder, ScheduleRun
from app.services.scheduler import compute_schedule, get_schedule_summary


def update_work_order_deadline(
    db: Session, work_order_code: str, new_due_date: str
) -> str:
    """Update the due date of a work order by its code."""
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return f"Work order '{work_order_code}' not found."
    try:
        wo.due_date = datetime.fromisoformat(new_due_date)
        db.commit()
        return f"Updated due date of {work_order_code} to {new_due_date}."
    except ValueError:
        return f"Invalid date format: {new_due_date}. Use ISO format e.g. 2026-04-10T17:00:00."


def change_work_order_priority(
    db: Session, work_order_code: str, priority: int
) -> str:
    """Change the priority of a work order (1=low, 5=high)."""
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return f"Work order '{work_order_code}' not found."
    if not 1 <= priority <= 5:
        return "Priority must be between 1 (lowest) and 5 (highest)."
    wo.priority = priority
    db.commit()
    return f"Priority of {work_order_code} updated to {priority}."


def recompute_schedule(db: Session) -> str:
    """Trigger a new schedule computation and return a summary."""
    run = compute_schedule(db, run_label="ai-triggered")
    summary = get_schedule_summary(run)
    return (
        f"New schedule computed (run ID: {summary['run_id']}). "
        f"{summary['total_operations']} operations scheduled. "
        f"{summary['operations_delayed']} delayed by up to {summary['max_delay_minutes']} minutes."
    )


def get_schedule_summary_text(db: Session) -> str:
    """Return a text summary of the latest schedule run for AI context."""
    run = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    if not run:
        return "No schedule has been computed yet. Ask me to compute one."
    summary = get_schedule_summary(run)
    return json.dumps(summary, indent=2)


# Tool definitions for OpenAI function calling
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "update_work_order_deadline",
            "description": "Update the due date/deadline of a specific work order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {
                        "type": "string",
                        "description": "The unique code of the work order, e.g. WO-1001"
                    },
                    "new_due_date": {
                        "type": "string",
                        "description": "New due date in ISO 8601 format, e.g. 2026-04-10T17:00:00"
                    }
                },
                "required": ["work_order_code", "new_due_date"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "change_work_order_priority",
            "description": "Change the scheduling priority of a work order. 1=lowest, 5=highest.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "priority": {"type": "integer", "minimum": 1, "maximum": 5}
                },
                "required": ["work_order_code", "priority"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "recompute_schedule",
            "description": "Recompute the full schedule after changes have been made. Always call this after updating work orders.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_schedule_summary_text",
            "description": "Get a text summary of the current schedule including delays.",
            "parameters": {"type": "object", "properties": {}}
        }
    }
]
