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
		// The users.avatar CHECK must accept exactly the API's Avatar enum.
		all := []api.Avatar{
			api.Orange, api.Black, api.White, api.Gray, api.Calico, api.Siamese,
			api.Tuxedo, api.Tabby, api.Silver, api.Tortie, api.Cream, api.OrangeWhite, api.Lihua,
		}
		for _, a := range all {
			if !a.Valid() {
				t.Fatalf("%q is not in the Avatar enum", a)
			}
			if _, err := pool.Exec(ctx, `UPDATE users SET avatar = $2 WHERE id = $1`, u.Id, string(a)); err != nil {
				t.Fatalf("CHECK rejects enum avatar %q: %v", a, err)
			}
		}
		if _, err := pool.Exec(ctx, `UPDATE users SET avatar = 'dog' WHERE id = $1`, u.Id); err == nil {
			t.Fatal("avatar outside the enum should violate the CHECK")
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
	if _, err := pool.Exec(context.Background(), `TRUNCATE users, sessions, posts, replies, images, videos, gallery_items, pending_registrations, password_resets, follows, likes, favorites, reply_reports CASCADE`); err != nil {
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

	t.Run("profiles and follows", func(t *testing.T) {
		s := newStore(t)
		a := seedUser(t, s, "a@b.co")
		b := seedUser(t, s, "c@d.co")
		if a.Avatar != api.Orange {
			t.Fatalf("default avatar = %q", a.Avatar)
		}
		post, _ := s.CreatePost(ctx, a, api.NewPost{Content: "hi"})
		if post.AuthorId != a.Id || post.AuthorAvatar != api.Orange {
			t.Fatalf("post author fields %+v", post)
		}
		name, av := "新名字", api.Calico
		u, err := s.UpdateProfile(ctx, a.Id, &name, &av)
		if err != nil || u.Nickname != name || u.Avatar != av || u.Email != "a@b.co" {
			t.Fatalf("UpdateProfile = %+v %v", u, err)
		}
		av2 := api.Black
		if u, _ := s.UpdateProfile(ctx, a.Id, nil, &av2); u.Nickname != name || u.Avatar != av2 {
			t.Fatalf("nil nickname must be kept: %+v", u)
		}
		if ps, _ := s.ListPosts(ctx, ""); ps[0].Author != name || ps[0].AuthorAvatar != av2 {
			t.Fatalf("posts show current author: %+v", ps[0])
		}

		if err := s.Follow(ctx, a.Id, a.Id); !errors.Is(err, api.ErrSelfFollow) {
			t.Fatalf("self follow: %v", err)
		}
		missing := "01a2111c-2a68-7371-bce0-5b41e2f69f46"
		if err := s.Follow(ctx, b.Id, missing); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("follow unknown: %v", err)
		}
		for range 2 { // idempotent
			if err := s.Follow(ctx, b.Id, a.Id); err != nil {
				t.Fatal(err)
			}
		}
		p, err := s.Profile(ctx, a.Id, b.Id)
		if err != nil || p.FollowerCount != 1 || p.FollowingCount != 0 || p.PostCount != 1 || !p.FollowedByMe || p.Avatar != av2 {
			t.Fatalf("profile = %+v %v", p, err)
		}
		if p, _ := s.Profile(ctx, a.Id, ""); p.FollowedByMe {
			t.Fatal("signed-out viewer can't follow")
		}
		if p, _ := s.Profile(ctx, b.Id, a.Id); p.FollowingCount != 1 || p.FollowedByMe {
			t.Fatalf("b profile = %+v", p)
		}
		for range 2 {
			if err := s.Unfollow(ctx, b.Id, a.Id); err != nil {
				t.Fatal(err)
			}
		}
		if p, _ := s.Profile(ctx, a.Id, b.Id); p.FollowerCount != 0 || p.FollowedByMe {
			t.Fatalf("after unfollow = %+v", p)
		}
		if _, err := s.Profile(ctx, missing, ""); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("unknown profile: %v", err)
		}
		if _, err := s.Profile(ctx, "not-a-uuid", ""); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("bad id profile: %v", err)
		}

		if ps, err := s.ListUserPosts(ctx, b.Id, ""); err != nil || ps == nil || len(ps) != 0 {
			t.Fatalf("empty user posts must be []: %#v %v", ps, err)
		}
		second, _ := s.CreatePost(ctx, u, api.NewPost{Content: "two"})
		_, _ = s.CreatePost(ctx, b, api.NewPost{Content: "b's"})
		ps, err := s.ListUserPosts(ctx, a.Id, "")
		if err != nil || len(ps) != 2 || ps[0].Id != second.Id || ps[1].Id != post.Id {
			t.Fatalf("user posts = %+v %v", ps, err)
		}
		if _, err := s.ListUserPosts(ctx, missing, ""); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("unknown user posts: %v", err)
		}
	})

	t.Run("likes, favorites and follow lists", func(t *testing.T) {
		s := newStore(t)
		a := seedUser(t, s, "a@b.co")
		b := seedUser(t, s, "c@d.co")
		p1, _ := s.CreatePost(ctx, a, api.NewPost{Content: "one"})
		p2, _ := s.CreatePost(ctx, a, api.NewPost{Content: "two"})
		if p1.LikeCount != 0 || p1.LikedByMe || p1.FavoritedByMe {
			t.Fatalf("new post %+v", p1)
		}
		missing := "01a2111c-2a68-7371-bce0-5b41e2f69f46"
		if err := s.SetLike(ctx, b.Id, missing, true); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("like unknown: %v", err)
		}
		if err := s.SetFavorite(ctx, b.Id, "bad", true); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("fav bad id: %v", err)
		}
		for range 2 { // idempotent
			if err := s.SetLike(ctx, b.Id, p1.Id, true); err != nil {
				t.Fatal(err)
			}
		}
		_ = s.SetLike(ctx, a.Id, p1.Id, true)
		_ = s.SetLike(ctx, b.Id, p2.Id, true) // liked last → listed first
		_ = s.SetFavorite(ctx, b.Id, p1.Id, true)

		ps, _ := s.ListPosts(ctx, b.Id)
		byID := map[string]api.Post{}
		for _, p := range ps {
			byID[p.Id] = p
		}
		if got := byID[p1.Id]; got.LikeCount != 2 || !got.LikedByMe || !got.FavoritedByMe {
			t.Fatalf("p1 for b = %+v", got)
		}
		if anon, _ := s.ListPosts(ctx, ""); anon[1].LikedByMe || anon[1].FavoritedByMe || anon[1].LikeCount != 2 {
			t.Fatalf("anonymous = %+v", anon[1])
		}
		if up, _ := s.ListUserPosts(ctx, a.Id, b.Id); !up[1].LikedByMe {
			t.Fatalf("user posts carry viewer flags: %+v", up[1])
		}

		liked, err := s.ListLikedPosts(ctx, b.Id, "")
		if err != nil || len(liked) != 2 || liked[0].Id != p2.Id || liked[1].Id != p1.Id {
			t.Fatalf("liked = %+v %v", liked, err)
		}
		if _, err := s.ListLikedPosts(ctx, missing, ""); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("liked unknown user: %v", err)
		}
		favs, err := s.ListFavorites(ctx, b.Id)
		if err != nil || len(favs) != 1 || favs[0].Id != p1.Id || !favs[0].FavoritedByMe {
			t.Fatalf("favorites = %+v %v", favs, err)
		}
		if favs, _ := s.ListFavorites(ctx, a.Id); favs == nil || len(favs) != 0 {
			t.Fatalf("empty favorites must be []: %#v", favs)
		}
		_ = s.SetLike(ctx, b.Id, p1.Id, false)
		_ = s.SetFavorite(ctx, b.Id, p1.Id, false)
		if liked, _ := s.ListLikedPosts(ctx, b.Id, ""); len(liked) != 1 {
			t.Fatalf("after unlike = %+v", liked)
		}
		if favs, _ := s.ListFavorites(ctx, b.Id); len(favs) != 0 {
			t.Fatalf("after unfavorite = %+v", favs)
		}

		c := seedUser(t, s, "e@f.co")
		_ = s.Follow(ctx, b.Id, a.Id)
		_ = s.Follow(ctx, c.Id, a.Id)
		fs, err := s.ListFollowers(ctx, a.Id)
		if err != nil || len(fs) != 2 || fs[0].Id != c.Id || fs[1].Id != b.Id || fs[0].Avatar != api.Orange {
			t.Fatalf("followers = %+v %v", fs, err)
		}
		fg, err := s.ListFollowing(ctx, b.Id)
		if err != nil || len(fg) != 1 || fg[0].Id != a.Id {
			t.Fatalf("following = %+v %v", fg, err)
		}
		if fg, _ := s.ListFollowing(ctx, a.Id); fg == nil || len(fg) != 0 {
			t.Fatalf("empty following must be []: %#v", fg)
		}
		if _, err := s.ListFollowers(ctx, missing); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("followers unknown: %v", err)
		}
	})

	t.Run("reply moderation: pin, delete, report", func(t *testing.T) {
		s := newStore(t)
		owner := seedUser(t, s, "a@b.co")
		other := seedUser(t, s, "c@d.co")
		post, _ := s.CreatePost(ctx, owner, api.NewPost{Content: "p"})
		r1, _ := s.CreateReply(ctx, post.Id, other, api.NewReply{Content: "r1"})
		r2, _ := s.CreateReply(ctx, post.Id, other, api.NewReply{Content: "r2"})
		r3, _ := s.CreateReply(ctx, post.Id, owner, api.NewReply{Content: "r3"})
		missing := "01a2111c-2a68-7371-bce0-5b41e2f69f46"

		if err := s.SetReplyPinned(ctx, post.Id, r2.Id, other.Id, true); !errors.Is(err, api.ErrForbidden) {
			t.Fatalf("non-author pin: %v", err)
		}
		if err := s.SetReplyPinned(ctx, post.Id, missing, owner.Id, true); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("pin unknown: %v", err)
		}
		other2, _ := s.CreatePost(ctx, other, api.NewPost{Content: "x"})
		if err := s.SetReplyPinned(ctx, other2.Id, r2.Id, other.Id, true); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("reply under a different post: %v", err)
		}
		if err := s.SetReplyPinned(ctx, post.Id, r2.Id, owner.Id, true); err != nil {
			t.Fatal(err)
		}
		rs, _ := s.ListReplies(ctx, post.Id)
		if rs[0].Id != r2.Id || !rs[0].Pinned || rs[1].Id != r1.Id || rs[2].Id != r3.Id {
			t.Fatalf("pinned first, then oldest: %+v", rs)
		}
		// Pinning another replaces it.
		if err := s.SetReplyPinned(ctx, post.Id, r3.Id, owner.Id, true); err != nil {
			t.Fatal(err)
		}
		rs, _ = s.ListReplies(ctx, post.Id)
		if rs[0].Id != r3.Id || rs[1].Pinned || rs[2].Pinned {
			t.Fatalf("one pinned reply: %+v", rs)
		}
		if err := s.SetReplyPinned(ctx, post.Id, r3.Id, owner.Id, false); err != nil {
			t.Fatal(err)
		}
		if rs, _ = s.ListReplies(ctx, post.Id); rs[0].Id != r1.Id || rs[2].Pinned {
			t.Fatalf("after unpin: %+v", rs)
		}

		if err := s.ReportReply(ctx, post.Id, r3.Id, owner.Id, api.Spam, ""); !errors.Is(err, api.ErrOwnReply) {
			t.Fatalf("report own: %v", err)
		}
		for range 2 { // re-reporting updates
			if err := s.ReportReply(ctx, post.Id, r1.Id, owner.Id, api.Abuse, "rude"); err != nil {
				t.Fatal(err)
			}
		}
		if err := s.ReportReply(ctx, post.Id, missing, owner.Id, api.Spam, ""); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("report unknown: %v", err)
		}

		bystander := seedUser(t, s, "x@y.co")
		if err := s.DeleteReply(ctx, post.Id, r1.Id, bystander.Id); !errors.Is(err, api.ErrForbidden) {
			t.Fatalf("bystander delete: %v", err)
		}
		if err := s.DeleteReply(ctx, post.Id, r3.Id, other.Id); !errors.Is(err, api.ErrForbidden) {
			t.Fatalf("deleting someone else's reply on someone else's post: %v", err)
		}
		if err := s.DeleteReply(ctx, post.Id, r1.Id, owner.Id); err != nil {
			t.Fatal(err)
		}
		if err := s.DeleteReply(ctx, post.Id, r1.Id, owner.Id); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("delete twice: %v", err)
		}
		rs, _ = s.ListReplies(ctx, post.Id)
		ps, _ := s.ListUserPosts(ctx, owner.Id, "")
		if len(rs) != 2 || ps[0].ReplyCount != 2 {
			t.Fatalf("delete frees a slot: %d replies, count %d", len(rs), ps[0].ReplyCount)
		}

		// Admin review queue.
		// The reply's own author may delete it too.
		own, _ := s.CreateReply(ctx, post.Id, other, api.NewReply{Content: "oops"})
		if err := s.DeleteReply(ctx, post.Id, own.Id, other.Id); err != nil {
			t.Fatalf("reply author delete: %v", err)
		}
		third := seedUser(t, s, "g@h.co")
		_ = s.ReportReply(ctx, post.Id, r2.Id, owner.Id, api.Spam, "")
		_ = s.ReportReply(ctx, post.Id, r2.Id, third.Id, api.Other, "note")
		_ = s.ReportReply(ctx, post.Id, r3.Id, third.Id, api.Abuse, "")
		q, err := s.ListOpenReports(ctx)
		if err != nil || len(q) != 2 || q[0].Reply.Id != r2.Id || len(q[0].Reports) != 2 ||
			q[0].Reports[1].Reporter.Id != third.Id || q[0].Reports[1].Note != "note" || q[1].Reply.Id != r3.Id ||
			q[0].PostId != post.Id || q[0].PostExcerpt != "p" {
			t.Fatalf("queue = %+v %v", q, err)
		}
		if err := s.DismissReports(ctx, r2.Id); err != nil {
			t.Fatal(err)
		}
		if err := s.AdminDeleteReply(ctx, r3.Id); err != nil {
			t.Fatal(err)
		}
		if q, _ := s.ListOpenReports(ctx); len(q) != 0 {
			t.Fatalf("queue after review = %+v", q)
		}
		if err := s.AdminDeleteReply(ctx, r3.Id); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("admin delete twice: %v", err)
		}
		if err := s.DismissReports(ctx, missing); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("dismiss unknown: %v", err)
		}
		if ps, _ := s.ListUserPosts(ctx, owner.Id, ""); ps[0].ReplyCount != 1 {
			t.Fatalf("admin delete frees a slot: %d", ps[0].ReplyCount)
		}
	})

	t.Run("posts newest first, author from user", func(t *testing.T) {
		s := newStore(t)
		u := seedUser(t, s, "a@b.co")
		if ps, err := s.ListPosts(ctx, ""); err != nil || ps == nil || len(ps) != 0 {
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
		ps, _ := s.ListPosts(ctx, "")
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
		ps, _ := s.ListPosts(ctx, "")
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
		if ps, _ := s.ListPosts(ctx, ""); ps[0].ReplyCount != 0 {
			t.Fatalf("reply count = %d after rejected replies", ps[0].ReplyCount)
		}
		if _, err := s.CreateReply(ctx, p.Id, u, api.NewReply{Content: "r", Images: []string{mine}}); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("pending registrations", func(t *testing.T) {
		s := newStore(t)
		if _, err := s.PendingRegistration(ctx, "p@b.co"); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("missing: %v", err)
		}
		at := now.Truncate(time.Second)
		p := api.PendingRegistration{
			Email: "p@b.co", Nickname: "小猫", PasswordHash: "h", CodeHash: "c1",
			ExpiresAt: at.Add(5 * time.Minute), LastSentAt: at, WindowStart: at, SendCount: 1,
		}
		if err := s.SavePendingRegistration(ctx, p); err != nil {
			t.Fatal(err)
		}
		if n, err := s.RecordWrongCode(ctx, "p@b.co"); err != nil || n != 1 {
			t.Fatalf("attempts %d %v", n, err)
		}
		// Re-sending replaces the code and resets attempts.
		p.CodeHash, p.SendCount = "c2", 2
		_ = s.SavePendingRegistration(ctx, p)
		got, err := s.PendingRegistration(ctx, "p@b.co")
		if err != nil || got.CodeHash != "c2" || got.Attempts != 0 || got.SendCount != 2 || !got.ExpiresAt.Equal(p.ExpiresAt) {
			t.Fatalf("got %+v %v", got, err)
		}

		u, err := s.CompleteRegistration(ctx, "p@b.co")
		if err != nil || u.Email != "p@b.co" || u.Nickname != "小猫" {
			t.Fatalf("complete %+v %v", u, err)
		}
		if _, hash, _ := s.UserByEmail(ctx, "p@b.co"); hash != "h" {
			t.Fatalf("hash = %q", hash)
		}
		if _, err := s.PendingRegistration(ctx, "p@b.co"); !errors.Is(err, api.ErrNotFound) {
			t.Fatal("pending row should be gone")
		}

		// Email registered meanwhile.
		p.Email = "taken@b.co"
		_ = s.SavePendingRegistration(ctx, p)
		seedUser(t, s, "taken@b.co")
		if _, err := s.CompleteRegistration(ctx, "taken@b.co"); !errors.Is(err, api.ErrEmailTaken) {
			t.Fatalf("taken: %v", err)
		}
		if _, err := s.CompleteRegistration(ctx, "nobody@b.co"); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("none: %v", err)
		}
	})

	t.Run("password resets", func(t *testing.T) {
		s := newStore(t)
		if _, err := s.PasswordReset(ctx, "r@b.co"); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("missing: %v", err)
		}
		at := now.Truncate(time.Second)
		r := api.ResetCode{Email: "r@b.co", CodeHash: "c1", ExpiresAt: at.Add(5 * time.Minute), LastSentAt: at, WindowStart: at, SendCount: 1}
		if err := s.SavePasswordReset(ctx, r); err != nil {
			t.Fatal(err)
		}
		if n, _ := s.RecordWrongResetCode(ctx, "r@b.co"); n != 1 {
			t.Fatalf("attempts %d", n)
		}
		r.CodeHash, r.SendCount = "c2", 2
		_ = s.SavePasswordReset(ctx, r)
		got, err := s.PasswordReset(ctx, "r@b.co")
		if err != nil || got.CodeHash != "c2" || got.Attempts != 0 || got.SendCount != 2 || !got.ExpiresAt.Equal(r.ExpiresAt) {
			t.Fatalf("got %+v %v", got, err)
		}
		if _, err := s.RecordWrongResetCode(ctx, "none@b.co"); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("missing attempts: %v", err)
		}
		_ = s.DeletePasswordReset(ctx, "r@b.co")
		if _, err := s.PasswordReset(ctx, "r@b.co"); !errors.Is(err, api.ErrNotFound) {
			t.Fatal("should be deleted")
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
		ps, _ := s.ListPosts(ctx, "")
		if len(rs) != api.MaxRepliesPerPost || ps[0].ReplyCount != api.MaxRepliesPerPost {
			t.Fatalf("stored %d replies, count %d", len(rs), ps[0].ReplyCount)
		}
	})
}
