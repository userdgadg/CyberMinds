package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
)

func TestGetClientIP(t *testing.T) {
	t.Run("x-forwarded-for prefers second-last trusted hop", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "10.0.0.1:1234"
		req.Header.Set("X-Forwarded-For", "1.1.1.1, 2.2.2.2")
		if got := getClientIP(req); got != "1.1.1.1" {
			t.Fatalf("expected 1.1.1.1, got %q", got)
		}
	})

	t.Run("x-real-ip fallback", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "10.0.0.1:1234"
		req.Header.Set("X-Real-IP", "3.3.3.3")
		if got := getClientIP(req); got != "3.3.3.3" {
			t.Fatalf("expected 3.3.3.3, got %q", got)
		}
	})

	t.Run("remote-addr fallback", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "10.0.0.1:1234"
		if got := getClientIP(req); got != "10.0.0.1" {
			t.Fatalf("expected 10.0.0.1, got %q", got)
		}
	})
}

func TestAllowCreateSessionRateLimit(t *testing.T) {
	originalRate := createRatePerMinute
	originalAttempts := createSessionAttempts
	defer func() {
		createRatePerMinute = originalRate
		createSessionAttempts = originalAttempts
	}()

	createRatePerMinute = 2
	createSessionAttempts = map[string][]time.Time{}
	clientIP := "203.0.113.10"

	if !allowCreateSession(clientIP) {
		t.Fatal("first request should be allowed")
	}
	if !allowCreateSession(clientIP) {
		t.Fatal("second request should be allowed")
	}
	if allowCreateSession(clientIP) {
		t.Fatal("third request should be rate limited")
	}
}

func TestSessionCapacityReached(t *testing.T) {
	originalSessions := sessions
	originalMax := maxActiveSessions
	defer func() {
		sessions = originalSessions
		maxActiveSessions = originalMax
	}()

	sessions = map[string]*Session{
		"a": {ID: "a"},
	}
	maxActiveSessions = 1

	if !isSessionCapacityReached() {
		t.Fatal("expected capacity reached")
	}
}

func TestCreateSessionSuccessWithInjectedDockerOps(t *testing.T) {
	originalSessions := sessions
	originalMax := maxActiveSessions
	originalRate := createRatePerMinute
	originalAttempts := createSessionAttempts
	originalCreate := createContainerFn
	originalStart := startContainerFn
	originalRemove := removeContainerFn
	defer func() {
		sessions = originalSessions
		maxActiveSessions = originalMax
		createRatePerMinute = originalRate
		createSessionAttempts = originalAttempts
		createContainerFn = originalCreate
		startContainerFn = originalStart
		removeContainerFn = originalRemove
	}()

	sessions = map[string]*Session{}
	maxActiveSessions = 10
	createRatePerMinute = 10
	createSessionAttempts = map[string][]time.Time{}

	createContainerFn = func(ctx context.Context, cli *client.Client) (container.CreateResponse, error) {
		return container.CreateResponse{ID: "container-1234567890"}, nil
	}
	startContainerFn = func(ctx context.Context, cli *client.Client, containerID string) error {
		return nil
	}
	removeContainerFn = func(ctx context.Context, cli *client.Client, containerID string, removeVolumes bool) error {
		return nil
	}

	req := httptest.NewRequest(http.MethodPost, "/api/session", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	rr := httptest.NewRecorder()
	createSession(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected one active session, got %d", len(sessions))
	}
}

func TestCreateSessionContainerFailures(t *testing.T) {
	originalSessions := sessions
	originalMax := maxActiveSessions
	originalRate := createRatePerMinute
	originalAttempts := createSessionAttempts
	originalCreate := createContainerFn
	originalStart := startContainerFn
	originalRemove := removeContainerFn
	defer func() {
		sessions = originalSessions
		maxActiveSessions = originalMax
		createRatePerMinute = originalRate
		createSessionAttempts = originalAttempts
		createContainerFn = originalCreate
		startContainerFn = originalStart
		removeContainerFn = originalRemove
	}()

	sessions = map[string]*Session{}
	maxActiveSessions = 10
	createRatePerMinute = 10
	createSessionAttempts = map[string][]time.Time{}

	t.Run("container create error", func(t *testing.T) {
		createContainerFn = func(ctx context.Context, cli *client.Client) (container.CreateResponse, error) {
			return container.CreateResponse{}, errors.New("create failed")
		}
		startContainerFn = func(ctx context.Context, cli *client.Client, containerID string) error {
			return nil
		}

		req := httptest.NewRequest(http.MethodPost, "/api/session", nil)
		req.RemoteAddr = "127.0.0.1:1234"
		rr := httptest.NewRecorder()
		createSession(rr, req)

		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d", rr.Code)
		}
	})

	t.Run("container start error triggers remove", func(t *testing.T) {
		removed := false
		createContainerFn = func(ctx context.Context, cli *client.Client) (container.CreateResponse, error) {
			return container.CreateResponse{ID: "container-xyz"}, nil
		}
		startContainerFn = func(ctx context.Context, cli *client.Client, containerID string) error {
			return errors.New("start failed")
		}
		removeContainerFn = func(ctx context.Context, cli *client.Client, containerID string, removeVolumes bool) error {
			removed = true
			return nil
		}

		req := httptest.NewRequest(http.MethodPost, "/api/session", nil)
		req.RemoteAddr = "127.0.0.1:1234"
		rr := httptest.NewRecorder()
		createSession(rr, req)

		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d", rr.Code)
		}
		if !removed {
			t.Fatal("expected container remove to be called after start failure")
		}
	})
}

func TestCleanupSessionWithInjectedDockerOps(t *testing.T) {
	originalSessions := sessions
	originalProgress := progressStore
	originalStop := stopContainerFn
	originalRemove := removeContainerFn
	defer func() {
		sessions = originalSessions
		progressStore = originalProgress
		stopContainerFn = originalStop
		removeContainerFn = originalRemove
	}()

	sessions = map[string]*Session{
		"s-clean": {
			ID:          "s-clean",
			ContainerID: "container-clean",
			CreatedAt:   time.Now(),
		},
	}
	progressStore = map[string]*ChallengeProgress{
		"s-clean": {CompletedChallenges: map[string]CompletionRecord{"linux-basics": {Passed: true}}},
	}

	stopped := false
	removed := false
	stopContainerFn = func(ctx context.Context, cli *client.Client, containerID string, timeout int) error {
		stopped = true
		return nil
	}
	removeContainerFn = func(ctx context.Context, cli *client.Client, containerID string, removeVolumes bool) error {
		removed = true
		return nil
	}

	cleanupSession("s-clean")

	if stopped != true || removed != true {
		t.Fatalf("expected stop=%v remove=%v", stopped, removed)
	}
	if _, ok := sessions["s-clean"]; ok {
		t.Fatal("expected session to be removed from in-memory store")
	}
	if _, ok := progressStore["s-clean"]; ok {
		t.Fatal("expected progress to be removed with the session")
	}
}
