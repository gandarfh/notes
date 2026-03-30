import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../../store'
import { meetingAPI } from '../../bridge/api/meeting'
import type { ChatMessage, Meeting } from '../../bridge/wails'
import './MeetingChat.css'

const ChatIcon = () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H7l-4 3V5a1 1 0 0 1 1-1z" />
        <line x1="7" y1="8" x2="13" y2="8" />
        <line x1="7" y1="11" x2="11" y2="11" />
    </svg>
)

const CloseIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="4" y1="4" x2="12" y2="12" />
        <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
)

export function MeetingChat() {
    const pageId = useAppStore(s => s.activePageId)
    const [meeting, setMeeting] = useState<Meeting | null>(null)
    const [open, setOpen] = useState(false)
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    // Check if current page is a meeting page
    useEffect(() => {
        if (!pageId) {
            setMeeting(null)
            return
        }
        meetingAPI.getMeetingByPageID(pageId)
            .then(m => setMeeting(m))
            .catch(() => setMeeting(null))
    }, [pageId])

    // Load chat history when opening
    useEffect(() => {
        if (open && meeting) {
            meetingAPI.getRefinementChat(meeting.id)
                .then(msgs => setMessages(msgs || []))
                .catch(() => setMessages([]))
        }
    }, [open, meeting])

    // Auto-scroll on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, loading])

    // Focus input when opening
    useEffect(() => {
        if (open) setTimeout(() => inputRef.current?.focus(), 100)
    }, [open])

    const handleSend = useCallback(async () => {
        const text = input.trim()
        if (!text || !meeting || loading) return

        setInput('')
        setMessages(prev => [...prev, { role: 'user', content: text }])
        setLoading(true)

        try {
            const response = await meetingAPI.refineMeeting(meeting.id, text)
            setMessages(prev => [...prev, { role: 'assistant', content: response }])
        } catch (e: any) {
            setMessages(prev => [...prev, { role: 'assistant', content: `Erro: ${e?.message || 'falha na requisição'}` }])
        } finally {
            setLoading(false)
        }
    }, [input, meeting, loading])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }, [handleSend])

    // Don't render if not a meeting page
    if (!meeting) return null

    // Floating action button
    if (!open) {
        return (
            <button
                className="mtg-chat-fab"
                onClick={() => setOpen(true)}
                title="Refinar reunião via chat"
            >
                <ChatIcon />
            </button>
        )
    }

    // Chat panel
    return (
        <div className="mtg-chat-panel">
            <div className="mtg-chat-header">
                <span className="mtg-chat-header__title">{meeting.title}</span>
                <button className="mtg-chat-close" onClick={() => setOpen(false)}>
                    <CloseIcon />
                </button>
            </div>

            <div className="mtg-chat-messages">
                {messages.length === 0 && !loading && (
                    <div className="mtg-chat-empty">
                        Corrija informações, adicione contexto ou peça mudanças nos action items.
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div
                        key={i}
                        className={`mtg-chat-msg mtg-chat-msg--${msg.role}`}
                    >
                        {stripUpdatesBlock(msg.content)}
                    </div>
                ))}
                {loading && (
                    <div className="mtg-chat-msg mtg-chat-msg--loading">
                        Pensando...
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="mtg-chat-input-row">
                <textarea
                    ref={inputRef}
                    className="mtg-chat-input"
                    placeholder="Ex: O Pedro não vai fazer isso, é do Lucas"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                />
                <button
                    className="mtg-chat-send"
                    onClick={handleSend}
                    disabled={!input.trim() || loading}
                >
                    Enviar
                </button>
            </div>
        </div>
    )
}

// Strip the JSON updates block from the assistant message for display
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
