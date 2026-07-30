package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

// challengeOrder defines the canonical sequence of challenges.
// Must match the frontend challengeOrder array exactly.
var challengeOrder = []string{
	"linux-basics",
	"web-recon",
	"log-hunt",
	"priv-esc",
	"incident-timeline",
	"suspicious-beaconing",
	"phishing-header",
}

// ChallengeProgress tracks which challenges a session has completed.
type ChallengeProgress struct {
	CompletedChallenges map[string]CompletionRecord `json:"completedChallenges"`
}

// CompletionRecord stores when a challenge was passed.
type CompletionRecord struct {
	Passed   bool   `json:"passed"`
	PassedAt string `json:"passedAt"`
}

// progressStore maps sessionId -> ChallengeProgress
var (
	progressStore   = make(map[string]*ChallengeProgress)
	progressStoreMu sync.RWMutex
)

// getChallengeIndex returns the index of a challenge in the canonical order.
// Returns -1 if not found.
func getChallengeIndex(challengeId string) int {
	for i, id := range challengeOrder {
		if id == challengeId {
			return i
		}
	}
	return -1
}

// getOrCreateProgress returns the progress for a session, creating it if needed.
func getOrCreateProgress(sessionId string) *ChallengeProgress {
	progressStoreMu.Lock()
	defer progressStoreMu.Unlock()

	if p, ok := progressStore[sessionId]; ok {
		return p
	}
	p := &ChallengeProgress{
		CompletedChallenges: make(map[string]CompletionRecord),
	}
	progressStore[sessionId] = p
	return p
}

// handleGetProgress returns the current challenge progress for a session.
// GET /api/session/{sessionId}/progress
func handleGetProgress(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionId := vars["sessionId"]

	// Verify session exists
	if _, ok := getSession(sessionId); !ok {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	progress := getOrCreateProgress(sessionId)

	progressStoreMu.RLock()
	defer progressStoreMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(progress)
}

// handleCompleteChallenge marks a challenge as complete for a session
// after verifying the previous challenge is already done.
// POST /api/session/{sessionId}/progress/{challengeId}
func handleCompleteChallenge(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionId := vars["sessionId"]
	challengeId := vars["challengeId"]

	// Verify session exists
	if _, ok := getSession(sessionId); !ok {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	// Verify challenge is a known challenge
	targetIndex := getChallengeIndex(challengeId)
	if targetIndex == -1 {
		http.Error(w, "Unknown challenge ID", http.StatusBadRequest)
		return
	}

	progress := getOrCreateProgress(sessionId)

	progressStoreMu.Lock()
	defer progressStoreMu.Unlock()

	// Enforce progression — every previous challenge must be completed first
	for i := 0; i < targetIndex; i++ {
		prevId := challengeOrder[i]
		if _, done := progress.CompletedChallenges[prevId]; !done {
			http.Error(w, "Previous challenge not completed", http.StatusForbidden)
			return
		}
	}

	// Mark this challenge as complete
	progress.CompletedChallenges[challengeId] = CompletionRecord{
		Passed:   true,
		PassedAt: time.Now().UTC().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      "completed",
		"challengeId": challengeId,
		"passedAt":    progress.CompletedChallenges[challengeId].PassedAt,
	})
}

// handleValidateAccess checks whether a session is allowed to access a challenge.
// GET /api/session/{sessionId}/progress/{challengeId}/access
func handleValidateAccess(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionId := vars["sessionId"]
	challengeId := vars["challengeId"]

	// Verify session exists
	if _, ok := getSession(sessionId); !ok {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	targetIndex := getChallengeIndex(challengeId)
	if targetIndex == -1 {
		http.Error(w, "Unknown challenge ID", http.StatusBadRequest)
		return
	}

	// First challenge is always accessible
	if targetIndex == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"allowed": true})
		return
	}

	progress := getOrCreateProgress(sessionId)

	progressStoreMu.RLock()
	defer progressStoreMu.RUnlock()

	// Check all previous challenges are completed
	for i := 0; i < targetIndex; i++ {
		prevId := challengeOrder[i]
		if _, done := progress.CompletedChallenges[prevId]; !done {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]bool{"allowed": false})
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"allowed": true})
}
