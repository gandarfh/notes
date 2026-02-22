// Polyfill Node.js Buffer for bson/mongodb-query-parser in production builds
import { Buffer } from 'buffer'
    ; (globalThis as any).Buffer = Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerBuiltinPlugins } from './plugins'
import { App } from './App'
import './styles/main.css'

// Register all built-in block plugins before React renders
registerBuiltinPlugins()

const root = document.getElementById('root')!
createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>
)
