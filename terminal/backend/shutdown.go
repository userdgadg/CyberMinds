package main

import (
	"log"
	"sync"
	"time"
)

const (
	// shutdownGracePeriod is how long HTTP draining waits for in-flight requests.
	shutdownGracePeriod = 15 * time.Second

	// cleanupDeadline caps total time spent on parallel session cleanup.
	// It exceeds the per-session 30 s internal timeout so all goroutines
	// can finish before the deadline fires.
	cleanupDeadline = 35 * time.Second
)

// shutdownSessions snapshots all active session IDs without holding the mutex,
// then cleans up each container concurrently. One cleanup failure does not
// prevent the remaining sessions from being processed. The function blocks
// until all cleanups complete or cleanupDeadline elapses.
func shutdownSessions() {
	mu.RLock()
	ids := make([]string, 0, len(sessions))
	for id := range sessions {
		ids = append(ids, id)
	}
	mu.RUnlock()

	if len(ids) == 0 {
		return
	}

	log.Printf("Shutdown: cleaning up %d active session(s)", len(ids))

	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func(sessionID string) {
			defer wg.Done()
			cleanupSession(sessionID)
		}(id)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		log.Printf("Shutdown: all session cleanup attempts completed")
	case <-time.After(cleanupDeadline):
		log.Printf("Shutdown: cleanup deadline exceeded; remaining sessions abandoned")
	}
}
