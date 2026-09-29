package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"congress/wa-reader/internal/store"
	"congress/wa-reader/internal/waclient"
)

type fakeDownloader struct {
	data []byte
	err  error
	got  waclient.MediaRef
}

func (f *fakeDownloader) Download(_ context.Context, m waclient.MediaRef) ([]byte, error) {
	f.got = m
	return f.data, f.err
}

const chat = "385911111111@s.whatsapp.net"

func setup(t *testing.T) (http.Handler, *store.Store, *fakeDownloader) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "m.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	dl := &fakeDownloader{data: []byte("bytes")}
	srv := &Server{Store: st, Media: dl, MaxMedia: 100, Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Status: func() any { return map[string]string{"state": "connected"} }}
	return srv.Handler(), st, dl
}

func withMedia(t *testing.T, st *store.Store, id, typ, mimetype string, size int64) {
	t.Helper()
	err := st.UpsertMessage(context.Background(), store.Message{ChatJID: chat, ID: id, SenderJID: chat, TS: 1000, Type: typ,
		Media: &store.Media{Mimetype: mimetype, Size: size, DirectPath: "/p", Key: []byte{1}, Filename: "f"}}, false)
	if err != nil {
		t.Fatal(err)
	}
}

func get(h http.Handler, method, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestOnlyReads(t *testing.T) {
	h, _, _ := setup(t)
	for _, m := range []string{"POST", "PUT", "PATCH", "DELETE"} {
		if rec := get(h, m, "/chats"); rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s: %d", m, rec.Code)
		}
	}
	if rec := get(h, "GET", "/status"); rec.Code != 200 || !strings.Contains(rec.Body.String(), "connected") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestChatsAndMessagesPaging(t *testing.T) {
	h, st, _ := setup(t)
	for _, id := range []string{"a", "b", "c"} {
		_ = st.UpsertMessage(context.Background(), store.Message{ChatJID: chat, ID: id, SenderJID: chat, TS: 1000, Type: "text", Text: id}, false)
	}
	var page struct {
		Messages   []store.MessageRow
		NextCursor string
	}
	rec := get(h, "GET", "/chats/"+chat+"/messages?limit=2")
	_ = json.Unmarshal(rec.Body.Bytes(), &page)
	if len(page.Messages) != 2 || page.NextCursor == "" {
		t.Fatalf("%s", rec.Body)
	}
	rec = get(h, "GET", "/chats/"+chat+"/messages?limit=2&cursor="+page.NextCursor)
	_ = json.Unmarshal(rec.Body.Bytes(), &page)
	if len(page.Messages) != 1 || page.NextCursor != "" {
		t.Fatalf("%s", rec.Body)
	}
	if rec := get(h, "GET", "/chats"); !strings.Contains(rec.Body.String(), chat) {
		t.Fatalf("%s", rec.Body)
	}
	if rec := get(h, "GET", "/chats/nobody@s.whatsapp.net"); rec.Code != 404 {
		t.Fatalf("%d", rec.Code)
	}
}

func TestMediaCapAndFlags(t *testing.T) {
	h, st, dl := setup(t)
	withMedia(t, st, "big", "video", "video/mp4", 101)
	if rec := get(h, "GET", "/media/"+chat+"/big"); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("%d", rec.Code)
	}
	if dl.got.DirectPath != "" {
		t.Fatal("downloaded despite the cap")
	}
	rec := get(h, "GET", "/chats/"+chat+"/messages")
	if !strings.Contains(rec.Body.String(), `"tooLarge":true`) {
		t.Fatalf("%s", rec.Body)
	}
	// Declared small, actually big: still refused.
	withMedia(t, st, "liar", "image", "image/jpeg", 10)
	dl.data = make([]byte, 101)
	if rec := get(h, "GET", "/media/"+chat+"/liar"); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("%d", rec.Code)
	}
}

func TestMediaExpiredAndMissing(t *testing.T) {
	h, st, dl := setup(t)
	withMedia(t, st, "old", "image", "image/jpeg", 10)
	dl.err = waclient.ErrMediaExpired
	if rec := get(h, "GET", "/media/"+chat+"/old"); rec.Code != http.StatusGone {
		t.Fatalf("%d", rec.Code)
	}
	if rec := get(h, "GET", "/media/"+chat+"/nope"); rec.Code != 404 {
		t.Fatalf("%d", rec.Code)
	}
}

func TestMediaDispositionNeverRendersActiveContent(t *testing.T) {
	h, st, dl := setup(t)
	withMedia(t, st, "img", "image", "image/jpeg", 10)
	rec := get(h, "GET", "/media/"+chat+"/img")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/jpeg" || !strings.HasPrefix(rec.Header().Get("Content-Disposition"), "inline") {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
	if dl.got.Kind != "image" || dl.got.DirectPath != "/p" {
		t.Fatalf("%+v", dl.got)
	}
	for i, mt := range []string{"text/html", "image/svg+xml", "application/xhtml+xml"} {
		id := "doc" + string(rune('a'+i))
		withMedia(t, st, id, "document", mt, 10)
		rec := get(h, "GET", "/media/"+chat+"/"+id)
		if rec.Header().Get("Content-Type") != "application/octet-stream" ||
			!strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment") ||
			rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s served as %v", mt, rec.Header())
		}
	}
}

func TestSearch(t *testing.T) {
	h, st, _ := setup(t)
	_ = st.UpsertMessage(context.Background(), store.Message{ChatJID: chat, ID: "1", SenderJID: chat, TS: 1, Type: "text", Text: "dinner on friday"}, false)
	rec := get(h, "GET", "/search?q=fri")
	if !strings.Contains(rec.Body.String(), "dinner on friday") {
		t.Fatalf("%s", rec.Body)
	}
	// FTS syntax in user input must not error.
	if rec := get(h, "GET", `/search?q=%22a%22+OR+NEAR(`); rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}
