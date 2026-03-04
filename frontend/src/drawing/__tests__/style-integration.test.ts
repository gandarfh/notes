import { describe, it, expect } from 'vitest'
import { elementTypeCategory, getCommon, stylePanelSections, applyStylePatch } from '../types'
import { makeElement, makeArrow, makeOrthoArrow } from './fixtures'

// ── elementTypeCategory ──────────────────────────────────

describe('elementTypeCategory', () => {
    it('maps rectangle to rectangle', () => {
        expect(elementTypeCategory('rectangle')).toBe('rectangle')
    })

    it('maps ellipse to ellipse', () => {
        expect(elementTypeCategory('ellipse')).toBe('ellipse')
    })

    it('maps diamond to diamond', () => {
        expect(elementTypeCategory('diamond')).toBe('diamond')
    })

    it('maps arrow to arrow', () => {
        expect(elementTypeCategory('arrow')).toBe('arrow')
    })

    it('maps ortho-arrow to arrow', () => {
        expect(elementTypeCategory('ortho-arrow')).toBe('arrow')
    })

    it('maps line to arrow', () => {
        expect(elementTypeCategory('line')).toBe('arrow')
    })

    it('maps text to text', () => {
        expect(elementTypeCategory('text')).toBe('text')
    })

    it('maps freedraw to freedraw', () => {
        expect(elementTypeCategory('freedraw')).toBe('freedraw')
    })

    it('maps unknown types to rectangle (default)', () => {
        expect(elementTypeCategory('unknown')).toBe('rectangle')
        expect(elementTypeCategory('group')).toBe('rectangle')
        expect(elementTypeCategory('')).toBe('rectangle')
    })
})

// ── getCommon ─────────────────────────────────────────────

describe('getCommon', () => {
    it('returns common value when all elements share it', () => {
        const els = [
            makeElement({ strokeColor: '#fff' }),
            makeElement({ strokeColor: '#fff' }),
        ]
        expect(getCommon(els, 'strokeColor')).toBe('#fff')
    })

    it('returns undefined when values differ', () => {
        const els = [
            makeElement({ strokeColor: '#fff' }),
            makeElement({ strokeColor: '#000' }),
        ]
        expect(getCommon(els, 'strokeColor')).toBeUndefined()
    })

    it('returns undefined for empty array', () => {
        expect(getCommon([], 'strokeColor')).toBeUndefined()
    })

    it('returns value for single element', () => {
        const els = [makeElement({ fontSize: 24 })]
        expect(getCommon(els, 'fontSize')).toBe(24)
    })

    it('returns undefined when all have undefined for key', () => {
        const els = [makeElement(), makeElement()]
        // textColor is not set in makeElement defaults
        expect(getCommon(els, 'textColor')).toBeUndefined()
    })
})

// ── stylePanelSections ────────────────────────────────────

describe('stylePanelSections', () => {
    it('detects shapes for rectangle', () => {
        const s = stylePanelSections([makeElement({ type: 'rectangle' })])
        expect(s.hasShapes).toBe(true)
        expect(s.hasArrows).toBe(false)
        expect(s.hasText).toBe(false)
        expect(s.onlyText).toBe(false)
    })

    it('detects arrows', () => {
        const s = stylePanelSections([makeArrow()])
        expect(s.hasShapes).toBe(false)
        expect(s.hasArrows).toBe(true)
    })

    it('detects text-only selection', () => {
        const s = stylePanelSections([makeElement({ type: 'text' })])
        expect(s.hasText).toBe(true)
        expect(s.onlyText).toBe(true)
    })

    it('detects hasText for rectangle with text property', () => {
        const s = stylePanelSections([makeElement({ type: 'rectangle', text: 'hello' })])
        expect(s.hasShapes).toBe(true)
        expect(s.hasText).toBe(true)
        expect(s.onlyText).toBe(false)
    })

    it('detects hasText for arrow with label', () => {
        const s = stylePanelSections([makeArrow({ label: 'yes' })])
        expect(s.hasArrows).toBe(true)
        expect(s.hasText).toBe(true)
    })

    it('detects mixed selection (rect + arrow)', () => {
        const s = stylePanelSections([makeElement({ type: 'rectangle' }), makeArrow()])
        expect(s.hasShapes).toBe(true)
        expect(s.hasArrows).toBe(true)
    })

    it('detects mixed selection (text + rect) is not onlyText', () => {
        const s = stylePanelSections([makeElement({ type: 'text' }), makeElement({ type: 'rectangle' })])
        expect(s.hasShapes).toBe(true)
        expect(s.hasText).toBe(true)
        expect(s.onlyText).toBe(false)
    })

    it('returns all false for empty array', () => {
        const s = stylePanelSections([])
        expect(s.hasShapes).toBe(false)
        expect(s.hasArrows).toBe(false)
        expect(s.hasText).toBe(false)
        expect(s.onlyText).toBe(false)
        expect(s.hasRect).toBe(false)
    })

    it('detects hasRect only for rectangles', () => {
        expect(stylePanelSections([makeElement({ type: 'rectangle' })]).hasRect).toBe(true)
        expect(stylePanelSections([makeElement({ type: 'ellipse' })]).hasRect).toBe(false)
        expect(stylePanelSections([makeElement({ type: 'diamond' })]).hasRect).toBe(false)
    })

    it('detects ortho-arrow as arrow', () => {
        const s = stylePanelSections([makeOrthoArrow()])
        expect(s.hasArrows).toBe(true)
    })
})

// ── applyStylePatch ───────────────────────────────────────

describe('applyStylePatch', () => {
    it('applies patch only to selected elements', () => {
        const rect = makeElement({ id: 'r1', type: 'rectangle', strokeColor: '#fff' })
        const arrow = makeArrow({ id: 'a1', strokeColor: '#fff' })
        const elements = [rect, arrow]

        applyStylePatch(elements, new Set(['r1']), { strokeColor: '#f00' })

        expect(rect.strokeColor).toBe('#f00')
        expect(arrow.strokeColor).toBe('#fff') // unchanged
    })

    it('applies patch to multi-selection and returns affected types', () => {
        const rect = makeElement({ id: 'r1', type: 'rectangle' })
        const arrow = makeArrow({ id: 'a1' })
        const elements = [rect, arrow]

        const { affectedTypes } = applyStylePatch(elements, new Set(['r1', 'a1']), { strokeColor: '#0f0' })

        expect(rect.strokeColor).toBe('#0f0')
        expect(arrow.strokeColor).toBe('#0f0')
        expect(affectedTypes).toEqual(new Set(['rectangle', 'arrow']))
    })

    it('does nothing for non-existent IDs', () => {
        const rect = makeElement({ id: 'r1', strokeColor: '#fff' })

        const { affectedTypes } = applyStylePatch([rect], new Set(['missing']), { strokeColor: '#f00' })

        expect(rect.strokeColor).toBe('#fff')
        expect(affectedTypes.size).toBe(0)
    })

    it('does not overwrite fields not in patch', () => {
        const rect = makeElement({ id: 'r1', fontSize: 24, strokeColor: '#fff' })

        applyStylePatch([rect], new Set(['r1']), { strokeColor: '#f00' })

        expect(rect.strokeColor).toBe('#f00')
        expect(rect.fontSize).toBe(24) // preserved
    })
})
