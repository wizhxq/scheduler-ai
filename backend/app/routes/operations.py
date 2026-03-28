from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.models import Operation, WorkOrder, Machine
from app.schemas.schemas import OperationCreate, OperationOut

router = APIRouter()


@router.post("", response_model=OperationOut, status_code=201)
def create_operation(op: OperationCreate, db: Session = Depends(get_db)):
    # Validate work order and machine exist
    wo = db.query(WorkOrder).filter(WorkOrder.id == op.work_order_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    machine = db.query(Machine).filter(Machine.id == op.machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    db_op = Operation(**op.model_dump())
    db.add(db_op)
    db.commit()
    db.refresh(db_op)
    return db_op


@router.get("", response_model=List[OperationOut])
def list_operations(work_order_id: int = None, db: Session = Depends(get_db)):
    query = db.query(Operation)
    if work_order_id:
        query = query.filter(Operation.work_order_id == work_order_id)
    return query.order_by(Operation.work_order_id, Operation.sequence_no).all()


@router.delete("/{op_id}", status_code=204)
def delete_operation(op_id: int, db: Session = Depends(get_db)):
    op = db.query(Operation).filter(Operation.id == op_id).first()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")
    db.delete(op)
    db.commit()
