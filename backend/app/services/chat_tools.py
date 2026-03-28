"""chat_tools.py

Backend tool functions that the AI assistant can call.
These are the "actions" the AI takes when a user says things like:
- "Prepone WO-101 by 3 days"
- "Set priority of WO-102 to urgent"
- "Recompute the schedule"
- "Add a CNC machine named CNC-01"

Each function takes a db session + parameters, performs the action,
and returns a plain string result for the AI to include in its response.
"""
import json
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models.models import WorkOrder, Machine, Operation, ScheduleRun, ScheduleItem
from app.services.scheduler import compute_schedule, get_schedule_summary


def create_machine_tool(db: Session, code: str, name: str) -> str:
    """Add a new machine to the factory."""
    existing = db.query(Machine).filter(Machine.code == code).first()
    if existing:
        return f"Machine with code '{code}' already exists."
    machine = Machine(code=code, name=name, status="available")
    db.add(machine)
    db.commit()
    return f"Successfully added machine '{name}' (Code: {code})."


def list_machines_tool(db: Session) -> str:
    """List all machines and their status."""
    machines = db.query(Machine).all()
    if not machines:
        return "No machines registered."
    res = "Current Machines:\n"
    for m in machines:
        res += f"- {m.name} ({m.code}): {m.status.value}\n"
    return res


def create_work_order_tool(
    db: Session,
    code: str,
    customer_name: str = None,
    priority: int = 3,
    due_date_days_from_now: int = 7
) -> str:
    """Create a new work order."""
    existing = db.query(WorkOrder).filter(WorkOrder.code == code).first()
    if existing:
        return f"Work order '{code}' already exists."
    due_date = datetime.utcnow() + timedelta(days=due_date_days_from_now)
    wo = WorkOrder(
        code=code,
        customer_name=customer_name,
        priority=priority,
        due_date=due_date,
        status="pending"
    )
    db.add(wo)
    db.commit()
    return f"Created work order {code} for {customer_name or 'unnamed customer'} (Priority: {priority}, Due: {due_date.date()})."


def add_operation_tool(
    db: Session,
    work_order_code: str,
    machine_code: str,
    processing_minutes: int
) -> str:
    """Add a processing step (operation) to a work order."""
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return f"Work order '{work_order_code}' not found."
    m = db.query(Machine).filter(Machine.code == machine_code).first()
    if not m:
        return f"Machine '{machine_code}' not found."
    last_op = db.query(Operation).filter(
        Operation.work_order_id == wo.id
    ).order_by(Operation.sequence_no.desc()).first()
    seq = (last_op.sequence_no + 1) if last_op else 1
    op = Operation(
        work_order_id=wo.id,
        machine_id=m.id,
        sequence_no=seq,
        processing_minutes=processing_minutes
    )
    db.add(op)
    db.commit()
    return f"Added operation step {seq} to {work_order_code}: {processing_minutes} mins on {machine_code}."


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
        return f"Invalid date format: {new_due_date}. Use ISO format e.g. 2024-04-10T17:00:00."


def change_work_order_priority(
    db: Session, work_order_code: str, priority: int
) -> str:
    """Change the priority of a work order (1=Critical, 4=Low)."""
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo:
        return f"Work order '{work_order_code}' not found."
    if not 1 <= priority <= 4:
        return "Priority must be between 1 (Critical) and 4 (Low)."
    wo.priority = priority
    db.commit()
    return f"Priority of {work_order_code} updated to {priority}."


def recompute_schedule(db: Session) -> str:
    """Trigger a new schedule computation and return a summary."""
    run = compute_schedule(db, label="ai-triggered")
    summary = get_schedule_summary(db)
    return (
        f"New schedule computed (Run ID: {run.id}). "
        f"Machines: {summary['machine_count']}, "
        f"Work Orders: {summary['work_order_count']}, "
        f"Utilization: {summary['utilization']}%"
    )


def get_schedule_summary_text(db: Session) -> str:
    """Get a text summary of the latest schedule."""
    run = db.query(ScheduleRun).order_by(ScheduleRun.created_at.desc()).first()
    if not run:
        return "No schedule has been computed yet."
    summary = get_schedule_summary(db)
    return (
        f"Latest Schedule (Run ID: {run.id}, Algorithm: {run.algorithm}): "
        f"{run.total_operations} ops, "
        f"{run.on_time_count} on-time, "
        f"{run.late_count} late, "
        f"Utilization: {run.machine_utilization_pct}%"
    )


def prepone_work_order_tool(
    db: Session,
    work_order_code: str,
    days: int,
    direction: str = "prepone"
) -> str:
    """Prepone/postpone a work order and show cascading impact on other orders."""
    wo = db.query(WorkOrder).filter(WorkOrder.code == work_order_code).first()
    if not wo or not wo.due_date:
        return f"Work order '{work_order_code}' not found or has no due date."
    
    # Adjust the due date
    if direction == "prepone":
        wo.due_date = wo.due_date - timedelta(days=days)
    else:
        wo.due_date = wo.due_date + timedelta(days=days)
    
    db.commit()
    
    # Recompute schedule to see impact
    run = compute_schedule(db, label=f"after-{direction}-{work_order_code}")
    
    # Analyze impact
    late_orders = db.query(ScheduleItem).filter(
        ScheduleItem.schedule_run_id == run.id,
        ScheduleItem.is_late == True
    ).count()
    
    affected_orders = db.query(ScheduleItem).filter(
        ScheduleItem.schedule_run_id == run.id
    ).count()
    
    return (
        f"✓ {direction.capitalize()}d {work_order_code} by {days} days. "
        f"New due date: {wo.due_date.date()}. "
        f"Impact: {late_orders} orders now late out of {affected_orders} total, "
        f"utilization: {run.machine_utilization_pct}%."
    )


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_machine",
            "description": "Add a new machine to the factory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Short code for machine, e.g. CNC-01"},
                    "name": {"type": "string", "description": "Friendly name of the machine"}
                },
                "required": ["code", "name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_machines",
            "description": "List all machines and their current status.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_work_order",
            "description": "Create a new work order for a customer.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Order code, e.g. WO-500"},
                    "customer_name": {"type": "string", "description": "Name of the customer"},
                    "priority": {"type": "integer", "description": "Priority 1-4 (1=Critical, 4=Low)", "default": 3},
                    "due_date_days_from_now": {"type": "integer", "description": "Days until deadline", "default": 7}
                },
                "required": ["code"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_operation",
            "description": "Add a processing step to a work order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "machine_code": {"type": "string"},
                    "processing_minutes": {"type": "integer"}
                },
                "required": ["work_order_code", "machine_code", "processing_minutes"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_work_order_deadline",
            "description": "Change the deadline of an existing work order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "new_due_date": {"type": "string", "description": "ISO format date string e.g. 2024-04-10T17:00:00"}
                },
                "required": ["work_order_code", "new_due_date"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "change_work_order_priority",
            "description": "Change the importance level of a work order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string"},
                    "priority": {"type": "integer", "description": "1=Critical, 2=High, 3=Medium, 4=Low"}
                },
                "required": ["work_order_code", "priority"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "prepone_work_order",
            "description": "Prepone or postpone a work order by X days and show the cascading impact on other orders.",
            "parameters": {
                "type": "object",
                "properties": {
                    "work_order_code": {"type": "string", "description": "Work order code e.g. WO-100"},
                    "days": {"type": "integer", "description": "Number of days to shift"},
                    "direction": {"type": "string", "enum": ["prepone", "postpone"], "description": "Direction to shift: prepone (earlier) or postpone (later)", "default": "prepone"}
                },
                "required": ["work_order_code", "days"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "recompute_schedule",
            "description": "Recalculate the production schedule based on current data.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_schedule_summary",
            "description": "Get a status report of the current production schedule.",
            "parameters": {"type": "object", "properties": {}}
        }
    }
]
