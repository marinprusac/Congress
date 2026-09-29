package ingest

import (
	"sync"
	"time"
)

// Status is the daemon's connection state, reported by the API and heartbeat log.
type Status struct {
	mu          sync.Mutex
	state       string
	since       time.Time
	detail      string
	lastEventAt time.Time
	// Last sign of the phone itself (own messages, history/app-state sync).
	// Other people's messages arrive even while the phone is offline, so
	// only this says anything about the ~14-day linked-device expiry.
	lastPhoneAt time.Time
}

type StatusSnapshot struct {
	State       string `json:"state"`
	Since       int64  `json:"since"`
	Detail      string `json:"detail,omitempty"`
	LastEventAt int64  `json:"lastEventAt"`
	LastPhoneAt int64  `json:"lastPhoneAt"`
}

func NewStatus(state string) *Status { return &Status{state: state, since: time.Now()} }

func (s *Status) Set(state, detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state != state {
		s.since = time.Now()
	}
	s.state, s.detail = state, detail
}

func (s *Status) State() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

// Touch records an event; phone marks it as coming from the owner's phone.
func (s *Status) Touch(t time.Time, phone bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t.After(s.lastEventAt) {
		s.lastEventAt = t
	}
	if phone && t.After(s.lastPhoneAt) {
		s.lastPhoneAt = t
	}
}

func (s *Status) Restore(lastEvent, lastPhone time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastEventAt, s.lastPhoneAt = lastEvent, lastPhone
}

func ms(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

func (s *Status) Snapshot() StatusSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return StatusSnapshot{State: s.state, Since: ms(s.since), Detail: s.detail, LastEventAt: ms(s.lastEventAt), LastPhoneAt: ms(s.lastPhoneAt)}
}
