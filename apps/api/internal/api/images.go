package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/cat-chat/api/internal/blob"
	"github.com/cat-chat/api/internal/images"
)

const imagePathPrefix = "/api/images/"

func imageURL(id string) string { return imagePathPrefix + id }

func imageURLs(ids []string) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = imageURL(id)
	}
	return out
}

func (s *Server) UploadImage(ctx context.Context, req UploadImageRequestObject) (UploadImageResponseObject, error) {
	user, ok := UserFrom(ctx)
	if !ok {
		return UploadImage401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	if req.Body == nil {
		return UploadImage400JSONResponse{BadRequestJSONResponse{Message: "missing file"}}, nil
	}
	file, err := firstFilePart(req)
	if err != nil {
		return UploadImage400JSONResponse{BadRequestJSONResponse{Message: "missing file"}}, nil
	}
	defer file.Close()

	res, err := images.Process(file)
	switch {
	case errors.Is(err, images.ErrTooLarge):
		return UploadImage413JSONResponse{Message: err.Error()}, nil
	case errors.Is(err, images.ErrUnsupported), errors.Is(err, images.ErrDimensions), errors.Is(err, images.ErrCorrupt):
		return UploadImage400JSONResponse{BadRequestJSONResponse{Message: err.Error()}}, nil
	case isBodyTooLarge(err):
		return UploadImage413JSONResponse{Message: images.ErrTooLarge.Error()}, nil
	case err != nil:
		return nil, err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}
	// Blob first, then the row: a crash in between leaves an unreferenced
	// file, never a row pointing at nothing.
	if err := s.Blobs.Put(ctx, id.String(), res.JPEG); err != nil {
		return nil, err
	}
	if err := s.Store.CreateImage(ctx, id.String(), user.Id, res.Width, res.Height, len(res.JPEG)); err != nil {
		return nil, err
	}
	slog.Info("image uploaded", "id", id, "bytes", len(res.JPEG), "w", res.Width, "h", res.Height)
	return UploadImage201JSONResponse{Id: id.String(), Url: imageURL(id.String()), Width: res.Width, Height: res.Height}, nil
}

func (s *Server) GetImage(ctx context.Context, req GetImageRequestObject) (GetImageResponseObject, error) {
	rc, size, err := s.Blobs.Open(ctx, req.ImageId)
	if errors.Is(err, blob.ErrNotFound) {
		return GetImage404JSONResponse{NotFoundJSONResponse{Message: "image not found"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return imageResponse{rc: rc, size: size}, nil
}

// imageResponse streams the blob and closes it. Caching/nosniff headers are
// set by middleware in main.
type imageResponse struct {
	rc   io.ReadCloser
	size int64
}

func (r imageResponse) VisitGetImageResponse(w http.ResponseWriter) error {
	defer r.rc.Close()
	return GetImage200ImagejpegResponse{Body: r.rc, ContentLength: r.size}.VisitGetImageResponse(w)
}

func firstFilePart(req UploadImageRequestObject) (io.ReadCloser, error) {
	for {
		part, err := req.Body.NextPart()
		if err != nil {
			return nil, err
		}
		if part.FormName() == "file" {
			return part, nil
		}
		part.Close()
	}
}

func isBodyTooLarge(err error) bool {
	var mbe *http.MaxBytesError
	return errors.As(err, &mbe)
}
