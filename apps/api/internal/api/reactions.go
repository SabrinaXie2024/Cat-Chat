package api

import (
	"context"
	"errors"
)

func (s *Server) LikePost(ctx context.Context, req LikePostRequestObject) (LikePostResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return LikePost401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	switch err := s.Store.SetLike(ctx, user.Id, req.PostId, true); {
	case errors.Is(err, ErrNotFound):
		return LikePost404JSONResponse{NotFoundJSONResponse{Message: "post not found"}}, nil
	case err != nil:
		return nil, err
	}
	return LikePost204Response{}, nil
}

func (s *Server) UnlikePost(ctx context.Context, req UnlikePostRequestObject) (UnlikePostResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return UnlikePost401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	switch err := s.Store.SetLike(ctx, user.Id, req.PostId, false); {
	case errors.Is(err, ErrNotFound):
		return UnlikePost404JSONResponse{NotFoundJSONResponse{Message: "post not found"}}, nil
	case err != nil:
		return nil, err
	}
	return UnlikePost204Response{}, nil
}

func (s *Server) FavoritePost(ctx context.Context, req FavoritePostRequestObject) (FavoritePostResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return FavoritePost401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	switch err := s.Store.SetFavorite(ctx, user.Id, req.PostId, true); {
	case errors.Is(err, ErrNotFound):
		return FavoritePost404JSONResponse{NotFoundJSONResponse{Message: "post not found"}}, nil
	case err != nil:
		return nil, err
	}
	return FavoritePost204Response{}, nil
}

func (s *Server) UnfavoritePost(ctx context.Context, req UnfavoritePostRequestObject) (UnfavoritePostResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return UnfavoritePost401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	switch err := s.Store.SetFavorite(ctx, user.Id, req.PostId, false); {
	case errors.Is(err, ErrNotFound):
		return UnfavoritePost404JSONResponse{NotFoundJSONResponse{Message: "post not found"}}, nil
	case err != nil:
		return nil, err
	}
	return UnfavoritePost204Response{}, nil
}
