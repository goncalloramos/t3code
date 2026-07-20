export const GONCALLORAMOS_PRODUCT_IDENTITY = {
  displayName: "T3 Code - goncalloramos",
  developmentDisplayName: "T3 Code - goncalloramos (Dev)",
  nightlyDisplayName: "T3 Code - goncalloramos (Nightly)",
  desktopAppId: "com.goncalloramos.t3code",
  desktopDevelopmentAppId: "com.goncalloramos.t3code.dev",
  mobileAppId: "com.goncalloramos.t3code.mobile",
  mobileAppGroupId: "group.com.goncalloramos.t3code.mobile",
  protocolScheme: "t3code-goncalloramos",
  executableName: "t3code-goncalloramos",
  artifactName: "T3-Code-goncalloramos-${version}-${arch}.${ext}",
  linuxDesktopEntryName: "t3code-goncalloramos.desktop",
  linuxDevelopmentDesktopEntryName: "t3code-goncalloramos-dev.desktop",
  linuxWmClass: "t3code-goncalloramos",
  linuxDevelopmentWmClass: "t3code-goncalloramos-dev",
  applicationSupportDirectoryName: "T3 Code - goncalloramos",
  runtimeHomeDirectoryName: ".t3-goncalloramos",
  assetDirectory: "assets/goncalloramos",
  desktopIconSvg: "assets/goncalloramos/t3-goncalloramos-macos.svg",
  desktopIconPng: "assets/goncalloramos/t3-goncalloramos-macos-1024.png",
  mobileIconPng: "assets/goncalloramos/t3-goncalloramos-macos-1024.png",
  windowsIconIco: "assets/goncalloramos/t3-goncalloramos-windows.ico",
} as const;

export const LEGACY_GONCALLORAMOS_PRODUCT_IDENTITY = {
  applicationSupportDirectoryNames: ["T3 Code Custom", "t3code-custom"],
  runtimeHomeDirectoryName: ".t3",
} as const;
