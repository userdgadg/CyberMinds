package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/client"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

// handleTerminal upgrades a request to WebSocket and bridges PTY I/O.
func handleTerminal(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID := vars["sessionId"]

	mu.RLock()
	session, exists := sessions[sessionID]
	mu.RUnlock()

	if !exists {
		log.Printf("Session not found: %s", sessionID)
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed for session %s: %v", sessionID, err)
		return
	}
	defer conn.Close()

	log.Printf("WebSocket connected for session %s", sessionID)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		log.Printf("Docker client error for session %s: %v", sessionID, err)
		conn.WriteMessage(websocket.TextMessage, []byte("Error: Cannot connect to Docker\r\n"))
		return
	}
	defer cli.Close()

	containerInfo, err := cli.ContainerInspect(ctx, session.ContainerID)
	if err != nil {
		log.Printf("Container inspect failed for session %s: %v", sessionID, err)
		conn.WriteMessage(websocket.TextMessage, []byte("Error: Container not found\r\n"))
		return
	}

	if !containerInfo.State.Running {
		log.Printf("Container not running for session %s", sessionID)
		conn.WriteMessage(websocket.TextMessage, []byte("Error: Container not running\r\n"))
		return
	}

	execConfig := types.ExecConfig{
		Cmd:          []string{"/bin/bash"},
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          true,
		Env: []string{
			"TERM=xterm-256color",
		},
	}

	execResp, err := cli.ContainerExecCreate(context.Background(), session.ContainerID, execConfig)
	if err != nil {
		log.Printf("Exec create failed for session %s: %v", sessionID, err)
		conn.WriteMessage(websocket.TextMessage, []byte("Error: Failed to create shell\r\n"))
		return
	}

	if err := cli.ContainerExecResize(context.Background(), execResp.ID, types.ResizeOptions{
		Width:  120,
		Height: 40,
	}); err != nil {
		log.Printf("Initial resize failed for session %s: %v", sessionID, err)
	}

	attachResp, err := cli.ContainerExecAttach(context.Background(), execResp.ID, types.ExecStartCheck{
		Tty: true,
	})
	if err != nil {
		log.Printf("Exec attach failed for session %s: %v", sessionID, err)
		conn.WriteMessage(websocket.TextMessage, []byte("Error: Failed to attach to shell\r\n"))
		return
	}
	defer attachResp.Close()

	done := make(chan struct{})

	go func() {
		defer close(done)
		defer conn.Close()
		buf := make([]byte, readBufferSize)
		for {
			n, err := attachResp.Reader.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("Read error for session %s: %v", sessionID, err)
				}
				return
			}

			if n > 0 {
				chunk := strings.ToValidUTF8(string(buf[:n]), "")
				if err := conn.WriteMessage(websocket.TextMessage, []byte(chunk)); err != nil {
					log.Printf("WebSocket write error for session %s: %v", sessionID, err)
					return
				}
			}
		}
	}()

	for {
		select {
		case <-done:
			return
		default:
			msgType, message, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WebSocket unexpected close for session %s: %v", sessionID, err)
				}
				return
			}

			if msgType == websocket.TextMessage {
				var ctrl wsControlMessage
				if err := json.Unmarshal(message, &ctrl); err == nil && ctrl.Type == "resize" {
					if ctrl.Cols > 0 && ctrl.Rows > 0 {
						if err := cli.ContainerExecResize(context.Background(), execResp.ID, types.ResizeOptions{
							Width:  ctrl.Cols,
							Height: ctrl.Rows,
						}); err != nil {
							log.Printf("Resize error for session %s: %v", sessionID, err)
						}
					}
					continue
				}
			}

			if _, err := attachResp.Conn.Write(message); err != nil {
				log.Printf("Container write error for session %s: %v", sessionID, err)
				return
			}
		}
	}
}
