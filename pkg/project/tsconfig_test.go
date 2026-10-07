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
		"sst/components":      {"./platform/dist/types/components/index"},
		"sst/testing":         {"./platform/dist/types/testing/index"},
		"@pulumi/pulumi":      {"./platform/node_modules/@pulumi/pulumi"},
		"@pulumi/pulumi/*":    {"./platform/node_modules/@pulumi/pulumi/*"},
		"@pulumi/aws":         {"./platform/node_modules/@pulumi/aws"},
		"@pulumi/aws/*":       {"./platform/node_modules/@pulumi/aws/*"},
		"@pulumiverse/vercel": {"./platform/node_modules/@pulumiverse/vercel"},
		"@pulumiverse/vercel/*": {
			"./platform/node_modules/@pulumiverse/vercel/*",
		},
	}, config.CompilerOptions.Paths)
}

// A CLI built without the compiled types points at the platform's source.
func TestPlatformTypesWithoutCompiledTypes(t *testing.T) {
	assert.Equal(t, "src", platformTypes(t.TempDir()))
}
