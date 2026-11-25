package auth

import (
	"sync"
	"time"
)

// LoginLimiter blocks a key (normalized email) after MaxFailures failed
// logins within Window. In-memory, so per-process; move to Redis/Postgres
// when running more than one instance.
type LoginLimiter struct {
	MaxFailures int
	Window      time.Duration
	Now         func() time.Time

	mu       sync.Mutex
	failures map[string][]time.Time
}

func NewLoginLimiter() *LoginLimiter {
	return &LoginLimiter{MaxFailures: 5, Window: 15 * time.Minute, Now: time.Now, failures: map[string][]time.Time{}}
}

// Blocked reports whether key has hit the failure limit.
func (l *LoginLimiter) Blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.prune(key)) >= l.MaxFailures
}

func (l *LoginLimiter) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.failures[key] = append(l.prune(key), l.Now())
}

func (l *LoginLimiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, key)
}

func (l *LoginLimiter) prune(key string) []time.Time {
	cutoff := l.Now().Add(-l.Window)
	kept := l.failures[key][:0]
	for _, t := range l.failures[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(l.failures, key)
		return nil
	}
	l.failures[key] = kept
	return kept
}
