package mail

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestResendSendsExpectedRequest(t *testing.T) {
	var got map[string]any
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &got)
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id":"x"}`))
	}))
	defer srv.Close()

	r := Resend{APIKey: "re_test", From: "MeowSphere <noreply@example.com>", Endpoint: srv.URL}
	if err := r.Send(context.Background(), VerificationEmail("a@b.co", "123456", 5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer re_test" || got["from"] != "MeowSphere <noreply@example.com>" {
		t.Fatalf("auth=%q body=%v", auth, got)
	}
	if to := got["to"].([]any); to[0] != "a@b.co" {
		t.Fatalf("to = %v", to)
	}
	if !strings.Contains(got["text"].(string), "123456") || !strings.Contains(got["html"].(string), "123456") {
		t.Fatal("code missing from body")
	}
}

func TestResendReportsAPIErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(422)
		_, _ = w.Write([]byte(`{"message":"domain not verified"}`))
	}))
	defer srv.Close()
	err := Resend{APIKey: "k", From: "f", Endpoint: srv.URL}.Send(context.Background(), Message{To: "a@b.co"})
	if err == nil || !strings.Contains(err.Error(), "domain not verified") {
		t.Fatalf("err = %v", err)
	}
}

func TestDevMailerWritesFile(t *testing.T) {
	dir := t.TempDir()
	if err := (DevMailer{Dir: dir}).Send(context.Background(), VerificationEmail("A@b.co", "654321", 5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 || !strings.HasSuffix(entries[0].Name(), "_a@b.co.txt") {
		t.Fatalf("files = %v", entries)
	}
	b, _ := os.ReadFile(dir + "/" + entries[0].Name())
	if !strings.Contains(string(b), "654321") || !strings.Contains(string(b), "5 分钟") {
		t.Fatalf("content = %s", b)
	}
}
