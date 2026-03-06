import type { DrawingElement, Connection } from '../types'

const defaults: DrawingElement = {
    id: 'el_1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    strokeColor: '#000',
    strokeWidth: 2,
    backgroundColor: 'transparent',
}

export function makeElement(overrides: Partial<DrawingElement> = {}): DrawingElement {
    return { ...defaults, ...overrides }
}

export function makeArrow(overrides: Partial<DrawingElement> = {}): DrawingElement {
    return {
        ...defaults,
        id: 'arrow_1',
        type: 'arrow',
        points: [[0, 0], [200, 100]],
        width: 200,
        height: 100,
        ...overrides,
    }
}

export function makeOrthoArrow(overrides: Partial<DrawingElement> = {}): DrawingElement {
    return {
        ...defaults,
        id: 'ortho_1',
        type: 'ortho-arrow',
        points: [[0, 0], [100, 0], [100, 100], [200, 100]],
        width: 200,
        height: 100,
        ...overrides,
    }
}

export function makeFreedraw(overrides: Partial<DrawingElement> = {}): DrawingElement {
    return {
        ...defaults,
        id: 'fd_1',
        type: 'freedraw',
        points: [[0, 0], [10, 5], [20, 3], [30, 8]],
        width: 30,
        height: 8,
        ...overrides,
    }
}

export function makeConnection(overrides: Partial<Connection> = {}): Connection {
    return {
        elementId: 'el_1',
        side: 'right',
        t: 0.5,
        ...overrides,
    }
}
