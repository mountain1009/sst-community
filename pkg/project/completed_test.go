package project

import (
	"testing"

	"github.com/pulumi/pulumi/sdk/v3/go/common/tokens"
	"github.com/stretchr/testify/assert"
)

func TestTypePackage(t *testing.T) {
	assert.Equal(t, "sst", typePackage(tokens.Type("sst:aws:Function")))
	assert.Equal(t, "sst", typePackage(tokens.Type("sst:sst:Version")))
	assert.Equal(t, "aws", typePackage(tokens.Type("aws:lambda/function:Function")))
	assert.Equal(t, "acme", typePackage(tokens.Type("acme:Greeter")), "a component's type can have two parts")
}
