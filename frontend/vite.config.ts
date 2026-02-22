import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
    ],
    define: {
        'process.env': {},
        'process.browser': true,
    },
    resolve: {
        alias: {
            buffer: 'buffer/',
        },
    },
    optimizeDeps: {
        include: ['buffer', 'bson'],
    },
    build: {
        commonjsOptions: {
            transformMixedEsModules: true,
        },
    },
})
