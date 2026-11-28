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
	"github.com/cat-chat/api/internal/mail"
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
	// viewerID ( when signed out) fills likedByMe / favoritedByMe.
	ListPosts(ctx context.Context, viewerID string) ([]Post, error)
	CreatePost(ctx context.Context, author User, in NewPost) (Post, error)
	ListReplies(ctx context.Context, postID string) ([]Reply, error)
	CreateReply(ctx context.Context, postID string, author User, in NewReply) (Reply, error)
	// Reply moderation. Delete/pin: ErrForbidden unless actor wrote the post.
	// ErrNotFound when the reply isn't under that post. Pinning replaces any
	// other pinned reply on the post. Report: ErrOwnReply for one's own reply;
	// reporting again overwrites (and reopens) the reporter's report.
	DeleteReply(ctx context.Context, postID, replyID, actorID string) error
	SetReplyPinned(ctx context.Context, postID, replyID, actorID string, pinned bool) error
	ReportReply(ctx context.Context, postID, replyID, reporterID string, reason ReportReason, note string) error
	// Admin review. ListOpenReports groups open reports by reply (oldest
	// report first; images are ids). AdminDeleteReply deletes any reply
	// (its reports go with it); DismissReports closes a reply's open reports.
	// Both return ErrNotFound for unknown replies.
	ListOpenReports(ctx context.Context) ([]ReportedReply, error)
	AdminDeleteReply(ctx context.Context, replyID string) error
	DismissReports(ctx context.Context, replyID string) error
	// CreatePost/CreateReply return ErrInvalidImages unless every image id
	// exists and belongs to the author.
	CreateImage(ctx context.Context, id, ownerID string, width, height, size int) error

	CreateVideo(ctx context.Context, v VideoRecord) error
	VideoContainer(ctx context.Context, id string) (string, error)
	// CreateGalleryItem returns ErrInvalidMedia unless mediaID is an image or
	// video (per kind) uploaded by author.
	CreateGalleryItem(ctx context.Context, author User, kind, mediaID, caption string) (GalleryEntry, error)
	ListGallery(ctx context.Context) ([]GalleryEntry, error)
	DeleteGalleryItem(ctx context.Context, id string) error

	CreateUser(ctx context.Context, email, nickname, passwordHash string) (User, error)

	// Profiles & follows. Nil fields in UpdateProfile are left unchanged.
	// Profile's viewerID may be "" (signed out). Follow returns ErrSelfFollow
	// for oneself; Follow/Unfollow are idempotent and return ErrNotFound for
	// unknown users.
	UpdateProfile(ctx context.Context, userID string, nickname *string, avatar *Avatar) (User, error)
	Profile(ctx context.Context, userID, viewerID string) (Profile, error)
	ListUserPosts(ctx context.Context, userID, viewerID string) ([]Post, error)
	ListLikedPosts(ctx context.Context, userID, viewerID string) ([]Post, error)
	ListFavorites(ctx context.Context, userID string) ([]Post, error)
	// SetLike / SetFavorite are idempotent; ErrNotFound for unknown posts.
	SetLike(ctx context.Context, userID, postID string, on bool) error
	SetFavorite(ctx context.Context, userID, postID string, on bool) error
	// ErrNotFound for unknown users.
	ListFollowers(ctx context.Context, userID string) ([]UserSummary, error)
	ListFollowing(ctx context.Context, userID string) ([]UserSummary, error)
	Follow(ctx context.Context, followerID, followeeID string) error
	Unfollow(ctx context.Context, followerID, followeeID string) error

	// Sign-up verification. CompleteRegistration creates the user and
	// deletes the pending row atomically (ErrEmailTaken if registered since).
	PendingRegistration(ctx context.Context, email string) (PendingRegistration, error)
	SavePendingRegistration(ctx context.Context, p PendingRegistration) error
	RecordWrongCode(ctx context.Context, email string) (attempts int, err error)
	DeletePendingRegistration(ctx context.Context, email string) error
	CompleteRegistration(ctx context.Context, email string) (User, error)

	// Forgot-password codes (rows exist for unregistered emails too).
	PasswordReset(ctx context.Context, email string) (ResetCode, error)
	SavePasswordReset(ctx context.Context, r ResetCode) error
	RecordWrongResetCode(ctx context.Context, email string) (attempts int, err error)
	DeletePasswordReset(ctx context.Context, email string) error
	UserByEmail(ctx context.Context, email string) (u User, passwordHash string, err error)
	CreateSession(ctx context.Context, tokenHash, userID string, expires time.Time) error
	UserBySession(ctx context.Context, tokenHash string, now time.Time) (User, error)
	DeleteSession(ctx context.Context, tokenHash string) error
	// ChangePassword sets a new hash and deletes all of the user's sessions,
	// atomically.
	ChangePassword(ctx context.Context, userID, passwordHash string) error
}

// PendingRegistration is a sign-up awaiting its emailed code.
type PendingRegistration struct {
	Email, Nickname, PasswordHash, CodeHash string
	Attempts                                int
	ExpiresAt, LastSentAt, WindowStart      time.Time
	SendCount                               int
}

// ResetCode is an outstanding forgot-password code.
type ResetCode struct {
	Email, CodeHash                    string
	Attempts, SendCount                int
	ExpiresAt, LastSentAt, WindowStart time.Time
}

// VideoRecord is a processed video's metadata.
type VideoRecord struct {
	ID, OwnerID, Container, PosterImageID string
	Width, Height                         int
	Size                                  int64
}

// GalleryEntry is a gallery row with media ids; the HTTP layer turns ids
// into URLs.
type GalleryEntry struct {
	ID, Kind, Caption string
	CreatedAt         time.Time
	ImageID, VideoID  string // one is set, per Kind
	PosterImageID     string // videos only
	Width, Height     int
}

// MaxRepliesPerPost is the product limit on interaction rounds per post.
const MaxRepliesPerPost = 10

type Server struct {
	Store Store
	Blobs blob.Store // processed images
	// Gallery videos.
	VideoBlobs   blob.Store
	Videos       VideoProcessor
	VideoWorkDir string // temp files; must be on the same filesystem as VideoBlobs
	// AdminEmails (lowercase) may manage the gallery.
	AdminEmails map[string]bool
	// Mailer sends verification codes; SendLimiter caps code emails per
	// client IP (anti mail-bombing).
	Mailer      mail.Mailer
	SendLimiter LoginLimiter
	// FixedCode, if set, replaces random verification codes (dev only).
	FixedCode string
	Limiter   LoginLimiter
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
	posts, err := s.Store.ListPosts(ctx, viewerID(ctx))
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
