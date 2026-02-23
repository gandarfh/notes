import { useCallback, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql, SQLite, MySQL, PostgreSQL } from '@codemirror/lang-sql'
import { javascript } from '@codemirror/lang-javascript'
import { keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete'
import { vim } from '@replit/codemirror-vim'
import { QUERY_OPERATORS, BSON_TYPES, STAGE_OPERATORS, EXPRESSION_OPERATORS, ACCUMULATORS } from '@mongodb-js/mongodb-constants'
import { useTheme } from '../../hooks/useTheme'
import type { SchemaInfo } from '../../bridge/wails'

interface QueryEditorProps {
    value: string
    onChange: (value: string) => void
    onExecute: () => void
    driver: string
    schema: SchemaInfo | null
    placeholder?: string
    selectedCollection?: string
}

// ── SQL helpers ────────────────────────────────────────────

function buildCMSchema(schema: SchemaInfo | null): Record<string, string[]> {
    if (!schema?.tables) return {}
    const result: Record<string, string[]> = {}
    for (const table of schema.tables) {
        result[table.name] = (table.columns || []).map(c => c.name)
    }
    return result
}

function getDialect(driver: string) {
    switch (driver) {
        case 'mysql': return MySQL
        case 'postgres': return PostgreSQL
        default: return SQLite
    }
}

// ── MongoDB autocomplete (built from @mongodb-js/mongodb-constants) ──

const MONGO_COMPLETIONS: Completion[] = [
    // Query operators ($eq, $gt, $in, $and, etc.)
    ...QUERY_OPERATORS.map((op: any) => ({
        label: op.name,
        type: 'keyword',
        detail: 'query',
        info: op.description,
        boost: 1,
    })),
    // BSON types (ObjectId, ISODate, etc.)
    ...BSON_TYPES.map((bt: any) => ({
        label: bt.name,
        type: 'type',
        detail: 'bson',
        info: bt.description,
        apply: bt.snippet?.replace(/\$\{\d+:?([^}]*)}/g, '$1') || bt.value,
        boost: 2,
    })),
    // Aggregation stage operators ($match, $group, $project, etc.)
    ...STAGE_OPERATORS.map((so: any) => ({
        label: so.name,
        type: 'keyword',
        detail: 'stage',
        info: so.description,
        boost: 0,
    })),
    // Expression operators ($add, $concat, $cond, etc.)
    ...EXPRESSION_OPERATORS.map((eo: any) => ({
        label: eo.name,
        type: 'keyword',
        detail: 'expression',
        info: eo.description,
        boost: -1,
    })),
    // Accumulators ($sum, $avg, $first, etc.)
    ...ACCUMULATORS.map((ac: any) => ({
        label: ac.name,
        type: 'keyword',
        detail: 'accumulator',
        info: ac.description,
        boost: -1,
    })),
]

// ── Component ──────────────────────────────────────────────

export function QueryEditor({ value, onChange, onExecute, driver, schema, placeholder, selectedCollection }: QueryEditorProps) {
    const isMongo = driver === 'mongodb'
    const { theme } = useTheme()

    const handleChange = useCallback((val: string) => {
        onChange(val)
    }, [onChange])

    const executeKeymap = useMemo(() => keymap.of([{
        key: 'Ctrl-Enter',
        run: () => { onExecute(); return true },
    }, {
        key: 'Cmd-Enter',
        run: () => { onExecute(); return true },
    }]), [onExecute])

    const extensions = useMemo(() => {
        const ext: any[] = [executeKeymap, vim()]
        if (placeholder) ext.push(cmPlaceholder(placeholder))

        if (isMongo) {
            // JavaScript mode for MongoDB shell syntax (ObjectId, ISODate, unquoted keys)
            ext.push(javascript())

            // Build completions: operators + BSON types + schema fields
            const fieldCompletions: Completion[] = []
            if (schema?.tables && selectedCollection) {
                const coll = schema.tables.find(t => t.name === selectedCollection)
                if (coll?.columns) {
                    for (const col of coll.columns) {
                        fieldCompletions.push({
                            label: col.name,
                            type: 'property',
                            detail: col.type || 'field',
                            boost: 3,
                        })
                    }
                }
            }

            const allOptions = [...fieldCompletions, ...MONGO_COMPLETIONS]

            ext.push(autocompletion({
                override: [(context: CompletionContext) => {
                    const word = context.matchBefore(/[\w$]*/)
                    if (!word || (word.from === word.to && !context.explicit)) return null
                    return { from: word.from, options: allOptions, validFor: /^[\w$]*$/ }
                }],
            }))
        } else {
            // SQL mode
            const dialect = getDialect(driver)
            const cmSchema = buildCMSchema(schema)
            ext.push(sql({ dialect, schema: cmSchema }))

            // Context-aware autocomplete for SQL (schema + keywords)
            const SQL_KEYWORDS: Completion[] = [
                'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
                'DELETE', 'DROP', 'CREATE', 'ALTER', 'TABLE', 'INDEX', 'VIEW',
                'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'ON',
                'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL',
                'AS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
                'ASC', 'DESC', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
                'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
                'UNION', 'ALL', 'INTERSECT', 'EXCEPT',
                'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT',
                'DEFAULT', 'CHECK', 'UNIQUE', 'CASCADE',
                'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
                'GRANT', 'REVOKE', 'TRUNCATE', 'EXPLAIN', 'ANALYZE',
                'IF', 'REPLACE', 'COALESCE', 'CAST', 'CONVERT',
                'INTEGER', 'TEXT', 'REAL', 'BLOB', 'VARCHAR', 'BOOLEAN', 'DATE', 'TIMESTAMP',
            ].map(kw => ({ label: kw, type: 'keyword', detail: 'SQL', boost: -2 }))

            if (schema?.tables?.length) {
                const tableMap = new Map<string, Completion[]>()
                const tableCompletions: Completion[] = []

                for (const table of schema.tables) {
                    tableCompletions.push({
                        label: table.name,
                        type: 'type',
                        detail: 'table',
                        boost: 2,
                    })
                    const cols: Completion[] = (table.columns || []).map(c => ({
                        label: c.name,
                        type: 'property',
                        detail: `${table.name} · ${c.type || 'column'}`,
                    }))
                    tableMap.set(table.name.toLowerCase(), cols)
                }

                const allCols: Completion[] = []
                const seen = new Set<string>()
                for (const table of schema.tables) {
                    for (const col of (table.columns || [])) {
                        if (!seen.has(col.name)) {
                            seen.add(col.name)
                            allCols.push({
                                label: col.name,
                                type: 'property',
                                detail: col.type || 'column',
                                boost: -1,
                            })
                        }
                    }
                }

                ext.push(autocompletion({
                    override: [(context: CompletionContext) => {
                        const word = context.matchBefore(/\w*/)
                        if (!word || (word.from === word.to && !context.explicit)) return null

                        const fullText = context.state.doc.toString().toLowerCase()
                        const tableRefs = new Set<string>()
                        const patterns = [
                            /\bfrom\s+(\w+)/gi,
                            /\bjoin\s+(\w+)/gi,
                            /\bupdate\s+(\w+)/gi,
                            /\binto\s+(\w+)/gi,
                        ]
                        for (const pattern of patterns) {
                            let match
                            while ((match = pattern.exec(fullText)) !== null) {
                                tableRefs.add(match[1].toLowerCase())
                            }
                        }

                        let options: Completion[]
                        if (tableRefs.size > 0) {
                            const contextCols: Completion[] = []
                            for (const ref of tableRefs) {
                                const cols = tableMap.get(ref)
                                if (cols) contextCols.push(...cols)
                            }
                            options = [...contextCols, ...tableCompletions, ...SQL_KEYWORDS]
                        } else {
                            options = [...tableCompletions, ...allCols, ...SQL_KEYWORDS]
                        }

                        return { from: word.from, options, validFor: /^\w*$/ }
                    }],
                }))
            } else {
                // No schema yet — still provide SQL keyword completions
                ext.push(autocompletion({
                    override: [(context: CompletionContext) => {
                        const word = context.matchBefore(/\w*/)
                        if (!word || (word.from === word.to && !context.explicit)) return null
                        return { from: word.from, options: SQL_KEYWORDS, validFor: /^\w*$/ }
                    }],
                }))
            }
        }
        return ext
    }, [isMongo, driver, schema, executeKeymap, placeholder, selectedCollection])

    return (
        <div className="h-full flex flex-col relative">
            <CodeMirror
                value={value}
                onChange={handleChange}
                extensions={extensions}
                theme={theme}
                basicSetup={{
                    lineNumbers: true,
                    foldGutter: false,
                    highlightActiveLine: true,
                    autocompletion: !isMongo,
                }}
                height="100%"
                style={{ height: '100%', fontSize: '14px' }}
            />
            <div className="absolute bottom-1.5 right-3 text-[11px] text-text-muted/40 pointer-events-none select-none">
                {isMongo ? 'MQL' : 'SQL'} · ⌘ Enter to run
            </div>
        </div>
    )
}
