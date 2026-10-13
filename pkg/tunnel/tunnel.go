package tunnel

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/xjasonlyu/tun2socks/v2/engine"

	"github.com/sst/sst/v3/pkg/process"
)

func IsRunning() bool {
	return impl.isRunning()
}

// Platform-specific interface
type tunnelPlatform interface {
	destroy() error
	start(routes ...string) error
	install() error
	isRunning() bool
}

var impl tunnelPlatform

var BINARY_PATH = "/opt/sst/tunnel"

// NeedsInstall tells whether the root copy of the CLI is missing or is another
// version than this one. The tunnel runs from that copy, so a fix to it only
// reaches users who install again.
func NeedsInstall(version string) bool {
	if _, err := os.Stat(BINARY_PATH); err != nil {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, BINARY_PATH, "version").Output()
	if err != nil {
		return true
	}
	// "sst <version>" or "sst <version> (<distribution>)"
	fields := strings.Fields(strings.SplitN(string(out), "\n", 2)[0])
	if len(fields) < 2 {
		return true
	}
	return fields[1] != version
}

func Install() error {
	return impl.install()
}

func runCommands(cmds [][]string) error {
	for _, item := range cmds {
		slog.Info("running command", "command", item)
		cmd := process.Command(item[0], item[1:]...)
		err := cmd.Run()
		if err != nil {
			slog.Error("failed to execute command", "command", item, "error", err)
			return fmt.Errorf("failed to execute command '%v': %v", item, err)
		}
	}
	return nil
}

func Start(routes ...string) error {
	return impl.start(routes...)
}

func tun2socks(name string) {
	key := new(engine.Key)
	key.Device = name
	key.Proxy = "socks5://127.0.0.1:1080"
	engine.Insert(key)
	engine.Start()
}

func Stop() {
	engine.Stop()
	impl.destroy()
}
