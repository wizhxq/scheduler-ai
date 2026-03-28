from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.models import WorkOrder
from app.schemas.schemas import WorkOrderCreate, WorkOrderOut, WorkOrderUpdate

router = APIRouter()


@router.post("", response_model=WorkOrderOut, status_code=201)
def create_work_order(wo: WorkOrderCreate, db: Session = Depends(get_db)):
    existing = db.query(WorkOrder).filter(WorkOrder.code == wo.code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Work order code '{wo.code}' already exists.")
    db_wo = WorkOrder(**wo.model_dump())
    db.add(db_wo)
    db.commit()
    db.refresh(db_wo)
    return db_wo


@router.get("", response_model=List[WorkOrderOut])
def list_work_orders(db: Session = Depends(get_db)):
    return db.query(WorkOrder).order_by(WorkOrder.due_date).all()


@router.get("/{wo_id}", response_model=WorkOrderOut)
def get_work_order(wo_id: int, db: Session = Depends(get_db)):
    wo = db.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    return wo


@router.patch("/{wo_id}", response_model=WorkOrderOut)
def update_work_order(wo_id: int, updates: WorkOrderUpdate, db: Session = Depends(get_db)):
    wo = db.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    for field, value in updates.model_dump(exclude_unset=True).items():
        setattr(wo, field, value)
    db.commit()
    db.refresh(wo)
    return wo


@router.delete("/{wo_id}", status_code=204)
def delete_work_order(wo_id: int, db: Session = Depends(get_db)):
    wo = db.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    db.delete(wo)
    db.commit()
