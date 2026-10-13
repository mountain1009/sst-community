package project

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/sst/sst/v3/pkg/js"
)

// Where the platform's types are, relative to the platform: compiled
// declarations in a released CLI, and the source in a build without them.
func platformTypes(platformDir string) string {
	if _, err := os.Stat(filepath.Join(platformDir, "dist", "types", "global.d.ts")); err == nil {
		return "dist/types"
	}
	return "src"
}

// Where each module a package imports from the app's platform is
// (js.PlatformModules), in the platform's components folder and without an
// extension: `sst/components` is what SST's components share, and each group,
// like `sst/components/aws`, is the components of a provider.
func platformModuleFiles() map[string]string {
	files := map[string]string{}
	for _, module := range js.PlatformModules {
		if group, ok := strings.CutPrefix(module, "sst/components/"); ok {
			files[module] = group + "/index"
			continue
		}
		files[module] = "core"
	}
	return files
}

// Writes .sst/tsconfig.json, for an app, or the repo of a component package,
// to extend. It tells TypeScript where `sst/components` and its groups,
// `sst/testing` and the providers are: they're installed in .sst/platform,
// where TypeScript doesn't look for them.
func (p *Project) writeTsconfig() error {
	platformDir := p.PathPlatformDir()
	types := "./platform/" + platformTypes(platformDir)
	paths := map[string][]string{
		"sst/testing": {types + "/testing/index"},
	}
	for module, file := range platformModuleFiles() {
		paths[module] = []string{types + "/components/" + file}
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
