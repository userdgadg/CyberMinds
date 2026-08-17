package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNormalizeOrigin(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{input: " https://example.com/ ", want: "https://example.com"},
		{input: "http://localhost:3000/path", want: "http://localhost:3000"},
		{input: "localhost:3000", want: "localhost:3000"},
		{input: "", want: ""},
	}

	for _, tc := range tests {
		got := normalizeOrigin(tc.input)
		if got != tc.want {
			t.Fatalf("normalizeOrigin(%q) expected %q, got %q", tc.input, tc.want, got)
		}
	}
}

func TestGetAllowedOrigins(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://a.com, https://b.com/ ,invalid")
	got := getAllowedOrigins()
	if len(got) != 3 {
		t.Fatalf("expected 3 origins, got %d", len(got))
	}
	if got[0] != "https://a.com" || got[1] != "https://b.com" || got[2] != "invalid" {
		t.Fatalf("unexpected parsed origins: %#v", got)
	}
}

func TestIsOriginAllowed(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://allowed.example")
	t.Setenv("ENVIRONMENT", "production")

	if !isOriginAllowed("https://allowed.example/") {
		t.Fatal("expected allowed origin to pass")
	}
	if isOriginAllowed("https://blocked.example") {
		t.Fatal("expected blocked origin to fail")
	}
}

func TestIsOriginAllowedDefaultPolicy(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "")

	t.Setenv("ENVIRONMENT", "development")
	if !isOriginAllowed("https://any.example") {
		t.Fatal("expected permissive behavior in development when no allowlist is set")
	}

	t.Setenv("ENVIRONMENT", "production")
	if isOriginAllowed("https://any.example") {
		t.Fatal("expected restrictive behavior in production when no allowlist is set")
	}
}

func TestSecurityHeadersMiddleware(t *testing.T) {
	nextCalled := false
	handler := securityHeadersMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if !nextCalled {
		t.Fatal("expected wrapped handler to be called")
	}
	if rr.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing X-Content-Type-Options header")
	}
	if rr.Header().Get("Content-Security-Policy-Report-Only") == "" {
		t.Fatal("expected report-only CSP header for non-websocket request")
	}
	if rr.Header().Get("Content-Security-Policy") != "" {
		t.Fatal("did not expect enforced CSP header")
	}
}

func TestCorsMiddlewareBlocksDisallowedOrigin(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://allowed.example")
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called for disallowed origin")
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	req.Header.Set("Origin", "https://blocked.example")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rr.Code)
	}
}

func TestCorsMiddlewareOptionsAllowed(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://allowed.example")
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called for OPTIONS preflight")
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/session", nil)
	req.Header.Set("Origin", "https://allowed.example/")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "https://allowed.example" {
		t.Fatalf("unexpected allow-origin header %q", rr.Header().Get("Access-Control-Allow-Origin"))
	}
}
