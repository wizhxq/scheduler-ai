from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List
from enum import Enum


class MachineStatus(str, Enum):
    available = "available"
    busy = "busy"
    maintenance = "maintenance"


class WorkOrderStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


# --- Machine Schemas ---
class MachineCreate(BaseModel):
    code: str
    name: str
    status: MachineStatus = MachineStatus.available


class MachineOut(BaseModel):
    id: int
    code: str
    name: str
    status: MachineStatus
    created_at: datetime

    class Config:
        from_attributes = True


# --- Work Order Schemas ---
class WorkOrderCreate(BaseModel):
    code: str
    customer_name: Optional[str] = None
    priority: int = 1
    due_date: datetime
    status: WorkOrderStatus = WorkOrderStatus.pending


class WorkOrderUpdate(BaseModel):
    due_date: Optional[datetime] = None
    priority: Optional[int] = None
    status: Optional[WorkOrderStatus] = None


class WorkOrderOut(BaseModel):
    id: int
    code: str
    customer_name: Optional[str]
    priority: int
    due_date: datetime
    status: WorkOrderStatus
    created_at: datetime

    class Config:
        from_attributes = True


# --- Operation Schemas ---
class OperationCreate(BaseModel):
    work_order_id: int
    machine_id: int
    sequence_no: int
    processing_minutes: int
    setup_minutes: int = 0
    notes: str = ""


class OperationOut(BaseModel):
    id: int
    work_order_id: int
    machine_id: int
    sequence_no: int
    processing_minutes: int
    setup_minutes: int
    notes: str

    class Config:
        from_attributes = True


# --- Schedule Schemas ---
class ScheduleItemOut(BaseModel):
    id: int
    work_order_id: int
    operation_id: int
    machine_id: int
    start_time: datetime
    end_time: datetime
    delay_minutes: int

    class Config:
        from_attributes = True


class ScheduleRunOut(BaseModel):
    schedule_run_id: int
    run_label: str
    created_at: datetime
    items: List[ScheduleItemOut]

    class Config:
        from_attributes = True


# --- Chat Schemas ---
class ChatRequest(BaseModel):
    message: str
    schedule_run_id: Optional[int] = None


class ChatResponse(BaseModel):
    reply: str
    actions_taken: List[str] = []
    updated_schedule: Optional[ScheduleRunOut] = None
