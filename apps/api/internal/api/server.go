package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

// Content limits — must match packages/api-spec/openapi.yaml.
const (
	PostMaxChars   = 500
	PostMaxImages  = 5
	ReplyMaxChars  = 100
	ReplyMaxImages = 3
)

// Store is what the HTTP layer needs from persistence.
type Store interface {
	ListPosts() []Post
	CreatePost(author string, in NewPost) Post
	ListReplies(postID string) ([]Reply, error)
	CreateReply(postID, author string, in NewReply) (Reply, error)

	CreateUser(email, nickname, passwordHash string) (User, error)
	UserByEmail(email string) (u User, passwordHash string, err error)
	CreateSession(tokenHash, userID string, expires time.Time)
	UserBySession(tokenHash string, now time.Time) (User, error)
	DeleteSession(tokenHash string)
}

type Server struct {
	Store   Store
	Limiter LoginLimiter
	// SecureCookies sets the Secure flag; true everywhere except local http.
	SecureCookies bool
	Now           func() time.Time
}

// LoginLimiter is satisfied by *auth.LoginLimiter.
type LoginLimiter interface {
	Blocked(key string) bool
	Fail(key string)
	Reset(key string)
}

var _ StrictServerInterface = (*Server)(nil)

func (s *Server) GetHealth(context.Context, GetHealthRequestObject) (GetHealthResponseObject, error) {
	return GetHealth200JSONResponse{Status: Ok}, nil
}

func (s *Server) ListPosts(context.Context, ListPostsRequestObject) (ListPostsResponseObject, error) {
	return ListPosts200JSONResponse(s.Store.ListPosts()), nil
}

func (s *Server) CreatePost(ctx context.Context, req CreatePostRequestObject) (CreatePostResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return CreatePost401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	if req.Body == nil {
		return CreatePost400JSONResponse{BadRequestJSONResponse{Message: "missing body"}}, nil
	}
	if err := validate(req.Body.Content, req.Body.Images, PostMaxChars, PostMaxImages); err != nil {
		return CreatePost400JSONResponse{BadRequestJSONResponse{Message: err.Error()}}, nil
	}
	return CreatePost201JSONResponse(s.Store.CreatePost(user.Nickname, *req.Body)), nil
}

func (s *Server) ListReplies(_ context.Context, req ListRepliesRequestObject) (ListRepliesResponseObject, error) {
	rs, err := s.Store.ListReplies(req.PostId)
	if errors.Is(err, ErrNotFound) {
		return ListReplies404JSONResponse{NotFoundJSONResponse{Message: "post not found"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return ListReplies200JSONResponse(rs), nil
}

func (s *Server) CreateReply(ctx context.Context, req CreateReplyRequestObject) (CreateReplyResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return CreateReply401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	if req.Body == nil {
		return CreateReply400JSONResponse{BadRequestJSONResponse{Message: "missing body"}}, nil
	}
	if err := validate(req.Body.Content, req.Body.Images, ReplyMaxChars, ReplyMaxImages); err != nil {
		return CreateReply400JSONResponse{BadRequestJSONResponse{Message: err.Error()}}, nil
	}
	r, err := s.Store.CreateReply(req.PostId, user.Nickname, *req.Body)
	switch {
	case errors.Is(err, ErrNotFound):
		return CreateReply404JSONResponse{NotFoundJSONResponse{Message: "post not found"}}, nil
	case errors.Is(err, ErrThreadFull):
		return CreateReply409JSONResponse{Message: "this post already has the maximum number of replies"}, nil
	case err != nil:
		return nil, err
	}
	return CreateReply201JSONResponse(r), nil
}

// validate enforces limits in characters (runes), not bytes, so Chinese
// text gets the full 500/100 allowance.
func validate(content string, images []ImageUrl, maxChars, maxImages int) error {
	n := utf8.RuneCountInString(strings.TrimSpace(content))
	if n == 0 {
		return errors.New("content is required")
	}
	if n > maxChars {
		return fmt.Errorf("content must be at most %d characters", maxChars)
	}
	if len(images) > maxImages {
		return fmt.Errorf("at most %d images allowed", maxImages)
	}
	for _, img := range images {
		u, err := url.Parse(img)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			return errors.New("images must be http(s) URLs")
		}
	}
	return nil
}
