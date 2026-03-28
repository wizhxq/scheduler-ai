import { useState, useRef, useEffect, useCallback } from 'react'
import { sendChat } from '../api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  actions?: any[]
  isVoice?: boolean
}

// Web Speech API type declarations
declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

const SUGGESTIONS = [
  "What machines do we have?",
  "Prepone WO-100 by 3 days and show impact",
  "Create work order WO-200 for Customer B with priority 1",
  "Compute the optimal schedule",
  "Which orders will be late?",
]

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Hi! I'm your AI scheduling assistant. I can help you:\n- Add or list machines & work orders\n- Prepone / postpone orders and show the cascading impact\n- Compute and summarise the production schedule\n- Change priorities and deadlines\nYou can type or use the microphone button to speak to me.`
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingPulse, setRecordingPulse] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<any>(null)
  const pulseRef = useRef<any>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Pulse animation during recording
  useEffect(() => {
    if (isRecording) {
      pulseRef.current = setInterval(() => {
        setRecordingPulse(p => !p)
      }, 500)
    } else {
      clearInterval(pulseRef.current)
      setRecordingPulse(false)
    }
    return () => clearInterval(pulseRef.current)
  }, [isRecording])

  // Stable `send` reference via useCallback so toggleVoice closure is never stale
  const send = useCallback(async (text: string) => {
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
  }, [loading])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  // `send` in deps array ensures onend closure always calls the current version
  const toggleVoice = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Please use Chrome or Edge.')
      return
    }
    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.continuous = false
    recognitionRef.current = recognition

    recognition.onstart = () => setIsRecording(true)

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      setInput(transcript)
    }

    recognition.onend = () => {
      setIsRecording(false)
      // Use functional updater to read latest input without stale closure,
      // then dispatch to the stable `send` reference captured above.
      setInput(prev => {
        if (prev.trim()) {
          setTimeout(() => send(prev), 0)
        }
        return prev
      })
    }

    recognition.onerror = (event: any) => {
      console.error('Speech error:', event.error)
      setIsRecording(false)
      if (event.error !== 'aborted') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Voice error: ${event.error}. Please try again or type your message.`
        }])
      }
    }

    recognition.start()
  }, [isRecording, send])

  const getActionColor = (tool: string) => {
    if (tool.includes('create') || tool.includes('add')) return 'text-green-400'
    if (tool.includes('delete') || tool.includes('remove')) return 'text-red-400'
    if (tool.includes('recompute') || tool.includes('schedule')) return 'text-blue-400'
    if (tool.includes('priority') || tool.includes('deadline')) return 'text-yellow-400'
    return 'text-purple-400'
  }

  return (
    <div className="flex flex-col h-screen max-h-screen bg-[#0f1117]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-[#0f1117]">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-sm font-bold">AI</div>
        <div>
          <h1 className="text-white font-semibold text-sm">Scheduling Assistant</h1>
          <p className="text-gray-500 text-xs">Powered by Groq + Llama 3.3 · Voice & Text</p>
        </div>
        {isRecording && (
          <div className={`ml-auto flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium transition-all ${
            recordingPulse ? 'bg-red-600/30 text-red-400' : 'bg-red-600/10 text-red-500'
          }`}>
            <span className={`w-2 h-2 rounded-full bg-red-500 ${ recordingPulse ? 'opacity-100' : 'opacity-30' }`} />
            Listening...
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${ m.role === 'user' ? 'justify-end' : 'justify-start' }`}>
            <div className={`max-w-[80%] rounded-2xl px-4 shadow-sm ${
              m.role === 'user'
                ? 'bg-blue-600 text-white rounded-tr-none py-3'
                : 'bg-[#1a1f2e] text-gray-200 border border-white/10 rounded-tl-none py-3'
            }`}>
              <div className="whitespace-pre-wrap leading-relaxed text-sm">{m.content}</div>
              {/* Actions taken panel */}
              {m.actions && m.actions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-2">Actions Executed</p>
                  <div className="space-y-1">
                    {m.actions.map((act: any, idx: number) => (
                      <div key={idx} className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5">⚡</span>
                        <div>
                          <span className={`font-semibold ${getActionColor(act.tool || '')}`}>
                            {act.tool || act.type}
                          </span>
                          {act.result && (
                            <p className="text-gray-400 mt-0.5">{typeof act.result === 'string' ? act.result : JSON.stringify(act.result)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl rounded-tl-none px-5 py-3">
              <div className="flex gap-1 items-center">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      <div className="px-6 pb-2 flex gap-2 flex-wrap">
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

      {/* Input area */}
      <div className="px-6 pb-6 pt-2">
        <div className="relative flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={isRecording ? 'Listening... speak now' : 'Type or speak your command...'}
              className={`w-full text-gray-200 text-sm rounded-xl pl-4 pr-4 py-3 border outline-none resize-none transition-colors ${
                isRecording
                  ? 'bg-red-950/30 border-red-500/50 focus:border-red-400'
                  : 'bg-[#1a1f2e] border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50'
              }`}
              rows={2}
            />
          </div>
          {/* Voice button */}
          <button
            onClick={toggleVoice}
            disabled={loading}
            title={isRecording ? 'Stop recording' : 'Start voice input'}
            className={`p-3 rounded-xl border transition-all ${
              isRecording
                ? 'bg-red-600 border-red-500 text-white shadow-lg shadow-red-500/30 scale-110'
                : 'bg-[#1a1f2e] border-white/10 text-gray-400 hover:text-white hover:border-white/30'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill={isRecording ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          {/* Send button */}
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="p-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-center text-gray-600 mt-2">
          Powered by Groq + Llama 3.3 · Voice input via Web Speech API
        </p>
      </div>
    </div>
  )
}
