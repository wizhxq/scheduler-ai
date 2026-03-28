from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
from pydantic import BaseModel
from app.database import get_db
from app.models.models import Machine, MachineStatus
from app.schemas.schemas import MachineCreate, MachineOut

router = APIRouter()


class MaintenanceRequest(BaseModel):
    start: str  # ISO datetime string
    end: str    # ISO datetime string
    notes: str = ""


@router.post("", response_model=MachineOut, status_code=201)
def create_machine(machine: MachineCreate, db: Session = Depends(get_db)):
    existing = db.query(Machine).filter(Machine.code == machine.code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Machine code '{machine.code}' already exists.")
    db_machine = Machine(**machine.model_dump())
    db.add(db_machine)
    db.commit()
    db.refresh(db_machine)
    return db_machine


@router.get("", response_model=List[MachineOut])
def list_machines(db: Session = Depends(get_db)):
    return db.query(Machine).all()


@router.get("/{machine_id}", response_model=MachineOut)
def get_machine(machine_id: int, db: Session = Depends(get_db)):
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    return machine


@router.post("/{machine_id}/maintenance")
def set_maintenance(machine_id: int, req: MaintenanceRequest, db: Session = Depends(get_db)):
    """Put a machine into maintenance mode with a scheduled window and notes."""
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    try:
        datetime.fromisoformat(req.start)
        datetime.fromisoformat(req.end)
    except ValueError:
        raise HTTPException(status_code=422, detail="start and end must be valid ISO datetime strings.")
    machine.status = MachineStatus.maintenance
    machine.maintenance_notes = req.notes or f"Scheduled maintenance {req.start[:10]} to {req.end[:10]}"
    db.commit()
    return {
        "message": f"{machine.name} set to maintenance.",
        "machine_id": machine_id,
        "start": req.start,
        "end": req.end,
        "notes": machine.maintenance_notes,
    }


@router.delete("/{machine_id}/maintenance")
def clear_maintenance(machine_id: int, db: Session = Depends(get_db)):
    """Return a machine to available status and clear maintenance notes."""
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    machine.status = MachineStatus.available
    machine.maintenance_notes = ""
    db.commit()
    return {"message": f"{machine.name} is now available.", "machine_id": machine_id}


@router.delete("/{machine_id}", status_code=204)
def delete_machine(machine_id: int, db: Session = Depends(get_db)):
    machine = db.query(Machine).filter(Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    db.delete(machine)
    db.commit()
