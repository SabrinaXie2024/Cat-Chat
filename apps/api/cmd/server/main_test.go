package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/auth"
	"github.com/cat-chat/api/internal/blob"
	"github.com/cat-chat/api/internal/mail"
	"github.com/cat-chat/api/internal/store"
	"github.com/cat-chat/api/internal/videos"
)

// captureMailer records verification codes instead of sending them.
type captureMailer struct {
	mu    sync.Mutex
	codes map[string]string // email -> last code
	sent  int
}

var codeRe = regexp.MustCompile(`\b\d{6}\b`)

func (m *captureMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.codes[msg.To] = codeRe.FindString(msg.Text)
	m.sent++
	return nil
}

// mailers maps each test server to its mailbox, so clients that share a
// server (other.srv = c.srv) read the same codes.
var mailers sync.Map // *httptest.Server -> *captureMailer

func (c *client) mailbox() *captureMailer {
	m, _ := mailers.Load(c.srv)
	return m.(*captureMailer)
}

// clock lets tests move time forward (code expiry, cooldowns).
type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (k *clock) Now() time.Time          { k.mu.Lock(); defer k.mu.Unlock(); return k.now }
func (k *clock) Advance(d time.Duration) { k.mu.Lock(); k.now = k.now.Add(d); k.mu.Unlock() }

var clocks sync.Map // *httptest.Server -> *clock

func (c *client) clock() *clock {
	k, _ := clocks.Load(c.srv)
	return k.(*clock)
}

// client is a browser-like test client: real HTTP server + cookie jar.
type client struct {
	t   *testing.T
	srv *httptest.Server
	hc  *http.Client
}

func newClient(t *testing.T) *client {
	t.Helper()
	videoDir := t.TempDir()
	mb := &captureMailer{codes: map[string]string{}}
	clk := &clock{now: time.Now()}
	srv := httptest.NewServer(newHandler(&api.Server{
		Mailer:       mb,
		SendLimiter:  newSendLimiter(),
		Store:        store.NewMemory(),
		Blobs:        blob.Local{Dir: t.TempDir()},
		VideoBlobs:   blob.Local{Dir: videoDir, Ext: ".video"},
		Videos:       videos.Processor{},
		VideoWorkDir: filepath.Join(videoDir, ".tmp"),
		AdminEmails:  map[string]bool{"admin@cat.dev": true},
		Limiter:      auth.NewLoginLimiter(),
		Now:          clk.Now,
	}))
	t.Cleanup(srv.Close)
	mailers.Store(srv, mb)
	clocks.Store(srv, clk)
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

// register runs both sign-up steps (start, then verify with the emailed
// code) and returns the verify response.
func (c *client) register(email, password, nickname string) (int, string, http.Header) {
	c.t.Helper()
	body, _ := json.Marshal(map[string]string{"email": email, "password": password, "nickname": nickname})
	if code, b, _ := c.do("POST", "/api/auth/register/start", string(body)); code != 202 {
		return code, b, nil
	}
	norm := strings.ToLower(strings.TrimSpace(email))
	verify, _ := json.Marshal(map[string]string{"email": email, "code": c.mailbox().codes[norm]})
	return c.do("POST", "/api/auth/register/verify", string(verify))
}

func (c *client) mustRegister(email, nickname string) {
	c.t.Helper()
	if code, b, _ := c.register(email, "password123", nickname); code != 201 {
		c.t.Fatalf("register %s: %d %s", email, code, b)
	}
}

func (c *client) signUp() {
	c.t.Helper()
	c.mustRegister("mimi@example.com", "咪咪")
}

func TestHealth(t *testing.T) {
	newClient(t).mustStatus(200, "GET", "/api/health", "")
}

func TestAuthFlow(t *testing.T) {
	c := newClient(t)
	c.mustStatus(401, "GET", "/api/auth/me", "")

	code, body, hdr := c.register(" Mimi@Example.com ", "password123", "咪咪")
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
	_, _, hdr := c.register("a@b.co", "password123", "a")
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
			if code, b, _ := c.do("POST", "/api/auth/register/start", tc.body); code != tc.want {
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
		{"6 images", `{"content":"x","images":["01a2111c-2a68-7371-bce0-5b41e2f69f41","01a2111c-2a68-7371-bce0-5b41e2f69f42","01a2111c-2a68-7371-bce0-5b41e2f69f43","01a2111c-2a68-7371-bce0-5b41e2f69f44","01a2111c-2a68-7371-bce0-5b41e2f69f45","01a2111c-2a68-7371-bce0-5b41e2f69f46"]}`, 400},
		{"url instead of image id", `{"content":"x","images":["javascript:alert(1)"]}`, 400},
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

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// upload posts data as multipart field "file" and returns status + body.
func (c *client) upload(data []byte, hdr ...string) (int, string, http.Header) {
	c.t.Helper()
	return c.uploadTo("/api/images", data, hdr...)
}

func (c *client) uploadTo(path string, data []byte, hdr ...string) (int, string, http.Header) {
	c.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "cat.png")
	fw.Write(data)
	mw.Close()
	req, _ := http.NewRequest("POST", c.srv.URL+path, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
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

func (c *client) mustUpload() api.Image {
	c.t.Helper()
	code, body, _ := c.upload(pngBytes(c.t, 3000, 1500))
	if code != 201 {
		c.t.Fatalf("upload: %d %s", code, body)
	}
	var img api.Image
	_ = json.Unmarshal([]byte(body), &img)
	return img
}

func TestImageUploadAndServe(t *testing.T) {
	c := newClient(t)
	if code, _, _ := c.upload(pngBytes(t, 10, 10)); code != 401 {
		t.Fatalf("signed-out upload: %d", code)
	}
	c.signUp()
	img := c.mustUpload()
	if img.Width != 1920 || img.Height != 960 || img.Url != "/api/images/"+img.Id {
		t.Fatalf("bad image %+v", img)
	}

	res, err := http.Get(c.srv.URL + img.Url) // public, no cookie
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/jpeg" || !bytes.HasPrefix(b, []byte{0xFF, 0xD8}) {
		t.Fatalf("GET image: %d %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
	for k, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"Cache-Control":          "public, max-age=31536000, immutable",
	} {
		if got := res.Header.Get(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
	if !strings.Contains(res.Header.Get("Content-Security-Policy"), "sandbox") {
		t.Error("image responses should carry a sandbox CSP")
	}

	for _, path := range []string{"/api/images/00000000-0000-0000-0000-000000000000", "/api/images/..%2f..%2fetc%2fpasswd", "/api/images/nope"} {
		if code, _, _ := c.do("GET", path, ""); code != 404 {
			t.Errorf("GET %s: %d, want 404", path, code)
		}
	}
}

func TestImageUploadRejects(t *testing.T) {
	c := newClient(t)
	c.signUp()
	if code, body, _ := c.upload([]byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;")); code != 400 || !strings.Contains(body, "JPEG, PNG and WebP") {
		t.Fatalf("gif: %d %s", code, body)
	}
	if code, _, _ := c.upload(append(pngBytes(t, 10, 10), make([]byte, 5<<20)...)); code != 413 {
		t.Fatalf("over 5MB: %d", code)
	}
	if code, _, _ := c.upload(pngBytes(t, 10, 10), "Sec-Fetch-Site", "cross-site"); code != 403 {
		t.Fatalf("cross-site upload: %d", code)
	}
}

func TestPostImagesMustBeOwnUploads(t *testing.T) {
	c := newClient(t)
	c.signUp()
	mine := c.mustUpload()

	body := c.mustStatus(201, "POST", "/api/posts", `{"content":"带图","images":["`+mine.Id+`"]}`)
	var p api.Post
	_ = json.Unmarshal([]byte(body), &p)
	if len(p.Images) != 1 || p.Images[0] != mine.Url {
		t.Fatalf("post images = %v, want [%s]", p.Images, mine.Url)
	}
	var listed []api.Post
	_ = json.Unmarshal([]byte(c.mustStatus(200, "GET", "/api/posts", "")), &listed)
	if listed[0].Images[0] != mine.Url {
		t.Fatalf("list returns %v", listed[0].Images)
	}

	// Someone else's upload.
	other := newClient(t)
	other.srv = c.srv
	other.mustRegister("o@x.co", "o")
	theirs := other.mustUpload()

	for name, imgs := range map[string]string{
		"other user's image": `["` + theirs.Id + `"]`,
		"nonexistent id":     `["01a2111c-2a68-7371-bce0-5b41e2f69f46"]`,
		"duplicate":          `["` + mine.Id + `","` + mine.Id + `"]`,
		"external url":       `["https://evil.example/pixel.gif"]`,
	} {
		t.Run(name, func(t *testing.T) {
			c.mustStatus(400, "POST", "/api/posts", `{"content":"x","images":`+imgs+`}`)
			c.mustStatus(400, "POST", "/api/posts/"+p.Id+"/replies", `{"content":"x","images":`+imgs+`}`)
		})
	}

	reply := c.mustStatus(201, "POST", "/api/posts/"+p.Id+"/replies", `{"content":"回复带图","images":["`+mine.Id+`"]}`)
	if !strings.Contains(reply, mine.Url) {
		t.Fatalf("reply should return image url: %s", reply)
	}
}

func (c *client) signUpAs(email string) {
	c.t.Helper()
	c.mustRegister(email, "n")
}

func TestIsAdminFlag(t *testing.T) {
	admin := newClient(t)
	admin.signUpAs("Admin@Cat.dev") // case-insensitive
	if me := admin.mustStatus(200, "GET", "/api/auth/me", ""); !strings.Contains(me, `"isAdmin":true`) {
		t.Fatalf("admin me = %s", me)
	}
	user := newClient(t)
	user.srv = admin.srv
	user.signUpAs("someone@cat.dev")
	if me := user.mustStatus(200, "GET", "/api/auth/me", ""); !strings.Contains(me, `"isAdmin":false`) {
		t.Fatalf("user me = %s", me)
	}
}

func TestGalleryPhotos(t *testing.T) {
	admin := newClient(t)
	admin.signUpAs("admin@cat.dev")
	user := newClient(t)
	user.srv = admin.srv
	user.signUpAs("someone@cat.dev")
	anon := newClient(t)
	anon.srv = admin.srv

	img := admin.mustUpload()
	body := `{"kind":"photo","mediaId":"` + img.Id + `","caption":"  晒太阳  "}`
	anon.mustStatus(401, "POST", "/api/gallery", body)
	user.mustStatus(403, "POST", "/api/gallery", body)

	created := admin.mustStatus(201, "POST", "/api/gallery", body)
	var item api.GalleryItem
	_ = json.Unmarshal([]byte(created), &item)
	if item.Kind != "photo" || item.Url != img.Url || item.Caption != "晒太阳" || item.Width != img.Width {
		t.Fatalf("item = %+v", item)
	}

	var list []api.GalleryItem
	_ = json.Unmarshal([]byte(anon.mustStatus(200, "GET", "/api/gallery", "")), &list)
	if len(list) != 1 || list[0].Id != item.Id {
		t.Fatalf("public list = %+v", list)
	}

	// Validation: someone else's image, unknown kind, long caption.
	theirs := user.mustUpload()
	admin.mustStatus(400, "POST", "/api/gallery", `{"kind":"photo","mediaId":"`+theirs.Id+`","caption":""}`)
	admin.mustStatus(400, "POST", "/api/gallery", `{"kind":"gif","mediaId":"`+img.Id+`","caption":""}`)
	admin.mustStatus(400, "POST", "/api/gallery", `{"kind":"photo","mediaId":"`+img.Id+`","caption":"`+strings.Repeat("猫", 201)+`"}`)
	admin.mustStatus(400, "POST", "/api/gallery", `{"kind":"video","mediaId":"`+img.Id+`","caption":""}`) // kind mismatch

	user.mustStatus(403, "DELETE", "/api/gallery/"+item.Id, "")
	admin.mustStatus(204, "DELETE", "/api/gallery/"+item.Id, "")
	admin.mustStatus(404, "DELETE", "/api/gallery/"+item.Id, "")
}

func TestGalleryVideoUploadAndRange(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	src := filepath.Join(t.TempDir(), "in.mp4")
	if b, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10",
		"-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-metadata", "location=+31.2304+121.4737/", src).CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, b)
	}
	mp4, _ := os.ReadFile(src)

	admin := newClient(t)
	admin.signUpAs("admin@cat.dev")
	user := newClient(t)
	user.srv = admin.srv
	user.signUpAs("someone@cat.dev")

	if code, _, _ := user.uploadTo("/api/videos", mp4); code != 403 {
		t.Fatalf("non-admin video upload: %d", code)
	}
	if code, body, _ := admin.uploadTo("/api/videos", []byte("<html>")); code != 400 {
		t.Fatalf("bogus video: %d %s", code, body)
	}
	code, body, _ := admin.uploadTo("/api/videos", mp4)
	if code != 201 {
		t.Fatalf("video upload: %d %s", code, body)
	}
	var v api.Video
	_ = json.Unmarshal([]byte(body), &v)
	if v.Width != 320 || v.Height != 240 || !strings.HasPrefix(v.PosterUrl, "/api/images/") {
		t.Fatalf("video = %+v", v)
	}
	if code, _, _ := admin.do("GET", v.PosterUrl, ""); code != 200 {
		t.Fatalf("poster: %d", code)
	}

	item := admin.mustStatus(201, "POST", "/api/gallery", `{"kind":"video","mediaId":"`+v.Id+`","caption":"跑酷"}`)
	if !strings.Contains(item, `"url":"`+v.Url+`"`) || !strings.Contains(item, `"posterUrl":"`+v.PosterUrl+`"`) {
		t.Fatalf("gallery video item = %s", item)
	}

	// Range request for seeking, served publicly.
	req, _ := http.NewRequest("GET", admin.srv.URL+v.Url, nil)
	req.Header.Set("Range", "bytes=0-99")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	part, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 206 || len(part) != 100 || res.Header.Get("Content-Type") != "video/mp4" ||
		res.Header.Get("Accept-Ranges") != "bytes" || res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("range: %d len=%d headers=%v", res.StatusCode, len(part), res.Header)
	}
	if code, _, _ := admin.do("GET", "/api/videos/01a2111c-2a68-7371-bce0-5b41e2f69f46", ""); code != 404 {
		t.Fatalf("missing video: %d", code)
	}
}

func TestRegistrationNeedsEmailCode(t *testing.T) {
	c := newClient(t)
	start := `{"email":"new@cat.dev","password":"password123","nickname":"新猫"}`
	body := c.mustStatus(202, "POST", "/api/auth/register/start", start)
	if !strings.Contains(body, `"expiresInSeconds":300`) || !strings.Contains(body, `"resendAfterSeconds":60`) {
		t.Fatalf("start = %s", body)
	}
	code := c.mailbox().codes["new@cat.dev"]
	if len(code) != 6 {
		t.Fatalf("code = %q", code)
	}
	// No account yet: can't log in before verifying.
	c.mustStatus(401, "POST", "/api/auth/login", `{"email":"new@cat.dev","password":"password123"}`)

	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	resp := c.mustStatus(400, "POST", "/api/auth/register/verify", `{"email":"new@cat.dev","code":"`+wrong+`"}`)
	if !strings.Contains(resp, `"attemptsLeft":4`) {
		t.Fatalf("wrong code = %s", resp)
	}
	c.mustStatus(201, "POST", "/api/auth/register/verify", `{"email":"NEW@cat.dev","code":"`+code+`"}`)
	c.mustStatus(200, "GET", "/api/auth/me", "")
	// The code is single-use.
	c.mustStatus(410, "POST", "/api/auth/register/verify", `{"email":"new@cat.dev","code":"`+code+`"}`)
	// And the old one-step endpoint is gone.
	if code, _, _ := c.do("POST", "/api/auth/register", start); code != 404 && code != 405 {
		t.Fatalf("old /auth/register still answers: %d", code)
	}
}

func TestVerificationCodeExpiresAfter5Minutes(t *testing.T) {
	c := newClient(t)
	c.mustStatus(202, "POST", "/api/auth/register/start", `{"email":"x@cat.dev","password":"password123","nickname":"x"}`)
	code := c.mailbox().codes["x@cat.dev"]
	c.clock().Advance(5*time.Minute + time.Second)
	c.mustStatus(410, "POST", "/api/auth/register/verify", `{"email":"x@cat.dev","code":"`+code+`"}`)
}

func TestVerificationCodeVoidedAfter5WrongTries(t *testing.T) {
	c := newClient(t)
	c.mustStatus(202, "POST", "/api/auth/register/start", `{"email":"x@cat.dev","password":"password123","nickname":"x"}`)
	code := c.mailbox().codes["x@cat.dev"]
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	for i := range 5 {
		b := c.mustStatus(400, "POST", "/api/auth/register/verify", `{"email":"x@cat.dev","code":"`+wrong+`"}`)
		if want := fmt.Sprintf(`"attemptsLeft":%d`, 4-i); !strings.Contains(b, want) {
			t.Fatalf("try %d: %s", i+1, b)
		}
	}
	// Even the right code no longer works.
	c.mustStatus(410, "POST", "/api/auth/register/verify", `{"email":"x@cat.dev","code":"`+code+`"}`)
}

func TestResendCooldownAndNewCode(t *testing.T) {
	c := newClient(t)
	start := `{"email":"x@cat.dev","password":"password123","nickname":"x"}`
	c.mustStatus(202, "POST", "/api/auth/register/start", start)
	first := c.mailbox().codes["x@cat.dev"]

	b := c.mustStatus(429, "POST", "/api/auth/register/start", start)
	if !strings.Contains(b, `"retryAfterSeconds":60`) {
		t.Fatalf("cooldown = %s", b)
	}
	c.clock().Advance(61 * time.Second)
	c.mustStatus(202, "POST", "/api/auth/register/start", start)
	second := c.mailbox().codes["x@cat.dev"]
	if first != second {
		c.mustStatus(400, "POST", "/api/auth/register/verify", `{"email":"x@cat.dev","code":"`+first+`"}`) // old code dead
	}
	c.mustStatus(201, "POST", "/api/auth/register/verify", `{"email":"x@cat.dev","code":"`+second+`"}`)
}

func TestSendLimitsPerEmailAndPerIP(t *testing.T) {
	c := newClient(t)
	start := `{"email":"x@cat.dev","password":"password123","nickname":"x"}`
	for range api.MaxSendsPerEmail {
		c.mustStatus(202, "POST", "/api/auth/register/start", start)
		c.clock().Advance(61 * time.Second)
	}
	if b := c.mustStatus(429, "POST", "/api/auth/register/start", start); !strings.Contains(b, "retryAfterSeconds") {
		t.Fatalf("per-email cap: %s", b)
	}
	c.clock().Advance(time.Hour)
	c.mustStatus(202, "POST", "/api/auth/register/start", start) // window reset

	// One client IP can't mail-bomb many different addresses.
	ip := newClient(t)
	for i := range 20 {
		ip.mustStatus(202, "POST", "/api/auth/register/start", fmt.Sprintf(`{"email":"v%d@cat.dev","password":"password123","nickname":"v"}`, i))
	}
	ip.mustStatus(429, "POST", "/api/auth/register/start", `{"email":"v99@cat.dev","password":"password123","nickname":"v"}`)
	if n := ip.mailbox().sent; n != 20 {
		t.Fatalf("emails sent = %d, want 20", n)
	}
}

func TestEmailTakenDuringVerification(t *testing.T) {
	a := newClient(t)
	b := newClient(t)
	b.srv = a.srv
	a.mustStatus(202, "POST", "/api/auth/register/start", `{"email":"race@cat.dev","password":"password123","nickname":"a"}`)
	code := a.mailbox().codes["race@cat.dev"]
	// Someone else completes a sign-up for the same address first.
	a.clock().Advance(61 * time.Second)
	b.mustRegister("race@cat.dev", "b")
	a.mustStatus(410, "POST", "/api/auth/register/verify", `{"email":"race@cat.dev","code":"`+code+`"}`)
}

func TestPasswordResetFlow(t *testing.T) {
	c := newClient(t)
	c.signUp() // mimi@example.com / password123
	other := newClient(t)
	other.srv = c.srv
	other.mustStatus(200, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"password123"}`)

	anon := newClient(t)
	anon.srv = c.srv
	sentBefore := c.mailbox().sent
	anon.mustStatus(202, "POST", "/api/auth/password-reset/start", `{"email":" MIMI@example.com "}`)
	if c.mailbox().sent != sentBefore+1 {
		t.Fatal("registered email should get a code")
	}
	code := c.mailbox().codes["mimi@example.com"]
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}

	// A bad new password doesn't burn a try.
	b := anon.mustStatus(400, "POST", "/api/auth/password-reset/complete", `{"email":"mimi@example.com","code":"`+code+`","newPassword":"short"}`)
	if !strings.Contains(b, `"attemptsLeft":-1`) {
		t.Fatalf("short password: %s", b)
	}
	b = anon.mustStatus(400, "POST", "/api/auth/password-reset/complete", `{"email":"mimi@example.com","code":"`+wrong+`","newPassword":"newpassword1"}`)
	if !strings.Contains(b, `"attemptsLeft":4`) {
		t.Fatalf("wrong code: %s", b)
	}
	// Old password still works until the reset completes.
	newClientOn(t, c).mustStatus(200, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"password123"}`)

	me := anon.mustStatus(200, "POST", "/api/auth/password-reset/complete", `{"email":"mimi@example.com","code":"`+code+`","newPassword":"newpassword1"}`)
	if !strings.Contains(me, `"email":"mimi@example.com"`) {
		t.Fatalf("complete = %s", me)
	}
	anon.mustStatus(200, "GET", "/api/auth/me", "")  // signed in by the reset
	c.mustStatus(401, "GET", "/api/auth/me", "")     // every old session revoked
	other.mustStatus(401, "GET", "/api/auth/me", "") //
	newClientOn(t, c).mustStatus(401, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"password123"}`)
	newClientOn(t, c).mustStatus(200, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"newpassword1"}`)
	// Single use.
	anon.mustStatus(410, "POST", "/api/auth/password-reset/complete", `{"email":"mimi@example.com","code":"`+code+`","newPassword":"another-pass"}`)
}

// newClientOn returns a fresh cookie jar talking to c's server.
func newClientOn(t *testing.T, c *client) *client {
	n := newClient(t)
	n.srv = c.srv
	return n
}

func TestPasswordResetDoesNotRevealAccounts(t *testing.T) {
	c := newClient(t)
	c.signUp()
	sent := c.mailbox().sent

	real := c.mustStatus(202, "POST", "/api/auth/password-reset/start", `{"email":"mimi@example.com"}`)
	ghost := c.mustStatus(202, "POST", "/api/auth/password-reset/start", `{"email":"ghost@example.com"}`)
	if real != ghost {
		t.Fatalf("responses differ: %s vs %s", real, ghost)
	}
	if c.mailbox().sent != sent+1 {
		t.Fatalf("only the registered address should be emailed; sent %d", c.mailbox().sent-sent)
	}
	// Same cooldown behaviour for both.
	r1, _, _ := c.do("POST", "/api/auth/password-reset/start", `{"email":"mimi@example.com"}`)
	r2, _, _ := c.do("POST", "/api/auth/password-reset/start", `{"email":"ghost@example.com"}`)
	if r1 != 429 || r2 != 429 {
		t.Fatalf("cooldown: %d %d", r1, r2)
	}
	// No code can ever succeed for an unregistered email.
	for _, code := range []string{"000000", "123456", "999999"} {
		code, _, _ := c.do("POST", "/api/auth/password-reset/complete", `{"email":"ghost@example.com","code":"`+code+`","newPassword":"newpassword1"}`)
		if code == 200 {
			t.Fatal("reset succeeded for an unregistered email")
		}
	}
}

func TestPasswordResetExpiresAndUnlocksLogin(t *testing.T) {
	c := newClient(t)
	c.signUp()
	for range 5 {
		c.mustStatus(401, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"wrong-password"}`)
	}
	c.mustStatus(429, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"password123"}`)

	c.mustStatus(202, "POST", "/api/auth/password-reset/start", `{"email":"mimi@example.com"}`)
	code := c.mailbox().codes["mimi@example.com"]
	c.clock().Advance(5*time.Minute + time.Second)
	c.mustStatus(410, "POST", "/api/auth/password-reset/complete", `{"email":"mimi@example.com","code":"`+code+`","newPassword":"newpassword1"}`)

	c.mustStatus(202, "POST", "/api/auth/password-reset/start", `{"email":"mimi@example.com"}`)
	code = c.mailbox().codes["mimi@example.com"]
	c.mustStatus(200, "POST", "/api/auth/password-reset/complete", `{"email":"mimi@example.com","code":"`+code+`","newPassword":"newpassword1"}`)
	// The owner proved access, so the login lockout is lifted.
	newClientOn(t, c).mustStatus(200, "POST", "/api/auth/login", `{"email":"mimi@example.com","password":"newpassword1"}`)
}

func TestDevFixedCode(t *testing.T) {
	if v, err := devFixedCode("", false); v != "" || err != nil {
		t.Fatalf("unset: %q %v", v, err)
	}
	if v, err := devFixedCode("123456", false); v != "123456" || err != nil {
		t.Fatalf("dev: %q %v", v, err)
	}
	if _, err := devFixedCode("123456", true); err == nil {
		t.Fatal("must refuse a fixed code when real email is configured")
	}
	for _, bad := range []string{"12345", "1234567", "12345a"} {
		if _, err := devFixedCode(bad, false); err == nil {
			t.Fatalf("%q should be rejected", bad)
		}
	}
}

func TestFixedCodeIsUsedWhenSet(t *testing.T) {
	c := newClient(t)
	// Reach into the server under test: newClient builds it, so rebuild one
	// with FixedCode to check both flows honour it.
	mb := &captureMailer{codes: map[string]string{}}
	srv := httptest.NewServer(newHandler(&api.Server{
		Store: store.NewMemory(), Blobs: blob.Local{Dir: t.TempDir()}, Mailer: mb,
		SendLimiter: newSendLimiter(), Limiter: auth.NewLoginLimiter(), Now: time.Now, FixedCode: "123456",
	}))
	t.Cleanup(srv.Close)
	mailers.Store(srv, mb)
	c.srv = srv
	c.mustStatus(202, "POST", "/api/auth/register/start", `{"email":"f@cat.dev","password":"password123","nickname":"f"}`)
	c.mustStatus(201, "POST", "/api/auth/register/verify", `{"email":"f@cat.dev","code":"123456"}`)
	c.mustStatus(202, "POST", "/api/auth/password-reset/start", `{"email":"f@cat.dev"}`)
	c.mustStatus(200, "POST", "/api/auth/password-reset/complete", `{"email":"f@cat.dev","code":"123456","newPassword":"newpassword1"}`)
}

func TestProfileAndFollow(t *testing.T) {
	c := newClient(t)
	c.mustStatus(401, "PATCH", "/api/auth/me/profile", `{"avatar":"calico"}`)
	c.signUp()
	var me api.User
	_ = json.Unmarshal([]byte(c.mustStatus(200, "GET", "/api/auth/me", "")), &me)
	if me.Avatar != api.Orange {
		t.Fatalf("default avatar %q", me.Avatar)
	}
	c.mustStatus(400, "PATCH", "/api/auth/me/profile", `{"avatar":"https://evil.example/x.png"}`)
	c.mustStatus(400, "PATCH", "/api/auth/me/profile", `{"nickname":"   "}`)
	c.mustStatus(400, "PATCH", "/api/auth/me/profile", `{"nickname":"`+strings.Repeat("猫", 21)+`"}`)
	body := c.mustStatus(200, "PATCH", "/api/auth/me/profile", `{"nickname":" 小橘 ","avatar":"calico"}`)
	if !strings.Contains(body, `"nickname":"小橘"`) || !strings.Contains(body, `"avatar":"calico"`) {
		t.Fatalf("update: %s", body)
	}
	c.mustStatus(201, "POST", "/api/posts", `{"content":"hello","images":[]}`)

	other := newClient(t)
	other.srv = c.srv
	other.mustStatus(200, "GET", "/api/users/"+me.Id, "") // public
	other.mustStatus(404, "GET", "/api/users/nope", "")
	other.mustStatus(401, "PUT", "/api/users/"+me.Id+"/follow", "")
	other.signUpAs("other@example.com")
	other.mustStatus(204, "PUT", "/api/users/"+me.Id+"/follow", "")
	var p api.Profile
	_ = json.Unmarshal([]byte(other.mustStatus(200, "GET", "/api/users/"+me.Id, "")), &p)
	if p.FollowerCount != 1 || !p.FollowedByMe || p.PostCount != 1 || p.Nickname != "小橘" {
		t.Fatalf("profile %+v", p)
	}
	posts := other.mustStatus(200, "GET", "/api/users/"+me.Id+"/posts", "")
	if !strings.Contains(posts, `"authorAvatar":"calico"`) || !strings.Contains(posts, `"authorId":"`+me.Id+`"`) {
		t.Fatalf("posts: %s", posts)
	}
	c.mustStatus(400, "PUT", "/api/users/"+me.Id+"/follow", "")
	other.mustStatus(204, "DELETE", "/api/users/"+me.Id+"/follow", "")
	other.mustStatus(404, "PUT", "/api/users/nope/follow", "")
}

func TestLikesAndFavorites(t *testing.T) {
	c := newClient(t)
	c.signUp()
	var post api.Post
	_ = json.Unmarshal([]byte(c.mustStatus(201, "POST", "/api/posts", `{"content":"hi","images":[]}`)), &post)
	var me api.User
	_ = json.Unmarshal([]byte(c.mustStatus(200, "GET", "/api/auth/me", "")), &me)

	anon := newClient(t)
	anon.srv = c.srv
	anon.mustStatus(401, "PUT", "/api/posts/"+post.Id+"/like", "")
	anon.mustStatus(401, "GET", "/api/auth/me/favorites", "")

	c.mustStatus(204, "PUT", "/api/posts/"+post.Id+"/like", "")
	c.mustStatus(204, "PUT", "/api/posts/"+post.Id+"/favorite", "")
	c.mustStatus(404, "PUT", "/api/posts/nope/like", "")
	if body := c.mustStatus(200, "GET", "/api/posts", ""); !strings.Contains(body, `"likedByMe":true`) || !strings.Contains(body, `"favoritedByMe":true`) {
		t.Fatalf("own view: %s", body)
	}
	body := anon.mustStatus(200, "GET", "/api/posts", "")
	if !strings.Contains(body, `"likeCount":1`) || strings.Contains(body, `"likedByMe":true`) || strings.Contains(body, `"favoritedByMe":true`) {
		t.Fatalf("anonymous view: %s", body)
	}
	if body := anon.mustStatus(200, "GET", "/api/users/"+me.Id+"/likes", ""); !strings.Contains(body, post.Id) {
		t.Fatalf("likes are public: %s", body)
	}
	if body := c.mustStatus(200, "GET", "/api/auth/me/favorites", ""); !strings.Contains(body, post.Id) {
		t.Fatalf("favorites: %s", body)
	}
	c.mustStatus(204, "DELETE", "/api/posts/"+post.Id+"/favorite", "")
	if body := c.mustStatus(200, "GET", "/api/auth/me/favorites", ""); body != "[]\n" && body != "[]" {
		t.Fatalf("after unfavorite: %q", body)
	}
	anon.mustStatus(200, "GET", "/api/users/"+me.Id+"/followers", "")
	anon.mustStatus(404, "GET", "/api/users/nope/following", "")
}

func TestReplyModeration(t *testing.T) {
	owner := newClient(t)
	owner.signUp()
	var post api.Post
	_ = json.Unmarshal([]byte(owner.mustStatus(201, "POST", "/api/posts", `{"content":"hi","images":[]}`)), &post)
	other := newClient(t)
	other.srv = owner.srv
	other.signUpAs("other@example.com")
	var reply api.Reply
	_ = json.Unmarshal([]byte(other.mustStatus(201, "POST", "/api/posts/"+post.Id+"/replies", `{"content":"yo","images":[]}`)), &reply)
	base := "/api/posts/" + post.Id + "/replies/" + reply.Id

	anon := newClient(t)
	anon.srv = owner.srv
	anon.mustStatus(401, "PUT", base+"/pin", "")
	anon.mustStatus(401, "POST", base+"/report", `{"reason":"spam"}`)
	other.mustStatus(403, "PUT", base+"/pin", "")
	bystander := newClient(t)
	bystander.srv = owner.srv
	bystander.signUpAs("bystander@example.com")
	bystander.mustStatus(403, "DELETE", base, "")
	other.mustStatus(400, "POST", base+"/report", `{"reason":"spam"}`) // own reply

	owner.mustStatus(204, "PUT", base+"/pin", "")
	if body := anon.mustStatus(200, "GET", "/api/posts/"+post.Id+"/replies", ""); !strings.Contains(body, `"pinned":true`) {
		t.Fatalf("pinned: %s", body)
	}
	owner.mustStatus(204, "DELETE", base+"/pin", "")
	owner.mustStatus(400, "POST", base+"/report", `{"reason":"nope"}`)
	owner.mustStatus(400, "POST", base+"/report", `{"reason":"other","note":"`+strings.Repeat("猫", 201)+`"}`)
	owner.mustStatus(204, "POST", base+"/report", `{"reason":"other","note":"`+strings.Repeat("猫", 200)+`"}`)
	owner.mustStatus(404, "POST", "/api/posts/"+post.Id+"/replies/nope/report", `{"reason":"spam"}`)
	owner.mustStatus(204, "DELETE", base, "")
	owner.mustStatus(404, "DELETE", base, "")

	// The comment's author may delete their own comment.
	var mine api.Reply
	_ = json.Unmarshal([]byte(other.mustStatus(201, "POST", "/api/posts/"+post.Id+"/replies", `{"content":"oops","images":[]}`)), &mine)
	other.mustStatus(204, "DELETE", "/api/posts/"+post.Id+"/replies/"+mine.Id, "")
}

func TestAdminReportReview(t *testing.T) {
	owner := newClient(t)
	owner.signUp()
	var post api.Post
	_ = json.Unmarshal([]byte(owner.mustStatus(201, "POST", "/api/posts", `{"content":"帖子正文","images":[]}`)), &post)
	troll := newClient(t)
	troll.srv = owner.srv
	troll.signUpAs("troll@example.com")
	var r1, r2 api.Reply
	_ = json.Unmarshal([]byte(troll.mustStatus(201, "POST", "/api/posts/"+post.Id+"/replies", `{"content":"bad","images":[]}`)), &r1)
	_ = json.Unmarshal([]byte(troll.mustStatus(201, "POST", "/api/posts/"+post.Id+"/replies", `{"content":"meh","images":[]}`)), &r2)
	owner.mustStatus(204, "POST", "/api/posts/"+post.Id+"/replies/"+r1.Id+"/report", `{"reason":"abuse","note":"rude"}`)
	owner.mustStatus(204, "POST", "/api/posts/"+post.Id+"/replies/"+r2.Id+"/report", `{"reason":"spam"}`)

	owner.mustStatus(403, "GET", "/api/admin/reports", "")
	owner.mustStatus(403, "POST", "/api/admin/reports/"+r1.Id, `{"action":"delete"}`)
	anon := newClient(t)
	anon.srv = owner.srv
	anon.mustStatus(401, "GET", "/api/admin/reports", "")

	admin := newClient(t)
	admin.srv = owner.srv
	admin.signUpAs("admin@cat.dev")
	admin.mustStatus(204, "POST", "/api/posts/"+post.Id+"/replies/"+r1.Id+"/report", `{"reason":"other"}`)
	var queue []api.ReportedReply
	_ = json.Unmarshal([]byte(admin.mustStatus(200, "GET", "/api/admin/reports", "")), &queue)
	if len(queue) != 2 || queue[0].Reply.Id != r1.Id || len(queue[0].Reports) != 2 || queue[0].PostExcerpt != "帖子正文" ||
		queue[0].Reports[0].Reporter.Nickname != "咪咪" || queue[0].Reports[0].Note != "rude" {
		t.Fatalf("queue: %+v", queue)
	}
	admin.mustStatus(400, "POST", "/api/admin/reports/"+r1.Id, `{"action":"ban"}`)
	admin.mustStatus(404, "POST", "/api/admin/reports/nope", `{"action":"dismiss"}`)
	admin.mustStatus(204, "POST", "/api/admin/reports/"+r2.Id, `{"action":"dismiss"}`)
	admin.mustStatus(204, "POST", "/api/admin/reports/"+r1.Id, `{"action":"delete"}`)
	if body := admin.mustStatus(200, "GET", "/api/admin/reports", ""); strings.TrimSpace(body) != "[]" {
		t.Fatalf("queue after review: %s", body)
	}
	if body := anon.mustStatus(200, "GET", "/api/posts/"+post.Id+"/replies", ""); strings.Contains(body, r1.Id) || !strings.Contains(body, r2.Id) {
		t.Fatalf("replies after review: %s", body)
	}
	// Reopened when someone reports a dismissed reply again.
	owner.mustStatus(204, "POST", "/api/posts/"+post.Id+"/replies/"+r2.Id+"/report", `{"reason":"spam"}`)
	if body := admin.mustStatus(200, "GET", "/api/admin/reports", ""); !strings.Contains(body, r2.Id) {
		t.Fatalf("re-report reopens: %s", body)
	}
}
