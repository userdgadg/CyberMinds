package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/mux"
)

func main() {
	if err := validateEnvironment(); err != nil {
		log.Fatalf("Environment validation failed: %v", err)
	}

	router := mux.NewRouter()

	router.Use(securityHeadersMiddleware)
	router.Use(corsMiddleware)
	router.Use(loggingMiddleware)

	router.HandleFunc("/api/session", createSession).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/terminal/{sessionId}", handleTerminal)
	router.HandleFunc("/api/session/{sessionId}", deleteSession).Methods("DELETE", "OPTIONS")
	router.HandleFunc("/api/session/{sessionId}/files", listSessionFiles).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/session/{sessionId}/file", readSessionFile).Methods("GET", "OPTIONS")
	router.HandleFunc("/health", healthCheck).Methods("GET")
	router.HandleFunc("/api/session/{sessionId}/progress", handleGetProgress).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/session/{sessionId}/progress/{challengeId}", handleCompleteChallenge).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/session/{sessionId}/progress/{challengeId}/access", handleValidateAccess).Methods("GET", "OPTIONS")

	// UI is served by the main website deployment, not this API process.
	router.PathPrefix("/").Handler(http.NotFoundHandler())

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	srv := newHTTPServer(":"+port, router)

	// Cancel ctx when SIGINT or SIGTERM arrives.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("Server starting on port %s", port)
		log.Printf("Environment: %s", getEnvironment())
		log.Printf("Session limits: max_active=%d create_per_minute=%d", maxActiveSessions, createRatePerMinute)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-ctx.Done()
	stop() // release signal resources before blocking on shutdown

	log.Println("Shutdown signal received; draining in-flight requests")
	drainCtx, drainCancel := context.WithTimeout(context.Background(), shutdownGracePeriod)
	defer drainCancel()
	if err := srv.Shutdown(drainCtx); err != nil {
		log.Printf("HTTP shutdown error: %v", err)
	}

	// WebSocket connections are hijacked and not drained by srv.Shutdown.
	// Stopping their containers here causes the exec pipe to close, which
	// propagates an EOF to each handler and lets them exit naturally.
	shutdownSessions()
	log.Println("Shutdown complete")
}

func newHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}
}
