from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routes import machines, work_orders, operations, schedule, chat

# Create all tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Scheduler AI",
    description="Machine & work-order scheduler with AI chat interface",
    version="1.0.0"
)

# Allow frontend (React) to talk to backend during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Lock down in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register route modules
app.include_router(machines.router, prefix="/api/machines", tags=["Machines"])
app.include_router(work_orders.router, prefix="/api/work-orders", tags=["Work Orders"])
app.include_router(operations.router, prefix="/api/operations", tags=["Operations"])
app.include_router(schedule.router, prefix="/api/schedule", tags=["Schedule"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])

@app.get("/")
def root():
    return {"message": "Scheduler AI backend is running"}
