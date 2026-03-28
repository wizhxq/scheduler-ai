import json
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from openai import OpenAI
import os

from app.database import get_db
from app.schemas.schemas import ChatRequest, ChatResponse
from app.services.chat_tools import (
    update_work_order_deadline,
    change_work_order_priority,
    recompute_schedule,
    get_schedule_summary_text,
    TOOLS
)

router = APIRouter()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT = """
You are an AI scheduling assistant for a machine and work-order scheduler.
You help operators manage their production schedule by interpreting natural
language commands and calling the appropriate tools.

You can:
- Update work order deadlines
- Change work order priorities
- Recompute the schedule after changes
- Summarize the current schedule and explain impacts

Always call recompute_schedule after making any changes.
Always explain what you did and what the impact is on the schedule.
"""


@router.post("", response_model=ChatResponse)
def chat(request: ChatRequest, db: Session = Depends(get_db)):
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": request.message}
    ]
    actions_taken = []

    # Agentic loop: keep calling OpenAI until no more tool calls
    while True:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto"
        )
        msg = response.choices[0].message
        messages.append(msg)

        if not msg.tool_calls:
            # No more tool calls - we have the final answer
            break

        # Execute each tool call
        for tool_call in msg.tool_calls:
            fn_name = tool_call.function.name
            fn_args = json.loads(tool_call.function.arguments)

            if fn_name == "update_work_order_deadline":
                result = update_work_order_deadline(db, **fn_args)
            elif fn_name == "change_work_order_priority":
                result = change_work_order_priority(db, **fn_args)
            elif fn_name == "recompute_schedule":
                result = recompute_schedule(db)
            elif fn_name == "get_schedule_summary_text":
                result = get_schedule_summary_text(db)
            else:
                result = f"Unknown tool: {fn_name}"

            actions_taken.append(f"{fn_name}: {result}")

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result
            })

    return ChatResponse(
        reply=msg.content or "Done.",
        actions_taken=actions_taken
    )
