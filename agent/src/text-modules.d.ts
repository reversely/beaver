// wrangler's Text rule bundles these files as strings (agent/wrangler.jsonc).
declare module "*.md" {
  const text: string;
  export default text;
}
declare module "*.toml" {
  const text: string;
  export default text;
}
