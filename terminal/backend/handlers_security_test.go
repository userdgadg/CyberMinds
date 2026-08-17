package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleCSPReport(t *testing.T) {
	var logs bytes.Buffer
	originalWriter := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(originalWriter) })

	req := httptest.NewRequest(http.MethodPost, "/api/csp-report", strings.NewReader(`{"csp-report":{"effective-directive":"script-src","blocked-uri":"https://cdn.jsdelivr.net.evil.example/x","document-uri":"https://example.test/learner\nforged","source-file":"https://example.test/app.js","line-number":17}}`))
	rr := httptest.NewRecorder()
	handleCSPReport(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rr.Code)
	}
	if !strings.Contains(logs.String(), "critical") {
		t.Fatalf("expected unapproved origin to be critical, got %q", logs.String())
	}
	if strings.Count(logs.String(), "\n") != 1 {
		t.Fatalf("expected escaped report values to stay on one log line, got %q", logs.String())
	}
}

func TestHandleCSPReportRejectsInvalidRequests(t *testing.T) {
	tests := []struct {
		name   string
		method string
		body   string
		status int
	}{
		{name: "method", method: http.MethodGet, body: "{}", status: http.StatusMethodNotAllowed},
		{name: "json", method: http.MethodPost, body: "not-json", status: http.StatusBadRequest},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/api/csp-report", strings.NewReader(tc.body))
			rr := httptest.NewRecorder()
			handleCSPReport(rr, req)
			if rr.Code != tc.status {
				t.Fatalf("expected %d, got %d", tc.status, rr.Code)
			}
		})
	}
}

func TestIsUnapprovedOriginUsesExactOrigins(t *testing.T) {
	tests := []struct {
		blocked string
		want    bool
	}{
		{blocked: "https://cdn.jsdelivr.net/xterm.js", want: false},
		{blocked: "HTTPS://CDN.JSDELIVR.NET/xterm.js", want: false},
		{blocked: "https://cdn.jsdelivr.net.evil.example/xterm.js", want: true},
		{blocked: "inline", want: false},
		{blocked: "https://unknown.example/script.js", want: true},
	}

	for _, tc := range tests {
		if got := isUnapprovedOrigin(tc.blocked); got != tc.want {
			t.Errorf("isUnapprovedOrigin(%q) = %t, want %t", tc.blocked, got, tc.want)
		}
	}
}
