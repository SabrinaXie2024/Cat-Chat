package store

import (
	"context"
	"slices"

	"github.com/cat-chat/api/internal/api"
)

type memReport struct {
	Reason api.ReportReason
	Note   string
	Status string
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
	m.reports[[2]string{replyID, reporterID}] = memReport{Reason: reason, Note: note, Status: "open"}
	return nil
}
