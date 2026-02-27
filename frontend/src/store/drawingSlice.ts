import type { StateCreator } from 'zustand'
import { api } from '../bridge/wails'
import { persistBus } from '../bridge/persistBus'
import type { AppState, DrawingSlice, DrawingSubTool } from './types'
import { pushUndo } from './helpers'

export const createDrawingSlice: StateCreator<AppState, [], [], DrawingSlice> = (set, get) => ({
    drawingData: '',
    drawingSubTool: 'draw-select' as DrawingSubTool,
    boardStyle: (localStorage.getItem('boardStyle') as 'clean' | 'sketchy') || 'clean',
    styleDefaults: (() => {
        const base = {
            strokeColor: '#e0e0e0', strokeWidth: 2, backgroundColor: 'transparent',
            fontSize: 14, fontFamily: 'Inter', fontWeight: 400, textColor: '#e0e0e0',
            borderRadius: 0, opacity: 1, fillStyle: 'hachure',
            strokeDasharray: '', textAlign: 'center', verticalAlign: 'center',
        }
        return {
            rectangle: { ...base },
            ellipse: { ...base },
            diamond: { ...base },
            arrow: { ...base },
            freedraw: { ...base },
            text: { ...base, fontSize: 16 },
        }
    })(),

    setDrawingData: (data) => set({ drawingData: data }),
    setDrawingSubTool: (tool) => set({ drawingSubTool: tool }),
    setBoardStyle: (style) => {
        localStorage.setItem('boardStyle', style)
        const fontCss = style === 'sketchy'
            ? "'Caveat', cursive"
            : "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
        document.documentElement.style.setProperty('--font-sans', fontCss)
        document.documentElement.style.fontSize = style === 'sketchy' ? '17px' : '13px'
        set({ boardStyle: style })
    },
    setStyleDefaults: (type, patch) => set(s => ({
        styleDefaults: { ...s.styleDefaults, [type]: { ...s.styleDefaults[type], ...patch } }
    })),
    getStyleDefaults: (type) => get().styleDefaults[type],

    saveDrawingData: () => {
        const { activePageId, drawingData } = get()
        if (!activePageId) return
        pushUndo(get, 'Drawing change')
        persistBus.emit('drawing', () =>
            api.updateDrawingData(activePageId, drawingData)
        )
    },
})
