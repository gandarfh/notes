package meeting

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// ClaudeClient wraps the Claude Code CLI for programmatic use.
type ClaudeClient struct {
	model string // "sonnet", "opus", or full model ID
}

// NewClaudeClient creates a new Claude CLI wrapper.
func NewClaudeClient(model string) *ClaudeClient {
	return &ClaudeClient{model: model}
}

// QueryOpts configures a Claude CLI invocation.
type QueryOpts struct {
	Prompt        string   // The user message
	SystemPrompt  string   // --append-system-prompt
	JSONSchema    string   // --json-schema for structured output
	MaxTurns      int      // --max-turns (0 = default)
	AllowedTools  []string // --allowedTools (empty = no tools)
	SessionName   string   // --name (optional)
	ResumeSession string   // --resume <id> (for continuing conversations)
	Stdin         string   // Content piped via stdin
}

// QueryResult holds the result of a Claude CLI invocation.
type QueryResult struct {
	Text             string          `json:"result"`
	StructuredOutput json.RawMessage `json:"structured_output"`
	SessionID        string          `json:"session_id"`
	CostUSD          float64         `json:"total_cost_usd"`
	DurationMs       int             `json:"duration_ms"`
	IsError          bool            `json:"is_error"`
}

// Query runs a one-shot query and returns the result.
func (c *ClaudeClient) Query(ctx context.Context, opts QueryOpts) (*QueryResult, error) {
	args := c.buildArgs(opts, "json")

	cmd := exec.CommandContext(ctx, "claude", args...)
	if opts.Stdin != "" {
		cmd.Stdin = strings.NewReader(opts.Stdin)
	}

	var stderr strings.Builder
	cmd.Stderr = &stderr

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("claude CLI error: %w\nstderr: %s", err, stderr.String())
	}

	var result QueryResult
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, fmt.Errorf("parse claude output: %w\nraw: %s", err, string(output))
	}

	if result.IsError {
		return &result, fmt.Errorf("claude returned error: %s", result.Text)
	}

	return &result, nil
}

// QueryStream runs a streaming query, calling onDelta for each text chunk.
// Returns the final result after the stream completes.
func (c *ClaudeClient) QueryStream(ctx context.Context, opts QueryOpts, onDelta func(text string)) (*QueryResult, error) {
	args := c.buildArgs(opts, "stream-json")

	cmd := exec.CommandContext(ctx, "claude", args...)
	if opts.Stdin != "" {
		cmd.Stdin = strings.NewReader(opts.Stdin)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("create stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start claude: %w", err)
	}

	var finalResult *QueryResult
	scanner := bufio.NewScanner(stdout)
	// Increase buffer for large responses
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var msg streamMessage
		if err := json.Unmarshal(line, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "stream_event":
			// Extract text deltas
			if msg.Event.Delta.Type == "text_delta" && onDelta != nil {
				onDelta(msg.Event.Delta.Text)
			}
		case "result":
			finalResult = &QueryResult{
				Text:             msg.Result,
				StructuredOutput: msg.StructuredOutput,
				SessionID:        msg.SessionID,
				CostUSD:          msg.TotalCostUSD,
				DurationMs:       msg.DurationMs,
				IsError:          msg.IsError,
			}

		}
	}

	if err := cmd.Wait(); err != nil {
		if finalResult != nil && finalResult.IsError {
			return finalResult, fmt.Errorf("claude error: %s", finalResult.Text)
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("claude CLI error (exit %d)", exitErr.ExitCode())
		}
		return nil, fmt.Errorf("claude CLI: %w", err)
	}

	if finalResult == nil {
		return nil, fmt.Errorf("no result received from claude")
	}

	return finalResult, nil
}

// buildArgs constructs the CLI arguments.
func (c *ClaudeClient) buildArgs(opts QueryOpts, outputFormat string) []string {
	args := []string{
		"-p", opts.Prompt,
		"--output-format", outputFormat,
	}

	if c.model != "" {
		args = append(args, "--model", c.model)
	}

	if opts.SystemPrompt != "" {
		args = append(args, "--append-system-prompt", opts.SystemPrompt)
	}

	if opts.JSONSchema != "" {
		args = append(args, "--json-schema", opts.JSONSchema)
	}

	if opts.MaxTurns > 0 {
		args = append(args, "--max-turns", fmt.Sprintf("%d", opts.MaxTurns))
	}

	for _, tool := range opts.AllowedTools {
		args = append(args, "--allowedTools", tool)
	}

	if opts.SessionName != "" {
		args = append(args, "--name", opts.SessionName)
	}

	if opts.ResumeSession != "" {
		args = append(args, "--resume", opts.ResumeSession)
	}

	return args
}

// ── Stream JSON types ─────────────────────────────────────────

type streamMessage struct {
	Type string `json:"type"`

	// stream_event fields
	Event streamEvent `json:"event"`

	// result fields
	Result           string          `json:"result"`
	StructuredOutput json.RawMessage `json:"structured_output"`
	SessionID        string          `json:"session_id"`
	TotalCostUSD     float64         `json:"total_cost_usd"`
	DurationMs       int             `json:"duration_ms"`
	IsError          bool            `json:"is_error"`
}

type streamEvent struct {
	Type  string      `json:"type"`
	Delta streamDelta `json:"delta"`
}

type streamDelta struct {
	Type string `json:"type"`
	Text string `json:"text"`
}
