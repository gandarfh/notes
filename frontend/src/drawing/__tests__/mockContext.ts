import { vi } from 'vitest'
import type { DrawingContext } from '../interfaces'
import type { ElementStyleDefaults } from '../../store/types'

const defaultStyle: ElementStyleDefaults = {
    strokeColor: '#000',
    strokeWidth: 2,
    backgroundColor: 'transparent',
    fontSize: 14,
    fontFamily: 'sans-serif',
    fontWeight: 400,
    textColor: '#000',
    borderRadius: 0,
    opacity: 1,
    fillStyle: 'solid',
    strokeDasharray: '',
    textAlign: 'center',
    verticalAlign: 'middle',
}

export function makeMockContext(overrides?: Partial<DrawingContext>): DrawingContext {
    return {
        elements: [],
        selectedElement: null,
        currentElement: null,
        blockRects: [],
        getSelectedBlockIds: () => [],
        selectedElements: new Set(),
        clipboard: [],
        snap: (v: number) => Math.round(v / 30) * 30,
        snapElement: (v: number) => Math.round(v / 30) * 30,
        grid: () => 30,
        setSubTool: vi.fn(),
        render: vi.fn(),
        save: vi.fn(),
        saveNow: vi.fn(),
        showEditor: vi.fn(),
        isEditing: false,
        isSketchy: false,
        getScreenCoords: (wx, wy) => ({ x: wx, y: wy }),
        getZoom: () => 1,
        setBlockPreview: vi.fn(),
        setCursor: vi.fn(),
        getDefaults: () => ({ ...defaultStyle }),
        setDefaults: vi.fn(),
        ...overrides,
    }
}
