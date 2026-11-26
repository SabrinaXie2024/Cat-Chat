package store

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/db"
)

// Every api.Store implementation must pass this suite.
func TestMemory(t *testing.T) {
	runConformance(t, func(t *testing.T) api.Store { return NewMemory() })
}

func TestPostgres(t *testing.T) {
	pool := testPool(t)
	runConformance(t, func(t *testing.T) api.Store {
		truncate(t, pool)
		return NewPostgres(pool)
	})

	t.Run("schema CHECKs back up the API limits", func(t *testing.T) {
		truncate(t, pool)
		ctx := context.Background()
		u, _ := NewPostgres(pool).CreateUser(ctx, "a@b.co", "a", "h")
		_, err := pool.Exec(ctx, `INSERT INTO posts (author_id, content) VALUES ($1, $2)`, u.Id, strings.Repeat("猫", 501))
		if err == nil {
			t.Fatal("501-char post should violate a CHECK constraint")
		}
		_, err = pool.Exec(ctx, `INSERT INTO posts (author_id, content) VALUES ($1, $2)`, u.Id, strings.Repeat("猫", 500))
		if err != nil {
			t.Fatalf("500 CJK chars must fit (char_length, not bytes): %v", err)
		}
		_, err = pool.Exec(ctx, `INSERT INTO users (email, nickname, password_hash) VALUES ('UP@b.co', 'x', 'h')`)
		if err == nil {
			t.Fatal("non-lowercase email should be rejected")
		}
	})

	t.Run("expired sessions are purged", func(t *testing.T) {
		truncate(t, pool)
		ctx := context.Background()
		s := NewPostgres(pool)
		u, _ := s.CreateUser(ctx, "a@b.co", "a", "h")
		now := time.Now()
		_ = s.CreateSession(ctx, "old", u.Id, now.Add(-time.Minute))
		_ = s.CreateSession(ctx, "live", u.Id, now.Add(time.Hour))
		n, err := s.DeleteExpiredSessions(ctx, now)
		if err != nil || n != 1 {
			t.Fatalf("purged %d, err %v; want 1", n, err)
		}
		if _, err := s.UserBySession(ctx, "live", now); err != nil {
			t.Fatal("live session should survive")
		}
	})
}

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set (root `pnpm test` sets it)")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	return pool
}

func truncate(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `TRUNCATE users, sessions, posts, replies, images, videos, gallery_items CASCADE`); err != nil {
		t.Fatal(err)
	}
}

func runConformance(t *testing.T, newStore func(*testing.T) api.Store) {
	ctx := context.Background()
	now := time.Now()

	seedUser := func(t *testing.T, s api.Store, email string) api.User {
		t.Helper()
		u, err := s.CreateUser(ctx, email, "咪咪", "hash")
		if err != nil {
			t.Fatal(err)
		}
		return u
	}

	t.Run("users", func(t *testing.T) {
		s := newStore(t)
		u := seedUser(t, s, "a@b.co")
		if u.Id == "" || u.Email != "a@b.co" || u.Nickname != "咪咪" || u.CreatedAt.IsZero() {
			t.Fatalf("bad user %+v", u)
		}
		if _, err := s.CreateUser(ctx, "a@b.co", "x", "h"); !errors.Is(err, api.ErrEmailTaken) {
			t.Fatalf("duplicate email: %v", err)
		}
		got, hash, err := s.UserByEmail(ctx, "a@b.co")
		if err != nil || got.Id != u.Id || hash != "hash" {
			t.Fatalf("UserByEmail = %+v %q %v", got, hash, err)
		}
		if _, _, err := s.UserByEmail(ctx, "nobody@b.co"); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("unknown email: %v", err)
		}
	})

	t.Run("sessions", func(t *testing.T) {
		s := newStore(t)
		u := seedUser(t, s, "a@b.co")
		if err := s.CreateSession(ctx, "tok", u.Id, now.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
		if got, err := s.UserBySession(ctx, "tok", now); err != nil || got.Id != u.Id {
			t.Fatalf("UserBySession = %+v %v", got, err)
		}
		if _, err := s.UserBySession(ctx, "tok", now.Add(2*time.Hour)); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("expired session: %v", err)
		}
		_ = s.CreateSession(ctx, "tok2", u.Id, now.Add(time.Hour))
		if err := s.DeleteSession(ctx, "tok2"); err != nil {
			t.Fatal(err)
		}
		if _, err := s.UserBySession(ctx, "tok2", now); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("deleted session: %v", err)
		}
		if err := s.DeleteSession(ctx, "never-existed"); err != nil {
			t.Fatalf("delete is idempotent: %v", err)
		}
	})

	t.Run("change password revokes every session", func(t *testing.T) {
		s := newStore(t)
		u := seedUser(t, s, "a@b.co")
		other := seedUser(t, s, "c@d.co")
		_ = s.CreateSession(ctx, "u1", u.Id, now.Add(time.Hour))
		_ = s.CreateSession(ctx, "u2", u.Id, now.Add(time.Hour))
		_ = s.CreateSession(ctx, "o1", other.Id, now.Add(time.Hour))
		if err := s.ChangePassword(ctx, u.Id, "new-hash"); err != nil {
			t.Fatal(err)
		}
		if _, hash, _ := s.UserByEmail(ctx, "a@b.co"); hash != "new-hash" {
			t.Fatalf("hash = %q", hash)
		}
		for _, tok := range []string{"u1", "u2"} {
			if _, err := s.UserBySession(ctx, tok, now); !errors.Is(err, api.ErrNotFound) {
				t.Fatalf("session %s survived: %v", tok, err)
			}
		}
		if _, err := s.UserBySession(ctx, "o1", now); err != nil {
			t.Fatalf("other user's session must survive: %v", err)
		}
		if err := s.ChangePassword(ctx, "01a2111c-2a68-7371-bce0-5b41e2f69f46", "h"); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("unknown user: %v", err)
		}
	})

	t.Run("posts newest first, author from user", func(t *testing.T) {
		s := newStore(t)
		u := seedUser(t, s, "a@b.co")
		if ps, err := s.ListPosts(ctx); err != nil || ps == nil || len(ps) != 0 {
			t.Fatalf("empty list must be [] not nil: %#v %v", ps, err)
		}
		first, _ := s.CreatePost(ctx, u, api.NewPost{Content: "first"})
		img := "01a2111c-2a68-7371-bce0-0000000000aa"
		_ = s.CreateImage(ctx, img, u.Id, 10, 10, 100)
		second, err := s.CreatePost(ctx, u, api.NewPost{Content: "second", Images: []string{img}})
		if err != nil {
			t.Fatal(err)
		}
		if second.Author != "咪咪" || second.Images[0] != img || first.Images == nil {
			t.Fatalf("bad post %+v / %+v", second, first)
		}
		ps, _ := s.ListPosts(ctx)
		if len(ps) != 2 || ps[0].Id != second.Id || ps[1].Id != first.Id {
			t.Fatalf("order: %+v", ps)
		}
	})

	t.Run("replies", func(t *testing.T) {
		s := newStore(t)
		u := seedUser(t, s, "a@b.co")
		p, _ := s.CreatePost(ctx, u, api.NewPost{Content: "p"})
		for _, bad := range []string{"nope", "00000000-0000-0000-0000-000000000000"} {
			if _, err := s.ListReplies(ctx, bad); !errors.Is(err, api.ErrNotFound) {
				t.Fatalf("ListReplies(%q): %v", bad, err)
			}
			if _, err := s.CreateReply(ctx, bad, u, api.NewReply{Content: "r"}); !errors.Is(err, api.ErrNotFound) {
				t.Fatalf("CreateReply(%q): %v", bad, err)
			}
		}
		r1, err := s.CreateReply(ctx, p.Id, u, api.NewReply{Content: "one"})
		if err != nil || r1.PostId != p.Id || r1.Author != "咪咪" {
			t.Fatalf("reply %+v %v", r1, err)
		}
		r2, _ := s.CreateReply(ctx, p.Id, u, api.NewReply{Content: "two"})
		rs, _ := s.ListReplies(ctx, p.Id)
		if len(rs) != 2 || rs[0].Id != r1.Id || rs[1].Id != r2.Id {
			t.Fatalf("replies oldest first: %+v", rs)
		}
		ps, _ := s.ListPosts(ctx)
		if ps[0].ReplyCount != 2 {
			t.Fatalf("reply count %d", ps[0].ReplyCount)
		}
	})

	t.Run("posts and replies may only use the author's images", func(t *testing.T) {
		s := newStore(t)
		u := seedUser(t, s, "a@b.co")
		other := seedUser(t, s, "c@d.co")
		mine, theirs := "01a2111c-2a68-7371-bce0-000000000001", "01a2111c-2a68-7371-bce0-000000000002"
		if err := s.CreateImage(ctx, mine, u.Id, 100, 100, 1000); err != nil {
			t.Fatal(err)
		}
		_ = s.CreateImage(ctx, theirs, other.Id, 100, 100, 1000)

		p, err := s.CreatePost(ctx, u, api.NewPost{Content: "p", Images: []string{mine}})
		if err != nil || len(p.Images) != 1 || p.Images[0] != mine {
			t.Fatalf("own image: %+v %v", p, err)
		}
		for _, bad := range [][]string{{theirs}, {mine, theirs}, {"01a2111c-2a68-7371-bce0-000000000003"}} {
			if _, err := s.CreatePost(ctx, u, api.NewPost{Content: "p", Images: bad}); !errors.Is(err, api.ErrInvalidImages) {
				t.Fatalf("post %v: %v", bad, err)
			}
			if _, err := s.CreateReply(ctx, p.Id, u, api.NewReply{Content: "r", Images: bad}); !errors.Is(err, api.ErrInvalidImages) {
				t.Fatalf("reply %v: %v", bad, err)
			}
		}
		// A rejected reply must not consume a reply slot.
		if ps, _ := s.ListPosts(ctx); ps[0].ReplyCount != 0 {
			t.Fatalf("reply count = %d after rejected replies", ps[0].ReplyCount)
		}
		if _, err := s.CreateReply(ctx, p.Id, u, api.NewReply{Content: "r", Images: []string{mine}}); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("gallery", func(t *testing.T) {
		s := newStore(t)
		admin := seedUser(t, s, "a@b.co")
		other := seedUser(t, s, "c@d.co")
		img, poster, theirs := "01a2111c-2a68-7371-bce0-0000000000b1", "01a2111c-2a68-7371-bce0-0000000000b2", "01a2111c-2a68-7371-bce0-0000000000b3"
		vid := "01a2111c-2a68-7371-bce0-0000000000c1"
		_ = s.CreateImage(ctx, img, admin.Id, 800, 600, 1000)
		_ = s.CreateImage(ctx, poster, admin.Id, 320, 240, 1000)
		_ = s.CreateImage(ctx, theirs, other.Id, 10, 10, 1000)
		if err := s.CreateVideo(ctx, api.VideoRecord{ID: vid, OwnerID: admin.Id, Container: "mp4", PosterImageID: poster, Width: 320, Height: 240, Size: 5000}); err != nil {
			t.Fatal(err)
		}
		if c, err := s.VideoContainer(ctx, vid); err != nil || c != "mp4" {
			t.Fatalf("container %q %v", c, err)
		}
		if _, err := s.VideoContainer(ctx, "nope"); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("missing video: %v", err)
		}

		photo, err := s.CreateGalleryItem(ctx, admin, "photo", img, "cap")
		if err != nil || photo.ImageID != img || photo.Width != 800 || photo.Height != 600 {
			t.Fatalf("photo %+v %v", photo, err)
		}
		video, err := s.CreateGalleryItem(ctx, admin, "video", vid, "")
		if err != nil || video.VideoID != vid || video.PosterImageID != poster || video.Width != 320 {
			t.Fatalf("video %+v %v", video, err)
		}
		for _, bad := range []struct{ kind, id string }{{"photo", theirs}, {"photo", vid}, {"video", img}, {"photo", "nope"}, {"gif", img}} {
			if _, err := s.CreateGalleryItem(ctx, admin, bad.kind, bad.id, ""); !errors.Is(err, api.ErrInvalidMedia) {
				t.Fatalf("%v: %v", bad, err)
			}
		}

		list, _ := s.ListGallery(ctx)
		if len(list) != 2 || list[0].ID != video.ID || list[1].ID != photo.ID || list[0].PosterImageID != poster || list[1].Width != 800 {
			t.Fatalf("list %+v", list)
		}
		if err := s.DeleteGalleryItem(ctx, photo.ID); err != nil {
			t.Fatal(err)
		}
		if err := s.DeleteGalleryItem(ctx, photo.ID); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("double delete: %v", err)
		}
		if list, _ := s.ListGallery(ctx); len(list) != 1 {
			t.Fatalf("after delete %+v", list)
		}
	})

	t.Run("reply limit holds under concurrency", func(t *testing.T) {
		s := newStore(t)
		u := seedUser(t, s, "a@b.co")
		p, _ := s.CreatePost(ctx, u, api.NewPost{Content: "p"})
		var ok, full atomic.Int32
		var wg sync.WaitGroup
		for range 3 * api.MaxRepliesPerPost {
			wg.Go(func() {
				_, err := s.CreateReply(ctx, p.Id, u, api.NewReply{Content: "r"})
				switch {
				case err == nil:
					ok.Add(1)
				case errors.Is(err, api.ErrThreadFull):
					full.Add(1)
				default:
					t.Error(err)
				}
			})
		}
		wg.Wait()
		if ok.Load() != api.MaxRepliesPerPost || full.Load() != 2*api.MaxRepliesPerPost {
			t.Fatalf("ok=%d full=%d", ok.Load(), full.Load())
		}
		rs, _ := s.ListReplies(ctx, p.Id)
		ps, _ := s.ListPosts(ctx)
		if len(rs) != api.MaxRepliesPerPost || ps[0].ReplyCount != api.MaxRepliesPerPost {
			t.Fatalf("stored %d replies, count %d", len(rs), ps[0].ReplyCount)
		}
	})
}
