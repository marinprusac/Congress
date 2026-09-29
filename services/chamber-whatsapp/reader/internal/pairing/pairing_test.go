package pairing

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"congress/wa-reader/internal/waclient"
)

type fakeClient struct {
	paired      bool
	connects    atomic.Int32
	disconnects atomic.Int32
	items       chan waclient.QRItem
}

func (f *fakeClient) IsPaired() bool { return f.paired }
func (f *fakeClient) Connect() error  { f.connects.Add(1); return nil }
func (f *fakeClient) Disconnect()     { f.disconnects.Add(1) }
func (f *fakeClient) QRChannel(context.Context) (<-chan waclient.QRItem, error) {
	f.items = make(chan waclient.QRItem)
	return f.items, nil
}

func waitFor(t *testing.T, p *Pairing, state string) Snapshot {
	t.Helper()
	for i := 0; i < 200; i++ {
		if s := p.Snapshot(); s.State == state {
			return s
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("never reached %q (at %+v)", state, p.Snapshot())
	return Snapshot{}
}

func TestPairingShowsRotatingCodeThenSucceeds(t *testing.T) {
	f := &fakeClient{}
	succeeded := make(chan struct{})
	p := New(f, func() { close(succeeded) })
	if err := p.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := p.Start(context.Background()); err != nil || f.connects.Load() != 1 {
		t.Fatalf("second Start should reuse the running session: %v, %d connects", err, f.connects.Load())
	}
	f.items <- waclient.QRItem{Event: "code", Code: "2@abc,def,ghi", Timeout: 20 * time.Second}
	var s Snapshot
	for i := 0; i < 200 && len(s.QR) == 0; i++ {
		s = p.Snapshot()
		time.Sleep(5 * time.Millisecond)
	}
	if s.State != "waiting" || len(s.QR) < 21 || len(s.QR[0]) != len(s.QR) || s.ExpiresAt == 0 {
		t.Fatalf("%+v", s)
	}
	f.items <- waclient.QRItem{Event: "success"}
	<-succeeded
	if s := waitFor(t, p, "success"); len(s.QR) != 0 {
		t.Fatalf("QR still shown after success: %+v", s)
	}
	if f.disconnects.Load() != 0 {
		t.Fatal("must stay connected after pairing")
	}
}

func TestPairingExpiresAndCanRestart(t *testing.T) {
	f := &fakeClient{}
	p := New(f, nil)
	_ = p.Start(context.Background())
	f.items <- waclient.QRItem{Event: "timeout"}
	waitFor(t, p, "expired")
	if f.disconnects.Load() != 1 {
		t.Fatalf("%d disconnects", f.disconnects.Load())
	}
	if err := p.Start(context.Background()); err != nil || f.connects.Load() != 2 {
		t.Fatalf("restart: %v, %d connects", err, f.connects.Load())
	}
	waitFor(t, p, "waiting")
}

func TestPairingRefusedWhenPaired(t *testing.T) {
	p := New(&fakeClient{paired: true}, nil)
	if err := p.Start(context.Background()); err != ErrAlreadyPaired {
		t.Fatalf("%v", err)
	}
}
