package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cat-chat/api/internal/auth"
	"github.com/cat-chat/api/internal/mail"
)

// Verification-code rules (product requirement: 6 digits, valid 5 minutes).
const (
	CodeTTL          = 5 * time.Minute
	ResendCooldown   = 60 * time.Second
	MaxCodeAttempts  = 5
	MaxSendsPerEmail = 5 // per SendWindow
	SendWindow       = time.Hour
)

type clientIPKey struct{}

// ClientIPMiddleware records the TCP peer address for rate limiting.
// X-Forwarded-For is deliberately ignored (spoofable); behind a reverse
// proxy, replace this with the proxy's trusted header.
func ClientIPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientIPKey{}, host)))
	})
}

func clientIP(ctx context.Context) string {
	ip, _ := ctx.Value(clientIPKey{}).(string)
	return ip
}

// newCode returns a fresh 6-digit code, or FixedCode when set (local testing
// only — main refuses to start with it when real email is configured).
func (s *Server) newCode() (string, error) {
	if s.FixedCode != "" {
		return s.FixedCode, nil
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func codeHash(email, code string) string {
	sum := sha256.Sum256([]byte(email + ":" + code))
	return hex.EncodeToString(sum[:])
}

// sendGate applies the per-email code-sending rules: 60 s cooldown and at
// most MaxSendsPerEmail sends per SendWindow. Shared by sign-up and
// password reset.
type sendGate struct {
	exists                bool
	lastSent, windowStart time.Time
	count                 int
}

// check returns the new send count/window on success, or ok=false and when
// sending will be allowed again.
func (g sendGate) check(now time.Time) (count int, windowStart, retryAt time.Time, ok bool) {
	if !g.exists {
		return 1, now, time.Time{}, true
	}
	if until := g.lastSent.Add(ResendCooldown); now.Before(until) {
		return 0, time.Time{}, until, false
	}
	if now.Before(g.windowStart.Add(SendWindow)) {
		if g.count >= MaxSendsPerEmail {
			return 0, time.Time{}, g.windowStart.Add(SendWindow), false
		}
		return g.count + 1, g.windowStart, time.Time{}, true
	}
	return 1, now, time.Time{}, true
}

func secondsUntil(t, now time.Time) int {
	s := int(t.Sub(now).Seconds() + 0.999)
	return max(s, 1)
}

func (s *Server) StartRegistration(ctx context.Context, req StartRegistrationRequestObject) (StartRegistrationResponseObject, error) {
	bad := func(msg string) (StartRegistrationResponseObject, error) {
		return StartRegistration400JSONResponse{BadRequestJSONResponse{Message: msg}}, nil
	}
	if req.Body == nil {
		return bad("missing body")
	}
	email, err := normalizeEmail(req.Body.Email)
	if err != nil {
		return bad(err.Error())
	}
	nickname := strings.TrimSpace(req.Body.Nickname)
	if n := utf8.RuneCountInString(nickname); n == 0 || n > nicknameMaxChars {
		return bad("nickname must be 1–20 characters")
	}
	if n := utf8.RuneCountInString(req.Body.Password); n < passwordMinChars || n > passwordMaxChars {
		return bad("password must be 8–128 characters")
	}
	if _, _, err := s.Store.UserByEmail(ctx, email); err == nil {
		return StartRegistration409JSONResponse{Message: "this email is already registered"}, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	now := s.Now()
	limited := func(until time.Time) (StartRegistrationResponseObject, error) {
		return StartRegistration429JSONResponse{
			Message:           "please wait before requesting another code",
			RetryAfterSeconds: secondsUntil(until, now),
		}, nil
	}
	var gate sendGate
	if prev, err := s.Store.PendingRegistration(ctx, email); err == nil {
		gate = sendGate{exists: true, lastSent: prev.LastSentAt, windowStart: prev.WindowStart, count: prev.SendCount}
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	sendCount, windowStart, until, ok := gate.check(now)
	if !ok {
		return limited(until)
	}
	ip := clientIP(ctx)
	if s.SendLimiter.Blocked(ip) {
		return limited(now.Add(SendWindow))
	}

	hash, err := auth.HashPassword(req.Body.Password)
	if err != nil {
		return nil, err
	}
	code, err := s.newCode()
	if err != nil {
		return nil, err
	}
	err = s.Store.SavePendingRegistration(ctx, PendingRegistration{
		Email: email, Nickname: nickname, PasswordHash: hash, CodeHash: codeHash(email, code),
		ExpiresAt: now.Add(CodeTTL), LastSentAt: now, SendCount: sendCount, WindowStart: windowStart,
	})
	if err != nil {
		return nil, err
	}
	s.SendLimiter.Fail(ip) // counts sends, not failures
	if err := s.Mailer.Send(ctx, mail.VerificationEmail(email, code, CodeTTL)); err != nil {
		slog.Error("verification email failed", "err", err)
		// Let the user retry immediately rather than wait out a cooldown
		// for an email that never went out.
		_ = s.Store.DeletePendingRegistration(ctx, email)
		return nil, err
	}
	return StartRegistration202JSONResponse{
		ExpiresInSeconds: int(CodeTTL.Seconds()), ResendAfterSeconds: int(ResendCooldown.Seconds()),
	}, nil
}

func (s *Server) VerifyRegistration(ctx context.Context, req VerifyRegistrationRequestObject) (VerifyRegistrationResponseObject, error) {
	gone := VerifyRegistration410JSONResponse{Message: "code expired, request a new one"}
	if req.Body == nil {
		return gone, nil
	}
	email, err := normalizeEmail(req.Body.Email)
	if err != nil {
		return gone, nil
	}
	pend, err := s.Store.PendingRegistration(ctx, email)
	if errors.Is(err, ErrNotFound) {
		return gone, nil
	}
	if err != nil {
		return nil, err
	}
	if !s.Now().Before(pend.ExpiresAt) || pend.Attempts >= MaxCodeAttempts {
		return gone, nil // row stays until stale so the send rate limit keeps working
	}

	if subtle.ConstantTimeCompare([]byte(codeHash(email, strings.TrimSpace(req.Body.Code))), []byte(pend.CodeHash)) != 1 {
		attempts, err := s.Store.RecordWrongCode(ctx, email)
		if err != nil {
			return nil, err
		}
		return VerifyRegistration400JSONResponse{
			Message: "incorrect verification code", AttemptsLeft: max(MaxCodeAttempts-attempts, 0),
		}, nil
	}

	u, err := s.Store.CompleteRegistration(ctx, email)
	if errors.Is(err, ErrEmailTaken) {
		_ = s.Store.DeletePendingRegistration(ctx, email)
		return VerifyRegistration409JSONResponse{Message: "this email is already registered"}, nil
	}
	if errors.Is(err, ErrNotFound) {
		return gone, nil
	}
	if err != nil {
		return nil, err
	}
	cookie, err := s.startSession(ctx, u.Id)
	if err != nil {
		return nil, err
	}
	u.IsAdmin = s.isAdmin(u.Email)
	return VerifyRegistration201JSONResponse{Body: u, Headers: VerifyRegistration201ResponseHeaders{SetCookie: &cookie}}, nil
}
