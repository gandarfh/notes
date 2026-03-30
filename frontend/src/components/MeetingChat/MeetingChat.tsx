import { useState, useEffect, useRef, useCallback } from 'react'
import { meetingAPI } from '../../bridge/api/meeting'
import type { ChatMessage, Meeting } from '../../bridge/wails'
import './MeetingChat.css'

const SendIcon = () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2.5 2L14 8 2.5 14V9.5L9 8 2.5 6.5z" />
    </svg>
)

const EmptyIcon = () => (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
        <path d="M6 8h20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H12l-6 4V10a2 2 0 0 1 2-2z" />
        <line x1="11" y1="14" x2="21" y2="14" />
        <line x1="11" y1="18" x2="17" y2="18" />
    </svg>
)

interface MeetingChatPanelProps {
    meeting: Meeting
}

export function MeetingChatPanel({ meeting }: MeetingChatPanelProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    // Load chat history
    useEffect(() => {
        meetingAPI.getRefinementChat(meeting.id)
            .then(msgs => setMessages(msgs || []))
            .catch(() => setMessages([]))
    }, [meeting.id])

    // Auto-scroll
    useEffect(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [messages, loading])

    // Focus input on mount
    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 150)
    }, [])

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value)
        const el = e.target
        el.style.height = 'auto'
        el.style.height = Math.min(el.scrollHeight, 96) + 'px'
    }, [])

    const handleSend = useCallback(async () => {
        const text = input.trim()
        if (!text || loading) return

        setInput('')
        if (inputRef.current) inputRef.current.style.height = 'auto'
        setMessages(prev => [...prev, { role: 'user', content: text }])
        setLoading(true)

        try {
            const response = await meetingAPI.refineMeeting(meeting.id, text)
            setMessages(prev => [...prev, { role: 'assistant', content: response }])
        } catch (e: any) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `Erro: ${e?.message || 'falha na requisição'}`,
            }])
        } finally {
            setLoading(false)
        }
    }, [input, meeting.id, loading])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }, [handleSend])

    return (
        <div className="mtg-chat-panel">
            <div className="mtg-chat-scroll" ref={scrollRef}>
                {messages.length === 0 && !loading && (
                    <div className="mtg-chat-empty">
                        <div className="mtg-chat-empty__icon"><EmptyIcon /></div>
                        <div className="mtg-chat-empty__text">
                            Corrija informações, adicione contexto<br />
                            ou peça mudanças nos action items.
                        </div>
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div key={i} className={`mtg-chat-msg mtg-chat-msg--${msg.role}`}>
                        {msg.role === 'assistant' ? stripUpdatesBlock(msg.content) : msg.content}
                    </div>
                ))}
                {loading && (
                    <div className="mtg-chat-msg mtg-chat-msg--loading">
                        <div className="mtg-chat-dot" />
                        <div className="mtg-chat-dot" />
                        <div className="mtg-chat-dot" />
                    </div>
                )}
            </div>

            <div className="mtg-chat-composer">
                <div className="mtg-chat-input-box">
                    <textarea
                        ref={inputRef}
                        className="mtg-chat-input"
                        placeholder="Responder..."
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        rows={1}
                    />
                    <button
                        className="mtg-chat-send"
                        onClick={handleSend}
                        disabled={!input.trim() || loading}
                    >
                        <SendIcon />
                    </button>
                </div>
            </div>
        </div>
    )
}

// ── Toggle button for the board header ───────────────────────

export function MeetingChatToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
    return (
        <button
            className={`mtg-chat-toggle ${active ? 'active' : ''}`}
            onClick={onClick}
            title="Refinar reunião"
        >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 4h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-4 2.5V5a1 1 0 0 1 1-1z" />
            </svg>
            Refinar
        </button>
    )
}

// ── Hook: check if page is a meeting ─────────────────────────

export function useMeetingForPage(pageId: string | null): Meeting | null {
    const [meeting, setMeeting] = useState<Meeting | null>(null)

    useEffect(() => {
        if (!pageId) {
            setMeeting(null)
            return
        }
        meetingAPI.getMeetingByPageID(pageId)
            .then(m => setMeeting(m))
            .catch(() => setMeeting(null))
    }, [pageId])

    return meeting
}

// ── Helpers ──────────────────────────────────────────────────

function stripUpdatesBlock(text: string): string {
    const start = text.indexOf('{"updates"')
    if (start === -1) return text
    let depth = 0
    let end = -1
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') {
            depth--
            if (depth === 0) { end = i + 1; break }
        }
    }
    if (end === -1) return text
    return (text.slice(0, start) + text.slice(end)).trim()
}
