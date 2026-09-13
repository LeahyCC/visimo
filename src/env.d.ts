/// <reference types="@webgpu/types" />
/// <reference types="vite/client" />
/// <reference lib="dom" />

// Explicit rather than leaning on vite/client's `*?raw`, so a consumer whose
// own ambient types are arranged differently still sees the shaders as strings.
declare module '*.wgsl?raw' {
  const source: string
  export default source
}
