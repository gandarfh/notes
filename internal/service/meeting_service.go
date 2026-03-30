package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"notes/internal/domain"
	"notes/internal/meeting"
	"notes/internal/storage"
)

// MeetingService manages meeting recording and lifecycle.
type MeetingService struct {
	store       *storage.MeetingStore
	recorder    meeting.Recorder
	transcriber *meeting.Transcriber
	analyzer    *meeting.Analyzer
	notebooks   *NotebookService
	blocks      *BlockService
	localdb     *LocalDBService
	audioDir    string
	emitter     EventEmitter

	// Current recording state
	currentMeetingID string
}

// NewMeetingService creates a MeetingService.
func NewMeetingService(
	store *storage.MeetingStore,
	recorder meeting.Recorder,
	transcriber *meeting.Transcriber,
	analyzer *meeting.Analyzer,
	notebooks *NotebookService,
	blocks *BlockService,
	localdb *LocalDBService,
	audioDir string,
	emitter EventEmitter,
) *MeetingService {
	return &MeetingService{
		store:       store,
		recorder:    recorder,
		transcriber: transcriber,
		analyzer:    analyzer,
		notebooks:   notebooks,
		blocks:      blocks,
		localdb:     localdb,
		audioDir:    audioDir,
		emitter:     emitter,
	}
}

// StartRecording begins a new meeting recording.
func (s *MeetingService) StartRecording(title string, participants []string) error {
	if s.recorder.IsRecording() {
		return fmt.Errorf("a recording is already in progress")
	}

	id := uuid.New().String()
	now := time.Now()

	slug := slugify(title) + "-" + now.Format("15h04")
	dateDir := now.Format("2006-01-02")

	dir := filepath.Join(s.audioDir, dateDir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create audio dir: %w", err)
	}

	systemPath := filepath.Join(dir, slug+"-system.m4a")
	micPath := filepath.Join(dir, slug+"-mic.m4a")

	s.recorder.SetMeetingInfo(id, title)

	if err := s.recorder.Start(systemPath, micPath); err != nil {
		return fmt.Errorf("start recording: %w", err)
	}

	m := &domain.Meeting{
		ID:           id,
		Title:        title,
		Date:         now,
		Participants: participants,
		AudioPath:    systemPath,
		Status:       domain.MeetingStatusRecording,
	}
	if err := s.store.Insert(m); err != nil {
		s.recorder.Stop()
		return fmt.Errorf("save meeting: %w", err)
	}

	s.currentMeetingID = id

	s.emitter.Emit(context.Background(), "meeting:recording", map[string]any{
		"meetingId": id,
		"title":     title,
	})

	return nil
}

// StopRecording stops the active recording and starts the processing pipeline.
func (s *MeetingService) StopRecording() (*domain.Meeting, error) {
	if !s.recorder.IsRecording() {
		return nil, fmt.Errorf("no active recording")
	}

	systemPath, _, err := s.recorder.Stop()
	if err != nil {
		return nil, fmt.Errorf("stop recording: %w", err)
	}

	m, err := s.store.GetByID(s.currentMeetingID)
	if err != nil {
		return nil, fmt.Errorf("get meeting: %w", err)
	}

	m.AudioPath = systemPath
	m.Duration = formatDuration(m.Date)
	m.Status = domain.MeetingStatusTranscribing

	if err := s.store.Update(m); err != nil {
		return nil, fmt.Errorf("update meeting: %w", err)
	}

	s.currentMeetingID = ""

	// Notify frontend that recording stopped (indicator shows "processing")
	s.emitter.Emit(context.Background(), "meeting:stopped", map[string]any{
		"meetingId": m.ID,
		"title":     m.Title,
		"status":    m.Status,
	})

	// Start processing pipeline in background
	go s.runPipeline(m.ID)

	return m, nil
}

// runPipeline transcribes and analyzes a meeting in background.
func (s *MeetingService) runPipeline(meetingID string) {
	ctx := context.Background()

	m, err := s.store.GetByID(meetingID)
	if err != nil {
		log.Printf("[meeting] pipeline: get meeting %s: %v", meetingID, err)
		return
	}

	// ── 1. Transcribe ───────────────────────────────────────
	s.emitter.Emit(ctx, "meeting:status", map[string]any{
		"meetingId": m.ID, "status": "transcribing", "title": m.Title,
	})

	micPath := strings.Replace(m.AudioPath, "-system.m4a", "-mic.m4a", 1)
	segments, err := s.transcriber.TranscribeDualTrack(ctx, m.AudioPath, micPath)
	if err != nil {
		log.Printf("[meeting] transcription failed for %s: %v", m.ID, err)
		s.setMeetingError(m, fmt.Sprintf("Erro na transcrição: %v", err))
		return
	}

	transcriptJSON, _ := json.Marshal(segments)
	m.TranscriptJSON = string(transcriptJSON)
	m.Status = domain.MeetingStatusAnalyzing
	s.store.Update(m)

	// ── 2. Analyze ──────────────────────────────────────────
	s.emitter.Emit(ctx, "meeting:status", map[string]any{
		"meetingId": m.ID, "status": "analyzing", "title": m.Title,
	})

	analysis, sessionID, err := s.analyzer.Analyze(ctx, m, segments)
	if err != nil {
		log.Printf("[meeting] analysis failed for %s: %v", m.ID, err)
		s.setMeetingError(m, fmt.Sprintf("Erro na análise: %v", err))
		return
	}

	analysisJSON, _ := json.Marshal(analysis)
	m.AnalysisJSON = string(analysisJSON)

	// Store session ID in refinement chat field for later resume
	if sessionID != "" {
		chatMeta, _ := json.Marshal(map[string]string{"session_id": sessionID})
		m.RefinementChat = string(chatMeta)
	}

	m.Status = domain.MeetingStatusGenerating
	if err := s.store.Update(m); err != nil {
		log.Printf("[meeting] update meeting %s after analysis: %v", m.ID, err)
	}

	log.Printf("[meeting] analysis complete for %s: %d action items, %d follow-ups. Creating page...",
		m.ID, len(analysis.ActionItems), len(analysis.FollowUps))

	// ── 3. Create content ──────────────────────────────────
	s.emitter.Emit(ctx, "meeting:status", map[string]any{
		"meetingId": m.ID, "status": "generating", "title": m.Title,
	})

	page, err := s.CreateMeetingPage(ctx, m, analysis)
	if err != nil {
		log.Printf("[meeting] content creation failed for %s: %v", m.ID, err)
		s.setMeetingError(m, fmt.Sprintf("Erro na criação de conteúdo: %v", err))
		return
	}

	log.Printf("[meeting] page created for %s: pageID=%s, notebookID=%s", m.ID, page.ID, page.NotebookID)

	m.PageID = page.ID
	m.NotebookID = page.NotebookID
	m.Status = domain.MeetingStatusReady
	if err := s.store.Update(m); err != nil {
		log.Printf("[meeting] update meeting %s after content: %v", m.ID, err)
	}

	// ── 4. Notify frontend ──────────────────────────────────
	s.emitter.Emit(ctx, "meeting:ready", map[string]any{
		"meetingId":       m.ID,
		"title":           m.Title,
		"pageId":          page.ID,
		"actionItemCount": len(analysis.ActionItems),
	})

	// Navigate frontend to the new page
	s.emitter.Emit(ctx, "mcp:pages-changed", map[string]any{
		"notebookId": page.NotebookID,
	})
	s.emitter.Emit(ctx, "mcp:navigate-page", map[string]any{
		"pageId": page.ID,
	})
}

// setMeetingError marks a meeting as failed and notifies the frontend.
func (s *MeetingService) setMeetingError(m *domain.Meeting, errMsg string) {
	m.Status = domain.MeetingStatusError
	s.store.Update(m)
	s.emitter.Emit(context.Background(), "meeting:status", map[string]any{
		"meetingId": m.ID,
		"status":    "error",
		"title":     m.Title,
		"error":     errMsg,
	})
}

// ── Refinement Chat ───────────────────────────────────────────

const refinementSystemPrompt = `Você é o assistente de notas de reunião do Notes. Responda em português BR.

O usuário vai corrigir informações, adicionar contexto, ou pedir mudanças
no resumo e action items de uma reunião.

Quando o usuário fizer uma correção ou adição, responda com:
1. Confirmação curta do que entendeu
2. Um bloco JSON com os updates a aplicar

FORMATO DO BLOCO DE UPDATES:
{"updates": [
  {"action": "update", "entity": "action_item", "id": 0, "changes": {"col_assignee": "pedro"}},
  {"action": "delete", "entity": "action_item", "id": 1},
  {"action": "create", "entity": "action_item", "data": {"col_action": "...", "col_assignee": "me", "col_due": "...", "col_status": "aberto", "col_confidence": "alta", "col_source": ""}},
  {"action": "create", "entity": "follow_up", "data": {"col_person": "...", "col_topic": "...", "col_context": ""}},
  {"action": "update", "entity": "summary", "changes": {"text": "novo resumo"}}
]}

Se a mensagem do usuário NÃO é uma correção (é uma pergunta, por exemplo),
responda normalmente sem o bloco JSON.`

// RefineMeetingNote sends a chat message to refine a meeting and applies updates.
func (s *MeetingService) RefineMeetingNote(meetingID, message string) (string, error) {
	m, err := s.store.GetByID(meetingID)
	if err != nil {
		return "", fmt.Errorf("get meeting: %w", err)
	}

	// Load chat data
	var chatData domain.RefinementChatData
	if m.RefinementChat != "" {
		json.Unmarshal([]byte(m.RefinementChat), &chatData)
	}

	// Build context prompt with current meeting state
	contextPrompt := s.buildRefinementContext(m)

	// Call Claude with --resume if we have a session
	opts := meeting.QueryOpts{
		Prompt:       message,
		SystemPrompt: refinementSystemPrompt + "\n\n" + contextPrompt,
		MaxTurns:     3,
	}
	if chatData.SessionID != "" {
		opts.ResumeSession = chatData.SessionID
		// When resuming, system prompt is already set from first call
		opts.SystemPrompt = ""
	}

	result, err := s.analyzer.Claude().Query(context.Background(), opts)
	if err != nil {
		return "", fmt.Errorf("claude refinement: %w", err)
	}

	responseText := result.Text

	// Try to extract and apply JSON updates from the response
	if updates := extractUpdates(responseText); updates != nil {
		if err := s.applyUpdates(m, updates); err != nil {
			log.Printf("[meeting] apply updates failed for %s: %v", m.ID, err)
		}
	}

	// Save chat history
	chatData.SessionID = result.SessionID
	chatData.Messages = append(chatData.Messages,
		domain.ChatMessage{Role: "user", Content: message},
		domain.ChatMessage{Role: "assistant", Content: responseText},
	)
	chatJSON, _ := json.Marshal(chatData)
	m.RefinementChat = string(chatJSON)
	s.store.Update(m)

	return responseText, nil
}

// GetMeetingRefinementChat returns the chat history for a meeting.
func (s *MeetingService) GetMeetingRefinementChat(meetingID string) ([]domain.ChatMessage, error) {
	m, err := s.store.GetByID(meetingID)
	if err != nil {
		return nil, err
	}
	var chatData domain.RefinementChatData
	if m.RefinementChat != "" {
		json.Unmarshal([]byte(m.RefinementChat), &chatData)
	}
	return chatData.Messages, nil
}

// GetMeetingByPageID finds a meeting associated with a page.
func (s *MeetingService) GetMeetingByPageID(pageID string) (*domain.Meeting, error) {
	return s.store.GetByPageID(pageID)
}

func (s *MeetingService) buildRefinementContext(m *domain.Meeting) string {
	var analysis domain.MeetingAnalysis
	if m.AnalysisJSON != "" {
		json.Unmarshal([]byte(m.AnalysisJSON), &analysis)
	}

	var b strings.Builder
	b.WriteString(fmt.Sprintf("CONTEXTO DA REUNIÃO:\nTítulo: %s\n", m.Title))
	b.WriteString(fmt.Sprintf("Participantes: %s\n", strings.Join(m.Participants, ", ")))
	b.WriteString(fmt.Sprintf("Summary: %s\n", analysis.Summary))

	if len(analysis.ActionItems) > 0 {
		b.WriteString("Action Items:\n")
		for i, item := range analysis.ActionItems {
			b.WriteString(fmt.Sprintf("  [%d] %s (responsável: %s, prazo: %s)\n", i, item.Text, item.Assignee, item.Due))
		}
	}
	if len(analysis.FollowUps) > 0 {
		b.WriteString("Follow-ups:\n")
		for i, fu := range analysis.FollowUps {
			b.WriteString(fmt.Sprintf("  [%d] %s → %s\n", i, fu.Person, fu.Topic))
		}
	}
	return b.String()
}

// ── Update Application ────────────────────────────────────────

type refinementUpdate struct {
	Action  string            `json:"action"`
	Entity  string            `json:"entity"`
	ID      int               `json:"id"`
	Changes map[string]string `json:"changes"`
	Data    map[string]string `json:"data"`
}

type refinementUpdates struct {
	Updates []refinementUpdate `json:"updates"`
}

func extractUpdates(text string) *refinementUpdates {
	// Find JSON block in the response text
	start := strings.Index(text, `{"updates"`)
	if start == -1 {
		return nil
	}
	// Find matching closing brace
	depth := 0
	end := -1
	for i := start; i < len(text); i++ {
		if text[i] == '{' {
			depth++
		} else if text[i] == '}' {
			depth--
			if depth == 0 {
				end = i + 1
				break
			}
		}
	}
	if end == -1 {
		return nil
	}

	var updates refinementUpdates
	if err := json.Unmarshal([]byte(text[start:end]), &updates); err != nil {
		return nil
	}
	return &updates
}

func (s *MeetingService) applyUpdates(m *domain.Meeting, updates *refinementUpdates) error {
	if m.PageID == "" {
		return fmt.Errorf("meeting has no page")
	}

	// Find localdb blocks on the page
	blocks, err := s.blocks.ListBlocks(m.PageID)
	if err != nil {
		return fmt.Errorf("list blocks: %w", err)
	}

	// Find action items and follow-ups databases
	var actionDBID, followDBID string
	for _, block := range blocks {
		if block.Type != "localdb" {
			continue
		}
		db, err := s.localdb.GetDatabase(block.ID)
		if err != nil {
			continue
		}
		if db.Name == "Action Items" {
			actionDBID = db.ID
		} else if db.Name == "Follow-ups" {
			followDBID = db.ID
		}
	}

	for _, u := range updates.Updates {
		switch u.Entity {
		case "action_item":
			if actionDBID == "" {
				continue
			}
			if err := s.applyRowUpdate(actionDBID, u); err != nil {
				log.Printf("[meeting] apply action_item update: %v", err)
			}

		case "follow_up":
			if followDBID == "" {
				continue
			}
			if err := s.applyRowUpdate(followDBID, u); err != nil {
				log.Printf("[meeting] apply follow_up update: %v", err)
			}

		case "summary":
			if newText, ok := u.Changes["text"]; ok {
				s.updateSummaryInHTML(m, newText)
			}
		}
	}

	// Emit events so frontend refreshes
	s.emitter.Emit(context.Background(), "mcp:blocks-changed", map[string]any{
		"pageId": m.PageID,
	})

	return nil
}

func (s *MeetingService) applyRowUpdate(dbID string, u refinementUpdate) error {
	switch u.Action {
	case "create":
		dataJSON, _ := json.Marshal(u.Data)
		_, err := s.localdb.CreateRow(dbID, string(dataJSON))
		return err

	case "delete":
		rows, err := s.localdb.ListRows(dbID)
		if err != nil {
			return err
		}
		if u.ID >= 0 && u.ID < len(rows) {
			return s.localdb.DeleteRow(rows[u.ID].ID)
		}

	case "update":
		rows, err := s.localdb.ListRows(dbID)
		if err != nil {
			return err
		}
		if u.ID >= 0 && u.ID < len(rows) {
			// Merge changes into existing data
			var existing map[string]string
			json.Unmarshal([]byte(rows[u.ID].DataJSON), &existing)
			if existing == nil {
				existing = make(map[string]string)
			}
			for k, v := range u.Changes {
				existing[k] = v
			}
			dataJSON, _ := json.Marshal(existing)
			return s.localdb.UpdateRow(rows[u.ID].ID, string(dataJSON))
		}
	}
	return nil
}

func (s *MeetingService) updateSummaryInHTML(m *domain.Meeting, newSummary string) {
	page, err := s.notebooks.GetPage(m.PageID)
	if err != nil {
		return
	}

	// Replace summary section in HTML
	html := page.BoardContent
	summaryStart := strings.Index(html, "<h2>Resumo</h2>")
	if summaryStart == -1 {
		return
	}
	// Find the <p> after Resumo
	pStart := strings.Index(html[summaryStart:], "<p>")
	if pStart == -1 {
		return
	}
	pStart += summaryStart
	pEnd := strings.Index(html[pStart:], "</p>")
	if pEnd == -1 {
		return
	}
	pEnd += pStart + len("</p>")

	newHTML := html[:pStart] + "<p>" + htmlEscape(newSummary) + "</p>" + html[pEnd:]
	s.notebooks.UpdateBoardContent(m.PageID, newHTML)
}

// GetRecordingStatus returns the current recording status.
func (s *MeetingService) GetRecordingStatus() *domain.RecordingStatus {
	status := s.recorder.Status()
	return &status
}

// GetMeeting returns a meeting by ID.
func (s *MeetingService) GetMeeting(id string) (*domain.Meeting, error) {
	return s.store.GetByID(id)
}

// ListMeetings returns meetings for a given date (YYYY-MM-DD).
func (s *MeetingService) ListMeetings(date string) ([]*domain.Meeting, error) {
	return s.store.ListByDate(date)
}

// ── Content Creation ──────────────────────────────────────────

// CreateMeetingPage creates a full meeting page with LocalDB blocks and HTML content.
func (s *MeetingService) CreateMeetingPage(ctx context.Context, m *domain.Meeting, analysis *domain.MeetingAnalysis) (*domain.Page, error) {
	// 1. Find or create day notebook
	dateStr := m.Date.Format("2006-01-02")
	nb, err := s.findOrCreateDayNotebook(dateStr)
	if err != nil {
		return nil, fmt.Errorf("notebook: %w", err)
	}

	// 2. Create board page in document mode
	pageTitle := fmt.Sprintf("%s %s", m.Title, m.Date.Format("15h"))
	page, err := s.notebooks.CreateBoardPage(nb.ID, pageTitle)
	if err != nil {
		return nil, fmt.Errorf("create page: %w", err)
	}

	// 3. Create Action Items LocalDB
	actionBlock, err := s.blocks.CreateBlock(page.ID, "localdb", 0, 0, 600, 300, "document")
	if err != nil {
		return nil, fmt.Errorf("create action items block: %w", err)
	}
	actionDB, err := s.localdb.CreateDatabase(actionBlock.ID, "Action Items")
	if err != nil {
		return nil, fmt.Errorf("create action items db: %w", err)
	}
	if err := s.localdb.UpdateConfig(actionDB.ID, actionItemsConfig(m.Participants)); err != nil {
		return nil, fmt.Errorf("config action items: %w", err)
	}
	for _, item := range analysis.ActionItems {
		rowJSON := actionItemToRow(item)
		if _, err := s.localdb.CreateRow(actionDB.ID, rowJSON); err != nil {
			log.Printf("[meeting] insert action item row: %v", err)
		}
	}

	// 4. Create Follow-ups LocalDB
	followBlock, err := s.blocks.CreateBlock(page.ID, "localdb", 0, 0, 600, 200, "document")
	if err != nil {
		return nil, fmt.Errorf("create follow-ups block: %w", err)
	}
	followDB, err := s.localdb.CreateDatabase(followBlock.ID, "Follow-ups")
	if err != nil {
		return nil, fmt.Errorf("create follow-ups db: %w", err)
	}
	if err := s.localdb.UpdateConfig(followDB.ID, followUpsConfig(m.Participants)); err != nil {
		return nil, fmt.Errorf("config follow-ups: %w", err)
	}
	for _, fu := range analysis.FollowUps {
		rowJSON := followUpToRow(fu)
		if _, err := s.localdb.CreateRow(followDB.ID, rowJSON); err != nil {
			log.Printf("[meeting] insert follow-up row: %v", err)
		}
	}

	// 5. Build HTML and set board content
	html := buildMeetingHTML(analysis, actionBlock.ID, followBlock.ID)
	if err := s.notebooks.UpdateBoardContent(page.ID, html); err != nil {
		return nil, fmt.Errorf("set board content: %w", err)
	}

	return page, nil
}

func (s *MeetingService) findOrCreateDayNotebook(date string) (*domain.Notebook, error) {
	notebooks, err := s.notebooks.ListNotebooks()
	if err != nil {
		return nil, err
	}
	for i := range notebooks {
		if notebooks[i].Name == date {
			return &notebooks[i], nil
		}
	}
	return s.notebooks.CreateNotebook(date)
}

// ── HTML Builder ──────────────────────────────────────────────

func buildMeetingHTML(a *domain.MeetingAnalysis, actionBlockID, followBlockID string) string {
	var b strings.Builder

	// Header
	b.WriteString(fmt.Sprintf("<h1>%s — %s</h1>\n", htmlEscape(a.Title), a.Date))
	if len(a.Participants) > 0 {
		b.WriteString(fmt.Sprintf("<p><strong>Participantes:</strong> %s</p>\n", htmlEscape(strings.Join(a.Participants, ", "))))
	}
	if a.Duration != "" {
		b.WriteString(fmt.Sprintf("<p><strong>Duração:</strong> %s</p>\n", htmlEscape(a.Duration)))
	}

	// Summary
	b.WriteString("<h2>Resumo</h2>\n")
	b.WriteString(fmt.Sprintf("<p>%s</p>\n", htmlEscape(a.Summary)))

	// Decisions
	if len(a.KeyDecisions) > 0 {
		b.WriteString("<h2>Decisões</h2>\n<ul>\n")
		for _, d := range a.KeyDecisions {
			b.WriteString(fmt.Sprintf("  <li>%s</li>\n", htmlEscape(d.Text)))
		}
		b.WriteString("</ul>\n")
	}

	// Action Items embed
	b.WriteString("<h2>Action Items</h2>\n")
	b.WriteString(fmt.Sprintf(`<div data-block-embed="" blockid="%s" blocktype="localdb" height="300"></div>`+"\n", actionBlockID))

	// Follow-ups embed
	b.WriteString("<h2>Follow-ups</h2>\n")
	b.WriteString(fmt.Sprintf(`<div data-block-embed="" blockid="%s" blocktype="localdb" height="200"></div>`+"\n", followBlockID))

	// My participation
	if a.MyParticipation.Spoke {
		b.WriteString("<h2>Minha Participação</h2>\n")
		if len(a.MyParticipation.TopicsRaised) > 0 {
			b.WriteString(fmt.Sprintf("<p><strong>Tópicos que levantei:</strong> %s</p>\n",
				htmlEscape(strings.Join(a.MyParticipation.TopicsRaised, ", "))))
		}
		if len(a.MyParticipation.OpinionsGiven) > 0 {
			b.WriteString(fmt.Sprintf("<p><strong>Opiniões que dei:</strong> %s</p>\n",
				htmlEscape(strings.Join(a.MyParticipation.OpinionsGiven, ", "))))
		}
	}

	// Transcript
	if len(a.Transcript) > 0 {
		b.WriteString("<h2>Transcrição</h2>\n")
		for _, seg := range a.Transcript {
			mins := int(seg.StartTime) / 60
			secs := int(seg.StartTime) % 60
			b.WriteString(fmt.Sprintf("<p>[%02d:%02d] %s: %s</p>\n",
				mins, secs, htmlEscape(seg.Speaker), htmlEscape(seg.Text)))
		}
	}

	return b.String()
}

func htmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}

// ── LocalDB Schemas ───────────────────────────────────────────

func actionItemsConfig(participants []string) string {
	// Build assignee options: participants + "me"
	options := []string{"me"}
	options = append(options, participants...)
	optionsJSON, _ := json.Marshal(options)

	optionColors := map[string]string{"me": "blue"}
	optionColorsJSON, _ := json.Marshal(optionColors)

	return fmt.Sprintf(`{
  "columns": [
    {"id": "col_action", "name": "Ação", "type": "text", "width": 300},
    {"id": "col_assignee", "name": "Responsável", "type": "select", "width": 130,
     "options": %s, "optionColors": %s},
    {"id": "col_due", "name": "Prazo", "type": "date", "width": 120},
    {"id": "col_status", "name": "Status", "type": "select", "width": 120,
     "options": ["aberto", "em andamento", "feito", "cancelado"],
     "optionColors": {"aberto": "red", "em andamento": "yellow", "feito": "green", "cancelado": "gray"}},
    {"id": "col_confidence", "name": "Confiança", "type": "select", "width": 100,
     "options": ["alta", "média", "baixa"],
     "optionColors": {"alta": "green", "média": "yellow", "baixa": "red"}},
    {"id": "col_source", "name": "Fonte", "type": "text", "width": 200}
  ],
  "activeView": "table"
}`, string(optionsJSON), string(optionColorsJSON))
}

func followUpsConfig(participants []string) string {
	optionsJSON, _ := json.Marshal(participants)

	return fmt.Sprintf(`{
  "columns": [
    {"id": "col_person", "name": "Pessoa", "type": "select", "width": 150,
     "options": %s},
    {"id": "col_topic", "name": "Tópico", "type": "text", "width": 300},
    {"id": "col_context", "name": "Contexto", "type": "text", "width": 250}
  ],
  "activeView": "table"
}`, string(optionsJSON))
}

func actionItemToRow(item domain.ActionItem) string {
	// Map confidence to PT-BR
	confidence := map[string]string{"high": "alta", "medium": "média", "low": "baixa"}[item.Confidence]
	if confidence == "" {
		confidence = item.Confidence
	}

	row := map[string]string{
		"col_action":     item.Text,
		"col_assignee":   item.Assignee,
		"col_due":        item.Due,
		"col_status":     "aberto",
		"col_confidence": confidence,
		"col_source":     item.SourceQuote,
	}
	data, _ := json.Marshal(row)
	return string(data)
}

func followUpToRow(fu domain.FollowUp) string {
	row := map[string]string{
		"col_person":  fu.Person,
		"col_topic":   fu.Topic,
		"col_context": fu.Context,
	}
	data, _ := json.Marshal(row)
	return string(data)
}

// ── Helpers ───────────────────────────────────────────────────

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	lower := strings.ToLower(s)
	slug := slugRe.ReplaceAllString(lower, "-")
	return strings.Trim(slug, "-")
}

func formatDuration(startTime time.Time) string {
	d := time.Since(startTime)
	minutes := int(d.Minutes())
	if minutes < 60 {
		return fmt.Sprintf("%dmin", minutes)
	}
	return fmt.Sprintf("%dh%02dmin", minutes/60, minutes%60)
}
