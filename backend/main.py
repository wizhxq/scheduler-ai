from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from routes import machines, workorders, schedule, chat

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Scheduler AI",
    description="AI-powered machine & work-order scheduler",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(machines.router, prefix="/machines", tags=["machines"])
app.include_router(workorders.router, prefix="/workorders", tags=["workorders"])
app.include_router(schedule.router, prefix="/schedule", tags=["schedule"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])

@app.get("/")
def root():
    return {"message": "Scheduler AI API", "docs": "/docs"}
