from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum as SAEnum, Float, Boolean, Time
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.database import Base


class MachineStatus(str, enum.Enum):
    available = "available"
    busy = "busy"
    maintenance = "maintenance"
    offline = "offline"


class WorkOrderStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    paused = "paused"
    completed = "completed"
    cancelled = "cancelled"
    on_hold = "on_hold"


class Machine(Base):
    __tablename__ = "machines"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    status = Column(SAEnum(MachineStatus), default=MachineStatus.available)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Shift / capacity configuration
    shift_start = Column(String, default="08:00")   # e.g. "08:00"
    shift_end = Column(String, default="18:00")     # e.g. "18:00"
    shift_days = Column(String, default="1,2,3,4,5")  # Mon=1 ... Sun=7
    capacity_per_hour = Column(Float, default=1.0)  # multiplier
    default_setup_minutes = Column(Integer, default=15)
    maintenance_notes = Column(String, default="")
    utilization_target_pct = Column(Float, default=85.0)  # target utilisation %

    operations = relationship("Operation", back_populates="machine")


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False)
    customer_name = Column(String)
    priority = Column(Integer, default=3)  # 1=Critical, 2=High, 3=Medium, 4=Low
    due_date = Column(DateTime, nullable=True)
    status = Column(SAEnum(WorkOrderStatus), default=WorkOrderStatus.pending)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Status tracking timestamps
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    paused_at = Column(DateTime, nullable=True)

    # Scheduling metadata
    notes = Column(String, default="")
    estimated_hours = Column(Float, nullable=True)
    actual_hours = Column(Float, nullable=True)
    is_rush = Column(Boolean, default=False)
    backward_schedule = Column(Boolean, default=False)  # schedule from due date backward

    operations = relationship("Operation", back_populates="work_order", order_by="Operation.sequence_no")


class Operation(Base):
    __tablename__ = "operations"

    id = Column(Integer, primary_key=True, index=True)
    work_order_id = Column(Integer, ForeignKey("work_orders.id"), nullable=False)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    sequence_no = Column(Integer, nullable=False)  # Order within the work order
    processing_minutes = Column(Integer, nullable=False)
    setup_minutes = Column(Integer, default=0)
    notes = Column(String, default="")

    # Live status tracking
    status = Column(String, default="pending")  # pending, in_progress, completed, skipped
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    actual_minutes = Column(Integer, nullable=True)  # actual time taken

    work_order = relationship("WorkOrder", back_populates="operations")
    machine = relationship("Machine", back_populates="operations")
    schedule_items = relationship("ScheduleItem", back_populates="operation")


class ScheduleRun(Base):
    __tablename__ = "schedule_runs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    label = Column(String, default="")
    algorithm = Column(String, default="EDD")  # EDD, SPT, FIFO, CRITICAL_RATIO
    total_operations = Column(Integer, default=0)
    total_delay_minutes = Column(Integer, default=0)
    makespan_minutes = Column(Integer, default=0)
    on_time_count = Column(Integer, default=0)
    late_count = Column(Integer, default=0)
    machine_utilization_pct = Column(Float, default=0.0)
    has_conflicts = Column(Boolean, default=False)
    conflict_details = Column(String, default="")

    items = relationship("ScheduleItem", back_populates="schedule_run")


class ScheduleItem(Base):
    __tablename__ = "schedule_items"

    id = Column(Integer, primary_key=True, index=True)
    schedule_run_id = Column(Integer, ForeignKey("schedule_runs.id"), nullable=False)
    work_order_id = Column(Integer, ForeignKey("work_orders.id"), nullable=False)
    operation_id = Column(Integer, ForeignKey("operations.id"), nullable=False)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    delay_minutes = Column(Integer, default=0)
    is_late = Column(Boolean, default=False)       # misses due date
    is_conflict = Column(Boolean, default=False)   # overlaps with another job
    conflict_with_item_id = Column(Integer, nullable=True)

    schedule_run = relationship("ScheduleRun", back_populates="items")
    work_order = relationship("WorkOrder")
    operation = relationship("Operation", back_populates="schedule_items")
    machine = relationship("Machine")
