package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/auth"
	"github.com/cat-chat/api/internal/db"
	"github.com/cat-chat/api/internal/store"
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
	go purgeExpiredSessions(ctx, pg)

	addr := envOr("ADDR", ":8080")
	srv := &http.Server{
		Addr: addr,
		Handler: newHandler(&api.Server{
			Store:   pg,
			Limiter: auth.NewLoginLimiter(),
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

	var h http.Handler = mux
	h = s.SessionMiddleware(h)
	// CSRF: reject cross-origin browser POST/PUT/DELETE (Sec-Fetch-Site /
	// Origin check). SameSite=Lax cookies are the second layer.
	h = http.NewCrossOriginProtection().Handler(h)
	// Cap JSON bodies; image bytes go to object storage, not through here.
	return http.MaxBytesHandler(h, 64<<10)
}

func purgeExpiredSessions(ctx context.Context, pg *store.Postgres) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		if n, err := pg.DeleteExpiredSessions(ctx, time.Now()); err != nil && ctx.Err() == nil {
			slog.Warn("session purge failed", "err", err)
		} else if n > 0 {
			slog.Info("purged expired sessions", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
