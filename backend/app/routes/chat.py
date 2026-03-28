"""
chat.py  –  AI assistant route

Uses the TOOL_REGISTRY from chat_tools for a clean dispatch pattern:
  - No if/elif chain
  - Structured ToolResult dict passed back to the LLM
  - Hard cap of 10 tool-call iterations to prevent run-away loops
  - Proper logging of all tool calls and errors
"""

from __future__ import annotations

import json
import logging
import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.schemas import ChatRequest, ChatResponse
from app.services.chat_tools import TOOL_REGISTRY, TOOLS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# LLM client setup  (Groq – OpenAI-compatible, free tier available)
# ---------------------------------------------------------------------------
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
AI_MODEL = "llama-3.3-70b-versatile"
MAX_TOOL_ITERATIONS = 10  # safety guard against infinite agentic loops

client = None
try:
    from openai import OpenAI

    if GROQ_API_KEY and GROQ_API_KEY not in ("", "your-groq-key-here"):
        client = OpenAI(
            api_key=GROQ_API_KEY,
            base_url="https://api.groq.com/openai/v1",
        )
        logger.info("Groq AI client initialised (model: %s)", AI_MODEL)
except Exception:
    logger.warning("openai package not available – AI chat disabled.")

router = APIRouter()

SYSTEM_PROMPT = """
You are an AI scheduling assistant for a factory production scheduler.
You help operators manage their work orders and machines via natural language.

Capabilities:
- Add / list machines
- Create work orders and add processing steps (operations) to them
- Update deadlines and change priorities
- Prepone or postpone work orders and understand cascading schedule impact
- Recompute the schedule with different algorithms (EDD, SPT, FIFO, CR)
- Summarise current schedule KPIs (utilization, makespan, on-time rate)

Guidelines:
- After any mutation (create / update / delete), call recompute_schedule
  so KPIs stay current and you can report accurate impact.
- Always confirm what action was taken and what changed in the schedule.
- If a tool returns ok=false, explain the error clearly; do NOT retry blindly.
- Be concise but informative.
"""


@router.post("", response_model=ChatResponse)
def chat(request: ChatRequest, db: Session = Depends(get_db)):
    # ------------------------------------------------------------------
    # Guard: AI not configured
    # ------------------------------------------------------------------
    if client is None:
        return ChatResponse(
            reply=(
                "AI chat is not configured.\n\n"
                "To enable it:\n"
                "1. Sign up at https://console.groq.com (free)\n"
                "2. Create an API key\n"
                "3. Set GROQ_API_KEY=<your-key> in your .env file\n"
                "4. Restart the server: docker-compose up --build"
            ),
            actions_taken=[],
        )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": request.message},
    ]
    actions_taken = []

    try:
        for iteration in range(MAX_TOOL_ITERATIONS):
            response = client.chat.completions.create(
                model=AI_MODEL,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
            )
            msg = response.choices[0].message
            messages.append(msg)

            if not msg.tool_calls:
                break  # LLM is done calling tools – final answer ready

            for tool_call in msg.tool_calls:
                fn_name = tool_call.function.name
                try:
                    args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    args = {}
                    logger.error("Could not parse tool args for %s", fn_name)

                handler = TOOL_REGISTRY.get(fn_name)
                if handler is None:
                    result = {"ok": False, "message": f"Unknown tool: {fn_name!r}"}
                    logger.warning("LLM called unknown tool: %s", fn_name)
                else:
                    try:
                        result = handler(db=db, **args)
                    except TypeError as exc:
                        result = {"ok": False, "message": f"Bad arguments for {fn_name}: {exc}"}
                        logger.exception("Tool %s called with wrong args: %s", fn_name, args)

                logger.info("Tool %s(%s) → ok=%s", fn_name, args, result.get("ok"))
                actions_taken.append({"tool": fn_name, "args": args, "result": result})

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result),
                })
        else:
            # Reached MAX_TOOL_ITERATIONS without a final answer
            logger.warning("Chat hit MAX_TOOL_ITERATIONS (%d)", MAX_TOOL_ITERATIONS)
            return ChatResponse(
                reply="The assistant ran too many steps without reaching a conclusion. Please try rephrasing your request.",
                actions_taken=actions_taken,
            )

        return ChatResponse(
            reply=msg.content or "Done.",
            actions_taken=actions_taken,
        )

    except Exception as exc:
        error_str = str(exc)
        logger.exception("Chat endpoint error")
        if any(k in error_str.lower() for k in ("401", "invalid_api_key", "authentication")):
            return ChatResponse(
                reply="Invalid Groq API key. Check GROQ_API_KEY in your .env file.\nGet a free key at https://console.groq.com",
                actions_taken=[],
            )
        return ChatResponse(
            reply=f"An unexpected error occurred. Please check the server logs.",
            actions_taken=actions_taken,
        )
