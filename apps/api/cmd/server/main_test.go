package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/auth"
	"github.com/cat-chat/api/internal/store"
)

// client is a browser-like test client: real HTTP server + cookie jar.
type client struct {
	t   *testing.T
	srv *httptest.Server
	hc  *http.Client
}

func newClient(t *testing.T) *client {
	t.Helper()
	srv := httptest.NewServer(newHandler(&api.Server{
		Store:   store.NewMemory(),
		Limiter: auth.NewLoginLimiter(),
		Now:     time.Now,
	}))
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	return &client{t: t, srv: srv, hc: &http.Client{Jar: jar}}
}

func (c *client) do(method, path, body string, hdr ...string) (int, string, http.Header) {
	c.t.Helper()
	req, _ := http.NewRequest(method, c.srv.URL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	res, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b), res.Header
}

func (c *client) mustStatus(want int, method, path, body string) string {
	c.t.Helper()
	code, b, _ := c.do(method, path, body)
	if code != want {
		c.t.Fatalf("%s %s: got %d want %d: %s", method, path, code, want, b)
	}
	return b
}

func (c *client) signUp() {
	c.t.Helper()
	c.mustStatus(201, "POST", "/api/auth/register", `{"email":"mimi@example.com","password":"password123","nickname":"咪咪"}`)
}

func TestHealth(t *testing.T) {
	newClient(t).mustStatus(200, "GET", "/api/health", "")
}

func TestAuthFlow(t *testing.T) {
	c := newClient(t)
	c.mustStatus(401, "GET", "/api/auth/me", "")

	code, body, hdr := c.do("POST", "/api/auth/register", `{"email":" Mimi@Example.com ","password":"password123","nickname":"咪咪"}`)
	if code != 201 {
		t.Fatalf("register: %d %s", code, body)
	}
	if strings.Contains(body, "password") || strings.Contains(body, "argon2") {
		t.Fatalf("response leaks credentials: %s", body)
	}
	sc := hdr.Get("Set-Cookie")
	for _, want := range []string{"cc_session=", "HttpOnly", "SameSite=Lax", "Path=/api"} {
		if !strings.Contains(sc, want) {
			t.Errorf("Set-Cookie %q missing %q", sc, want)
		}
	}

	var me api.User
	_ = json.Unmarshal([]byte(c.mustStatus(200, "GET", "/api/auth/me", "")), &me)
	if me.Email != "mimi@example.com" || me.Nickname != "咪咪" {
		t.Fatalf("me = %+v (email should be normalized)", me)
	}

	c.mustStatus(204, "POST", "/api/auth/logout", "")
	c.mustStatus(401, "GET", "/api/auth/me", "")

	// Wrong password, then right password (case-insensitive email).
	c.mustStatus(401, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"nope-nope"}`)
	c.mustStatus(200, "POST", "/api/auth/login", `{"email":"MIMI@example.com","password":"password123"}`)
	c.mustStatus(200, "GET", "/api/auth/me", "")
}

func TestLogoutRevokesServerSession(t *testing.T) {
	c := newClient(t)
	_, _, hdr := c.do("POST", "/api/auth/register", `{"email":"a@b.co","password":"password123","nickname":"a"}`)
	stolen := hdr.Get("Set-Cookie")
	stolen = stolen[:strings.Index(stolen, ";")]
	c.mustStatus(204, "POST", "/api/auth/logout", "")

	// Replaying the old cookie must not work: logout deletes it server-side.
	other := newClient(t)
	other.srv = c.srv
	code, _, _ := other.do("GET", "/api/auth/me", "", "Cookie", stolen)
	if code != 401 {
		t.Fatalf("replayed cookie after logout: got %d", code)
	}
}

func TestRegisterValidation(t *testing.T) {
	c := newClient(t)
	c.signUp()
	cases := []struct {
		name, body string
		want       int
	}{
		{"duplicate email", `{"email":"MIMI@example.com","password":"password123","nickname":"x"}`, 409},
		{"bad email", `{"email":"not-an-email","password":"password123","nickname":"x"}`, 400},
		{"display-name email", `{"email":"Mimi <m@x.co>","password":"password123","nickname":"x"}`, 400},
		{"short password", `{"email":"b@x.co","password":"1234567","nickname":"x"}`, 400},
		{"empty nickname", `{"email":"b@x.co","password":"password123","nickname":"  "}`, 400},
		{"long nickname", `{"email":"b@x.co","password":"password123","nickname":"` + strings.Repeat("猫", 21) + `"}`, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if code, b, _ := c.do("POST", "/api/auth/register", tc.body); code != tc.want {
				t.Fatalf("got %d want %d: %s", code, tc.want, b)
			}
		})
	}
}

func TestLoginRateLimit(t *testing.T) {
	c := newClient(t)
	c.signUp()
	bad := `{"email":"mimi@example.com","password":"wrong-password"}`
	for range 5 {
		c.mustStatus(401, "POST", "/api/auth/login", bad)
	}
	// Locked even with the right password.
	c.mustStatus(429, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"password123"}`)
	// Unknown emails are limited the same way (no enumeration via 429).
	for range 5 {
		c.mustStatus(401, "POST", "/api/auth/login", `{"email":"ghost@example.com","password":"x"}`)
	}
	c.mustStatus(429, "POST", "/api/auth/login", `{"email":"ghost@example.com","password":"x"}`)
}

func TestCSRFRejectsCrossOrigin(t *testing.T) {
	c := newClient(t)
	c.signUp()
	code, _, _ := c.do("POST", "/api/posts", `{"content":"hi","images":[]}`, "Sec-Fetch-Site", "cross-site")
	if code != http.StatusForbidden {
		t.Fatalf("cross-site POST: got %d want 403", code)
	}
	code, _, _ = c.do("POST", "/api/posts", `{"content":"hi","images":[]}`, "Origin", "https://evil.example")
	if code != http.StatusForbidden {
		t.Fatalf("foreign Origin POST: got %d want 403", code)
	}
	c.mustStatus(201, "POST", "/api/posts", `{"content":"hi","images":[]}`)
}

func TestWritesRequireAuth(t *testing.T) {
	c := newClient(t)
	c.mustStatus(401, "POST", "/api/posts", `{"content":"hi","images":[]}`)
	c.mustStatus(200, "GET", "/api/posts", "")
}

func TestPostLimits(t *testing.T) {
	c := newClient(t)
	c.signUp()
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
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if code, b, _ := c.do("POST", "/api/posts", tc.body); code != tc.want {
				t.Fatalf("got %d want %d: %s", code, tc.want, b)
			}
		})
	}
	var posts []api.Post
	_ = json.Unmarshal([]byte(c.mustStatus(200, "GET", "/api/posts", "")), &posts)
	if posts[0].Author != "咪咪" {
		t.Fatalf("author should be the signed-in nickname, got %q", posts[0].Author)
	}
}

func TestReplyThreadLimit(t *testing.T) {
	c := newClient(t)
	c.signUp()
	var p struct{ Id string }
	_ = json.Unmarshal([]byte(c.mustStatus(201, "POST", "/api/posts", `{"content":"hi","images":[]}`)), &p)
	path := "/api/posts/" + p.Id + "/replies"

	c.mustStatus(400, "POST", path, `{"content":"`+strings.Repeat("喵", 101)+`","images":[]}`)
	for range api.MaxRepliesPerPost {
		c.mustStatus(201, "POST", path, `{"content":"r","images":[]}`)
	}
	c.mustStatus(409, "POST", path, `{"content":"r","images":[]}`)
	c.mustStatus(404, "POST", "/api/posts/nope/replies", `{"content":"r","images":[]}`)
}

func TestChangePassword(t *testing.T) {
	c := newClient(t)
	c.signUp() // mimi@example.com / password123

	// Second device signed in to the same account.
	other := newClient(t)
	other.srv = c.srv
	other.mustStatus(200, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"password123"}`)

	cases := []struct {
		name, body string
		want       int
	}{
		{"wrong current", `{"currentPassword":"nope-nope","newPassword":"newpassword1"}`, 403},
		{"too short", `{"currentPassword":"password123","newPassword":"short"}`, 400},
		{"same as current", `{"currentPassword":"password123","newPassword":"password123"}`, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c.mustStatus(tc.want, "POST", "/api/auth/password", tc.body)
		})
	}

	code, body, hdr := c.do("POST", "/api/auth/password", `{"currentPassword":"password123","newPassword":"newpassword1"}`)
	if code != 204 {
		t.Fatalf("change: %d %s", code, body)
	}
	if sc := hdr.Get("Set-Cookie"); !strings.Contains(sc, "cc_session=") || !strings.Contains(sc, "HttpOnly") {
		t.Fatalf("expected rotated session cookie, got %q", sc)
	}
	c.mustStatus(200, "GET", "/api/auth/me", "")     // this device stays signed in
	other.mustStatus(401, "GET", "/api/auth/me", "") // the other device is signed out

	c.mustStatus(401, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"password123"}`)
	c.mustStatus(200, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"newpassword1"}`)
}

func TestChangePasswordGuards(t *testing.T) {
	c := newClient(t)
	c.mustStatus(401, "POST", "/api/auth/password", `{"currentPassword":"a","newPassword":"newpassword1"}`)

	c.signUp()
	for range 5 {
		c.mustStatus(403, "POST", "/api/auth/password", `{"currentPassword":"wrong-pass","newPassword":"newpassword1"}`)
	}
	// Locked even with the right current password, and /login shares the lock.
	c.mustStatus(429, "POST", "/api/auth/password", `{"currentPassword":"password123","newPassword":"newpassword1"}`)
	c.mustStatus(429, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"password123"}`)

	code, _, _ := c.do("POST", "/api/auth/password", `{"currentPassword":"password123","newPassword":"newpassword1"}`, "Sec-Fetch-Site", "cross-site")
	if code != http.StatusForbidden {
		t.Fatalf("cross-site change: got %d want 403", code)
	}
}
