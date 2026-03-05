/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['snarkjs', 'circomlibjs'],
    outputFileTracingIncludes: {
      '/api/**': ['../sdk/dist/**', '../circuits/build/v4/**'],
    },
  },
};

module.exports = nextConfig;
