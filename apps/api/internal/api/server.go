package api

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/cat-chat/api/internal/blob"
)

// Content limits — must match packages/api-spec/openapi.yaml.
const (
	PostMaxChars   = 500
	PostMaxImages  = 5
	ReplyMaxChars  = 100
	ReplyMaxImages = 3
)

// Store is what the HTTP layer needs from persistence.
// Implementations: store.Postgres (prod) and store.Memory (tests); both
// pass the same conformance suite in internal/store.
//
// Errors: ErrNotFound for unknown/invalid ids, ErrThreadFull, ErrEmailTaken.
type Store interface {
	ListPosts(ctx context.Context) ([]Post, error)
	CreatePost(ctx context.Context, author User, in NewPost) (Post, error)
	ListReplies(ctx context.Context, postID string) ([]Reply, error)
	CreateReply(ctx context.Context, postID string, author User, in NewReply) (Reply, error)
	// CreatePost/CreateReply return ErrInvalidImages unless every image id
	// exists and belongs to the author.
	CreateImage(ctx context.Context, id, ownerID string, width, height, size int) error

	CreateUser(ctx context.Context, email, nickname, passwordHash string) (User, error)
	UserByEmail(ctx context.Context, email string) (u User, passwordHash string, err error)
	CreateSession(ctx context.Context, tokenHash, userID string, expires time.Time) error
	UserBySession(ctx context.Context, tokenHash string, now time.Time) (User, error)
	DeleteSession(ctx context.Context, tokenHash string) error
	// ChangePassword sets a new hash and deletes all of the user's sessions,
	// atomically.
	ChangePassword(ctx context.Context, userID, passwordHash string) error
}

// MaxRepliesPerPost is the product limit on interaction rounds per post.
const MaxRepliesPerPost = 10

type Server struct {
	Store   Store
	Blobs   blob.Store
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

func (s *Server) ListPosts(ctx context.Context, _ ListPostsRequestObject) (ListPostsResponseObject, error) {
	posts, err := s.Store.ListPosts(ctx)
	if err != nil {
		return nil, err
	}
	for i := range posts {
		posts[i].Images = imageURLs(posts[i].Images)
	}
	return ListPosts200JSONResponse(posts), nil
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
	p, err := s.Store.CreatePost(ctx, user, *req.Body)
	if errors.Is(err, ErrInvalidImages) {
		return CreatePost400JSONResponse{BadRequestJSONResponse{Message: "images must be your own uploads"}}, nil
	}
	if err != nil {
		return nil, err
	}
	p.Images = imageURLs(p.Images)
	return CreatePost201JSONResponse(p), nil
}

func (s *Server) ListReplies(ctx context.Context, req ListRepliesRequestObject) (ListRepliesResponseObject, error) {
	rs, err := s.Store.ListReplies(ctx, req.PostId)
	if errors.Is(err, ErrNotFound) {
		return ListReplies404JSONResponse{NotFoundJSONResponse{Message: "post not found"}}, nil
	}
	if err != nil {
		return nil, err
	}
	for i := range rs {
		rs[i].Images = imageURLs(rs[i].Images)
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
	r, err := s.Store.CreateReply(ctx, req.PostId, user, *req.Body)
	switch {
	case errors.Is(err, ErrNotFound):
		return CreateReply404JSONResponse{NotFoundJSONResponse{Message: "post not found"}}, nil
	case errors.Is(err, ErrThreadFull):
		return CreateReply409JSONResponse{Message: "this post already has the maximum number of replies"}, nil
	case errors.Is(err, ErrInvalidImages):
		return CreateReply400JSONResponse{BadRequestJSONResponse{Message: "images must be your own uploads"}}, nil
	case err != nil:
		return nil, err
	}
	r.Images = imageURLs(r.Images)
	return CreateReply201JSONResponse(r), nil
}

// validate enforces limits in characters (runes), not bytes, so Chinese
// text gets the full 500/100 allowance.
func validate(content string, images []ImageId, maxChars, maxImages int) error {
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
	seen := make(map[string]bool, len(images))
	for _, id := range images {
		if _, err := uuid.Parse(id); err != nil {
			return errors.New("images must be ids from uploadImage")
		}
		if seen[id] {
			return errors.New("duplicate image")
		}
		seen[id] = true
	}
	return nil
}
