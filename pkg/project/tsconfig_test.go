package project

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWriteTsconfig(t *testing.T) {
	dir := t.TempDir()
	platform := filepath.Join(dir, ".sst", "platform")
	for _, d := range []string{
		"dist/types",
		"node_modules/@pulumi/pulumi",
		"node_modules/@pulumi/aws",
		"node_modules/@pulumiverse/vercel",
	} {
		require.NoError(t, os.MkdirAll(filepath.Join(platform, d), 0755))
	}
	require.NoError(t, os.WriteFile(filepath.Join(platform, "dist/types/global.d.ts"), nil, 0644))

	p := &Project{root: dir}
	require.NoError(t, p.writeTsconfig())

	data, err := os.ReadFile(filepath.Join(dir, ".sst", "tsconfig.json"))
	require.NoError(t, err)
	var config struct {
		CompilerOptions struct {
			Paths map[string][]string `json:"paths"`
		} `json:"compilerOptions"`
	}
	require.NoError(t, json.Unmarshal(data, &config))
	assert.Equal(t, map[string][]string{
		"sst/components":            {"./platform/dist/types/components/core"},
		"sst/components/aws":        {"./platform/dist/types/components/aws/index"},
		"sst/components/cloudflare": {"./platform/dist/types/components/cloudflare/index"},
		"sst/components/vercel":     {"./platform/dist/types/components/vercel/index"},
		"sst/testing":               {"./platform/dist/types/testing/index"},
		"@pulumi/pulumi":            {"./platform/node_modules/@pulumi/pulumi"},
		"@pulumi/pulumi/*":          {"./platform/node_modules/@pulumi/pulumi/*"},
		"@pulumi/aws":               {"./platform/node_modules/@pulumi/aws"},
		"@pulumi/aws/*":             {"./platform/node_modules/@pulumi/aws/*"},
		"@pulumiverse/vercel":       {"./platform/node_modules/@pulumiverse/vercel"},
		"@pulumiverse/vercel/*": {
			"./platform/node_modules/@pulumiverse/vercel/*",
		},
	}, config.CompilerOptions.Paths)
}

// A package the config lists is where `sst install` puts it, in the platform
func TestWriteTsconfigWithPackages(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, ".sst", "platform"), 0755))
	p := &Project{root: dir, app: &App{Packages: map[string]string{"@acme/email": "1.2.0"}}}
	require.NoError(t, p.writeTsconfig())

	data, err := os.ReadFile(filepath.Join(dir, ".sst", "tsconfig.json"))
	require.NoError(t, err)
	var config struct {
		CompilerOptions struct {
			Paths map[string][]string `json:"paths"`
		} `json:"compilerOptions"`
	}
	require.NoError(t, json.Unmarshal(data, &config))
	assert.Equal(t, []string{"./platform/node_modules/@acme/email"}, config.CompilerOptions.Paths["@acme/email"])
	assert.Equal(t, []string{"./platform/node_modules/@acme/email/*"}, config.CompilerOptions.Paths["@acme/email/*"])
}

// A CLI built without the compiled types points at the platform's source.
func TestPlatformTypesWithoutCompiledTypes(t *testing.T) {
	assert.Equal(t, "src", platformTypes(t.TempDir()))
}
