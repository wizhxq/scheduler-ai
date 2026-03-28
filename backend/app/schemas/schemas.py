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
    shift_start: str = "08:00"
    shift_end: str = "18:00"
    shift_days: str = "1,2,3,4,5"
    capacity_per_hour: float = 1.0
    default_setup_minutes: int = 15
    utilization_target_pct: float = 85.0
    maintenance_notes: str = ""


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


class WorkOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    customer_name: Optional[str]
    priority: int
    due_date: Optional[datetime]
    status: WorkOrderStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    paused_at: Optional[datetime] = None
    notes: str = ""
    is_rush: bool = False
    backward_schedule: bool = False
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
    setup_minutes: int
    notes: str
    status: str = "pending"
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    actual_minutes: Optional[int] = None


# --- Schedule Schemas ---
class ScheduleItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    work_order_id: int
    operation_id: int
    machine_id: int
    machine_name: str = ""
    work_order_name: str = ""
    start_time: datetime
    end_time: datetime
    delay_minutes: int
    is_late: bool = False
    is_conflict: bool = False


class ScheduleRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    schedule_run_id: int
    run_label: str
    algorithm: str = "EDD"
    computed_at: datetime
    created_at: datetime
    total_operations: int = 0
    on_time_count: int = 0
    late_count: int = 0
    machine_utilization_pct: float = 0.0
    has_conflicts: bool = False
    conflict_details: str = ""
    items: List[ScheduleItemOut]


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
