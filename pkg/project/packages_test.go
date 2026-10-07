package project

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/sst/sst/v3/pkg/js"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Builds an app that uses a component package, and a package that isn't one
func buildWithPackages(t *testing.T) js.Metafile {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		".sst/platform/src/components/index.ts": `export function component() {}`,
		"node_modules/@acme/email/package.json": `{
			"name": "@acme/email",
			"type": "module",
			"main": "index.mjs",
			"peerDependencies": {
				"sst": ">=5.0.0-0",
				"@pulumi/aws": "^7",
				"@pulumi/cloudflare": "^6",
				"@pulumi/pulumi": "^3"
			}
		}`,
		"node_modules/@acme/email/index.mjs": `
import { component } from "sst/components";
import * as aws from "@pulumi/aws";
import * as cloudflare from "@pulumi/cloudflare";
export const parts = { identity: aws.ses.DomainIdentity, record: cloudflare.DnsRecord, component };
`,
		"node_modules/other/package.json": `{"name":"other","type":"module","main":"index.mjs","peerDependencies":{"@pulumi/gcp":"^8"}}`,
		"node_modules/other/index.mjs":    `export const other = 1;`,
	}
	for name, contents := range files {
		path := filepath.Join(dir, name)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0755))
		require.NoError(t, os.WriteFile(path, []byte(contents), 0644))
	}
	result, err := js.Build(js.EvalOptions{
		Dir:      dir,
		Globals:  []js.Global{{Name: "sst", Module: filepath.Join(dir, ".sst/platform/src/components")}},
		Platform: map[string]string{"sst/components": filepath.Join(dir, ".sst/platform/src/components/index.ts")},
		Code:     `import "@acme/email"; import "other";`,
	})
	require.NoError(t, err)
	js.Cleanup(result)
	var meta js.Metafile
	require.NoError(t, json.Unmarshal([]byte(result.Metafile), &meta))
	return meta
}

func TestCheckPackages(t *testing.T) {
	meta := buildWithPackages(t)
	aws := &ProviderLockEntry{Name: "aws", Package: "@pulumi/aws", Version: "7.48.0"}

	t.Run("a provider the app doesn't have", func(t *testing.T) {
		err := checkPackages(meta, "5.0.0", ProviderLock{aws})
		require.Error(t, err)
		assert.Equal(t, `"@acme/email" needs the cloudflare provider. Add it with "sst add cloudflare".`, err.Error())
	})

	t.Run("a provider's version the package doesn't work with", func(t *testing.T) {
		cloudflare := &ProviderLockEntry{Name: "cloudflare", Package: "@pulumi/cloudflare", Version: "5.40.0"}
		err := checkPackages(meta, "5.0.0", ProviderLock{aws, cloudflare})
		require.Error(t, err)
		assert.Equal(t, `"@acme/email" needs @pulumi/cloudflare ^6, and the app has 5.40.0.`, err.Error())
	})

	t.Run("a version of SST the package doesn't work with", func(t *testing.T) {
		cloudflare := &ProviderLockEntry{Name: "cloudflare", Package: "@pulumi/cloudflare", Version: "6.15.0"}
		err := checkPackages(meta, "4.17.3", ProviderLock{aws, cloudflare})
		require.Error(t, err)
		assert.Equal(t, `"@acme/email" needs sst >=5.0.0-0, and this is 4.17.3.`, err.Error())
	})

	t.Run("everything it needs", func(t *testing.T) {
		cloudflare := &ProviderLockEntry{Name: "cloudflare", Package: "@pulumi/cloudflare", Version: "6.15.0"}
		assert.NoError(t, checkPackages(meta, "5.0.0-alpha.1", ProviderLock{aws, cloudflare}))
		// A dev build isn't checked against the package's range
		assert.NoError(t, checkPackages(meta, "dev", ProviderLock{aws, cloudflare}))
	})
}
