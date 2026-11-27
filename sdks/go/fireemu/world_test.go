package fireemu_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fireemu/fireemu/sdks/go/fireemu"
)

func testBinary(t *testing.T) string {
	t.Helper()
	if env := os.Getenv("FIREEMU_TEST_BINARY"); env != "" {
		return env
	}
	candidate, err := filepath.Abs(filepath.Join("..", "..", "..", "target", "debug", "fireemu"))
	if err != nil {
		t.Skip("cannot locate debug binary")
	}
	if _, err := os.Stat(candidate); err != nil {
		t.Skipf("fireemu debug binary not built at %s", candidate)
	}
	return candidate
}

func TestWorldStateRewindAndCheckpoints(t *testing.T) {
	bin := testBinary(t)
	world := fireemu.Start(t, fireemu.Options{
		BinaryPath: bin,
		Services:   []string{"firestore", "pubsub", "appcheck"},
	})
	if world.Endpoints["firestore"].Port == 0 {
		t.Fatalf("expected firestore endpoint port")
	}
	if world.Endpoints["appcheck"].Port == 0 {
		t.Fatalf("expected appcheck endpoint port")
	}

	clockOf := func() string {
		t.Helper()
		resp, err := world.ClockGet()
		if err != nil {
			t.Fatalf("ClockGet: %v", err)
		}
		clockObj := resp["clock"].(map[string]any)
		return clockObj["clock"].(string)
	}

	if _, err := world.Control("POST", "/v1/sessions/default/clock:freeze", map[string]any{}); err != nil {
		t.Fatalf("clock:freeze: %v", err)
	}
	if _, err := world.Control("POST", "/v1/sessions/default/clock:set", map[string]any{"instant": "2026-06-01T00:00:00Z", "allowBackwards": true}); err != nil {
		t.Fatalf("clock:set: %v", err)
	}
	baseCP, err := world.Checkpoint("base")
	if err != nil {
		t.Fatalf("Checkpoint base: %v", err)
	}
	baseClock := clockOf()
	if _, err := world.ClockAdvance(15 * time.Second); err != nil {
		t.Fatalf("ClockAdvance: %v", err)
	}
	cp, err := world.Checkpoint("")
	if err != nil {
		t.Fatalf("Checkpoint: %v", err)
	}
	cpClock := clockOf()
	if cpClock == baseClock {
		t.Fatalf("expected clock to advance past %s", baseClock)
	}

	if _, err := world.ClockAdvance(30 * time.Second); err != nil {
		t.Fatalf("ClockAdvance 2: %v", err)
	}
	if err := world.Restore(cp); err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if got := clockOf(); got != cpClock {
		t.Fatalf("expected restored clock %s, got %s", cpClock, got)
	}

	if err := world.DeleteCheckpoint(cp); err != nil {
		t.Fatalf("DeleteCheckpoint: %v", err)
	}
	if err := world.Restore(baseCP); err != nil {
		t.Fatalf("Restore base: %v", err)
	}
	if got := clockOf(); got != baseClock {
		t.Fatalf("expected base clock %s, got %s", baseClock, got)
	}
	if err := world.ResetState(); err != nil {
		t.Fatalf("ResetState: %v", err)
	}
}
