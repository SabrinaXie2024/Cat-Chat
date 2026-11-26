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
			if u, err := s.Store.UserBySession(r.Context(), auth.HashToken(c.Value), s.Now()); err == nil {
				r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, u))
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Register(ctx context.Context, req RegisterRequestObject) (RegisterResponseObject, error) {
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
	u, err := s.Store.CreateUser(ctx, email, nickname, hash)
	if errors.Is(err, ErrEmailTaken) {
		return Register409JSONResponse{Message: "this email is already registered"}, nil
	}
	if err != nil {
		return nil, err
	}
	cookie, err := s.startSession(ctx, u.Id)
	if err != nil {
		return nil, err
	}
	return Register201JSONResponse{Body: u, Headers: Register201ResponseHeaders{SetCookie: &cookie}}, nil
}

func (s *Server) Login(ctx context.Context, req LoginRequestObject) (LoginResponseObject, error) {
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
	u, hash, err := s.Store.UserByEmail(ctx, email)
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
	cookie, err := s.startSession(ctx, u.Id)
	if err != nil {
		return nil, err
	}
	return Login200JSONResponse{Body: u, Headers: Login200ResponseHeaders{SetCookie: &cookie}}, nil
}

func (s *Server) Logout(ctx context.Context, _ LogoutRequestObject) (LogoutResponseObject, error) {
	if token, ok := ctx.Value(rawTokenKey{}).(string); ok {
		if err := s.Store.DeleteSession(ctx, auth.HashToken(token)); err != nil {
			return nil, err
		}
	}
	cookie := s.cookie("", -1).String()
	return Logout204Response{Headers: Logout204ResponseHeaders{SetCookie: &cookie}}, nil
}

func (s *Server) ChangePassword(ctx context.Context, req ChangePasswordRequestObject) (ChangePasswordResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return ChangePassword401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	if req.Body == nil {
		return ChangePassword400JSONResponse{BadRequestJSONResponse{Message: "missing body"}}, nil
	}
	// Shares the login limiter: guessing the current password from a
	// hijacked session is the same attack as guessing it at /login.
	if s.Limiter.Blocked(user.Email) {
		return ChangePassword429JSONResponse{Message: "too many failed attempts, try again in 15 minutes"}, nil
	}
	_, hash, err := s.Store.UserByEmail(ctx, user.Email)
	if err != nil {
		return nil, err
	}
	if ok, err := auth.VerifyPassword(req.Body.CurrentPassword, hash); err != nil || !ok {
		s.Limiter.Fail(user.Email)
		return ChangePassword403JSONResponse{Message: "current password is incorrect"}, nil
	}
	s.Limiter.Reset(user.Email)

	np := req.Body.NewPassword
	if n := utf8.RuneCountInString(np); n < passwordMinChars || n > passwordMaxChars {
		return ChangePassword400JSONResponse{BadRequestJSONResponse{Message: "password must be 8–128 characters"}}, nil
	}
	if np == req.Body.CurrentPassword {
		return ChangePassword400JSONResponse{BadRequestJSONResponse{Message: "new password must differ from the current one"}}, nil
	}
	newHash, err := auth.HashPassword(np)
	if err != nil {
		return nil, err
	}
	if err := s.Store.ChangePassword(ctx, user.Id, newHash); err != nil {
		return nil, err
	}
	// All sessions (including this one) were revoked; keep this device signed in.
	cookie, err := s.startSession(ctx, user.Id)
	if err != nil {
		return nil, err
	}
	return ChangePassword204Response{Headers: ChangePassword204ResponseHeaders{SetCookie: &cookie}}, nil
}

func (s *Server) GetMe(ctx context.Context, _ GetMeRequestObject) (GetMeResponseObject, error) {
	u, ok := UserFrom(ctx)
	if !ok {
		return GetMe401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	return GetMe200JSONResponse(u), nil
}

func (s *Server) startSession(ctx context.Context, userID string) (string, error) {
	token, err := auth.NewSessionToken()
	if err != nil {
		return "", err
	}
	if err := s.Store.CreateSession(ctx, auth.HashToken(token), userID, s.Now().Add(auth.SessionTTL)); err != nil {
		return "", err
	}
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
