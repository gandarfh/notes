package meeting

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"notes/internal/domain"
)

// Analyzer uses Claude Code CLI to analyze meeting transcripts.
type Analyzer struct {
	claude *ClaudeClient
}

// NewAnalyzer creates an Analyzer.
func NewAnalyzer(claude *ClaudeClient) *Analyzer {
	return &Analyzer{claude: claude}
}

// Claude returns the underlying ClaudeClient for direct use (e.g., refinement chat).
func (a *Analyzer) Claude() *ClaudeClient {
	return a.claude
}

const analyzerSystemPrompt = `Você é um assistente que analisa transcrições de reuniões de trabalho.
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
  - Decisões tomadas pelo grupo`

// analysisJSONSchema is the JSON schema for --json-schema flag.
// Matches domain.MeetingAnalysis (without transcript field).
const analysisJSONSchema = `{
  "type": "object",
  "properties": {
    "summary": {"type": "string"},
    "key_decisions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "text": {"type": "string"},
          "context": {"type": "string"}
        },
        "required": ["text", "context"]
      }
    },
    "action_items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "text": {"type": "string"},
          "assignee": {"type": "string"},
          "due": {"type": "string"},
          "due_source": {"type": "string"},
          "confidence": {"type": "string"},
          "source_quote": {"type": "string"}
        },
        "required": ["text", "assignee", "confidence"]
      }
    },
    "my_commitments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "text": {"type": "string"},
          "to_whom": {"type": "string"},
          "due": {"type": "string"},
          "source_quote": {"type": "string"}
        },
        "required": ["text", "to_whom"]
      }
    },
    "follow_ups": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "person": {"type": "string"},
          "topic": {"type": "string"},
          "context": {"type": "string"}
        },
        "required": ["person", "topic"]
      }
    },
    "topics_discussed": {
      "type": "array",
      "items": {"type": "string"}
    },
    "my_participation": {
      "type": "object",
      "properties": {
        "spoke": {"type": "boolean"},
        "topics_i_raised": {
          "type": "array",
          "items": {"type": "string"}
        },
        "opinions_i_gave": {
          "type": "array",
          "items": {"type": "string"}
        }
      },
      "required": ["spoke"]
    }
  },
  "required": ["summary", "key_decisions", "action_items", "follow_ups", "topics_discussed", "my_participation"]
}`

// Analyze sends the transcript to Claude Code CLI and returns structured analysis.
// Returns: analysis, sessionID (for refinement), error.
func (a *Analyzer) Analyze(ctx context.Context, m *domain.Meeting, segments []domain.TranscriptSegment) (*domain.MeetingAnalysis, string, error) {
	// Format transcript for the prompt
	var transcript strings.Builder
	for _, seg := range segments {
		mins := int(seg.StartTime) / 60
		secs := int(seg.StartTime) % 60
		fmt.Fprintf(&transcript, "[%02d:%02d] %s: %s\n", mins, secs, seg.Speaker, seg.Text)
	}

	// Build participants list
	participants := "Não informados"
	if len(m.Participants) > 0 {
		participants = strings.Join(m.Participants, ", ")
	}

	// User prompt (matching design doc section 5.1)
	userPrompt := fmt.Sprintf(`Reunião: %s
Data: %s
Participantes: %s
Duração: %s

Analise esta reunião e retorne o JSON estruturado.`,
		m.Title,
		m.Date.Format("2006-01-02"),
		participants,
		m.Duration,
	)

	// The transcript goes via stdin (can be very long)
	stdinContent := fmt.Sprintf("--- TRANSCRIÇÃO ---\n%s", transcript.String())

	result, err := a.claude.Query(ctx, QueryOpts{
		Prompt:       userPrompt,
		SystemPrompt: analyzerSystemPrompt,
		JSONSchema:   analysisJSONSchema,
		MaxTurns:     3,
		Stdin:        stdinContent,
		SessionName:  fmt.Sprintf("meeting-%s", m.ID),
	})
	if err != nil {
		return nil, "", fmt.Errorf("claude analysis: %w", err)
	}

	// Parse structured output (json.RawMessage, already []byte)
	outputJSON := result.StructuredOutput
	if len(outputJSON) == 0 {
		// Fallback: try to parse the text result as JSON
		outputJSON = []byte(result.Text)
	}

	var analysis domain.MeetingAnalysis
	if err := json.Unmarshal(outputJSON, &analysis); err != nil {
		return nil, result.SessionID, fmt.Errorf("parse analysis JSON: %w\nraw output: %s", err, string(outputJSON))
	}

	// Fill in metadata from meeting
	analysis.Title = m.Title
	analysis.Date = m.Date.Format("2006-01-02")
	analysis.Duration = m.Duration
	analysis.Participants = m.Participants
	analysis.Transcript = segments

	return &analysis, result.SessionID, nil
}
