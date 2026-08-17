package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// CSPViolationReport represents a Content-Security-Policy violation report.
// Sent by the browser's CSP report-only directive.
// See: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP#violation_reports
type CSPViolationReport struct {
	CspReport CSPReport `json:"csp-report"`
}

type CSPReport struct {
	DocumentURI        string `json:"document-uri"`
	ViolatedDirective  string `json:"violated-directive"`
	EffectiveDirective string `json:"effective-directive"`
	OriginalPolicy     string `json:"original-policy"`
	BlockedURI         string `json:"blocked-uri"`
	StatusCode         int    `json:"status-code"`
	SourceFile         string `json:"source-file"`
	LineNumber         int    `json:"line-number"`
	ColumnNumber       int    `json:"column-number"`
	Disposition        string `json:"disposition"`
}

// handleCSPReport receives and logs Content-Security-Policy violations from client browsers.
// This endpoint is called by the browser's CSP report-only directive.
// Violations indicate either a new unapproved external resource or a misconfiguration.
//
// Logging CSP violations helps us:
// 1. Detect new external dependencies added without approval
// 2. Identify third-party service domain changes or hijacking
// 3. Catch CDN misconfiguration in production
//
// This endpoint does NOT send data to external services.
// All logs remain within the terminal backend infrastructure.
func handleCSPReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Limit request size to prevent abuse (1 MB max)
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var report CSPViolationReport
	if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
		log.Printf("CSP report decode error: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	// Log the violation with structured format
	logCSPViolation(&report.CspReport)

	w.WriteHeader(http.StatusNoContent)
}

// logCSPViolation logs a CSP violation in a structured format for easy parsing.
// Critical violations (unexpected external resources) should trigger alerts.
func logCSPViolation(csp *CSPReport) {
	buf := &bytes.Buffer{}

	// Structured logging: timestamp | severity | directive | blocked-uri | document-uri
	severity := "warning"
	if isUnapprovedOrigin(csp.BlockedURI) {
		severity = "critical"
	}

	buf.WriteString(time.Now().Format(time.RFC3339))
	buf.WriteString(" | ")
	buf.WriteString(severity)
	buf.WriteString(" | CSP Violation")
	buf.WriteString(" | directive=")
	buf.WriteString(strconv.Quote(csp.EffectiveDirective))
	buf.WriteString(" blocked-uri=")
	buf.WriteString(strconv.Quote(csp.BlockedURI))
	buf.WriteString(" document-uri=")
	buf.WriteString(strconv.Quote(csp.DocumentURI))

	if csp.SourceFile != "" {
		buf.WriteString(" source-file=")
		buf.WriteString(strconv.Quote(csp.SourceFile))
		buf.WriteString(":")
		buf.WriteString(jsonInt(csp.LineNumber))
	}

	log.Println(buf.String())
}

// isUnapprovedOrigin checks if the blocked URI is from an expected, approved external origin.
// Unapproved origins indicate a potential security issue (new dependency, misconfiguration, or attack).
func isUnapprovedOrigin(blockedURI string) bool {
	// Approved CDN: jsDelivr (xterm, Monaco)
	// Approved fonts: Google Fonts
	// Approved icons: FontAwesome, Boxicons, Simmer.io embed
	// All other origins are considered unapproved.
	parsed, err := url.Parse(strings.TrimSpace(blockedURI))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}

	parsedOrigin := strings.ToLower(parsed.Scheme + "://" + parsed.Host)

	approvedOrigins := []string{
		"https://cdn.jsdelivr.net",
		"https://fonts.googleapis.com",
		"https://fonts.gstatic.com",
		"https://kit.fontawesome.com",
		"https://ka-f.fontawesome.com",
		"https://unpkg.com",
		"https://i.simmer.io",
		"https://cloud.umami.is",
		"https://www.chatbase.co",
		"https://www.youtube.com",
		"https://cyberminds-terminal-20260621-ncus.northcentralus.cloudapp.azure.com",
	}

	for _, approvedOrigin := range approvedOrigins {
		// Keep the comparison exact; a trusted prefix must not trust an
		// attacker-controlled host such as cdn.jsdelivr.net.evil.example.
		if parsedOrigin == approvedOrigin {
			return false
		}
	}

	// If no match, it's unapproved
	return true
}

func jsonInt(i int) string {
	return strconv.Itoa(i)
}
