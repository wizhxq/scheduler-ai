"""
chat.py — AI chat route.

Uses the OpenAI function-calling agentic loop pattern:
  1. Send user message + TOOLS schema to the LLM.
  2. If the model emits tool_calls, dispatch each via dispatch_tool().
  3. Append tool results and send back to the model.
  4. Repeat until the model produces a plain text reply with no tool calls.

The LLM provider is Groq (free, OpenAI-compatible) by default.
Swap GROQ_API_KEY for OPENAI_API_KEY and change base_url to use OpenAI directly.
"""

import json
import logging
import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.schemas import ChatRequest, ChatResponse
from app.services.chat_tools import TOOLS, dispatch_tool
from app.services.scheduler import compute_schedule

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------------------
# LLM client setup (Groq by default — swap base_url for OpenAI)
# ---------------------------------------------------------------------------
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "llama-3.3-70b-versatile")

try:
    from openai import OpenAI

    if GROQ_API_KEY and GROQ_API_KEY not in ("your-groq-key-here", ""):
        _client = OpenAI(
            api_key=GROQ_API_KEY,
            base_url="https://api.groq.com/openai/v1",
        )
    else:
        _client = None
except Exception:
    _client = None

_NOT_CONFIGURED_MSG = (
    "AI chat is not configured. To enable it:\n"
    "1. Go to https://console.groq.com and sign up for a free API key.\n"
    "2. Add GROQ_API_KEY=<your-key> to your .env file.\n"
    "3. Restart the server."
)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """\
You are an AI production scheduling assistant embedded in a factory scheduler.
You have direct control over machines, work orders, operations, and the schedule.

Capabilities:
- Register or list machines
- Create work orders and attach processing operations to them
- Update due dates, priorities, and shift work orders earlier or later
- Recompute the schedule (supports EDD, SPT, FIFO, CRITICAL_RATIO algorithms)
- Retrieve KPI summaries of the latest schedule
- List all work orders with live status

Behaviour rules:
- After ANY mutation (create, update, shift), always call recompute_schedule
  so the user immediately sees the updated KPIs and impact.
- When asked about the schedule state, call get_schedule_summary first.
- When asked to list orders, call list_work_orders.
- Always explain what you did AND what the scheduling impact is in plain language.
- If a tool returns an error string, explain it to the user and suggest a fix.
- Never invent machine codes or work order codes — only use ones confirmed by tools.
"""

# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.post("", response_model=ChatResponse)
def chat(request: ChatRequest, db: Session = Depends(get_db)):
    if _client is None:
        return ChatResponse(reply=_NOT_CONFIGURED_MSG, actions_taken=[])

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": request.message},
    ]
    actions_taken = []

    try:
        # Agentic loop — continues until the model stops calling tools
        for _iteration in range(10):  # hard cap to prevent infinite loops
            response = _client.chat.completions.create(
                model=AI_MODEL,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                max_tokens=2048,
            )
            msg = response.choices[0].message

            # Append raw assistant message for context continuity
            messages.append(msg.model_dump(exclude_unset=True))

            if not msg.tool_calls:
                # Model produced a final text reply — we're done
                break

            # Dispatch every tool call the model requested
            for tc in msg.tool_calls:
                fn_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                result = dispatch_tool(db=db, tool_name=fn_name, arguments=args)
                logger.info("Tool %r -> %s", fn_name, result[:120])

                actions_taken.append({"tool": fn_name, "args": args, "result": result})
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    }
                )

        final_reply = msg.content or "Done."
        return ChatResponse(reply=final_reply, actions_taken=actions_taken)

    except Exception as exc:
        err = str(exc)
        logger.exception("Chat route error")
        if any(k in err.lower() for k in ("401", "invalid_api_key", "authentication")):
            return ChatResponse(
                reply="Invalid Groq API key. Check GROQ_API_KEY in your .env file.\nGet a free key at https://console.groq.com",
                actions_taken=[],
            )
        return ChatResponse(
            reply=f"AI error: {err[:300]}",
            actions_taken=[],
        )
