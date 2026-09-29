// wa-seed fills a messages DB with fake chats for local UI work
// (pair with `wa-reader serve -offline`). Never touches WhatsApp.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"congress/wa-reader/internal/store"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: wa-seed <messages.sqlite3>")
		os.Exit(2)
	}
	st, err := store.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer st.Close()
	ctx := context.Background()
	must := func(err error) {
		if err != nil {
			panic(err)
		}
	}
	const (
		me     = "385910000000@s.whatsapp.net"
		ana    = "385911111111@s.whatsapp.net"
		ivo    = "385922222222@s.whatsapp.net"
		family = "120363000000000001@g.us"
		shop   = "4930123456@s.whatsapp.net"
	)
	now := time.Now()
	at := func(d time.Duration) int64 { return now.Add(-d).UnixMilli() }
	msg := func(chat, id, sender string, ts int64, typ, text string, group bool) store.Message {
		m := store.Message{ChatJID: chat, ID: id, SenderJID: sender, FromMe: sender == me, TS: ts, Type: typ, Text: text}
		must(st.UpsertMessage(ctx, m, group))
		return m
	}
	must(st.UpsertContact(ctx, store.Contact{JID: ana, PushName: "Ana", FullName: "Ana Horvat"}))
	must(st.UpsertContact(ctx, store.Contact{JID: ivo, PushName: "Ivo 🚲"}))

	// A long DM with Ana, spanning days, for paging.
	for i := 0; i < 120; i++ {
		sender := ana
		if i%3 == 0 {
			sender = me
		}
		msg(ana, fmt.Sprintf("A%03d", i), sender, at(time.Duration(120-i)*47*time.Minute+2*time.Hour), "text", fmt.Sprintf("Message number %d about the weekend plans", i), false)
	}
	msg(ana, "Q1", ana, at(90*time.Minute), "text", "Are we still on for dinner on Friday?\nI can book the place by the harbour.", false)
	reply := store.Message{ChatJID: ana, ID: "Q2", SenderJID: me, FromMe: true, TS: at(80 * time.Minute), Type: "text", Text: "Yes! Book it 🙌", QuotedID: "Q1"}
	must(st.UpsertMessage(ctx, reply, false))
	must(st.SetReaction(ctx, ana, "Q2", ana, "❤️", at(79*time.Minute)))
	msg(ana, "E1", ana, at(70*time.Minute), "text", "Table for 7pm", false)
	must(st.ApplyEdit(ctx, ana, "E1", "Table for 8pm (they were full at 7)", at(65*time.Minute)))
	msg(ana, "R1", ana, at(60*time.Minute), "text", "oops wrong chat", false)
	must(st.ApplyRevoke(ctx, ana, "R1", at(59*time.Minute)))
	img := store.Message{ChatJID: ana, ID: "IMG1", SenderJID: ana, TS: at(50 * time.Minute), Type: "image", Text: "The view from here",
		Media: &store.Media{Mimetype: "image/jpeg", Size: 184_000, DirectPath: "/v/fake", Key: []byte{1}, Width: 1280, Height: 960}}
	must(st.UpsertMessage(ctx, img, false))
	voice := store.Message{ChatJID: ana, ID: "V1", SenderJID: ana, TS: at(45 * time.Minute), Type: "voice",
		Media: &store.Media{Mimetype: "audio/ogg; codecs=opus", Size: 21_000, DirectPath: "/v/fake", Key: []byte{1}, Seconds: 14}}
	must(st.UpsertMessage(ctx, voice, false))

	// A named group with several senders.
	must(st.SetChatName(ctx, family, "Family", true))
	msg(family, "G1", ivo, at(26*time.Hour), "text", "Sunday lunch at grandma's?", true)
	msg(family, "G2", ana, at(25*time.Hour), "text", "I'll bring dessert", true)
	msg(family, "G3", me, at(3*time.Hour), "text", "Count me in", true)
	vid := store.Message{ChatJID: family, ID: "G4", SenderJID: ivo, TS: at(2 * time.Hour), Type: "video", Text: "Last year's lunch 😂",
		Media: &store.Media{Mimetype: "video/mp4", Size: 80 << 20, DirectPath: "/v/fake", Key: []byte{1}, Seconds: 95}}
	must(st.UpsertMessage(ctx, vid, true))
	msg(family, "G5", ivo, at(90*time.Minute), "poll", "Dessert?\n• Cake\n• Ice cream", true)

	// A contact with no name, and a document.
	doc := store.Message{ChatJID: shop, ID: "D1", SenderJID: shop, TS: at(8 * 24 * time.Hour), Type: "document", Text: "Your invoice",
		Media: &store.Media{Mimetype: "application/pdf", Size: 96_000, DirectPath: "/v/fake", Key: []byte{1}, Filename: "invoice-2026-09.pdf"}}
	must(st.UpsertMessage(ctx, doc, false))
	must(st.SetMeta(ctx, "last_phone_at", fmt.Sprint(at(11*24*time.Hour))))
	must(st.SetMeta(ctx, "last_event_at", fmt.Sprint(at(5*time.Minute))))
	fmt.Println("seeded", os.Args[1])
}
