# Scheduler AI 📊

AI-powered machine & work-order scheduler with job-shop optimization and a natural language chat interface. Built with FastAPI, React, PostgreSQL, and Groq/LLaMA 3.

## ✨ Features

- **Interactive Gantt Chart**: Visual timeline of scheduled operations per machine with utilization metrics and hover tooltips.
- **Enterprise-Grade Scheduling**: Job-shop optimization algorithm that respects shifts, machine status (maintenance/offline), and job priorities.
- **AI Chat Assistant**: Manage your production floor using natural language. "Move WO-101 to tomorrow" or "What is the status of the CNC machine?".
- **Machine Management**: Track idle/busy status, maintenance windows, and utilization rates.
- **Work Order Routing**: Define multi-step production sequences with machine assignments and duration estimates.
- **Modern UI**: Clean, dark-mode dashboard built with Tailwind CSS and Framer Motion-inspired interactions.

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React + TypeScript + Vite + Tailwind CSS |
| **Backend** | FastAPI + Python 3.11 + SQLAlchemy |
| **Database** | PostgreSQL 15 |
| **AI** | Groq LLaMA 3-70B (Fast & Free API) |
| **Deployment** | Docker + Docker Compose + Nginx |

## 🚀 Quick Start

1. **Clone the repo**
   ```bash
   git clone https://github.com/wizhxq/scheduler-ai.git
   cd scheduler-ai
   ```

2. **Environment Setup**
   Copy `.env.example` to `.env` and add your Groq API key:
   ```env
   GROQ_API_KEY=your_key_here
   ```

3. **Run with Docker**
   ```bash
   docker-compose up --build
   ```
   - Frontend: `http://localhost:3000`
   - Backend API: `http://localhost:8000`

## 🧠 How it Works

1. **Input**: Add your available machines and work orders (with routing steps).
2. **Optimize**: The AI/Algorithm computes the Earliest Due Date (EDD) schedule while respecting finite machine capacity and shift timings.
3. **Chat**: Use the AI Assistant to make quick adjustments or query the current state without navigating through tables.

---
Built by wizhxq (with help from Comet) 🚀
