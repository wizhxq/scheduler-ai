# scheduler-ai

AI-powered machine & work-order scheduler with job-shop optimization and natural language chat interface. Built with FastAPI, React, PostgreSQL, and OpenAI.

## Features

- **Machine Scheduling** — Manage machines, assign work orders, track status
- **Job-Shop Optimization** — Automated scheduling using greedy/priority algorithms
- **AI Chat Interface** — Natural language queries powered by OpenAI GPT
- **REST API** — FastAPI backend with full CRUD operations
- **React Frontend** — Modern UI with Tailwind CSS
- **Dockerized** — Full stack deployable via Docker Compose

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| Backend | FastAPI + Python 3.11 |
| Database | PostgreSQL 15 |
| AI | OpenAI GPT-4 |
| Deployment | Docker + Docker Compose + Nginx |

## Project Structure

```
scheduler-ai/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── models.py            # SQLAlchemy ORM models
│   ├── database.py          # DB connection & session
│   ├── schemas.py           # Pydantic schemas
│   ├── routes/
│   │   ├── machines.py      # Machine CRUD routes
│   │   ├── workorders.py    # Work order routes
│   │   ├── schedule.py      # Scheduling algorithm
│   │   └── chat.py          # AI chat endpoint
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Page-level components
│   │   └── main.tsx         # App entry point
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- OpenAI API key

### Setup

```bash
git clone https://github.com/wizhxq/scheduler-ai.git
cd scheduler-ai
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
docker-compose up --build
```

App will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

## Environment Variables

```env
DATABASE_URL=postgresql://scheduler:scheduler@db:5432/schedulerdb
OPENAI_API_KEY=your_openai_api_key_here
SECRET_KEY=your_secret_key_here
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /machines | List all machines |
| POST | /machines | Create machine |
| PUT | /machines/{id} | Update machine |
| DELETE | /machines/{id} | Delete machine |
| GET | /workorders | List work orders |
| POST | /workorders | Create work order |
| POST | /schedule/optimize | Run scheduling algorithm |
| POST | /chat | AI chat query |

## License

MIT
