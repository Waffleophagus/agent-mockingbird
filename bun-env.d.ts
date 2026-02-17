/// <reference lib="dom" />

declare module "*.svg" {
  const path: `${string}.svg`;
  export default path;
}

declare module "*.html" {
  const html: string;
  export default html;
}
