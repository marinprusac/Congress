// wa-reader: a read-only WhatsApp companion device for Congress.
//
//	wa-reader login            pair once (QR in the terminal), then exit
//	wa-reader serve [-offline] run the daemon; -offline serves the API without connecting
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/mdp/qrterminal/v3"
	"go.mau.fi/whatsmeow/types/events"

	"congress/wa-reader/internal/api"
	"congress/wa-reader/internal/config"
	"congress/wa-reader/internal/ingest"
	"congress/wa-reader/internal/pairing"
	"congress/wa-reader/internal/store"
	"congress/wa-reader/internal/waclient"
)

func main() {
	syscall.Umask(0o077) // every file we create (DBs, WAL, lock) is owner-only
	if len(os.Args) < 2 {
		usage()
	}
	cfg, err := config.Load()
	if err != nil {
		fatal(err)
	}
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slogLevel(cfg.LogLevel)}))
	switch os.Args[1] {
	case "login":
		err = login(cfg, log)
	case "serve":
		fs := flag.NewFlagSet("serve", flag.ExitOnError)
		offline := fs.Bool("offline", false, "serve the API from the messages DB without connecting to WhatsApp")
		_ = fs.Parse(os.Args[2:])
		err = serve(cfg, log, *offline)
	default:
		usage()
	}
	if err != nil {
		fatal(err)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: wa-reader login | serve [-offline]")
	os.Exit(2)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "wa-reader:", err)
	os.Exit(1)
}

func slogLevel(s string) slog.Level {
	switch s {
	case "DEBUG":
		return slog.LevelDebug
	case "WARN":
		return slog.LevelWarn
	case "ERROR":
		return slog.LevelError
	}
	return slog.LevelInfo
}

// lock ensures one process per session: two would fight over it (StreamReplaced).
func lock(cfg config.Config) (func(), error) {
	path := filepath.Join(filepath.Dir(cfg.SessionDB), "wa-reader.lock")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, errors.New("another wa-reader is already using this session (stop the service first)")
		}
		return nil, fmt.Errorf("lock %s: %w", path, err)
	}
	return func() { f.Close() }, nil
}

func openReader(ctx context.Context, cfg config.Config) (waclient.Reader, func() error, error) {
	return waclient.Open(ctx, waclient.Options{
		SessionDB: cfg.SessionDB, DeviceName: cfg.DeviceName, FullHistory: cfg.FullHistory, LogLevel: cfg.LogLevel,
	})
}

func login(cfg config.Config, log *slog.Logger) error {
	unlock, err := lock(cfg)
	if err != nil {
		return err
	}
	defer unlock()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	reader, closeSession, err := openReader(ctx, cfg)
	if err != nil {
		return err
	}
	defer closeSession()
	if reader.IsPaired() {
		fmt.Printf("Already paired as %s. To re-pair, unlink it on the phone and delete %s.\n", reader.OwnJID(), cfg.SessionDB)
		return nil
	}
	st, err := store.Open(cfg.MessagesDB)
	if err != nil {
		return err
	}
	defer st.Close()

	// Keep what arrives right after pairing (the first history sync).
	h := ingest.NewHandler(st, reader, log, ingest.NewStatus("pairing"))
	reader.AddEventHandler(h.Handle)
	activity := make(chan struct{}, 1)
	reader.AddEventHandler(func(evt any) {
		switch evt.(type) {
		case *events.HistorySync, *events.Connected:
			select {
			case activity <- struct{}{}:
			default:
			}
		}
	})

	qr, err := reader.QRChannel(ctx)
	if err != nil {
		return err
	}
	if err := reader.Connect(); err != nil {
		return err
	}
	defer reader.Disconnect()
	for item := range qr {
		switch item.Event {
		case "code":
			fmt.Println("\nScan with WhatsApp → Settings → Linked devices → Link a device:")
			qrterminal.GenerateHalfBlock(item.Code, qrterminal.L, os.Stdout)
			fmt.Printf("(code refreshes in %s)\n", item.Timeout.Round(time.Second))
		case "success":
			fmt.Println("Paired. Receiving the initial history; this can take a minute…")
			settle(ctx, activity)
			fmt.Printf("Done: linked as %s. Now start the service: sudo systemctl start congress-wa-reader\n", reader.OwnJID())
			return nil
		case "timeout":
			return errors.New("QR code expired; run login again")
		default:
			if item.Err != nil {
				return fmt.Errorf("pairing failed: %w", item.Err)
			}
			return fmt.Errorf("pairing failed: %s", item.Event)
		}
	}
	return errors.New("pairing ended without success")
}

// settle waits until history sync has been quiet for 20s (at most 3 minutes).
func settle(ctx context.Context, activity <-chan struct{}) {
	deadline := time.After(3 * time.Minute)
	for {
		select {
		case <-activity:
		case <-time.After(20 * time.Second):
			return
		case <-deadline:
			return
		case <-ctx.Done():
			return
		}
	}
}

// Terminal states: reconnecting would make things worse, so we stay down
// (API still up, Congress shows the state) until the owner intervenes.
var terminal = map[string]bool{"stream_replaced": true, "logged_out": true, "client_outdated": true, "temporary_ban": true}

func serve(cfg config.Config, log *slog.Logger, offline bool) error {
	unlock, err := lock(cfg)
	if err != nil {
		return err
	}
	defer unlock()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(cfg.MessagesDB)
	if err != nil {
		return err
	}
	defer st.Close()
	status := ingest.NewStatus("starting")
	srv := &api.Server{Store: st, MaxMedia: cfg.MediaMaxBytes, Log: log}
	var reader waclient.Reader

	if offline {
		status.Set("offline", "API-only mode, not connected to WhatsApp")
		h := ingest.NewHandler(st, nil, log, status)
		h.Restore(ctx)
	} else {
		var closeSession func() error
		reader, closeSession, err = openReader(ctx, cfg)
		if err != nil {
			return err
		}
		defer closeSession()
		srv.Media = reader
		srv.Ctx = ctx
		srv.Pairing = pairing.New(reader, func() {
			status.Set("connecting", "linked; receiving history")
			log.Info("paired", "jid", reader.OwnJID())
		})
		h := ingest.NewHandler(st, reader, log, status)
		h.Restore(ctx)
		reader.AddEventHandler(h.Handle)
		reader.AddEventHandler(connectionEvents(reader, status, log))
		go h.RunGroupLookups(ctx)
		if !reader.IsPaired() {
			status.Set("not_paired", "link it from Congress's WhatsApp screen")
			log.Warn("not paired: link it from Congress's WhatsApp screen (or `wa-reader login` with the service stopped)")
		} else {
			status.Set("connecting", "")
			if err := reader.Connect(); err != nil {
				// Auto-reconnect only covers drops after a successful connect.
				log.Error("connect", "err", err)
				status.Set("disconnected", err.Error())
				go retryConnect(ctx, reader, status, log)
			}
		}
	}

	srv.Status = func() any {
		snap := status.Snapshot()
		out := map[string]any{"state": snap.State, "since": snap.Since, "detail": snap.Detail,
			"lastEventAt": snap.LastEventAt, "lastPhoneAt": snap.LastPhoneAt, "mediaMaxBytes": cfg.MediaMaxBytes}
		if reader != nil {
			out["paired"] = reader.IsPaired()
			if reader.IsPaired() {
				out["ownJid"] = reader.OwnJID().String()
			}
		}
		return out
	}
	ln, err := listen(cfg)
	if err != nil {
		return err
	}
	httpSrv := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("api", "err", err)
			stop()
		}
	}()
	log.Info("serving", "socket", cfg.Socket, "offline", offline)
	heartbeat(ctx, status, log)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
	if reader != nil {
		reader.Disconnect()
	}
	_ = os.Remove(cfg.Socket)
	return nil
}

func listen(cfg config.Config) (net.Listener, error) {
	_ = os.Remove(cfg.Socket) // stale socket from a previous run; the lock rules out a live one
	ln, err := net.Listen("unix", cfg.Socket)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(cfg.Socket, cfg.SocketMode); err != nil {
		ln.Close()
		return nil, err
	}
	return ln, nil
}

func connectionEvents(reader waclient.Reader, status *ingest.Status, log *slog.Logger) func(any) {
	set := func(state, detail string) {
		if terminal[status.State()] {
			return
		}
		status.Set(state, detail)
	}
	return func(evt any) {
		switch e := evt.(type) {
		case *events.Connected:
			set("connected", "")
			log.Info("connected")
		case *events.Disconnected:
			set("disconnected", "reconnecting automatically")
			log.Warn("disconnected")
		case *events.KeepAliveTimeout:
			log.Warn("keepalive timeout", "errors", e.ErrorCount, "lastSuccess", e.LastSuccess)
		case *events.StreamReplaced:
			set("stream_replaced", "another client took over this session; restart the service once it's gone")
			log.Error("stream replaced: another process is using this session; not reconnecting")
			go reader.Disconnect()
		case *events.LoggedOut:
			set("logged_out", fmt.Sprintf("unlinked (reason %v); restarting so it can be linked again", e.Reason))
			log.Error("logged out; exiting so systemd restarts with a fresh session", "reason", e.Reason, "onConnect", e.OnConnect)
			// whatsmeow has deleted the device; a new process starts unpaired and pairable.
			go func() {
				time.Sleep(5 * time.Second)
				os.Exit(3)
			}()
		case *events.ClientOutdated:
			set("client_outdated", "WhatsApp rejected this client version; update whatsmeow and redeploy")
			log.Error("client outdated: update go.mau.fi/whatsmeow")
			go reader.Disconnect()
		case *events.TemporaryBan:
			set("temporary_ban", e.String())
			log.Error("temporary ban", "detail", e.String())
			go reader.Disconnect()
		case *events.ConnectFailure:
			log.Error("connect failure", "reason", e.Reason, "message", e.Message)
		}
	}
}

// retryConnect backs off (1m doubling to 1h) until an initial connect succeeds.
func retryConnect(ctx context.Context, reader waclient.Reader, status *ingest.Status, log *slog.Logger) {
	wait := time.Minute
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		if terminal[status.State()] || reader.IsConnected() {
			return
		}
		if err := reader.Connect(); err == nil {
			return
		} else {
			log.Error("connect retry", "err", err, "next", wait*2)
		}
		wait = min(wait*2, time.Hour)
	}
}

const phoneWarnAfter = 12 * 24 * time.Hour

// heartbeat logs the state every 10 minutes until ctx ends.
func heartbeat(ctx context.Context, status *ingest.Status, log *slog.Logger) {
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		s := status.Snapshot()
		attrs := []any{"state", s.State, "lastEvent", fmtMs(s.LastEventAt), "lastPhone", fmtMs(s.LastPhoneAt)}
		if s.LastPhoneAt > 0 && time.Since(time.UnixMilli(s.LastPhoneAt)) > phoneWarnAfter {
			log.Warn("phone has not been seen for 12+ days; open WhatsApp on it or this device will be unlinked", attrs...)
		} else {
			log.Info("heartbeat", attrs...)
		}
	}
}

func fmtMs(ms int64) string {
	if ms == 0 {
		return "never"
	}
	return time.UnixMilli(ms).Format(time.RFC3339)
}
