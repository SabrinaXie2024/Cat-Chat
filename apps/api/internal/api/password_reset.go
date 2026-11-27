package api

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cat-chat/api/internal/auth"
	"github.com/cat-chat/api/internal/mail"
)

// StartPasswordReset answers the same way for registered and unregistered
// emails (202, same rate limits) so it can't be used to discover accounts.
// Only registered emails are actually sent a code.
func (s *Server) StartPasswordReset(ctx context.Context, req StartPasswordResetRequestObject) (StartPasswordResetResponseObject, error) {
	if req.Body == nil {
		return StartPasswordReset400JSONResponse{BadRequestJSONResponse{Message: "missing body"}}, nil
	}
	email, err := normalizeEmail(req.Body.Email)
	if err != nil {
		return StartPasswordReset400JSONResponse{BadRequestJSONResponse{Message: err.Error()}}, nil
	}
	now := s.Now()
	limited := func(until time.Time) (StartPasswordResetResponseObject, error) {
		return StartPasswordReset429JSONResponse{
			Message: "please wait before requesting another code", RetryAfterSeconds: secondsUntil(until, now),
		}, nil
	}
	var gate sendGate
	if prev, err := s.Store.PasswordReset(ctx, email); err == nil {
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

	_, _, lookupErr := s.Store.UserByEmail(ctx, email)
	if lookupErr != nil && !errors.Is(lookupErr, ErrNotFound) {
		return nil, lookupErr
	}
	registered := lookupErr == nil

	code, err := newCode()
	if err != nil {
		return nil, err
	}
	err = s.Store.SavePasswordReset(ctx, ResetCode{
		Email: email, CodeHash: codeHash(email, code), ExpiresAt: now.Add(CodeTTL),
		LastSentAt: now, SendCount: sendCount, WindowStart: windowStart,
	})
	if err != nil {
		return nil, err
	}
	s.SendLimiter.Fail(ip)
	if registered {
		if err := s.Mailer.Send(ctx, mail.PasswordResetEmail(email, code, CodeTTL)); err != nil {
			slog.Error("password reset email failed", "err", err)
			_ = s.Store.DeletePasswordReset(ctx, email)
			return nil, err
		}
	}
	return StartPasswordReset202JSONResponse{
		ExpiresInSeconds: int(CodeTTL.Seconds()), ResendAfterSeconds: int(ResendCooldown.Seconds()),
	}, nil
}

func (s *Server) CompletePasswordReset(ctx context.Context, req CompletePasswordResetRequestObject) (CompletePasswordResetResponseObject, error) {
	gone := CompletePasswordReset410JSONResponse{Message: "code expired, request a new one"}
	if req.Body == nil {
		return gone, nil
	}
	email, err := normalizeEmail(req.Body.Email)
	if err != nil {
		return gone, nil
	}
	// Check the new password first: a typo there shouldn't burn a code try.
	if n := utf8.RuneCountInString(req.Body.NewPassword); n < passwordMinChars || n > passwordMaxChars {
		return CompletePasswordReset400JSONResponse{Message: "password must be 8–128 characters", AttemptsLeft: -1}, nil
	}
	rc, err := s.Store.PasswordReset(ctx, email)
	if errors.Is(err, ErrNotFound) {
		return gone, nil
	}
	if err != nil {
		return nil, err
	}
	if !s.Now().Before(rc.ExpiresAt) || rc.Attempts >= MaxCodeAttempts {
		return gone, nil
	}
	if subtle.ConstantTimeCompare([]byte(codeHash(email, strings.TrimSpace(req.Body.Code))), []byte(rc.CodeHash)) != 1 {
		attempts, err := s.Store.RecordWrongResetCode(ctx, email)
		if err != nil {
			return nil, err
		}
		return CompletePasswordReset400JSONResponse{
			Message: "incorrect verification code", AttemptsLeft: max(MaxCodeAttempts-attempts, 0),
		}, nil
	}

	u, _, err := s.Store.UserByEmail(ctx, email)
	if errors.Is(err, ErrNotFound) {
		return gone, nil // can only happen if the account was deleted meanwhile
	}
	if err != nil {
		return nil, err
	}
	hash, err := auth.HashPassword(req.Body.NewPassword)
	if err != nil {
		return nil, err
	}
	// Replaces the hash and revokes every session (stolen cookies die too).
	if err := s.Store.ChangePassword(ctx, u.Id, hash); err != nil {
		return nil, err
	}
	_ = s.Store.DeletePasswordReset(ctx, email)
	s.Limiter.Reset(email) // a locked-out owner who just proved access may sign in
	cookie, err := s.startSession(ctx, u.Id)
	if err != nil {
		return nil, err
	}
	u.IsAdmin = s.isAdmin(u.Email)
	slog.Info("password reset", "user", u.Id)
	return CompletePasswordReset200JSONResponse{Body: u, Headers: CompletePasswordReset200ResponseHeaders{SetCookie: &cookie}}, nil
}
