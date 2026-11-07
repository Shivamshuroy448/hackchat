/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No eslint config ships with this project; don't let lint block the build.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
