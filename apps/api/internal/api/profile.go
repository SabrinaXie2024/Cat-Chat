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
	p, err := s.Store.Profile(ctx, req.UserId, viewerID(ctx))
	if errors.Is(err, ErrNotFound) {
		return GetProfile404JSONResponse{NotFoundJSONResponse{Message: "user not found"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return GetProfile200JSONResponse(p), nil
}

func (s *Server) ListUserPosts(ctx context.Context, req ListUserPostsRequestObject) (ListUserPostsResponseObject, error) {
	posts, err := s.Store.ListUserPosts(ctx, req.UserId, viewerID(ctx))
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

// viewerID is the signed-in user's id, or "".
func viewerID(ctx context.Context) string {
	if u, ok := UserFrom(ctx); ok {
		return u.Id
	}
	return ""
}

func withImageURLs(posts []Post) []Post {
	for i := range posts {
		posts[i].Images = imageURLs(posts[i].Images)
	}
	return posts
}

func (s *Server) ListUserLikes(ctx context.Context, req ListUserLikesRequestObject) (ListUserLikesResponseObject, error) {
	posts, err := s.Store.ListLikedPosts(ctx, req.UserId, viewerID(ctx))
	if errors.Is(err, ErrNotFound) {
		return ListUserLikes404JSONResponse{NotFoundJSONResponse{Message: "user not found"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return ListUserLikes200JSONResponse(withImageURLs(posts)), nil
}

func (s *Server) ListMyFavorites(ctx context.Context, _ ListMyFavoritesRequestObject) (ListMyFavoritesResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return ListMyFavorites401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	posts, err := s.Store.ListFavorites(ctx, user.Id)
	if err != nil {
		return nil, err
	}
	return ListMyFavorites200JSONResponse(withImageURLs(posts)), nil
}

func (s *Server) ListFollowers(ctx context.Context, req ListFollowersRequestObject) (ListFollowersResponseObject, error) {
	us, err := s.Store.ListFollowers(ctx, req.UserId)
	if errors.Is(err, ErrNotFound) {
		return ListFollowers404JSONResponse{NotFoundJSONResponse{Message: "user not found"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return ListFollowers200JSONResponse(us), nil
}

func (s *Server) ListFollowing(ctx context.Context, req ListFollowingRequestObject) (ListFollowingResponseObject, error) {
	us, err := s.Store.ListFollowing(ctx, req.UserId)
	if errors.Is(err, ErrNotFound) {
		return ListFollowing404JSONResponse{NotFoundJSONResponse{Message: "user not found"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return ListFollowing200JSONResponse(us), nil
}
