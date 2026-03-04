import { defineConfig } from 'vitest/config'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
    ],
    test: {
        coverage: {
            provider: 'v8',
            include: ['src/drawing/**', 'src/store/**'],
            exclude: ['src/**/__tests__/**', 'src/**/*.test.ts', 'src/**/*.browser.test.ts'],
            reporter: ['json-summary'],
            reportsDirectory: './coverage',
        },
        projects: [
            {
                test: {
                    name: 'unit',
                    environment: 'node',
                    include: ['src/**/*.test.ts'],
                    exclude: ['src/**/*.browser.test.ts'],
                    setupFiles: ['src/test-setup.ts'],
                },
            },
            {
                test: {
                    name: 'browser',
                    include: ['src/**/*.browser.test.ts'],
                    setupFiles: ['src/browser-test-setup.ts'],
                    browser: {
                        enabled: true,
                        provider: playwright(),
                        headless: true,
                        instances: [{ browser: 'chromium' }],
                    },
                },
            },
        ],
    },
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
