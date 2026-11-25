package main

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/auth"
	"github.com/cat-chat/api/internal/store"
)

func main() {
	addr := envOr("ADDR", ":8080")
	srv := &http.Server{
		Addr: addr,
		Handler: newHandler(&api.Server{
			Store:   store.NewMemory(),
			Limiter: auth.NewLoginLimiter(),
			// Secure cookies need HTTPS; local dev over plain http sets
			// INSECURE_COOKIES=1 (see root package.json dev:api).
			SecureCookies: os.Getenv("INSECURE_COOKIES") != "1",
			Now:           time.Now,
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}
	slog.Info("api listening", "addr", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func newHandler(s *api.Server) http.Handler {
	mux := http.NewServeMux()
	api.HandlerWithOptions(api.NewStrictHandler(s, nil), api.StdHTTPServerOptions{BaseURL: "/api", BaseRouter: mux})

	var h http.Handler = mux
	h = s.SessionMiddleware(h)
	// CSRF: reject cross-origin browser POST/PUT/DELETE (Sec-Fetch-Site /
	// Origin check). SameSite=Lax cookies are the second layer.
	h = http.NewCrossOriginProtection().Handler(h)
	// Cap JSON bodies; image bytes go to object storage, not through here.
	return http.MaxBytesHandler(h, 64<<10)
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
