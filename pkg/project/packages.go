package project

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"github.com/Masterminds/semver/v3"
	"github.com/sst/sst/v3/pkg/js"
)

// A component package says in its package.json, as peer dependencies, which
// versions of SST it works with and which providers it uses. Each package in
// the build that imports `sst/components` is checked against the CLI and the
// app's providers before the app runs. Otherwise a missing provider is still
// found, as the platform depends on some providers itself, and its resources
// are created with a provider the app hasn't configured.
func checkPackages(meta js.Metafile, version string, lock ProviderLock) error {
	problems := []string{}
	for _, dir := range componentPackages(meta) {
		data, err := os.ReadFile(filepath.Join(dir, "package.json"))
		if err != nil {
			continue
		}
		var pkg struct {
			Name             string            `json:"name"`
			PeerDependencies map[string]string `json:"peerDependencies"`
		}
		if err := json.Unmarshal(data, &pkg); err != nil {
			continue
		}
		for _, dependency := range sortedKeys(pkg.PeerDependencies) {
			needed := pkg.PeerDependencies[dependency]
			if dependency == "sst" {
				if !satisfies(version, needed) {
					problems = append(problems, fmt.Sprintf(`"%s" needs sst %s, and this is %s.`, pkg.Name, needed, version))
				}
				continue
			}
			if !isProviderPackage(dependency) {
				continue
			}
			index := slices.IndexFunc(lock, func(entry *ProviderLockEntry) bool { return entry.Package == dependency })
			if index == -1 {
				name := dependency[strings.LastIndex(dependency, "/")+1:]
				problems = append(problems, fmt.Sprintf(`"%s" needs the %s provider. Add it with "sst add %s".`, pkg.Name, name, name))
				continue
			}
			if !satisfies(lock[index].Version, needed) {
				problems = append(problems, fmt.Sprintf(`"%s" needs %s %s, and the app has %s.`, pkg.Name, dependency, needed, lock[index].Version))
			}
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf("%s", strings.Join(problems, "\n"))
	}
	return nil
}

// The directories of the packages in the build that import the platform's
// modules, like `sst/components`
func componentPackages(meta js.Metafile) []string {
	found := map[string]bool{}
	for file, input := range meta.Inputs {
		imports := slices.ContainsFunc(input.Imports, func(i js.MetafileImport) bool {
			return slices.Contains(js.PlatformModules, i.Original)
		})
		if !imports {
			continue
		}
		if dir := packageDir(file); dir != "" {
			found[dir] = true
		}
	}
	return sortedKeys(found)
}

// The directory of the package in node_modules that a file is in
func packageDir(file string) string {
	file = filepath.ToSlash(file)
	index := strings.LastIndex(file, "node_modules/")
	if index == -1 {
		return ""
	}
	rest := strings.Split(file[index+len("node_modules/"):], "/")
	name := rest[0]
	if strings.HasPrefix(name, "@") && len(rest) > 1 {
		name += "/" + rest[1]
	}
	dir, err := filepath.Abs(filepath.FromSlash(file[:index] + "node_modules/" + name))
	if err != nil {
		return ""
	}
	return dir
}

func isProviderPackage(name string) bool {
	if name == "@pulumi/pulumi" {
		return false
	}
	for _, scope := range []string{"@pulumi/", "@pulumiverse/", "@sst-provider/"} {
		if strings.HasPrefix(name, scope) {
			return true
		}
	}
	return false
}

// Whether a version is in a range. A dev build, or a range that isn't one,
// isn't checked.
func satisfies(version string, needed string) bool {
	if version == "" || version == "dev" {
		return true
	}
	constraint, err := semver.NewConstraint(needed)
	if err != nil {
		return true
	}
	v, err := semver.NewVersion(version)
	if err != nil {
		return true
	}
	return constraint.Check(v)
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
