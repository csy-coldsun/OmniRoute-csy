// Build-time stub for @/mitm/manager
// Used by Turbopack during next build to avoid native module resolution errors.
// The real module is used at runtime via dynamic import in route handlers.

// Re-export everything from the real module
// This is a workaround for Turbopack's module resolution
export * from "./manager";
