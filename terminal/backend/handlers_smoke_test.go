package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

func TestListAndReadSessionFileErrorPaths(t *testing.T) {
	resetProgressAndSessionsForTest()

	t.Run("list files for missing session", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/session/missing/files", nil)
		req = mux.SetURLVars(req, map[string]string{"sessionId": "missing"})
		rr := httptest.NewRecorder()
		listSessionFiles(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", rr.Code)
		}
	})

	t.Run("read file with invalid path", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/session/s1/file?path=../secret", nil)
		req = mux.SetURLVars(req, map[string]string{"sessionId": "s1"})
		rr := httptest.NewRecorder()
		readSessionFile(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rr.Code)
		}
	})
}

func TestDeleteSessionNotFound(t *testing.T) {
	resetProgressAndSessionsForTest()

	req := httptest.NewRequest(http.MethodDelete, "/api/session/missing", nil)
	req = mux.SetURLVars(req, map[string]string{"sessionId": "missing"})
	rr := httptest.NewRecorder()
	deleteSession(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
}

func TestCreateSessionEarlyGuards(t *testing.T) {
	originalSessions := sessions
	originalMax := maxActiveSessions
	originalRate := createRatePerMinute
	originalAttempts := createSessionAttempts
	defer func() {
		sessions = originalSessions
		maxActiveSessions = originalMax
		createRatePerMinute = originalRate
		createSessionAttempts = originalAttempts
	}()

	t.Run("capacity reached", func(t *testing.T) {
		sessions = map[string]*Session{"busy": {ID: "busy"}}
		maxActiveSessions = 1
		createRatePerMinute = 100
		createSessionAttempts = map[string][]time.Time{}

		req := httptest.NewRequest(http.MethodPost, "/api/session", nil)
		rr := httptest.NewRecorder()
		createSession(rr, req)

		if rr.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", rr.Code)
		}
	})

	t.Run("rate limit reached", func(t *testing.T) {
		sessions = map[string]*Session{}
		maxActiveSessions = 100
		createRatePerMinute = 0
		createSessionAttempts = map[string][]time.Time{}

		req := httptest.NewRequest(http.MethodPost, "/api/session", nil)
		req.RemoteAddr = "127.0.0.1:1234"
		rr := httptest.NewRecorder()
		createSession(rr, req)

		if rr.Code != http.StatusTooManyRequests {
			t.Fatalf("expected 429, got %d", rr.Code)
		}
		if rr.Header().Get("Retry-After") != "60" {
			t.Fatalf("expected Retry-After=60, got %q", rr.Header().Get("Retry-After"))
		}
	})
}

func TestHandleTerminalMissingSession(t *testing.T) {
	resetProgressAndSessionsForTest()

	req := httptest.NewRequest(http.MethodGet, "/api/terminal/missing", nil)
	req = mux.SetURLVars(req, map[string]string{"sessionId": "missing"})
	rr := httptest.NewRecorder()
	handleTerminal(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
}

func TestLoggingMiddlewareCallsNext(t *testing.T) {
	called := false
	handler := loggingMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if !called {
		t.Fatal("expected wrapped handler to be called")
	}
	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rr.Code)
	}
}

func TestHealthCheckDockerUnavailable(t *testing.T) {
	t.Setenv("DOCKER_HOST", "unix:///tmp/nonexistent-docker.sock")
	resetProgressAndSessionsForTest()

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()
	healthCheck(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rr.Code)
	}
	body := rr.Body.String()
	if strings.Contains(body, "docker") {
		t.Fatalf("health response must not expose docker field; got: %s", body)
	}
}

func TestValidateEnvironmentFailsWhenDockerUnavailable(t *testing.T) {
	t.Setenv("DOCKER_HOST", "unix:///tmp/nonexistent-docker.sock")
	if err := validateEnvironment(); err == nil {
		t.Fatal("expected environment validation to fail when docker is unavailable")
	}
}

func TestCleanupSessionNoopForMissingSession(t *testing.T) {
	originalSessions := sessions
	defer func() {
		sessions = originalSessions
	}()
	sessions = map[string]*Session{}

	cleanupSession("missing")
}
