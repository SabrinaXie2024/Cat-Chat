package main

import (
	"bytes"
	"encoding/json"
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
	"strings"
	"testing"
	"time"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/auth"
	"github.com/cat-chat/api/internal/blob"
	"github.com/cat-chat/api/internal/store"
	"github.com/cat-chat/api/internal/videos"
)

// client is a browser-like test client: real HTTP server + cookie jar.
type client struct {
	t   *testing.T
	srv *httptest.Server
	hc  *http.Client
}

func newClient(t *testing.T) *client {
	t.Helper()
	videoDir := t.TempDir()
	srv := httptest.NewServer(newHandler(&api.Server{
		Store:        store.NewMemory(),
		Blobs:        blob.Local{Dir: t.TempDir()},
		VideoBlobs:   blob.Local{Dir: videoDir, Ext: ".video"},
		Videos:       videos.Processor{},
		VideoWorkDir: filepath.Join(videoDir, ".tmp"),
		AdminEmails:  map[string]bool{"admin@cat.dev": true},
		Limiter:      auth.NewLoginLimiter(),
		Now:          time.Now,
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
	other.mustStatus(201, "POST", "/api/auth/register", `{"email":"o@x.co","password":"password123","nickname":"o"}`)
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
	c.mustStatus(201, "POST", "/api/auth/register", `{"email":"`+email+`","password":"password123","nickname":"n"}`)
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
