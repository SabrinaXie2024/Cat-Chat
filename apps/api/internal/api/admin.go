package api

import (
	"context"
	"errors"
)

func (s *Server) ListReports(ctx context.Context, _ ListReportsRequestObject) (ListReportsResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return ListReports401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	if !s.isAdmin(user.Email) {
		return ListReports403JSONResponse{ForbiddenJSONResponse{Message: msgAdminOnly}}, nil
	}
	rs, err := s.Store.ListOpenReports(ctx)
	if err != nil {
		return nil, err
	}
	for i := range rs {
		rs[i].Reply.Images = imageURLs(rs[i].Reply.Images)
	}
	return ListReports200JSONResponse(rs), nil
}

func (s *Server) ResolveReports(ctx context.Context, req ResolveReportsRequestObject) (ResolveReportsResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return ResolveReports401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	if !s.isAdmin(user.Email) {
		return ResolveReports403JSONResponse{ForbiddenJSONResponse{Message: msgAdminOnly}}, nil
	}
	if req.Body == nil {
		return ResolveReports400JSONResponse{BadRequestJSONResponse{Message: "missing body"}}, nil
	}
	var err error
	switch req.Body.Action {
	case Delete:
		err = s.Store.AdminDeleteReply(ctx, req.ReplyId)
	case Dismiss:
		err = s.Store.DismissReports(ctx, req.ReplyId)
	default:
		return ResolveReports400JSONResponse{BadRequestJSONResponse{Message: "action must be delete or dismiss"}}, nil
	}
	switch {
	case errors.Is(err, ErrNotFound):
		return ResolveReports404JSONResponse{NotFoundJSONResponse{Message: "reply not found"}}, nil
	case err != nil:
		return nil, err
	}
	return ResolveReports204Response{}, nil
}
