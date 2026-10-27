declare module "react-native" {
  export const NativeModules: Record<string, unknown>
  export const Platform: { OS: string }
}
