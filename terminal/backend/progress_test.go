package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

func resetProgressAndSessionsForTest() {
	progressStoreMu.Lock()
	progressStore = make(map[string]*ChallengeProgress)
	progressStoreMu.Unlock()

	mu.Lock()
	sessions = make(map[string]*Session)
	mu.Unlock()
}

func addTestSession(sessionID string) {
	mu.Lock()
	sessions[sessionID] = &Session{
		ID:          sessionID,
		ContainerID: "unused",
		CreatedAt:   time.Now(),
	}
	mu.Unlock()
}

func TestGetChallengeIndex(t *testing.T) {
	if got := getChallengeIndex("linux-basics"); got != 0 {
		t.Fatalf("expected index 0, got %d", got)
	}
	if got := getChallengeIndex("log-hunt"); got != 2 {
		t.Fatalf("expected log-hunt index 2, got %d", got)
	}
	if got := getChallengeIndex("suspicious-beaconing"); got != 5 {
		t.Fatalf("expected suspicious-beaconing index 5, got %d", got)
	}
	if got := getChallengeIndex("phishing-header"); got != 6 {
		t.Fatalf("expected phishing-header index 6, got %d", got)
	}
	if got := getChallengeIndex("unknown"); got != -1 {
		t.Fatalf("expected -1 for unknown challenge, got %d", got)
	}
}

func TestGetOrCreateProgress(t *testing.T) {
	resetProgressAndSessionsForTest()

	p1 := getOrCreateProgress("s1")
	if p1 == nil {
		t.Fatal("expected non-nil progress")
	}
	if len(p1.CompletedChallenges) != 0 {
		t.Fatal("expected empty progress map on first creation")
	}

	p2 := getOrCreateProgress("s1")
	if p1 != p2 {
		t.Fatal("expected same progress object for same session")
	}
}

func TestHandleCompleteChallengeAndAccessFlow(t *testing.T) {
	resetProgressAndSessionsForTest()
	addTestSession("s1")

	t.Run("cannot skip prerequisite challenge", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/session/s1/progress/web-recon", nil)
		req = mux.SetURLVars(req, map[string]string{"sessionId": "s1", "challengeId": "web-recon"})
		rr := httptest.NewRecorder()
		handleCompleteChallenge(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d", rr.Code)
		}
	})

	t.Run("can complete first challenge", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/session/s1/progress/linux-basics", nil)
		req = mux.SetURLVars(req, map[string]string{"sessionId": "s1", "challengeId": "linux-basics"})
		rr := httptest.NewRecorder()
		handleCompleteChallenge(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rr.Code)
		}

		var resp map[string]string
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp["status"] != "completed" || resp["challengeId"] != "linux-basics" {
			t.Fatalf("unexpected response body: %#v", resp)
		}
	})

	t.Run("access granted after prerequisite completion", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/session/s1/progress/web-recon/access", nil)
		req = mux.SetURLVars(req, map[string]string{"sessionId": "s1", "challengeId": "web-recon"})
		rr := httptest.NewRecorder()
		handleValidateAccess(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rr.Code)
		}

		var resp map[string]bool
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if !resp["allowed"] {
			t.Fatal("expected allowed=true")
		}
	})

	t.Run("can complete web recon", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/session/s1/progress/web-recon", nil)
		req = mux.SetURLVars(req, map[string]string{"sessionId": "s1", "challengeId": "web-recon"})
		rr := httptest.NewRecorder()
		handleCompleteChallenge(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rr.Code)
		}
	})

	t.Run("can complete canonical log hunt challenge", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/session/s1/progress/log-hunt", nil)
		req = mux.SetURLVars(req, map[string]string{"sessionId": "s1", "challengeId": "log-hunt"})
		rr := httptest.NewRecorder()
		handleCompleteChallenge(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rr.Code)
		}

		var resp map[string]string
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp["challengeId"] != "log-hunt" {
			t.Fatalf("unexpected challenge id: %#v", resp)
		}
	})

	t.Run("can complete remaining challenges including suspicious beaconing", func(t *testing.T) {
		for _, challengeID := range []string{"priv-esc", "incident-timeline", "suspicious-beaconing"} {
			req := httptest.NewRequest(http.MethodPost, "/api/session/s1/progress/"+challengeID, nil)
			req = mux.SetURLVars(req, map[string]string{"sessionId": "s1", "challengeId": challengeID})
			rr := httptest.NewRecorder()
			handleCompleteChallenge(rr, req)
			if rr.Code != http.StatusOK {
				t.Fatalf("expected 200 for %s, got %d: %s", challengeID, rr.Code, rr.Body.String())
			}
		}
	})
}

func TestProgressHandlersErrorPaths(t *testing.T) {
	resetProgressAndSessionsForTest()

	t.Run("get progress for missing session", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/session/missing/progress", nil)
		req = mux.SetURLVars(req, map[string]string{"sessionId": "missing"})
		rr := httptest.NewRecorder()
		handleGetProgress(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", rr.Code)
		}
	})

	t.Run("unknown challenge id", func(t *testing.T) {
		addTestSession("s2")
		req := httptest.NewRequest(http.MethodPost, "/api/session/s2/progress/nope", nil)
		req = mux.SetURLVars(req, map[string]string{"sessionId": "s2", "challengeId": "nope"})
		rr := httptest.NewRecorder()
		handleCompleteChallenge(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rr.Code)
		}
	})
}
