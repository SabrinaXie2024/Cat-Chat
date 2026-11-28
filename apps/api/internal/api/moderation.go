package api

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"
)

// ReportNoteMaxChars must match NewReport.note in the spec.
const ReportNoteMaxChars = 200

func (s *Server) DeleteReply(ctx context.Context, req DeleteReplyRequestObject) (DeleteReplyResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return DeleteReply401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	switch err := s.Store.DeleteReply(ctx, req.PostId, req.ReplyId, user.Id); {
	case errors.Is(err, ErrNotFound):
		return DeleteReply404JSONResponse{NotFoundJSONResponse{Message: "reply not found"}}, nil
	case errors.Is(err, ErrForbidden):
		return DeleteReply403JSONResponse{ForbiddenJSONResponse{Message: msgPostAuthorOnly}}, nil
	case err != nil:
		return nil, err
	}
	return DeleteReply204Response{}, nil
}

const msgPostAuthorOnly = "only the post's author can do that"

func (s *Server) pin(ctx context.Context, postID, replyID string, on bool) (int, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return 401, nil
	}
	switch err := s.Store.SetReplyPinned(ctx, postID, replyID, user.Id, on); {
	case errors.Is(err, ErrNotFound):
		return 404, nil
	case errors.Is(err, ErrForbidden):
		return 403, nil
	case err != nil:
		return 0, err
	}
	return 204, nil
}

func (s *Server) PinReply(ctx context.Context, req PinReplyRequestObject) (PinReplyResponseObject, error) {
	code, err := s.pin(ctx, req.PostId, req.ReplyId, true)
	switch code {
	case 401:
		return PinReply401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	case 403:
		return PinReply403JSONResponse{ForbiddenJSONResponse{Message: msgPostAuthorOnly}}, nil
	case 404:
		return PinReply404JSONResponse{NotFoundJSONResponse{Message: "reply not found"}}, nil
	case 204:
		return PinReply204Response{}, nil
	}
	return nil, err
}

func (s *Server) UnpinReply(ctx context.Context, req UnpinReplyRequestObject) (UnpinReplyResponseObject, error) {
	code, err := s.pin(ctx, req.PostId, req.ReplyId, false)
	switch code {
	case 401:
		return UnpinReply401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	case 403:
		return UnpinReply403JSONResponse{ForbiddenJSONResponse{Message: msgPostAuthorOnly}}, nil
	case 404:
		return UnpinReply404JSONResponse{NotFoundJSONResponse{Message: "reply not found"}}, nil
	case 204:
		return UnpinReply204Response{}, nil
	}
	return nil, err
}

func (s *Server) ReportReply(ctx context.Context, req ReportReplyRequestObject) (ReportReplyResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return ReportReply401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	bad := func(msg string) (ReportReplyResponseObject, error) {
		return ReportReply400JSONResponse{BadRequestJSONResponse{Message: msg}}, nil
	}
	if req.Body == nil {
		return bad("missing body")
	}
	if !req.Body.Reason.Valid() {
		return bad("unknown report reason")
	}
	note := ""
	if req.Body.Note != nil {
		note = strings.TrimSpace(*req.Body.Note)
	}
	if utf8.RuneCountInString(note) > ReportNoteMaxChars {
		return bad("report note must be at most 200 characters")
	}
	switch err := s.Store.ReportReply(ctx, req.PostId, req.ReplyId, user.Id, req.Body.Reason, note); {
	case errors.Is(err, ErrNotFound):
		return ReportReply404JSONResponse{NotFoundJSONResponse{Message: "reply not found"}}, nil
	case errors.Is(err, ErrOwnReply):
		return bad("you can't report your own reply")
	case err != nil:
		return nil, err
	}
	return ReportReply204Response{}, nil
}
