// Package api serves the messages store over a Unix socket. GET only;
// nothing here can reach WhatsApp except the media downloader.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"congress/wa-reader/internal/store"
	"congress/wa-reader/internal/waclient"
)

type Downloader interface {
	Download(ctx context.Context, m waclient.MediaRef) ([]byte, error)
}

type Server struct {
	Store    *store.Store
	Media    Downloader // nil when not connected to WhatsApp (offline mode)
	Status   func() any
	MaxMedia int64
	Log      *slog.Logger

	downloads chan struct{}
}

func (s *Server) Handler() http.Handler {
	s.downloads = make(chan struct{}, 1) // one media download at a time
	mux := http.NewServeMux()
	mux.HandleFunc("GET /status", s.status)
	mux.HandleFunc("GET /chats", s.chats)
	mux.HandleFunc("GET /chats/{jid}", s.chat)
	mux.HandleFunc("GET /chats/{jid}/messages", s.messages)
	mux.HandleFunc("GET /search", s.search)
	mux.HandleFunc("GET /media/{chat}/{id}", s.media)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusMethodNotAllowed, "read_only")
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func (s *Server) fail(w http.ResponseWriter, err error) {
	s.Log.Error("api", "err", err)
	writeError(w, http.StatusInternalServerError, "internal")
}

func limit(r *http.Request, def, max int) int {
	n, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || n <= 0 {
		return def
	}
	return min(n, max)
}

func (s *Server) status(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Status())
}

func (s *Server) chats(w http.ResponseWriter, r *http.Request) {
	n := limit(r, 50, 200)
	rows, err := s.Store.ListChats(r.Context(), n, r.URL.Query().Get("cursor"))
	if err != nil {
		s.fail(w, err)
		return
	}
	next := ""
	if len(rows) == n {
		last := rows[len(rows)-1]
		next = store.Cursor(last.LastMessageAt, last.JID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": rows, "nextCursor": next})
}

func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	c, err := s.Store.Chat(r.Context(), r.PathValue("jid"))
	if err != nil {
		s.fail(w, err)
		return
	}
	if c == nil {
		writeError(w, http.StatusNotFound, "chat_not_found")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) markTooLarge(rows []store.MessageRow) {
	for i := range rows {
		if m := rows[i].Media; m != nil && m.Size > s.MaxMedia {
			m.TooLarge = true
		}
	}
}

func (s *Server) messages(w http.ResponseWriter, r *http.Request) {
	n := limit(r, 50, 200)
	rows, err := s.Store.Messages(r.Context(), r.PathValue("jid"), n, r.URL.Query().Get("cursor"))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.markTooLarge(rows)
	next := ""
	if len(rows) == n {
		last := rows[len(rows)-1]
		next = store.Cursor(last.TS, last.ID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": rows, "nextCursor": next})
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, http.StatusOK, map[string]any{"chats": []any{}, "messages": []any{}})
		return
	}
	chat := r.URL.Query().Get("chat")
	msgs, err := s.Store.SearchMessages(r.Context(), q, chat, limit(r, 50, 200))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.markTooLarge(msgs)
	chats := []store.ChatRow{}
	if chat == "" {
		if chats, err = s.Store.SearchChats(r.Context(), q, 20); err != nil {
			s.fail(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": chats, "messages": msgs})
}

// Types a browser may render inline; everything else is forced to download.
// SVG is excluded: it can carry script.
func inlineSafe(mimetype string) bool {
	return (strings.HasPrefix(mimetype, "image/") && !strings.Contains(mimetype, "svg")) ||
		strings.HasPrefix(mimetype, "audio/") || strings.HasPrefix(mimetype, "video/")
}

func (s *Server) media(w http.ResponseWriter, r *http.Request) {
	chat, id := r.PathValue("chat"), r.PathValue("id")
	md, typ, err := s.Store.MediaFor(r.Context(), chat, id)
	if err != nil {
		s.fail(w, err)
		return
	}
	if md == nil {
		writeError(w, http.StatusNotFound, "no_media")
		return
	}
	if md.Size > s.MaxMedia {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large")
		return
	}
	if s.Media == nil {
		writeError(w, http.StatusServiceUnavailable, "offline")
		return
	}
	select {
	case s.downloads <- struct{}{}:
		defer func() { <-s.downloads }()
	case <-r.Context().Done():
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	data, err := s.Media.Download(ctx, waclient.MediaRef{
		Kind: typ, DirectPath: md.DirectPath, Key: md.Key, SHA256: md.SHA256, EncSHA256: md.EncSHA256,
	})
	if errors.Is(err, waclient.ErrMediaExpired) {
		writeError(w, http.StatusGone, "media_expired")
		return
	}
	if err != nil {
		s.Log.Warn("media download", "chat", chat, "id", id, "err", err)
		writeError(w, http.StatusBadGateway, "download_failed")
		return
	}
	if int64(len(data)) > s.MaxMedia {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large")
		return
	}
	ct := md.Mimetype
	if _, _, err := mime.ParseMediaType(ct); err != nil || ct == "" {
		ct = "application/octet-stream"
	}
	disposition := "attachment"
	if inlineSafe(ct) {
		disposition = "inline"
	} else {
		ct = "application/octet-stream"
	}
	name := md.Filename
	if name == "" {
		name = id
	}
	h := w.Header()
	h.Set("Content-Type", ct)
	h.Set("Content-Length", strconv.Itoa(len(data)))
	h.Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	h.Set("Cache-Control", "private, max-age=86400")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
