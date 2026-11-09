import type { NextConfig } from "next";

// Run independently at /letter-to-santa and proxy the same URL through jaredvogler.com.
// The basePath keeps Next's JS/CSS/API requests inside this app's URL namespace.
const config: NextConfig = {
  basePath: "/letter-to-santa",
  poweredByHeader: false,
};
export default config;
