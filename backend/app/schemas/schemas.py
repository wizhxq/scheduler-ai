from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, List, Any
from enum import Enum


class MachineStatus(str, Enum):
    available = "available"
    busy = "busy"
    maintenance = "maintenance"
    offline = "offline"


class WorkOrderStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    paused = "paused"
    completed = "completed"
    cancelled = "cancelled"
    on_hold = "on_hold"


# --- Machine Schemas ---
class MachineCreate(BaseModel):
    code: str
    name: str
    status: MachineStatus = MachineStatus.available
    shift_start: str = "08:00"
    shift_end: str = "18:00"
    shift_days: str = "1,2,3,4,5"
    capacity_per_hour: float = 1.0
    default_setup_minutes: int = 15
    utilization_target_pct: float = 85.0


class MachineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    status: MachineStatus
    created_at: datetime
    shift_start: Optional[str] = "08:00"
    shift_end: Optional[str] = "18:00"
    shift_days: Optional[str] = "1,2,3,4,5"
    capacity_per_hour: Optional[float] = 1.0
    default_setup_minutes: Optional[int] = 15
    utilization_target_pct: Optional[float] = 85.0
    maintenance_notes: Optional[str] = ""


# --- Work Order Schemas ---
class WorkOrderCreate(BaseModel):
    code: str
    customer_name: Optional[str] = None
    priority: int = 3
    due_date: Optional[datetime] = None
    status: WorkOrderStatus = WorkOrderStatus.pending
    notes: str = ""
    is_rush: bool = False
    backward_schedule: bool = False


class WorkOrderUpdate(BaseModel):
    due_date: Optional[datetime] = None
    priority: Optional[int] = None
    status: Optional[WorkOrderStatus] = None
    notes: Optional[str] = None
    is_rush: Optional[bool] = None
    customer_name: Optional[str] = None


class WorkOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    customer_name: Optional[str] = None
    priority: int
    due_date: Optional[datetime] = None
    status: WorkOrderStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    paused_at: Optional[datetime] = None
    notes: Optional[str] = ""
    is_rush: Optional[bool] = False
    backward_schedule: Optional[bool] = False
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None


# --- Operation Schemas ---
class OperationCreate(BaseModel):
    work_order_id: int
    machine_id: int
    sequence_no: int
    processing_minutes: int
    setup_minutes: int = 0
    notes: str = ""


class OperationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    work_order_id: int
    machine_id: int
    sequence_no: int
    processing_minutes: int
    setup_minutes: Optional[int] = 0
    notes: Optional[str] = ""
    status: Optional[str] = "pending"
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    actual_minutes: Optional[int] = None


# --- Schedule Schemas ---

# Used by PATCH /schedule/items/{id} — frontend sends {start_time, end_time}
# as a plain JSON object. Defining it as a Pydantic model means FastAPI
# automatically parses the request body into this shape.
class RescheduleBody(BaseModel):
    start_time: datetime
    end_time: datetime


class ScheduleItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    schedule_run_id: Optional[int] = None
    work_order_id: int
    operation_id: int
    machine_id: int
    machine_name: Optional[str] = ""
    work_order_name: Optional[str] = ""
    start_time: datetime
    end_time: datetime
    delay_minutes: Optional[int] = 0
    is_late: Optional[bool] = False
    is_conflict: Optional[bool] = False
    conflict_with_item_id: Optional[int] = None


class ScheduleRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    label: Optional[str] = ""
    algorithm: Optional[str] = "EDD"
    end_time: Optional[datetime] = None
    total_operations: Optional[int] = 0
    total_delay_minutes: Optional[int] = 0
    makespan_minutes: Optional[int] = 0
    on_time_count: Optional[int] = 0
    late_count: Optional[int] = 0
    machine_utilization_pct: Optional[float] = 0.0
    has_conflicts: Optional[bool] = False
    conflict_details: Optional[str] = ""
    items: List[ScheduleItemOut] = []


# --- KPI Schema ---
class KPIOut(BaseModel):
    total_work_orders: int
    pending_orders: int
    in_progress_orders: int
    completed_orders: int
    overdue_orders: int
    on_time_delivery_rate: float
    avg_lead_time_hours: float
    machine_utilization_pct: float
    conflict_count: int
    late_operations: int
    machines_in_maintenance: int
    total_machines: int


# --- Chat Schemas ---
class ChatRequest(BaseModel):
    message: str
    schedule_run_id: Optional[int] = None


class ChatResponse(BaseModel):
    reply: str
    actions_taken: List[Any] = []
    updated_schedule: Optional[ScheduleRunOut] = None
