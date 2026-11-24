package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
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
}

type Server struct {
	Store Store
	// The store package owns its sentinel errors (it imports this package,
	// so we can't import it back); main wires these classifiers.
	IsNotFound   func(error) bool
	IsThreadFull func(error) bool
}

var _ StrictServerInterface = (*Server)(nil)

// Until auth lands every write is attributed to a placeholder author.
const guestAuthor = "guest"

func (s *Server) GetHealth(context.Context, GetHealthRequestObject) (GetHealthResponseObject, error) {
	return GetHealth200JSONResponse{Status: Ok}, nil
}

func (s *Server) ListPosts(context.Context, ListPostsRequestObject) (ListPostsResponseObject, error) {
	return ListPosts200JSONResponse(s.Store.ListPosts()), nil
}

func (s *Server) CreatePost(_ context.Context, req CreatePostRequestObject) (CreatePostResponseObject, error) {
	if req.Body == nil {
		return CreatePost400JSONResponse{BadRequestJSONResponse{Message: "missing body"}}, nil
	}
	if err := validate(req.Body.Content, req.Body.Images, PostMaxChars, PostMaxImages); err != nil {
		return CreatePost400JSONResponse{BadRequestJSONResponse{Message: err.Error()}}, nil
	}
	return CreatePost201JSONResponse(s.Store.CreatePost(guestAuthor, *req.Body)), nil
}

func (s *Server) ListReplies(_ context.Context, req ListRepliesRequestObject) (ListRepliesResponseObject, error) {
	rs, err := s.Store.ListReplies(req.PostId)
	if s.IsNotFound(err) {
		return ListReplies404JSONResponse{NotFoundJSONResponse{Message: "post not found"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return ListReplies200JSONResponse(rs), nil
}

func (s *Server) CreateReply(_ context.Context, req CreateReplyRequestObject) (CreateReplyResponseObject, error) {
	if req.Body == nil {
		return CreateReply400JSONResponse{BadRequestJSONResponse{Message: "missing body"}}, nil
	}
	if err := validate(req.Body.Content, req.Body.Images, ReplyMaxChars, ReplyMaxImages); err != nil {
		return CreateReply400JSONResponse{BadRequestJSONResponse{Message: err.Error()}}, nil
	}
	r, err := s.Store.CreateReply(req.PostId, guestAuthor, *req.Body)
	switch {
	case s.IsNotFound(err):
		return CreateReply404JSONResponse{NotFoundJSONResponse{Message: "post not found"}}, nil
	case s.IsThreadFull(err):
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
