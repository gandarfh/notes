import { useRef, useEffect, useCallback } from 'react'
import type { EditorRequest } from '../../drawing/interfaces'

interface InlineEditorProps {
    request: EditorRequest
    onClose: () => void
}

/**
 * Inline text editor for drawing elements.
 * Uses contentEditable — rendered inside the viewport transform layer in world coords.
 *
 * Initial content is set ONCE via useEffect (not dangerouslySetInnerHTML)
 * so React never resets user edits on parent re-renders.
 */
export function InlineEditor({ request, onClose }: InlineEditorProps) {
    const editorRef = useRef<HTMLDivElement>(null)
    const wrapperRef = useRef<HTMLDivElement>(null)

    const { worldX, worldY, initialText, onCommit } = request

    const fontSize = request.fontSize || 16
    const fontFamily = request.fontFamily
        ? `${request.fontFamily}, system-ui, sans-serif`
        : 'Inter, system-ui, sans-serif'
    const fontWeight = request.fontWeight || 400
    const textColor = request.textColor || getComputedStyle(document.documentElement).getPropertyValue('--color-text-primary').trim() || '#e8e8f0'
    const isCenter = (request.textAlign || 'center') === 'center'

    // Set initial content once on mount — never let React touch the DOM after this
    useEffect(() => {
        const el = editorRef.current
        if (!el) return
        el.innerHTML = initialText.replace(/\n/g, '<br>')
        setTimeout(() => {
            el.focus()
            const range = document.createRange()
            range.selectNodeContents(el)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
        }, 0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []) // intentionally empty — mount only

    const done = useRef(false)

    const commit = useCallback(() => {
        if (done.current) return
        done.current = true
        // Extract text preserving empty lines
        const el = editorRef.current
        let val = ''
        if (el) {
            const nodes = el.childNodes
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i]
                if (node.nodeType === Node.TEXT_NODE) {
                    val += node.textContent || ''
                } else if (node.nodeName === 'BR') {
                    val += '\n'
                } else if (node.nodeName === 'DIV') {
                    if (i > 0) val += '\n'
                    val += node.textContent || ''
                }
            }
        }
        val = val.replace(/^\n+/, '').replace(/\n+$/, '')
        onCommit(val)
        onClose()
    }, [onCommit, onClose])

    const cancel = useCallback(() => {
        if (done.current) return
        done.current = true
        request.onCancel?.()
        onClose()
    }, [onClose, request])

    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                commit()
            }
        }
        const timer = setTimeout(() => {
            window.addEventListener('mousedown', onMouseDown, true)
        }, 100)
        return () => {
            clearTimeout(timer)
            window.removeEventListener('mousedown', onMouseDown, true)
        }
    }, [commit])

    const handleKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() }
        if (e.key === 'Escape') { e.preventDefault(); cancel() }
    }

    const textStyle: React.CSSProperties = {
        minWidth: 20,
        maxWidth: request.shapeWidth || 600,
        color: textColor,
        fontSize,
        fontFamily,
        fontWeight,
        lineHeight: 1.3,
        textAlign: isCenter ? 'center' : 'left',
        outline: 'none',
        background: 'transparent',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        caretColor: '#818cf8',
        padding: '2px 4px',
        margin: '-2px -4px',
        border: '1px solid rgba(129, 140, 248, 0.15)',
        borderRadius: 2,
        boxShadow: 'none',
    }

    // For shapes: flex container matching shape dims
    if (isCenter && request.shapeWidth && request.shapeHeight) {
        return (
            <div
                ref={wrapperRef}
                style={{
                    position: 'absolute',
                    left: worldX,
                    top: worldY,
                    width: request.shapeWidth,
                    height: request.shapeHeight,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'auto',
                    zIndex: 9999,
                }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    style={textStyle}
                    onKeyDown={handleKeyDown}
                />
            </div>
        )
    }

    // For standalone text or arrow labels without shape container
    return (
        <div
            ref={wrapperRef}
            style={{
                position: 'absolute',
                left: worldX,
                top: isCenter ? worldY : worldY - fontSize * 0.85,
                transform: isCenter ? 'translate(-50%, -50%)' : undefined,
                pointerEvents: 'auto',
                zIndex: 9999,
            }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                style={textStyle}
                onKeyDown={handleKeyDown}
            />
        </div>
    )
}
