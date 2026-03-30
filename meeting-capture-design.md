# Meeting Capture — System Design Document

**Version:** 2.0
**Author:** Joao
**Date:** 2026-03-29
**Status:** Draft — Ready for refinement
**Context:** Feature integrada ao projeto Notes (Wails v2 / Go + React/TypeScript)

---

## 1. Overview

Meeting Capture é uma feature do Notes que grava reuniões automaticamente, transcreve o áudio, analisa o conteúdo via LLM, e gera páginas estruturadas com resumo, action items, follow-ups e transcrição completa — tudo usando a infraestrutura existente do Notes (notebooks, board pages, document mode, LocalDB blocks).

### 1.1 O que faz

- Grava áudio de reuniões (sistema + microfone) no macOS
- Transcreve automaticamente via whisper.cpp após a call terminar
- Analisa transcript via Claude API: extrai resumo, decisões, action items, compromissos, follow-ups
- Cria automaticamente no Notes: notebook do dia → page da reunião (board/document) → conteúdo estruturado com LocalDB embeds
- Permite refinamento via chat: corrigir erros, adicionar contexto, atualizar action items
- Mostra indicador de gravação no toolbar do Notes

### 1.2 Princípios

- **Usa o que já existe:** notebooks, board pages, document mode, Tiptap, LocalDB, MCP tools
- **Batch processing:** não processa em real-time, grava durante a call e processa depois
- **Refinamento humano:** todo output auto-gerado pode ser corrigido via chat
- **Transparência:** indicador de gravação sempre visível quando ativo

### 1.3 Idiomas

- Reuniões podem ser em português BR ou espanhol (Uruguai, Argentina, Chile)
- Todos os outputs gerados são em português BR
- Whisper.cpp lida com ambos os idiomas na transcrição

---

## 2. Arquitetura

### 2.1 Novos componentes no Notes

```
internal/
  meeting/                          # NOVO — package de meeting capture
    recorder.go                     # Gravação de áudio (ScreenCaptureKit + mic)
    transcriber.go                  # whisper.cpp integration
    analyzer.go                     # Claude API — extrai dados estruturados

  service/
    meeting_service.go              # NOVO — orquestração do pipeline

  app/
    app_meeting.go                  # NOVO — RPC methods

  domain/
    meeting.go                      # NOVO — domain types

  storage/
    meeting.go                      # NOVO — persistência de meetings

  mcp/
    tools_meeting.go                # NOVO — MCP tools

frontend/
  src/components/
    RecordingIndicator/             # NOVO — indicador de gravação no toolbar
      RecordingIndicator.tsx
      RecordingIndicator.css
```

### 2.2 O que NÃO muda

- Nenhum plugin existente é afetado
- Canvas, drawing engine, MCP server — tudo continua igual
- Os notebooks/pages criados pelo Meeting Capture são notebooks normais editáveis
- Os LocalDB blocks de action items funcionam como qualquer outro LocalDB

### 2.3 Fluxo de dados

```
StartMeetingRecording("SDK Sync", ["Pedro", "Maria"])
    |
    v
recorder.Start() → salva em ~/.notes/audio/2026-03-29/sdk-sync-14h00.ogg
    |
    | (reunião acontece, indicador ativo no toolbar)
    |
StopMeetingRecording()
    |
    v
recorder.Stop() → retorna audioPath
    |
    v (goroutine em background)
transcriber.Transcribe(audioPath)
    → whisper.cpp (model: large)
    → Track 1 (sistema) → transcript dos outros
    → Track 2 (mic) → transcript do usuário
    → Merge por timestamp
    |
    v
analyzer.Analyze(transcript, participants)
    → Claude API com prompt de Meeting Analyzer
    → Retorna MeetingAnalysis (summary, action items, etc.)
    |
    v
meetingService.CreateMeetingPage(analysis)
    → findOrCreateNotebook("2026-03-29")
    → CreateBoardPage(notebookID, "SDK Sync 14h")
    → Cria LocalDB blocks (Action Items, Follow-ups)
    → Popula LocalDB rows
    → Monta BoardContent (HTML Tiptap com embeds)
    → UpdateBoardContent(pageID, html)
    |
    v
Emite evento "meeting:ready"
    → Frontend notifica: "SDK Sync processada. 3 action items."
```

---

## 3. Gravação de Áudio

### 3.1 Recorder (Go)

- Usa **ScreenCaptureKit** (macOS 13+) para capturar áudio do app de meeting (Chrome/Google Meet)
- Usa **AVFoundation** para capturar microfone
- Grava duas tracks separadas (permite diferenciar "eu" vs "outros")
- Output: arquivo OGG comprimido em `~/.notes/audio/{date}/{meeting-slug}.ogg`
- Gravação é leve — praticamente zero CPU

### 3.2 Organização dos arquivos

```
~/.notes/audio/
  2026-03-28/
    sdk-sync-14h00.ogg
    1on1-maria-16h00.ogg
  2026-03-29/
    planning-sprint-10h00.ogg
```

O usuário gerencia a limpeza manualmente quando o disco encher.

### 3.3 Indicador de Gravação (Toolbar do Notes)

Componente `RecordingIndicator` no toolbar do Notes. Estados:

```
🔴 REC 00:32:15     → Gravando (dot vermelho + tempo decorrido)
⏳ Processando...    → Call terminou, transcrevendo/analisando
✅ SDK Sync pronta   → Processada, clique pra abrir (auto-dismiss 30s)
⚠️ Erro no mic       → Gravação falhou
```

Comportamento:

- Aparece automaticamente quando gravação inicia
- Tempo decorrido atualiza a cada segundo (timer no frontend, não polling)
- Click abre dropdown com: nome da meeting, níveis de áudio (mic + sistema), botão parar, file size
- Se gravação falha mid-call, muda pra ⚠️ e envia notificação do sistema
- Quando gravação inicia, mostra notificação macOS: "Notes: Gravando 'SDK Sync' (mic + sistema)"

Implementação:

- Usa o mesmo pattern do Toast/ApprovalModal que já existe no Notes
- RecordingStatus vem do backend via WebSocket ou evento Wails
- Timer roda no frontend (TS), não no Go

---

## 4. Transcrição

### 4.1 Transcriber (Go)

- Chama **whisper.cpp** via exec (modelo `large` pra máxima qualidade)
- Processa em batch depois que a call termina (~5min pra 1h de call no M1+)
- Suporta PT-BR e espanhol
- Retorna `[]TranscriptSegment{Speaker, Text, StartTime, EndTime}`

### 4.2 Diarização (quem falou o quê)

- Duas tracks separadas (mic vs sistema) ajudam a identificar usuário vs outros
- Claude API mapeia "Speaker 1" → "Pedro" baseado no conteúdo + lista de participantes do Calendar

---

## 5. Análise (LLM)

### 5.1 Meeting Analyzer — Prompt

**System Prompt:**

```
Você é um assistente que analisa transcrições de reuniões de trabalho.
O usuário é um engenheiro de plataforma que trabalha com SDKs internas.

REGRAS:
- Responda SEMPRE em português brasileiro, independente do idioma da reunião.
- A transcrição pode conter trechos em português BR e espanhol
  (uruguaio, argentino, chileno). Interprete ambos corretamente.
- A transcrição vem do whisper.cpp e pode conter erros de transcrição.
  Use o contexto para inferir o que foi dito quando houver palavras
  estranhas ou sem sentido.
- Quando não tiver certeza de quem falou algo, use "[incerto]" como speaker.
- Diferencie claramente entre:
  - Coisas que o USUÁRIO se comprometeu a fazer
  - Coisas que OUTROS pediram pro usuário
  - Coisas que OUTROS se comprometeram a fazer
  - Decisões tomadas pelo grupo

FORMATO DE RESPOSTA (JSON estrito):
{
  "summary": "Resumo de 3-5 frases da reunião em português BR",
  "key_decisions": [
    {"text": "Decisão tomada", "context": "Trecho relevante do transcript"}
  ],
  "action_items": [
    {
      "text": "Descrição da ação",
      "assignee": "nome da pessoa | me | team",
      "due": "YYYY-MM-DD | null",
      "due_source": "explícito | inferido | null",
      "confidence": "high | medium | low",
      "source_quote": "Trecho do transcript que originou este item"
    }
  ],
  "my_commitments": [
    {
      "text": "O que me comprometi a fazer",
      "to_whom": "pessoa que pediu ou contexto",
      "due": "YYYY-MM-DD | null",
      "source_quote": "Trecho do transcript"
    }
  ],
  "follow_ups": [
    {
      "person": "nome",
      "topic": "O que preciso pedir/perguntar/cobrar",
      "context": "Por que preciso fazer isso"
    }
  ],
  "topics_discussed": ["tópico 1", "tópico 2"],
  "my_participation": {
    "spoke": true,
    "topics_i_raised": ["tópico que eu trouxe"],
    "opinions_i_gave": ["opinião que dei sobre X"]
  }
}
```

**User Prompt Template:**

```
Reunião: {meeting_title}
Data: {date}
Participantes: {participants_list}
Duração: {duration}

--- TRANSCRIÇÃO ---
{transcript}

--- MINHAS NOTAS DURANTE A REUNIÃO ---
{manual_notes or "Nenhuma nota registrada"}

Analise esta reunião e retorne o JSON estruturado.
Se houver notas manuais, dê prioridade a elas sobre a transcrição
quando houver conflito (as notas são mais confiáveis).
```

**Notas importantes:**

- `confidence`: quando o transcript tá ruim e o LLM não tem certeza, marca `low`. O sistema mostra isso na coluna "Confiança" do LocalDB.
- `due_source`: diferencia "Pedro disse 'até sexta'" (`explícito`) de "parece urgente, inferi essa semana" (`inferido`). Evita criar prazos falsos.

### 5.2 Refinement Chat — Prompt

Usado quando o usuário abre o chat pra corrigir informações da reunião.

**System Prompt:**

```
Você é o assistente de notas de reunião do Notes. Responda em português BR.

O usuário vai corrigir informações, adicionar contexto, ou pedir mudanças
no resumo e action items de uma reunião.

Quando o usuário fizer uma correção ou adição, responda com:
1. Confirmação curta do que entendeu
2. Um bloco JSON com os updates a aplicar

FORMATO DO BLOCO DE UPDATES:
{"updates": [
  {"action": "update", "entity": "action_item", "id": 0, "changes": {"assignee": "pedro"}},
  {"action": "delete", "entity": "action_item", "id": 1},
  {"action": "create", "entity": "action_item", "data": {"text": "...", "assignee": "me", "due": "..."}},
  {"action": "create", "entity": "follow_up", "data": {"person": "...", "topic": "..."}},
  {"action": "update", "entity": "summary", "changes": {"text": "novo resumo"}}
]}

Se a mensagem do usuário NÃO é uma correção (é uma pergunta, por exemplo),
responda normalmente sem o bloco JSON.

CONTEXTO DA REUNIÃO:
Título: {meeting_title}
Participantes: {participants}
Summary: {current_summary}
Action Items: {current_action_items}
Follow-ups: {follow_ups}
Transcrição: {transcript_or_excerpt}
```

---

## 6. Criação de Conteúdo no Notes

### 6.1 Estrutura gerada

```
Notebook: "2026-03-29"                    # Criado se não existe
  └── Page: "SDK Sync 14h"               # Board page, document mode
        │
        │  BoardContent (HTML Tiptap):
        │
        │  <h1>SDK Sync — 29/03/2026</h1>
        │  <p><strong>Participantes:</strong> Pedro, Maria, Lucas</p>
        │  <p><strong>Duração:</strong> 45min</p>
        │
        │  <h2>Resumo</h2>
        │  <p>Discutimos o fix do auth token...</p>
        │
        │  <h2>Decisões</h2>
        │  <ul>
        │    <li>Migrar endpoint /accounts pra v2</li>
        │    <li>Usar nova lib de JWT a partir da v3.1</li>
        │  </ul>
        │
        │  <h2>Action Items</h2>
        │  <div data-block-embed="" blockid="{actionBlockID}"
        │       blocktype="localdb" height="300"></div>
        │
        │  <h2>Follow-ups</h2>
        │  <div data-block-embed="" blockid="{followBlockID}"
        │       blocktype="localdb" height="200"></div>
        │
        │  <h2>Minha Participação</h2>
        │  <p><strong>Tópicos que levantei:</strong> ...</p>
        │  <p><strong>Opiniões que dei:</strong> ...</p>
        │
        │  <h2>Transcrição</h2>
        │  <p>[00:00] Pedro: Bom, vamos começar...</p>
        │  <p>[00:15] Maria: Sobre o ticket do auth...</p>
        │
        ├── [LocalDB block embed] "Action Items"
        │     Colunas: Ação(text), Responsável(select), Prazo(date),
        │              Status(select), Confiança(select), Fonte(text)
        │
        └── [LocalDB block embed] "Follow-ups"
              Colunas: Pessoa(select), Tópico(text), Contexto(text)
```

### 6.2 Fluxo de criação (Go)

```go
func (s *MeetingService) CreateMeetingPage(analysis *MeetingAnalysis) (*domain.Page, error) {
    // 1. Notebook do dia (cria se não existe)
    dateStr := analysis.Date.Format("2006-01-02")
    nb, err := s.findOrCreateDayNotebook(dateStr)

    // 2. Board page em document mode
    page, err := s.notebooks.CreateBoardPage(nb.ID, analysis.PageTitle())
    // page.PageType = "board", page.BoardMode = "document"

    // 3. LocalDB — Action Items
    actionBlock, err := s.blocks.CreateBlock(page.ID, "localdb", 0, 0, 600, 300, "document")
    actionDB, err := s.localdb.CreateDatabase(actionBlock.ID, "Action Items")
    s.localdb.UpdateConfig(actionDB.ID, actionItemsConfigJSON())
    for _, item := range analysis.ActionItems {
        s.localdb.CreateRow(actionDB.ID, item.ToJSON())
    }

    // 4. LocalDB — Follow-ups
    followBlock, err := s.blocks.CreateBlock(page.ID, "localdb", 0, 0, 600, 200, "document")
    followDB, err := s.localdb.CreateDatabase(followBlock.ID, "Follow-ups")
    s.localdb.UpdateConfig(followDB.ID, followUpsConfigJSON())
    for _, fu := range analysis.FollowUps {
        s.localdb.CreateRow(followDB.ID, fu.ToJSON())
    }

    // 5. Montar BoardContent com embeds
    html := s.buildMeetingHTML(analysis, actionBlock.ID, followBlock.ID)
    s.notebooks.UpdateBoardContent(page.ID, html)

    // 6. Emitir evento
    s.emitter.Emit("meeting:ready", map[string]interface{}{
        "pageID": page.ID,
        "title":  analysis.Title,
        "actionItemCount": len(analysis.ActionItems),
    })

    return page, nil
}
```

### 6.3 Schema LocalDB — Action Items

```json
{
  "columns": [
    {"id": "col_action", "name": "Ação", "type": "text", "width": 300},
    {"id": "col_assignee", "name": "Responsável", "type": "select", "width": 130,
     "options": ["me"],
     "optionColors": {"me": "blue"}},
    {"id": "col_due", "name": "Prazo", "type": "date", "width": 120},
    {"id": "col_status", "name": "Status", "type": "select", "width": 120,
     "options": ["aberto", "em andamento", "feito", "cancelado"],
     "optionColors": {"aberto": "red", "em andamento": "yellow", "feito": "green", "cancelado": "gray"}},
    {"id": "col_confidence", "name": "Confiança", "type": "select", "width": 100,
     "options": ["alta", "média", "baixa"],
     "optionColors": {"alta": "green", "média": "yellow", "baixa": "red"}},
    {"id": "col_source", "name": "Fonte", "type": "text", "width": 200}
  ],
  "views": [
    {
      "id": "v-table",
      "name": "Tabela",
      "layout": "table",
      "config": {"sorting": [{"id": "col_status", "desc": false}], "filters": []}
    }
  ],
  "activeViewId": "v-table"
}
```

Nota: a coluna "Responsável" é populada dinamicamente com os participantes da reunião. O `options` é gerado pelo MeetingService baseado na lista de participantes.

### 6.4 Schema LocalDB — Follow-ups

```json
{
  "columns": [
    {"id": "col_person", "name": "Pessoa", "type": "select", "width": 150,
     "options": []},
    {"id": "col_topic", "name": "Tópico", "type": "text", "width": 300},
    {"id": "col_context", "name": "Contexto", "type": "text", "width": 250}
  ],
  "views": [
    {
      "id": "v-table",
      "name": "Tabela",
      "layout": "table",
      "config": {"sorting": [], "filters": []}
    }
  ],
  "activeViewId": "v-table"
}
```

---

## 7. Domain Types

```go
// internal/domain/meeting.go

type Meeting struct {
    ID             string    `json:"id"`
    PageID         string    `json:"pageId"`         // page criada no Notes
    NotebookID     string    `json:"notebookId"`
    Title          string    `json:"title"`
    Date           time.Time `json:"date"`
    Duration       string    `json:"duration"`
    Participants   []string  `json:"participants"`
    AudioPath      string    `json:"audioPath"`
    TranscriptJSON string    `json:"transcriptJson"` // []TranscriptSegment
    AnalysisJSON   string    `json:"analysisJson"`   // MeetingAnalysis raw
    Status         string    `json:"status"`         // recording, transcribing, analyzing, ready, refined
    CreatedAt      time.Time `json:"createdAt"`
    UpdatedAt      time.Time `json:"updatedAt"`
}

type RecordingStatus struct {
    Active      bool      `json:"active"`
    MeetingID   string    `json:"meetingId"`
    Title       string    `json:"title"`
    StartedAt   time.Time `json:"startedAt"`
    ElapsedSecs int       `json:"elapsedSecs"`
    AudioLevel  float64   `json:"audioLevel"`  // 0.0 - 1.0
    FileSizeMB  float64   `json:"fileSizeMb"`
    Error       string    `json:"error,omitempty"`
}

type TranscriptSegment struct {
    Speaker   string  `json:"speaker"`   // "me", "Pedro", "[incerto]"
    Text      string  `json:"text"`
    StartTime float64 `json:"startTime"` // seconds
    EndTime   float64 `json:"endTime"`
}

type MeetingAnalysis struct {
    Title          string             `json:"title"`
    Date           string             `json:"date"`
    Duration       string             `json:"duration"`
    Participants   []string           `json:"participants"`
    Summary        string             `json:"summary"`
    KeyDecisions   []Decision         `json:"key_decisions"`
    ActionItems    []ActionItem       `json:"action_items"`
    MyCommitments  []Commitment       `json:"my_commitments"`
    FollowUps      []FollowUp         `json:"follow_ups"`
    TopicsDiscussed []string          `json:"topics_discussed"`
    MyParticipation Participation     `json:"my_participation"`
    Transcript     []TranscriptSegment `json:"transcript"`
}

type ActionItem struct {
    Text        string `json:"text"`
    Assignee    string `json:"assignee"`
    Due         string `json:"due"`
    DueSource   string `json:"due_source"`
    Confidence  string `json:"confidence"`
    SourceQuote string `json:"source_quote"`
}

type FollowUp struct {
    Person  string `json:"person"`
    Topic   string `json:"topic"`
    Context string `json:"context"`
}

type Decision struct {
    Text    string `json:"text"`
    Context string `json:"context"`
}

type Commitment struct {
    Text        string `json:"text"`
    ToWhom      string `json:"to_whom"`
    Due         string `json:"due"`
    SourceQuote string `json:"source_quote"`
}

type Participation struct {
    Spoke          bool     `json:"spoke"`
    TopicsRaised   []string `json:"topics_i_raised"`
    OpinionsGiven  []string `json:"opinions_i_gave"`
}
```

---

## 8. Storage

```sql
-- internal/storage/meeting.go

CREATE TABLE meetings (
    id TEXT PRIMARY KEY,
    page_id TEXT,
    notebook_id TEXT,
    title TEXT NOT NULL,
    date DATETIME NOT NULL,
    duration TEXT,
    participants_json TEXT DEFAULT '[]',
    audio_path TEXT,
    transcript_json TEXT,
    analysis_json TEXT,
    refinement_chat_json TEXT DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'recording',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

CREATE INDEX idx_meetings_date ON meetings(date);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_meetings_page ON meetings(page_id);
```

---

## 9. RPC Methods (App Layer)

```go
// internal/app/app_meeting.go

// Inicia gravação
func (a *App) StartMeetingRecording(title string, participants []string) error

// Para gravação e dispara pipeline (transcrição → análise → criação de conteúdo)
func (a *App) StopMeetingRecording() (*domain.Meeting, error)

// Status atual da gravação (polling pelo frontend pra elapsed time)
func (a *App) GetRecordingStatus() *domain.RecordingStatus

// Lista meetings de um dia
func (a *App) ListMeetings(date string) ([]*domain.Meeting, error)

// Busca meeting por ID
func (a *App) GetMeeting(meetingID string) (*domain.Meeting, error)

// Chat de refinamento — manda mensagem, recebe resposta + aplica updates
func (a *App) RefineMeetingNote(meetingID string, message string) (string, error)

// Histórico do chat de refinamento
func (a *App) GetMeetingRefinementChat(meetingID string) ([]domain.ChatMessage, error)
```

---

## 10. MCP Tools

```go
// internal/mcp/tools_meeting.go

// start_meeting_recording — inicia gravação
// Params: title (string), participants ([]string, optional)
// Returns: meetingID

// stop_meeting_recording — para e dispara pipeline
// Returns: meeting object com status

// get_recording_status — status atual
// Returns: RecordingStatus

// list_meetings — lista reuniões de um dia
// Params: date (string, YYYY-MM-DD)
// Returns: []Meeting

// refine_meeting — chat de refinamento
// Params: meetingId (string), message (string)
// Returns: resposta do LLM + updates aplicados
```

---

## 11. Frontend: RecordingIndicator

### 11.1 Componente

```
frontend/src/components/RecordingIndicator/
  RecordingIndicator.tsx     # Componente principal
  RecordingIndicator.css     # Estilos (.rec-)
```

- Posição: no Toolbar do Notes, lado direito
- Usa prefixo CSS `.rec-` conforme convenções do Notes
- Cores via `var(--color-*)` do theme
- Estado vem de `useAppStore(s => s.recordingStatus)`

### 11.2 Estados visuais

```
Inativo:     (não mostra nada)
Gravando:    🔴 REC 00:32:15
Processando: ⏳ Processando "SDK Sync"...
Pronto:      ✅ SDK Sync pronta (clique pra abrir)
Erro:        ⚠️ Erro na gravação
```

### 11.3 Dropdown ao clicar (durante gravação)

```
┌─────────────────────────────┐
│ SDK Sync                    │
│ Gravando há 32:15           │
│                             │
│ 🎤 ████░░ Mic               │
│ 🔊 ██████ Sistema           │
│                             │
│ Tamanho: 12.3 MB            │
│                             │
│ [⏸ Pausar]  [⏹ Parar]      │
└─────────────────────────────┘
```

---

## 12. Configuração

### 12.1 Seção no config existente do Notes

```yaml
# Adicionado ao config existente do Notes
meeting:
  audio_storage_path: "~/.notes/audio"    # onde salvar áudios
  whisper_model: "large"                  # modelo do whisper.cpp
  whisper_binary: "/usr/local/bin/whisper" # path do binário
  llm_provider: "claude"
  llm_model: "claude-sonnet-4-20250514"
  llm_api_key_keychain: "notes-claude-api" # chave no macOS Keychain
  auto_record: false                       # gravar automaticamente baseado no Calendar (futuro)
  language_hint: "pt"                      # hint de idioma pro whisper
```

---

## 13. Fases de Implementação

### Fase 1 — Gravação + Indicador (1-2 semanas)

- `internal/meeting/recorder.go` — ScreenCaptureKit + mic
- `internal/app/app_meeting.go` — StartMeetingRecording, StopMeetingRecording, GetRecordingStatus
- `frontend/src/components/RecordingIndicator/` — indicador no toolbar
- Salva áudio em `~/.notes/audio/{date}/{slug}.ogg`
- Domain types + storage table

**Entregável:** Botão no toolbar inicia/para gravação, indicador mostra status, áudio salvo.

### Fase 2 — Transcrição + Análise (2-3 semanas)

- `internal/meeting/transcriber.go` — whisper.cpp wrapper
- `internal/meeting/analyzer.go` — Claude API integration
- `internal/service/meeting_service.go` — pipeline completo
- Config de LLM (API key, modelo)

**Entregável:** Gravação para → whisper transcreve → Claude analisa → MeetingAnalysis no SQLite.

### Fase 3 — Criação de Conteúdo (1-2 semanas)

- `meetingService.CreateMeetingPage()` — cria notebook/page/blocks
- Board page em document mode com HTML Tiptap
- LocalDB blocks com schemas de Action Items e Follow-ups
- População automática dos LocalDB rows
- Evento `meeting:ready` + notificação no frontend

**Entregável:** Call termina → página aparece no Notes com resumo, action items em LocalDB, transcrição.

### Fase 4 — Refinamento (1-2 semanas)

- Chat de refinamento via RefineMeetingNote()
- Prompt de Refinement Chat com contexto da reunião
- Parser de JSON updates → atualiza BoardContent + LocalDB rows
- UI de chat (pode reutilizar padrão existente ou criar componente simples)
- MCP tools

**Entregável:** Abrir página da reunião, corrigir via chat, action items atualizados automaticamente.

### Total estimado: 5-9 semanas

---

## 14. Trade-offs

| Decisão | Escolha | Trade-off |
|---------|---------|-----------|
| Onde processar áudio | Batch pós-call | Sem real-time, mas zero CPU durante a call |
| Modelo whisper | large | Mais preciso, mas ~5min pra 1h de call |
| Board mode | document | Conteúdo flui como documento, mas sem posicionamento livre |
| Storage de meetings | Tabela separada + pages/blocks do Notes | Metadata em `meetings`, conteúdo visual nos blocks existentes |
| Áudio storage | Pasta local, cleanup manual | Simples, sem automação, usuário controla |

---

## 15. Futuro

- **Gravação automática via Calendar:** CalendarCollector detecta meeting e inicia gravação sozinho
- **Integração com Google Calendar:** puxar participantes e título automaticamente
- **Dashboard de reuniões:** board page em dashboard mode com cards das reuniões da semana
- **Compromissos cross-meeting:** agregar action items de várias reuniões numa view unificada
- **DevCoach completo:** tracking de atividades, metas, 1:1 prep (conforme system design original)
