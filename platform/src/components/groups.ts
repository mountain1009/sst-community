// The components for each provider, which the `sst` global has as `sst.aws`
// and so on (index.ts), and a file imports as `sst/components/aws`. Each
// group loads the providers its components use. A test is given the groups
// whose providers are installed (`sst/testing`).
export const groups = {
  aws: () => import("./aws/index"),
  cloudflare: () => import("./cloudflare/index"),
  vercel: () => import("./vercel/index"),
};
