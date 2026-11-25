package auth

import (
	"testing"
	"time"
)

func TestPasswordRoundTrip(t *testing.T) {
	h, err := HashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := VerifyPassword("correct horse", h); !ok || err != nil {
		t.Fatalf("right password rejected: %v", err)
	}
	if ok, _ := VerifyPassword("wrong horse", h); ok {
		t.Fatal("wrong password accepted")
	}
	h2, _ := HashPassword("correct horse")
	if h == h2 {
		t.Fatal("hashes must be salted")
	}
	if _, err := VerifyPassword("x", "garbage"); err == nil {
		t.Fatal("malformed hash should error")
	}
}

func TestLoginLimiter(t *testing.T) {
	now := time.Unix(0, 0)
	l := NewLoginLimiter()
	l.Now = func() time.Time { return now }
	for range l.MaxFailures {
		if l.Blocked("a") {
			t.Fatal("blocked too early")
		}
		l.Fail("a")
	}
	if !l.Blocked("a") {
		t.Fatal("should be blocked")
	}
	if l.Blocked("b") {
		t.Fatal("keys must be independent")
	}
	now = now.Add(l.Window + time.Second)
	if l.Blocked("a") {
		t.Fatal("should unblock after window")
	}
	l.Fail("a")
	l.Reset("a")
	if l.Blocked("a") {
		t.Fatal("reset should clear")
	}
}
