from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.database import Base


class MachineStatus(str, enum.Enum):
    available = "available"
    busy = "busy"
    maintenance = "maintenance"


class WorkOrderStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


class Machine(Base):
    __tablename__ = "machines"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    status = Column(SAEnum(MachineStatus), default=MachineStatus.available)
    created_at = Column(DateTime, default=datetime.utcnow)

    operations = relationship("Operation", back_populates="machine")


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False)
    customer_name = Column(String)
    priority = Column(Integer, default=1)  # 1=lowest, 5=highest
    due_date = Column(DateTime, nullable=False)
    status = Column(SAEnum(WorkOrderStatus), default=WorkOrderStatus.pending)
    created_at = Column(DateTime, default=datetime.utcnow)

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

    work_order = relationship("WorkOrder", back_populates="operations")
    machine = relationship("Machine", back_populates="operations")


class ScheduleRun(Base):
    __tablename__ = "schedule_runs"

    id = Column(Integer, primary_key=True, index=True)
    run_label = Column(String, default="")
    objective = Column(String, default="minimize_makespan")
    created_at = Column(DateTime, default=datetime.utcnow)

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

    schedule_run = relationship("ScheduleRun", back_populates="items")
