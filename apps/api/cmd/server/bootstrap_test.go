package main

import (
	"context"
	"testing"

	"github.com/cat-chat/api/internal/auth"
	"github.com/cat-chat/api/internal/store"
)

func TestEnsureAdmin(t *testing.T) {
	ctx := context.Background()

	t.Run("not configured", func(t *testing.T) {
		email, err := ensureAdmin(ctx, store.NewMemory(), adminBootstrap{})
		if err != nil || email != "" {
			t.Fatalf("got %q %v", email, err)
		}
		if _, err := ensureAdmin(ctx, store.NewMemory(), adminBootstrap{Password: "longpassword1"}); err == nil {
			t.Fatal("password without email should fail")
		}
	})

	t.Run("creates once, then leaves the account alone", func(t *testing.T) {
		st := store.NewMemory()
		b := adminBootstrap{Email: " Boss@Cat.dev ", Password: "first-password", Nickname: "admin"}
		email, err := ensureAdmin(ctx, st, b)
		if err != nil || email != "boss@cat.dev" {
			t.Fatalf("got %q %v", email, err)
		}
		u, hash, err := st.UserByEmail(ctx, "boss@cat.dev")
		if err != nil || u.Nickname != "admin" {
			t.Fatalf("user %+v %v", u, err)
		}
		if ok, _ := auth.VerifyPassword("first-password", hash); !ok {
			t.Fatal("password not set")
		}
		// A changed env password must not overwrite the existing account.
		b.Password = "second-password"
		if _, err := ensureAdmin(ctx, st, b); err != nil {
			t.Fatal(err)
		}
		_, hash2, _ := st.UserByEmail(ctx, "boss@cat.dev")
		if hash2 != hash {
			t.Fatal("existing password was overwritten")
		}
		// Even without a password, an existing account is fine.
		if _, err := ensureAdmin(ctx, st, adminBootstrap{Email: "boss@cat.dev"}); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("validation", func(t *testing.T) {
		cases := map[string]adminBootstrap{
			"no password":       {Email: "a@b.co"},
			"too short":         {Email: "a@b.co", Password: "short"},
			"weak in prod":      {Email: "a@b.co", Password: "12345678", Production: true},
			"not an email":      {Email: "admin", Password: "longpassword1"},
			"nickname too long": {Email: "a@b.co", Password: "longpassword1", Nickname: "猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫"},
		}
		for name, b := range cases {
			if _, err := ensureAdmin(ctx, store.NewMemory(), b); err == nil {
				t.Errorf("%s: expected an error", name)
			}
		}
		// Weak passwords only warn in development.
		if _, err := ensureAdmin(ctx, store.NewMemory(), adminBootstrap{Email: "a@b.co", Password: "12345678"}); err != nil {
			t.Fatalf("dev weak password: %v", err)
		}
	})
}
