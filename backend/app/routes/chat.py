"""
chat.py — AI chat route.

Uses the OpenAI function-calling agentic loop:
  1. Inject live DB context into the system prompt so the AI always knows
     what machines and work orders currently exist.
  2. Send user message + TOOLS schema to the LLM.
  3. Dispatch tool calls via dispatch_tool() until the model produces a
     plain-text reply.

Provider: Groq (free, OpenAI-compatible). Swap base_url for OpenAI if needed.
"""

import json
import logging
import os
from typing import List, Dict, Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Machine, WorkOrder
from app.schemas.schemas import ChatRequest, ChatResponse
from app.services.chat_tools import TOOLS, dispatch_tool

logger = logging.getLogger(__name__)
router = APIRouter()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "llama-3.3-70b-versatile")

try:
    from openai import OpenAI
    _client = (
        OpenAI(api_key=GROQ_API_KEY, base_url="https://api.groq.com/openai/v1")
        if GROQ_API_KEY and GROQ_API_KEY not in ("your-groq-key-here", "")
        else None
    )
except Exception:
    _client = None

_NOT_CONFIGURED_MSG = (
    "AI chat is not configured.\n"
    "1. Sign up at https://console.groq.com for a free API key.\n"
    "2. Add GROQ_API_KEY=<your-key> to your .env file.\n"
    "3. Restart with: docker-compose up --build -d"
)


def _build_system_prompt(db: Session) -> str:
    """
    Inject live factory context so the AI never has to guess machine codes
    or work order codes — it already knows them from the system prompt.
    """
    machines = db.query(Machine).order_by(Machine.code).all()
    work_orders = db.query(WorkOrder).order_by(WorkOrder.code).all()
    priority_label = {1: "Critical", 2: "High", 3: "Medium", 4: "Low"}

    machine_lines = (
        "\n".join(
            f"  - {m.code}: {m.name} ({m.status.value if hasattr(m.status, 'value') else m.status})"
            for m in machines
        )
        or "  (none registered yet)"
    )
    wo_lines = (
        "\n".join(
            f"  - {wo.code}: {wo.customer_name or 'no customer'} "
            f"| {priority_label.get(wo.priority, wo.priority)} priority "
            f"| due {wo.due_date.date() if wo.due_date else 'no date'} "
            f"| {len(wo.operations)} op(s)"
            for wo in work_orders
        )
        or "  (none created yet)"
    )

    return f"""\
You are an AI production scheduling assistant embedded in a factory scheduler.
You have direct control over machines, work orders, operations, and the schedule.

## Current Factory State

**Machines registered:**
{machine_lines}

**Work orders:**
{wo_lines}

## Capabilities
- Register or list machines
- Create work orders and attach processing operations to them
- Update due dates, priorities, and shift work orders earlier or later
- Recompute the schedule (EDD, SPT, FIFO, CRITICAL_RATIO algorithms)
- Get KPI summaries of the latest schedule
- List all work orders with live status

## Rules
- ALWAYS use exact machine codes and work order codes shown above.
- After ANY mutation (create, update, shift), automatically call recompute_schedule
  so the user sees updated KPIs immediately.
- When asked about the current schedule, call get_schedule_summary first.
- When asked to list orders, call list_work_orders.
- Explain what you did AND what the scheduling impact is in plain language.
- If a tool returns an error, explain it clearly and suggest a fix.
- Format responses clearly: use **bold** for key metrics, bullet lists for multiple items.
- Be conversational and helpful — you are the operator's intelligent assistant.
"""


@router.post("", response_model=ChatResponse)
def chat(request: ChatRequest, db: Session = Depends(get_db)):
    if _client is None:
        return ChatResponse(reply=_NOT_CONFIGURED_MSG, actions_taken=[])

    system_prompt = _build_system_prompt(db)
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": request.message},
    ]
    actions_taken = []

    try:
        for _iteration in range(10):  # hard cap against infinite loops
            response = _client.chat.completions.create(
                model=AI_MODEL,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                max_tokens=2048,
                temperature=0.3,  # lower = more deterministic tool use
            )
            msg = response.choices[0].message
            messages.append(msg.model_dump(exclude_unset=True))

            if not msg.tool_calls:
                break

            for tc in msg.tool_calls:
                fn_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                result = dispatch_tool(db=db, tool_name=fn_name, arguments=args)
                logger.info("Tool %r -> %s", fn_name, str(result)[:120])

                actions_taken.append({"tool": fn_name, "args": args, "result": result})
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

        final_reply = msg.content or "Done."
        return ChatResponse(reply=final_reply, actions_taken=actions_taken)

    except Exception as exc:
        err = str(exc)
        logger.exception("Chat route error")
        if any(k in err.lower() for k in ("401", "invalid_api_key", "authentication")):
            return ChatResponse(
                reply="Invalid Groq API key. Check GROQ_API_KEY in your .env.\nGet a free key at https://console.groq.com",
                actions_taken=[],
            )
        return ChatResponse(reply=f"AI error: {err[:300]}", actions_taken=[])
