// Enforces wa-reader's read-only rule at the source level.
package readonly_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

const whatsmeowRoot = `"go.mau.fi/whatsmeow"`

// The only *whatsmeow.Client members internal/waclient may touch.
var allowedClientMembers = map[string]bool{
	"Connect": true, "Disconnect": true, "IsConnected": true, "Store": true, "AddEventHandler": true,
	"GetQRChannel": true, "DownloadMediaWithPath": true, "GetGroupInfo": true, "ParseWebMessage": true,
	"EnableAutoReconnect": true, "AutomaticMessageRerequestFromPhone": true,
}

func goFiles(t *testing.T) map[string]string {
	t.Helper()
	files := map[string]string{}
	err := filepath.WalkDir(".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == "bin" || strings.HasPrefix(d.Name(), ".")) && path != "." {
			return filepath.SkipDir
		}
		if !d.IsDir() && strings.HasSuffix(path, ".go") && path != "readonly_test.go" {
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			files[filepath.ToSlash(path)] = string(b)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no Go files found")
	}
	return files
}

func denylist(t *testing.T) []string {
	t.Helper()
	b, err := os.ReadFile("readonly-denylist.txt")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, l := range strings.Split(string(b), "\n") {
		if l = strings.TrimSpace(l); l != "" && !strings.HasPrefix(l, "#") {
			names = append(names, l)
		}
	}
	return names
}

func TestNoForbiddenWhatsmeowCalls(t *testing.T) {
	re := regexp.MustCompile(`\.(` + strings.Join(denylist(t), "|") + `)\b`)
	for path, src := range goFiles(t) {
		for i, line := range strings.Split(src, "\n") {
			if m := re.FindString(line); m != "" {
				t.Errorf("%s:%d references forbidden %s", path, i+1, m)
			}
		}
	}
}

func TestOnlyWaclientImportsWhatsmeowClient(t *testing.T) {
	for path, src := range goFiles(t) {
		if strings.Contains(src, whatsmeowRoot) && !strings.HasPrefix(path, "internal/waclient/") {
			t.Errorf("%s imports %s; only internal/waclient may", path, whatsmeowRoot)
		}
	}
}

func TestWaclientUsesOnlyAllowedClientMembers(t *testing.T) {
	re := regexp.MustCompile(`\bcli\.([A-Za-z]+)`)
	var bad []string
	for path, src := range goFiles(t) {
		if !strings.HasPrefix(path, "internal/waclient/") {
			continue
		}
		for _, m := range re.FindAllStringSubmatch(src, -1) {
			if !allowedClientMembers[m[1]] {
				bad = append(bad, path+": cli."+m[1])
			}
		}
	}
	sort.Strings(bad)
	for _, b := range bad {
		t.Errorf("not on the read-only allowlist: %s", b)
	}
}
