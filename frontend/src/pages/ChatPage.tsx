import { useState, useRef, useEffect } from 'react'
import { sendChat } from '../api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  actions?: any[]
}

const SUGGESTIONS = [
  'What machines do we have?',
  'Show me the current work orders',
  'Compute the optimal schedule',
  'Which work order takes the longest?',
  'Make work order WO-001 done by tomorrow 5pm',
]

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { 
      role: 'assistant', 
      content: `Hi! I can help you manage your machine schedule.

Ask me to:
- Compute a schedule
- Adjust deadlines or priorities
- Show work orders or machines
- Explain what is running on each machine` 
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
      setMessages(prev => [...prev, { role: 'assistant', content: res.reply, actions: res.actions_taken }])
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.response?.data?.detail || 'Something went wrong'}` }])
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
                      <span>⚡</span> {act.type}: {act.description || JSON.stringify(act.data)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#1a1f2e] border border-white/5 rounded-2xl rounded-tl-none p-4 flex gap-2">
              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0.4s]" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div className="p-6 bg-[#0f1117] border-t border-white/5 space-y-4">
        {/* Suggestions */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
          <p className="text-gray-500 text-[10px] uppercase font-bold mr-2 whitespace-nowrap">Try asking:</p>
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => send(s)}
              className="whitespace-nowrap px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-full text-gray-400 text-xs transition-colors"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="relative">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask the AI to compute a schedule, adjust priorities, or explain your ops..."
            className="w-full bg-[#1a1f2e] border border-white/10 rounded-2xl pl-4 pr-14 py-4 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500/50 resize-none h-14"
            rows={1}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="absolute right-3 top-2.5 p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-center text-[10px] text-gray-600">Press Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
