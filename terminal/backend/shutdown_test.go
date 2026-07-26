package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/docker/docker/client"
)

// TestShutdownSessionsEmpty verifies shutdownSessions is a no-op when no
// sessions are active and does not block or panic.
func TestShutdownSessionsEmpty(t *testing.T) {
	origSessions := sessions
	defer func() { sessions = origSessions }()
	sessions = map[string]*Session{}

	shutdownSessions()
}

// TestShutdownSessionsCleansAll verifies every active session receives a
// stop + remove attempt and is removed from the in-memory store.
func TestShutdownSessionsCleansAll(t *testing.T) {
	origSessions := sessions
	origStop := stopContainerFn
	origRemove := removeContainerFn
	defer func() {
		sessions = origSessions
		stopContainerFn = origStop
		removeContainerFn = origRemove
	}()

	var tracked sync.Mutex
	cleaned := map[string]bool{}

	stopContainerFn = func(_ context.Context, _ *client.Client, _ string, _ int) error {
		return nil
	}
	removeContainerFn = func(_ context.Context, _ *client.Client, containerID string, _ bool) error {
		tracked.Lock()
		cleaned[containerID] = true
		tracked.Unlock()
		return nil
	}

	sessions = map[string]*Session{
		"s1": {ID: "s1", ContainerID: "container-s1111111111"},
		"s2": {ID: "s2", ContainerID: "container-s2222222222"},
		"s3": {ID: "s3", ContainerID: "container-s3333333333"},
	}

	shutdownSessions()

	if len(sessions) != 0 {
		t.Fatalf("expected all sessions removed from store; %d remain", len(sessions))
	}

	tracked.Lock()
	defer tracked.Unlock()
	for _, cid := range []string{"container-s1111111111", "container-s2222222222", "container-s3333333333"} {
		if !cleaned[cid] {
			t.Errorf("container %s was not cleaned up", cid)
		}
	}
}

// TestShutdownSessionsOneFailureContinues verifies that a Docker error for one
// session does not prevent remaining sessions from being processed.
func TestShutdownSessionsOneFailureContinues(t *testing.T) {
	origSessions := sessions
	origStop := stopContainerFn
	origRemove := removeContainerFn
	defer func() {
		sessions = origSessions
		stopContainerFn = origStop
		removeContainerFn = origRemove
	}()

	var tracked sync.Mutex
	removeCalls := map[string]bool{}

	stopContainerFn = func(_ context.Context, _ *client.Client, _ string, _ int) error {
		return nil
	}
	removeContainerFn = func(_ context.Context, _ *client.Client, containerID string, _ bool) error {
		tracked.Lock()
		removeCalls[containerID] = true
		tracked.Unlock()
		if containerID == "container-fail0000000" {
			return errors.New("simulated Docker remove failure")
		}
		return nil
	}

	sessions = map[string]*Session{
		"ok1":  {ID: "ok1", ContainerID: "container-ok11111111"},
		"fail": {ID: "fail", ContainerID: "container-fail0000000"},
		"ok2":  {ID: "ok2", ContainerID: "container-ok22222222"},
	}

	shutdownSessions() // must not deadlock or skip sessions after a failure

	tracked.Lock()
	defer tracked.Unlock()
	for _, cid := range []string{"container-ok11111111", "container-fail0000000", "container-ok22222222"} {
		if !removeCalls[cid] {
			t.Errorf("expected cleanup attempt for %s", cid)
		}
	}
}

// TestShutdownSessionsMutexNotHeldDuringCleanup verifies under the race
// detector that shutdownSessions releases the global session mutex before
// any Docker API call. A concurrent write-lock must succeed while cleanup
// goroutines are in flight.
func TestShutdownSessionsMutexNotHeldDuringCleanup(t *testing.T) {
	origSessions := sessions
	origStop := stopContainerFn
	origRemove := removeContainerFn
	defer func() {
		sessions = origSessions
		stopContainerFn = origStop
		removeContainerFn = origRemove
	}()

	lockAcquired := make(chan struct{}, 1)

	stopContainerFn = func(_ context.Context, _ *client.Client, _ string, _ int) error {
		// Acquire the write lock while a cleanup goroutine is executing.
		// This deadlocks if shutdownSessions holds the lock here.
		mu.Lock()
		select {
		case lockAcquired <- struct{}{}:
		default:
		}
		mu.Unlock()
		return nil
	}
	removeContainerFn = func(_ context.Context, _ *client.Client, _ string, _ bool) error {
		return nil
	}

	sessions = map[string]*Session{
		"probe": {ID: "probe", ContainerID: "container-probe0000000"},
	}

	done := make(chan struct{})
	go func() {
		shutdownSessions()
		close(done)
	}()

	select {
	case <-lockAcquired:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out — mutex may be held during Docker call")
	}
	<-done
}

// TestGracefulHTTPShutdownDrainsInFlight verifies that an in-flight HTTP
// request completes before http.Server.Shutdown returns.
func TestGracefulHTTPShutdownDrainsInFlight(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	requestStarted := make(chan struct{})
	requestDone := make(chan struct{})

	srv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			close(requestStarted)
			time.Sleep(50 * time.Millisecond)
			w.WriteHeader(http.StatusOK)
			close(requestDone)
		}),
	}
	go srv.Serve(ln) //nolint:errcheck

	go func() { http.Get("http://" + ln.Addr().String() + "/") }() //nolint:errcheck,noctx

	<-requestStarted

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		t.Fatalf("unexpected shutdown error: %v", err)
	}

	select {
	case <-requestDone:
	default:
		t.Fatal("server closed before in-flight request completed")
	}
}

// TestShutdownRejectsNewRequestsAfterSignal verifies that after Shutdown is
// called the listener no longer accepts new connections.
func TestShutdownRejectsNewRequestsAfterSignal(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()

	srv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	}
	go srv.Serve(ln) //nolint:errcheck

	resp, err := http.Get("http://" + addr + "/")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 before shutdown, got err=%v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown error: %v", err)
	}

	if _, err = http.Get("http://" + addr + "/"); err == nil {
		t.Fatal("expected connection refused after shutdown, but request succeeded")
	}
}
