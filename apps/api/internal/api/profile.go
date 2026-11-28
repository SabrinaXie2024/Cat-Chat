package api

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"
)

func (s *Server) UpdateProfile(ctx context.Context, req UpdateProfileRequestObject) (UpdateProfileResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return UpdateProfile401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	if req.Body == nil {
		return UpdateProfile400JSONResponse{BadRequestJSONResponse{Message: "missing body"}}, nil
	}
	var nickname *string
	if req.Body.Nickname != nil {
		n := strings.TrimSpace(*req.Body.Nickname)
		if c := utf8.RuneCountInString(n); c == 0 || c > nicknameMaxChars {
			return UpdateProfile400JSONResponse{BadRequestJSONResponse{Message: "nickname must be 1–20 characters"}}, nil
		}
		nickname = &n
	}
	if a := req.Body.Avatar; a != nil && !a.Valid() {
		return UpdateProfile400JSONResponse{BadRequestJSONResponse{Message: "unknown avatar"}}, nil
	}
	u, err := s.Store.UpdateProfile(ctx, user.Id, nickname, req.Body.Avatar)
	if err != nil {
		return nil, err
	}
	u.IsAdmin = user.IsAdmin
	return UpdateProfile200JSONResponse(u), nil
}

func (s *Server) GetProfile(ctx context.Context, req GetProfileRequestObject) (GetProfileResponseObject, error) {
	viewer := ""
	if u, ok := UserFrom(ctx); ok {
		viewer = u.Id
	}
	p, err := s.Store.Profile(ctx, req.UserId, viewer)
	if errors.Is(err, ErrNotFound) {
		return GetProfile404JSONResponse{NotFoundJSONResponse{Message: "user not found"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return GetProfile200JSONResponse(p), nil
}

func (s *Server) ListUserPosts(ctx context.Context, req ListUserPostsRequestObject) (ListUserPostsResponseObject, error) {
	posts, err := s.Store.ListUserPosts(ctx, req.UserId)
	if errors.Is(err, ErrNotFound) {
		return ListUserPosts404JSONResponse{NotFoundJSONResponse{Message: "user not found"}}, nil
	}
	if err != nil {
		return nil, err
	}
	for i := range posts {
		posts[i].Images = imageURLs(posts[i].Images)
	}
	return ListUserPosts200JSONResponse(posts), nil
}

func (s *Server) FollowUser(ctx context.Context, req FollowUserRequestObject) (FollowUserResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return FollowUser401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	switch err := s.Store.Follow(ctx, user.Id, req.UserId); {
	case errors.Is(err, ErrSelfFollow):
		return FollowUser400JSONResponse{BadRequestJSONResponse{Message: "you can't follow yourself"}}, nil
	case errors.Is(err, ErrNotFound):
		return FollowUser404JSONResponse{NotFoundJSONResponse{Message: "user not found"}}, nil
	case err != nil:
		return nil, err
	}
	return FollowUser204Response{}, nil
}

func (s *Server) UnfollowUser(ctx context.Context, req UnfollowUserRequestObject) (UnfollowUserResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return UnfollowUser401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	switch err := s.Store.Unfollow(ctx, user.Id, req.UserId); {
	case errors.Is(err, ErrNotFound):
		return UnfollowUser404JSONResponse{NotFoundJSONResponse{Message: "user not found"}}, nil
	case err != nil:
		return nil, err
	}
	return UnfollowUser204Response{}, nil
}
