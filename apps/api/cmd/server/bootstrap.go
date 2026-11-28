package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"unicode/utf8"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/auth"
)

// adminBootstrap is the account ensured on every start (ADMIN_EMAIL,
// ADMIN_PASSWORD, ADMIN_NICKNAME). Keep the values in .env.local / the
// deployment's secrets, never in git.
type adminBootstrap struct {
	Email, Password, Nickname string
	// Production (real email configured) refuses short passwords.
	Production bool
}

const prodAdminPasswordMin = 12

// ensureAdmin creates the bootstrap admin if no account has that email.
// An existing account is left as is — its password is never overwritten,
// so changing it in the app sticks across restarts. Returns the
// normalized email ("" when bootstrap is not configured).
func ensureAdmin(ctx context.Context, st api.Store, b adminBootstrap) (string, error) {
	email := strings.ToLower(strings.TrimSpace(b.Email))
	if email == "" {
		if b.Password != "" {
			return "", errors.New("ADMIN_PASSWORD is set but ADMIN_EMAIL is not")
		}
		return "", nil
	}
	if !strings.Contains(email, "@") {
		return "", fmt.Errorf("ADMIN_EMAIL %q is not an email address", email)
	}
	if _, _, err := st.UserByEmail(ctx, email); err == nil {
		slog.Info("admin account present", "email", email)
		return email, nil
	} else if !errors.Is(err, api.ErrNotFound) {
		return "", err
	}

	// Only validate the password when we actually need it.
	n := utf8.RuneCountInString(b.Password)
	switch {
	case b.Password == "":
		return "", errors.New("ADMIN_PASSWORD is required to create the admin account " + email)
	case n < 8 || n > 128:
		return "", errors.New("ADMIN_PASSWORD must be 8–128 characters")
	case b.Production && n < prodAdminPasswordMin:
		return "", fmt.Errorf("ADMIN_PASSWORD must be at least %d characters in production", prodAdminPasswordMin)
	case n < prodAdminPasswordMin:
		slog.Warn("ADMIN_PASSWORD is weak; use a long random password before going live")
	}
	nickname := strings.TrimSpace(b.Nickname)
	if nickname == "" {
		nickname = "admin"
	}
	if c := utf8.RuneCountInString(nickname); c > 20 {
		return "", errors.New("ADMIN_NICKNAME must be at most 20 characters")
	}
	hash, err := auth.HashPassword(b.Password)
	if err != nil {
		return "", err
	}
	if _, err := st.CreateUser(ctx, email, nickname, hash); err != nil && !errors.Is(err, api.ErrEmailTaken) {
		return "", err // ErrEmailTaken: another instance created it meanwhile
	}
	slog.Info("created admin account", "email", email, "nickname", nickname)
	return email, nil
}
