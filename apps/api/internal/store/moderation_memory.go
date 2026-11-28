package store

import (
	"cmp"
	"context"
	"slices"
	"time"

	"github.com/cat-chat/api/internal/api"
)

type memReport struct {
	Reason  api.ReportReason
	Note    string
	Status  string
	Created time.Time
	Seq     int // tie-break for equal timestamps
}

// replyIndex finds a reply under postID (caller holds the lock).
func (m *Memory) replyIndex(postID, replyID string) (postIdx, replyIdx int, err error) {
	postIdx = m.findPost(postID)
	if postIdx < 0 {
		return 0, 0, api.ErrNotFound
	}
	replyIdx = slices.IndexFunc(m.replies[postID], func(r api.Reply) bool { return r.Id == replyID })
	if replyIdx < 0 {
		return 0, 0, api.ErrNotFound
	}
	return postIdx, replyIdx, nil
}

func (m *Memory) DeleteReply(_ context.Context, postID, replyID, actorID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	pi, ri, err := m.replyIndex(postID, replyID)
	if err != nil {
		return err
	}
	if m.posts[pi].AuthorId != actorID {
		return api.ErrForbidden
	}
	m.replies[postID] = slices.Delete(m.replies[postID], ri, ri+1)
	m.posts[pi].ReplyCount--
	for k := range m.reports {
		if k[0] == replyID {
			delete(m.reports, k)
		}
	}
	return nil
}

func (m *Memory) SetReplyPinned(_ context.Context, postID, replyID, actorID string, pinned bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	pi, ri, err := m.replyIndex(postID, replyID)
	if err != nil {
		return err
	}
	if m.posts[pi].AuthorId != actorID {
		return api.ErrForbidden
	}
	rs := m.replies[postID]
	if pinned {
		for i := range rs {
			rs[i].Pinned = false
		}
	}
	rs[ri].Pinned = pinned
	return nil
}

func (m *Memory) ReportReply(_ context.Context, postID, replyID, reporterID string, reason api.ReportReason, note string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ri, err := m.replyIndex(postID, replyID)
	if err != nil {
		return err
	}
	if m.replies[postID][ri].AuthorId == reporterID {
		return api.ErrOwnReply
	}
	m.reportSeq++
	m.reports[[2]string{replyID, reporterID}] = memReport{
		Reason: reason, Note: note, Status: "open", Created: m.now().UTC(), Seq: m.reportSeq,
	}
	return nil
}

// findReply locates a reply in any post (caller holds the lock).
func (m *Memory) findReply(replyID string) (postID string, idx int, ok bool) {
	for pid, rs := range m.replies {
		if i := slices.IndexFunc(rs, func(r api.Reply) bool { return r.Id == replyID }); i >= 0 {
			return pid, i, true
		}
	}
	return "", 0, false
}

func (m *Memory) ListOpenReports(context.Context) ([]api.ReportedReply, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	type entry struct {
		replyID string
		rep     memReport
		entry   api.ReportEntry
	}
	var es []entry
	for k, r := range m.reports {
		if r.Status != "open" {
			continue
		}
		u := m.users[k[1]].user
		es = append(es, entry{k[0], r, api.ReportEntry{
			Reason: r.Reason, Note: r.Note, CreatedAt: r.Created,
			Reporter: api.UserSummary{Id: u.Id, Nickname: u.Nickname, Avatar: u.Avatar},
		}})
	}
	slices.SortFunc(es, func(a, b entry) int { return cmp.Compare(a.rep.Seq, b.rep.Seq) })
	out := []api.ReportedReply{}
	index := map[string]int{}
	for _, e := range es {
		i, ok := index[e.replyID]
		if !ok {
			pid, ri, found := m.findReply(e.replyID)
			if !found {
				continue
			}
			post := m.posts[m.findPost(pid)]
			excerpt := []rune(post.Content)
			if len(excerpt) > 80 {
				excerpt = excerpt[:80]
			}
			i = len(out)
			index[e.replyID] = i
			out = append(out, api.ReportedReply{
				PostId: pid, PostExcerpt: string(excerpt), Reply: m.replies[pid][ri], Reports: []api.ReportEntry{},
			})
		}
		out[i].Reports = append(out[i].Reports, e.entry)
	}
	return out, nil
}

func (m *Memory) AdminDeleteReply(ctx context.Context, replyID string) error {
	m.mu.RLock()
	pid, _, ok := m.findReply(replyID)
	var author string
	if ok {
		author = m.posts[m.findPost(pid)].AuthorId
	}
	m.mu.RUnlock()
	if !ok {
		return api.ErrNotFound
	}
	return m.DeleteReply(ctx, pid, replyID, author)
}

func (m *Memory) DismissReports(_ context.Context, replyID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, _, ok := m.findReply(replyID); !ok {
		return api.ErrNotFound
	}
	for k, r := range m.reports {
		if k[0] == replyID && r.Status == "open" {
			r.Status = "dismissed"
			m.reports[k] = r
		}
	}
	return nil
}
