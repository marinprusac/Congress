package ingest

import (
	"fmt"
	"strings"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/reflect/protoreflect"

	"congress/wa-reader/internal/store"
)

// Content is the displayable part of a message. Type "" = nothing to show.
type Content struct {
	Type     string
	Text     string
	QuotedID string
	Media    *store.Media
}

type mediaMessage interface {
	GetMimetype() string
	GetFileLength() uint64
	GetDirectPath() string
	GetMediaKey() []byte
	GetFileSHA256() []byte
	GetFileEncSHA256() []byte
	GetContextInfo() *waE2E.ContextInfo
}

func media(m mediaMessage) *store.Media {
	return &store.Media{
		Mimetype: m.GetMimetype(), Size: int64(m.GetFileLength()), DirectPath: m.GetDirectPath(),
		Key: m.GetMediaKey(), SHA256: m.GetFileSHA256(), EncSHA256: m.GetFileEncSHA256(),
	}
}

// Extract classifies a message and pulls out its text, quote and media metadata.
func Extract(m *waE2E.Message) Content {
	if m == nil {
		return Content{}
	}
	switch {
	case m.Conversation != nil:
		return Content{Type: "text", Text: m.GetConversation()}
	case m.ExtendedTextMessage != nil:
		x := m.GetExtendedTextMessage()
		return Content{Type: "text", Text: x.GetText(), QuotedID: x.GetContextInfo().GetStanzaID()}
	case m.ImageMessage != nil:
		x := m.GetImageMessage()
		md := media(x)
		md.Width, md.Height = int64(x.GetWidth()), int64(x.GetHeight())
		return Content{Type: "image", Text: x.GetCaption(), QuotedID: x.GetContextInfo().GetStanzaID(), Media: md}
	case m.VideoMessage != nil:
		x := m.GetVideoMessage()
		md := media(x)
		md.Width, md.Height, md.Seconds = int64(x.GetWidth()), int64(x.GetHeight()), int64(x.GetSeconds())
		typ := "video"
		if x.GetGifPlayback() {
			typ = "gif"
		}
		return Content{Type: typ, Text: x.GetCaption(), QuotedID: x.GetContextInfo().GetStanzaID(), Media: md}
	case m.PtvMessage != nil:
		x := m.GetPtvMessage()
		md := media(x)
		md.Seconds = int64(x.GetSeconds())
		return Content{Type: "video", QuotedID: x.GetContextInfo().GetStanzaID(), Media: md}
	case m.AudioMessage != nil:
		x := m.GetAudioMessage()
		md := media(x)
		md.Seconds = int64(x.GetSeconds())
		typ := "audio"
		if x.GetPTT() {
			typ = "voice"
		}
		return Content{Type: typ, QuotedID: x.GetContextInfo().GetStanzaID(), Media: md}
	case m.DocumentMessage != nil:
		x := m.GetDocumentMessage()
		md := media(x)
		md.Filename = x.GetFileName()
		if md.Filename == "" {
			md.Filename = x.GetTitle()
		}
		return Content{Type: "document", Text: x.GetCaption(), QuotedID: x.GetContextInfo().GetStanzaID(), Media: md}
	case m.StickerMessage != nil:
		x := m.GetStickerMessage()
		md := media(x)
		md.Width, md.Height = int64(x.GetWidth()), int64(x.GetHeight())
		return Content{Type: "sticker", QuotedID: x.GetContextInfo().GetStanzaID(), Media: md}
	case m.LocationMessage != nil:
		x := m.GetLocationMessage()
		return Content{Type: "location", Text: location(x.GetName(), x.GetAddress(), x.GetDegreesLatitude(), x.GetDegreesLongitude())}
	case m.LiveLocationMessage != nil:
		x := m.GetLiveLocationMessage()
		return Content{Type: "location", Text: location("Live location", x.GetCaption(), x.GetDegreesLatitude(), x.GetDegreesLongitude())}
	case m.ContactMessage != nil:
		return Content{Type: "contact", Text: m.GetContactMessage().GetDisplayName()}
	case m.ContactsArrayMessage != nil:
		var names []string
		for _, c := range m.GetContactsArrayMessage().GetContacts() {
			names = append(names, c.GetDisplayName())
		}
		return Content{Type: "contact", Text: strings.Join(names, ", ")}
	}
	for _, p := range []*waE2E.PollCreationMessage{m.GetPollCreationMessage(), m.GetPollCreationMessageV2(), m.GetPollCreationMessageV3(), m.GetPollCreationMessageV5()} {
		if p == nil {
			continue
		}
		lines := []string{p.GetName()}
		for _, o := range p.GetOptions() {
			lines = append(lines, "• "+o.GetOptionName())
		}
		return Content{Type: "poll", Text: strings.Join(lines, "\n"), QuotedID: p.GetContextInfo().GetStanzaID()}
	}
	if hasContent(m) {
		return Content{Type: "unsupported"}
	}
	return Content{}
}

func location(name, addr string, lat, lng float64) string {
	parts := []string{}
	for _, s := range []string{name, addr} {
		if s != "" {
			parts = append(parts, s)
		}
	}
	parts = append(parts, fmt.Sprintf("%.5f, %.5f", lat, lng))
	return strings.Join(parts, "\n")
}

// Fields that carry protocol plumbing, never something to show.
var plumbing = map[protoreflect.Name]bool{
	"senderKeyDistributionMessage": true, "messageContextInfo": true, "protocolMessage": true,
	"reactionMessage": true, "encReactionMessage": true, "pollUpdateMessage": true, "keepInChatMessage": true,
	"pinInChatMessage": true, "encEventResponseMessage": true, "secretEncryptedMessage": true,
}

func hasContent(m *waE2E.Message) bool {
	found := false
	m.ProtoReflect().Range(func(fd protoreflect.FieldDescriptor, _ protoreflect.Value) bool {
		if !plumbing[fd.Name()] {
			found = true
			return false
		}
		return true
	})
	return found
}
