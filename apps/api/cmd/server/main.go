package main

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/store"
)

func main() {
	addr := envOr("ADDR", ":8080")
	srv := &http.Server{
		Addr:              addr,
		Handler:           newHandler(store.NewMemory()),
		ReadHeaderTimeout: 5 * time.Second,
	}
	slog.Info("api listening", "addr", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func newHandler(st *store.Memory) http.Handler {
	s := &api.Server{
		Store:        st,
		IsNotFound:   func(err error) bool { return errors.Is(err, store.ErrNotFound) },
		IsThreadFull: func(err error) bool { return errors.Is(err, store.ErrThreadFull) },
	}
	h := api.NewStrictHandler(s, nil)
	mux := http.NewServeMux()
	api.HandlerWithOptions(h, api.StdHTTPServerOptions{BaseURL: "/api", BaseRouter: mux})
	// Cap JSON bodies; image bytes go to object storage, not through here.
	return http.MaxBytesHandler(mux, 64<<10)
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
