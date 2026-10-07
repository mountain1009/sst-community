package project

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Where the platform's types are, relative to the platform: compiled
// declarations in a released CLI, and the source in a build without them.
func platformTypes(platformDir string) string {
	if _, err := os.Stat(filepath.Join(platformDir, "dist", "types", "global.d.ts")); err == nil {
		return "dist/types"
	}
	return "src"
}

// Writes .sst/tsconfig.json, for an app, or the repo of a component package,
// to extend. It tells TypeScript where `sst/components`, `sst/testing` and the
// providers are: they're installed in .sst/platform, where TypeScript doesn't
// look for them.
func (p *Project) writeTsconfig() error {
	platformDir := p.PathPlatformDir()
	types := "./platform/" + platformTypes(platformDir)
	paths := map[string][]string{
		"sst/components": {types + "/components/index"},
		"sst/testing":    {types + "/testing/index"},
	}
	for _, scope := range []string{"@pulumi", "@pulumiverse", "@sst-provider"} {
		entries, err := os.ReadDir(filepath.Join(platformDir, "node_modules", scope))
		if err != nil {
			continue
		}
		for _, entry := range entries {
			name := scope + "/" + entry.Name()
			dir := "./platform/node_modules/" + name
			paths[name] = []string{dir}
			paths[name+"/*"] = []string{dir + "/*"}
		}
	}
	data, err := json.MarshalIndent(map[string]any{
		"compilerOptions": map[string]any{"paths": paths},
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(p.PathWorkingDir(), "tsconfig.json"), append(data, '\n'), 0644)
}
