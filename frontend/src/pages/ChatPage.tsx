import { useState, useRef, useEffect } from 'react'
import { sendChat } from '../api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  actions?: any[]
}

const SUGGESTIONS = [
  "What machines do we have?",
  "Add a new CNC machine named CNC-01",
  "Create work order WO-100 for Customer A",
  "Show me the current work orders",
  "Compute the optimal schedule",
]

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Hi! I can help you manage your machine schedule.
Ask me to:
- Add or list machines
- Create work orders and operations
- Adjust deadlines or priorities
- Compute and summarize the schedule`
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (text: string) => {
    if (!text.trim() || loading) return

    const userMsg: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await sendChat(text)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.reply,
        actions: res.actions_taken
      }])
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${e.response?.data?.detail || 'Something went wrong'}`
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex flex-col h-screen max-h-screen bg-[#0f1117]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl p-4 shadow-sm ${
              m.role === 'user' 
                ? 'bg-blue-600 text-white rounded-tr-none' 
                : 'bg-[#1a1f2e] text-gray-200 border border-white/5 rounded-tl-none'
            }`}>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
              {m.actions && m.actions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/10 space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Actions Executed</p>
                  {m.actions.map((act: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-blue-400">
                      <span>⚡</span>
                      <span className="font-semibold">{act.tool || act.type}:</span>
                      <span className="text-gray-400">{JSON.stringify(act.args || act.data)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#1a1f2e] text-gray-400 p-4 rounded-2xl rounded-tl-none border border-white/5">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="p-6 bg-[#1a1f2e]/50 border-t border-white/5">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 border border-white/5 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>

          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask the AI to compute a schedule, adjust priorities, or explain your ops..."
              className="w-full bg-[#1a1f2e] text-gray-200 text-sm rounded-xl pl-4 pr-12 py-3 border border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none resize-none"
              rows={1}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              className="absolute right-2 top-2 p-1.5 text-blue-500 hover:text-blue-400 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] text-center text-gray-600">
            Powered by Groq + Llama 3.3 • Integrated Machine Scheduler
          </p>
        </div>
      </div>
    </div>
  )
}
