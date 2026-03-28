import json
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.schemas import ChatRequest, ChatResponse
from app.services.chat_tools import (
    create_machine_tool,
    list_machines_tool,
    create_work_order_tool,
    add_operation_tool,
    update_work_order_deadline,
    change_work_order_priority,
    recompute_schedule,
    prepone_work_order_tool,
    get_schedule_summary_text,
    TOOLS
)
import os

# Groq is OpenAI-compatible and FREE - just swap the base_url
# Sign up at console.groq.com to get your free API key
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

try:
    from openai import OpenAI
    if GROQ_API_KEY and GROQ_API_KEY not in ("your-groq-key-here", ""):
        client = OpenAI(
            api_key=GROQ_API_KEY,
            base_url="https://api.groq.com/openai/v1"
        )
        AI_MODEL = "llama-3.3-70b-versatile" # Free on Groq
    else:
        client = None
except Exception:
    client = None

router = APIRouter()

SYSTEM_PROMPT = """
You are an AI scheduling assistant for a machine and work-order scheduler.
You help operators manage their production schedule by interpreting natural
language commands and calling the appropriate tools.

You can:
- Add or list machines
- Create work orders
- Add processing steps (operations) to work orders
- Update work order deadlines
- Change work order priorities
- Recompute the schedule after changes
- Summarize the current schedule and explain impacts

Always call recompute_schedule after making any changes (adding machines, work orders, etc.).
Always explain what you did and what the impact is on the schedule.
"""

@router.post("", response_model=ChatResponse)
def chat(request: ChatRequest, db: Session = Depends(get_db)):
    if client is None:
        return ChatResponse(
            reply="AI chat is not configured. To enable it:\n\n1. Go to https://console.groq.com and sign up for free\n2. Create an API key\n3. Edit your .env file and set: GROQ_API_KEY=your-actual-key\n4. Restart with: docker-compose up --build",
            actions_taken=[]
        )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": request.message}
    ]
    actions_taken = []

    try:
        # Agentic loop: keep calling Groq until no more tool calls
        while True:
            response = client.chat.completions.create(
                model=AI_MODEL,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto"
            )
            msg = response.choices[0].message
            messages.append(msg)

            if not msg.tool_calls:
                break

            for tool_call in msg.tool_calls:
                fn = tool_call.function.name
                args = json.loads(tool_call.function.arguments)

                if fn == "create_machine":
                    result = create_machine_tool(db, **args)
                elif fn == "list_machines":
                    result = list_machines_tool(db)
                elif fn == "create_work_order":
                    result = create_work_order_tool(db, **args)
                elif fn == "add_operation":
                    result = add_operation_tool(db, **args)
                elif fn == "update_work_order_deadline":
                    result = update_work_order_deadline(db, **args)
                elif fn == "change_work_order_priority":
                    result = change_work_order_priority(db, **args)
                elif fn == "recompute_schedule":
                    result = recompute_schedule(db)
                elif fn == "prepone_work_order":
                    result = prepone_work_order_tool(db, **args)
                elif fn == "get_schedule_summary":
                    result = get_schedule_summary_text(db)
                else:
                    result = {"error": f"Unknown tool: {fn}"}

                actions_taken.append({"tool": fn, "args": args, "result": result})
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result)
                })

        return ChatResponse(
            reply=msg.content or "Done.",
            actions_taken=actions_taken
        )

    except Exception as e:
        error_msg = str(e)
        if "401" in error_msg or "invalid_api_key" in error_msg.lower() or "authentication" in error_msg.lower():
            return ChatResponse(
                reply="Invalid Groq API key. Please check your GROQ_API_KEY in the .env file.\nGet a free key at https://console.groq.com",
                actions_taken=[]
            )
        return ChatResponse(
            reply=f"AI error: {error_msg[:200]}. Please check your Groq API key configuration.",
            actions_taken=[]
        )
