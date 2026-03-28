import { useState, useRef, useEffect, useCallback } from 'react'
import { sendChat } from '../api'
import { useSchedule } from '../context/ScheduleContext'

interface Message {
  role: 'user' | 'assistant'
  content: string
  actions?: any[]
}

declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

// Tools that modify the schedule — after these run we do a full refresh so
// CalendarPage and SchedulePage both reflect changes immediately.
const SCHEDULE_MUTATING_TOOLS = new Set([
  'shift_work_order',
  'recompute_schedule',
  'reschedule_work_order_to_time',
  'recommend_and_schedule',
  'update_work_order_deadline',
  'set_maintenance_window',
  'clear_maintenance',
  'create_work_order',
  'add_operation',
  'change_work_order_priority',
])

const SUGGESTIONS = [
  'What time is free tomorrow?',
  'Move WO-001 to Monday 9am',
  'Find and book a slot for WO-002',
  'Recompute the schedule',
  'Which orders will be late?',
  'Show the schedule summary',
]

function renderMarkdown(text: string): JSX.Element[] {
  return text.split('\n').map((line, i) => {
    const isBullet = line.startsWith('- ') || line.startsWith('* ')
    const content = (isBullet ? line.slice(2) : line)
      .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
      .map((part, j) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={j} className="text-white font-semibold">{part.slice(2,-2)}</strong>
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={j} className="font-mono text-xs bg-white/10 px-1 rounded">{part.slice(1,-1)}</code>
        return <span key={j}>{part}</span>
      })
    return isBullet
      ? <div key={i} className="flex gap-2"><span className="text-blue-400 mt-0.5">•</span><span>{content}</span></div>
      : <div key={i} className={line==='' ? 'h-2' : ''}>{content}</div>
  })
}

export default function ChatPage() {
  const { refresh: refreshAll } = useSchedule()

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        `Hi! I'm your AI scheduling assistant. I can help you:\n` +
        `- Ask what time slots are free on any day\n` +
        `- Move a work order to a specific date & time\n` +
        `- Recommend and automatically book the best available slot\n` +
        `- Prepone / postpone orders and show cascading schedule impact\n` +
        `- Compute and summarise the production schedule\n\n` +
        `Try: **"What's free on Monday?"** or **"Move WO-001 to Tuesday 10am"** or **"Find a slot for WO-002 tomorrow"**`,
    },
  ])
  const [input,           setInput]           = useState('')
  const [loading,         setLoading]         = useState(false)
  const [isRecording,     setIsRecording]     = useState(false)
  const [recordingPulse,  setRecordingPulse]  = useState(false)
  const bottomRef    = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<any>(null)
  const pulseRef     = useRef<any>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    if (isRecording) { pulseRef.current = setInterval(()=>setRecordingPulse(p=>!p),500) }
    else { clearInterval(pulseRef.current); setRecordingPulse(false) }
    return () => clearInterval(pulseRef.current)
  }, [isRecording])

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setLoading(true)
    try {
      const res = await sendChat(text)

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: res.reply, actions: res.actions_taken },
      ])

      // Full refresh (schedule + WOs + machines) after any mutating tool call
      const didMutate = (res.actions_taken || []).some(
        (act: any) => SCHEDULE_MUTATING_TOOLS.has(act.tool)
      )
      if (didMutate) refreshAll()

    } catch (e: any) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${e.response?.data?.detail || e.message || 'Something went wrong'}` },
      ])
    } finally {
      setLoading(false)
    }
  }, [loading, refreshAll])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const toggleVoice = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Voice input not supported. Use Chrome or Edge.'); return }
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); return }
    const recognition = new SR()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.continuous = false
    recognitionRef.current = recognition
    recognition.onstart  = () => setIsRecording(true)
    recognition.onresult = (event: any) => {
      let t = ''
      for (let i=event.resultIndex;i<event.results.length;i++) t += event.results[i][0].transcript
      setInput(t)
    }
    recognition.onend = () => {
      setIsRecording(false)
      setInput(prev => { if (prev.trim()) setTimeout(()=>send(prev),0); return prev })
    }
    recognition.onerror = (event: any) => {
      setIsRecording(false)
      if (event.error!=='aborted')
        setMessages(prev=>[...prev,{role:'assistant',content:`Voice error: ${event.error}. Please type instead.`}])
    }
    recognition.start()
  }, [isRecording, send])

  const getActionColor = (tool: string) => {
    if (tool.includes('create')||tool.includes('add'))             return 'text-green-400'
    if (tool.includes('delete')||tool.includes('remove'))          return 'text-red-400'
    if (tool.includes('recompute')||tool.includes('schedule'))     return 'text-blue-400'
    if (tool.includes('reschedule')||tool.includes('recommend'))   return 'text-cyan-400'
    if (tool.includes('shift')||tool.includes('priority')||tool.includes('deadline')) return 'text-yellow-400'
    if (tool.includes('free')||tool.includes('slot'))              return 'text-emerald-400'
    if (tool.includes('list')||tool.includes('summary'))           return 'text-purple-400'
    return 'text-gray-400'
  }

  const getActionIcon = (tool: string) => {
    if (tool.includes('reschedule')||tool.includes('recommend'))   return '📅'
    if (tool.includes('free')||tool.includes('slot'))              return '🔍'
    if (tool.includes('recompute'))                                 return '⚡'
    if (tool.includes('shift'))                                     return '↻'
    if (tool.includes('create'))                                    return '➕'
    if (tool.includes('list')||tool.includes('summary'))           return '📋'
    return '⚡'
  }

  return (
    <div className="flex flex-col h-screen max-h-screen bg-[#0f1117]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-[#0f1117] flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-sm font-bold">AI</div>
        <div>
          <h1 className="text-white font-semibold text-sm">Scheduling Assistant</h1>
          <p className="text-gray-500 text-xs">Groq · Llama 3.3 · Voice & Text</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isRecording && (
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              recordingPulse ? 'bg-red-600/30 text-red-400' : 'bg-red-600/10 text-red-500'
            }`}>
              <span className={`w-2 h-2 rounded-full bg-red-500 ${recordingPulse?'opacity-100':'opacity-30'}`}/>
              Listening...
            </div>
          )}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
            <span className="text-emerald-400 text-[10px] font-semibold">Schedule Sync ON</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role==='user'?'justify-end':'justify-start'}`}>
            <div className={`max-w-[82%] rounded-2xl px-4 shadow-sm ${
              m.role==='user'
                ? 'bg-blue-600 text-white rounded-tr-none py-3'
                : 'bg-[#1a1f2e] text-gray-200 border border-white/10 rounded-tl-none py-3'
            }`}>
              <div className="leading-relaxed text-sm space-y-0.5">
                {m.role==='assistant' ? renderMarkdown(m.content) : m.content}
              </div>

              {m.actions && m.actions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-2">Actions Executed</p>
                  <div className="space-y-2">
                    {m.actions.map((act: any, idx: number) => (
                      <div key={idx} className={`rounded-lg px-3 py-2 border text-xs ${
                        SCHEDULE_MUTATING_TOOLS.has(act.tool)
                          ? 'bg-blue-500/5 border-blue-500/20'
                          : 'bg-white/3 border-white/5'
                      }`}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span>{getActionIcon(act.tool)}</span>
                          <span className={`font-semibold font-mono ${getActionColor(act.tool)}`}>{act.tool}</span>
                          {SCHEDULE_MUTATING_TOOLS.has(act.tool) && (
                            <span className="ml-auto text-[9px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full font-semibold">LIVE</span>
                          )}
                        </div>
                        {act.result && (
                          <p className="text-gray-400 leading-snug mt-0.5">
                            {typeof act.result==='string' ? act.result : JSON.stringify(act.result)}
                          </p>
                        )}
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
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay:'0ms'}}/>
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay:'150ms'}}/>
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay:'300ms'}}/>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestion chips */}
      <div className="px-6 pb-2 flex gap-2 flex-wrap flex-shrink-0">
        {SUGGESTIONS.map(s => (
          <button key={s} onClick={()=>send(s)} disabled={loading}
            className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-40 text-gray-400 border border-white/5 transition-colors">
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="px-6 pb-6 pt-2 flex-shrink-0">
        <div className="relative flex items-end gap-2">
          <textarea
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={isRecording ? 'Listening... speak now' : 'e.g. "Move WO-001 to Monday 9am" or "What\'s free on Friday?"'}
            className={`flex-1 text-gray-200 text-sm rounded-xl pl-4 pr-4 py-3 border outline-none resize-none transition-colors ${
              isRecording
                ? 'bg-red-950/30 border-red-500/50'
                : 'bg-[#1a1f2e] border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20'
            }`}
            rows={2}
          />
          <button onClick={toggleVoice} disabled={loading}
            title={isRecording?'Stop recording':'Start voice input'}
            className={`p-3 rounded-xl border transition-all ${
              isRecording
                ? 'bg-red-600 border-red-500 text-white shadow-lg shadow-red-500/30 scale-110'
                : 'bg-[#1a1f2e] border-white/10 text-gray-400 hover:text-white hover:border-white/30'
            }`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
              fill={isRecording?'currentColor':'none'} stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
          <button onClick={()=>send(input)} disabled={!input.trim()||loading}
            className="p-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-center text-gray-600 mt-2">Groq · Llama 3.3 · Voice via Web Speech API · Schedule changes sync live</p>
      </div>
    </div>
  )
}
