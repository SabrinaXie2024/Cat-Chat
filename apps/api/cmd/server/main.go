package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/auth"
	"github.com/cat-chat/api/internal/blob"
	"github.com/cat-chat/api/internal/db"
	"github.com/cat-chat/api/internal/mail"
	"github.com/cat-chat/api/internal/store"
	"github.com/cat-chat/api/internal/videos"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return errors.New("DATABASE_URL is required (pnpm dev:api sets a local default)")
	}
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return err
	}
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}
	pg := store.NewPostgres(pool)
	go purgeExpired(ctx, pg)

	var mailer mail.Mailer = mail.DevMailer{Dir: envOr("DEV_MAIL_DIR", "data/mail")}
	if key := os.Getenv("RESEND_API_KEY"); key != "" {
		from := os.Getenv("MAIL_FROM")
		if from == "" {
			return errors.New("MAIL_FROM is required with RESEND_API_KEY (e.g. \"MeowSphere <noreply@your-domain>\")")
		}
		mailer = mail.Resend{APIKey: key, From: from}
		slog.Info("email via Resend", "from", from)
	} else {
		slog.Warn("RESEND_API_KEY not set: verification emails are written to the dev mailbox, not sent")
	}
	fixedCode, err := devFixedCode(os.Getenv("DEV_FIXED_CODE"), os.Getenv("RESEND_API_KEY") != "")
	if err != nil {
		return err
	}

	if _, err := exec.LookPath(envOr("FFMPEG", "ffmpeg")); err != nil {
		slog.Warn("ffmpeg not found; video uploads will fail", "err", err)
	}
	videoDir := envOr("VIDEO_DIR", "data/videos")

	addr := envOr("ADDR", ":8080")
	srv := &http.Server{
		Addr: addr,
		Handler: newHandler(&api.Server{
			Store:        pg,
			Blobs:        blob.Local{Dir: envOr("IMAGE_DIR", "data/images")},
			VideoBlobs:   blob.Local{Dir: videoDir, Ext: ".video"},
			Videos:       videos.Processor{FFmpeg: os.Getenv("FFMPEG")},
			VideoWorkDir: filepath.Join(videoDir, ".tmp"),
			AdminEmails:  parseAdmins(os.Getenv("ADMIN_EMAILS")),
			Mailer:       mailer,
			SendLimiter:  newSendLimiter(),
			FixedCode:    fixedCode,
			Limiter:      auth.NewLoginLimiter(),
			// Secure cookies need HTTPS; local dev over plain http sets
			// INSECURE_COOKIES=1 (see root package.json dev:api).
			SecureCookies: os.Getenv("INSECURE_COOKIES") != "1",
			Now:           time.Now,
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errc := make(chan error, 1)
	go func() {
		slog.Info("api listening", "addr", addr)
		errc <- srv.ListenAndServe()
	}()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		slog.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

func newHandler(s *api.Server) http.Handler {
	mux := http.NewServeMux()
	api.HandlerWithOptions(api.NewStrictHandler(s, nil), api.StdHTTPServerOptions{BaseURL: "/api", BaseRouter: mux})
	mux.HandleFunc("GET /api/videos/{videoId}", s.ServeVideo) // Range support; excluded from codegen

	var h http.Handler = mux
	h = s.SessionMiddleware(h)
	h = api.ClientIPMiddleware(h)
	// CSRF: reject cross-origin browser POST/PUT/DELETE (Sec-Fetch-Site /
	// Origin check). SameSite=Lax cookies are the second layer.
	h = http.NewCrossOriginProtection().Handler(h)
	h = limitBodies(h)
	return securityHeaders(h)
}

// limitBodies caps request bodies: 64 KB for JSON, a little over the 5 MB
// image limit for uploads (multipart overhead).
func limitBodies(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		limit := int64(64 << 10)
		if r.Method == http.MethodPost {
			switch r.URL.Path {
			case "/api/images":
				limit = 6 << 20
			case "/api/videos":
				limit = 210 << 20
			}
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		// Never let a browser reinterpret a response as another type.
		h.Set("X-Content-Type-Options", "nosniff")
		if r.Method == http.MethodGet && (strings.HasPrefix(r.URL.Path, "/api/images/") || strings.HasPrefix(r.URL.Path, "/api/videos/")) {
			// Image ids are immutable, so the bytes never change.
			h.Set("Cache-Control", "public, max-age=31536000, immutable")
			// Belt and braces: even if a non-image slipped through, it can't run.
			h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
		}
		next.ServeHTTP(w, r)
	})
}

// devFixedCode validates DEV_FIXED_CODE. It's a local testing aid and is
// refused outright when real email is configured, so it can't reach users.
func devFixedCode(v string, realEmail bool) (string, error) {
	if v == "" {
		return "", nil
	}
	if realEmail {
		return "", errors.New("DEV_FIXED_CODE must not be set when RESEND_API_KEY is (real email = real users)")
	}
	if len(v) != 6 || strings.Trim(v, "0123456789") != "" {
		return "", errors.New("DEV_FIXED_CODE must be 6 digits")
	}
	slog.Warn("DEV_FIXED_CODE is set: every verification code is " + v + " (testing only)")
	return v, nil
}

// newSendLimiter caps verification emails per client IP: 20 per hour.
func newSendLimiter() *auth.LoginLimiter {
	l := auth.NewLoginLimiter()
	l.MaxFailures, l.Window = 20, time.Hour
	return l
}

func purgeExpired(ctx context.Context, pg *store.Postgres) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		now := time.Now()
		if n, err := pg.DeleteExpiredSessions(ctx, now); err != nil && ctx.Err() == nil {
			slog.Warn("session purge failed", "err", err)
		} else if n > 0 {
			slog.Info("purged expired sessions", "count", n)
		}
		if n, err := pg.DeleteStalePasswordResets(ctx, now); err != nil && ctx.Err() == nil {
			slog.Warn("password reset purge failed", "err", err)
		} else if n > 0 {
			slog.Info("purged stale password resets", "count", n)
		}
		if n, err := pg.DeleteStalePendingRegistrations(ctx, now); err != nil && ctx.Err() == nil {
			slog.Warn("pending registration purge failed", "err", err)
		} else if n > 0 {
			slog.Info("purged stale pending registrations", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// parseAdmins reads a comma-separated email list (case-insensitive).
func parseAdmins(v string) map[string]bool {
	out := map[string]bool{}
	for _, e := range strings.Split(v, ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			out[e] = true
		}
	}
	return out
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
