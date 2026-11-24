package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/cat-chat/api/internal/store"
)

func do(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestHealth(t *testing.T) {
	rec := do(t, newHandler(store.NewMemory()), "GET", "/api/health", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"ok"`) {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
}

func TestPostLimits(t *testing.T) {
	h := newHandler(store.NewMemory())
	cases := []struct {
		name, body string
		want       int
	}{
		{"ok", `{"content":"喵","images":[]}`, 201},
		{"empty", `{"content":"  ","images":[]}`, 400},
		{"500 chinese chars ok", `{"content":"` + strings.Repeat("猫", 500) + `","images":[]}`, 201},
		{"501 chars", `{"content":"` + strings.Repeat("猫", 501) + `","images":[]}`, 400},
		{"6 images", `{"content":"x","images":["https://a/1","https://a/2","https://a/3","https://a/4","https://a/5","https://a/6"]}`, 400},
		{"bad image url", `{"content":"x","images":["javascript:alert(1)"]}`, 400},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if rec := do(t, h, "POST", "/api/posts", c.body); rec.Code != c.want {
				t.Fatalf("got %d want %d: %s", rec.Code, c.want, rec.Body)
			}
		})
	}
}

func TestReplyThreadLimit(t *testing.T) {
	h := newHandler(store.NewMemory())
	var p struct{ Id string }
	_ = json.Unmarshal(do(t, h, "POST", "/api/posts", `{"content":"hi","images":[]}`).Body.Bytes(), &p)
	path := "/api/posts/" + p.Id + "/replies"

	if rec := do(t, h, "POST", path, `{"content":"`+strings.Repeat("喵", 101)+`","images":[]}`); rec.Code != 400 {
		t.Fatalf("101-char reply: got %d", rec.Code)
	}
	for i := range store.MaxRepliesPerPost {
		if rec := do(t, h, "POST", path, `{"content":"r","images":[]}`); rec.Code != 201 {
			t.Fatalf("reply %d: got %d", i+1, rec.Code)
		}
	}
	if rec := do(t, h, "POST", path, `{"content":"r","images":[]}`); rec.Code != 409 {
		t.Fatalf("11th reply: got %d want 409", rec.Code)
	}
	if rec := do(t, h, "POST", "/api/posts/nope/replies", `{"content":"r","images":[]}`); rec.Code != 404 {
		t.Fatalf("missing post: got %d", rec.Code)
	}
}
