declare module "react-native" {
  export const Platform: { OS: string }
}

declare module "expo-modules-core" {
  export function requireOptionalNativeModule<T = unknown>(
    moduleName: string,
  ): T | null
}
