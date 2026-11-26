package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/cat-chat/api/internal/blob"
	"github.com/cat-chat/api/internal/images"
	"github.com/cat-chat/api/internal/videos"
)

const (
	GalleryCaptionMaxChars = 200
	msgAdminOnly           = "admin only"
)

// VideoProcessor is satisfied by videos.Processor.
type VideoProcessor interface {
	Process(ctx context.Context, r io.Reader, workDir string) (videos.Result, error)
}

func (s *Server) isAdmin(email string) bool { return s.AdminEmails[strings.ToLower(email)] }

// requireAdmin returns the user, or ok=false with forbidden=true when signed
// in as a non-admin.
func (s *Server) requireAdmin(ctx context.Context) (u User, ok, forbidden bool) {
	u, signedIn := UserFrom(ctx)
	if !signedIn {
		return u, false, false
	}
	if !u.IsAdmin {
		return u, false, true
	}
	return u, true, false
}

func videoURL(id string) string { return "/api/videos/" + id }

func galleryItem(e GalleryEntry) GalleryItem {
	it := GalleryItem{
		Id: e.ID, Kind: GalleryItemKind(e.Kind), Caption: e.Caption, CreatedAt: e.CreatedAt,
		Width: e.Width, Height: e.Height,
	}
	if e.Kind == "video" {
		it.Url = videoURL(e.VideoID)
		poster := imageURL(e.PosterImageID)
		it.PosterUrl = &poster
	} else {
		it.Url = imageURL(e.ImageID)
	}
	return it
}

func (s *Server) ListGallery(ctx context.Context, _ ListGalleryRequestObject) (ListGalleryResponseObject, error) {
	entries, err := s.Store.ListGallery(ctx)
	if err != nil {
		return nil, err
	}
	out := make(ListGallery200JSONResponse, len(entries))
	for i, e := range entries {
		out[i] = galleryItem(e)
	}
	return out, nil
}

func (s *Server) CreateGalleryItem(ctx context.Context, req CreateGalleryItemRequestObject) (CreateGalleryItemResponseObject, error) {
	u, ok, forbidden := s.requireAdmin(ctx)
	if forbidden {
		return CreateGalleryItem403JSONResponse{ForbiddenJSONResponse{Message: msgAdminOnly}}, nil
	}
	if !ok {
		return CreateGalleryItem401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	if req.Body == nil || !req.Body.Kind.Valid() {
		return CreateGalleryItem400JSONResponse{BadRequestJSONResponse{Message: "kind must be photo or video"}}, nil
	}
	caption := strings.TrimSpace(req.Body.Caption)
	if utf8.RuneCountInString(caption) > GalleryCaptionMaxChars {
		return CreateGalleryItem400JSONResponse{BadRequestJSONResponse{Message: "caption must be at most 200 characters"}}, nil
	}
	e, err := s.Store.CreateGalleryItem(ctx, u, string(req.Body.Kind), req.Body.MediaId, caption)
	if errors.Is(err, ErrInvalidMedia) {
		return CreateGalleryItem400JSONResponse{BadRequestJSONResponse{Message: "media must be your own upload"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return CreateGalleryItem201JSONResponse(galleryItem(e)), nil
}

func (s *Server) DeleteGalleryItem(ctx context.Context, req DeleteGalleryItemRequestObject) (DeleteGalleryItemResponseObject, error) {
	_, ok, forbidden := s.requireAdmin(ctx)
	if forbidden {
		return DeleteGalleryItem403JSONResponse{ForbiddenJSONResponse{Message: msgAdminOnly}}, nil
	}
	if !ok {
		return DeleteGalleryItem401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	err := s.Store.DeleteGalleryItem(ctx, req.ItemId)
	if errors.Is(err, ErrNotFound) {
		return DeleteGalleryItem404JSONResponse{NotFoundJSONResponse{Message: "gallery item not found"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return DeleteGalleryItem204Response{}, nil
}

func (s *Server) UploadVideo(ctx context.Context, req UploadVideoRequestObject) (UploadVideoResponseObject, error) {
	u, ok, forbidden := s.requireAdmin(ctx)
	if forbidden {
		return UploadVideo403JSONResponse{ForbiddenJSONResponse{Message: msgAdminOnly}}, nil
	}
	if !ok {
		return UploadVideo401JSONResponse{UnauthorizedJSONResponse{Message: msgSignIn}}, nil
	}
	if req.Body == nil {
		return UploadVideo400JSONResponse{BadRequestJSONResponse{Message: "missing file"}}, nil
	}
	part, err := nextFilePart(req.Body)
	if err != nil {
		return UploadVideo400JSONResponse{BadRequestJSONResponse{Message: "missing file"}}, nil
	}
	defer part.Close()

	if err := os.MkdirAll(s.VideoWorkDir, 0o755); err != nil {
		return nil, err
	}
	res, err := s.Videos.Process(ctx, part, s.VideoWorkDir)
	switch {
	case errors.Is(err, videos.ErrTooLarge), isBodyTooLarge(err):
		return UploadVideo413JSONResponse{Message: videos.ErrTooLarge.Error()}, nil
	case errors.Is(err, videos.ErrUnsupported), errors.Is(err, videos.ErrCorrupt):
		return UploadVideo400JSONResponse{BadRequestJSONResponse{Message: err.Error()}}, nil
	case err != nil:
		return nil, err
	}
	defer os.Remove(res.Path) // no-op once imported

	poster, err := images.Process(strings.NewReader(string(res.Poster)))
	if err != nil {
		return UploadVideo400JSONResponse{BadRequestJSONResponse{Message: videos.ErrCorrupt.Error()}}, nil
	}
	posterID, _ := uuid.NewV7()
	videoID, _ := uuid.NewV7()
	if err := s.Blobs.Put(ctx, posterID.String(), poster.JPEG); err != nil {
		return nil, err
	}
	if err := s.Store.CreateImage(ctx, posterID.String(), u.Id, poster.Width, poster.Height, len(poster.JPEG)); err != nil {
		return nil, err
	}
	if err := s.VideoBlobs.Import(ctx, videoID.String(), res.Path); err != nil {
		return nil, err
	}
	rec := VideoRecord{
		ID: videoID.String(), OwnerID: u.Id, Container: res.Container, PosterImageID: posterID.String(),
		Width: poster.Width, Height: poster.Height, Size: res.Size,
	}
	if err := s.Store.CreateVideo(ctx, rec); err != nil {
		return nil, err
	}
	slog.Info("video uploaded", "id", videoID, "bytes", res.Size, "container", res.Container)
	return UploadVideo201JSONResponse{
		Id: rec.ID, Url: videoURL(rec.ID), PosterUrl: imageURL(rec.PosterImageID),
		Width: rec.Width, Height: rec.Height,
	}, nil
}

// ServeVideo streams a video with Range support so players can seek. It's
// registered by hand (GET /api/videos/{videoId}) — see oapi.yaml.
func (s *Server) ServeVideo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("videoId")
	container, err := s.Store.VideoContainer(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		http.Error(w, `{"message":"video not found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	rc, _, err := s.VideoBlobs.Open(r.Context(), id)
	if errors.Is(err, blob.ErrNotFound) {
		http.Error(w, `{"message":"video not found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rc.Close()
	rs, ok := rc.(io.ReadSeeker)
	if !ok {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", videos.ContentType(container))
	// Ids are immutable, so no Last-Modified is needed; Range still works.
	http.ServeContent(w, r, "", time.Time{}, rs)
}
