package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

var (
	createContainerFn = func(ctx context.Context, cli *client.Client) (container.CreateResponse, error) {
		return cli.ContainerCreate(ctx, &container.Config{
			Image:        terminalImageName,
			Cmd:          []string{"/bin/bash", "-lc", "nginx && exec /bin/bash"},
			Tty:          true,
			OpenStdin:    true,
			AttachStdin:  true,
			AttachStdout: true,
			AttachStderr: true,
			WorkingDir:   "/workspace",
			Env: []string{
				"TERM=xterm-256color",
			},
		}, &container.HostConfig{
			Resources: container.Resources{
				Memory:   containerMemoryLimit,
				NanoCPUs: containerCPULimit,
			},
			AutoRemove:  false,
			NetworkMode: "bridge",
		}, nil, nil, "")
	}
	startContainerFn = func(ctx context.Context, cli *client.Client, containerID string) error {
		return cli.ContainerStart(ctx, containerID, types.ContainerStartOptions{})
	}
	removeContainerFn = func(ctx context.Context, cli *client.Client, containerID string, removeVolumes bool) error {
		return cli.ContainerRemove(ctx, containerID, types.ContainerRemoveOptions{
			Force:         true,
			RemoveVolumes: removeVolumes,
		})
	}
	stopContainerFn = func(ctx context.Context, cli *client.Client, containerID string, timeout int) error {
		stopOptions := container.StopOptions{Timeout: &timeout}
		return cli.ContainerStop(ctx, containerID, stopOptions)
	}
)

// createSession starts an isolated container and returns a session ID.
func createSession(w http.ResponseWriter, r *http.Request) {
	if isSessionCapacityReached() {
		http.Error(w, "Session capacity reached. Try again later.", http.StatusServiceUnavailable)
		return
	}

	clientIP := getClientIP(r)
	if !allowCreateSession(clientIP) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "Too many session requests. Please wait and retry.", http.StatusTooManyRequests)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		log.Printf("Error creating Docker client: %v", err)
		http.Error(w, "Failed to connect to Docker", http.StatusInternalServerError)
		return
	}
	defer cli.Close()

	resp, err := createContainerFn(ctx, cli)
	if err != nil {
		log.Printf("Error creating container: %v", err)
		http.Error(w, fmt.Sprintf("Failed to create container: %v", err), http.StatusInternalServerError)
		return
	}

	if err := startContainerFn(ctx, cli, resp.ID); err != nil {
		log.Printf("Error starting container %s: %v", resp.ID, err)
		_ = removeContainerFn(ctx, cli, resp.ID, false)
		http.Error(w, "Failed to start container", http.StatusInternalServerError)
		return
	}

	sessionID := uuid.New().String()
	session := &Session{
		ID:          sessionID,
		ContainerID: resp.ID,
		CreatedAt:   time.Now(),
	}

	mu.Lock()
	if len(sessions) >= maxActiveSessions {
		mu.Unlock()
		_ = removeContainerFn(ctx, cli, resp.ID, true)
		http.Error(w, "Session capacity reached. Try again later.", http.StatusServiceUnavailable)
		return
	}
	sessions[sessionID] = session
	mu.Unlock()

	go func() {
		time.Sleep(maxSessionTimeout)
		cleanupSession(sessionID)
	}()

	log.Printf("Created session %s with container %s", sessionID, resp.ID[:12])

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"sessionId":   sessionID,
		"containerId": resp.ID,
	})
}

func isSessionCapacityReached() bool {
	mu.RLock()
	defer mu.RUnlock()
	return len(sessions) >= maxActiveSessions
}

func allowCreateSession(clientIP string) bool {
	now := time.Now()
	cutoff := now.Add(-rateLimitWindow)

	createSessionAttemptsM.Lock()
	defer createSessionAttemptsM.Unlock()

	attempts := createSessionAttempts[clientIP]
	trimmed := attempts[:0]
	for _, t := range attempts {
		if t.After(cutoff) {
			trimmed = append(trimmed, t)
		}
	}

	if len(trimmed) >= createRatePerMinute {
		createSessionAttempts[clientIP] = trimmed
		return false
	}

	trimmed = append(trimmed, now)
	createSessionAttempts[clientIP] = trimmed
	return true
}

func getClientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		ips := make([]string, 0, len(parts))
		for _, p := range parts {
			ip := strings.TrimSpace(p)
			if ip == "" {
				continue
			}
			if _, err := netip.ParseAddr(ip); err == nil {
				ips = append(ips, ip)
			}
		}
		if n := len(ips); n >= 2 {
			return ips[n-2]
		}
		if len(ips) == 1 {
			return ips[0]
		}
	}

	if xrip := strings.TrimSpace(r.Header.Get("X-Real-IP")); xrip != "" {
		if _, err := netip.ParseAddr(xrip); err == nil {
			return xrip
		}
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func getSession(sessionID string) (*Session, bool) {
	mu.RLock()
	defer mu.RUnlock()
	session, ok := sessions[sessionID]
	return session, ok
}

func shortContainerID(containerID string) string {
	if len(containerID) <= 12 {
		return containerID
	}
	return containerID[:12]
}

func deleteSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID := vars["sessionId"]

	mu.RLock()
	_, exists := sessions[sessionID]
	mu.RUnlock()

	if !exists {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	cleanupSession(sessionID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":    "deleted",
		"sessionId": sessionID,
	})
}

func cleanupSession(sessionID string) {
	mu.Lock()
	session, exists := sessions[sessionID]
	if !exists {
		mu.Unlock()
		return
	}
	delete(sessions, sessionID)
	mu.Unlock()

	progressStoreMu.Lock()
	delete(progressStore, sessionID)
	progressStoreMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		log.Printf("Docker client error during cleanup of session %s: %v", sessionID, err)
		return
	}
	defer cli.Close()

	if err := stopContainerFn(ctx, cli, session.ContainerID, 10); err != nil {
		log.Printf("Failed to stop container %s: %v", shortContainerID(session.ContainerID), err)
	}

	if err := removeContainerFn(ctx, cli, session.ContainerID, true); err != nil {
		log.Printf("Failed to remove container %s: %v", shortContainerID(session.ContainerID), err)
		return
	}

	log.Printf("Cleaned up session %s (container %s)", sessionID, shortContainerID(session.ContainerID))
}
