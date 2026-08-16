package main

import (
	"log"
	"net/http"
	"os"
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
	router.HandleFunc("/api/csp-report", handleCSPReport).Methods("POST", "OPTIONS")
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

	log.Printf("Server starting on port %s", port)
	log.Printf("Environment: %s", getEnvironment())
	log.Printf("Session limits: max_active=%d create_per_minute=%d", maxActiveSessions, createRatePerMinute)
	log.Fatal(newHTTPServer(":"+port, router).ListenAndServe())
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
