//go:build !windows

package tunnel

import (
	"os"
	"path/filepath"
	"testing"
)

func fakeBinary(t *testing.T, output string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "tunnel")
	script := "#!/bin/sh\necho '" + output + "'\n"
	if err := os.WriteFile(path, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	original := BINARY_PATH
	BINARY_PATH = path
	t.Cleanup(func() { BINARY_PATH = original })
}

func TestNeedsInstallMissingBinary(t *testing.T) {
	original := BINARY_PATH
	BINARY_PATH = filepath.Join(t.TempDir(), "missing")
	t.Cleanup(func() { BINARY_PATH = original })
	if !NeedsInstall("4.21.0") {
		t.Fatal("no binary installed, want true")
	}
}

func TestNeedsInstallSameVersion(t *testing.T) {
	fakeBinary(t, "sst 4.21.0 (sst-community, built on SST 4.17.2)")
	if NeedsInstall("4.21.0") {
		t.Fatal("same version installed, want false")
	}
}

func TestNeedsInstallOtherVersion(t *testing.T) {
	fakeBinary(t, "sst 4.20.0 (sst-community)")
	if !NeedsInstall("4.21.0") {
		t.Fatal("older version installed, want true")
	}
}

func TestNeedsInstallBinaryDoesNotRun(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tunnel")
	if err := os.WriteFile(path, []byte("not a program"), 0755); err != nil {
		t.Fatal(err)
	}
	original := BINARY_PATH
	BINARY_PATH = path
	t.Cleanup(func() { BINARY_PATH = original })
	if !NeedsInstall("4.21.0") {
		t.Fatal("binary can't report a version, want true")
	}
}
