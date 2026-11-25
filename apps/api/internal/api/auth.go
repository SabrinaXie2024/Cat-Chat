package api

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"unicode/utf8"

	"github.com/cat-chat/api/internal/auth"
)

const (
	msgSignIn        = "please sign in"
	msgBadCreds      = "incorrect email or password"
	passwordMinChars = 8
	passwordMaxChars = 128
	nicknameMaxChars = 20
)

type (
	ctxKey      struct{}
	rawTokenKey struct{}
)

// UserFrom returns the signed-in user set by SessionMiddleware.
func UserFrom(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(ctxKey{}).(User)
	return u, ok
}

// SessionMiddleware resolves the session cookie to a user on every request.
// Handlers decide whether a user is required.
func (s *Server) SessionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(auth.CookieName); err == nil && c.Value != "" {
			// Kept so Logout can delete the session even if it already expired.
			r = r.WithContext(context.WithValue(r.Context(), rawTokenKey{}, c.Value))
			if u, err := s.Store.UserBySession(auth.HashToken(c.Value), s.Now()); err == nil {
				r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, u))
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Register(_ context.Context, req RegisterRequestObject) (RegisterResponseObject, error) {
	if req.Body == nil {
		return Register400JSONResponse{BadRequestJSONResponse{Message: "missing body"}}, nil
	}
	email, err := normalizeEmail(req.Body.Email)
	if err != nil {
		return Register400JSONResponse{BadRequestJSONResponse{Message: err.Error()}}, nil
	}
	nickname := strings.TrimSpace(req.Body.Nickname)
	if n := utf8.RuneCountInString(nickname); n == 0 || n > nicknameMaxChars {
		return Register400JSONResponse{BadRequestJSONResponse{Message: "nickname must be 1–20 characters"}}, nil
	}
	if n := utf8.RuneCountInString(req.Body.Password); n < passwordMinChars || n > passwordMaxChars {
		return Register400JSONResponse{BadRequestJSONResponse{Message: "password must be 8–128 characters"}}, nil
	}
	hash, err := auth.HashPassword(req.Body.Password)
	if err != nil {
		return nil, err
	}
	u, err := s.Store.CreateUser(email, nickname, hash)
	if errors.Is(err, ErrEmailTaken) {
		return Register409JSONResponse{Message: "this email is already registered"}, nil
	}
	if err != nil {
		return nil, err
	}
	cookie, err := s.startSession(u.Id)
	if err != nil {
		return nil, err
	}
	return Register201JSONResponse{Body: u, Headers: Register201ResponseHeaders{SetCookie: &cookie}}, nil
}

func (s *Server) Login(_ context.Context, req LoginRequestObject) (LoginResponseObject, error) {
	if req.Body == nil {
		return Login401JSONResponse{UnauthorizedJSONResponse{Message: msgBadCreds}}, nil
	}
	// Malformed emails can't match an account; key the limiter on the raw
	// lowercased input so they're still rate limited.
	email, err := normalizeEmail(req.Body.Email)
	if err != nil {
		email = strings.ToLower(strings.TrimSpace(req.Body.Email))
	}
	if s.Limiter.Blocked(email) {
		return Login429JSONResponse{Message: "too many failed attempts, try again in 15 minutes"}, nil
	}
	u, hash, err := s.Store.UserByEmail(email)
	if errors.Is(err, ErrNotFound) {
		hash = auth.DummyHash // equalize timing with the found-user path
	} else if err != nil {
		return nil, err
	}
	ok, verr := auth.VerifyPassword(req.Body.Password, hash)
	if err != nil || verr != nil || !ok {
		s.Limiter.Fail(email)
		return Login401JSONResponse{UnauthorizedJSONResponse{Message: msgBadCreds}}, nil
	}
	s.Limiter.Reset(email)
	cookie, err := s.startSession(u.Id)
	if err != nil {
		return nil, err
	}
	return Login200JSONResponse{Body: u, Headers: Login200ResponseHeaders{SetCookie: &cookie}}, nil
}

func (s *Server) Logout(ctx context.Context, _ LogoutRequestObject) (LogoutResponseObject, error) {
	if token, ok := ctx.Value(rawTokenKey{}).(string); ok {
		s.Store.DeleteSession(auth.HashToken(token))
	}
	cookie := s.cookie("", -1).String()
	return Logout204Response{Headers: Logout204ResponseHeaders{SetCookie: &cookie}}, nil
}

func (s *Server) GetMe(ctx context.Context, _ GetMeRequestObject) (GetMeResponseObject, error) {
	u, ok := UserFrom(ctx)
	if !ok {
		return GetMe401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	return GetMe200JSONResponse(u), nil
}

func (s *Server) startSession(userID string) (string, error) {
	token, err := auth.NewSessionToken()
	if err != nil {
		return "", err
	}
	s.Store.CreateSession(auth.HashToken(token), userID, s.Now().Add(auth.SessionTTL))
	return s.cookie(token, int(auth.SessionTTL.Seconds())).String(), nil
}

func (s *Server) cookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     auth.CookieName,
		Value:    value,
		Path:     "/api",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   s.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	}
}

func normalizeEmail(raw string) (string, error) {
	e := strings.ToLower(strings.TrimSpace(raw))
	addr, err := mail.ParseAddress(e)
	if err != nil || addr.Address != e || len(e) > 254 {
		return "", errors.New("invalid email address")
	}
	return e, nil
}
