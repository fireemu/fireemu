// Package fireemu provides a lightweight Go testing.TB wrapper for fireemu Test Worlds.
//
// It uses only the Go standard library and speaks the `fireemu up --ready-file ... --owner-stdin`
// readiness contract and Control REST API.
package fireemu

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const baselineSnapshot = "__fireemu_baseline__"

// Endpoint describes a bound service address.
type Endpoint struct {
	Host string
	Port int
	URL  string
}

// Options configures a fireemu Test World.
type Options struct {
	BinaryPath     string
	ProjectID      string
	Services       []string
	StartupTimeout time.Duration
	RequestTimeout time.Duration
	ExtraArgs      []string
	WorkDir        string
}

type readyDescriptor struct {
	SchemaVersion int               `json:"schemaVersion"`
	PID           int               `json:"pid"`
	ProjectID     string            `json:"projectId"`
	ControlURL    string            `json:"controlUrl"`
	ControlToken  string            `json:"controlToken"`
	HostingURL    string            `json:"hostingUrl"`
	Environment   map[string]string `json:"environment"`
}

// World owns an isolated fireemu daemon process and provides Control API helpers.
type World struct {
	ProjectID   string
	Endpoints   map[string]Endpoint
	Environment map[string]string

	controlURL   string
	controlToken string
	client       *http.Client
	cmd          *exec.Cmd
	stdin        io.WriteCloser
	dir          string
	hasBaseline  bool

	mu            sync.Mutex
	closed        bool
	checkpointSeq int
}

var endpointEnvVars = map[string]string{
	"firestore": "FIRESTORE_EMULATOR_HOST",
	"auth":      "FIREBASE_AUTH_EMULATOR_HOST",
	"storage":   "FIREBASE_STORAGE_EMULATOR_HOST",
	"functions": "FIREEMU_FUNCTIONS_HOST",
	"eventarc":  "CLOUD_EVENTARC_EMULATOR_HOST",
	"tasks":     "CLOUD_TASKS_EMULATOR_HOST",
	"pubsub":    "PUBSUB_EMULATOR_HOST",
	"database":  "FIREBASE_DATABASE_EMULATOR_HOST",
	"appcheck":  "FIREEMU_APP_CHECK_EMULATOR_HOST",
	"hub":       "FIREBASE_EMULATOR_HUB",
	"logging":   "FIREBASE_LOGGING_EMULATOR_HOST",
}

// Start launches a new fireemu Test World and registers automatic cleanup on tb.
func Start(tb testing.TB, opts Options) *World {
	tb.Helper()
	w, err := New(opts)
	if err != nil {
		tb.Fatalf("fireemu.Start: %v", err)
	}
	tb.Cleanup(func() {
		_ = w.Close()
	})
	return w
}

// New launches a new fireemu Test World without binding it to testing.TB.
func New(opts Options) (*World, error) {
	bin := opts.BinaryPath
	if bin == "" {
		found, err := exec.LookPath("fireemu")
		if err != nil {
			return nil, fmt.Errorf("fireemu binary not found on PATH: %w", err)
		}
		bin = found
	}
	projectID := opts.ProjectID
	if projectID == "" {
		projectID = "demo-fireemu"
	}
	services := opts.Services
	if len(services) == 0 {
		services = []string{"auth", "firestore", "storage"}
	}
	startupTimeout := opts.StartupTimeout
	if startupTimeout <= 0 {
		startupTimeout = 30 * time.Second
	}
	reqTimeout := opts.RequestTimeout
	if reqTimeout <= 0 {
		reqTimeout = 15 * time.Second
	}

	dir, err := os.MkdirTemp("", "fireemu-go-world-*")
	if err != nil {
		return nil, err
	}
	readyFile := filepath.Join(dir, "ready.json")
	args := []string{
		"up",
		"--project", projectID,
		"--only", strings.Join(services, ","),
		"--ready-file", readyFile,
		"--owner-stdin",
		"--log-verbosity", "quiet",
		"--firestore-port", "0",
		"--http-port", "0",
		"--storage-port", "0",
		"--functions-port", "0",
		"--eventarc-port", "0",
		"--tasks-port", "0",
		"--pubsub-port", "0",
		"--database-port", "0",
		"--logging-port", "0",
		"--hub-port", "0",
		"--ui-port", "0",
	}
	for _, s := range services {
		if s == "hosting" {
			args = append(args, "--hosting-port", "0")
			break
		}
	}
	args = append(args, opts.ExtraArgs...)

	cmd := exec.Command(bin, args...)
	cmd.Dir = opts.WorkDir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = os.RemoveAll(dir)
		return nil, err
	}

	w := &World{
		ProjectID: projectID,
		client:    &http.Client{Timeout: reqTimeout},
		cmd:       cmd,
		stdin:     stdin,
		dir:       dir,
	}

	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	deadline := time.Now().Add(startupTimeout)
	for time.Now().Before(deadline) {
		select {
		case err := <-exited:
			_ = os.RemoveAll(dir)
			return nil, fmt.Errorf("fireemu exited before ready (%v): %s", err, stderr.String())
		default:
		}
		raw, err := os.ReadFile(readyFile)
		if err == nil {
			var desc readyDescriptor
			if json.Unmarshal(raw, &desc) == nil && desc.SchemaVersion == 1 && desc.PID == cmd.Process.Pid {
				w.controlURL = strings.TrimRight(desc.ControlURL, "/")
				w.controlToken = desc.ControlToken
				w.Environment = desc.Environment
				w.Endpoints = decodeEndpoints(&desc)
				if _, err := w.Control("GET", "/health/ready", nil); err != nil {
					_ = w.Close()
					return nil, err
				}
				if _, err := w.Control("POST", "/v1/sessions/default/snapshots", map[string]any{"name": baselineSnapshot}); err == nil {
					w.hasBaseline = true
				}
				return w, nil
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	_ = w.Close()
	return nil, errors.New("fireemu test world startup timed out")
}

func parseEndpoint(raw string) Endpoint {
	target := raw
	if !strings.Contains(target, "://") {
		target = "http://" + target
	}
	u, err := url.Parse(target)
	if err != nil {
		return Endpoint{URL: raw}
	}
	port, _ := strconv.Atoi(u.Port())
	return Endpoint{Host: u.Hostname(), Port: port, URL: fmt.Sprintf("%s://%s", u.Scheme, u.Host)}
}

func decodeEndpoints(desc *readyDescriptor) map[string]Endpoint {
	out := map[string]Endpoint{"control": parseEndpoint(desc.ControlURL)}
	for svc, envKey := range endpointEnvVars {
		if val := desc.Environment[envKey]; val != "" {
			out[svc] = parseEndpoint(val)
		}
	}
	if desc.HostingURL != "" {
		out["hosting"] = parseEndpoint(desc.HostingURL)
	}
	return out
}

// Control invokes the fireemu Control REST API and decodes the JSON response.
func (w *World) Control(method, path string, body any) (map[string]any, error) {
	w.mu.Lock()
	closed := w.closed
	w.mu.Unlock()
	if closed {
		return nil, errors.New("fireemu world is closed")
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, w.controlURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+w.controlToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := w.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("control %s %s returned %d: %s", method, path, resp.StatusCode, string(raw))
	}
	if len(raw) == 0 {
		return nil, nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ResetState rewinds in-memory emulator state and virtual clock to the startup baseline.
func (w *World) ResetState() error {
	if w.hasBaseline {
		_, err := w.Control("POST", "/v1/sessions/default/snapshots/"+url.PathEscape(baselineSnapshot)+":restore", map[string]any{})
		return err
	}
	_, err := w.Control("POST", "/v1/sessions/default:reset", map[string]any{})
	return err
}

// Checkpoint captures a named in-memory snapshot (auto-named when empty) and returns its name.
func (w *World) Checkpoint(name string) (string, error) {
	if name == "" {
		w.mu.Lock()
		w.checkpointSeq++
		name = fmt.Sprintf("cp-%d", w.checkpointSeq)
		w.mu.Unlock()
	}
	if name == baselineSnapshot {
		return "", errors.New("checkpoint name is reserved")
	}
	if _, err := w.Control("POST", "/v1/sessions/default/snapshots", map[string]any{"name": name}); err != nil {
		return "", err
	}
	return name, nil
}

// Restore rewinds emulator state to a previously captured checkpoint.
func (w *World) Restore(name string) error {
	if name == "" {
		return errors.New("checkpoint name must be non-empty")
	}
	_, err := w.Control("POST", "/v1/sessions/default/snapshots/"+url.PathEscape(name)+":restore", map[string]any{})
	return err
}

// DeleteCheckpoint removes a named checkpoint to free session snapshot budget.
func (w *World) DeleteCheckpoint(name string) error {
	if name == "" || name == baselineSnapshot {
		return errors.New("checkpoint name must be non-empty and non-reserved")
	}
	_, err := w.Control("DELETE", "/v1/sessions/default/snapshots/"+url.PathEscape(name), nil)
	return err
}

// ClockGet returns the default session's current clock state.
func (w *World) ClockGet() (map[string]any, error) {
	return w.Control("GET", "/v1/sessions/default", nil)
}

// ClockAdvance advances the virtual clock by d.
func (w *World) ClockAdvance(d time.Duration) (map[string]any, error) {
	return w.Control("POST", "/v1/sessions/default/clock:advance", map[string]any{"millis": d.Milliseconds()})
}

// Close shuts down the fireemu daemon and deletes its temporary directory.
func (w *World) Close() error {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return nil
	}
	w.closed = true
	w.mu.Unlock()

	if w.stdin != nil {
		_ = w.stdin.Close()
	}
	if w.cmd != nil && w.cmd.Process != nil {
		_ = w.cmd.Process.Signal(os.Interrupt)
		done := make(chan struct{})
		go func() {
			_, _ = w.cmd.Process.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			_ = w.cmd.Process.Kill()
		}
	}
	return os.RemoveAll(w.dir)
}
