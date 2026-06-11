package app

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// ── AI Config ──────────────────────────────────────────────────────────────────

type AIConfig struct {
	Endpoint string     `json:"endpoint"`
	APIKey   string     `json:"apiKey"`
	Model    string     `json:"model"`
	Models   []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"models"`
}

var (
	aiDir     string
	aiDirOnce sync.Once
)

func aiConfDir() string {
	aiDirOnce.Do(func() {
		configDir, err := os.UserConfigDir()
		if err != nil {
			configDir = os.TempDir()
		}
		aiDir = filepath.Join(configDir, "ripple-ssh", "ai")
		_ = os.MkdirAll(aiDir, 0700)
	})
	return aiDir
}

func aiConfigPath() string {
	return filepath.Join(aiConfDir(), "config.json")
}

func (a *App) AISaveConfig(configJSON string) {
	var cfg AIConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		a.emitLog("Invalid config: " + err.Error())
		return
	}
	_ = os.MkdirAll(aiConfDir(), 0700)
	data, _ := json.MarshalIndent(cfg, "", "  ")
	_ = os.WriteFile(aiConfigPath(), data, 0600)
	a.emitLog("Config saved: " + cfg.Endpoint)
}

func (a *App) AILoadConfig() string {
	data, err := os.ReadFile(aiConfigPath())
	if err != nil {
		return ""
	}
	return string(data)
}

func chatsPath() string {
	return filepath.Join(aiConfDir(), "chats.json")
}

func (a *App) AISaveChats(chatsJSON string) {
	_ = os.MkdirAll(aiConfDir(), 0700)
	_ = os.WriteFile(chatsPath(), []byte(chatsJSON), 0600)
}

func (a *App) AILoadChats() string {
	data, err := os.ReadFile(chatsPath())
	if err != nil {
		return "[]"
	}
	return string(data)
}

func (a *App) emitLog(line string) {
	a.app.Event.Emit("ai.log", map[string]string{"text": line})
	a.log("[AI] " + line)
}

// ── Test Connection ────────────────────────────────────────────────────────────

type openAIModel struct {
	ID     string `json:"id"`
	Object string `json:"object"`
}
type openAIModelsResponse struct {
	Data []openAIModel `json:"data"`
}

func (a *App) AITestConnection(endpoint, apiKey string) string {
	baseURL := strings.TrimRight(endpoint, "/")
	modelsURL := baseURL + "/models"

	req, err := http.NewRequest("GET", modelsURL, nil)
	if err != nil {
		return `{"error":"` + err.Error() + `"}`
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return `{"error":"` + err.Error() + `"}`
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Sprintf(`{"error":"HTTP %d: %s"}`, resp.StatusCode, string(body))
	}

	var modelsResp openAIModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&modelsResp); err != nil {
		return `{"error":"` + err.Error() + `"}`
	}

	type modelItem struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}

	items := make([]modelItem, 0)
	for _, m := range modelsResp.Data {
		if m.Object == "model" || strings.HasPrefix(m.ID, "gpt") || strings.HasPrefix(m.ID, "gemma") || strings.HasPrefix(m.ID, "gemini") || strings.Contains(m.ID, "/") {
			items = append(items, modelItem{ID: m.ID, Name: m.ID})
		}
	}

	if len(items) == 0 {
		for _, m := range modelsResp.Data {
			items = append(items, modelItem{ID: m.ID, Name: m.ID})
		}
	}

	result, _ := json.Marshal(items)
	return string(result)
}

// ── Chat ───────────────────────────────────────────────────────────────────────

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Stream      bool          `json:"stream"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens"`
}

type chatStreamChoice struct {
	Index int `json:"index"`
	Delta struct {
		Content string `json:"content"`
	} `json:"delta"`
}
type chatStreamResponse struct {
	Choices []chatStreamChoice `json:"choices"`
}

func (a *App) AIChat(message, historyJSON string) {
	cfgData, err := os.ReadFile(aiConfigPath())
	if err != nil {
		a.app.Event.Emit("ai.error", map[string]string{"message": "No AI config saved. Configure AI first."})
		return
	}
	var cfg AIConfig
	if err := json.Unmarshal(cfgData, &cfg); err != nil {
		a.app.Event.Emit("ai.error", map[string]string{"message": "Invalid AI config."})
		return
	}

	history := []chatMessage{}
	if historyJSON != "" {
		_ = json.Unmarshal([]byte(historyJSON), &history)
	}
	history = append(history, chatMessage{Role: "user", Content: message})

	body := chatRequest{
		Model:       cfg.Model,
		Messages:    history,
		Stream:      true,
		Temperature: 0.7,
		MaxTokens:   2048,
	}
	bodyJSON, _ := json.Marshal(body)

	baseURL := strings.TrimRight(cfg.Endpoint, "/")
	chatURL := baseURL + "/chat/completions"

	req, err := http.NewRequest("POST", chatURL, bytes.NewReader(bodyJSON))
	if err != nil {
		a.app.Event.Emit("ai.error", map[string]string{"message": "Failed to create request: " + err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		a.app.Event.Emit("ai.error", map[string]string{"message": "Chat request failed: " + err.Error()})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		msg := fmt.Sprintf("API returned HTTP %d", resp.StatusCode)
		switch resp.StatusCode {
		case 429:
			msg = "Model is not available (rate limited). Try a different model."
		case 401, 403:
			msg = "Authentication failed. Check your API key."
		case 404:
			msg = "Model not found. Check that the model name is correct."
		case 500, 502, 503:
			msg = "AI server error. Try again later or use a different model."
		}
		a.app.Event.Emit("ai.error", map[string]string{"message": msg})
		a.emitLog(fmt.Sprintf("Chat error (%d): %s", resp.StatusCode, string(bodyBytes)))
		a.app.Event.Emit("ai.done", map[string]string{})
		return
	}

	lineBuf := &strings.Builder{}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}
		var sr chatStreamResponse
		if err := json.Unmarshal([]byte(data), &sr); err != nil {
			continue
		}
		for _, ch := range sr.Choices {
			if ch.Delta.Content != "" {
				lineBuf.WriteString(ch.Delta.Content)
				a.app.Event.Emit("ai.chunk", map[string]string{"text": ch.Delta.Content})
			}
		}
	}
	a.emitLog("Full AI response: " + lineBuf.String())
	a.app.Event.Emit("ai.done", map[string]string{})
}
