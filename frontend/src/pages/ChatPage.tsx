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
    { role: 'assistant', content: 'Hi! I can help you manage your machine schedule.\n\nAsk me to:\n- Compute a schedule\n- Adjust deadlines or priorities\n- Show work orders or machines\n- Explain what is running on each machine' }
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
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-8 py-5 border-b border-gray-800 flex items-center gap-3 flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
          <span className="text-lg">🤖</span>
        </div>
        <div>
          <h1 className="text-white font-bold text-sm">AI Scheduling Assistant</h1>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-gray-500 text-xs">Powered by Groq + LLaMA 3 · Free</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mr-3 mt-1 flex-shrink-0">
                <span className="text-xs">🤖</span>
              </div>
            )}
            <div className={`max-w-[75%] space-y-2`}>
              <div
                className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-gray-900 border border-gray-800 text-gray-200 rounded-bl-md'
                }`}
              >
                {m.content}
              </div>

              {/* Tool actions taken */}
              {m.actions && m.actions.length > 0 && (
                <div className="space-y-1.5">
                  {m.actions.map((action: any, ai: number) => (
                    <div key={ai} className="flex items-center gap-2 bg-gray-900/60 border border-gray-800 rounded-xl px-3 py-2">
                      <span className="text-blue-400 text-xs">⚡</span>
                      <p className="text-gray-400 text-xs">
                        <span className="text-blue-400 font-medium">{action.tool.replace(/_/g, ' ')}</span>
                        {action.args && Object.keys(action.args).length > 0 && (
                          <span className="text-gray-600"> · {Object.entries(action.args).map(([k,v]) => `${k}: ${v}`).join(', ')}</span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {m.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center ml-3 mt-1 flex-shrink-0">
                <span className="text-xs">👤</span>
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mr-3 mt-1 flex-shrink-0">
              <span className="text-xs">🤖</span>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="px-8 pb-4">
          <p className="text-gray-600 text-xs mb-2">Try asking:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs px-3 py-1.5 bg-gray-900 border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white rounded-xl transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-8 pb-8 pt-3 flex-shrink-0">
        <div className="flex gap-3 bg-gray-900 border border-gray-700 focus-within:border-blue-500 rounded-2xl p-3 transition-colors">
          <textarea
            rows={1}
            className="flex-1 bg-transparent text-white text-sm placeholder-gray-600 resize-none focus:outline-none leading-relaxed"
            placeholder="Ask the AI to compute a schedule, adjust priorities, or explain your ops..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="w-9 h-9 flex-shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl flex items-center justify-center transition-colors self-end"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <p className="text-gray-700 text-xs mt-2 text-center">Press Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
