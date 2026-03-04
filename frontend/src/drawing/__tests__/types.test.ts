import { describe, it, expect } from 'vitest'
import { snap, GRID, getElementBounds, isArrowType } from '../types'
import { makeElement, makeArrow, makeOrthoArrow } from './fixtures'

describe('snap', () => {
    it('rounds to nearest grid multiple', () => {
        expect(snap(47)).toBe(60)   // 47/30 = 1.57 → round to 2 → 60
        expect(snap(15)).toBe(30)   // 15/30 = 0.5 → round to 0 or 1 depending on Math.round tie
        expect(snap(0)).toBe(0)
        expect(snap(30)).toBe(30)
        expect(snap(44)).toBe(30)   // 44/30 = 1.47 → round to 1 → 30
    })

    it('handles negative values', () => {
        expect(snap(-47)).toBe(-60)
        expect(snap(-15)).toBe(-0)  // -15/30 = -0.5 → Math.round → -0 (JS IEEE 754)
    })

    it('uses GRID constant (30)', () => {
        expect(GRID).toBe(30)
    })
})

describe('getElementBounds', () => {
    it('returns x/y/w/h for shapes without points', () => {
        const el = makeElement({ x: 50, y: 60, width: 200, height: 100 })
        expect(getElementBounds(el)).toEqual({ x: 50, y: 60, w: 200, h: 100 })
    })

    it('computes bounding box from points', () => {
        const el = makeArrow({ x: 10, y: 20, points: [[0, 0], [100, 50], [50, -30]] })
        const bounds = getElementBounds(el)
        expect(bounds.x).toBe(10)       // 10 + min(0, 100, 50) = 10
        expect(bounds.y).toBe(-10)      // 20 + min(0, 50, -30) = -10
        expect(bounds.w).toBe(100)      // max(0,100,50) - min(0,100,50) = 100
        expect(bounds.h).toBe(80)       // max(0,50,-30) - min(0,50,-30) = 80
    })

    it('handles single point', () => {
        const el = makeArrow({ x: 5, y: 10, points: [[0, 0]] })
        const bounds = getElementBounds(el)
        expect(bounds).toEqual({ x: 5, y: 10, w: 0, h: 0 })
    })
})

describe('isArrowType', () => {
    it('returns true for arrow types', () => {
        expect(isArrowType(makeElement({ type: 'arrow' }))).toBe(true)
        expect(isArrowType(makeElement({ type: 'ortho-arrow' }))).toBe(true)
    })

    it('returns false for non-arrow types', () => {
        expect(isArrowType(makeElement({ type: 'rectangle' }))).toBe(false)
        expect(isArrowType(makeElement({ type: 'ellipse' }))).toBe(false)
        expect(isArrowType(makeElement({ type: 'text' }))).toBe(false)
        expect(isArrowType(makeElement({ type: 'freedraw' }))).toBe(false)
        expect(isArrowType(makeElement({ type: 'group' }))).toBe(false)
    })
})
